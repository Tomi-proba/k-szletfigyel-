// Napi zárás (daily closing) - the warehouse/location side: pick a location
// and day, see the day's movement summary, and send it to the office. Once
// sent, a closing is never edited here - see store/useStore.ts's
// deleteMovement/recordMovement for how a later correction only ever flags
// it as modifiedAfterSubmission, never rewrites its numbers.
import { AlertTriangle, CheckCircle2, Eye, FileSpreadsheet, FileText, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { usePersistedDateRange } from '../hooks/usePersistedDateRange'
import { buildDailyClosingSummary } from '../lib/dailyClosing'
import type { DailyClosing, DailyClosingStatus } from '../types'
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

interface HistoryRow {
  date: string
  status: string
  inCount: number
  outCount: number
  submittedAt: string
  modified: string
}

export function DailyClosingPage() {
  const locations = useStore((s) => s.locations)
  const products = useStore((s) => s.products)
  const movements = useStore((s) => s.movements)
  const dailyClosings = useStore((s) => s.dailyClosings)
  const submitDailyClosing = useStore((s) => s.submitDailyClosing)

  const activeLocations = useMemo(() => locations.filter((l) => !l.deletedAt), [locations])
  const [searchParams] = useSearchParams()
  const [locationId, setLocationId] = useState(() => searchParams.get('telephely') || activeLocations[0]?.id || '')
  const [date, setDate] = useState(() => searchParams.get('datum') || todayISO())
  const [error, setError] = useState<string | null>(null)
  const [successTick, setSuccessTick] = useState(0)
  const [detail, setDetail] = useState<DailyClosing | null>(null)

  const { from: historyFrom, to: historyTo, setFrom: setHistoryFrom, setTo: setHistoryTo } = usePersistedDateRange(
    'keszletfigyelo-napi-zaras-history-daterange',
    () => ({ from: isoDaysAgo(30), to: todayISO() }),
  )

  const existingClosing = useMemo(
    () => dailyClosings.find((c) => c.locationId === locationId && c.date === date),
    [dailyClosings, locationId, date],
  )

  const preview = useMemo(
    () => (existingClosing ? null : buildDailyClosingSummary(movements, products, locationId, date)),
    [existingClosing, movements, products, locationId, date],
  )

  const locationHistory = useMemo(
    () =>
      dailyClosings
        .filter((c) => c.locationId === locationId && c.date >= historyFrom && c.date <= historyTo)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [dailyClosings, locationId, historyFrom, historyTo],
  )

  function handleSubmit() {
    setError(null)
    const result = submitDailyClosing(locationId, date)
    if (result.ok) {
      setSuccessTick((t) => t + 1)
      return
    }
    if (result.reason === 'no-movements') setError('Ezen a napon nem volt egyetlen rögzített mozgás sem ezen a telephelyen - nincs mit zárni.')
    else if (result.reason === 'already-closed') setError('Erre a napra már el lett küldve a napi zárás.')
    else setError('A napi zárás nem küldhető el.')
  }

  const historyRows: HistoryRow[] = locationHistory.map((c) => ({
    date: formatDate(c.date),
    status: STATUS_LABELS[c.status],
    inCount: c.inCount,
    outCount: c.outCount,
    submittedAt: formatDateTime(c.submittedAt),
    modified: c.modifiedAfterSubmission ? `Igen (${c.lastModifiedAt ? formatDateTime(c.lastModifiedAt) : ''})` : 'Nem',
  }))
  const historyColumns: ExportColumn<HistoryRow>[] = [
    { header: 'Dátum', accessor: (r) => r.date, width: 14 },
    { header: 'Állapot', accessor: (r) => r.status, width: 26 },
    { header: 'Bejövő tételek', accessor: (r) => r.inCount, width: 14 },
    { header: 'Kimenő tételek', accessor: (r) => r.outCount, width: 14 },
    { header: 'Elküldve', accessor: (r) => r.submittedAt, width: 18 },
    { header: 'Módosult utólag', accessor: (r) => r.modified, width: 22 },
  ]

  const locationName = activeLocations.find((l) => l.id === locationId)?.name ?? ''

  return (
    <div>
      <PageHeader title="Napi zárás" subtitle="Egy telephely aznapi mozgásainak összegzése és elküldése az irodának" />

      <Card className="mb-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Telephely</span>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {activeLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Dátum</span>
            <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      </Card>

      {existingClosing ? (
        <Card className="mb-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {locationName} - {formatDate(date)}
            </h2>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLASSES[existingClosing.status]}`}>
              {STATUS_LABELS[existingClosing.status]}
            </span>
          </div>
          {existingClosing.modifiedAfterSubmission && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning)]">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>
                Ez a napi zárás módosult egy utólagos korrekció miatt
                {existingClosing.lastModifiedAt ? ` (${formatDateTime(existingClosing.lastModifiedAt)})` : ''}. Az eredetileg elküldött
                számok nem változtak meg utólag - ez csak jelzi, hogy érdemes újra átnézni.
              </span>
            </div>
          )}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-sm text-[var(--color-text-muted)]">Bejövő tételek</div>
              <div className="text-xl font-bold text-[var(--color-success)]">{formatNumber(existingClosing.inCount)}</div>
            </div>
            <div>
              <div className="text-sm text-[var(--color-text-muted)]">Kimenő tételek</div>
              <div className="text-xl font-bold text-[var(--color-danger)]">{formatNumber(existingClosing.outCount)}</div>
            </div>
            <div>
              <div className="text-sm text-[var(--color-text-muted)]">Elküldve</div>
              <div className="text-sm text-[var(--color-text)]">{formatDateTime(existingClosing.submittedAt)}</div>
            </div>
            <div>
              <div className="text-sm text-[var(--color-text-muted)]">
                {existingClosing.status === 'approved' ? 'Jóváhagyva' : existingClosing.status === 'viewed' ? 'Megtekintve' : 'Még nem tekintették meg'}
              </div>
              <div className="text-sm text-[var(--color-text)]">
                {existingClosing.approvedAt
                  ? formatDateTime(existingClosing.approvedAt)
                  : existingClosing.viewedAt
                    ? formatDateTime(existingClosing.viewedAt)
                    : '—'}
              </div>
            </div>
          </div>
          <ProductBreakdownTable closing={existingClosing} />
        </Card>
      ) : (
        <Card className="mb-5">
          <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">Előnézet - {formatDate(date)}</h2>
          {!preview || (preview.inCount === 0 && preview.outCount === 0) ? (
            <EmptyState>Nincs rögzített mozgás ezen a napon ezen a telephelyen.</EmptyState>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-sm text-[var(--color-text-muted)]">Bejövő tételek</div>
                  <div className="text-xl font-bold text-[var(--color-success)]">{formatNumber(preview.inCount)}</div>
                </div>
                <div>
                  <div className="text-sm text-[var(--color-text-muted)]">Kimenő tételek</div>
                  <div className="text-xl font-bold text-[var(--color-danger)]">{formatNumber(preview.outCount)}</div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                      <th className="py-2 pr-4 font-medium">Termék</th>
                      <th className="py-2 pr-4 text-right font-medium">Bejövő</th>
                      <th className="py-2 text-right font-medium">Kimenő</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.productBreakdown.map((r) => (
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
            </>
          )}
          {error && <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
          <div className="mt-4 flex justify-end">
            <Button onClick={handleSubmit} disabled={!preview || (preview.inCount === 0 && preview.outCount === 0)}>
              <Send size={16} /> Napi zárás elküldése
            </Button>
          </div>
        </Card>
      )}
      {successTick > 0 && !existingClosing && (
        <p className="mb-5 text-sm text-[var(--color-success)]">A napi zárás elküldve.</p>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Korábbi zárások - {locationName}</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => exportToExcel(`napi_zarasok_${locationName}.xlsx`, 'Napi zárások', historyColumns, historyRows)}>
            <FileSpreadsheet size={16} /> Excel
          </Button>
          <Button variant="secondary" onClick={() => exportToPdf(`napi_zarasok_${locationName}.pdf`, `Napi zárások - ${locationName}`, historyColumns, historyRows)}>
            <FileText size={16} /> PDF
          </Button>
        </div>
      </div>
      <Card className="mb-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Ettől</span>
            <Input type="date" value={historyFrom} max={historyTo} onChange={(e) => setHistoryFrom(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Eddig</span>
            <Input type="date" value={historyTo} min={historyFrom} max={todayISO()} onChange={(e) => setHistoryTo(e.target.value)} />
          </label>
        </div>
      </Card>

      {locationHistory.length === 0 ? (
        <EmptyState>Nincs korábbi napi zárás a kiválasztott időszakban ezen a telephelyen.</EmptyState>
      ) : (
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
              {locationHistory.map((c) => (
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
                      onClick={() => setDetail(c)}
                      aria-label="Részletek megtekintése"
                      className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5"
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {detail && (
        <Modal title={`Napi zárás részletei - ${formatDate(detail.date)}`} onClose={() => setDetail(null)}>
          <div className="mb-3 flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLASSES[detail.status]}`}>{STATUS_LABELS[detail.status]}</span>
            {detail.status === 'approved' && <CheckCircle2 size={16} className="text-[var(--color-success)]" />}
          </div>
          <ProductBreakdownTable closing={detail} />
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setDetail(null)}>
              Bezárás
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ProductBreakdownTable({ closing }: { closing: DailyClosing }) {
  if (closing.productBreakdown.length === 0) {
    return <EmptyState>Nincs termékenkénti tétel ehhez a zárásnaphoz.</EmptyState>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
            <th className="py-2 pr-4 font-medium">Termék</th>
            <th className="py-2 pr-4 text-right font-medium">Bejövő</th>
            <th className="py-2 text-right font-medium">Kimenő</th>
          </tr>
        </thead>
        <tbody>
          {closing.productBreakdown.map((r) => (
            <tr key={r.productId} className="border-b border-[var(--color-border)] last:border-b-0">
              <td className="py-2 pr-4">{r.productName}</td>
              <td className="py-2 pr-4 text-right text-[var(--color-success)]">{r.inQuantity > 0 ? `${formatNumber(r.inQuantity)} ${r.unit}` : '—'}</td>
              <td className="py-2 text-right text-[var(--color-danger)]">{r.outQuantity > 0 ? `${formatNumber(r.outQuantity)} ${r.unit}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
