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

/** Nothing in this app is ever hard-deleted - every entity that a user can
 * remove instead gets a deletedAt timestamp (soft delete). Default views
 * filter these out; a "show deleted" toggle brings them back, greyed out
 * and restorable, so the audit trail never has a hole in it. */
export interface SoftDeletable {
  deletedAt?: string
}

export interface Location extends SoftDeletable {
  id: string
  name: string
}

export interface Supplier extends SoftDeletable {
  id: string
  name: string
  phone?: string
  email?: string
  /** Average delivery lead time in days, used for reorder alerts. */
  leadTimeDays: number
}

export interface Customer extends SoftDeletable {
  id: string
  name: string
  phone?: string
  email?: string
  notes?: string
}

export interface Product extends SoftDeletable {
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
  /** ÁFA kulcs (%) suggested when recording a purchase or sale of this
   * product - editable per transaction, see PurchaseLot.vatRatePercent and
   * Movement.vatRatePercent. Omitted means no rate is suggested; the
   * transaction then has to set one explicitly or goes untracked for VAT. */
  defaultVatRatePercent?: number
  createdAt: string
  updatedAt: string
}

/** One incoming batch of stock, at its own price - what "the beszerzési ár
 * is different every time we import" actually needs tracked. Created
 * automatically whenever an 'in' movement is recorded; consumed
 * oldest-first when costingMethod is 'fifo' (see lib/costing.ts). Kept
 * even in 'average' mode so switching methods later has real history to
 * work from. */
export interface PurchaseLot extends SoftDeletable {
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
  /** When the supplier invoice for this batch is due, if the user chose to
   * track it - an outgoing payment obligation, separate from the customer
   * balances tracked on sales. Omitted when payment tracking isn't used for
   * this batch. */
  dueDate?: string
  /** Whether the supplier invoice has been paid. Only meaningful when
   * dueDate is set; false is what drives the payment-obligation alerts. */
  isPaid?: boolean
  /** The actual date the invoice was paid, set when isPaid becomes true. */
  paidDate?: string
  /** ÁFA kulcs (%) actually applied to this batch - prefilled from the
   * product's defaultVatRatePercent when the purchase was recorded, but
   * overridable per batch and stored here so it's traceable after the
   * fact. Omitted entirely means this batch isn't tracked for VAT. */
  vatRatePercent?: number
  /** Only meaningful when vatRatePercent is set. true (the default) means
   * this VAT is reclaimable from the tax authority; false means it isn't,
   * in which case its amount folds into the lot's unit cost instead (see
   * lotUnitCost in lib/costing.ts) since it's then a real, unrecoverable cost. */
  vatReclaimable?: boolean
}

/** Fulfillment state of an outgoing sale, manually advanced by the user.
 * 'pending' - recorded, not yet shipped/handed over.
 * 'shipping' - on its way to the customer / staged for pickup.
 * 'delivered' - the customer has it - cancelling from here needs extra confirmation. */
export type SaleStatus = 'pending' | 'shipping' | 'delivered'

/** Two-step approval workflow, office <-> raktár, kept independent of
 * SaleStatus (which only tracks a finalized sale's own fulfillment).
 * `undefined` on a Movement means "already finalized" - identical to
 * 'approved' - so every movement recorded before this feature existed
 * (or recorded through the direct/immediate path, see recordMovement)
 * behaves exactly as it always has. While 'pending', a movement has NOT
 * yet touched currentStock/FIFO lots/VAT/alerts/napi zárás - see
 * isFinalizedMovement-style checks in lib/alerts.ts, lib/dailyClosing.ts
 * and lib/vat.ts. 'in': the office creates 'pending' (a purchase order);
 * a raktáros 'approves' it once the goods actually arrive (optionally
 * correcting `quantity` to what was actually received) - never
 * 'rejected', since an order that shouldn't happen is simply deleted
 * (see deleteMovement). 'out': a raktáros creates 'pending' (goods
 * prepared for shipment); the office 'approves' (finalizes the sale -
 * stock decreases, VAT generates) or 'rejects' (sends it back to the
 * raktáros for correction, with a reason). */
export type MovementApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface Movement extends SoftDeletable {
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
  /** 'out' only: the product's sale price at the moment of this sale,
   * snapshotted so a tracked customer's balance - and this sale's VAT
   * amount - don't silently change if the product's price is edited later. */
  saleUnitPrice?: number
  /** 'out' only: which tracked customer this was sold to. Omitted for a
   * plain walk-in/cash sale - that's the default and needs no tracking. */
  customerId?: string
  /** 'out' only, meaningful when customerId is set: whether the customer
   * has paid for this sale yet. Sales without a customerId are always
   * effectively "paid" (cash sale) and this is left unset for them. */
  isPaid?: boolean
  /** 'out' only: ÁFA kulcs (%) actually applied to this sale - prefilled
   * from the product's defaultVatRatePercent, overridable per sale. Sale
   * VAT is always owed to the tax authority (never reclaimable), so unlike
   * PurchaseLot there's no separate reclaimable flag. Omitted means this
   * sale isn't tracked for VAT. */
  vatRatePercent?: number
  /** 'out' only: fulfillment status, defaulted to 'pending' at creation and
   * advanced manually - see setSaleStatus in the store. */
  saleStatus?: SaleStatus
  /** When saleStatus last changed. */
  saleStatusChangedAt?: string
  /** 'out' only: true once this sale has been cancelled (stornó) - see
   * cancelSale in the store. The movement itself is never removed; a
   * cancelled sale stays visible (struck through) for full auditability,
   * and its stock effect is reversed via a separate correction 'in'
   * movement (see correctsMovementId on THAT movement) rather than by
   * mutating this one's quantity. */
  cancelled?: boolean
  cancelledAt?: string
  /** Free-text reason for the cancellation, e.g. "hibás termék", "ügyfél lemondta". */
  cancelReason?: string
  /** Set on a movement that exists specifically to reverse/correct another
   * one (a stock restock from cancelSale, or a manually created correction
   * from deleteMovement's "korrekciós tétel" option) - points at the
   * original movement's id so the pair stays traceable both ways. */
  correctsMovementId?: string
  /** See MovementApprovalStatus. Omitted = already finalized (identical to
   * 'approved') - the default for every direct/immediate recordMovement
   * call and every movement recorded before this feature existed. */
  approvalStatus?: MovementApprovalStatus
  /** 'in' + ever-pending only: the quantity originally ordered by the
   * office. Once approved, `quantity` holds the ACTUALLY received amount
   * (which is what affects stock) - this field preserves what was
   * requested, so a shortage/overage stays traceable instead of silently
   * overwriting the order. */
  orderedQuantity?: number
  /** Free-text note recorded at approval/rejection time when the actual
   * outcome differs from what was proposed (short/damaged delivery, a
   * data problem on a sale) - this is the "notification" the other side
   * sees: it just surfaces on the movement in their own list/history. */
  discrepancyNote?: string
  approvedAt?: string
  rejectedAt?: string
  rejectReason?: string
}

export type LedgerEntryType = 'income' | 'expense'

/** For ÁFA-category entries: whether this is VAT owed to the tax
 * authority, or VAT that can be reclaimed. */
export type VatDirection = 'payable' | 'reclaimable'

/** The category name that gets ÁFA-specific fields (rate, direction). Kept
 * as a constant rather than a fixed enum member because categories are
 * otherwise free text - this one just has to match exactly. */
export const VAT_CATEGORY = 'ÁFA'

/** Seeded once; grows as the user types new category names via the
 * "Egyéb" option on the ledger entry form - see addLedgerEntry. */
export const DEFAULT_LEDGER_CATEGORIES = ['ÁFA', 'Bérköltség', 'Bérjárulék', 'Bérpótlék', 'Osztalék', 'Bérleti díj']

/** A general income/expense entry, independent of stock movements or
 * customers - rent, payroll, dividends, VAT, or anything else that needs
 * booking for a simple profit & loss view (see lib/ledger.ts). */
export interface LedgerEntry extends SoftDeletable {
  id: string
  date: string
  type: LedgerEntryType
  /** Free text, but drawn from (and appended to) Settings-level category list. */
  category: string
  description: string
  /** Amount in `currency`. */
  amount: number
  currency: Currency
  /** HUF value of 1 unit of `currency` at the time - always 1 for HUF. */
  exchangeRate: number
  note?: string
  /** Only set when category === VAT_CATEGORY. */
  vatRatePercent?: number
  vatDirection?: VatDirection
  /** Payment due date for an outgoing (expense) obligation - rent, payroll,
   * a supplier bill booked directly into the ledger, etc. Meaningless for
   * income entries. Omitted when payment tracking isn't used for this entry. */
  dueDate?: string
  /** Whether this expense has been paid. Only meaningful when dueDate is
   * set; false is what drives the payment-obligation alerts. */
  isPaid?: boolean
  /** The actual date the expense was paid, set when isPaid becomes true. */
  paidDate?: string
  /** Set on an entry created specifically to reverse/neutralize another one
   * (the "korrekciós tétel" offered by deleteLedgerEntry) - points at the
   * original entry's id. The original stays untouched and active; this
   * entry (opposite type, same category and amount) is what nets it to
   * zero in the category/P&L totals while keeping both fully visible. */
  correctsEntryId?: string
  createdAt: string
  updatedAt: string
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
  /** How many days before a payment's due date to start flagging it as
   * "upcoming" - e.g. [7, 3, 1] warns a week, 3 days, and 1 day out. Only
   * the largest value actually widens the alert window; the others exist
   * so the UI can call out "3 nap múlva" style urgency steps. */
  paymentReminderDaysBefore: number[]
  /** ÁFA kulcs (%) suggested on the product form when creating a brand new
   * product - just a starting value for Product.defaultVatRatePercent,
   * freely overridable there and again per transaction. */
  defaultVatRatePercentForNewProducts: number
  /** How many days after a calendar day ends the system waits before
   * flagging a location's missing daily closing (see DailyClosing below) -
   * 0 means it's flagged the very next day, 1 waits one extra day, etc. */
  missingClosingGraceDays: number
}

export const DEFAULT_SETTINGS: Settings = {
  costingMethod: 'average',
  avgConsumptionWindowDays: 30,
  safetyStockDays: 7,
  reorderTargetDays: 30,
  slowMovingWindowDays: 60,
  slowMovingThresholdPercent: 70,
  paymentReminderDaysBefore: [7, 3, 1],
  defaultVatRatePercentForNewProducts: 27,
  missingClosingGraceDays: 0,
}

export const DEFAULT_LOCATION_NAME = 'Fő telephely'

export const COMMON_UNITS = ['db', 'm²', 'fm', 'kg', 'l', 'csomag', 'raklap'] as const

// --- Audit log -------------------------------------------------------------
// A single, append-only log covering every entity in the app (see
// lib/audit.ts for the diffing/labeling logic that builds these entries).
// Powers both the standalone Audit napló page and each entity's own
// "Előzmények" panel (just filtered by entityType + entityId).

export type AuditEntityType = 'product' | 'lot' | 'movement' | 'customer' | 'supplier' | 'location' | 'ledgerEntry' | 'dailyClosing'

export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'cancel' | 'correction'

export interface AuditFieldChange {
  field: string
  /** Human-readable label for `field`, already localized - so the UI never
   * has to re-derive it from the raw key. */
  label: string
  oldValue: string
  newValue: string
}

export interface AuditLogEntry {
  id: string
  timestamp: string
  entityType: AuditEntityType
  entityId: string
  /** A human-readable name for the record at the time of the event (e.g.
   * the product's name) - kept even if the entity is later renamed or
   * deleted, so the log entry still reads sensibly. */
  entityLabel: string
  action: AuditAction
  description: string
  changes?: AuditFieldChange[]
}

// --- Napi zárás (daily closing) --------------------------------------------
// One location's "day is done, here's everything that moved" package, sent
// to the office/HQ for review. Never deleted or rewritten in place - once
// submitted, a closing is a permanent historical record (see lib/dailyClosing.ts
// for how it's built and store/useStore.ts for how corrections after the
// fact only ever flag it as modifiedAfterSubmission, never edit its numbers).

export type DailyClosingStatus = 'submitted' | 'viewed' | 'approved'

export interface DailyClosingProductRow {
  productId: string
  /** Snapshotted at closing time so a later product rename/deletion doesn't
   * change how a past closing reads. */
  productName: string
  unit: string
  inQuantity: number
  outQuantity: number
}

export interface DailyClosing {
  id: string
  locationId: string
  /** The calendar day being closed (YYYY-MM-DD) - not the submission timestamp. */
  date: string
  submittedAt: string
  status: DailyClosingStatus
  /** Set once the office opens this closing's detail view. */
  viewedAt?: string
  /** Set once the office explicitly approves this closing. */
  approvedAt?: string
  /** How many individual bejövő/kimenő mozgás records this closing bundled -
   * kept separate from the per-product quantities since a product's unit
   * varies (db/kg/m²), so a single combined "quantity" wouldn't be meaningful. */
  inCount: number
  outCount: number
  productBreakdown: DailyClosingProductRow[]
  /** Every movement id captured in this closing, for traceability back to
   * the Mozgásnapló. */
  movementIds: string[]
  /** Set when a movement this closing covers was later corrected (or a new
   * movement was recorded for this same location+date after submission) -
   * the closing's own numbers are never rewritten, this just flags that the
   * office should double-check it. See flagClosingModified in useStore.ts. */
  modifiedAfterSubmission?: boolean
  lastModifiedAt?: string
  createdAt: string
}
