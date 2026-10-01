import { FileSpreadsheet, FileText, Pause, Pencil, Play, Plus, CheckCircle2, RotateCcw, Repeat, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useStore } from '../store/useStore'
import type { DeleteLedgerEntryMode } from '../store/useStore'
import { usePersistedDateRange } from '../hooks/usePersistedDateRange'
import { computeMarginReport } from '../lib/alerts'
import { computeInventoryPurchaseCost } from '../lib/costing'
import { computeFinancialSummary, ledgerEntryHuf } from '../lib/ledger'
import { computeAutoVatTotals } from '../lib/vat'
import { VAT_CATEGORY, type LedgerEntry, type RecurringLedgerEntry } from '../types'
import { Modal } from '../components/Modal'
import { LedgerEntryForm } from '../components/LedgerEntryForm'
import { RecurringLedgerEntryForm } from '../components/RecurringLedgerEntryForm'
import { DeleteChoiceDialog } from '../components/DeleteChoiceDialog'
import { Button, Card, Checkbox, EmptyState, Input, PageHeader, Select } from '../components/ui'
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
  const { isReadOnlyViewer } = useAuth()
  const entries = useStore((s) => s.ledgerEntries)
  const categories = useStore((s) => s.ledgerCategories)
  const products = useStore((s) => s.products)
  const movements = useStore((s) => s.movements)
  const lots = useStore((s) => s.lots)
  const deleteLedgerEntry = useStore((s) => s.deleteLedgerEntry)
  const restoreLedgerEntry = useStore((s) => s.restoreLedgerEntry)
  const setLedgerEntryPaid = useStore((s) => s.setLedgerEntryPaid)
  const recurringEntries = useStore((s) => s.recurringLedgerEntries)
  const updateRecurringLedgerEntry = useStore((s) => s.updateRecurringLedgerEntry)
  const deleteRecurringLedgerEntry = useStore((s) => s.deleteRecurringLedgerEntry)
  const restoreRecurringLedgerEntry = useStore((s) => s.restoreRecurringLedgerEntry)
  const generateDueRecurringLedgerEntries = useStore((s) => s.generateDueRecurringLedgerEntries)

  // Minden belépéskor ellenőrizzük, nincs-e esedékes, még le nem könyvelt
  // ismétlődő tétel - lásd store/useStore.ts generateDueRecurringLedgerEntries
  // (olcsó, idempotens hívás, ha nincs mit generálni, nem csinál semmit).
  // Ez emellett az App.tsx-ben is lefut egyszer induláskor, hogy a
  // dashboard/P&L akkor is naprakész legyen, ha valaki meg sem nyitja ezt
  // az oldalt.
  useEffect(() => {
    generateDueRecurringLedgerEntries()
  }, [generateDueRecurringLedgerEntries])

  const { from, to, setFrom, setTo, setRange } = usePersistedDateRange('keszletfigyelo-penzugyi-naplo-daterange', currentMonthRange)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | 'income' | 'expense'>('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<LedgerEntry | null>(null)
  const [deleting, setDeleting] = useState<LedgerEntry | null>(null)
  const [creatingRecurring, setCreatingRecurring] = useState(false)
  const [editingRecurring, setEditingRecurring] = useState<RecurringLedgerEntry | null>(null)
  const [deletingRecurring, setDeletingRecurring] = useState<RecurringLedgerEntry | null>(null)
  const [showDeletedRecurring, setShowDeletedRecurring] = useState(false)

  const visibleRecurring = useMemo(
    () => recurringEntries.filter((r) => showDeletedRecurring || !r.deletedAt).sort((a, b) => a.description.localeCompare(b.description, 'hu')),
    [recurringEntries, showDeletedRecurring],
  )

  const filtered = useMemo(
    () =>
      entries
        .filter((e) => e.date >= from && e.date <= to)
        .filter((e) => showDeleted || !e.deletedAt)
        .filter((e) => !categoryFilter || e.category === categoryFilter)
        .filter((e) => !typeFilter || e.type === typeFilter)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt))),
    [entries, from, to, categoryFilter, typeFilter, showDeleted],
  )

  const marginRows = useMemo(() => computeMarginReport(products, movements, from, to), [products, movements, from, to])
  const inventoryRevenue = marginRows.reduce((sum, r) => sum + r.revenue, 0)
  // Buying stock is an expense the moment it's purchased, not only once it
  // eventually sells - so this is keyed off the purchase (lot) date, not
  // COGS of whatever happened to sell in this same period.
  const inventoryCost = useMemo(() => computeInventoryPurchaseCost(lots, from, to), [lots, from, to])
  // Automatically tracked VAT counts toward the P&L the same way purchases
  // do above: accrued the moment the transaction happens, not when the ÁFA
  // return is actually filed. Non-reclaimable purchase VAT is left out -
  // it's already folded into inventoryCost via lotUnitCost (see lib/costing.ts).
  const autoVat = useMemo(() => computeAutoVatTotals(lots, movements, from, to), [lots, movements, from, to])

  // The P&L combines ALL ACTIVE ledger entries in range (not the category/
  // type/showDeleted filters above, which only narrow the entry list/
  // export) with inventory margin data, so it always reflects the real
  // period total - lib/ledger.ts's own filtering already drops deleted ones.
  const entriesInRange = useMemo(() => entries.filter((e) => e.date >= from && e.date <= to), [entries, from, to])
  const summary = useMemo(
    () => computeFinancialSummary(entriesInRange, inventoryRevenue, inventoryCost, autoVat.purchaseReclaimable, autoVat.sale, from, to),
    [entriesInRange, inventoryRevenue, inventoryCost, autoVat, from, to],
  )

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
            {!isReadOnlyViewer && (
              <Button onClick={() => setCreating(true)}>
                <Plus size={18} /> Új tétel
              </Button>
            )}
          </>
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
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <Checkbox label="Törölt tételek megjelenítése" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Összes bevétel</div>
          <div className="text-2xl font-bold text-[var(--color-success)]">{formatCurrency(summary.totalIncome)}</div>
          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
            ebből napló: {formatCurrency(summary.ledgerIncomeTotal)} · készlet: {formatCurrency(summary.inventoryRevenue)} · automatikus ÁFA:{' '}
            {formatCurrency(summary.autoVatIncome)}
          </div>
        </Card>
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Összes kiadás</div>
          <div className="text-2xl font-bold text-[var(--color-danger)]">{formatCurrency(summary.totalExpense)}</div>
          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
            ebből napló: {formatCurrency(summary.ledgerExpenseTotal)} · beszerzés: {formatCurrency(summary.inventoryCost)} · automatikus ÁFA:{' '}
            {formatCurrency(summary.autoVatExpense)}
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

      <Card className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text)]">ÁFA egyenleg és tételek</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            A fenti bevétel/kiadás már tartalmazza az automatikus ÁFA-t is (lásd "automatikus ÁFA" a kártyákon). A teljes
            befizetendő/visszaigényelhető egyenleg és a tételes bontás a dedikált ÁFA oldalon tekinthető meg.
          </p>
        </div>
        <Link
          to="/afa"
          className="shrink-0 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Ugrás az ÁFA oldalra
        </Link>
      </Card>

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
                <tr className="border-b border-[var(--color-border)] font-semibold">
                  <td className="py-2 pr-4">Készlet (eladás / beszerzés)</td>
                  <td className="py-2 pr-4 text-right text-[var(--color-success)]">{formatCurrency(summary.inventoryRevenue)}</td>
                  <td className="py-2 text-right text-[var(--color-danger)]">{formatCurrency(summary.inventoryCost)}</td>
                </tr>
                <tr className="font-semibold">
                  <td className="py-2 pr-4">
                    Automatikus ÁFA (beszerzés / eladás)
                    <div className="text-xs font-normal text-[var(--color-text-muted)]">
                      visszaigényelhető beszerzési ÁFA bevételként, értékesítési ÁFA kiadásként - részletek az ÁFA oldalon
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-right text-[var(--color-success)]">{formatCurrency(summary.autoVatIncome)}</td>
                  <td className="py-2 text-right text-[var(--color-danger)]">{formatCurrency(summary.autoVatExpense)}</td>
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
              {filtered.map((e) => {
                const isDeleted = Boolean(e.deletedAt)
                return (
                  <tr key={e.id} className={`border-b border-[var(--color-border)] last:border-b-0 ${isDeleted ? 'opacity-60' : ''}`}>
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
                      <div className={`text-[var(--color-text)] ${isDeleted ? 'line-through' : ''}`}>{e.description}</div>
                      {e.note && <div className="text-xs text-[var(--color-text-muted)]">{e.note}</div>}
                      {isDeleted && <div className="text-xs font-medium text-[var(--color-text-muted)]">Törölve</div>}
                      {e.correctsEntryId && (
                        <div className="text-xs font-medium text-[var(--color-warning)]">
                          Korrekció - #{e.correctsEntryId.slice(0, 8)} tételhez
                        </div>
                      )}
                      {e.recurringEntryId && (
                        <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                          <Repeat size={11} /> Ismétlődő tételből
                        </div>
                      )}
                      {!isDeleted && e.dueDate &&
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
                      {isReadOnlyViewer ? null : isDeleted ? (
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

      <Card className="mb-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
              <Repeat size={16} /> Ismétlődő tételek
            </h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Havonta ismétlődő bevétel/kiadás (pl. bérleti díj, előfizetés) - a megadott napon automatikusan létrejön belőle a normál napló tétel.
            </p>
          </div>
          {!isReadOnlyViewer && (
            <Button onClick={() => setCreatingRecurring(true)}>
              <Plus size={18} /> Új ismétlődő tétel
            </Button>
          )}
        </div>

        {visibleRecurring.length === 0 ? (
          <EmptyState>Nincs ismétlődő tétel beállítva.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="py-2 pr-4 font-medium">Megnevezés</th>
                  <th className="py-2 pr-4 font-medium">Kategória</th>
                  <th className="py-2 pr-4 text-right font-medium">Összeg</th>
                  <th className="py-2 pr-4 font-medium">Esedékesség</th>
                  <th className="py-2 pr-4 font-medium">Állapot</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleRecurring.map((r) => {
                  const isDeleted = Boolean(r.deletedAt)
                  return (
                    <tr key={r.id} className={`border-b border-[var(--color-border)] last:border-b-0 ${isDeleted ? 'opacity-60' : ''}`}>
                      <td className="py-2 pr-4">
                        <div className={isDeleted ? 'line-through' : ''}>{r.description}</div>
                        {isDeleted && <div className="text-xs font-medium text-[var(--color-text-muted)]">Törölve</div>}
                      </td>
                      <td className="py-2 pr-4">{r.category}</td>
                      <td className="whitespace-nowrap py-2 pr-4 text-right">
                        <span className={r.type === 'income' ? 'font-semibold text-[var(--color-success)]' : 'font-semibold text-[var(--color-danger)]'}>
                          {r.type === 'income' ? '+' : '-'}
                          {r.currency === 'HUF' ? formatCurrency(r.amount) : `${formatMoney(r.amount, r.currency)} (≈${formatCurrency(r.amount * r.exchangeRate)})`}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4">
                        minden hó {r.dayOfMonth}.{r.endDate ? ` · ${formatDate(r.startDate)} - ${formatDate(r.endDate)}` : ` · ${formatDate(r.startDate)}-tól`}
                      </td>
                      <td className="py-2 pr-4">
                        {isDeleted ? (
                          <span className="text-xs text-[var(--color-text-muted)]">—</span>
                        ) : r.active ? (
                          <span className="text-xs font-medium text-[var(--color-success)]">Aktív</span>
                        ) : (
                          <span className="text-xs font-medium text-[var(--color-text-muted)]">Szüneteltetve</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right">
                        {isReadOnlyViewer ? null : isDeleted ? (
                          <button
                            type="button"
                            onClick={() => restoreRecurringLedgerEntry(r.id)}
                            aria-label="Visszaállítás"
                            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-success)]"
                          >
                            <RotateCcw size={16} />
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => updateRecurringLedgerEntry(r.id, { ...r, active: !r.active })}
                              aria-label={r.active ? 'Szüneteltetés' : 'Aktiválás'}
                              className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5"
                            >
                              {r.active ? <Pause size={16} /> : <Play size={16} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingRecurring(r)}
                              aria-label="Szerkesztés"
                              className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingRecurring(r)}
                              aria-label="Törlés"
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
          </div>
        )}

        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <Checkbox label="Törölt ismétlődő tételek megjelenítése" checked={showDeletedRecurring} onChange={(e) => setShowDeletedRecurring(e.target.checked)} />
        </div>
      </Card>

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

      {creatingRecurring && (
        <Modal title="Új ismétlődő tétel" onClose={() => setCreatingRecurring(false)}>
          <RecurringLedgerEntryForm onDone={() => setCreatingRecurring(false)} />
        </Modal>
      )}
      {editingRecurring && (
        <Modal title="Ismétlődő tétel szerkesztése" onClose={() => setEditingRecurring(null)}>
          <RecurringLedgerEntryForm entry={editingRecurring} onDone={() => setEditingRecurring(null)} />
        </Modal>
      )}
      {deletingRecurring && (
        <Modal title="Ismétlődő tétel törlése" onClose={() => setDeletingRecurring(null)}>
          <p className="mb-4 text-sm text-[var(--color-text)]">
            Biztosan törlöd a(z) "{deletingRecurring.description}" ismétlődő tételt? A már korábban ebből legenerált napló tételek megmaradnak -
            csak a jövőbeni, automatikus könyvelés áll le.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDeletingRecurring(null)}>
              Mégse
            </Button>
            <Button
              type="button"
              onClick={() => {
                deleteRecurringLedgerEntry(deletingRecurring.id)
                setDeletingRecurring(null)
              }}
            >
              Törlés
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
