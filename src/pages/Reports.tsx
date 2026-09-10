import { FileSpreadsheet, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { computeMarginReport } from '../lib/alerts'
import { Button, Card, EmptyState, Input, PageHeader } from '../components/ui'
import { formatCurrency, formatNumber } from '../lib/format'
import { isoDaysAgo, todayISO } from '../lib/dates'
import { exportToExcel, exportToPdf, type ExportColumn } from '../lib/export'

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

export function Reports() {
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
      <PageHeader
        title="Haszonkulcs kimutatás"
        subtitle="Termékenkénti árrés-bevétel a kiválasztott időszakban"
        actions={
          <>
            <Button variant="secondary" onClick={() => exportToExcel(`haszonkulcs_${from}_${to}.xlsx`, 'Haszonkulcs', columns, rows)}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportToPdf(`haszonkulcs_${from}_${to}.pdf`, 'Haszonkulcs kimutatás', columns, rows)}>
              <FileText size={16} /> PDF
            </Button>
          </>
        }
      />

      <Card className="mb-5">
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
