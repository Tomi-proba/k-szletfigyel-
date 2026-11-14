import { differenceInCalendarDays, endOfMonth, endOfQuarter, formatISO, parseISO, startOfMonth, startOfQuarter, subDays } from 'date-fns'

export function todayISO(): string {
  return formatISO(new Date(), { representation: 'date' })
}

export function isoDaysAgo(days: number, from: Date = new Date()): string {
  return formatISO(subDays(from, days), { representation: 'date' })
}

export function daysBetween(fromISO: string, toISO: string): number {
  return differenceInCalendarDays(parseISO(toISO), parseISO(fromISO))
}

export function parseDate(iso: string): Date {
  return parseISO(iso)
}

export function currentMonthRange(): { from: string; to: string } {
  const now = new Date()
  return { from: formatISO(startOfMonth(now), { representation: 'date' }), to: formatISO(endOfMonth(now), { representation: 'date' }) }
}

export function currentQuarterRange(): { from: string; to: string } {
  const now = new Date()
  return { from: formatISO(startOfQuarter(now), { representation: 'date' }), to: formatISO(endOfQuarter(now), { representation: 'date' }) }
}

/** Az ISO dátum + n nap (F30: fizetési határidő a partner határidejéből). */
export function isoPlusDays(iso: string, days: number): string {
  const d = parseISO(iso)
  d.setDate(d.getDate() + days)
  return formatISO(d, { representation: 'date' })
}

/** A partner határidejéből számolt fizetési határidő; undefined, ha a partnernek nincs határideje. */
export function hataridoNapbol(datum: string, napok: number | undefined | null): string | undefined {
  return napok === undefined || napok === null ? undefined : isoPlusDays(datum, napok)
}

/** A fizetési határidő szövege: „N nap múlva esedékes”, „ma esedékes”, „N napja lejárt”. */
export function hataridoSzoveg(datum: string, ma = todayISO()): string {
  const nap = daysBetween(ma, datum)
  if (nap < 0) return `${-nap} napja lejárt`
  if (nap === 0) return 'ma esedékes'
  return `${nap} nap múlva esedékes`
}
