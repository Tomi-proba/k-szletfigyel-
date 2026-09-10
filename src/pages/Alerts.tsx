import { ArrowLeftRight, CheckCircle2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAlerts } from '../hooks/useAlerts'
import { useStore } from '../store/useStore'
import { Button, Card, EmptyState, PageHeader } from '../components/ui'
import { formatCurrency, formatDate, formatNumber } from '../lib/format'

type FilterKey = 'alacsony' | 'rendeles' | 'lassan' | 'athelyezes' | 'kifizetetlen'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'alacsony', label: 'Alacsony készlet' },
  { key: 'rendeles', label: 'Rendelési javaslat' },
  { key: 'lassan', label: 'Lassan fogyó' },
  { key: 'athelyezes', label: 'Áthelyezés javasolt' },
  { key: 'kifizetetlen', label: 'Kifizetetlen eladás' },
]

export function Alerts() {
  const [searchParams, setSearchParams] = useSearchParams()
  const active = searchParams.get('szuro') as FilterKey | null
  const alerts = useAlerts()
  const setMovementPaid = useStore((s) => s.setMovementPaid)

  function setFilter(key: FilterKey | null) {
    if (key) setSearchParams({ szuro: key })
    else setSearchParams({})
  }

  const showAll = !active
  const totalCount =
    alerts.lowStock.length + alerts.needsReorder.length + alerts.slowMoving.length + alerts.transferSuggestions.length + alerts.unpaidSales.length

  return (
    <div>
      <PageHeader title="Riasztások" subtitle={`${totalCount} figyelmeztetés jelenleg`} />

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter(null)}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            showAll ? 'bg-[var(--color-primary)] text-white' : 'bg-black/5 text-[var(--color-text)] hover:bg-black/10'
          }`}
        >
          Összes
        </button>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              active === f.key ? 'bg-[var(--color-primary)] text-white' : 'bg-black/5 text-[var(--color-text)] hover:bg-black/10'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {(showAll || active === 'alacsony') && (
          <section>
            <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">Alacsony készlet</h2>
            {alerts.lowStock.length === 0 ? (
              <EmptyState>Nincs alacsony készletű termék.</EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {alerts.lowStock.map(({ product }) => (
                  <Card key={product.id} className="border-l-4 border-l-[var(--color-danger)]">
                    <div className="font-semibold text-[var(--color-text)]">{product.name}</div>
                    <div className="mt-1 text-sm text-[var(--color-text-muted)]">
                      Készleten: <b className="text-[var(--color-danger)]">{formatNumber(product.currentStock)}</b> {product.unit} (min:{' '}
                      {formatNumber(product.minStock)} {product.unit})
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}

        {(showAll || active === 'rendeles') && (
          <section>
            <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">Rendelési javaslat</h2>
            {alerts.needsReorder.length === 0 ? (
              <EmptyState>Jelenleg nincs sürgős rendelési teendő.</EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {alerts.needsReorder.map(({ product, insight }) => (
                  <Card key={product.id} className={insight.reorderUrgent ? 'border-l-4 border-l-[var(--color-danger)]' : 'border-l-4 border-l-[var(--color-warning)]'}>
                    <div className="font-semibold text-[var(--color-text)]">{product.name}</div>
                    <div className="mt-1 text-sm text-[var(--color-text-muted)]">
                      Napi átlagos fogyás: {formatNumber(insight.avgDailyConsumption)} {product.unit}
                    </div>
                    <div className="text-sm text-[var(--color-text-muted)]">
                      {insight.daysUntilStockout !== null
                        ? `Kb. ${formatNumber(insight.daysUntilStockout)} nap múlva fogy ki`
                        : 'Alacsony készlet a minimum szint alapján'}
                    </div>
                    <div className="mt-2 rounded-lg bg-[var(--color-info-bg)] px-3 py-2 text-sm font-medium text-[var(--color-primary)]">
                      Javasolt rendelés: +{formatNumber(insight.suggestedOrderQty)} {product.unit}
                    </div>
                    {insight.seasonalNote && <div className="mt-2 text-xs italic text-[var(--color-text-muted)]">{insight.seasonalNote}</div>}
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}

        {(showAll || active === 'lassan') && (
          <section>
            <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">Lassan fogyó / felesleges tőkelekötés</h2>
            {alerts.slowMoving.length === 0 ? (
              <EmptyState>Nincs lassan fogyó termék.</EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {alerts.slowMoving.map(({ product, slowMoving }) => (
                  <Card key={product.id} className="border-l-4 border-l-[var(--color-warning)]">
                    <div className="font-semibold text-[var(--color-text)]">{product.name}</div>
                    <div className="mt-1 text-sm text-[var(--color-text-muted)]">
                      Készleten: {formatNumber(product.currentStock)} {product.unit} ·{' '}
                      {formatNumber(product.currentStock * product.purchasePrice)} Ft lekötve
                    </div>
                    <div className="text-sm text-[var(--color-text-muted)]">
                      {slowMoving.currentPeriodQty === 0
                        ? 'Nem volt kimenő mozgás a vizsgált időszakban'
                        : `${slowMoving.dropPercent !== null ? Math.round(slowMoving.dropPercent) : '?'}%-kal esett vissza a fogyás`}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}

        {(showAll || active === 'athelyezes') && (
          <section>
            <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">Áthelyezés javasolt</h2>
            {alerts.transferSuggestions.length === 0 ? (
              <EmptyState>Nincs áthelyezésre javasolt tétel.</EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {alerts.transferSuggestions.map((t, i) => (
                  <Card key={`${t.productKey}-${i}`} className="border-l-4 border-l-[var(--color-primary)]">
                    <div className="font-semibold text-[var(--color-text)]">{t.productName}</div>
                    <div className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text)]">
                      <span>{t.fromLocationName}</span>
                      <ArrowLeftRight size={16} className="text-[var(--color-primary)]" />
                      <span>{t.toLocationName}</span>
                    </div>
                    <div className="mt-1 text-sm text-[var(--color-text-muted)]">
                      Javasolt mennyiség: {formatNumber(t.quantity)} {t.unit}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}

        {(showAll || active === 'kifizetetlen') && (
          <section>
            <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">Kifizetetlen eladások</h2>
            {alerts.unpaidSales.length === 0 ? (
              <EmptyState>Nincs kifizetetlen eladás.</EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {alerts.unpaidSales.map((sale) => (
                  <Card key={sale.movementId} className="border-l-4 border-l-[var(--color-danger)]">
                    <div className="font-semibold text-[var(--color-text)]">{sale.customerName}</div>
                    <div className="mt-1 text-sm text-[var(--color-text-muted)]">
                      {formatDate(sale.date)} · {sale.productName} · {formatNumber(sale.quantity)} {sale.unit}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-lg font-bold text-[var(--color-danger)]">{formatCurrency(sale.amount)}</span>
                      <Button variant="secondary" onClick={() => setMovementPaid(sale.movementId, true)}>
                        <CheckCircle2 size={16} /> Kifizetve
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
