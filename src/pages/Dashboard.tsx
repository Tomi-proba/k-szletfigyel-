import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardX,
  PackageMinus,
  Truck,
  TrendingDown,
  XCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAlerts } from '../hooks/useAlerts'
import { useAuth } from '../hooks/useAuth'
import { useStore } from '../store/useStore'
import { MovementForm } from '../components/MovementForm'
import { Card, PageHeader } from '../components/ui'
import { formatCurrency, formatNumber } from '../lib/format'

function SummaryCard({
  to,
  icon: Icon,
  label,
  count,
  tone,
}: {
  to: string
  icon: typeof AlertTriangle
  label: string
  count: number
  tone: 'danger' | 'warning' | 'info'
}) {
  const toneClasses = {
    danger: 'text-[var(--color-danger)] bg-[var(--color-danger-bg)]',
    warning: 'text-[var(--color-warning)] bg-[var(--color-warning-bg)]',
    info: 'text-[var(--color-primary)] bg-[var(--color-info-bg)]',
  }[tone]

  return (
    <Link to={to} className="block">
      <Card className="flex items-center gap-4 transition-shadow hover:shadow-md">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${toneClasses}`}>
          <Icon size={22} />
        </div>
        <div>
          <div className="text-2xl font-bold text-[var(--color-text)]">{count}</div>
          <div className="text-sm text-[var(--color-text-muted)]">{label}</div>
        </div>
      </Card>
    </Link>
  )
}

export function Dashboard() {
  const alerts = useAlerts()
  const products = useStore((s) => s.products)
  const locations = useStore((s) => s.locations)
  // A raktáros dashboardja a "leegyszerűsített, csak a saját raktárára
  // fókuszáló kezdőoldal" (DOCUMENTATION.md 14. fejezet) - a
  // készletszintekhez kötődő riasztások (`products`/`movements` már csak a
  // saját telephelyét tartalmazza az RLS miatt) megmaradnak, de a
  // vevő/fizetés-jellegű kártyák (kifizetetlen eladás, fizetési
  // kötelezettség, nyitott eladás) irodai adatnak számítanak, ezért rejtve
  // maradnak.
  const { isWarehouseUser } = useAuth()

  const urgent = alerts.needsReorder
    .filter((a) => a.insight.reorderUrgent)
    .sort((a, b) => (a.insight.daysUntilStockout ?? Infinity) - (b.insight.daysUntilStockout ?? Infinity))
    .slice(0, 5)

  const totalUnpaid = alerts.unpaidSales.reduce((sum, s) => sum + s.amount, 0)
  const totalPayable = alerts.urgentPayables.reduce((sum, p) => sum + p.amount, 0)

  return (
    <div>
      <PageHeader title="Kezdőlap" subtitle={`${products.length} termék, ${locations.length} telephely nyilvántartva`} />

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">Gyors mozgásrögzítés</h2>
          <MovementForm />
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <SummaryCard to="/riasztasok?szuro=alacsony" icon={PackageMinus} label="Alacsony készlet" count={alerts.lowStock.length} tone="danger" />
            <SummaryCard to="/riasztasok?szuro=rendeles" icon={AlertTriangle} label="Rendelendő" count={alerts.needsReorder.length} tone="warning" />
            <SummaryCard to="/riasztasok?szuro=lassan" icon={TrendingDown} label="Lassan fogyó" count={alerts.slowMoving.length} tone="info" />
            {!isWarehouseUser && (
              <SummaryCard
                to="/riasztasok?szuro=kifizetetlen"
                icon={CircleDollarSign}
                label={alerts.unpaidSales.length === 0 ? 'Kifizetetlen eladás' : `Kifizetetlen: ${formatCurrency(totalUnpaid)}`}
                count={alerts.unpaidSales.length}
                tone="danger"
              />
            )}
            {!isWarehouseUser && (
              <SummaryCard
                to="/riasztasok?szuro=fizetesi"
                icon={CalendarClock}
                label={alerts.urgentPayables.length === 0 ? 'Fizetési kötelezettség' : `Fizetendő: ${formatCurrency(totalPayable)}`}
                count={alerts.urgentPayables.length}
                tone="warning"
              />
            )}
            {!isWarehouseUser && (
              <SummaryCard to="/riasztasok?szuro=nyitott" icon={Truck} label="Nyitott eladás" count={alerts.openSales.length} tone="info" />
            )}
            <SummaryCard
              to="/riasztasok?szuro=hianyzo-zaras"
              icon={ClipboardX}
              label="Hiányzó napi zárás"
              count={alerts.missingClosings.length}
              tone="danger"
            />
          </div>

          {(isWarehouseUser ? alerts.pendingPurchaseApprovals.length + alerts.rejectedSales.length : alerts.pendingSaleApprovals.length) > 0 && (
            <Card>
              <div className="mb-2 flex items-center gap-2 text-[var(--color-text)]">
                <ClipboardCheck size={18} className="text-[var(--color-warning)]" />
                <h2 className="text-base font-semibold">Jóváhagyásra váró tételek</h2>
              </div>
              <ul className="divide-y divide-[var(--color-border)] text-sm">
                {isWarehouseUser ? (
                  <>
                    {alerts.pendingPurchaseApprovals.length > 0 && (
                      <li className="flex items-center justify-between py-2">
                        <span>{alerts.pendingPurchaseApprovals.length} beérkezésre váró rendelés</span>
                        <Link to="/mozgasnaplo?tipus=in" className="font-medium text-[var(--color-primary)] hover:underline">
                          Megnyitás
                        </Link>
                      </li>
                    )}
                    {alerts.rejectedSales.length > 0 && (
                      <li className="flex items-center justify-between py-2">
                        <span className="flex items-center gap-1.5 text-[var(--color-danger)]">
                          <XCircle size={14} /> {alerts.rejectedSales.length} elutasított kiszállítás javításra vár
                        </span>
                        <Link to="/mozgasnaplo?tipus=out" className="font-medium text-[var(--color-primary)] hover:underline">
                          Megnyitás
                        </Link>
                      </li>
                    )}
                  </>
                ) : (
                  <li className="flex items-center justify-between py-2">
                    <span>{alerts.pendingSaleApprovals.length} jóváhagyásra váró kiszállítás</span>
                    <Link to="/mozgasnaplo?tipus=out" className="font-medium text-[var(--color-primary)] hover:underline">
                      Megnyitás
                    </Link>
                  </li>
                )}
              </ul>
            </Card>
          )}

          {alerts.transferSuggestions.length > 0 && (
            <Card>
              <div className="mb-2 flex items-center gap-2 text-[var(--color-text)]">
                <ArrowLeftRight size={18} className="text-[var(--color-primary)]" />
                <h2 className="text-base font-semibold">Áthelyezés javasolt</h2>
              </div>
              <p className="text-sm text-[var(--color-text-muted)]">
                {alerts.transferSuggestions.length} termék esetében másik telephelyről történő áthelyezés olcsóbb lenne rendelésnél.{' '}
                <Link to="/riasztasok?szuro=athelyezes" className="font-medium text-[var(--color-primary)] hover:underline">
                  Részletek
                </Link>
              </p>
            </Card>
          )}

          <Card>
            <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">Legsürgősebb rendelések</h2>
            {urgent.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Nincs sürgős rendelési teendő.</p>}
            <ul className="divide-y divide-[var(--color-border)]">
              {urgent.map(({ product, insight }) => (
                <li key={product.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <div className="font-medium text-[var(--color-text)]">{product.name}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {insight.daysUntilStockout !== null
                        ? `~${formatNumber(insight.daysUntilStockout)} nap múlva fogy ki`
                        : 'Alacsony készlet'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-[var(--color-text)]">
                      +{formatNumber(insight.suggestedOrderQty)} {product.unit}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">javasolt rendelés</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
