// Cost-basis calculations for stock: weighted-average and FIFO. Kept as
// pure functions (no store/React dependency) so the store can call them and
// they stay independently testable.
import type { PurchaseLot } from '../types'

/** A lot's per-unit cost including its share of shipping - goods price and
 * freight are tracked separately (shippingCost is a total for the whole
 * batch) but blend into one number for costing purposes. */
export function lotUnitCost(lot: Pick<PurchaseLot, 'unitPrice' | 'shippingCost' | 'quantity'>): number {
  return lot.unitPrice + (lot.quantity > 0 ? lot.shippingCost / lot.quantity : 0)
}

/** Rolls a new receipt into a single running weighted-average cost. */
export function weightedAverageAfterReceipt(
  currentStock: number,
  currentAvgCost: number,
  incomingQty: number,
  incomingUnitCost: number,
): number {
  const totalQty = currentStock + incomingQty
  if (totalQty <= 0) return incomingUnitCost
  const existingValue = currentStock * currentAvgCost
  const incomingValue = incomingQty * incomingUnitCost
  return Math.round(((existingValue + incomingValue) / totalQty) * 100) / 100
}

export interface FifoConsumptionResult {
  /** Full lots array with the consumed lots' remainingQuantity updated. */
  updatedLots: PurchaseLot[]
  /** Total cost of the consumed quantity. */
  totalCost: number
  /** Average cost per unit across whatever lots were consumed. */
  unitCost: number
  /** Quantity that exceeded all available lot history (e.g. data recorded
   * before lot tracking existed, or a forced negative-stock sale) - this
   * portion falls back to fallbackUnitCost rather than being left uncosted. */
  shortageQty: number
}

/** Consumes `quantity` units of `productId` from the oldest lots first. */
export function consumeFifo(lots: PurchaseLot[], productId: string, quantity: number, fallbackUnitCost: number): FifoConsumptionResult {
  const candidates = lots
    .filter((l) => l.productId === productId && l.remainingQuantity > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.localeCompare(b.createdAt)))

  let remaining = quantity
  let totalCost = 0
  const nextRemaining = new Map<string, number>()

  for (const lot of candidates) {
    if (remaining <= 0) break
    const take = Math.min(lot.remainingQuantity, remaining)
    totalCost += take * lotUnitCost(lot)
    nextRemaining.set(lot.id, lot.remainingQuantity - take)
    remaining -= take
  }

  const shortageQty = Math.max(0, remaining)
  if (shortageQty > 0) {
    totalCost += shortageQty * fallbackUnitCost
  }

  const updatedLots = lots.map((l) => (nextRemaining.has(l.id) ? { ...l, remainingQuantity: nextRemaining.get(l.id)! } : l))

  return {
    updatedLots,
    totalCost,
    unitCost: quantity > 0 ? totalCost / quantity : 0,
    shortageQty,
  }
}
