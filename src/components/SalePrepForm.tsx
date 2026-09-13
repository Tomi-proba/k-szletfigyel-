// "Kiszállítás előkészítése" - a raktáros oldali első lépése a kétlépcsős
// értékesítési jóváhagyásnak (lásd DOCUMENTATION.md 15. fejezet):
// szándékosan csak terméket/mennyiséget/vevőt vesz fel - ár, ÁFA és
// fizetési adat az iroda dolga jóváhagyáskor (ApproveSaleModal), a
// készletet ez a lépés még nem csökkenti.
import { useState } from 'react'
import { useStore } from '../store/useStore'
import { ProductPicker } from './ProductPicker'
import { Button, Field, FieldGroup, Select, Textarea, Input } from './ui'
import { todayISO } from '../lib/dates'

export function SalePrepForm({ onDone }: { onDone?: () => void }) {
  const createPendingSalePrep = useStore((s) => s.createPendingSalePrep)
  const customers = useStore((s) => s.customers)

  const [productId, setProductId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState('')
  const [date] = useState(todayISO())
  const [customerId, setCustomerId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [successTick, setSuccessTick] = useState(0)

  const qtyNumber = Number(quantity.replace(',', '.'))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!productId) return setError('Válassz terméket.')
    if (!quantity || !Number.isFinite(qtyNumber) || qtyNumber <= 0) return setError('A mennyiségnek pozitív számnak kell lennie.')

    const result = createPendingSalePrep({ productId, quantity: qtyNumber, date, customerId: customerId || undefined, note })
    if (!result.ok) return setError('A kiszállítás nem rögzíthető.')

    setProductId(null)
    setQuantity('')
    setCustomerId('')
    setNote('')
    setSuccessTick((t) => t + 1)
    onDone?.()
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup label="Termék">
        <ProductPicker value={productId} onChange={setProductId} />
      </FieldGroup>

      <Field label="Mennyiség">
        <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
      </Field>

      {customers.length > 0 && (
        <Field label="Vevő (opcionális - üresen hagyva sima eladás)">
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

      <Field label="Megjegyzés (opcionális)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="pl. csomagolási igény…" />
      </Field>

      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        A kiszállítás csak "jóváhagyásra váró" tételként kerül rögzítésre - a készlet csak akkor csökken, amikor az iroda jóváhagyja.
      </p>

      {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
      {successTick > 0 && !error && <p className="mb-3 text-sm text-[var(--color-success)]">Kiszállítás előkészítve.</p>}

      <Button type="submit" className="w-full py-3 text-base">
        Kiszállítás előkészítése
      </Button>
    </form>
  )
}
