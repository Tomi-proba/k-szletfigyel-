// Supabase-backed persistence for the SHARED business data (locations,
// products, movements, purchase lots, daily closings, audit log) - the slice
// of the app that raktáros/iroda role-based views need to actually share
// across separate devices. See DOCUMENTATION.md 14. fejezet for the full
// rationale and for what deliberately stays localStorage-only (suppliers,
// customers, ledger entries, settings).
//
// Design: the Zustand store (useStore.ts) keeps ALL of its existing
// synchronous, in-memory mutation logic (FIFO, weighted-average, audit
// diffing, correction entries, ...) completely unchanged. This module only
// adds a persistence side-channel: after every state update, useStore diffs
// the new array against the previous one BY REFERENCE (every mutation in
// useStore.ts already creates new object references only for the item(s)
// that actually changed, via `.map(x => x.id === id ? {...x, ...} : x)`
// style updates) and pushes just the changed/added rows here. Deviating from
// that pattern in a new store action would silently break sync for it.
//
// This is a "local-first, best-effort" sync: a write is applied to local
// memory immediately (so the UI never waits on the network), and mirrored to
// Supabase in the background. If the remote write is rejected (e.g. an RLS
// violation, or a dropped connection) it is logged to the console but NOT
// rolled back locally - see DOCUMENTATION.md 14. fejezet for this tradeoff.
import { supabase } from './supabase'
import type { AuditLogEntry, DailyClosing, Location, Movement, Product, PurchaseLot } from '../types'

export interface BusinessSlices {
  locations: Location[]
  products: Product[]
  lots: PurchaseLot[]
  movements: Movement[]
  dailyClosings: DailyClosing[]
  auditLog: AuditLogEntry[]
}

export const emptyBusinessSlices: BusinessSlices = {
  locations: [],
  products: [],
  lots: [],
  movements: [],
  dailyClosings: [],
  auditLog: [],
}

function client() {
  if (!supabase) throw new Error('Supabase nincs konfigurálva.')
  return supabase
}

// --- row <-> app-type mappers -----------------------------------------------

function locationFromRow(row: Record<string, unknown>): Location {
  return { id: row.id as string, name: row.name as string, deletedAt: (row.deleted_at as string | null) ?? undefined }
}
function locationToRow(companyId: string, l: Location) {
  return { id: l.id, company_id: companyId, name: l.name, deleted_at: l.deletedAt ?? null }
}

function productFromRow(row: Record<string, unknown>): Product {
  return {
    id: row.id as string,
    name: row.name as string,
    sku: (row.sku as string | null) ?? undefined,
    category: row.category as string,
    unit: row.unit as string,
    currentStock: Number(row.current_stock),
    minStock: Number(row.min_stock),
    purchasePrice: Number(row.purchase_price),
    salePrice: Number(row.sale_price),
    supplierId: (row.supplier_id as string | null) ?? undefined,
    locationId: row.location_id as string,
    defaultVatRatePercent: row.default_vat_rate_percent === null ? undefined : Number(row.default_vat_rate_percent),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string | null) ?? undefined,
  }
}
function productToRow(companyId: string, p: Product) {
  return {
    id: p.id,
    company_id: companyId,
    location_id: p.locationId,
    name: p.name,
    sku: p.sku ?? null,
    category: p.category,
    unit: p.unit,
    current_stock: p.currentStock,
    min_stock: p.minStock,
    purchase_price: p.purchasePrice,
    sale_price: p.salePrice,
    supplier_id: p.supplierId ?? null,
    default_vat_rate_percent: p.defaultVatRatePercent ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    deleted_at: p.deletedAt ?? null,
  }
}

function lotFromRow(row: Record<string, unknown>): PurchaseLot {
  return {
    id: row.id as string,
    productId: row.product_id as string,
    movementId: (row.movement_id as string | null) ?? '',
    date: row.date as string,
    quantity: Number(row.quantity),
    remainingQuantity: Number(row.remaining_quantity),
    unitPrice: Number(row.unit_price),
    shippingCost: Number(row.shipping_cost),
    currency: row.currency as PurchaseLot['currency'],
    exchangeRate: Number(row.exchange_rate),
    createdAt: row.created_at as string,
    dueDate: (row.due_date as string | null) ?? undefined,
    isPaid: (row.is_paid as boolean | null) ?? undefined,
    paidDate: (row.paid_date as string | null) ?? undefined,
    vatRatePercent: row.vat_rate_percent === null ? undefined : Number(row.vat_rate_percent),
    vatReclaimable: (row.vat_reclaimable as boolean | null) ?? undefined,
    deletedAt: (row.deleted_at as string | null) ?? undefined,
  }
}
function lotToRow(companyId: string, l: PurchaseLot) {
  return {
    id: l.id,
    company_id: companyId,
    product_id: l.productId,
    movement_id: l.movementId || null,
    date: l.date,
    quantity: l.quantity,
    remaining_quantity: l.remainingQuantity,
    unit_price: l.unitPrice,
    shipping_cost: l.shippingCost,
    currency: l.currency,
    exchange_rate: l.exchangeRate,
    created_at: l.createdAt,
    due_date: l.dueDate ?? null,
    is_paid: l.isPaid ?? null,
    paid_date: l.paidDate ?? null,
    vat_rate_percent: l.vatRatePercent ?? null,
    vat_reclaimable: l.vatReclaimable ?? null,
    deleted_at: l.deletedAt ?? null,
  }
}

function movementFromRow(row: Record<string, unknown>): Movement {
  return {
    id: row.id as string,
    productId: row.product_id as string,
    locationId: row.location_id as string,
    date: row.date as string,
    type: row.type as Movement['type'],
    quantity: Number(row.quantity),
    note: (row.note as string | null) ?? undefined,
    createdAt: row.created_at as string,
    unitPrice: row.unit_price === null ? undefined : Number(row.unit_price),
    shippingCost: row.shipping_cost === null ? undefined : Number(row.shipping_cost),
    currency: (row.currency as Movement['currency']) ?? undefined,
    exchangeRate: row.exchange_rate === null ? undefined : Number(row.exchange_rate),
    unitCost: row.unit_cost === null ? undefined : Number(row.unit_cost),
    saleUnitPrice: row.sale_unit_price === null ? undefined : Number(row.sale_unit_price),
    customerId: (row.customer_id as string | null) ?? undefined,
    isPaid: (row.is_paid as boolean | null) ?? undefined,
    vatRatePercent: row.vat_rate_percent === null ? undefined : Number(row.vat_rate_percent),
    saleStatus: (row.sale_status as Movement['saleStatus']) ?? undefined,
    saleStatusChangedAt: (row.sale_status_changed_at as string | null) ?? undefined,
    cancelled: Boolean(row.cancelled) || undefined,
    cancelledAt: (row.cancelled_at as string | null) ?? undefined,
    cancelReason: (row.cancel_reason as string | null) ?? undefined,
    correctsMovementId: (row.corrects_movement_id as string | null) ?? undefined,
    deletedAt: (row.deleted_at as string | null) ?? undefined,
  }
}
function movementToRow(companyId: string, m: Movement) {
  return {
    id: m.id,
    company_id: companyId,
    product_id: m.productId,
    location_id: m.locationId,
    date: m.date,
    type: m.type,
    quantity: m.quantity,
    note: m.note ?? null,
    created_at: m.createdAt,
    unit_price: m.unitPrice ?? null,
    shipping_cost: m.shippingCost ?? null,
    currency: m.currency ?? null,
    exchange_rate: m.exchangeRate ?? null,
    unit_cost: m.unitCost ?? null,
    sale_unit_price: m.saleUnitPrice ?? null,
    customer_id: m.customerId ?? null,
    is_paid: m.isPaid ?? null,
    vat_rate_percent: m.vatRatePercent ?? null,
    sale_status: m.saleStatus ?? null,
    sale_status_changed_at: m.saleStatusChangedAt ?? null,
    cancelled: m.cancelled ?? false,
    cancelled_at: m.cancelledAt ?? null,
    cancel_reason: m.cancelReason ?? null,
    corrects_movement_id: m.correctsMovementId ?? null,
    deleted_at: m.deletedAt ?? null,
  }
}

function closingFromRow(row: Record<string, unknown>): DailyClosing {
  return {
    id: row.id as string,
    locationId: row.location_id as string,
    date: row.date as string,
    submittedAt: row.submitted_at as string,
    status: row.status as DailyClosing['status'],
    viewedAt: (row.viewed_at as string | null) ?? undefined,
    approvedAt: (row.approved_at as string | null) ?? undefined,
    inCount: Number(row.in_count),
    outCount: Number(row.out_count),
    productBreakdown: (row.product_breakdown as DailyClosing['productBreakdown']) ?? [],
    movementIds: (row.movement_ids as string[]) ?? [],
    modifiedAfterSubmission: Boolean(row.modified_after_submission) || undefined,
    lastModifiedAt: (row.last_modified_at as string | null) ?? undefined,
    createdAt: row.created_at as string,
  }
}
function closingToRow(companyId: string, c: DailyClosing) {
  return {
    id: c.id,
    company_id: companyId,
    location_id: c.locationId,
    date: c.date,
    submitted_at: c.submittedAt,
    status: c.status,
    viewed_at: c.viewedAt ?? null,
    approved_at: c.approvedAt ?? null,
    in_count: c.inCount,
    out_count: c.outCount,
    product_breakdown: c.productBreakdown,
    movement_ids: c.movementIds,
    modified_after_submission: c.modifiedAfterSubmission ?? false,
    last_modified_at: c.lastModifiedAt ?? null,
    created_at: c.createdAt,
  }
}

function auditFromRow(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: row.id as string,
    timestamp: row.event_timestamp as string,
    entityType: row.entity_type as AuditLogEntry['entityType'],
    entityId: row.entity_id as string,
    entityLabel: row.entity_label as string,
    action: row.action as AuditLogEntry['action'],
    description: row.description as string,
    changes: (row.changes as AuditLogEntry['changes']) ?? undefined,
  }
}
function auditToRow(companyId: string, a: AuditLogEntry) {
  return {
    id: a.id,
    company_id: companyId,
    event_timestamp: a.timestamp,
    entity_type: a.entityType,
    entity_id: a.entityId,
    entity_label: a.entityLabel,
    action: a.action,
    description: a.description,
    changes: a.changes ?? null,
  }
}

// --- fetch (RLS on the server does all the company/location filtering) -----

export async function fetchBusinessData(): Promise<BusinessSlices> {
  const db = client()
  const [locations, products, lots, movements, dailyClosings, auditLog] = await Promise.all([
    db.from('locations').select('*'),
    db.from('products').select('*'),
    db.from('purchase_lots').select('*'),
    db.from('movements').select('*'),
    db.from('daily_closings').select('*'),
    db.from('audit_log').select('*').order('event_timestamp', { ascending: true }),
  ])
  for (const result of [locations, products, lots, movements, dailyClosings, auditLog]) {
    if (result.error) throw result.error
  }
  return {
    locations: (locations.data ?? []).map(locationFromRow),
    products: (products.data ?? []).map(productFromRow),
    lots: (lots.data ?? []).map(lotFromRow),
    movements: (movements.data ?? []).map(movementFromRow),
    dailyClosings: (dailyClosings.data ?? []).map(closingFromRow),
    auditLog: (auditLog.data ?? []).map(auditFromRow),
  }
}

// --- push (fire-and-forget upserts, called from useStore's sync wrapper) ---

function pushChangedRows<T extends { id: string }>(companyId: string, next: T[], prev: T[], upsert: (companyId: string, item: T) => Promise<void>) {
  if (next === prev) return
  const prevById = new Map(prev.map((item) => [item.id, item]))
  for (const item of next) {
    if (prevById.get(item.id) !== item) {
      upsert(companyId, item).catch((err) => console.error('[remoteSync] write failed', err))
    }
  }
}

async function upsertLocation(companyId: string, l: Location) {
  const { error } = await client().from('locations').upsert(locationToRow(companyId, l))
  if (error) throw error
}
async function upsertProduct(companyId: string, p: Product) {
  const { error } = await client().from('products').upsert(productToRow(companyId, p))
  if (error) throw error
}
async function upsertLot(companyId: string, l: PurchaseLot) {
  const { error } = await client().from('purchase_lots').upsert(lotToRow(companyId, l))
  if (error) throw error
}
async function upsertMovement(companyId: string, m: Movement) {
  const { error } = await client().from('movements').upsert(movementToRow(companyId, m))
  if (error) throw error
}
async function upsertClosing(companyId: string, c: DailyClosing) {
  const { error } = await client().from('daily_closings').upsert(closingToRow(companyId, c))
  if (error) throw error
}
async function insertAudit(companyId: string, a: AuditLogEntry) {
  // Audit rows are append-only - never updated after creation - but upsert
  // is harmless (and simpler than tracking "is this new") since an audit
  // entry's id, once created locally, is never mutated in place.
  const { error } = await client().from('audit_log').upsert(auditToRow(companyId, a))
  if (error) throw error
}

/** Called by useStore after every state update while in remote mode - diffs
 * each of the 6 synced slices against their pre-update value BY REFERENCE
 * and pushes whatever changed. See the file-level comment for why reference
 * equality is a safe and sufficient diffing strategy here. */
export function pushBusinessDiffs(companyId: string, prev: BusinessSlices, next: BusinessSlices) {
  pushChangedRows(companyId, next.locations, prev.locations, upsertLocation)
  pushChangedRows(companyId, next.products, prev.products, upsertProduct)
  pushChangedRows(companyId, next.lots, prev.lots, upsertLot)
  pushChangedRows(companyId, next.movements, prev.movements, upsertMovement)
  pushChangedRows(companyId, next.dailyClosings, prev.dailyClosings, upsertClosing)
  pushChangedRows(companyId, next.auditLog, prev.auditLog, insertAudit)
}
