import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Currency, MovementType } from '../types'
import { todayISO } from '../lib/dates'
import { lotUnitCost } from '../lib/costing'
import { formatCurrency } from '../lib/format'
import { ProductPicker } from './ProductPicker'
import { ConfirmDialog } from './ConfirmDialog'
import { Button, Checkbox, Field, FieldGroup, Input, Select, Textarea } from './ui'

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'HUF', label: 'HUF' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
]

interface MovementFormProps {
  onDone?: () => void
  defaultProductId?: string | null
}

export function MovementForm({ onDone, defaultProductId = null }: MovementFormProps) {
  const recordMovement = useStore((s) => s.recordMovement)
  const products = useStore((s) => s.products)
  const customers = useStore((s) => s.customers)

  const [productId, setProductId] = useState<string | null>(defaultProductId)
  const [type, setType] = useState<MovementType>('out')
  const [quantity, setQuantity] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [shippingCost, setShippingCost] = useState('')
  const [currency, setCurrency] = useState<Currency>('HUF')
  const [exchangeRate, setExchangeRate] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [trackCustomer, setTrackCustomer] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [isPaid, setIsPaid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successTick, setSuccessTick] = useState(0)
  const [pendingNegative, setPendingNegative] = useState<{ resultingStock: number } | null>(null)

  const product = products.find((p) => p.id === productId) ?? null
  const qtyNumber = Number(quantity.replace(',', '.'))
  const unitPriceNumber = unitPrice.trim() === '' ? undefined : Number(unitPrice.replace(',', '.'))
  const shippingCostNumber = shippingCost.trim() === '' ? undefined : Number(shippingCost.replace(',', '.'))
  const exchangeRateNumber = exchangeRate.trim() === '' ? undefined : Number(exchangeRate.replace(',', '.'))
  const previewHufUnitCost =
    unitPriceNumber !== undefined && qtyNumber > 0 && (currency === 'HUF' || (exchangeRateNumber ?? 0) > 0)
      ? lotUnitCost({
          unitPrice: unitPriceNumber,
          shippingCost: shippingCostNumber ?? 0,
          quantity: qtyNumber,
          exchangeRate: currency === 'HUF' ? 1 : (exchangeRateNumber ?? 0),
        })
      : null

  function step(delta: number) {
    const current = Number.isFinite(qtyNumber) ? qtyNumber : 0
    const next = Math.max(0, current + delta)
    setQuantity(String(Math.round(next * 100) / 100))
  }

  function resetCustomerSection() {
    setTrackCustomer(false)
    setCustomerId('')
    setIsPaid(true)
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
    if (unitPrice.trim() !== '' && (!Number.isFinite(unitPriceNumber) || (unitPriceNumber ?? 0) < 0)) {
      setError('A beszerzési ár nem lehet negatív.')
      return
    }
    if (shippingCost.trim() !== '' && (!Number.isFinite(shippingCostNumber) || (shippingCostNumber ?? 0) < 0)) {
      setError('A szállítási költség nem lehet negatív.')
      return
    }
    if (type === 'in' && unitPrice.trim() !== '' && currency !== 'HUF' && (!Number.isFinite(exchangeRateNumber) || (exchangeRateNumber ?? 0) <= 0)) {
      setError('Add meg az árfolyamot (1 egység hány forint).')
      return
    }
    if (type === 'out' && trackCustomer && !customerId) {
      setError('Válassz vevőt, vagy kapcsold ki a vevőhöz rögzítést.')
      return
    }

    const result = recordMovement(
      {
        productId,
        type,
        quantity: qtyNumber,
        date,
        note,
        unitPrice: type === 'in' ? unitPriceNumber : undefined,
        shippingCost: type === 'in' ? shippingCostNumber : undefined,
        currency: type === 'in' && unitPrice.trim() !== '' ? currency : undefined,
        exchangeRate: type === 'in' && unitPrice.trim() !== '' && currency !== 'HUF' ? exchangeRateNumber : undefined,
        customerId: type === 'out' && trackCustomer ? customerId : undefined,
        isPaid: type === 'out' && trackCustomer ? isPaid : undefined,
      },
      { allowNegativeStock },
    )
    if (result.ok) {
      setPendingNegative(null)
      setQuantity('')
      setUnitPrice('')
      setShippingCost('')
      setCurrency('HUF')
      setExchangeRate('')
      setNote('')
      resetCustomerSection()
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

      {type === 'in' && (
        <FieldGroup label="Beszerzési ár (opcionális)">
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
              <span className="mb-1 block font-medium text-[var(--color-text)]">Áru egységára ({currency}, opcionális)</span>
              <Input
                inputMode="decimal"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder={product && currency === 'HUF' ? String(product.purchasePrice) : '0'}
              />
            </label>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium text-[var(--color-text)]">Szállítási költség ({currency}, opcionális)</span>
              <Input inputMode="decimal" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} placeholder="0" />
            </label>
          </div>

          {currency !== 'HUF' && (
            <label className="mb-1 block text-sm">
              <span className="mb-1 block font-medium text-[var(--color-text)]">Árfolyam (1 {currency} = ? Ft)</span>
              <Input inputMode="decimal" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="pl. 390" />
            </label>
          )}

          <span className="block text-xs text-[var(--color-text-muted)]">
            A szállítás a teljes tételre összesen értendő, nem darabonként - elkülönítve kerül nyilvántartásba az áru árától. Üresen
            hagyva az ár mezőt, a jelenlegi beszerzési ár marad érvényben.
          </span>
          {previewHufUnitCost !== null && (
            <div className="mt-2 rounded-lg bg-[var(--color-info-bg)] px-3 py-2 text-sm text-[var(--color-primary)]">
              ≈ {formatCurrency(previewHufUnitCost)} / {product?.unit ?? 'egység'} (Ft-ban, a megadott árfolyammal)
            </div>
          )}
        </FieldGroup>
      )}

      {type === 'out' && (
        <FieldGroup label="Vevő">
          <Checkbox
            label="Nem sima eladás - vevőhöz rögzítem"
            checked={trackCustomer}
            onChange={(e) => {
              setTrackCustomer(e.target.checked)
              if (!e.target.checked) {
                setCustomerId('')
                setIsPaid(true)
              }
            }}
          />
          {trackCustomer && (
            <div className="rounded-lg border border-[var(--color-border)] p-3">
              <label className="mb-3 block text-sm">
                <span className="mb-1 block font-medium text-[var(--color-text)]">Vevő kiválasztása</span>
                <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Válassz vevőt…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                {customers.length === 0 && (
                  <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                    Még nincs rögzített vevő - vedd fel a Vevők oldalon.
                  </span>
                )}
              </label>
              <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">Fizetési állapot</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsPaid(true)}
                  className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                    isPaid
                      ? 'border-[var(--color-success)] bg-[var(--color-success-bg)] text-[var(--color-success)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  Fizetve
                </button>
                <button
                  type="button"
                  onClick={() => setIsPaid(false)}
                  className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                    !isPaid
                      ? 'border-[var(--color-danger)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  Még nem fizetett
                </button>
              </div>
            </div>
          )}
        </FieldGroup>
      )}

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
