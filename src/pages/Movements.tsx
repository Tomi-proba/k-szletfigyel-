import { CheckCircle2, CircleSlash, ClipboardList, FileSpreadsheet, FileText, PackagePlus, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useStore } from '../store/useStore'
import type { DeleteMovementMode } from '../store/useStore'
import { DeleteChoiceDialog } from '../components/DeleteChoiceDialog'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Modal } from '../components/Modal'
import { PurchaseOrderForm } from '../components/PurchaseOrderForm'
import { SalePrepForm } from '../components/SalePrepForm'
import { ApprovePurchaseOrderModal } from '../components/ApprovePurchaseOrderModal'
import { ApproveSaleModal } from '../components/ApproveSaleModal'
import { ResubmitSaleModal } from '../components/ResubmitSaleModal'
import { Button, Card, Checkbox, EmptyState, Field, FieldGroup, Input, PageHeader, Select, Textarea } from '../components/ui'
import { formatCurrency, formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format'
import { isoDaysAgo, todayISO } from '../lib/dates'
import { exportToExcel, exportToPdf, type ExportColumn } from '../lib/export'
import { lotUnitCost } from '../lib/costing'
import type { Movement, Product, PurchaseLot, SaleStatus } from '../types'

const SALE_STATUS_LABELS: Record<SaleStatus, string> = { pending: 'Kiadásra vár', shipping: 'Kiszállítás alatt', delivered: 'Kézbesítve/átadva' }
const SALE_STATUS_OPTIONS: SaleStatus[] = ['pending', 'shipping', 'delivered']

/** Search/filter values for the sale-status dropdown - a superset of
 * SaleStatus, since a cancelled sale isn't itself a SaleStatus (see
 * Movement.cancelled) but still needs to be searchable as one. */
type SaleStatusFilter = SaleStatus | 'cancelled'
const SALE_STATUS_FILTER_LABELS: Record<SaleStatusFilter, string> = { ...SALE_STATUS_LABELS, cancelled: 'Visszavonva' }
const SALE_STATUS_FILTER_OPTIONS: SaleStatusFilter[] = [...SALE_STATUS_OPTIONS, 'cancelled']

interface MovementRow {
  date: string
  productName: string
  sku: string
  locationName: string
  type: string
  quantity: number
  unit: string
  supplierName: string
  goodsUnitPrice: string
  shippingCost: string
  currency: string
  exchangeRate: string
  unitCost: string
  lotRemaining: string
  vat: string
  customerName: string
  paymentStatus: string
  saleStatus: string
  cancelledInfo: string
  note: string
}

export function Movements() {
  const movements = useStore((s) => s.movements)
  const products = useStore((s) => s.products)
  const locations = useStore((s) => s.locations)
  const customers = useStore((s) => s.customers)
  const suppliers = useStore((s) => s.suppliers)
  const lots = useStore((s) => s.lots)
  const dailyClosings = useStore((s) => s.dailyClosings)
  const deleteMovement = useStore((s) => s.deleteMovement)
  const restoreMovement = useStore((s) => s.restoreMovement)
  const setSaleStatus = useStore((s) => s.setSaleStatus)
  // A `movements`/`locations` tömb már csak a raktáros saját telephelyét
  // tartalmazza (Supabase RLS - lásd supabase/schema.sql), ezért itt nincs
  // szükség külön telephely-szűrésre. Ami maradt: a beszerzési ár/
  // egységköltség/ÁFA és a vevő/fizetési adatok - ezek irodai adatnak
  // számítanak (lásd DOCUMENTATION.md 14. fejezet), ezért raktáros
  // szerepkörben elrejtve maradnak a listából és az exportból is.
  const { isWarehouseUser } = useAuth()

  const [searchParams] = useSearchParams()
  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(todayISO())
  const [productFilter, setProductFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | 'in' | 'out'>(() => {
    const t = searchParams.get('tipus')
    return t === 'in' || t === 'out' ? t : ''
  })
  const [customerFilter, setCustomerFilter] = useState('')
  const [saleStatusFilter, setSaleStatusFilter] = useState<'' | SaleStatusFilter>(() => {
    const s = searchParams.get('statusz')
    return (SALE_STATUS_FILTER_OPTIONS as string[]).includes(s ?? '') ? (s as SaleStatusFilter) : ''
  })
  const [showDeleted, setShowDeleted] = useState(false)
  const [deleting, setDeleting] = useState<Movement | null>(null)
  const [editingVat, setEditingVat] = useState<Movement | null>(null)
  const [cancelling, setCancelling] = useState<Movement | null>(null)
  // Kétlépcsős jóváhagyás (iroda <-> raktár, lásd DOCUMENTATION.md 15.
  // fejezet): az iroda ad le rendelést, a raktáros hagyja jóvá a
  // beérkezést; a raktáros készíti elő a kiszállítást, az iroda hagyja
  // jóvá/utasítja el.
  const [creatingOrder, setCreatingOrder] = useState(false)
  const [creatingSalePrep, setCreatingSalePrep] = useState(false)
  const [approvingPurchase, setApprovingPurchase] = useState<Movement | null>(null)
  const [approvingSale, setApprovingSale] = useState<Movement | null>(null)
  const [resubmitting, setResubmitting] = useState<Movement | null>(null)
  const [deletingPending, setDeletingPending] = useState<Movement | null>(null)

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])
  const lotByMovementId = useMemo(() => new Map(lots.map((l) => [l.movementId, l])), [lots])

  const filtered = useMemo(
    () =>
      movements
        .filter((m) => m.date >= from && m.date <= to)
        .filter((m) => showDeleted || !m.deletedAt)
        .filter((m) => !productFilter || m.productId === productFilter)
        .filter((m) => !typeFilter || m.type === typeFilter)
        .filter((m) => !customerFilter || m.customerId === customerFilter)
        .filter((m) => {
          if (!saleStatusFilter) return true
          // Sale status only exists on kimenő (sale) movements - searching by
          // it should hide bejövő rows entirely, not leave them unfiltered.
          if (m.type !== 'out') return false
          return saleStatusFilter === 'cancelled' ? Boolean(m.cancelled) : !m.cancelled && m.saleStatus === saleStatusFilter
        })
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt))),
    [movements, from, to, productFilter, typeFilter, customerFilter, saleStatusFilter, showDeleted],
  )

  function vatOf(m: Movement): { rate?: number; reclaimable?: boolean } {
    if (m.type === 'out') return { rate: m.vatRatePercent }
    const lot = lotByMovementId.get(m.id)
    return { rate: lot?.vatRatePercent, reclaimable: lot?.vatReclaimable }
  }

  function toRow(m: Movement): MovementRow {
    const product = productById.get(m.productId)
    const vat = vatOf(m)
    const lot = m.type === 'in' ? lotByMovementId.get(m.id) : undefined
    const supplier = product?.supplierId ? supplierById.get(product.supplierId) : undefined
    return {
      date: formatDate(m.date),
      productName: product?.name ?? 'Törölt termék',
      sku: product?.sku ?? '',
      locationName: locationById.get(m.locationId)?.name ?? '',
      type: m.type === 'in' ? 'Bejövő' : 'Kimenő',
      quantity: m.quantity,
      unit: product?.unit ?? '',
      supplierName: m.type === 'in' ? (supplier?.name ?? '') : '',
      goodsUnitPrice: m.type === 'in' && m.unitPrice !== undefined ? String(m.unitPrice) : '',
      shippingCost: m.type === 'in' && m.shippingCost !== undefined ? String(m.shippingCost) : '',
      currency: m.type === 'in' ? (m.currency ?? 'HUF') : '',
      exchangeRate: m.type === 'in' && m.currency && m.currency !== 'HUF' ? String(m.exchangeRate ?? '') : '',
      unitCost: lot ? String(Math.round(lotUnitCost(lot))) : '',
      lotRemaining: lot ? `${formatNumber(lot.remainingQuantity)} / ${formatNumber(lot.quantity)}` : '',
      vat: vat.rate === undefined ? '' : `${vat.rate}%${m.type === 'in' ? (vat.reclaimable === false ? ' (nem visszaig.)' : ' (visszaig.)') : ''}`,
      customerName: m.customerId ? (customerById.get(m.customerId)?.name ?? 'Törölt vevő') : '',
      paymentStatus: m.customerId ? (m.isPaid ? 'Fizetve' : 'Nem fizetett') : '',
      saleStatus: m.type === 'out' ? (m.cancelled ? 'Visszavonva' : m.saleStatus ? SALE_STATUS_LABELS[m.saleStatus] : '') : '',
      cancelledInfo: m.cancelled ? `Visszavonva${m.cancelReason ? ` (${m.cancelReason})` : ''}` : m.deletedAt ? 'Törölve' : '',
      note: m.note ?? '',
    }
  }

  const columns: ExportColumn<MovementRow>[] = [
    { header: 'Dátum', accessor: (r) => r.date, width: 14 },
    { header: 'Termék', accessor: (r) => r.productName, width: 28 },
    { header: 'Cikkszám', accessor: (r) => r.sku, width: 14 },
    ...(locations.length > 1 ? [{ header: 'Telephely', accessor: (r: MovementRow) => r.locationName, width: 18 }] : []),
    { header: 'Típus', accessor: (r) => r.type, width: 10 },
    { header: 'Mennyiség', accessor: (r) => r.quantity, width: 12 },
    { header: 'Egység', accessor: (r) => r.unit, width: 10 },
    ...(isWarehouseUser
      ? []
      : [
          { header: 'Beszállító', accessor: (r: MovementRow) => r.supplierName, width: 22 },
          { header: 'Áru egységára', accessor: (r: MovementRow) => r.goodsUnitPrice, width: 14 },
          { header: 'Szállítási költség', accessor: (r: MovementRow) => r.shippingCost, width: 16 },
          { header: 'Pénznem', accessor: (r: MovementRow) => r.currency, width: 10 },
          { header: 'Árfolyam', accessor: (r: MovementRow) => r.exchangeRate, width: 12 },
          { header: 'Egységköltség (Ft)', accessor: (r: MovementRow) => r.unitCost, width: 16 },
          { header: 'Készleten (tételből)', accessor: (r: MovementRow) => r.lotRemaining, width: 18 },
          { header: 'ÁFA', accessor: (r: MovementRow) => r.vat, width: 16 },
          { header: 'Vevő', accessor: (r: MovementRow) => r.customerName, width: 22 },
          { header: 'Fizetve', accessor: (r: MovementRow) => r.paymentStatus, width: 14 },
        ]),
    { header: 'Eladási státusz', accessor: (r) => r.saleStatus, width: 16 },
    { header: 'Állapot', accessor: (r) => r.cancelledInfo, width: 18 },
    { header: 'Megjegyzés', accessor: (r) => r.note, width: 24 },
  ]

  const rows = filtered.map(toRow)

  return (
    <div>
      <PageHeader
        title="Mozgásnapló"
        subtitle="Összes rögzített bejövő és kimenő készletmozgás - kimenő tételekre eladási státusz és vevő szerint is kereshetsz"
        actions={
          <>
            <Button variant="secondary" onClick={() => exportToExcel(`mozgasnaplo_${from}_${to}.xlsx`, 'Mozgásnapló', columns, rows)}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportToPdf(`mozgasnaplo_${from}_${to}.pdf`, 'Mozgásnapló', columns, rows)}>
              <FileText size={16} /> PDF
            </Button>
            {!isWarehouseUser && (
              <Button onClick={() => setCreatingOrder(true)}>
                <PackagePlus size={16} /> Rendelés leadása
              </Button>
            )}
            {isWarehouseUser && (
              <Button onClick={() => setCreatingSalePrep(true)}>
                <ClipboardList size={16} /> Kiszállítás előkészítése
              </Button>
            )}
          </>
        }
      />

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
            <span className="mb-1 block font-medium text-[var(--color-text)]">Termék</span>
            <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
              <option value="">Összes termék</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Típus</span>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'in' | 'out' | '')}>
              <option value="">Mind</option>
              <option value="in">Bejövő</option>
              <option value="out">Kimenő</option>
            </Select>
          </label>
          {!isWarehouseUser && (
            <label className="text-sm">
              <span className="mb-1 block font-medium text-[var(--color-text)]">Vevő</span>
              <Select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
                <option value="">Összes vevő</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Eladási státusz (csak kimenő)</span>
            <Select value={saleStatusFilter} onChange={(e) => setSaleStatusFilter(e.target.value as '' | SaleStatusFilter)}>
              <option value="">Mind</option>
              {SALE_STATUS_FILTER_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {SALE_STATUS_FILTER_LABELS[s]}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <Checkbox label="Törölt mozgások megjelenítése" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState>Nincs a szűrésnek megfelelő mozgás.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-medium">Dátum</th>
                <th className="px-4 py-3 font-medium">Termék</th>
                {locations.length > 1 && <th className="px-4 py-3 font-medium">Telephely</th>}
                <th className="px-4 py-3 font-medium">Típus</th>
                <th className="px-4 py-3 text-right font-medium">Mennyiség</th>
                {!isWarehouseUser && <th className="px-4 py-3 font-medium">Beszerzés részletei</th>}
                {!isWarehouseUser && <th className="px-4 py-3 font-medium">ÁFA</th>}
                {!isWarehouseUser && <th className="px-4 py-3 font-medium">Vevő</th>}
                <th className="px-4 py-3 font-medium">Eladási státusz</th>
                <th className="px-4 py-3 font-medium">Megjegyzés</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const product = productById.get(m.productId)
                const vat = vatOf(m)
                const isDeleted = Boolean(m.deletedAt)
                const isCancelled = Boolean(m.cancelled)
                const rowMuted = isDeleted || isCancelled
                const isDayClosed = dailyClosings.some((c) => c.locationId === m.locationId && c.date === m.date)
                return (
                  <tr key={m.id} className={`border-b border-[var(--color-border)] last:border-b-0 ${rowMuted ? 'opacity-60' : ''}`}>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDate(m.date)}
                      {isDayClosed && (
                        <span
                          className="ml-1.5 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]"
                          title="Erre a napra ezen a telephelyen már elküldtek napi zárást"
                        >
                          zárva
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className={`font-medium text-[var(--color-text)] ${rowMuted ? 'line-through' : ''}`}>
                        {product?.name ?? 'Törölt termék'}
                      </div>
                      {product?.sku && <div className="text-xs text-[var(--color-text-muted)]">{product.sku}</div>}
                      {m.correctsMovementId && (
                        <div className="text-xs font-medium text-[var(--color-warning)]">Korrekció - #{m.correctsMovementId.slice(0, 8)}</div>
                      )}
                      {m.approvalStatus === 'pending' && (
                        <div className="mt-0.5 inline-block rounded-full bg-[var(--color-warning-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
                          {m.type === 'in' ? 'Beérkezésre vár' : 'Jóváhagyásra vár'}
                        </div>
                      )}
                      {m.approvalStatus === 'rejected' && (
                        <div className="mt-0.5 inline-block rounded-full bg-[var(--color-danger-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-danger)]">
                          Elutasítva{m.rejectReason ? ` - ${m.rejectReason}` : ''}
                        </div>
                      )}
                      {m.discrepancyNote && (
                        <div className="mt-0.5 text-xs text-[var(--color-warning)]">Eltérés: {m.discrepancyNote}</div>
                      )}
                      {isDeleted && <div className="text-xs font-medium text-[var(--color-text-muted)]">Törölve</div>}
                    </td>
                    {locations.length > 1 && <td className="px-4 py-3">{locationById.get(m.locationId)?.name}</td>}
                    <td className="px-4 py-3">
                      <span className={m.type === 'in' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>
                        {m.type === 'in' ? 'Bejövő' : 'Kimenő'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
                      {formatNumber(m.quantity)} {product?.unit}
                    </td>
                    {!isWarehouseUser && (
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {m.type === 'in' ? (
                          (() => {
                            const lot = lotByMovementId.get(m.id)
                            const supplier = product?.supplierId ? supplierById.get(product.supplierId) : undefined
                            return (
                              <div className="space-y-0.5">
                                {supplier && <div className="text-[var(--color-text)]">{supplier.name}</div>}
                                {m.unitPrice !== undefined && (
                                  <div>
                                    Egységár: {formatMoney(m.unitPrice, m.currency ?? 'HUF')}
                                    {m.shippingCost ? ` · Szállítás: ${formatMoney(m.shippingCost, m.currency ?? 'HUF')}` : ''}
                                  </div>
                                )}
                                {m.currency && m.currency !== 'HUF' && <div>Árfolyam: {formatNumber(m.exchangeRate ?? 0)}</div>}
                                {lot && <div>Egységköltség: {formatCurrency(Math.round(lotUnitCost(lot)))}</div>}
                                {lot && (
                                  <div>
                                    Készleten: {formatNumber(lot.remainingQuantity)} / {formatNumber(lot.quantity)} {product?.unit}
                                  </div>
                                )}
                              </div>
                            )
                          })()
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                    )}
                    {!isWarehouseUser && (
                      <td className="whitespace-nowrap px-4 py-3">
                        {vat.rate === undefined ? (
                          <span className="text-[var(--color-text-muted)]">—</span>
                        ) : (
                          <>
                            {vat.rate}%
                            {m.type === 'in' && (
                              <div className={`text-xs ${vat.reclaimable === false ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'}`}>
                                {vat.reclaimable === false ? 'nem visszaig.' : 'visszaig.'}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    )}
                    {!isWarehouseUser && (
                      <td className="px-4 py-3">
                        {m.customerId && (
                          <>
                            <div className="text-[var(--color-text)]">{customerById.get(m.customerId)?.name ?? 'Törölt vevő'}</div>
                            <div className={m.isPaid ? 'text-xs text-[var(--color-success)]' : 'text-xs font-medium text-[var(--color-danger)]'}>
                              {m.isPaid ? 'Fizetve' : 'Nem fizetett'}
                            </div>
                          </>
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3">
                      {m.type !== 'out' || m.approvalStatus === 'pending' || m.approvalStatus === 'rejected' ? (
                        <span className="text-[var(--color-text-muted)]">—</span>
                      ) : isCancelled ? (
                        <div>
                          <span className="rounded-full bg-[var(--color-danger-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--color-danger)]">
                            Visszavonva
                          </span>
                          {m.cancelReason && <div className="mt-1 text-xs text-[var(--color-text-muted)]">{m.cancelReason}</div>}
                        </div>
                      ) : isDeleted ? (
                        <span className="text-[var(--color-text-muted)]">—</span>
                      ) : (
                        <>
                          <Select value={m.saleStatus ?? 'pending'} onChange={(e) => setSaleStatus(m.id, e.target.value as SaleStatus)}>
                            {SALE_STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {SALE_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </Select>
                          {m.saleStatusChangedAt && (
                            <div className="mt-1 text-xs text-[var(--color-text-muted)]">{formatDateTime(m.saleStatusChangedAt)}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{m.note}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {isDeleted ? (
                        <button
                          type="button"
                          onClick={() => restoreMovement(m.id)}
                          aria-label="Mozgás visszaállítása"
                          className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-success)]"
                        >
                          <RotateCcw size={16} />
                        </button>
                      ) : m.approvalStatus === 'pending' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => (m.type === 'in' ? setApprovingPurchase(m) : setApprovingSale(m))}
                            aria-label={m.type === 'in' ? 'Beérkezés jóváhagyása' : 'Kiszállítás jóváhagyása'}
                            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-success)]"
                            title={m.type === 'in' ? 'Beérkezés jóváhagyása' : 'Jóváhagyás / elutasítás'}
                          >
                            <CheckCircle2 size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingPending(m)}
                            aria-label="Tétel törlése"
                            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-danger)]"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      ) : m.approvalStatus === 'rejected' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setResubmitting(m)}
                            aria-label="Javítás és újraküldés"
                            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-primary)]"
                            title="Javítás és újraküldés"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingPending(m)}
                            aria-label="Tétel törlése"
                            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-danger)]"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      ) : isCancelled ? null : (
                        <>
                          {m.type === 'out' && (
                            <button
                              type="button"
                              onClick={() => setCancelling(m)}
                              aria-label="Eladás visszavonása"
                              className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-danger)]"
                              title="Eladás visszavonása"
                            >
                              <CircleSlash size={16} />
                            </button>
                          )}
                          {!isWarehouseUser && (
                            <button
                              type="button"
                              onClick={() => setEditingVat(m)}
                              aria-label="ÁFA szerkesztése"
                              className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5"
                            >
                              <Pencil size={16} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDeleting(m)}
                            aria-label="Mozgás törlése"
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

      {deleting && (
        <DeleteChoiceDialog
          title="Mozgás törlése"
          description={`Hogyan töröljük ezt a mozgást (${productById.get(deleting.productId)?.name ?? 'termék'}, ${deleting.quantity} db)?`}
          correctionOnlyReason={
            dailyClosings.some((c) => c.locationId === deleting.locationId && c.date === deleting.date)
              ? 'Erre a napra ezen a telephelyen már elküldtek napi zárást, ezért a mozgás csak korrekciós tétellel javítható - egyszerű törlés nem választható.'
              : undefined
          }
          onCorrection={() => {
            deleteMovement(deleting.id, 'correction' satisfies DeleteMovementMode)
            setDeleting(null)
          }}
          onSoftDelete={() => {
            deleteMovement(deleting.id, 'soft-delete' satisfies DeleteMovementMode)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}

      {editingVat && <VatEditModal movement={editingVat} lot={lotByMovementId.get(editingVat.id) ?? null} onClose={() => setEditingVat(null)} />}

      {cancelling && <CancelSaleModal movement={cancelling} product={productById.get(cancelling.productId)} onClose={() => setCancelling(null)} />}

      {creatingOrder && (
        <Modal title="Rendelés leadása" onClose={() => setCreatingOrder(false)} wide>
          <PurchaseOrderForm onDone={() => setCreatingOrder(false)} />
        </Modal>
      )}

      {creatingSalePrep && (
        <Modal title="Kiszállítás előkészítése" onClose={() => setCreatingSalePrep(false)}>
          <SalePrepForm onDone={() => setCreatingSalePrep(false)} />
        </Modal>
      )}

      {approvingPurchase && <ApprovePurchaseOrderModal movement={approvingPurchase} onClose={() => setApprovingPurchase(null)} />}

      {approvingSale && <ApproveSaleModal movement={approvingSale} onClose={() => setApprovingSale(null)} />}

      {resubmitting && <ResubmitSaleModal movement={resubmitting} onClose={() => setResubmitting(null)} />}

      {deletingPending && (
        <ConfirmDialog
          title="Tétel törlése"
          message={`Biztosan törlöd ezt a még jóvá nem hagyott tételt (${productById.get(deletingPending.productId)?.name ?? 'termék'}, ${deletingPending.quantity} db)? Mivel még nem érintette a készletet, egyszerű törlés elég.`}
          confirmLabel="Törlés"
          danger
          onConfirm={() => {
            deleteMovement(deletingPending.id, 'soft-delete' satisfies DeleteMovementMode)
            setDeletingPending(null)
          }}
          onCancel={() => setDeletingPending(null)}
        />
      )}
    </div>
  )
}

function CancelSaleModal({ movement, product, onClose }: { movement: Movement; product?: Product; onClose: () => void }) {
  const cancelSale = useStore((s) => s.cancelSale)
  const [reason, setReason] = useState('')
  const [confirmedDelivered, setConfirmedDelivered] = useState(false)
  const [refundNotice, setRefundNotice] = useState(false)

  const isDelivered = movement.saleStatus === 'delivered'

  function doCancel() {
    const result = cancelSale(movement.id, reason)
    if (result.ok && result.wasPaid) {
      setRefundNotice(true)
      return
    }
    onClose()
  }

  if (refundNotice) {
    return (
      <Modal title="Eladás visszavonva" onClose={onClose}>
        <p className="mb-4 rounded-lg bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning)]">
          Az eladás ki volt fizetve - szükséges lehet a visszatérítés kezelése. Ezt a rendszer nem végzi el automatikusan.
        </p>
        <div className="flex justify-end">
          <Button onClick={onClose}>Rendben</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Eladás visszavonása" onClose={onClose}>
      {isDelivered && !confirmedDelivered ? (
        <>
          <p className="mb-4 text-sm font-medium text-[var(--color-danger)]">
            A termék már kézbesítve lett az ügyfélnek - biztosan visszavonod az eladást? Ez valószínűleg egy visszáru/reklamáció esetét jelenti.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Mégse
            </Button>
            <Button variant="danger" onClick={() => setConfirmedDelivered(true)}>
              Igen, folytatom
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-[var(--color-text)]">
            Biztosan visszavonod a(z) "{product?.name ?? 'termék'}" eladást ({movement.quantity} {product?.unit ?? 'db'})? A készlet
            automatikusan visszakerül a raktárba.
          </p>
          <Field label="Indoklás (opcionális)">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="pl. hibás termék, ügyfél lemondta…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Mégse
            </Button>
            <Button variant="danger" onClick={doCancel}>
              Eladás visszavonása
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

function VatEditModal({ movement, lot, onClose }: { movement: Movement; lot: PurchaseLot | null; onClose: () => void }) {
  const updateLotVat = useStore((s) => s.updateLotVat)
  const updateMovementVat = useStore((s) => s.updateMovementVat)

  const currentRate = movement.type === 'out' ? movement.vatRatePercent : lot?.vatRatePercent
  const [rate, setRate] = useState(currentRate !== undefined ? String(currentRate) : '')
  const [reclaimable, setReclaimable] = useState(lot?.vatReclaimable !== false)
  const [error, setError] = useState<string | null>(null)

  const missingLot = movement.type === 'in' && !lot

  function save() {
    setError(null)
    const rateNum = rate.trim() === '' ? undefined : Number(rate.replace(',', '.'))
    if (rateNum !== undefined && (!Number.isFinite(rateNum) || rateNum < 0)) {
      setError('Az ÁFA kulcs nem lehet negatív.')
      return
    }
    if (movement.type === 'out') {
      updateMovementVat(movement.id, rateNum)
    } else if (lot) {
      updateLotVat(lot.id, { vatRatePercent: rateNum, vatReclaimable: reclaimable })
    }
    onClose()
  }

  return (
    <Modal title="ÁFA szerkesztése" onClose={onClose}>
      {missingLot ? (
        <p className="mb-3 text-sm text-[var(--color-text-muted)]">Ehhez a mozgáshoz nem található beszerzési tétel.</p>
      ) : (
        <>
          <Field label="ÁFA kulcs (%, üresen hagyva törlöd a nyomon követést ennél a tételnél)">
            <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="pl. 27" autoFocus />
          </Field>
          {movement.type === 'in' && rate.trim() !== '' && (
            <FieldGroup label="Visszaigényelhető">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReclaimable(true)}
                  className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                    reclaimable
                      ? 'border-[var(--color-success)] bg-[var(--color-success-bg)] text-[var(--color-success)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  Igen
                </button>
                <button
                  type="button"
                  onClick={() => setReclaimable(false)}
                  className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                    !reclaimable
                      ? 'border-[var(--color-danger)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  Nem
                </button>
              </div>
            </FieldGroup>
          )}
          {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {missingLot ? 'Bezárás' : 'Mégse'}
        </Button>
        {!missingLot && <Button onClick={save}>Mentés</Button>}
      </div>
    </Modal>
  )
}
