// Core domain types for the inventory management app.
// Kept framework-agnostic so the persistence layer (see src/store) can be
// swapped for a real backend later without touching business logic.

export type MovementType = 'in' | 'out'

/** How the cost basis for outgoing stock is determined.
 * 'average' - a single running weighted-average cost per product.
 * 'fifo' - each purchase batch is its own cost layer, consumed oldest-first. */
export type CostingMethod = 'average' | 'fifo'

/** Currency a purchase batch was invoiced in. Internal costing (product
 * cost, margin reports) always works in HUF - a non-HUF entry is converted
 * using the exchange rate recorded alongside it on the PurchaseLot. */
export type Currency = 'HUF' | 'USD' | 'EUR'

export interface Location {
  id: string
  name: string
}

export interface Supplier {
  id: string
  name: string
  phone?: string
  email?: string
  /** Average delivery lead time in days, used for reorder alerts. */
  leadTimeDays: number
}

export interface Customer {
  id: string
  name: string
  phone?: string
  email?: string
  notes?: string
}

export interface Product {
  id: string
  name: string
  /** Optional article/SKU number. */
  sku?: string
  category: string
  /** Unit of measure, e.g. db, m2, fm, kg, l. */
  unit: string
  currentStock: number
  /** Alert threshold, configurable per product. */
  minStock: number
  /** Weighted-average purchase cost per unit, in HUF. Import prices vary
   * order to order, so this isn't a fixed price: every incoming movement
   * that specifies its own unit price folds into this average (see
   * recordMovement in the store). Manually editable too, e.g. for a
   * correction or when first creating the product. */
  purchasePrice: number
  salePrice: number
  supplierId?: string
  /** Which site holds this stock. Every product belongs to exactly one location. */
  locationId: string
  createdAt: string
  updatedAt: string
}

/** One incoming batch of stock, at its own price - what "the beszerzési ár
 * is different every time we import" actually needs tracked. Created
 * automatically whenever an 'in' movement is recorded; consumed
 * oldest-first when costingMethod is 'fifo' (see lib/costing.ts). Kept
 * even in 'average' mode so switching methods later has real history to
 * work from. */
export interface PurchaseLot {
  id: string
  productId: string
  /** The 'in' movement that created this lot, so deleting that movement
   * can remove the lot too. */
  movementId: string
  date: string
  /** Original quantity received in this batch. */
  quantity: number
  /** How much of this batch hasn't been sold yet (FIFO consumption). */
  remainingQuantity: number
  /** Price of the goods themselves, per unit, in `currency` - excludes shipping. */
  unitPrice: number
  /** Total shipping/freight cost for this whole batch, in `currency` (not per unit). */
  shippingCost: number
  /** Currency unitPrice and shippingCost above are recorded in. */
  currency: Currency
  /** HUF value of 1 unit of `currency` at the time of purchase - always 1 when currency is 'HUF'. */
  exchangeRate: number
  createdAt: string
}

export interface Movement {
  id: string
  productId: string
  /** Denormalized at creation time so history stays correct even if the
   * product is later moved to a different location or deleted. */
  locationId: string
  date: string
  type: MovementType
  quantity: number
  note?: string
  createdAt: string
  /** 'in' only: the actual unit price paid for this batch (goods only,
   * excluding shipping), if it differed from (or was used to establish)
   * the product's existing cost. Omitted when booked in at the existing
   * cost. See PurchaseLot for the batch this movement created. */
  unitPrice?: number
  /** 'in' only: total shipping/freight cost for this batch, kept separate
   * from unitPrice so the two can be reported independently. */
  shippingCost?: number
  /** 'in' only: currency unitPrice/shippingCost were entered in, if not HUF. */
  currency?: Currency
  /** 'in' only: HUF value of 1 unit of `currency` at the time, if currency was set. */
  exchangeRate?: number
  /** 'out' only: the cost basis per unit at the moment this movement was
   * recorded (weighted-average or FIFO-consumed, per Settings.costingMethod
   * at the time) - snapshotted so margin reports stay accurate for past
   * periods even after later purchases or a method change shift the
   * product's current cost. */
  unitCost?: number
  /** 'out' only, and only when sold to a tracked customer: the product's
   * sale price at the moment of this sale, snapshotted so an outstanding
   * balance doesn't silently change if the product's price is edited
   * later. Absent for anonymous/walk-in sales (the common case). */
  saleUnitPrice?: number
  /** 'out' only: which tracked customer this was sold to. Omitted for a
   * plain walk-in/cash sale - that's the default and needs no tracking. */
  customerId?: string
  /** 'out' only, meaningful when customerId is set: whether the customer
   * has paid for this sale yet. Sales without a customerId are always
   * effectively "paid" (cash sale) and this is left unset for them. */
  isPaid?: boolean
}

export interface Settings {
  /** Which method values outgoing stock's cost basis - see CostingMethod. */
  costingMethod: CostingMethod
  /** Window (days) used to compute average daily consumption for reorder suggestions. */
  avgConsumptionWindowDays: number
  /** Safety buffer (days) added on top of supplier lead time before an order is flagged urgent. */
  safetyStockDays: number
  /** How many days' worth of stock a suggested order should cover. */
  reorderTargetDays: number
  /** Window (days) used to detect slow-moving stock, compared against the same length previous period. */
  slowMovingWindowDays: number
  /** If consumption drops below this % of the prior period's consumption, flag as slow-moving. */
  slowMovingThresholdPercent: number
}

export const DEFAULT_SETTINGS: Settings = {
  costingMethod: 'average',
  avgConsumptionWindowDays: 30,
  safetyStockDays: 7,
  reorderTargetDays: 30,
  slowMovingWindowDays: 60,
  slowMovingThresholdPercent: 70,
}

export const DEFAULT_LOCATION_NAME = 'Fő telephely'

export const COMMON_UNITS = ['db', 'm²', 'fm', 'kg', 'l', 'csomag', 'raklap'] as const
