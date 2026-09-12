import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createId } from './id'
import { buildSeedData } from './seed'
import { consumeFifo, lotUnitCost, weightedAverageAfterReceipt } from '../lib/costing'
import { todayISO } from '../lib/dates'
import { diffFields } from '../lib/audit'
import { buildDailyClosingSummary } from '../lib/dailyClosing'
import {
  DEFAULT_LEDGER_CATEGORIES,
  DEFAULT_SETTINGS,
  type AuditAction,
  type AuditEntityType,
  type AuditFieldChange,
  type AuditLogEntry,
  type Currency,
  type Customer,
  type DailyClosing,
  type LedgerEntry,
  type Location,
  type Movement,
  type MovementType,
  type Product,
  type PurchaseLot,
  type SaleStatus,
  type Settings,
  type Supplier,
} from '../types'

/** Builds one audit log entry - every mutating action appends the result of
 * this to state.auditLog. Kept as a plain function (not a store action) so
 * it can be called freely inside other actions' `set()` updaters. */
function auditEntry(
  entityType: AuditEntityType,
  entityId: string,
  entityLabel: string,
  action: AuditAction,
  description: string,
  changes?: AuditFieldChange[],
): AuditLogEntry {
  return { id: createId(), timestamp: new Date().toISOString(), entityType, entityId, entityLabel, action, description, changes }
}

/** Marks a location's already-submitted daily closing (if one exists for
 * that date) as modified - called whenever a movement it covers gets
 * corrected, or a brand-new movement lands on a day that was already
 * closed. The closing's own snapshotted numbers are deliberately never
 * rewritten (that would falsify a sent report); this just raises a flag so
 * the office knows to double-check it. A no-op when no closing matches. */
function flagClosingModified(closings: DailyClosing[], locationId: string, date: string): DailyClosing[] {
  const now = new Date().toISOString()
  let matched = false
  const next = closings.map((c) => {
    if (c.locationId !== locationId || c.date !== date) return c
    matched = true
    return { ...c, modifiedAfterSubmission: true, lastModifiedAt: now }
  })
  return matched ? next : closings
}

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
  /** 'in' only: due date of the supplier invoice for this batch, if the
   * user wants it tracked as a payment obligation. */
  dueDate?: string
  /** 'in' only, meaningful when dueDate is set. Defaults to false (unpaid)
   * when a due date is given and this is omitted. */
  invoicePaid?: boolean
  /** ÁFA kulcs (%) actually applied to this batch/sale - typically prefilled
   * in the UI from the product's defaultVatRatePercent, but freely
   * overridable per transaction. Omit for no VAT tracking on this item. */
  vatRatePercent?: number
  /** 'in' only, meaningful when vatRatePercent is set. Defaults to true
   * (reclaimable) when omitted. */
  vatReclaimable?: boolean
  /** Internal: set when this movement exists specifically to reverse/
   * correct another one (see cancelSale and deleteMovement's 'correction'
   * mode) - points at the original movement's id. */
  correctsMovementId?: string
}

export type RecordMovementResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-quantity' | 'product-not-found' | 'insufficient-stock'; resultingStock?: number }

export type DeleteMovementMode = 'correction' | 'soft-delete'
export type DeleteLedgerEntryMode = 'correction' | 'soft-delete'

export type CancelSaleResult =
  | { ok: true; wasPaid: boolean }
  | { ok: false; reason: 'not-found' | 'not-a-sale' | 'already-cancelled' }

export type SubmitDailyClosingResult =
  | { ok: true; closingId: string }
  | { ok: false; reason: 'already-closed' | 'no-movements' | 'location-not-found' }

interface AppState {
  locations: Location[]
  suppliers: Supplier[]
  customers: Customer[]
  products: Product[]
  movements: Movement[]
  lots: PurchaseLot[]
  ledgerEntries: LedgerEntry[]
  ledgerCategories: string[]
  dailyClosings: DailyClosing[]
  auditLog: AuditLogEntry[]
  settings: Settings

  // Locations
  addLocation: (name: string) => void
  updateLocation: (id: string, name: string) => void
  deleteLocation: (id: string) => void
  restoreLocation: (id: string) => void

  // Suppliers
  addSupplier: (input: Omit<Supplier, 'id'>) => void
  updateSupplier: (id: string, input: Omit<Supplier, 'id'>) => void
  deleteSupplier: (id: string) => void
  restoreSupplier: (id: string) => void

  // Customers
  addCustomer: (input: Omit<Customer, 'id'>) => void
  updateCustomer: (id: string, input: Omit<Customer, 'id'>) => void
  deleteCustomer: (id: string) => void
  restoreCustomer: (id: string) => void

  // Products
  addProduct: (input: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => void
  updateProduct: (id: string, input: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => void
  deleteProduct: (id: string) => void
  restoreProduct: (id: string) => void

  // Movements
  recordMovement: (input: RecordMovementInput, opts?: { allowNegativeStock?: boolean }) => RecordMovementResult
  deleteMovement: (id: string, mode: DeleteMovementMode) => void
  restoreMovement: (id: string) => void
  setMovementPaid: (movementId: string, isPaid: boolean) => void
  setLotPaid: (lotId: string, isPaid: boolean) => void
  setLedgerEntryPaid: (entryId: string, isPaid: boolean) => void
  updateLotVat: (lotId: string, input: { vatRatePercent?: number; vatReclaimable?: boolean }) => void
  updateMovementVat: (movementId: string, vatRatePercent?: number) => void
  setSaleStatus: (movementId: string, status: SaleStatus) => void
  cancelSale: (movementId: string, reason?: string) => CancelSaleResult

  // Napi zárás (daily closing)
  submitDailyClosing: (locationId: string, date: string) => SubmitDailyClosingResult
  markDailyClosingViewed: (id: string) => void
  approveDailyClosing: (id: string) => void

  // Ledger (general income/expense journal)
  addLedgerEntry: (input: Omit<LedgerEntry, 'id' | 'createdAt' | 'updatedAt'>) => void
  updateLedgerEntry: (id: string, input: Omit<LedgerEntry, 'id' | 'createdAt' | 'updatedAt'>) => void
  deleteLedgerEntry: (id: string, mode: DeleteLedgerEntryMode) => void
  restoreLedgerEntry: (id: string) => void

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
        set((state) => {
          const location: Location = { id: createId(), name: name.trim() }
          return {
            locations: [...state.locations, location],
            auditLog: [...state.auditLog, auditEntry('location', location.id, location.name, 'create', `"${location.name}" telephely létrehozva`)],
          }
        }),

      updateLocation: (id, name) =>
        set((state) => {
          const existing = state.locations.find((l) => l.id === id)
          if (!existing) return state
          const trimmed = name.trim()
          const changes = diffFields('location', { name: existing.name }, { name: trimmed })
          return {
            locations: state.locations.map((l) => (l.id === id ? { ...l, name: trimmed } : l)),
            auditLog:
              changes.length > 0
                ? [...state.auditLog, auditEntry('location', id, trimmed, 'update', `"${trimmed}" telephely adatai módosultak`, changes)]
                : state.auditLog,
          }
        }),

      deleteLocation: (id) =>
        set((state) => {
          const location = state.locations.find((l) => l.id === id)
          if (!location) return state
          const activeLocations = state.locations.filter((l) => !l.deletedAt)
          const inUse = state.products.some((p) => p.locationId === id && !p.deletedAt)
          if (inUse || activeLocations.length <= 1) return state
          return {
            locations: state.locations.map((l) => (l.id === id ? { ...l, deletedAt: new Date().toISOString() } : l)),
            auditLog: [...state.auditLog, auditEntry('location', id, location.name, 'delete', `"${location.name}" telephely törölve`)],
          }
        }),

      restoreLocation: (id) =>
        set((state) => {
          const location = state.locations.find((l) => l.id === id)
          if (!location || !location.deletedAt) return state
          return {
            locations: state.locations.map((l) => (l.id === id ? { ...l, deletedAt: undefined } : l)),
            auditLog: [...state.auditLog, auditEntry('location', id, location.name, 'restore', `"${location.name}" telephely visszaállítva`)],
          }
        }),

      addSupplier: (input) =>
        set((state) => {
          const supplier: Supplier = { ...input, id: createId() }
          return {
            suppliers: [...state.suppliers, supplier],
            auditLog: [...state.auditLog, auditEntry('supplier', supplier.id, supplier.name, 'create', `"${supplier.name}" beszállító létrehozva`)],
          }
        }),

      updateSupplier: (id, input) =>
        set((state) => {
          const existing = state.suppliers.find((s) => s.id === id)
          if (!existing) return state
          const updated: Supplier = { ...input, id, deletedAt: existing.deletedAt }
          const changes = diffFields('supplier', existing, updated)
          return {
            suppliers: state.suppliers.map((s) => (s.id === id ? updated : s)),
            auditLog:
              changes.length > 0
                ? [...state.auditLog, auditEntry('supplier', id, updated.name, 'update', `"${updated.name}" beszállító adatai módosultak`, changes)]
                : state.auditLog,
          }
        }),

      deleteSupplier: (id) =>
        set((state) => {
          const supplier = state.suppliers.find((s) => s.id === id)
          if (!supplier) return state
          return {
            suppliers: state.suppliers.map((s) => (s.id === id ? { ...s, deletedAt: new Date().toISOString() } : s)),
            auditLog: [...state.auditLog, auditEntry('supplier', id, supplier.name, 'delete', `"${supplier.name}" beszállító törölve`)],
          }
        }),

      restoreSupplier: (id) =>
        set((state) => {
          const supplier = state.suppliers.find((s) => s.id === id)
          if (!supplier || !supplier.deletedAt) return state
          return {
            suppliers: state.suppliers.map((s) => (s.id === id ? { ...s, deletedAt: undefined } : s)),
            auditLog: [...state.auditLog, auditEntry('supplier', id, supplier.name, 'restore', `"${supplier.name}" beszállító visszaállítva`)],
          }
        }),

      addCustomer: (input) =>
        set((state) => {
          const customer: Customer = { ...input, id: createId() }
          return {
            customers: [...state.customers, customer],
            auditLog: [...state.auditLog, auditEntry('customer', customer.id, customer.name, 'create', `"${customer.name}" vevő létrehozva`)],
          }
        }),

      updateCustomer: (id, input) =>
        set((state) => {
          const existing = state.customers.find((c) => c.id === id)
          if (!existing) return state
          const updated: Customer = { ...input, id, deletedAt: existing.deletedAt }
          const changes = diffFields('customer', existing, updated)
          return {
            customers: state.customers.map((c) => (c.id === id ? updated : c)),
            auditLog:
              changes.length > 0
                ? [...state.auditLog, auditEntry('customer', id, updated.name, 'update', `"${updated.name}" vevő adatai módosultak`, changes)]
                : state.auditLog,
          }
        }),

      deleteCustomer: (id) =>
        set((state) => {
          const customer = state.customers.find((c) => c.id === id)
          if (!customer) return state
          return {
            customers: state.customers.map((c) => (c.id === id ? { ...c, deletedAt: new Date().toISOString() } : c)),
            auditLog: [...state.auditLog, auditEntry('customer', id, customer.name, 'delete', `"${customer.name}" vevő törölve`)],
          }
        }),

      restoreCustomer: (id) =>
        set((state) => {
          const customer = state.customers.find((c) => c.id === id)
          if (!customer || !customer.deletedAt) return state
          return {
            customers: state.customers.map((c) => (c.id === id ? { ...c, deletedAt: undefined } : c)),
            auditLog: [...state.auditLog, auditEntry('customer', id, customer.name, 'restore', `"${customer.name}" vevő visszaállítva`)],
          }
        }),

      addProduct: (input) =>
        set((state) => {
          const now = new Date().toISOString()
          const product: Product = { ...input, id: createId(), createdAt: now, updatedAt: now }
          return {
            products: [...state.products, product],
            auditLog: [...state.auditLog, auditEntry('product', product.id, product.name, 'create', `"${product.name}" termék létrehozva`)],
          }
        }),

      updateProduct: (id, input) =>
        set((state) => {
          const existing = state.products.find((p) => p.id === id)
          if (!existing) return state
          const updated: Product = { ...input, id, createdAt: existing.createdAt, updatedAt: new Date().toISOString(), deletedAt: existing.deletedAt }
          const changes = diffFields('product', existing, updated)
          return {
            products: state.products.map((p) => (p.id === id ? updated : p)),
            auditLog:
              changes.length > 0
                ? [...state.auditLog, auditEntry('product', id, updated.name, 'update', `"${updated.name}" termék adatai módosultak`, changes)]
                : state.auditLog,
          }
        }),

      deleteProduct: (id) =>
        set((state) => {
          const product = state.products.find((p) => p.id === id)
          if (!product) return state
          return {
            products: state.products.map((p) => (p.id === id ? { ...p, deletedAt: new Date().toISOString() } : p)),
            auditLog: [...state.auditLog, auditEntry('product', id, product.name, 'delete', `"${product.name}" termék törölve`)],
          }
        }),

      restoreProduct: (id) =>
        set((state) => {
          const product = state.products.find((p) => p.id === id)
          if (!product || !product.deletedAt) return state
          return {
            products: state.products.map((p) => (p.id === id ? { ...p, deletedAt: undefined } : p)),
            auditLog: [...state.auditLog, auditEntry('product', id, product.name, 'restore', `"${product.name}" termék visszaállítva`)],
          }
        }),

      recordMovement: (input, opts) => {
        const {
          productId,
          type,
          quantity,
          date,
          note,
          unitPrice,
          shippingCost,
          currency,
          exchangeRate,
          customerId,
          isPaid,
          dueDate,
          invoicePaid,
          vatRatePercent,
          vatReclaimable,
          correctsMovementId,
        } = input
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return { ok: false, reason: 'invalid-quantity' }
        }
        if (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
          return { ok: false, reason: 'invalid-quantity' }
        }
        if (shippingCost !== undefined && (!Number.isFinite(shippingCost) || shippingCost < 0)) {
          return { ok: false, reason: 'invalid-quantity' }
        }
        if (vatRatePercent !== undefined && (!Number.isFinite(vatRatePercent) || vatRatePercent < 0)) {
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
          const lotVatReclaimable = vatRatePercent !== undefined ? (vatReclaimable ?? true) : undefined
          const batchUnitCost = lotUnitCost({
            unitPrice: effectiveUnitPrice,
            shippingCost: effectiveShipping,
            quantity,
            exchangeRate: lotExchangeRate,
            vatRatePercent,
            vatReclaimable: lotVatReclaimable,
          })

          const lotIsPaid = dueDate ? (invoicePaid ?? false) : undefined
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
            dueDate: dueDate || undefined,
            isPaid: lotIsPaid,
            paidDate: lotIsPaid ? todayISO() : undefined,
            vatRatePercent,
            vatReclaimable: lotVatReclaimable,
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
        const movementLabel = `${product.name} (${quantity} ${product.unit})`

        // A correction targets whichever day the ORIGINAL movement belongs
        // to (corrections themselves are always dated today, per
        // deleteMovement/cancelSale below) - that original day's closing, if
        // any, is what needs flagging as modified. A plain new movement
        // checks its own location+date instead, so backdating an entry onto
        // an already-closed day gets flagged too.
        const originalForCorrection = correctsMovementId ? get().movements.find((m) => m.id === correctsMovementId) : undefined
        const closingCheckLocationId = originalForCorrection?.locationId ?? product.locationId
        const closingCheckDate = originalForCorrection?.date ?? date
        const affectedClosing = get().dailyClosings.find((c) => c.locationId === closingCheckLocationId && c.date === closingCheckDate)

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
              // Snapshotted for every sale (not just customer-tracked ones)
              // so VAT and any later reporting always has the price that
              // was actually charged, not today's (possibly changed) price.
              saleUnitPrice: type === 'out' ? product.salePrice : undefined,
              isPaid: type === 'out' && customerId ? (isPaid ?? true) : undefined,
              vatRatePercent: type === 'out' ? vatRatePercent : undefined,
              saleStatus: type === 'out' ? 'pending' : undefined,
              saleStatusChangedAt: type === 'out' ? new Date().toISOString() : undefined,
              correctsMovementId,
            },
          ],
          dailyClosings: flagClosingModified(state.dailyClosings, closingCheckLocationId, closingCheckDate),
          auditLog: [
            ...state.auditLog,
            auditEntry(
              'movement',
              movementId,
              movementLabel,
              'create',
              correctsMovementId
                ? `Korrekciós/visszavételi tétel rögzítve - ${movementLabel}`
                : type === 'in'
                  ? `Bejövő mozgás rögzítve - ${movementLabel}`
                  : `Eladás rögzítve - ${movementLabel}`,
            ),
            ...(affectedClosing
              ? [
                  auditEntry(
                    'dailyClosing',
                    affectedClosing.id,
                    `${closingCheckDate} - napi zárás`,
                    'update',
                    `A(z) ${closingCheckDate} napi zárás módosult egy utólagos tétel miatt (${movementLabel})`,
                  ),
                ]
              : []),
          ],
        }))
        return { ok: true }
      },

      setMovementPaid: (movementId, isPaid) =>
        set((state) => {
          const movement = state.movements.find((m) => m.id === movementId)
          if (!movement) return state
          const product = state.products.find((p) => p.id === movement.productId)
          const changes = diffFields('movement', { isPaid: movement.isPaid }, { isPaid })
          return {
            movements: state.movements.map((m) => (m.id === movementId ? { ...m, isPaid } : m)),
            auditLog:
              changes.length > 0
                ? [
                    ...state.auditLog,
                    auditEntry(
                      'movement',
                      movementId,
                      product?.name ?? 'Eladás',
                      'update',
                      isPaid ? 'Eladás megjelölve kifizetettként' : 'Eladás megjelölve kifizetetlenként',
                      changes,
                    ),
                  ]
                : state.auditLog,
          }
        }),

      setLotPaid: (lotId, isPaid) =>
        set((state) => {
          const lot = state.lots.find((l) => l.id === lotId)
          if (!lot) return state
          const product = state.products.find((p) => p.id === lot.productId)
          const changes = diffFields('lot', { isPaid: lot.isPaid }, { isPaid })
          return {
            lots: state.lots.map((l) => (l.id === lotId ? { ...l, isPaid, paidDate: isPaid ? todayISO() : undefined } : l)),
            auditLog:
              changes.length > 0
                ? [
                    ...state.auditLog,
                    auditEntry(
                      'lot',
                      lotId,
                      product?.name ?? 'Beszerzési tétel',
                      'update',
                      isPaid ? 'Beszállítói számla megjelölve kifizetettként' : 'Beszállítói számla megjelölve kifizetetlenként',
                      changes,
                    ),
                  ]
                : state.auditLog,
          }
        }),

      setLedgerEntryPaid: (entryId, isPaid) =>
        set((state) => {
          const entry = state.ledgerEntries.find((e) => e.id === entryId)
          if (!entry) return state
          const changes = diffFields('ledgerEntry', { isPaid: entry.isPaid }, { isPaid })
          return {
            ledgerEntries: state.ledgerEntries.map((e) =>
              e.id === entryId ? { ...e, isPaid, paidDate: isPaid ? todayISO() : undefined, updatedAt: new Date().toISOString() } : e,
            ),
            auditLog:
              changes.length > 0
                ? [
                    ...state.auditLog,
                    auditEntry(
                      'ledgerEntry',
                      entryId,
                      entry.description,
                      'update',
                      isPaid ? 'Kiadás megjelölve kifizetettként' : 'Kiadás megjelölve kifizetetlenként',
                      changes,
                    ),
                  ]
                : state.auditLog,
          }
        }),

      updateLotVat: (lotId, input) =>
        set((state) => {
          const lot = state.lots.find((l) => l.id === lotId)
          if (!lot) return state
          const product = state.products.find((p) => p.id === lot.productId)
          const nextReclaimable = input.vatRatePercent !== undefined ? (input.vatReclaimable ?? true) : undefined
          const changes = diffFields(
            'lot',
            { vatRatePercent: lot.vatRatePercent, vatReclaimable: lot.vatReclaimable },
            { vatRatePercent: input.vatRatePercent, vatReclaimable: nextReclaimable },
          )
          return {
            lots: state.lots.map((l) => (l.id === lotId ? { ...l, vatRatePercent: input.vatRatePercent, vatReclaimable: nextReclaimable } : l)),
            auditLog:
              changes.length > 0
                ? [
                    ...state.auditLog,
                    auditEntry('lot', lotId, product?.name ?? 'Beszerzési tétel', 'update', 'Beszerzési tétel ÁFA adatai módosultak', changes),
                  ]
                : state.auditLog,
          }
        }),

      updateMovementVat: (movementId, vatRatePercent) =>
        set((state) => {
          const movement = state.movements.find((m) => m.id === movementId)
          if (!movement) return state
          const product = state.products.find((p) => p.id === movement.productId)
          const changes = diffFields('movement', { vatRatePercent: movement.vatRatePercent }, { vatRatePercent })
          return {
            movements: state.movements.map((m) => (m.id === movementId ? { ...m, vatRatePercent } : m)),
            auditLog:
              changes.length > 0
                ? [...state.auditLog, auditEntry('movement', movementId, product?.name ?? 'Mozgás', 'update', 'Mozgás ÁFA kulcsa módosult', changes)]
                : state.auditLog,
          }
        }),

      setSaleStatus: (movementId, status) =>
        set((state) => {
          const movement = state.movements.find((m) => m.id === movementId)
          if (!movement || movement.type !== 'out' || movement.deletedAt || movement.cancelled || movement.saleStatus === status) return state
          const product = state.products.find((p) => p.id === movement.productId)
          const changes = diffFields('movement', { saleStatus: movement.saleStatus }, { saleStatus: status })
          return {
            movements: state.movements.map((m) =>
              m.id === movementId ? { ...m, saleStatus: status, saleStatusChangedAt: new Date().toISOString() } : m,
            ),
            auditLog: [
              ...state.auditLog,
              auditEntry('movement', movementId, product?.name ?? 'Eladás', 'update', 'Eladási státusz módosítva', changes),
            ],
          }
        }),

      cancelSale: (movementId, reason) => {
        const movement = get().movements.find((m) => m.id === movementId)
        if (!movement) return { ok: false, reason: 'not-found' }
        if (movement.type !== 'out') return { ok: false, reason: 'not-a-sale' }
        if (movement.cancelled) return { ok: false, reason: 'already-cancelled' }

        const product = get().products.find((p) => p.id === movement.productId)
        // A cash/walk-in sale (no tracked customer) is always treated as
        // already paid - only a tracked customer's isPaid flag can say
        // otherwise (see Movement.isPaid's own doc comment).
        const wasPaid = movement.customerId ? movement.isPaid === true : true
        const trimmedReason = reason?.trim() || undefined

        set((state) => ({
          movements: state.movements.map((m) =>
            m.id === movementId ? { ...m, cancelled: true, cancelledAt: new Date().toISOString(), cancelReason: trimmedReason } : m,
          ),
          auditLog: [
            ...state.auditLog,
            auditEntry(
              'movement',
              movementId,
              product?.name ?? 'Eladás',
              'cancel',
              `Eladás visszavonva${trimmedReason ? ` (${trimmedReason})` : ''}`,
            ),
          ],
        }))

        // Restock via a synthetic correction 'in' movement at the sale's own
        // snapshotted cost basis, reusing recordMovement's lot-creation and
        // weighted-average update - cleaner and better-defined than trying
        // to reverse-engineer which original lot(s) the sale drew from.
        get().recordMovement({
          productId: movement.productId,
          type: 'in',
          quantity: movement.quantity,
          date: todayISO(),
          note: 'Visszavétel - eladás visszavonása miatt',
          unitPrice: movement.unitCost ?? 0,
          correctsMovementId: movementId,
        })

        return { ok: true, wasPaid }
      },

      deleteMovement: (id, mode) => {
        const movement = get().movements.find((m) => m.id === id)
        if (!movement) return
        const product = get().products.find((p) => p.id === movement.productId)
        const label = `${product?.name ?? 'Törölt termék'} (${movement.quantity} db)`

        // Once a day has a napi zárás (in any status), its movements can no
        // longer be freely soft-deleted at the location level - only the
        // correction-entry path is allowed, so an already-sent report is
        // never silently invalidated by a plain deletion (see flagClosingModified,
        // called from within recordMovement below).
        const isDayClosed = get().dailyClosings.some((c) => c.locationId === movement.locationId && c.date === movement.date)
        const effectiveMode: DeleteMovementMode = isDayClosed ? 'correction' : mode

        if (effectiveMode === 'correction') {
          const reverseType: MovementType = movement.type === 'in' ? 'out' : 'in'
          get().recordMovement(
            {
              productId: movement.productId,
              type: reverseType,
              quantity: movement.quantity,
              date: todayISO(),
              note: `Korrekció - érvényteleníti a(z) #${id.slice(0, 8)} mozgást`,
              unitPrice: reverseType === 'in' ? (movement.unitCost ?? 0) : undefined,
              correctsMovementId: id,
            },
            { allowNegativeStock: true },
          )
          set((state) => ({
            auditLog: [
              ...state.auditLog,
              auditEntry('movement', id, label, 'correction', `Korrekciós tétel létrehozva a(z) #${id.slice(0, 8)} mozgáshoz`),
            ],
          }))
          return
        }

        set((state) => {
          // Reverses the stock quantity and soft-deletes the lot an 'in'
          // movement created. Doesn't restore quantity to whichever lots an
          // 'out' movement consumed - once later sales have potentially
          // drawn from the same lots, unwinding that precisely isn't
          // well-defined, same as the weighted-average case.
          const reverseDelta = movement.type === 'in' ? -movement.quantity : movement.quantity
          const now = new Date().toISOString()
          return {
            movements: state.movements.map((m) => (m.id === id ? { ...m, deletedAt: now } : m)),
            lots: movement.type === 'in' ? state.lots.map((l) => (l.movementId === id ? { ...l, deletedAt: now } : l)) : state.lots,
            products: state.products.map((p) => (p.id === movement.productId ? { ...p, currentStock: p.currentStock + reverseDelta } : p)),
            auditLog: [
              ...state.auditLog,
              auditEntry('movement', id, label, 'delete', `Mozgás törölve (${movement.type === 'in' ? 'bejövő' : 'kimenő'})`),
            ],
          }
        })
      },

      restoreMovement: (id) =>
        set((state) => {
          const movement = state.movements.find((m) => m.id === id)
          if (!movement || !movement.deletedAt) return state
          const product = state.products.find((p) => p.id === movement.productId)
          const reapplyDelta = movement.type === 'in' ? movement.quantity : -movement.quantity
          return {
            movements: state.movements.map((m) => (m.id === id ? { ...m, deletedAt: undefined } : m)),
            lots: movement.type === 'in' ? state.lots.map((l) => (l.movementId === id ? { ...l, deletedAt: undefined } : l)) : state.lots,
            products: state.products.map((p) => (p.id === movement.productId ? { ...p, currentStock: p.currentStock + reapplyDelta } : p)),
            auditLog: [
              ...state.auditLog,
              auditEntry('movement', id, product?.name ?? 'Törölt termék', 'restore', 'Mozgás visszaállítva'),
            ],
          }
        }),

      submitDailyClosing: (locationId, date) => {
        const location = get().locations.find((l) => l.id === locationId)
        if (!location) return { ok: false, reason: 'location-not-found' }
        if (get().dailyClosings.some((c) => c.locationId === locationId && c.date === date)) {
          return { ok: false, reason: 'already-closed' }
        }
        const summary = buildDailyClosingSummary(get().movements, get().products, locationId, date)
        if (summary.inCount === 0 && summary.outCount === 0) {
          return { ok: false, reason: 'no-movements' }
        }

        const now = new Date().toISOString()
        const closing: DailyClosing = {
          id: createId(),
          locationId,
          date,
          submittedAt: now,
          status: 'submitted',
          inCount: summary.inCount,
          outCount: summary.outCount,
          productBreakdown: summary.productBreakdown,
          movementIds: summary.movementIds,
          createdAt: now,
        }
        set((state) => ({
          dailyClosings: [...state.dailyClosings, closing],
          auditLog: [
            ...state.auditLog,
            auditEntry(
              'dailyClosing',
              closing.id,
              `${location.name} - ${date}`,
              'create',
              `Napi zárás elküldve - ${location.name}, ${date} (${summary.inCount} bejövő, ${summary.outCount} kimenő tétel)`,
            ),
          ],
        }))
        return { ok: true, closingId: closing.id }
      },

      markDailyClosingViewed: (id) =>
        set((state) => {
          const closing = state.dailyClosings.find((c) => c.id === id)
          if (!closing || closing.status !== 'submitted') return state
          const location = state.locations.find((l) => l.id === closing.locationId)
          const label = `${location?.name ?? 'Ismeretlen telephely'} - ${closing.date}`
          return {
            dailyClosings: state.dailyClosings.map((c) => (c.id === id ? { ...c, status: 'viewed', viewedAt: new Date().toISOString() } : c)),
            auditLog: [...state.auditLog, auditEntry('dailyClosing', id, label, 'update', `Napi zárás megtekintve - ${label}`)],
          }
        }),

      approveDailyClosing: (id) =>
        set((state) => {
          const closing = state.dailyClosings.find((c) => c.id === id)
          if (!closing || closing.status === 'approved') return state
          const location = state.locations.find((l) => l.id === closing.locationId)
          const label = `${location?.name ?? 'Ismeretlen telephely'} - ${closing.date}`
          const now = new Date().toISOString()
          return {
            dailyClosings: state.dailyClosings.map((c) =>
              c.id === id ? { ...c, status: 'approved', approvedAt: now, viewedAt: c.viewedAt ?? now } : c,
            ),
            auditLog: [...state.auditLog, auditEntry('dailyClosing', id, label, 'update', `Napi zárás jóváhagyva - ${label}`)],
          }
        }),

      addLedgerEntry: (input) =>
        set((state) => {
          const category = input.category.trim()
          const now = new Date().toISOString()
          const entry: LedgerEntry = { ...input, category, id: createId(), createdAt: now, updatedAt: now }
          return {
            ledgerCategories: state.ledgerCategories.includes(category) ? state.ledgerCategories : [...state.ledgerCategories, category],
            ledgerEntries: [...state.ledgerEntries, entry],
            auditLog: [
              ...state.auditLog,
              auditEntry('ledgerEntry', entry.id, entry.description, 'create', `"${entry.description}" napló tétel létrehozva`),
            ],
          }
        }),

      updateLedgerEntry: (id, input) =>
        set((state) => {
          const existing = state.ledgerEntries.find((e) => e.id === id)
          if (!existing) return state
          const category = input.category.trim()
          const updated: LedgerEntry = {
            ...input,
            category,
            id,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
            deletedAt: existing.deletedAt,
          }
          const changes = diffFields('ledgerEntry', existing, updated)
          return {
            ledgerCategories: state.ledgerCategories.includes(category) ? state.ledgerCategories : [...state.ledgerCategories, category],
            ledgerEntries: state.ledgerEntries.map((e) => (e.id === id ? updated : e)),
            auditLog:
              changes.length > 0
                ? [
                    ...state.auditLog,
                    auditEntry('ledgerEntry', id, updated.description, 'update', `"${updated.description}" napló tétel módosult`, changes),
                  ]
                : state.auditLog,
          }
        }),

      deleteLedgerEntry: (id, mode) =>
        set((state) => {
          const entry = state.ledgerEntries.find((e) => e.id === id)
          if (!entry) return state

          if (mode === 'correction') {
            const now = new Date().toISOString()
            const correction: LedgerEntry = {
              id: createId(),
              date: todayISO(),
              type: entry.type === 'income' ? 'expense' : 'income',
              category: entry.category,
              description: `Korrekció - érvényteleníti a(z) #${id.slice(0, 8)} tételt (${entry.description})`,
              amount: entry.amount,
              currency: entry.currency,
              exchangeRate: entry.exchangeRate,
              note: `Eredeti tétel: ${entry.description}`,
              correctsEntryId: id,
              createdAt: now,
              updatedAt: now,
            }
            return {
              ledgerEntries: [...state.ledgerEntries, correction],
              auditLog: [
                ...state.auditLog,
                auditEntry(
                  'ledgerEntry',
                  correction.id,
                  correction.description,
                  'correction',
                  `Korrekciós tétel létrehozva a(z) #${id.slice(0, 8)} tételhez`,
                ),
              ],
            }
          }

          return {
            ledgerEntries: state.ledgerEntries.map((e) => (e.id === id ? { ...e, deletedAt: new Date().toISOString() } : e)),
            auditLog: [
              ...state.auditLog,
              auditEntry('ledgerEntry', id, entry.description, 'delete', `"${entry.description}" napló tétel törölve`),
            ],
          }
        }),

      restoreLedgerEntry: (id) =>
        set((state) => {
          const entry = state.ledgerEntries.find((e) => e.id === id)
          if (!entry || !entry.deletedAt) return state
          return {
            ledgerEntries: state.ledgerEntries.map((e) => (e.id === id ? { ...e, deletedAt: undefined } : e)),
            auditLog: [...state.auditLog, auditEntry('ledgerEntry', id, entry.description, 'restore', `"${entry.description}" napló tétel visszaállítva`)],
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
            ledgerEntries: [],
            ledgerCategories: [...DEFAULT_LEDGER_CATEGORIES],
            dailyClosings: [],
            auditLog: [],
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
