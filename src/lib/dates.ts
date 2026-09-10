import { differenceInCalendarDays, formatISO, parseISO, subDays } from 'date-fns'

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
