import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createId } from './id'
import { buildSeedData } from './seed'
import {
  DEFAULT_SETTINGS,
  type Customer,
  type Location,
  type Movement,
  type MovementType,
  type Product,
  type Settings,
  type Supplier,
} from '../types'

export interface RecordMovementInput {
  productId: string
  type: MovementType
  quantity: number
  date: string
  note?: string
  /** 'in' only: unit price actually paid for this batch, if different from
   * the product's current average cost. Omit to book it in at the
   * existing cost (no change to the running average). */
  unitPrice?: number
  /** 'out' only: attach the sale to a tracked customer instead of treating
   * it as an anonymous walk-in/cash sale. */
  customerId?: string
  /** 'out' only, meaningful when customerId is set. Defaults to true (paid)
   * when a customer is attached and this is omitted. */
  isPaid?: boolean
}

export type RecordMovementResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-quantity' | 'product-not-found' | 'insufficient-stock'; resultingStock?: number }

interface AppState {
  locations: Location[]
  suppliers: Supplier[]
  customers: Customer[]
  products: Product[]
  movements: Movement[]
  settings: Settings

  // Locations
  addLocation: (name: string) => void
  updateLocation: (id: string, name: string) => void
  deleteLocation: (id: string) => void

  // Suppliers
  addSupplier: (input: Omit<Supplier, 'id'>) => void
  updateSupplier: (id: string, input: Omit<Supplier, 'id'>) => void
  deleteSupplier: (id: string) => void

  // Customers
  addCustomer: (input: Omit<Customer, 'id'>) => void
  updateCustomer: (id: string, input: Omit<Customer, 'id'>) => void
  deleteCustomer: (id: string) => void

  // Products
  addProduct: (input: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => void
  updateProduct: (id: string, input: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => void
  deleteProduct: (id: string) => void

  // Movements
  recordMovement: (input: RecordMovementInput, opts?: { allowNegativeStock?: boolean }) => RecordMovementResult
  deleteMovement: (id: string) => void
  setMovementPaid: (movementId: string, isPaid: boolean) => void

  // Settings
  updateSettings: (settings: Settings) => void

  // Danger zone
  resetToDemoData: () => void
  clearAllData: () => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...buildSeedData(),
      settings: DEFAULT_SETTINGS,

      addLocation: (name) =>
        set((state) => ({
          locations: [...state.locations, { id: createId(), name: name.trim() }],
        })),

      updateLocation: (id, name) =>
        set((state) => ({
          locations: state.locations.map((l) => (l.id === id ? { ...l, name: name.trim() } : l)),
        })),

      deleteLocation: (id) =>
        set((state) => {
          const inUse = state.products.some((p) => p.locationId === id)
          if (inUse || state.locations.length <= 1) return state
          return { locations: state.locations.filter((l) => l.id !== id) }
        }),

      addSupplier: (input) =>
        set((state) => ({
          suppliers: [...state.suppliers, { ...input, id: createId() }],
        })),

      updateSupplier: (id, input) =>
        set((state) => ({
          suppliers: state.suppliers.map((s) => (s.id === id ? { ...input, id } : s)),
        })),

      deleteSupplier: (id) =>
        set((state) => ({
          suppliers: state.suppliers.filter((s) => s.id !== id),
          products: state.products.map((p) => (p.supplierId === id ? { ...p, supplierId: undefined } : p)),
        })),

      addCustomer: (input) =>
        set((state) => ({
          customers: [...state.customers, { ...input, id: createId() }],
        })),

      updateCustomer: (id, input) =>
        set((state) => ({
          customers: state.customers.map((c) => (c.id === id ? { ...input, id } : c)),
        })),

      deleteCustomer: (id) =>
        set((state) => ({
          customers: state.customers.filter((c) => c.id !== id),
          movements: state.movements.map((m) => (m.customerId === id ? { ...m, customerId: undefined, isPaid: undefined } : m)),
        })),

      addProduct: (input) =>
        set((state) => {
          const now = new Date().toISOString()
          return {
            products: [...state.products, { ...input, id: createId(), createdAt: now, updatedAt: now }],
          }
        }),

      updateProduct: (id, input) =>
        set((state) => ({
          products: state.products.map((p) =>
            p.id === id ? { ...input, id, createdAt: p.createdAt, updatedAt: new Date().toISOString() } : p,
          ),
        })),

      deleteProduct: (id) =>
        set((state) => ({
          products: state.products.filter((p) => p.id !== id),
          movements: state.movements.filter((m) => m.productId !== id),
        })),

      recordMovement: (input, opts) => {
        const { productId, type, quantity, date, note, unitPrice, customerId, isPaid } = input
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return { ok: false, reason: 'invalid-quantity' }
        }
        if (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
          return { ok: false, reason: 'invalid-quantity' }
        }
        const product = get().products.find((p) => p.id === productId)
        if (!product) return { ok: false, reason: 'product-not-found' }

        const delta = type === 'in' ? quantity : -quantity
        const resultingStock = product.currentStock + delta

        if (type === 'out' && resultingStock < 0 && !opts?.allowNegativeStock) {
          return { ok: false, reason: 'insufficient-stock', resultingStock }
        }

        // Incoming batches can arrive at a different price each time
        // (import goods, exchange-rate swings, supplier changes). Rather
        // than overwrite the product's cost outright, fold the new batch
        // into a weighted-average unit cost - the standard "moving
        // average" costing method. Outgoing movements snapshot that cost
        // at the time of sale so later purchases don't retroactively
        // change past margin figures.
        let nextPurchasePrice = product.purchasePrice
        let movementUnitPrice: number | undefined
        let movementUnitCost: number | undefined
        if (type === 'in' && unitPrice !== undefined && unitPrice !== product.purchasePrice) {
          const existingValue = product.currentStock * product.purchasePrice
          const incomingValue = quantity * unitPrice
          nextPurchasePrice = Math.round(((existingValue + incomingValue) / resultingStock) * 100) / 100
          movementUnitPrice = unitPrice
        } else if (type === 'out') {
          movementUnitCost = product.purchasePrice
        }

        set((state) => ({
          products: state.products.map((p) =>
            p.id === productId
              ? { ...p, currentStock: resultingStock, purchasePrice: nextPurchasePrice, updatedAt: new Date().toISOString() }
              : p,
          ),
          movements: [
            ...state.movements,
            {
              id: createId(),
              productId,
              locationId: product.locationId,
              date,
              type,
              quantity,
              note: note?.trim() || undefined,
              createdAt: new Date().toISOString(),
              unitPrice: movementUnitPrice,
              unitCost: movementUnitCost,
              customerId: type === 'out' ? customerId : undefined,
              saleUnitPrice: type === 'out' && customerId ? product.salePrice : undefined,
              isPaid: type === 'out' && customerId ? (isPaid ?? true) : undefined,
            },
          ],
        }))
        return { ok: true }
      },

      setMovementPaid: (movementId, isPaid) =>
        set((state) => ({
          movements: state.movements.map((m) => (m.id === movementId ? { ...m, isPaid } : m)),
        })),

      deleteMovement: (id) =>
        set((state) => {
          const movement = state.movements.find((m) => m.id === id)
          if (!movement) return state
          // Reverses the stock quantity only. Un-blending a weighted-average
          // cost precisely after the fact isn't well-defined once later
          // movements have layered on top of it, so the product's current
          // average cost is intentionally left as-is.
          const reverseDelta = movement.type === 'in' ? -movement.quantity : movement.quantity
          return {
            movements: state.movements.filter((m) => m.id !== id),
            products: state.products.map((p) =>
              p.id === movement.productId ? { ...p, currentStock: p.currentStock + reverseDelta } : p,
            ),
          }
        }),

      updateSettings: (settings) => set({ settings }),

      resetToDemoData: () => set({ ...buildSeedData(), settings: DEFAULT_SETTINGS }),

      clearAllData: () =>
        set(() => {
          const defaultLocation: Location = { id: createId(), name: 'Fő telephely' }
          return {
            locations: [defaultLocation],
            suppliers: [],
            customers: [],
            products: [],
            movements: [],
            settings: DEFAULT_SETTINGS,
          }
        }),
    }),
    {
      name: 'keszletfigyelo-storage',
      version: 1,
    },
  ),
)
