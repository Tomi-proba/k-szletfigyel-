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
