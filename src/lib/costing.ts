// Cost-basis calculations for stock: weighted-average and FIFO. Kept as
// pure functions (no store/React dependency) so the store can call them and
// they stay independently testable.
import type { PurchaseLot } from '../types'

type LotMoneyFields = Pick<PurchaseLot, 'unitPrice' | 'shippingCost' | 'quantity' | 'exchangeRate'>
type LotVatFields = Partial<Pick<PurchaseLot, 'vatRatePercent' | 'vatReclaimable'>>

/** Goods + shipping for this batch, in HUF - the pre-VAT invoice total. */
export function lotNetHuf(lot: LotMoneyFields): number {
  return (lot.unitPrice * lot.quantity + lot.shippingCost) * lot.exchangeRate
}

/** Just the goods (no shipping), in HUF - see lib/shipping.ts for the report this feeds. */
export function lotGoodsValueHuf(lot: LotMoneyFields): number {
  return lot.unitPrice * lot.quantity * lot.exchangeRate
}

/** Just the shipping/freight, in HUF - see lib/shipping.ts for the report this feeds. */
export function lotShippingHuf(lot: Pick<PurchaseLot, 'shippingCost' | 'exchangeRate'>): number {
  return lot.shippingCost * lot.exchangeRate
}

/** This batch's VAT amount in HUF, computed on the net (goods + shipping)
 * invoice total - 0 when no rate is tracked for this lot. Regardless of
 * whether it's reclaimable: this is still money paid to the supplier. */
export function lotVatAmountHuf(lot: LotMoneyFields & LotVatFields): number {
  if (lot.vatRatePercent === undefined) return 0
  return lotNetHuf(lot) * (lot.vatRatePercent / 100)
}

/** The full invoice amount owed to the supplier for this batch, in HUF -
 * net + VAT, regardless of reclaimability (that only affects who eventually
 * absorbs the cost, not what actually has to be paid now). */
export function lotGrossHuf(lot: LotMoneyFields & LotVatFields): number {
  return lotNetHuf(lot) + lotVatAmountHuf(lot)
}

/** A lot's per-unit COST BASIS in HUF - what feeds FIFO/weighted-average
 * costing and margin reports. Includes its share of shipping (goods price
 * and freight are tracked separately - shippingCost is a total for the
 * whole batch - but blend into one HUF number here) and its currency
 * conversion. Non-reclaimable VAT is folded in too, per unit, since that
 * portion is never recovered and is therefore a real cost; reclaimable VAT
 * is deliberately excluded (see lotGrossHuf for the full amount actually
 * paid to the supplier, which a payment-obligation total should use instead). */
export function lotUnitCost(lot: LotMoneyFields & LotVatFields): number {
  const perUnitInCurrency = lot.unitPrice + (lot.quantity > 0 ? lot.shippingCost / lot.quantity : 0)
  const base = perUnitInCurrency * lot.exchangeRate
  const nonReclaimableVatPerUnit = lot.vatReclaimable === false && lot.quantity > 0 ? lotVatAmountHuf(lot) / lot.quantity : 0
  return base + nonReclaimableVatPerUnit
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
