// "Rendelés leadása" - az iroda oldali első lépése a kétlépcsős beszerzési
// jóváhagyásnak (lásd DOCUMENTATION.md 15. fejezet): csak egy FÜGGŐBEN LÉVŐ
// tételt hoz létre, a készletet/FIFO-tételt még nem érinti - azt majd a
// raktáros hozza létre, amikor jóváhagyja a tényleges beérkezést
// (ApprovePurchaseOrderModal).
import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Currency } from '../types'
import { ProductPicker } from './ProductPicker'
import { Button, Field, FieldGroup, Input, Textarea } from './ui'
import { todayISO } from '../lib/dates'

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'HUF', label: 'HUF' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
]

export function PurchaseOrderForm({ onDone }: { onDone?: () => void }) {
  const createPendingPurchaseOrder = useStore((s) => s.createPendingPurchaseOrder)
  const products = useStore((s) => s.products)

  const [productId, setProductId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState('')
  const [date, setDate] = useState(todayISO())
  const [unitPrice, setUnitPrice] = useState('')
  const [shippingCost, setShippingCost] = useState('')
  const [currency, setCurrency] = useState<Currency>('HUF')
  const [exchangeRate, setExchangeRate] = useState('')
  const [vatRate, setVatRate] = useState(() => {
    const p = products.find((pr) => pr.id === productId)
    return p?.defaultVatRatePercent !== undefined ? String(p.defaultVatRatePercent) : ''
  })
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [successTick, setSuccessTick] = useState(0)

  const product = products.find((p) => p.id === productId) ?? null
  const qtyNumber = Number(quantity.replace(',', '.'))
  const unitPriceNumber = unitPrice.trim() === '' ? undefined : Number(unitPrice.replace(',', '.'))
  const shippingCostNumber = shippingCost.trim() === '' ? undefined : Number(shippingCost.replace(',', '.'))
  const exchangeRateNumber = exchangeRate.trim() === '' ? undefined : Number(exchangeRate.replace(',', '.'))
  const vatRateNumber = vatRate.trim() === '' ? undefined : Number(vatRate.replace(',', '.'))

  function handleProductChange(nextId: string | null) {
    setProductId(nextId)
    const p = products.find((pr) => pr.id === nextId)
    setVatRate(p?.defaultVatRatePercent !== undefined ? String(p.defaultVatRatePercent) : '')
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!productId) return setError('Válassz terméket.')
    if (!quantity || !Number.isFinite(qtyNumber) || qtyNumber <= 0) return setError('A mennyiségnek pozitív számnak kell lennie.')
    if (!date) return setError('Add meg a dátumot.')
    if (unitPrice.trim() !== '' && (!Number.isFinite(unitPriceNumber) || (unitPriceNumber ?? 0) < 0)) {
      return setError('A várható egységár nem lehet negatív.')
    }
    if (currency !== 'HUF' && unitPrice.trim() !== '' && (!Number.isFinite(exchangeRateNumber) || (exchangeRateNumber ?? 0) <= 0)) {
      return setError('Add meg a várható árfolyamot (1 egység hány forint).')
    }

    const result = createPendingPurchaseOrder({
      productId,
      quantity: qtyNumber,
      date,
      note,
      unitPrice: unitPriceNumber,
      shippingCost: shippingCostNumber,
      currency: unitPrice.trim() !== '' ? currency : undefined,
      exchangeRate: unitPrice.trim() !== '' && currency !== 'HUF' ? exchangeRateNumber : undefined,
      vatRatePercent: vatRateNumber,
    })
    if (!result.ok) return setError('A rendelés nem rögzíthető.')

    setProductId(null)
    setQuantity('')
    setUnitPrice('')
    setShippingCost('')
    setCurrency('HUF')
    setExchangeRate('')
    setVatRate('')
    setNote('')
    setSuccessTick((t) => t + 1)
    onDone?.()
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup label="Termék">
        <ProductPicker value={productId} onChange={handleProductChange} />
      </FieldGroup>

      <Field label={`Rendelt mennyiség${product ? ` (${product.unit})` : ''}`}>
        <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
      </Field>

      <Field label="Várható beérkezés dátuma">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <FieldGroup label="Várható ár (opcionális)">
        <div className="mb-3 grid grid-cols-3 gap-2">
          {CURRENCIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCurrency(c.value)}
              className={`rounded-lg border py-2 text-sm font-semibold transition-colors ${
                currency === c.value
                  ? 'border-[var(--color-primary)] bg-[var(--color-info-bg)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Várható egységár ({currency})</span>
            <Input inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0" />
          </label>
          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Várható szállítási költség ({currency})</span>
            <Input inputMode="decimal" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} placeholder="0" />
          </label>
        </div>
        {currency !== 'HUF' && (
          <label className="mb-1 block text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Várható árfolyam (1 {currency} = ? Ft)</span>
            <Input inputMode="decimal" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="pl. 390" />
          </label>
        )}
      </FieldGroup>

      <Field label="ÁFA kulcs (%, opcionális)">
        <Input inputMode="decimal" value={vatRate} onChange={(e) => setVatRate(e.target.value)} placeholder="pl. 27" />
      </Field>

      <Field label="Megjegyzés (opcionális)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="pl. várható beszállító neve…" />
      </Field>

      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        A rendelés csak "beérkezésre váró" tételként kerül rögzítésre - a készlet csak akkor nő, amikor a raktáros jóváhagyja a tényleges
        beérkezést.
      </p>

      {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
      {successTick > 0 && !error && <p className="mb-3 text-sm text-[var(--color-success)]">Rendelés leadva.</p>}

      <Button type="submit" className="w-full py-3 text-base">
        Rendelés leadása
      </Button>
    </form>
  )
}
