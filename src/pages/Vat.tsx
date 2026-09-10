// Single home for everything ÁFA-related: the combined balance (manual +
// automatic, from purchases and sales), the automatic VAT detail rows, and
// management of manually entered ÁFA-category ledger entries. Previously
// this was split between the Pénzügyi napló page and scattered nav links;
// consolidating it here means every VAT figure has exactly one place it's
// computed and shown. The per-product default VAT rate itself stays on the
// product page (Készlet) - that's a setting, not a report, so it isn't
// duplicated here.
import { CheckCircle2, FileSpreadsheet, FileText, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { DeleteLedgerEntryMode } from '../store/useStore'
import { usePersistedDateRange } from '../hooks/usePersistedDateRange'
import { computeCombinedVatSummary, listAutoVatRows, type AutoVatRow } from '../lib/vat'
import { VAT_CATEGORY, type LedgerEntry } from '../types'
import { Modal } from '../components/Modal'
import { LedgerEntryForm } from '../components/LedgerEntryForm'
import { DeleteChoiceDialog } from '../components/DeleteChoiceDialog'
import { Button, Card, Checkbox, EmptyState, Input, PageHeader } from '../components/ui'
import { formatCurrency, formatDate, formatMoney, formatNumber } from '../lib/format'
import { currentMonthRange, currentQuarterRange, isoDaysAgo, todayISO } from '../lib/dates'
import { exportToExcel, exportToPdf, type ExportColumn } from '../lib/export'

interface AutoVatExportRow {
  date: string
  description: string
  source: string
  vatRatePercent: number
  netHuf: number
  amountHuf: number
}

interface ManualVatExportRow {
  date: string
  type: string
  description: string
  amountOriginal: string
  amountHuf: number
  direction: string
  note: string
}

export function Vat() {
  const entries = useStore((s) => s.ledgerEntries)
  const products = useStore((s) => s.products)
  const suppliers = useStore((s) => s.suppliers)
  const movements = useStore((s) => s.movements)
  const lots = useStore((s) => s.lots)
  const deleteLedgerEntry = useStore((s) => s.deleteLedgerEntry)
  const restoreLedgerEntry = useStore((s) => s.restoreLedgerEntry)
  const setLedgerEntryPaid = useStore((s) => s.setLedgerEntryPaid)

  const { from, to, setFrom, setTo, setRange } = usePersistedDateRange('keszletfigyelo-afa-daterange', currentMonthRange)
  const [showDeleted, setShowDeleted] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<LedgerEntry | null>(null)
  const [deleting, setDeleting] = useState<LedgerEntry | null>(null)

  const entriesInRange = useMemo(() => entries.filter((e) => e.date >= from && e.date <= to), [entries, from, to])
  const vatSummary = useMemo(() => computeCombinedVatSummary(entriesInRange, lots, movements, from, to), [entriesInRange, lots, movements, from, to])
  const autoVatRows = useMemo(
    () => listAutoVatRows(lots, movements, products, suppliers, from, to),
    [lots, movements, products, suppliers, from, to],
  )

  const manualVatEntries = useMemo(
    () =>
      entries
        .filter((e) => e.category === VAT_CATEGORY)
        .filter((e) => e.date >= from && e.date <= to)
        .filter((e) => showDeleted || !e.deletedAt)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt))),
    [entries, from, to, showDeleted],
  )

  const autoExportRows: AutoVatExportRow[] = autoVatRows.map((r) => ({
    date: formatDate(r.date),
    description: r.cancelled ? `${r.description} (stornózva)` : r.description,
    source:
      r.sourceType === 'sale' ? 'Értékesítés' : r.sourceType === 'purchase-reclaimable' ? 'Beszerzés (visszaig.)' : 'Beszerzés (nem visszaig.)',
    vatRatePercent: r.vatRatePercent,
    netHuf: Math.round(r.netHuf),
    amountHuf: Math.round(r.amountHuf),
  }))
  const autoColumns: ExportColumn<AutoVatExportRow>[] = [
    { header: 'Dátum', accessor: (r) => r.date, width: 14 },
    { header: 'Megnevezés', accessor: (r) => r.description, width: 30 },
    { header: 'Forrás', accessor: (r) => r.source, width: 20 },
    { header: 'Kulcs (%)', accessor: (r) => r.vatRatePercent, width: 10 },
    { header: 'Nettó alap (Ft)', accessor: (r) => r.netHuf, width: 16 },
    { header: 'ÁFA összeg (Ft)', accessor: (r) => r.amountHuf, width: 16 },
  ]

  const manualExportRows: ManualVatExportRow[] = manualVatEntries.map((e) => ({
    date: formatDate(e.date),
    type: e.type === 'income' ? 'Bevétel' : 'Kiadás',
    description: e.description,
    amountOriginal: e.currency === 'HUF' ? '' : formatMoney(e.amount, e.currency),
    amountHuf: Math.round(e.amount * e.exchangeRate),
    direction: e.vatDirection === 'payable' ? 'Befizetendő' : 'Visszaigényelhető',
    note: e.note ?? '',
  }))
  const manualColumns: ExportColumn<ManualVatExportRow>[] = [
    { header: 'Dátum', accessor: (r) => r.date, width: 14 },
    { header: 'Típus', accessor: (r) => r.type, width: 10 },
    { header: 'Megnevezés', accessor: (r) => r.description, width: 30 },
    { header: 'Eredeti összeg', accessor: (r) => r.amountOriginal, width: 16 },
    { header: 'Összeg (Ft)', accessor: (r) => r.amountHuf, width: 14 },
    { header: 'Irány', accessor: (r) => r.direction, width: 16 },
    { header: 'Megjegyzés', accessor: (r) => r.note, width: 24 },
  ]

  return (
    <div>
      <PageHeader
        title="ÁFA"
        subtitle="ÁFA-egyenleg, automatikus (beszerzés/eladás) és kézi tételek egy helyen. A termékenkénti alapértelmezett ÁFA kulcs a termék adatlapján állítható."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={18} /> Új ÁFA tétel
          </Button>
        }
      />

      <Card className="mb-5">
        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setRange(currentMonthRange())}>
            Ez a hónap
          </Button>
          <Button variant="secondary" onClick={() => setRange(currentQuarterRange())}>
            Ez a negyedév
          </Button>
          <Button variant="secondary" onClick={() => setRange({ from: isoDaysAgo(30), to: todayISO() })}>
            Utolsó 30 nap
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Ettől</span>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Eddig</span>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </Card>

      <Card className="mb-5">
        <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">ÁFA egyenleg</h2>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="text-sm text-[var(--color-text-muted)]">Befizetendő</div>
            <div className="text-lg font-bold text-[var(--color-danger)]">{formatCurrency(vatSummary.totalPayable)}</div>
          </div>
          <div>
            <div className="text-sm text-[var(--color-text-muted)]">Visszaigényelhető</div>
            <div className="text-lg font-bold text-[var(--color-success)]">{formatCurrency(vatSummary.totalReclaimable)}</div>
          </div>
          <div>
            <div className="text-sm text-[var(--color-text-muted)]">Egyenleg</div>
            <div className="text-lg font-bold text-[var(--color-text)]">{formatCurrency(vatSummary.netBalance)}</div>
            <div className="text-xs text-[var(--color-text-muted)]">
              {vatSummary.netBalance >= 0 ? 'fizetendő az adóhatóság felé' : 'visszajáró összeg'}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="py-2 pr-4 font-medium">Forrás</th>
                <th className="py-2 pr-4 text-right font-medium">Befizetendő</th>
                <th className="py-2 pr-4 text-right font-medium">Visszaigényelhető</th>
                <th className="py-2 text-right font-medium">Nem visszaigényelhető</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--color-border)]">
                <td className="py-2 pr-4">Kézi tételek (lásd lent)</td>
                <td className="py-2 pr-4 text-right">{vatSummary.manualPayable > 0 ? formatCurrency(vatSummary.manualPayable) : '—'}</td>
                <td className="py-2 pr-4 text-right">{vatSummary.manualReclaimable > 0 ? formatCurrency(vatSummary.manualReclaimable) : '—'}</td>
                <td className="py-2 text-right">—</td>
              </tr>
              <tr className="border-b border-[var(--color-border)]">
                <td className="py-2 pr-4">Automatikus (beszerzésből)</td>
                <td className="py-2 pr-4 text-right">—</td>
                <td className="py-2 pr-4 text-right">
                  {vatSummary.autoPurchaseReclaimable > 0 ? formatCurrency(vatSummary.autoPurchaseReclaimable) : '—'}
                </td>
                <td className="py-2 text-right text-[var(--color-text-muted)]">
                  {vatSummary.autoPurchaseNonReclaimable > 0 ? formatCurrency(vatSummary.autoPurchaseNonReclaimable) : '—'}
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Automatikus (értékesítésből)</td>
                <td className="py-2 pr-4 text-right">{vatSummary.autoSalePayable > 0 ? formatCurrency(vatSummary.autoSalePayable) : '—'}</td>
                <td className="py-2 pr-4 text-right">—</td>
                <td className="py-2 text-right">—</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          A "nem visszaigényelhető" oszlop csak tájékoztató jellegű - nem csökkenti az egyenleget, mert az az érintett termékek
          egységköltségébe került be valós, meg nem térülő kiadásként.
        </p>
      </Card>

      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Automatikus ÁFA tételek (beszerzésből és eladásból)</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => exportToExcel(`afa_automatikus_${from}_${to}.xlsx`, 'Automatikus ÁFA', autoColumns, autoExportRows)}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportToPdf(`afa_automatikus_${from}_${to}.pdf`, 'Automatikus ÁFA tételek', autoColumns, autoExportRows)}>
              <FileText size={16} /> PDF
            </Button>
          </div>
        </div>
        {autoVatRows.length === 0 ? (
          <EmptyState>Nincs automatikusan nyomon követett ÁFA tétel a kiválasztott időszakban.</EmptyState>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Dátum</th>
                  <th className="px-4 py-3 font-medium">Megnevezés</th>
                  <th className="px-4 py-3 font-medium">Forrás</th>
                  <th className="px-4 py-3 text-right font-medium">Kulcs</th>
                  <th className="px-4 py-3 text-right font-medium">ÁFA összeg</th>
                </tr>
              </thead>
              <tbody>
                {autoVatRows.map((r: AutoVatRow) => (
                  <tr
                    key={`${r.sourceType}-${r.id}`}
                    className={`border-b border-[var(--color-border)] last:border-b-0 ${r.cancelled ? 'opacity-60' : ''}`}
                  >
                    <td className="whitespace-nowrap px-4 py-3">{formatDate(r.date)}</td>
                    <td className={`px-4 py-3 ${r.cancelled ? 'line-through' : ''}`}>{r.description}</td>
                    <td className="px-4 py-3">
                      {r.sourceType === 'sale'
                        ? r.cancelled
                          ? 'Stornózva (visszavont eladás miatt)'
                          : 'Értékesítés'
                        : r.sourceType === 'purchase-reclaimable'
                          ? 'Beszerzés (visszaig.)'
                          : 'Beszerzés (nem visszaig.)'}
                    </td>
                    <td className="px-4 py-3 text-right">{r.vatRatePercent}%</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(r.amountHuf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Kézzel felvitt ÁFA tételek</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => exportToExcel(`afa_kezi_${from}_${to}.xlsx`, 'Kézi ÁFA tételek', manualColumns, manualExportRows)}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportToPdf(`afa_kezi_${from}_${to}.pdf`, 'Kézzel felvitt ÁFA tételek', manualColumns, manualExportRows)}>
              <FileText size={16} /> PDF
            </Button>
          </div>
        </div>
        <Card className="mb-3">
          <Checkbox label="Törölt tételek megjelenítése" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
        </Card>
        {manualVatEntries.length === 0 ? (
          <EmptyState>Nincs kézzel felvitt ÁFA tétel a kiválasztott időszakban.</EmptyState>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Dátum</th>
                  <th className="px-4 py-3 font-medium">Megnevezés</th>
                  <th className="px-4 py-3 font-medium">Irány</th>
                  <th className="px-4 py-3 text-right font-medium">Összeg</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {manualVatEntries.map((e) => {
                  const isDeleted = Boolean(e.deletedAt)
                  return (
                    <tr key={e.id} className={`border-b border-[var(--color-border)] last:border-b-0 ${isDeleted ? 'opacity-60' : ''}`}>
                      <td className="whitespace-nowrap px-4 py-3">{formatDate(e.date)}</td>
                      <td className="px-4 py-3">
                        <div className={`text-[var(--color-text)] ${isDeleted ? 'line-through' : ''}`}>{e.description}</div>
                        {e.note && <div className="text-xs text-[var(--color-text-muted)]">{e.note}</div>}
                        {isDeleted && <div className="text-xs font-medium text-[var(--color-text-muted)]">Törölve</div>}
                        {e.correctsEntryId && (
                          <div className="text-xs font-medium text-[var(--color-warning)]">Korrekció - #{e.correctsEntryId.slice(0, 8)} tételhez</div>
                        )}
                        {!isDeleted && e.dueDate &&
                          (e.isPaid ? (
                            <div className="text-xs text-[var(--color-success)]">Kifizetve{e.paidDate ? ` (${formatDate(e.paidDate)})` : ''}</div>
                          ) : (
                            <div className="text-xs font-medium text-[var(--color-danger)]">Fizetési határidő: {formatDate(e.dueDate)}</div>
                          ))}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {e.vatDirection === 'payable' ? 'Befizetendő' : 'Visszaigényelhető'}
                        <div className="text-xs text-[var(--color-text-muted)]">{e.vatRatePercent}%</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <span className={e.type === 'income' ? 'font-semibold text-[var(--color-success)]' : 'font-semibold text-[var(--color-danger)]'}>
                          {e.type === 'income' ? '+' : '-'}
                          {formatCurrency(e.amount * e.exchangeRate)}
                        </span>
                        {e.currency !== 'HUF' && (
                          <div className="text-xs text-[var(--color-text-muted)]">
                            {formatMoney(e.amount, e.currency)} · árfolyam {formatNumber(e.exchangeRate)}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {isDeleted ? (
                          <button
                            type="button"
                            onClick={() => restoreLedgerEntry(e.id)}
                            aria-label="Tétel visszaállítása"
                            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-success)]"
                          >
                            <RotateCcw size={16} />
                          </button>
                        ) : (
                          <>
                            {e.dueDate && !e.isPaid && (
                              <button
                                type="button"
                                onClick={() => setLedgerEntryPaid(e.id, true)}
                                aria-label="Megjelölés kifizetettként"
                                className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-success)]"
                              >
                                <CheckCircle2 size={16} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditing(e)}
                              aria-label="Tétel szerkesztése"
                              className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleting(e)}
                              aria-label="Tétel törlése"
                              className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-danger)]"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Ezek a tételek a Pénzügyi naplóban is megjelennek (ott minden kategória vegyesen listázva) - itt csak az ÁFA-kategóriájú
          tételekre szűrve, egy helyen, a teljes ÁFA-képhez.
        </p>
      </div>

      {creating && (
        <Modal title="Új ÁFA tétel" onClose={() => setCreating(false)}>
          <LedgerEntryForm initialCategory={VAT_CATEGORY} onDone={() => setCreating(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title="ÁFA tétel szerkesztése" onClose={() => setEditing(null)}>
          <LedgerEntryForm entry={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {deleting && (
        <DeleteChoiceDialog
          title="Tétel törlése"
          description={`Hogyan töröljük a(z) "${deleting.description}" tételt?`}
          onCorrection={() => {
            deleteLedgerEntry(deleting.id, 'correction' satisfies DeleteLedgerEntryMode)
            setDeleting(null)
          }}
          onSoftDelete={() => {
            deleteLedgerEntry(deleting.id, 'soft-delete' satisfies DeleteLedgerEntryMode)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
