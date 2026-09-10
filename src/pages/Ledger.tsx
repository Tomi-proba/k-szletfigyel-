import { CheckCircle2, FileSpreadsheet, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { computeMarginReport } from '../lib/alerts'
import { computeFinancialSummary, computeVatSummary, ledgerEntryHuf } from '../lib/ledger'
import { VAT_CATEGORY, type LedgerEntry } from '../types'
import { Modal } from '../components/Modal'
import { LedgerEntryForm } from '../components/LedgerEntryForm'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button, Card, EmptyState, Input, PageHeader, Select } from '../components/ui'
import { formatCurrency, formatDate, formatMoney, formatNumber } from '../lib/format'
import { currentMonthRange, currentQuarterRange, isoDaysAgo, todayISO } from '../lib/dates'
import { exportToExcel, exportToPdf, type ExportColumn } from '../lib/export'

interface LedgerRow {
  date: string
  type: string
  category: string
  description: string
  amountOriginal: string
  amountHuf: number
  vat: string
  note: string
}

export function Ledger() {
  const entries = useStore((s) => s.ledgerEntries)
  const categories = useStore((s) => s.ledgerCategories)
  const products = useStore((s) => s.products)
  const movements = useStore((s) => s.movements)
  const deleteLedgerEntry = useStore((s) => s.deleteLedgerEntry)
  const setLedgerEntryPaid = useStore((s) => s.setLedgerEntryPaid)

  const [from, setFrom] = useState(currentMonthRange().from)
  const [to, setTo] = useState(currentMonthRange().to)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | 'income' | 'expense'>('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<LedgerEntry | null>(null)
  const [deleting, setDeleting] = useState<LedgerEntry | null>(null)

  const filtered = useMemo(
    () =>
      entries
        .filter((e) => e.date >= from && e.date <= to)
        .filter((e) => !categoryFilter || e.category === categoryFilter)
        .filter((e) => !typeFilter || e.type === typeFilter)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt))),
    [entries, from, to, categoryFilter, typeFilter],
  )

  const marginRows = useMemo(() => computeMarginReport(products, movements, from, to), [products, movements, from, to])
  const inventoryRevenue = marginRows.reduce((sum, r) => sum + r.revenue, 0)
  const inventoryCost = marginRows.reduce((sum, r) => sum + r.cost, 0)

  // The P&L combines ALL ledger entries in range (not the category/type
  // filter above, which only narrows the entry list/export) with inventory
  // margin data, so it always reflects the whole period.
  const entriesInRange = useMemo(() => entries.filter((e) => e.date >= from && e.date <= to), [entries, from, to])
  const summary = useMemo(
    () => computeFinancialSummary(entriesInRange, inventoryRevenue, inventoryCost, from, to),
    [entriesInRange, inventoryRevenue, inventoryCost, from, to],
  )
  const vatSummary = useMemo(() => computeVatSummary(entriesInRange, from, to), [entriesInRange, from, to])
  const hasVatEntries = entriesInRange.some((e) => e.category === VAT_CATEGORY)

  function toRow(e: LedgerEntry): LedgerRow {
    return {
      date: formatDate(e.date),
      type: e.type === 'income' ? 'Bevétel' : 'Kiadás',
      category: e.category,
      description: e.description,
      amountOriginal: e.currency === 'HUF' ? '' : formatMoney(e.amount, e.currency),
      amountHuf: ledgerEntryHuf(e),
      vat: e.category === VAT_CATEGORY ? `${e.vatRatePercent ?? 0}% · ${e.vatDirection === 'payable' ? 'Befizetendő' : 'Visszaigényelhető'}` : '',
      note: e.note ?? '',
    }
  }

  const columns: ExportColumn<LedgerRow>[] = [
    { header: 'Dátum', accessor: (r) => r.date, width: 14 },
    { header: 'Típus', accessor: (r) => r.type, width: 10 },
    { header: 'Kategória', accessor: (r) => r.category, width: 18 },
    { header: 'Megnevezés', accessor: (r) => r.description, width: 30 },
    { header: 'Eredeti összeg', accessor: (r) => r.amountOriginal, width: 16 },
    { header: 'Összeg (Ft)', accessor: (r) => r.amountHuf, width: 14 },
    { header: 'ÁFA', accessor: (r) => r.vat, width: 22 },
    { header: 'Megjegyzés', accessor: (r) => r.note, width: 24 },
  ]

  const rows = filtered.map(toRow)

  return (
    <div>
      <PageHeader
        title="Pénzügyi napló"
        subtitle="Készlettől és vevőktől független bevételek és kiadások"
        actions={
          <>
            <Button variant="secondary" onClick={() => exportToExcel(`penzugyi_naplo_${from}_${to}.xlsx`, 'Pénzügyi napló', columns, rows)}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportToPdf(`penzugyi_naplo_${from}_${to}.pdf`, 'Pénzügyi napló', columns, rows)}>
              <FileText size={16} /> PDF
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus size={18} /> Új tétel
            </Button>
          </>
        }
      />

      <Card className="mb-5">
        <div className="mb-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              const r = currentMonthRange()
              setFrom(r.from)
              setTo(r.to)
            }}
          >
            Ez a hónap
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const r = currentQuarterRange()
              setFrom(r.from)
              setTo(r.to)
            }}
          >
            Ez a negyedév
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setFrom(isoDaysAgo(30))
              setTo(todayISO())
            }}
          >
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
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Kategória</span>
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">Összes kategória</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Típus</span>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'income' | 'expense' | '')}>
              <option value="">Mind</option>
              <option value="income">Bevétel</option>
              <option value="expense">Kiadás</option>
            </Select>
          </label>
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Összes bevétel</div>
          <div className="text-2xl font-bold text-[var(--color-success)]">{formatCurrency(summary.totalIncome)}</div>
          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
            ebből napló: {formatCurrency(summary.ledgerIncomeTotal)} · készlet: {formatCurrency(summary.inventoryRevenue)}
          </div>
        </Card>
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Összes kiadás</div>
          <div className="text-2xl font-bold text-[var(--color-danger)]">{formatCurrency(summary.totalExpense)}</div>
          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
            ebből napló: {formatCurrency(summary.ledgerExpenseTotal)} · beszerzés: {formatCurrency(summary.inventoryCost)}
          </div>
        </Card>
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Eredmény</div>
          <div className={`text-2xl font-bold ${summary.netResult >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
            {formatCurrency(summary.netResult)}
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-muted)]">{summary.netResult >= 0 ? 'nyereség' : 'veszteség'} az időszakban</div>
        </Card>
      </div>

      {hasVatEntries && (
        <Card className="mb-5">
          <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">ÁFA egyenleg</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
        </Card>
      )}

      <Card className="mb-5">
        <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">Kategóriánkénti összesítés</h2>
        {summary.categoryTotals.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Nincs napló tétel a kiválasztott időszakban.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="py-2 pr-4 font-medium">Kategória</th>
                  <th className="py-2 pr-4 text-right font-medium">Bevétel</th>
                  <th className="py-2 text-right font-medium">Kiadás</th>
                </tr>
              </thead>
              <tbody>
                {summary.categoryTotals.map((c) => (
                  <tr key={c.category} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="py-2 pr-4">{c.category}</td>
                    <td className="py-2 pr-4 text-right text-[var(--color-success)]">{c.income > 0 ? formatCurrency(c.income) : '—'}</td>
                    <td className="py-2 text-right text-[var(--color-danger)]">{c.expense > 0 ? formatCurrency(c.expense) : '—'}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 pr-4">Készlet (eladás / beszerzés)</td>
                  <td className="py-2 pr-4 text-right text-[var(--color-success)]">{formatCurrency(summary.inventoryRevenue)}</td>
                  <td className="py-2 text-right text-[var(--color-danger)]">{formatCurrency(summary.inventoryCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {filtered.length === 0 ? (
        <EmptyState>Nincs a szűrésnek megfelelő tétel.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-medium">Dátum</th>
                <th className="px-4 py-3 font-medium">Kategória</th>
                <th className="px-4 py-3 font-medium">Megnevezés</th>
                <th className="px-4 py-3 text-right font-medium">Összeg</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3">{formatDate(e.date)}</td>
                  <td className="px-4 py-3">
                    <div>{e.category}</div>
                    {e.category === VAT_CATEGORY && (
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {e.vatRatePercent}% · {e.vatDirection === 'payable' ? 'Befizetendő' : 'Visszaigényelhető'}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[var(--color-text)]">{e.description}</div>
                    {e.note && <div className="text-xs text-[var(--color-text-muted)]">{e.note}</div>}
                    {e.dueDate &&
                      (e.isPaid ? (
                        <div className="text-xs text-[var(--color-success)]">
                          Kifizetve{e.paidDate ? ` (${formatDate(e.paidDate)})` : ''}
                        </div>
                      ) : (
                        <div className="text-xs font-medium text-[var(--color-danger)]">Fizetési határidő: {formatDate(e.dueDate)}</div>
                      ))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className={e.type === 'income' ? 'font-semibold text-[var(--color-success)]' : 'font-semibold text-[var(--color-danger)]'}>
                      {e.type === 'income' ? '+' : '-'}
                      {formatCurrency(ledgerEntryHuf(e))}
                    </span>
                    {e.currency !== 'HUF' && (
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {formatMoney(e.amount, e.currency)} · árfolyam {formatNumber(e.exchangeRate)}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && (
        <Modal title="Új tétel" onClose={() => setCreating(false)}>
          <LedgerEntryForm onDone={() => setCreating(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title="Tétel szerkesztése" onClose={() => setEditing(null)}>
          <LedgerEntryForm entry={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Tétel törlése"
          message={`Biztosan törlöd a(z) "${deleting.description}" tételt?`}
          confirmLabel="Törlés"
          danger
          onConfirm={() => {
            deleteLedgerEntry(deleting.id)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
