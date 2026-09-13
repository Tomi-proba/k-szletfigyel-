// Napi zárás (daily closing) business logic - building a location's daily
// movement summary and detecting locations that missed a closing. Pure
// functions over plain data, same pattern as the rest of lib/.
import type { DailyClosing, DailyClosingProductRow, Location, Movement, Product } from '../types'
import { daysBetween, isoDaysAgo, todayISO } from './dates'

/** A movement counts toward a closing only while it's neither soft-deleted
 * nor a cancelled (stornó'd) sale, and not still awaiting/refused approval
 * (see MovementApprovalStatus) - mirrors isActiveMovement in lib/alerts.ts. */
function isActiveMovement(m: Movement): boolean {
  return !m.deletedAt && !m.cancelled && m.approvalStatus !== 'pending' && m.approvalStatus !== 'rejected'
}

export interface DailyClosingSummary {
  inCount: number
  outCount: number
  productBreakdown: DailyClosingProductRow[]
  movementIds: string[]
}

/** Every active movement for one location on one calendar day, bundled into
 * the shape a DailyClosing stores - shared by the submit action and by the
 * "előnézet" the user sees before actually submitting. */
export function buildDailyClosingSummary(movements: Movement[], products: Product[], locationId: string, date: string): DailyClosingSummary {
  const productById = new Map(products.map((p) => [p.id, p]))
  const dayMovements = movements.filter((m) => m.locationId === locationId && m.date === date && isActiveMovement(m))

  const byProduct = new Map<string, DailyClosingProductRow>()
  let inCount = 0
  let outCount = 0
  for (const m of dayMovements) {
    if (m.type === 'in') inCount += 1
    else outCount += 1
    const product = productById.get(m.productId)
    const row = byProduct.get(m.productId) ?? {
      productId: m.productId,
      productName: product?.name ?? 'Törölt termék',
      unit: product?.unit ?? '',
      inQuantity: 0,
      outQuantity: 0,
    }
    if (m.type === 'in') row.inQuantity += m.quantity
    else row.outQuantity += m.quantity
    byProduct.set(m.productId, row)
  }

  return {
    inCount,
    outCount,
    productBreakdown: Array.from(byProduct.values()).sort((a, b) => a.productName.localeCompare(b.productName, 'hu')),
    movementIds: dayMovements.map((m) => m.id),
  }
}

/** How many calendar days of history to scan for missing closings - bounded
 * so a location's very early (pre-tracking) days don't permanently spam the
 * alert list. */
const MISSING_CLOSING_LOOKBACK_DAYS = 30

export interface MissingClosingAlert {
  locationId: string
  locationName: string
  date: string
  /** How many days ago that calendar day was, relative to today. */
  daysOverdue: number
}

/** Every (location, day) pair that had at least one active movement but
 * never got a submitted closing, within the lookback window and past the
 * configured grace period. A day with zero movements needs no closing - see
 * DOCUMENTATION.md for why that's the deliberate reading of "missing". */
export function computeMissingClosings(
  locations: Location[],
  movements: Movement[],
  closings: DailyClosing[],
  graceDays: number,
  today: string = todayISO(),
): MissingClosingAlert[] {
  const activeLocations = locations.filter((l) => !l.deletedAt)
  const cutoff = isoDaysAgo(MISSING_CLOSING_LOOKBACK_DAYS, new Date(today))
  const alerts: MissingClosingAlert[] = []

  for (const location of activeLocations) {
    const daysWithActivity = new Set(
      movements
        .filter((m) => m.locationId === location.id && isActiveMovement(m) && m.date >= cutoff && m.date < today)
        .map((m) => m.date),
    )
    for (const date of daysWithActivity) {
      const hasClosing = closings.some((c) => c.locationId === location.id && c.date === date)
      if (hasClosing) continue
      const daysOverdue = daysBetween(date, today)
      if (daysOverdue > graceDays) {
        alerts.push({ locationId: location.id, locationName: location.name, date, daysOverdue })
      }
    }
  }

  return alerts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.locationName.localeCompare(b.locationName, 'hu')))
}
