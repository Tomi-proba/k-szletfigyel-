// Central business logic for stock alerting. Kept as pure functions over
// plain data so it can be unit tested and reused (e.g. in reports/exports)
// without depending on the zustand store or React.
import { differenceInCalendarDays, formatISO, subYears } from 'date-fns'
import type { Location, Movement, Product, Settings, Supplier } from '../types'
import { isoDaysAgo, todayISO } from './dates'

/** A calendar month difference is "significant" for the seasonality note at this threshold. */
const SEASONALITY_NOTE_THRESHOLD_PERCENT = 30
/** Minimum months of history required before comparing to the same month last year. */
const SEASONALITY_MIN_HISTORY_MONTHS = 12

export type StockStatus = 'normal' | 'low' | 'slow-moving'

export interface ProductInsight {
  productId: string
  avgDailyConsumption: number
  daysUntilStockout: number | null // null = no consumption trend, can't estimate
  isLowStock: boolean
  needsReorder: boolean
  reorderUrgent: boolean
  suggestedOrderQty: number
  seasonalNote: string | null
}

export interface SlowMovingResult {
  productId: string
  currentPeriodQty: number
  previousPeriodQty: number
  dropPercent: number | null // null when previous period had no consumption either
  isSlowMoving: boolean
}

export interface TransferSuggestion {
  productKey: string
  productName: string
  fromLocationId: string
  fromLocationName: string
  toLocationId: string
  toLocationName: string
  quantity: number
  unit: string
}

export interface MarginReportRow {
  productId: string
  productName: string
  sku?: string
  quantitySold: number
  revenue: number
  cost: number
  margin: number
  marginPercent: number
}

function sumMovementQty(movements: Movement[], productId: string, type: 'in' | 'out', fromISO: string, toISO: string): number {
  return movements
    .filter((m) => m.productId === productId && m.type === type && m.date >= fromISO && m.date <= toISO)
    .reduce((sum, m) => sum + m.quantity, 0)
}

export function productKeyOf(product: Pick<Product, 'sku' | 'name'>): string {
  return (product.sku?.trim() || product.name.trim()).toLowerCase()
}

/** Average daily consumption over the last `windowDays` days (inclusive of today). */
export function getAvgDailyConsumption(movements: Movement[], productId: string, windowDays: number, today = todayISO()): number {
  const from = isoDaysAgo(windowDays, new Date(today))
  const totalOut = sumMovementQty(movements, productId, 'out', from, today)
  return totalOut / windowDays
}

function getMonthToDateConsumption(movements: Movement[], productId: string, referenceDate: Date): number {
  const from = formatISO(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1), { representation: 'date' })
  const to = formatISO(referenceDate, { representation: 'date' })
  return sumMovementQty(movements, productId, 'out', from, to)
}

function buildSeasonalNote(product: Product, movements: Movement[], today: Date): string | null {
  const earliestMovement = movements
    .filter((m) => m.productId === product.id)
    .reduce<string | null>((min, m) => (min === null || m.date < min ? m.date : min), null)
  if (!earliestMovement) return null

  const monthsOfHistory = differenceInCalendarDays(today, new Date(earliestMovement)) / 30.44
  if (monthsOfHistory < SEASONALITY_MIN_HISTORY_MONTHS) return null

  const thisMonthQty = getMonthToDateConsumption(movements, product.id, today)
  const lastYearSameDate = subYears(today, 1)
  const lastYearQty = getMonthToDateConsumption(movements, product.id, lastYearSameDate)

  if (thisMonthQty === 0 && lastYearQty === 0) return null

  if (lastYearQty === 0) {
    return `Szezonalitás: idén eddig ${thisMonthQty} ${product.unit} fogyott ebben a hónapban, tavaly ilyenkor nem volt fogyás.`
  }

  const diffPercent = ((thisMonthQty - lastYearQty) / lastYearQty) * 100
  if (Math.abs(diffPercent) < SEASONALITY_NOTE_THRESHOLD_PERCENT) return null

  const direction = diffPercent > 0 ? 'magasabb' : 'alacsonyabb'
  return `Szezonalitás: idén eddig ${thisMonthQty} ${product.unit} fogyott ebben a hónapban, ami ${Math.abs(
    Math.round(diffPercent),
  )}%-kal ${direction}, mint tavaly ilyenkor (${lastYearQty} ${product.unit}).`
}

export function computeProductInsight(
  product: Product,
  movements: Movement[],
  suppliers: Supplier[],
  settings: Settings,
  today = new Date(),
): ProductInsight {
  const todayIso = formatISO(today, { representation: 'date' })
  const avgDailyConsumption = getAvgDailyConsumption(movements, product.id, settings.avgConsumptionWindowDays, todayIso)
  const isLowStock = product.currentStock < product.minStock

  const daysUntilStockout = avgDailyConsumption > 0 ? product.currentStock / avgDailyConsumption : null

  const supplier = suppliers.find((s) => s.id === product.supplierId)
  const leadTimeDays = supplier?.leadTimeDays ?? 0
  const reorderThresholdDays = leadTimeDays + settings.safetyStockDays

  const runsOutTooSoon = daysUntilStockout !== null && daysUntilStockout < reorderThresholdDays
  const needsReorder = isLowStock || runsOutTooSoon
  const reorderUrgent = runsOutTooSoon

  const targetStock = avgDailyConsumption * settings.reorderTargetDays
  const suggestedOrderQty = needsReorder ? Math.max(0, Math.ceil(targetStock - product.currentStock)) : 0

  const seasonalNote = needsReorder ? buildSeasonalNote(product, movements, today) : null

  return {
    productId: product.id,
    avgDailyConsumption,
    daysUntilStockout,
    isLowStock,
    needsReorder,
    reorderUrgent,
    suggestedOrderQty,
    seasonalNote,
  }
}

export function computeSlowMoving(product: Product, movements: Movement[], settings: Settings, today = new Date()): SlowMovingResult {
  const todayIso = formatISO(today, { representation: 'date' })
  const windowDays = settings.slowMovingWindowDays
  const currentFrom = isoDaysAgo(windowDays, today)
  const previousFrom = isoDaysAgo(windowDays * 2, today)
  const previousTo = isoDaysAgo(windowDays + 1, today)

  const currentPeriodQty = sumMovementQty(movements, product.id, 'out', currentFrom, todayIso)
  const previousPeriodQty = sumMovementQty(movements, product.id, 'out', previousFrom, previousTo)

  // Guard against flagging brand-new products that simply haven't had time
  // to sell yet: only evaluate once the product has existed through at
  // least one full window.
  const ageDays = differenceInCalendarDays(today, new Date(product.createdAt))
  if (ageDays < windowDays) {
    return { productId: product.id, currentPeriodQty, previousPeriodQty, dropPercent: null, isSlowMoving: false }
  }

  if (currentPeriodQty === 0) {
    return { productId: product.id, currentPeriodQty, previousPeriodQty, dropPercent: previousPeriodQty > 0 ? -100 : null, isSlowMoving: true }
  }

  if (previousPeriodQty === 0) {
    return { productId: product.id, currentPeriodQty, previousPeriodQty, dropPercent: null, isSlowMoving: false }
  }

  const dropPercent = ((previousPeriodQty - currentPeriodQty) / previousPeriodQty) * 100
  const isSlowMoving = dropPercent >= settings.slowMovingThresholdPercent

  return { productId: product.id, currentPeriodQty, previousPeriodQty, dropPercent, isSlowMoving }
}

/** Surplus stock at a location beyond what it needs to cover the reorder target window. */
function surplusQty(product: Product, avgDailyConsumption: number, settings: Settings): number {
  const buffer = Math.max(avgDailyConsumption * settings.reorderTargetDays, product.minStock)
  return Math.max(0, product.currentStock - buffer)
}

export function computeTransferSuggestions(
  products: Product[],
  movements: Movement[],
  locations: Location[],
  settings: Settings,
  today = new Date(),
): TransferSuggestion[] {
  if (locations.length < 2) return []
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? 'Ismeretlen telephely'

  const groups = new Map<string, Product[]>()
  for (const p of products) {
    const key = productKeyOf(p)
    const arr = groups.get(key) ?? []
    arr.push(p)
    groups.set(key, arr)
  }

  const suggestions: TransferSuggestion[] = []
  for (const [key, group] of groups) {
    if (group.length < 2) continue

    const withInsight = group.map((p) => {
      const avgDaily = getAvgDailyConsumption(movements, p.id, settings.avgConsumptionWindowDays, formatISO(today, { representation: 'date' }))
      const isLow = p.currentStock < p.minStock
      const surplus = surplusQty(p, avgDaily, settings)
      return { product: p, avgDaily, isLow, surplus }
    })

    const lowOnes = withInsight.filter((x) => x.isLow)
    const surplusOnes = withInsight.filter((x) => x.surplus > 0).sort((a, b) => b.surplus - a.surplus)
    if (lowOnes.length === 0 || surplusOnes.length === 0) continue

    for (const low of lowOnes) {
      const donor = surplusOnes.find((s) => s.product.locationId !== low.product.locationId && s.surplus > 0)
      if (!donor) continue
      const deficit = Math.max(1, low.product.minStock - low.product.currentStock)
      const qty = Math.min(donor.surplus, deficit)
      if (qty <= 0) continue
      suggestions.push({
        productKey: key,
        productName: low.product.name,
        fromLocationId: donor.product.locationId,
        fromLocationName: locationName(donor.product.locationId),
        toLocationId: low.product.locationId,
        toLocationName: locationName(low.product.locationId),
        quantity: Math.ceil(qty),
        unit: low.product.unit,
      })
      donor.surplus -= qty
    }
  }

  return suggestions
}

export function computeMarginReport(products: Product[], movements: Movement[], fromISO: string, toISO: string): MarginReportRow[] {
  const rows: MarginReportRow[] = []
  for (const product of products) {
    const outMovements = movements.filter((m) => m.productId === product.id && m.type === 'out' && m.date >= fromISO && m.date <= toISO)
    if (outMovements.length === 0) continue
    const quantitySold = outMovements.reduce((sum, m) => sum + m.quantity, 0)
    const revenue = quantitySold * product.salePrice
    const cost = quantitySold * product.purchasePrice
    const margin = revenue - cost
    rows.push({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      quantitySold,
      revenue,
      cost,
      margin,
      marginPercent: revenue > 0 ? (margin / revenue) * 100 : 0,
    })
  }
  return rows.sort((a, b) => b.margin - a.margin)
}

export function getStockStatus(isLowStock: boolean, isSlowMoving: boolean): StockStatus {
  if (isLowStock) return 'low'
  if (isSlowMoving) return 'slow-moving'
  return 'normal'
}
