import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Currency, LedgerEntry, LedgerEntryType, VatDirection } from '../types'
import { VAT_CATEGORY } from '../types'
import { todayISO } from '../lib/dates'
import { lotUnitCost } from '../lib/costing'
import { formatCurrency } from '../lib/format'
import { Button, Checkbox, Field, FieldGroup, Input, Select, Textarea } from './ui'

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'HUF', label: 'HUF' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
]

const CUSTOM_CATEGORY_SENTINEL = '__custom__'

interface LedgerEntryFormProps {
  entry?: LedgerEntry
  onDone: () => void
}

export function LedgerEntryForm({ entry, onDone }: LedgerEntryFormProps) {
  const addLedgerEntry = useStore((s) => s.addLedgerEntry)
  const updateLedgerEntry = useStore((s) => s.updateLedgerEntry)
  const categories = useStore((s) => s.ledgerCategories)

  const [date, setDate] = useState(entry?.date ?? todayISO())
  const [type, setType] = useState<LedgerEntryType>(entry?.type ?? 'expense')
  const [categorySelect, setCategorySelect] = useState(entry?.category ?? categories[0] ?? CUSTOM_CATEGORY_SENTINEL)
  const [customCategory, setCustomCategory] = useState('')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [amount, setAmount] = useState(String(entry?.amount ?? ''))
  const [currency, setCurrency] = useState<Currency>(entry?.currency ?? 'HUF')
  const [exchangeRate, setExchangeRate] = useState(entry?.currency && entry.currency !== 'HUF' ? String(entry.exchangeRate) : '')
  const [note, setNote] = useState(entry?.note ?? '')
  const [vatRatePercent, setVatRatePercent] = useState(String(entry?.vatRatePercent ?? 27))
  const [vatDirection, setVatDirection] = useState<VatDirection>(entry?.vatDirection ?? 'payable')
  const [trackDueDate, setTrackDueDate] = useState(Boolean(entry?.dueDate))
  const [dueDate, setDueDate] = useState(entry?.dueDate ?? '')
  const [obligationPaid, setObligationPaid] = useState(entry?.isPaid ?? false)
  const [paidDate, setPaidDate] = useState(entry?.paidDate ?? todayISO())
  const [error, setError] = useState<string | null>(null)

  const isCustomCategory = categorySelect === CUSTOM_CATEGORY_SENTINEL
  const effectiveCategory = isCustomCategory ? customCategory.trim() : categorySelect
  const isVat = effectiveCategory === VAT_CATEGORY

  const amountNumber = amount.trim() === '' ? NaN : Number(amount.replace(',', '.'))
  const exchangeRateNumber = exchangeRate.trim() === '' ? undefined : Number(exchangeRate.replace(',', '.'))
  const previewHuf =
    Number.isFinite(amountNumber) && (currency === 'HUF' || (exchangeRateNumber ?? 0) > 0)
      ? lotUnitCost({ unitPrice: amountNumber, shippingCost: 0, quantity: 1, exchangeRate: currency === 'HUF' ? 1 : (exchangeRateNumber ?? 0) })
      : null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!effectiveCategory) return setError(isCustomCategory ? 'Add meg az új kategória nevét.' : 'Válassz kategóriát.')
    if (!description.trim()) return setError('A megnevezést kötelező megadni.')
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return setError('Az összegnek pozitív számnak kell lennie.')
    if (currency !== 'HUF' && (!Number.isFinite(exchangeRateNumber) || (exchangeRateNumber ?? 0) <= 0)) {
      return setError('Add meg az árfolyamot (1 egység hány forint).')
    }
    const vatRateNumber = Number(vatRatePercent)
    if (isVat && (!Number.isFinite(vatRateNumber) || vatRateNumber < 0)) {
      return setError('Az ÁFA kulcsa nem lehet negatív.')
    }
    const trackingDueDate = type === 'expense' && trackDueDate
    if (trackingDueDate && !dueDate) {
      return setError('Add meg a fizetési határidőt, vagy kapcsold ki a nyomon követést.')
    }

    const payload = {
      date,
      type,
      category: effectiveCategory,
      description: description.trim(),
      amount: amountNumber,
      currency,
      exchangeRate: currency === 'HUF' ? 1 : (exchangeRateNumber as number),
      note: note.trim() || undefined,
      vatRatePercent: isVat ? vatRateNumber : undefined,
      vatDirection: isVat ? vatDirection : undefined,
      dueDate: trackingDueDate ? dueDate : undefined,
      isPaid: trackingDueDate ? obligationPaid : undefined,
      paidDate: trackingDueDate && obligationPaid ? paidDate : undefined,
    }

    if (entry) updateLedgerEntry(entry.id, payload)
    else addLedgerEntry(payload)
    onDone()
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup label="Típus">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setType('income')}
            className={`rounded-lg border py-3 text-sm font-semibold transition-colors ${
              type === 'income'
                ? 'border-[var(--color-success)] bg-[var(--color-success-bg)] text-[var(--color-success)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
            }`}
          >
            Bevétel
          </button>
          <button
            type="button"
            onClick={() => setType('expense')}
            className={`rounded-lg border py-3 text-sm font-semibold transition-colors ${
              type === 'expense'
                ? 'border-[var(--color-danger)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
            }`}
          >
            Kiadás
          </button>
        </div>
      </FieldGroup>

      <Field label="Kategória">
        <Select value={categorySelect} onChange={(e) => setCategorySelect(e.target.value)} required>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={CUSTOM_CATEGORY_SENTINEL}>Egyéb (új kategória megadása)…</option>
        </Select>
      </Field>

      {isCustomCategory && (
        <Field label="Új kategória neve">
          <Input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="pl. irodaszer, marketing…" required autoFocus />
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            Ez mentés után megjelenik a kategórialistában, legközelebb választható lesz.
          </span>
        </Field>
      )}

      <Field label="Megnevezés / leírás">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder='pl. "2026. szeptemberi bérleti díj"' required />
      </Field>

      <FieldGroup label="Összeg">
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

        <div className={`grid ${currency !== 'HUF' ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Összeg ({currency})</span>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" required />
          </label>
          {currency !== 'HUF' && (
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium text-[var(--color-text)]">Árfolyam (1 {currency} = ? Ft)</span>
              <Input inputMode="decimal" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="pl. 390" required />
            </label>
          )}
        </div>

        {previewHuf !== null && currency !== 'HUF' && (
          <div className="mb-1 rounded-lg bg-[var(--color-info-bg)] px-3 py-2 text-sm text-[var(--color-primary)]">
            ≈ {formatCurrency(previewHuf)}
          </div>
        )}
      </FieldGroup>

      {isVat && (
        <FieldGroup label="ÁFA részletek">
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--color-text)]">ÁFA kulcsa (%)</span>
              <Input type="number" min={0} max={100} value={vatRatePercent} onChange={(e) => setVatRatePercent(e.target.value)} />
            </label>
            <div>
              <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">Irány</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVatDirection('payable')}
                  className={`rounded-lg border py-2 text-xs font-semibold transition-colors ${
                    vatDirection === 'payable'
                      ? 'border-[var(--color-danger)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  Befizetendő
                </button>
                <button
                  type="button"
                  onClick={() => setVatDirection('reclaimable')}
                  className={`rounded-lg border py-2 text-xs font-semibold transition-colors ${
                    vatDirection === 'reclaimable'
                      ? 'border-[var(--color-success)] bg-[var(--color-success-bg)] text-[var(--color-success)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  Visszaigényelhető
                </button>
              </div>
            </div>
          </div>
        </FieldGroup>
      )}

      {type === 'expense' && (
        <FieldGroup label="Fizetési határidő (kimenő kötelezettség)">
          <Checkbox
            label="Fizetési határidő nyomon követése"
            checked={trackDueDate}
            onChange={(e) => {
              setTrackDueDate(e.target.checked)
              if (!e.target.checked) {
                setDueDate('')
                setObligationPaid(false)
              }
            }}
          />
          {trackDueDate && (
            <div className="rounded-lg border border-[var(--color-border)] p-3">
              <label className="mb-3 block text-sm">
                <span className="mb-1 block font-medium text-[var(--color-text)]">Fizetési határidő</span>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
              <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">Fizetési állapot</span>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setObligationPaid(true)}
                  className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                    obligationPaid
                      ? 'border-[var(--color-success)] bg-[var(--color-success-bg)] text-[var(--color-success)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  Kifizetve
                </button>
                <button
                  type="button"
                  onClick={() => setObligationPaid(false)}
                  className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                    !obligationPaid
                      ? 'border-[var(--color-danger)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  Még nincs kifizetve
                </button>
              </div>
              {obligationPaid && (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-[var(--color-text)]">Fizetés dátuma</span>
                  <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
                </label>
              )}
            </div>
          )}
        </FieldGroup>
      )}

      <Field label="Dátum">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>

      <Field label="Megjegyzés (opcionális)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Mégse
        </Button>
        <Button type="submit">{entry ? 'Mentés' : 'Létrehozás'}</Button>
      </div>
    </form>
  )
}
