import { ArrowLeftRight, CheckCircle2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAlerts } from '../hooks/useAlerts'
import { useStore } from '../store/useStore'
import { Button, Card, EmptyState, PageHeader, Select } from '../components/ui'
import { formatCurrency, formatDate, formatNumber } from '../lib/format'

type FilterKey = 'alacsony' | 'rendeles' | 'lassan' | 'athelyezes' | 'kifizetetlen' | 'fizetesi'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'alacsony', label: 'Alacsony készlet' },
  { key: 'rendeles', label: 'Rendelési javaslat' },
  { key: 'lassan', label: 'Lassan fogyó' },
  { key: 'athelyezes', label: 'Áthelyezés javasolt' },
  { key: 'kifizetetlen', label: 'Kifizetetlen eladás' },
  { key: 'fizetesi', label: 'Fizetési kötelezettség' },
]

const PAYABLE_WINDOWS = [
  { value: 0, label: 'Csak lejárt / a beállított emlékeztetőn belüli' },
  { value: 7, label: 'Következő 7 napban esedékes' },
  { value: 14, label: 'Következő 14 napban esedékes' },
  { value: 30, label: 'Következő 30 napban esedékes' },
  { value: -1, label: 'Összes, határidő szerint' },
]

export function Alerts() {
  const [searchParams, setSearchParams] = useSearchParams()
  const active = searchParams.get('szuro') as FilterKey | null
  const alerts = useAlerts()
  const setMovementPaid = useStore((s) => s.setMovementPaid)
  const setLotPaid = useStore((s) => s.setLotPaid)
  const setLedgerEntryPaid = useStore((s) => s.setLedgerEntryPaid)
  const [payableWindow, setPayableWindow] = useState(0)

  function setFilter(key: FilterKey | null) {
    if (key) setSearchParams({ szuro: key })
    else setSearchParams({})
  }

  function markPayablePaid(p: (typeof alerts.payables)[number]) {
    if (p.sourceType === 'purchase') setLotPaid(p.id, true)
    else setLedgerEntryPaid(p.id, true)
  }

  const visiblePayables = useMemo(() => {
    if (payableWindow === -1) return alerts.payables
    if (payableWindow === 0) return alerts.urgentPayables
    return alerts.payables.filter((p) => p.daysUntilDue <= payableWindow)
  }, [alerts.payables, alerts.urgentPayables, payableWindow])

  const showAll = !active
  const totalCount =
    alerts.lowStock.length +
    alerts.needsReorder.length +
    alerts.slowMoving.length +
    alerts.transferSuggestions.length +
    alerts.unpaidSales.length +
    alerts.urgentPayables.length

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

        {(showAll || active === 'fizetesi') && (
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[var(--color-text)]">Fizetési kötelezettségek</h2>
              <label className="text-sm">
                <Select value={payableWindow} onChange={(e) => setPayableWindow(Number(e.target.value))} className="text-sm">
                  {PAYABLE_WINDOWS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            {visiblePayables.length === 0 ? (
              <EmptyState>Nincs a szűrésnek megfelelő fizetési kötelezettség.</EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visiblePayables.map((p) => (
                  <Card
                    key={`${p.sourceType}-${p.id}`}
                    className={`border-l-4 ${p.urgency === 'overdue' ? 'border-l-[var(--color-danger)]' : 'border-l-[var(--color-warning)]'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--color-text)]">{p.payee}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          p.urgency === 'overdue'
                            ? 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
                            : 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]'
                        }`}
                      >
                        {p.urgency === 'overdue' ? `${Math.abs(p.daysUntilDue)} napja lejárt` : `${p.daysUntilDue} nap múlva esedékes`}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-[var(--color-text-muted)]">{p.description}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      Határidő: {formatDate(p.dueDate)} · {p.sourceType === 'purchase' ? 'beszerzés' : 'napló tétel'}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className={`text-lg font-bold ${p.urgency === 'overdue' ? 'text-[var(--color-danger)]' : 'text-[var(--color-warning)]'}`}>
                        {formatCurrency(p.amount)}
                      </span>
                      <Button variant="secondary" onClick={() => markPayablePaid(p)}>
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
