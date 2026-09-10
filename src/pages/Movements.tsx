import { FileSpreadsheet, FileText, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Modal } from '../components/Modal'
import { Button, Card, EmptyState, Field, FieldGroup, Input, PageHeader, Select } from '../components/ui'
import { formatDate, formatNumber } from '../lib/format'
import { isoDaysAgo, todayISO } from '../lib/dates'
import { exportToExcel, exportToPdf, type ExportColumn } from '../lib/export'
import type { Movement, PurchaseLot } from '../types'

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
  note: string
}

export function Movements() {
  const movements = useStore((s) => s.movements)
  const products = useStore((s) => s.products)
  const locations = useStore((s) => s.locations)
  const customers = useStore((s) => s.customers)
  const lots = useStore((s) => s.lots)
  const deleteMovement = useStore((s) => s.deleteMovement)

  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(todayISO())
  const [productFilter, setProductFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | 'in' | 'out'>('')
  const [deleting, setDeleting] = useState<Movement | null>(null)
  const [editingVat, setEditingVat] = useState<Movement | null>(null)

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const lotByMovementId = useMemo(() => new Map(lots.map((l) => [l.movementId, l])), [lots])

  const filtered = useMemo(
    () =>
      movements
        .filter((m) => m.date >= from && m.date <= to)
        .filter((p) => !productFilter || p.productId === productFilter)
        .filter((p) => !typeFilter || p.type === typeFilter)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt))),
    [movements, from, to, productFilter, typeFilter],
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
      </Card>

      {filtered.length === 0 ? (
        <EmptyState>Nincs a szűrésnek megfelelő mozgás.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-medium">Dátum</th>
                <th className="px-4 py-3 font-medium">Termék</th>
                {locations.length > 1 && <th className="px-4 py-3 font-medium">Telephely</th>}
                <th className="px-4 py-3 font-medium">Típus</th>
                <th className="px-4 py-3 text-right font-medium">Mennyiség</th>
                <th className="px-4 py-3 font-medium">ÁFA</th>
                <th className="px-4 py-3 font-medium">Vevő</th>
                <th className="px-4 py-3 font-medium">Megjegyzés</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const product = productById.get(m.productId)
                const vat = vatOf(m)
                return (
                  <tr key={m.id} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-3">{formatDate(m.date)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-text)]">{product?.name ?? 'Törölt termék'}</div>
                      {product?.sku && <div className="text-xs text-[var(--color-text-muted)]">{product.sku}</div>}
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
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{m.note}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {deleting && (
        <ConfirmDialog
          title="Mozgás törlése"
          message="Biztosan törlöd ezt a mozgást? A készlet visszaáll az eredeti értékre."
          confirmLabel="Törlés"
          danger
          onConfirm={() => {
            deleteMovement(deleting.id)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}

      {editingVat && <VatEditModal movement={editingVat} lot={lotByMovementId.get(editingVat.id) ?? null} onClose={() => setEditingVat(null)} />}
    </div>
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
