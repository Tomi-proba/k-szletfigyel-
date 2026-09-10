import { CircleSlash, FileSpreadsheet, FileText, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore'
import type { DeleteMovementMode } from '../store/useStore'
import { DeleteChoiceDialog } from '../components/DeleteChoiceDialog'
import { Modal } from '../components/Modal'
import { Button, Card, Checkbox, EmptyState, Field, FieldGroup, Input, PageHeader, Select, Textarea } from '../components/ui'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'
import { isoDaysAgo, todayISO } from '../lib/dates'
import { exportToExcel, exportToPdf, type ExportColumn } from '../lib/export'
import type { Movement, Product, PurchaseLot, SaleStatus } from '../types'

const SALE_STATUS_LABELS: Record<SaleStatus, string> = { pending: 'Kiadásra vár', shipping: 'Kiszállítás alatt', delivered: 'Kézbesítve/átadva' }
const SALE_STATUS_OPTIONS: SaleStatus[] = ['pending', 'shipping', 'delivered']

interface MovementRow {
  date: string
  productName: string
  sku: string
  locationName: string
  type: string
  quantity: number
  unit: string
  goodsUnitPrice: string
  shippingCost: string
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
  const lots = useStore((s) => s.lots)
  const deleteMovement = useStore((s) => s.deleteMovement)
  const restoreMovement = useStore((s) => s.restoreMovement)
  const setSaleStatus = useStore((s) => s.setSaleStatus)

  const [searchParams] = useSearchParams()
  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(todayISO())
  const [productFilter, setProductFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | 'in' | 'out'>(() => {
    const t = searchParams.get('tipus')
    return t === 'in' || t === 'out' ? t : ''
  })
  const [showDeleted, setShowDeleted] = useState(false)
  const [deleting, setDeleting] = useState<Movement | null>(null)
  const [editingVat, setEditingVat] = useState<Movement | null>(null)
  const [cancelling, setCancelling] = useState<Movement | null>(null)

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const lotByMovementId = useMemo(() => new Map(lots.map((l) => [l.movementId, l])), [lots])

  const filtered = useMemo(
    () =>
      movements
        .filter((m) => m.date >= from && m.date <= to)
        .filter((m) => showDeleted || !m.deletedAt)
        .filter((p) => !productFilter || p.productId === productFilter)
        .filter((p) => !typeFilter || p.type === typeFilter)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt))),
    [movements, from, to, productFilter, typeFilter, showDeleted],
  )

  function vatOf(m: Movement): { rate?: number; reclaimable?: boolean } {
    if (m.type === 'out') return { rate: m.vatRatePercent }
    const lot = lotByMovementId.get(m.id)
    return { rate: lot?.vatRatePercent, reclaimable: lot?.vatReclaimable }
  }

  function toRow(m: Movement): MovementRow {
    const product = productById.get(m.productId)
    const vat = vatOf(m)
    return {
      date: formatDate(m.date),
      productName: product?.name ?? 'Törölt termék',
      sku: product?.sku ?? '',
      locationName: locationById.get(m.locationId)?.name ?? '',
      type: m.type === 'in' ? 'Bejövő' : 'Kimenő',
      quantity: m.quantity,
      unit: product?.unit ?? '',
      goodsUnitPrice: m.type === 'in' && m.unitPrice !== undefined ? String(m.unitPrice) : '',
      shippingCost: m.type === 'in' && m.shippingCost !== undefined ? String(m.shippingCost) : '',
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
    { header: 'Áru egységára', accessor: (r) => r.goodsUnitPrice, width: 14 },
    { header: 'Szállítási költség', accessor: (r) => r.shippingCost, width: 16 },
    { header: 'ÁFA', accessor: (r) => r.vat, width: 16 },
    { header: 'Vevő', accessor: (r) => r.customerName, width: 22 },
    { header: 'Fizetve', accessor: (r) => r.paymentStatus, width: 14 },
    { header: 'Eladási státusz', accessor: (r) => r.saleStatus, width: 16 },
    { header: 'Állapot', accessor: (r) => r.cancelledInfo, width: 18 },
    { header: 'Megjegyzés', accessor: (r) => r.note, width: 24 },
  ]

  const rows = filtered.map(toRow)

  return (
    <div>
      <PageHeader
        title="Mozgásnapló"
        subtitle="Összes rögzített bejövő és kimenő készletmozgás"
        actions={
          <>
            <Button variant="secondary" onClick={() => exportToExcel(`mozgasnaplo_${from}_${to}.xlsx`, 'Mozgásnapló', columns, rows)}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportToPdf(`mozgasnaplo_${from}_${to}.pdf`, 'Mozgásnapló', columns, rows)}>
              <FileText size={16} /> PDF
            </Button>
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
        </div>
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <Checkbox label="Törölt mozgások megjelenítése" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState>Nincs a szűrésnek megfelelő mozgás.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-medium">Dátum</th>
                <th className="px-4 py-3 font-medium">Termék</th>
                {locations.length > 1 && <th className="px-4 py-3 font-medium">Telephely</th>}
                <th className="px-4 py-3 font-medium">Típus</th>
                <th className="px-4 py-3 text-right font-medium">Mennyiség</th>
                <th className="px-4 py-3 font-medium">ÁFA</th>
                <th className="px-4 py-3 font-medium">Vevő</th>
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
                return (
                  <tr key={m.id} className={`border-b border-[var(--color-border)] last:border-b-0 ${rowMuted ? 'opacity-60' : ''}`}>
                    <td className="whitespace-nowrap px-4 py-3">{formatDate(m.date)}</td>
                    <td className="px-4 py-3">
                      <div className={`font-medium text-[var(--color-text)] ${rowMuted ? 'line-through' : ''}`}>
                        {product?.name ?? 'Törölt termék'}
                      </div>
                      {product?.sku && <div className="text-xs text-[var(--color-text-muted)]">{product.sku}</div>}
                      {m.correctsMovementId && (
                        <div className="text-xs font-medium text-[var(--color-warning)]">Korrekció - #{m.correctsMovementId.slice(0, 8)}</div>
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
                    <td className="whitespace-nowrap px-4 py-3">
                      {m.type !== 'out' ? (
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
                          <button
                            type="button"
                            onClick={() => setEditingVat(m)}
                            aria-label="ÁFA szerkesztése"
                            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5"
                          >
                            <Pencil size={16} />
                          </button>
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
