// Beérkezett napi jelentések - the office/HQ side: every location's napi
// zárás in one place, grouped by location, with view/approve actions and
// the same missing-closing alert that also shows up on the Riasztások page
// (see useAlerts - one shared computation, not a separate channel).
import { AlertTriangle, CheckCircle2, Clock, Eye, FileSpreadsheet, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { useAlerts } from '../hooks/useAlerts'
import { usePersistedDateRange } from '../hooks/usePersistedDateRange'
import { buildDailyClosingSummary, type DailyClosingSummary } from '../lib/dailyClosing'
import type { DailyClosing, DailyClosingStatus, Location } from '../types'
import { Modal } from '../components/Modal'
import { Button, Card, EmptyState, PageHeader, Select, Input } from '../components/ui'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'
import { isoDaysAgo, todayISO } from '../lib/dates'
import { exportToExcel, exportToPdf, type ExportColumn } from '../lib/export'

const STATUS_LABELS: Record<DailyClosingStatus, string> = {
  submitted: 'Beküldve, még nem tekintve meg',
  viewed: 'Megtekintve',
  approved: 'Jóváhagyva',
}

const STATUS_CLASSES: Record<DailyClosingStatus, string> = {
  submitted: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
  viewed: 'bg-[var(--color-info-bg)] text-[var(--color-primary)]',
  approved: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
}

interface ReportRow {
  locationName: string
  date: string
  status: string
  inCount: number
  outCount: number
  submittedAt: string
}

export function DailyReports() {
  const locations = useStore((s) => s.locations)
  const products = useStore((s) => s.products)
  const movements = useStore((s) => s.movements)
  const dailyClosings = useStore((s) => s.dailyClosings)
  const markDailyClosingViewed = useStore((s) => s.markDailyClosingViewed)
  const approveDailyClosing = useStore((s) => s.approveDailyClosing)
  const alerts = useAlerts()

  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const activeLocations = useMemo(() => locations.filter((l) => !l.deletedAt), [locations])

  // Élő, MÉG NEM VÉGLEGESÍTETT állapot a mai napra, telephelyenként - mivel
  // egy telephely naponta csak egyszer küld napi zárást, eddig az iroda
  // teljesen vakon lett volna a nap közben rögzített mozgásokra nézve. Ez a
  // pontosan ugyanazt a `buildDailyClosingSummary`-t hívja, amit a raktár
  // oldali "Napi zárás" előnézete is használ (`pages/DailyClosing.tsx`),
  // úgyhogy a két nézet sosem térhet el egymástól - és mivel `movements`
  // reaktívan van olvasva a store-ból, ez a szakasz magától frissül, amint
  // a raktáros rögzít valamit (cross-tab esetén a storage-event-alapú
  // rehidrálás miatt is - lásd App.tsx).
  const today = todayISO()
  const inProgressToday = useMemo(() => {
    const closedLocationIds = new Set(dailyClosings.filter((c) => c.date === today).map((c) => c.locationId))
    return activeLocations
      .filter((l) => !closedLocationIds.has(l.id))
      .map((l) => ({ location: l, summary: buildDailyClosingSummary(movements, products, l.id, today) }))
      .filter((r) => r.summary.inCount > 0 || r.summary.outCount > 0)
  }, [activeLocations, dailyClosings, movements, products, today])

  const { from, to, setFrom, setTo } = usePersistedDateRange('keszletfigyelo-napi-jelentesek-daterange', () => ({
    from: isoDaysAgo(30),
    to: todayISO(),
  }))
  const [locationFilter, setLocationFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | DailyClosingStatus>('')
  const [detail, setDetail] = useState<DailyClosing | null>(null)
  const [inProgressDetail, setInProgressDetail] = useState<{ location: Location; summary: DailyClosingSummary } | null>(null)

  const filtered = useMemo(
    () =>
      dailyClosings
        .filter((c) => c.date >= from && c.date <= to)
        .filter((c) => !locationFilter || c.locationId === locationFilter)
        .filter((c) => !statusFilter || c.status === statusFilter)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (locationById.get(a.locationId)?.name ?? '').localeCompare(locationById.get(b.locationId)?.name ?? '', 'hu'))),
    [dailyClosings, from, to, locationFilter, statusFilter, locationById],
  )

  const grouped = useMemo(() => {
    const byLocation = new Map<string, DailyClosing[]>()
    for (const c of filtered) {
      const arr = byLocation.get(c.locationId) ?? []
      arr.push(c)
      byLocation.set(c.locationId, arr)
    }
    return Array.from(byLocation.entries())
      .map(([locationId, closings]) => ({ locationId, locationName: locationById.get(locationId)?.name ?? 'Ismeretlen telephely', closings }))
      .sort((a, b) => a.locationName.localeCompare(b.locationName, 'hu'))
  }, [filtered, locationById])

  function openDetail(closing: DailyClosing) {
    if (closing.status === 'submitted') markDailyClosingViewed(closing.id)
    setDetail(closing)
  }

  const exportRows: ReportRow[] = filtered.map((c) => ({
    locationName: locationById.get(c.locationId)?.name ?? 'Ismeretlen telephely',
    date: formatDate(c.date),
    status: STATUS_LABELS[c.status],
    inCount: c.inCount,
    outCount: c.outCount,
    submittedAt: formatDateTime(c.submittedAt),
  }))
  const exportColumns: ExportColumn<ReportRow>[] = [
    { header: 'Telephely', accessor: (r) => r.locationName, width: 22 },
    { header: 'Dátum', accessor: (r) => r.date, width: 14 },
    { header: 'Állapot', accessor: (r) => r.status, width: 26 },
    { header: 'Bejövő tételek', accessor: (r) => r.inCount, width: 14 },
    { header: 'Kimenő tételek', accessor: (r) => r.outCount, width: 14 },
    { header: 'Elküldve', accessor: (r) => r.submittedAt, width: 18 },
  ]

  return (
    <div>
      <PageHeader
        title="Beérkezett napi jelentések"
        subtitle="Minden telephely napi zárása egy helyen, telephelyenként csoportosítva"
        actions={
          <>
            <Button variant="secondary" onClick={() => exportToExcel('napi_jelentesek.xlsx', 'Napi jelentések', exportColumns, exportRows)}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportToPdf('napi_jelentesek.pdf', 'Beérkezett napi jelentések', exportColumns, exportRows)}>
              <FileText size={16} /> PDF
            </Button>
          </>
        }
      />

      {inProgressToday.length > 0 && (
        <Card className="mb-5 border-l-4 border-l-[var(--color-primary)]">
          <div className="mb-2 flex items-center gap-2">
            <Clock size={18} className="text-[var(--color-primary)]" />
            <h2 className="text-base font-semibold text-[var(--color-text)]">Folyamatban - mai nap (még nincs lezárva)</h2>
          </div>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            Élő állapot, még nem véglegesített napi zárás - a számok a raktáros rögzítésével együtt frissülnek, jóváhagyás itt nem
            lehetséges, amíg a telephely el nem küldi a zárást.
          </p>
          <ul className="divide-y divide-[var(--color-border)]">
            {inProgressToday.map(({ location, summary }) => (
              <li key={location.id}>
                <button
                  type="button"
                  onClick={() => setInProgressDetail({ location, summary })}
                  className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:bg-black/5"
                >
                  <span className="text-[var(--color-text)]">{location.name}</span>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <span className="text-[var(--color-success)]">{formatNumber(summary.inCount)} be</span> /{' '}
                    <span className="text-[var(--color-danger)]">{formatNumber(summary.outCount)} ki</span>
                    <Eye size={14} className="text-[var(--color-text-muted)]" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {alerts.missingClosings.length > 0 && (
        <Card className="mb-5 border-l-4 border-l-[var(--color-danger)]">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle size={18} className="text-[var(--color-danger)]" />
            <h2 className="text-base font-semibold text-[var(--color-text)]">Hiányzó napi zárások</h2>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {alerts.missingClosings.map((m) => (
              <li key={`${m.locationId}-${m.date}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="text-[var(--color-text)]">
                  {m.locationName} nem küldött jelentést {formatDate(m.date)}-ra ({m.daysOverdue} napja).
                </span>
                <Link to={`/napi-zaras?telephely=${m.locationId}&datum=${m.date}`} className="font-medium text-[var(--color-primary)] hover:underline">
                  Zárás pótlása
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Ettől</span>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Eddig</span>
            <Input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Telephely</span>
            <Select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <option value="">Összes telephely</option>
              {activeLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Állapot</span>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | DailyClosingStatus)}>
              <option value="">Mind</option>
              <option value="submitted">Beküldve, még nem tekintve meg</option>
              <option value="viewed">Megtekintve</option>
              <option value="approved">Jóváhagyva</option>
            </Select>
          </label>
        </div>
      </Card>

      {grouped.length === 0 ? (
        <EmptyState>Nincs beérkezett napi jelentés a kiválasztott szűrésnek megfelelően.</EmptyState>
      ) : (
        <div className="space-y-6">
          {grouped.map((g) => (
            <div key={g.locationId}>
              <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">{g.locationName}</h2>
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                      <th className="px-4 py-3 font-medium">Dátum</th>
                      <th className="px-4 py-3 font-medium">Állapot</th>
                      <th className="px-4 py-3 text-right font-medium">Be / Ki</th>
                      <th className="px-4 py-3 font-medium">Elküldve</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {g.closings.map((c) => (
                      <tr key={c.id} className="border-b border-[var(--color-border)] last:border-b-0">
                        <td className="whitespace-nowrap px-4 py-3">
                          {formatDate(c.date)}
                          {c.modifiedAfterSubmission && <AlertTriangle size={14} className="ml-1.5 inline text-[var(--color-warning)]" />}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASSES[c.status]}`}>{STATUS_LABELS[c.status]}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <span className="text-[var(--color-success)]">{formatNumber(c.inCount)}</span> /{' '}
                          <span className="text-[var(--color-danger)]">{formatNumber(c.outCount)}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-muted)]">{formatDateTime(c.submittedAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openDetail(c)}
                            aria-label="Jelentés megtekintése"
                            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5"
                            title="Megtekintés"
                          >
                            <Eye size={16} />
                          </button>
                          {c.status !== 'approved' && (
                            <button
                              type="button"
                              onClick={() => approveDailyClosing(c.id)}
                              aria-label="Jelentés jóváhagyása"
                              className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-success)]"
                              title="Jóváhagyás"
                            >
                              <CheckCircle2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <Modal title={`${locationById.get(detail.locationId)?.name ?? ''} - ${formatDate(detail.date)}`} onClose={() => setDetail(null)}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLASSES[detail.status]}`}>{STATUS_LABELS[detail.status]}</span>
            {detail.modifiedAfterSubmission && (
              <span className="rounded-full bg-[var(--color-warning-bg)] px-3 py-1 text-xs font-semibold text-[var(--color-warning)]">
                Utólag módosult
              </span>
            )}
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-[var(--color-text-muted)]">Bejövő tételek</div>
              <div className="font-semibold text-[var(--color-success)]">{formatNumber(detail.inCount)}</div>
            </div>
            <div>
              <div className="text-[var(--color-text-muted)]">Kimenő tételek</div>
              <div className="font-semibold text-[var(--color-danger)]">{formatNumber(detail.outCount)}</div>
            </div>
          </div>
          {detail.productBreakdown.length === 0 ? (
            <EmptyState>Nincs termékenkénti tétel ehhez a zárásnaphoz.</EmptyState>
          ) : (
            <div className="mb-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4 font-medium">Termék</th>
                    <th className="py-2 pr-4 text-right font-medium">Bejövő</th>
                    <th className="py-2 text-right font-medium">Kimenő</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.productBreakdown.map((r) => (
                    <tr key={r.productId} className="border-b border-[var(--color-border)] last:border-b-0">
                      <td className="py-2 pr-4">{r.productName}</td>
                      <td className="py-2 pr-4 text-right text-[var(--color-success)]">
                        {r.inQuantity > 0 ? `${formatNumber(r.inQuantity)} ${r.unit}` : '—'}
                      </td>
                      <td className="py-2 text-right text-[var(--color-danger)]">
                        {r.outQuantity > 0 ? `${formatNumber(r.outQuantity)} ${r.unit}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDetail(null)}>
              Bezárás
            </Button>
            {detail.status !== 'approved' && (
              <Button
                onClick={() => {
                  approveDailyClosing(detail.id)
                  setDetail(null)
                }}
              >
                <CheckCircle2 size={16} /> Jóváhagyás
              </Button>
            )}
          </div>
        </Modal>
      )}

      {inProgressDetail && (
        <Modal title={`${inProgressDetail.location.name} - ${formatDate(today)}`} onClose={() => setInProgressDetail(null)}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--color-info-bg)] px-3 py-1 text-xs font-semibold text-[var(--color-primary)]">
              Folyamatban, még nincs lezárva
            </span>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-[var(--color-text-muted)]">Bejövő tételek</div>
              <div className="font-semibold text-[var(--color-success)]">{formatNumber(inProgressDetail.summary.inCount)}</div>
            </div>
            <div>
              <div className="text-[var(--color-text-muted)]">Kimenő tételek</div>
              <div className="font-semibold text-[var(--color-danger)]">{formatNumber(inProgressDetail.summary.outCount)}</div>
            </div>
          </div>
          {inProgressDetail.summary.productBreakdown.length === 0 ? (
            <EmptyState>Nincs termékenkénti tétel a mai napra.</EmptyState>
          ) : (
            <div className="mb-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4 font-medium">Termék</th>
                    <th className="py-2 pr-4 text-right font-medium">Bejövő</th>
                    <th className="py-2 text-right font-medium">Kimenő</th>
                  </tr>
                </thead>
                <tbody>
                  {inProgressDetail.summary.productBreakdown.map((r) => (
                    <tr key={r.productId} className="border-b border-[var(--color-border)] last:border-b-0">
                      <td className="py-2 pr-4">{r.productName}</td>
                      <td className="py-2 pr-4 text-right text-[var(--color-success)]">
                        {r.inQuantity > 0 ? `${formatNumber(r.inQuantity)} ${r.unit}` : '—'}
                      </td>
                      <td className="py-2 text-right text-[var(--color-danger)]">
                        {r.outQuantity > 0 ? `${formatNumber(r.outQuantity)} ${r.unit}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mb-4 text-xs text-[var(--color-text-muted)]">
            Jóváhagyás itt nem lehetséges - ez élő előnézet, a telephely még nem küldte el a napi zárást.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setInProgressDetail(null)}>
              Bezárás
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
