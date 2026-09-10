import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { MovementType } from '../types'
import { todayISO } from '../lib/dates'
import { ProductPicker } from './ProductPicker'
import { ConfirmDialog } from './ConfirmDialog'
import { Button, Field, FieldGroup, Input, Textarea } from './ui'

interface MovementFormProps {
  onDone?: () => void
  defaultProductId?: string | null
}

export function MovementForm({ onDone, defaultProductId = null }: MovementFormProps) {
  const recordMovement = useStore((s) => s.recordMovement)
  const products = useStore((s) => s.products)

  const [productId, setProductId] = useState<string | null>(defaultProductId)
  const [type, setType] = useState<MovementType>('out')
  const [quantity, setQuantity] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [successTick, setSuccessTick] = useState(0)
  const [pendingNegative, setPendingNegative] = useState<{ resultingStock: number } | null>(null)

  const product = products.find((p) => p.id === productId) ?? null
  const qtyNumber = Number(quantity.replace(',', '.'))

  function step(delta: number) {
    const current = Number.isFinite(qtyNumber) ? qtyNumber : 0
    const next = Math.max(0, current + delta)
    setQuantity(String(Math.round(next * 100) / 100))
  }

  function trySubmit(allowNegativeStock = false) {
    setError(null)
    if (!productId) {
      setError('Válassz terméket.')
      return
    }
    if (!quantity || !Number.isFinite(qtyNumber) || qtyNumber <= 0) {
      setError('A mennyiségnek pozitív számnak kell lennie.')
      return
    }
    if (!date) {
      setError('Add meg a dátumot.')
      return
    }

    const result = recordMovement({ productId, type, quantity: qtyNumber, date, note }, { allowNegativeStock })
    if (result.ok) {
      setPendingNegative(null)
      setQuantity('')
      setNote('')
      setSuccessTick((t) => t + 1)
      onDone?.()
      return
    }

    if (result.reason === 'insufficient-stock') {
      setPendingNegative({ resultingStock: result.resultingStock ?? 0 })
      return
    }
    setError('A mozgás nem menthető.')
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        trySubmit(false)
      }}
    >
      <FieldGroup label="Termék">
        <ProductPicker value={productId} onChange={setProductId} />
      </FieldGroup>

      <FieldGroup label="Típus">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setType('in')}
            className={`rounded-lg border py-3 text-sm font-semibold transition-colors ${
              type === 'in'
                ? 'border-[var(--color-success)] bg-[var(--color-success-bg)] text-[var(--color-success)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
            }`}
          >
            Bejövő
          </button>
          <button
            type="button"
            onClick={() => setType('out')}
            className={`rounded-lg border py-3 text-sm font-semibold transition-colors ${
              type === 'out'
                ? 'border-[var(--color-danger)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
            }`}
          >
            Kimenő
          </button>
        </div>
      </FieldGroup>

      <FieldGroup label={`Mennyiség${product ? ` (${product.unit})` : ''}`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Csökkentés"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-black/5"
          >
            <Minus size={18} />
          </button>
          <Input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
            className="text-center text-lg"
          />
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Növelés"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-black/5"
          >
            <Plus size={18} />
          </button>
        </div>
      </FieldGroup>

      <Field label="Dátum">
        <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <Field label="Megjegyzés (opcionális)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="pl. leltári korrekció, sérült áru…" />
      </Field>

      {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
      {successTick > 0 && !error && <p className="mb-3 text-sm text-[var(--color-success)]">Mozgás rögzítve.</p>}

      <Button type="submit" className="w-full py-3 text-base">
        Mentés
      </Button>

      {pendingNegative && (
        <ConfirmDialog
          title="Negatív készlet"
          message={`Ez a mozgás ${Math.abs(pendingNegative.resultingStock)} ${product?.unit ?? ''} hiányba vinné a készletet (${pendingNegative.resultingStock}). Biztosan rögzíted?`}
          confirmLabel="Igen, rögzítem"
          danger
          onConfirm={() => trySubmit(true)}
          onCancel={() => setPendingNegative(null)}
        />
      )}
    </form>
  )
}
