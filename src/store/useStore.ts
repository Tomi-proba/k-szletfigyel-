import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createId } from './id'
import { buildSeedData } from './seed'
import { consumeFifo, lotUnitCost, weightedAverageAfterReceipt } from '../lib/costing'
import {
  DEFAULT_SETTINGS,
  type Currency,
  type Customer,
  type Location,
  type Movement,
  type MovementType,
  type Product,
  type PurchaseLot,
  type Settings,
  type Supplier,
} from '../types'

export interface RecordMovementInput {
  productId: string
  type: MovementType
  quantity: number
  date: string
  note?: string
  /** 'in' only: unit price actually paid for this batch (goods only), if
   * different from the product's current cost. Omit to book it in at the
   * existing cost. Always creates a PurchaseLot either way. In `currency`
   * if given, otherwise HUF. */
  unitPrice?: number
  /** 'in' only: total shipping/freight cost for this whole batch, in `currency`. */
  shippingCost?: number
  /** 'in' only: currency unitPrice/shippingCost are in. Defaults to HUF. */
  currency?: Currency
  /** 'in' only, required when currency isn't HUF: HUF value of 1 unit of
   * that currency at the time of purchase. */
  exchangeRate?: number
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
  lots: PurchaseLot[]
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
        const { productId, type, quantity, date, note, unitPrice, shippingCost, currency, exchangeRate, customerId, isPaid } = input
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return { ok: false, reason: 'invalid-quantity' }
        }
        if (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
          return { ok: false, reason: 'invalid-quantity' }
        }
        if (shippingCost !== undefined && (!Number.isFinite(shippingCost) || shippingCost < 0)) {
          return { ok: false, reason: 'invalid-quantity' }
        }
        // A currency selection only means something alongside an actual
        // price entry; ignore it when booking in at the existing (HUF) cost.
        const enteringNewPrice = unitPrice !== undefined
        const lotCurrency: Currency = enteringNewPrice ? (currency ?? 'HUF') : 'HUF'
        if (enteringNewPrice && lotCurrency !== 'HUF' && (!Number.isFinite(exchangeRate) || (exchangeRate ?? 0) <= 0)) {
          return { ok: false, reason: 'invalid-quantity' }
        }
        const lotExchangeRate = enteringNewPrice && lotCurrency !== 'HUF' ? (exchangeRate as number) : 1
        const product = get().products.find((p) => p.id === productId)
        if (!product) return { ok: false, reason: 'product-not-found' }

        const delta = type === 'in' ? quantity : -quantity
        const resultingStock = product.currentStock + delta

        if (type === 'out' && resultingStock < 0 && !opts?.allowNegativeStock) {
          return { ok: false, reason: 'insufficient-stock', resultingStock }
        }

        const { costingMethod } = get().settings
        let nextPurchasePrice = product.purchasePrice
        let movementUnitPrice: number | undefined
        let movementShippingCost: number | undefined
        let movementUnitCost: number | undefined
        let newLot: PurchaseLot | undefined
        let lotsAfterConsumption = get().lots

        if (type === 'in') {
          // Incoming batches can arrive at a different price each time
          // (import goods, exchange-rate swings, supplier changes), so
          // every batch becomes its own PurchaseLot - goods price and
          // shipping tracked separately, blended for costing. Lots are
          // kept regardless of costingMethod so switching methods later
          // has real history to draw on.
          const effectiveUnitPrice = unitPrice ?? product.purchasePrice
          const effectiveShipping = shippingCost ?? 0
          const batchUnitCost = lotUnitCost({
            unitPrice: effectiveUnitPrice,
            shippingCost: effectiveShipping,
            quantity,
            exchangeRate: lotExchangeRate,
          })

          newLot = {
            id: createId(),
            productId,
            movementId: '', // filled in below once the movement id is known
            date,
            quantity,
            remainingQuantity: quantity,
            unitPrice: effectiveUnitPrice,
            shippingCost: effectiveShipping,
            currency: lotCurrency,
            exchangeRate: lotExchangeRate,
            createdAt: new Date().toISOString(),
          }
          if (unitPrice !== undefined) movementUnitPrice = unitPrice
          if (effectiveShipping > 0) movementShippingCost = effectiveShipping

          nextPurchasePrice =
            costingMethod === 'average'
              ? weightedAverageAfterReceipt(product.currentStock, product.purchasePrice, quantity, batchUnitCost)
              : Math.round(batchUnitCost * 100) / 100
        } else {
          // Lots are always consumed FIFO to keep the ledger accurate, even
          // in 'average' mode - only which number gets snapshotted onto the
          // movement (and used for margin reporting) depends on the setting.
          const fifoResult = consumeFifo(get().lots, productId, quantity, product.purchasePrice)
          lotsAfterConsumption = fifoResult.updatedLots
          movementUnitCost = Math.round((costingMethod === 'fifo' ? fifoResult.unitCost : product.purchasePrice) * 100) / 100
        }

        const movementId = createId()
        if (newLot) newLot.movementId = movementId

        set((state) => ({
          products: state.products.map((p) =>
            p.id === productId
              ? { ...p, currentStock: resultingStock, purchasePrice: nextPurchasePrice, updatedAt: new Date().toISOString() }
              : p,
          ),
          lots: newLot ? [...lotsAfterConsumption, newLot] : lotsAfterConsumption,
          movements: [
            ...state.movements,
            {
              id: movementId,
              productId,
              locationId: product.locationId,
              date,
              type,
              quantity,
              note: note?.trim() || undefined,
              createdAt: new Date().toISOString(),
              unitPrice: movementUnitPrice,
              shippingCost: movementShippingCost,
              currency: type === 'in' && lotCurrency !== 'HUF' ? lotCurrency : undefined,
              exchangeRate: type === 'in' && lotCurrency !== 'HUF' ? lotExchangeRate : undefined,
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
          // Reverses the stock quantity and removes the lot an 'in'
          // movement created. Doesn't restore quantity to whichever lots
          // an 'out' movement consumed - once later sales have potentially
          // drawn from the same lots, unwinding that precisely isn't
          // well-defined, same as the weighted-average case.
          const reverseDelta = movement.type === 'in' ? -movement.quantity : movement.quantity
          return {
            movements: state.movements.filter((m) => m.id !== id),
            lots: movement.type === 'in' ? state.lots.filter((l) => l.movementId !== id) : state.lots,
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
            lots: [],
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
