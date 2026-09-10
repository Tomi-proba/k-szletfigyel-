import { FileSpreadsheet, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { computeMarginReport } from '../lib/alerts'
import { groupShippingByPeriod, groupShippingBySupplier, type ShippingPeriodGranularity } from '../lib/shipping'
import { Button, Card, EmptyState, Input, PageHeader, Select } from '../components/ui'
import { formatCurrency, formatNumber } from '../lib/format'
import { isoDaysAgo, todayISO } from '../lib/dates'
import { exportToExcel, exportToPdf, type ExportColumn } from '../lib/export'

type Tab = 'haszonkulcs' | 'szallitas'

const TABS: { key: Tab; label: string }[] = [
  { key: 'haszonkulcs', label: 'Haszonkulcs kimutatás' },
  { key: 'szallitas', label: 'Szállítási költség kimutatás' },
]

export function Reports() {
  const [tab, setTab] = useState<Tab>('haszonkulcs')

  return (
    <div>
      <PageHeader title="Riportok" />

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-[var(--color-primary)] text-white' : 'bg-black/5 text-[var(--color-text)] hover:bg-black/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'haszonkulcs' ? <MarginReportTab /> : <ShippingReportTab />}
    </div>
  )
}

interface MarginRow {
  productId: string
  productName: string
  sku: string
  quantitySold: number
  revenue: number
  cost: number
  margin: number
  marginPercent: number
}

function MarginReportTab() {
  const products = useStore((s) => s.products)
  const movements = useStore((s) => s.movements)

  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(todayISO())

  const report = useMemo(() => computeMarginReport(products, movements, from, to), [products, movements, from, to])

  const rows: MarginRow[] = report.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    sku: r.sku ?? '',
    quantitySold: r.quantitySold,
    revenue: r.revenue,
    cost: r.cost,
    margin: r.margin,
    marginPercent: r.marginPercent,
  }))

  const totals = rows.reduce(
    (acc, r) => ({ revenue: acc.revenue + r.revenue, cost: acc.cost + r.cost, margin: acc.margin + r.margin }),
    { revenue: 0, cost: 0, margin: 0 },
  )

  const columns: ExportColumn<MarginRow>[] = [
    { header: 'Termék', accessor: (r) => r.productName, width: 28 },
    { header: 'Cikkszám', accessor: (r) => r.sku, width: 14 },
    { header: 'Eladott mennyiség', accessor: (r) => r.quantitySold, width: 16 },
    { header: 'Árbevétel', accessor: (r) => r.revenue, width: 16 },
    { header: 'Beszerzési költség', accessor: (r) => r.cost, width: 16 },
    { header: 'Árrés', accessor: (r) => r.margin, width: 14 },
    { header: 'Árrés %', accessor: (r) => Math.round(r.marginPercent), width: 10 },
  ]

  return (
    <div>
      <Card className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid grid-cols-2 gap-3 sm:w-fit sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-[var(--color-text)]">Ettől</span>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-[var(--color-text)]">Eddig</span>
              <Input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => exportToExcel(`haszonkulcs_${from}_${to}.xlsx`, 'Haszonkulcs', columns, rows)}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportToPdf(`haszonkulcs_${from}_${to}.pdf`, 'Haszonkulcs kimutatás', columns, rows)}>
              <FileText size={16} /> PDF
            </Button>
          </div>
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Árbevétel</div>
          <div className="text-2xl font-bold text-[var(--color-text)]">{formatCurrency(totals.revenue)}</div>
        </Card>
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Beszerzési költség</div>
          <div className="text-2xl font-bold text-[var(--color-text)]">{formatCurrency(totals.cost)}</div>
        </Card>
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Árrés</div>
          <div className="text-2xl font-bold text-[var(--color-success)]">{formatCurrency(totals.margin)}</div>
        </Card>
      </div>

      {rows.length === 0 ? (
        <EmptyState>Nincs kimenő mozgás a kiválasztott időszakban.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-medium">Termék</th>
                <th className="px-4 py-3 text-right font-medium">Eladott menny.</th>
                <th className="px-4 py-3 text-right font-medium">Árbevétel</th>
                <th className="px-4 py-3 text-right font-medium">Költség</th>
                <th className="px-4 py-3 text-right font-medium">Árrés</th>
                <th className="px-4 py-3 text-right font-medium">Árrés %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--color-text)]">{r.productName}</div>
                    {r.sku && <div className="text-xs text-[var(--color-text-muted)]">{r.sku}</div>}
                  </td>
                  <td className="px-4 py-3 text-right">{formatNumber(r.quantitySold)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(r.revenue)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(r.cost)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[var(--color-success)]">{formatCurrency(r.margin)}</td>
                  <td className="px-4 py-3 text-right">{Math.round(r.marginPercent)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

const GRANULARITIES: { value: ShippingPeriodGranularity; label: string }[] = [
  { value: 'day', label: 'Nap' },
  { value: 'week', label: 'Hét' },
  { value: 'month', label: 'Hónap' },
  { value: 'year', label: 'Év' },
]

interface SupplierRow {
  supplierName: string
  batchCount: number
  goodsValueHuf: number
  shippingHuf: number
  totalHuf: number
}

interface PeriodRow {
  periodKey: string
  periodLabel: string
  batchCount: number
  goodsValueHuf: number
  shippingHuf: number
  totalHuf: number
}

function ShippingReportTab() {
  const lots = useStore((s) => s.lots)
  const products = useStore((s) => s.products)
  const suppliers = useStore((s) => s.suppliers)

  const [from, setFrom] = useState(isoDaysAgo(90))
  const [to, setTo] = useState(todayISO())
  const [supplierFilter, setSupplierFilter] = useState('')
  const [granularity, setGranularity] = useState<ShippingPeriodGranularity>('month')

  const filteredLots = useMemo(() => {
    if (!supplierFilter) return lots
    const productIds = new Set(products.filter((p) => p.supplierId === supplierFilter).map((p) => p.id))
    return lots.filter((l) => productIds.has(l.productId))
  }, [lots, products, supplierFilter])

  const bySupplier = useMemo(
    () => groupShippingBySupplier(filteredLots, products, suppliers, from, to),
    [filteredLots, products, suppliers, from, to],
  )
  const byPeriod = useMemo(() => groupShippingByPeriod(filteredLots, from, to, granularity), [filteredLots, from, to, granularity])

  const totals = bySupplier.reduce(
    (acc, r) => ({ goodsValueHuf: acc.goodsValueHuf + r.goodsValueHuf, shippingHuf: acc.shippingHuf + r.shippingHuf }),
    { goodsValueHuf: 0, shippingHuf: 0 },
  )
  const shippingRatioPercent = totals.goodsValueHuf > 0 ? (totals.shippingHuf / totals.goodsValueHuf) * 100 : 0

  const supplierRows: SupplierRow[] = bySupplier.map((r) => ({
    supplierName: r.supplierName,
    batchCount: r.batchCount,
    goodsValueHuf: Math.round(r.goodsValueHuf),
    shippingHuf: Math.round(r.shippingHuf),
    totalHuf: Math.round(r.totalHuf),
  }))
  const supplierColumns: ExportColumn<SupplierRow>[] = [
    { header: 'Beszállító', accessor: (r) => r.supplierName, width: 26 },
    { header: 'Tételek száma', accessor: (r) => r.batchCount, width: 14 },
    { header: 'Áru érték', accessor: (r) => r.goodsValueHuf, width: 16 },
    { header: 'Szállítási költség', accessor: (r) => r.shippingHuf, width: 16 },
    { header: 'Összesen', accessor: (r) => r.totalHuf, width: 16 },
  ]

  const periodRows: PeriodRow[] = byPeriod.map((r) => ({
    periodKey: r.periodKey,
    periodLabel: r.periodLabel,
    batchCount: r.batchCount,
    goodsValueHuf: Math.round(r.goodsValueHuf),
    shippingHuf: Math.round(r.shippingHuf),
    totalHuf: Math.round(r.totalHuf),
  }))
  const periodColumns: ExportColumn<PeriodRow>[] = [
    { header: 'Időszak', accessor: (r) => r.periodLabel, width: 20 },
    { header: 'Tételek száma', accessor: (r) => r.batchCount, width: 14 },
    { header: 'Áru érték', accessor: (r) => r.goodsValueHuf, width: 16 },
    { header: 'Szállítási költség', accessor: (r) => r.shippingHuf, width: 16 },
    { header: 'Összesen', accessor: (r) => r.totalHuf, width: 16 },
  ]

  return (
    <div>
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
            <span className="mb-1 block font-medium text-[var(--color-text)]">Beszállító</span>
            <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
              <option value="">Összes beszállító</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Időszaki bontás</span>
            <Select value={granularity} onChange={(e) => setGranularity(e.target.value as ShippingPeriodGranularity)}>
              {GRANULARITIES.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Áru érték összesen</div>
          <div className="text-2xl font-bold text-[var(--color-text)]">{formatCurrency(totals.goodsValueHuf)}</div>
        </Card>
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Szállítási költség összesen</div>
          <div className="text-2xl font-bold text-[var(--color-danger)]">{formatCurrency(totals.shippingHuf)}</div>
        </Card>
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Szállítás aránya</div>
          <div className="text-2xl font-bold text-[var(--color-text)]">{formatNumber(shippingRatioPercent)}%</div>
          <div className="text-xs text-[var(--color-text-muted)]">a teljes áru értékhez képest</div>
        </Card>
      </div>

      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Beszállítónkénti bontás</h2>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => exportToExcel(`szallitas_beszallitonkent_${from}_${to}.xlsx`, 'Szállítás beszállítónként', supplierColumns, supplierRows)}
            >
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button
              variant="secondary"
              onClick={() => exportToPdf(`szallitas_beszallitonkent_${from}_${to}.pdf`, 'Szállítási költség beszállítónként', supplierColumns, supplierRows)}
            >
              <FileText size={16} /> PDF
            </Button>
          </div>
        </div>
        {supplierRows.length === 0 ? (
          <EmptyState>Nincs beszerzési tétel a kiválasztott szűrésnek megfelelően.</EmptyState>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Beszállító</th>
                  <th className="px-4 py-3 text-right font-medium">Tételek</th>
                  <th className="px-4 py-3 text-right font-medium">Áru érték</th>
                  <th className="px-4 py-3 text-right font-medium">Szállítás</th>
                  <th className="px-4 py-3 text-right font-medium">Összesen</th>
                </tr>
              </thead>
              <tbody>
                {supplierRows.map((r) => (
                  <tr key={r.supplierName} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="px-4 py-3 font-medium text-[var(--color-text)]">{r.supplierName}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(r.batchCount)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.goodsValueHuf)}</td>
                    <td className="px-4 py-3 text-right text-[var(--color-danger)]">{formatCurrency(r.shippingHuf)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(r.totalHuf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Időszakonkénti bontás</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => exportToExcel(`szallitas_idoszakonkent_${from}_${to}.xlsx`, 'Szállítás időszakonként', periodColumns, periodRows)}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportToPdf(`szallitas_idoszakonkent_${from}_${to}.pdf`, 'Szállítási költség időszakonként', periodColumns, periodRows)}>
              <FileText size={16} /> PDF
            </Button>
          </div>
        </div>
        {periodRows.length === 0 ? (
          <EmptyState>Nincs beszerzési tétel a kiválasztott szűrésnek megfelelően.</EmptyState>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Időszak</th>
                  <th className="px-4 py-3 text-right font-medium">Tételek</th>
                  <th className="px-4 py-3 text-right font-medium">Áru érték</th>
                  <th className="px-4 py-3 text-right font-medium">Szállítás</th>
                  <th className="px-4 py-3 text-right font-medium">Összesen</th>
                </tr>
              </thead>
              <tbody>
                {periodRows.map((r) => (
                  <tr key={r.periodKey} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="px-4 py-3 font-medium text-[var(--color-text)]">{r.periodLabel}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(r.batchCount)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.goodsValueHuf)}</td>
                    <td className="px-4 py-3 text-right text-[var(--color-danger)]">{formatCurrency(r.shippingHuf)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(r.totalHuf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  )
}
