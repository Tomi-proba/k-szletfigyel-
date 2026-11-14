// Az eladás fizetési határideje (AWEBOLDAL TERV.md F30): a vevő határidejéből; lejártan pirossal.
import { daysBetween, hataridoSzoveg, todayISO } from '../lib/dates'
import { formatDate } from '../lib/format'

export function HataridoJelzes({ hatarido }: { hatarido: string | null }) {
  if (!hatarido) return <div className="text-xs text-[var(--color-text-muted)]">Nincs fizetési határidő</div>
  const lejart = daysBetween(todayISO(), hatarido) < 0
  return (
    <div className={`text-xs ${lejart ? 'font-semibold text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'}`} data-hatarido={hatarido}>
      Határidő: {formatDate(hatarido)} · {hataridoSzoveg(hatarido)}
    </div>
  )
}
