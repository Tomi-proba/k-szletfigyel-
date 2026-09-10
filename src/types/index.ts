// Core domain types for the inventory management app.
// Kept framework-agnostic so the persistence layer (see src/store) can be
// swapped for a real backend later without touching business logic.

export type MovementType = 'in' | 'out'

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
  /** 'in' only: the actual unit price paid for this batch, if it differed
   * from (or was used to establish) the product's running average cost.
   * Omitted when the batch was booked in at the product's existing cost. */
  unitPrice?: number
  /** 'out' only: the product's weighted-average cost per unit at the
   * moment this movement was recorded - snapshotted so margin reports
   * stay accurate for past periods even after later purchases change the
   * product's current average cost. */
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
  avgConsumptionWindowDays: 30,
  safetyStockDays: 7,
  reorderTargetDays: 30,
  slowMovingWindowDays: 60,
  slowMovingThresholdPercent: 70,
}

export const DEFAULT_LOCATION_NAME = 'Fő telephely'

export const COMMON_UNITS = ['db', 'm²', 'fm', 'kg', 'l', 'csomag', 'raklap'] as const
