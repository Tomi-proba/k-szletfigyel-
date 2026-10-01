// Ismétlődő (havonta visszatérő) napló tétel űrlapja - pl. bérleti díj,
// előfizetés, hiteltörlesztés: "minden hónap ekkor ennyi összeg". Maga az
// űrlap csak a SABLONT hozza létre/módosítja - a tényleges havi
// LedgerEntry-ket a generateDueRecurringLedgerEntries hozza létre
// automatikusan (lásd store/useStore.ts), amikor esedékessé válnak.
import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Currency, LedgerEntryType, RecurringLedgerEntry } from '../types'
import { todayISO } from '../lib/dates'
import { HistoryPanel } from './HistoryPanel'
import { Button, Checkbox, Field, FieldGroup, Input, Select, Textarea } from './ui'

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'HUF', label: 'HUF' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
]

const CUSTOM_CATEGORY_SENTINEL = '__custom__'

interface RecurringLedgerEntryFormProps {
  entry?: RecurringLedgerEntry
  onDone: () => void
}

export function RecurringLedgerEntryForm({ entry, onDone }: RecurringLedgerEntryFormProps) {
  const addRecurringLedgerEntry = useStore((s) => s.addRecurringLedgerEntry)
  const updateRecurringLedgerEntry = useStore((s) => s.updateRecurringLedgerEntry)
  const categories = useStore((s) => s.ledgerCategories)

  const [type, setType] = useState<LedgerEntryType>(entry?.type ?? 'expense')
  const [categorySelect, setCategorySelect] = useState(entry?.category ?? categories[0] ?? CUSTOM_CATEGORY_SENTINEL)
  const [customCategory, setCustomCategory] = useState('')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [amount, setAmount] = useState(String(entry?.amount ?? ''))
  const [currency, setCurrency] = useState<Currency>(entry?.currency ?? 'HUF')
  const [exchangeRate, setExchangeRate] = useState(entry?.currency && entry.currency !== 'HUF' ? String(entry.exchangeRate) : '')
  const [note, setNote] = useState(entry?.note ?? '')
  const [dayOfMonth, setDayOfMonth] = useState(String(entry?.dayOfMonth ?? 1))
  const [startDate, setStartDate] = useState(entry?.startDate ?? todayISO())
  const [hasEndDate, setHasEndDate] = useState(Boolean(entry?.endDate))
  const [endDate, setEndDate] = useState(entry?.endDate ?? '')
  const [active, setActive] = useState(entry?.active ?? true)
  const [error, setError] = useState<string | null>(null)

  const isCustomCategory = categorySelect === CUSTOM_CATEGORY_SENTINEL
  const effectiveCategory = isCustomCategory ? customCategory.trim() : categorySelect

  const amountNumber = amount.trim() === '' ? NaN : Number(amount.replace(',', '.'))
  const exchangeRateNumber = exchangeRate.trim() === '' ? undefined : Number(exchangeRate.replace(',', '.'))
  const dayOfMonthNumber = Number(dayOfMonth)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!effectiveCategory) return setError(isCustomCategory ? 'Add meg az új kategória nevét.' : 'Válassz kategóriát.')
    if (!description.trim()) return setError('A megnevezést kötelező megadni.')
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return setError('Az összegnek pozitív számnak kell lennie.')
    if (currency !== 'HUF' && (!Number.isFinite(exchangeRateNumber) || (exchangeRateNumber ?? 0) <= 0)) {
      return setError('Add meg az árfolyamot (1 egység hány forint).')
    }
    if (!Number.isInteger(dayOfMonthNumber) || dayOfMonthNumber < 1 || dayOfMonthNumber > 31) {
      return setError('A hónap napjának 1 és 31 között kell lennie.')
    }
    if (!startDate) return setError('Add meg, mely hónaptól induljon.')
    if (hasEndDate && !endDate) return setError('Add meg az utolsó napot, vagy kapcsold ki a végdátumot.')
    if (hasEndDate && endDate < startDate) return setError('A végdátum nem lehet korábbi, mint a kezdő dátum.')

    const payload = {
      type,
      category: effectiveCategory,
      description: description.trim(),
      amount: amountNumber,
      currency,
      exchangeRate: currency === 'HUF' ? 1 : (exchangeRateNumber as number),
      note: note.trim() || undefined,
      dayOfMonth: dayOfMonthNumber,
      startDate,
      endDate: hasEndDate ? endDate : undefined,
      active,
    }

    if (entry) updateRecurringLedgerEntry(entry.id, payload)
    else addRecurringLedgerEntry(payload)
    onDone()
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="mb-4 text-xs text-[var(--color-text-muted)]">
        Minden hónap megadott napján automatikusan létrejön belőle egy normál napló tétel - ugyanazzal az összeggel, kategóriával és leírással. A
        legenerált tételek utólag külön-külön szabadon szerkeszthetők vagy törölhetők, ez a sablon csak az ismétlődést vezérli.
      </p>

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
          <Input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="pl. bérleti díj, előfizetés…" required autoFocus />
        </Field>
      )}

      <Field label="Megnevezés / leírás">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder='pl. "Havi irodabérlet"' required />
      </Field>

      <FieldGroup label="Összeg (havonta)">
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
      </FieldGroup>

      <FieldGroup label="Ismétlődés">
        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-[var(--color-text)]">A hónap hányadik napján</span>
          <Input type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} required />
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            Rövidebb hónapban (pl. február) az adott hónap utolsó napján könyvelődik.
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Kezdő hónap</span>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </label>
          <div>
            <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">Vég (opcionális)</span>
            <Checkbox
              label="Van utolsó nap"
              checked={hasEndDate}
              onChange={(e) => {
                setHasEndDate(e.target.checked)
                if (!e.target.checked) setEndDate('')
              }}
            />
          </div>
        </div>
        {hasEndDate && (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Utolsó nap, ameddig fut</span>
            <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
          </label>
        )}
      </FieldGroup>

      <FieldGroup label="Állapot">
        <Checkbox label="Aktív (a megadott napokon automatikusan könyvelődik)" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </FieldGroup>

      <Field label="Megjegyzés (opcionális)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {entry && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Előzmények</h3>
          <HistoryPanel entityType="recurringLedgerEntry" entityId={entry.id} />
        </div>
      )}

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
