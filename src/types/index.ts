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
