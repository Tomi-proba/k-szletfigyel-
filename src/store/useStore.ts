import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createId } from './id'
import { buildSeedData } from './seed'
import {
  DEFAULT_SETTINGS,
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
}

export type RecordMovementResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-quantity' | 'product-not-found' | 'insufficient-stock'; resultingStock?: number }

interface AppState {
  locations: Location[]
  suppliers: Supplier[]
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

  // Products
  addProduct: (input: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => void
  updateProduct: (id: string, input: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => void
  deleteProduct: (id: string) => void

  // Movements
  recordMovement: (input: RecordMovementInput, opts?: { allowNegativeStock?: boolean }) => RecordMovementResult
  deleteMovement: (id: string) => void

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
        const { productId, type, quantity, date, note } = input
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return { ok: false, reason: 'invalid-quantity' }
        }
        const product = get().products.find((p) => p.id === productId)
        if (!product) return { ok: false, reason: 'product-not-found' }

        const delta = type === 'in' ? quantity : -quantity
        const resultingStock = product.currentStock + delta

        if (type === 'out' && resultingStock < 0 && !opts?.allowNegativeStock) {
          return { ok: false, reason: 'insufficient-stock', resultingStock }
        }

        set((state) => ({
          products: state.products.map((p) =>
            p.id === productId ? { ...p, currentStock: resultingStock, updatedAt: new Date().toISOString() } : p,
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
            },
          ],
        }))
        return { ok: true }
      },

      deleteMovement: (id) =>
        set((state) => {
          const movement = state.movements.find((m) => m.id === id)
          if (!movement) return state
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
