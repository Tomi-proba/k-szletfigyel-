// A raktáros itt javítja ki és küldi újra jóváhagyásra az iroda által
// elutasított kiszállítást (lásd DOCUMENTATION.md 15. fejezet) - ugyanaz a
// mozgás marad, csak a mennyiség/vevő/megjegyzés módosítható, és az
// állapot visszaáll "jóváhagyásra vár"-ra.
import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Movement } from '../types'
import { Modal } from './Modal'
import { Button, Field, Select, Textarea, Input } from './ui'

export function ResubmitSaleModal({ movement, onClose }: { movement: Movement; onClose: () => void }) {
  const resubmitPendingMovement = useStore((s) => s.resubmitPendingMovement)
  const products = useStore((s) => s.products)
  const customers = useStore((s) => s.customers)
  const product = products.find((p) => p.id === movement.productId)

  const [quantity, setQuantity] = useState(String(movement.quantity))
  const [customerId, setCustomerId] = useState(movement.customerId ?? '')
  const [note, setNote] = useState(movement.note ?? '')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    const qtyNumber = Number(quantity.replace(',', '.'))
    if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) return setError('A mennyiségnek pozitív számnak kell lennie.')
    const result = resubmitPendingMovement(movement.id, { quantity: qtyNumber, customerId: customerId || undefined, note })
    if (!result.ok) return setError('A javítás nem sikerült.')
    onClose()
  }

  return (
    <Modal title="Kiszállítás javítása és újraküldése" onClose={onClose}>
      {movement.rejectReason && (
        <p className="mb-4 rounded-lg bg-[var(--color-danger-bg)] p-3 text-sm text-[var(--color-danger)]">
          Az iroda elutasította: {movement.rejectReason}
        </p>
      )}
      <Field label={`Mennyiség${product ? ` (${product.unit})` : ''}`}>
        <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
      </Field>
      {customers.length > 0 && (
        <Field label="Vevő (opcionális)">
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Nincs (sima eladás)</option>
            {customers
              .filter((c) => !c.deletedAt)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </Field>
      )}
      <Field label="Megjegyzés">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Mégse
        </Button>
        <Button onClick={submit}>Újraküldés jóváhagyásra</Button>
      </div>
    </Modal>
  )
}
