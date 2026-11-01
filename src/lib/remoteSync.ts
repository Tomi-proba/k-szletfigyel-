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
import { createId } from '../store/id'
import {
  DEFAULT_LEDGER_CATEGORIES,
  DEFAULT_SETTINGS,
  type AuditLogEntry,
  type Customer,
  type DailyClosing,
  type LedgerEntry,
  type Location,
  type Movement,
  type Product,
  type PurchaseLot,
  type RecurringLedgerEntry,
  type Settings,
  type Supplier,
} from '../types'
import { mapPendingChangeRow, type PendingChange } from '../types/auth'
import { hibaBesorolas, type KuldesEredmeny, type MentesiTetel, type Valtozas } from './mentesiSor'

export interface BusinessSlices {
  locations: Location[]
  products: Product[]
  lots: PurchaseLot[]
  movements: Movement[]
  dailyClosings: DailyClosing[]
  auditLog: AuditLogEntry[]
  pendingChanges: PendingChange[]
  // 2026-10-23-tól ezek is a szerveren vannak (korábban csak a böngészőben):
  suppliers: Supplier[]
  customers: Customer[]
  ledgerEntries: LedgerEntry[]
  recurringLedgerEntries: RecurringLedgerEntry[]
  settings: Settings
  ledgerCategories: string[]
}

export const emptyBusinessSlices: BusinessSlices = {
  locations: [],
  products: [],
  lots: [],
  movements: [],
  dailyClosings: [],
  auditLog: [],
  pendingChanges: [],
  suppliers: [],
  customers: [],
  ledgerEntries: [],
  recurringLedgerEntries: [],
  settings: DEFAULT_SETTINGS,
  ledgerCategories: [...DEFAULT_LEDGER_CATEGORIES],
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
    fizetesKonyvelobol: Boolean(row.fizetes_konyvelobol) || undefined,
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
    approvalStatus: (row.approval_status as Movement['approvalStatus']) ?? undefined,
    orderedQuantity: row.ordered_quantity === null || row.ordered_quantity === undefined ? undefined : Number(row.ordered_quantity),
    discrepancyNote: (row.discrepancy_note as string | null) ?? undefined,
    approvedAt: (row.approved_at as string | null) ?? undefined,
    rejectedAt: (row.rejected_at as string | null) ?? undefined,
    rejectReason: (row.reject_reason as string | null) ?? undefined,
    ok: (row.ok as Movement['ok'] | null) ?? undefined,
    returnOfMovementId: (row.return_of_movement_id as string | null) ?? undefined,
    invoiceNumber: (row.invoice_number as string | null) ?? undefined,
    invoiceDate: (row.invoice_date as string | null) ?? undefined,
    fulfillmentDate: (row.fulfillment_date as string | null) ?? undefined,
    shippingOnInvoice: row.shipping_on_invoice === null || row.shipping_on_invoice === undefined ? undefined : Boolean(row.shipping_on_invoice),
    integracioEsemenyId: (row.integracio_esemeny_id as string | null) ?? undefined,
    integracioDokumentumId: (row.integracio_dokumentum_id as string | null) ?? undefined,
    integracioForras: (row.integracio_forras as string | null) ?? undefined,
    integracioForrasUtvonal: (row.integracio_forras_utvonal as string | null) ?? undefined,
    fizetesKonyvelobol: Boolean(row.fizetes_konyvelobol) || undefined,
  }
}
// Az integracio_* és a fizetes_konyvelobol mezőt csak az integrációs szolgáltatás írja: a böngésző nem küldi.
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
    approval_status: m.approvalStatus ?? null,
    ordered_quantity: m.orderedQuantity ?? null,
    discrepancy_note: m.discrepancyNote ?? null,
    approved_at: m.approvedAt ?? null,
    rejected_at: m.rejectedAt ?? null,
    reject_reason: m.rejectReason ?? null,
    ok: m.ok ?? null,
    return_of_movement_id: m.returnOfMovementId ?? null,
    invoice_number: m.invoiceNumber ?? null,
    invoice_date: m.invoiceDate ?? null,
    fulfillment_date: m.fulfillmentDate ?? null,
    shipping_on_invoice: m.shippingOnInvoice ?? null,
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
    performedByName: (row.created_by_name as string | null) ?? undefined,
    performedByEmail: (row.created_by_email as string | null) ?? undefined,
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
    // created_by (uuid) nincs itt megadva - a schema.sql-ben beállított
    // `default auth.uid()` tölti ki a szerveren, a ténylegesen beküldő
    // (RLS-ellenőrzött) felhasználóval. A név/email denormalizált
    // pillanatkép viszont a kliensről jön, a setAuditActor-ral beállított
    // értékből (lásd store/useStore.ts auditEntry).
    created_by_name: a.performedByName ?? null,
    created_by_email: a.performedByEmail ?? null,
  }
}

function pendingChangeToRow(companyId: string, c: PendingChange) {
  return {
    id: c.id,
    company_id: companyId,
    entity_type: c.entityType,
    entity_id: c.entityId,
    action: c.action,
    payload: c.payload,
    summary: c.summary,
    requested_by: c.requestedBy,
    requested_by_email: c.requestedByEmail,
    requested_at: c.requestedAt,
    status: c.status,
    reviewed_by: c.reviewedBy,
    reviewed_by_email: c.reviewedByEmail,
    reviewed_at: c.reviewedAt,
    reject_reason: c.rejectReason,
  }
}

// --- 2026-10-23: a korábban csak böngészőben tárolt adatok -----------------------------

const opt = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T))
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v))

function supplierFromRow(row: Record<string, unknown>): Supplier {
  return {
    id: row.id as string,
    name: row.name as string,
    phone: opt(row.phone),
    email: opt(row.email),
    leadTimeDays: Number(row.lead_time_days),
    deletedAt: opt(row.deleted_at),
  }
}
function supplierToRow(companyId: string, s: Supplier) {
  return {
    id: s.id,
    company_id: companyId,
    name: s.name,
    phone: s.phone ?? null,
    email: s.email ?? null,
    lead_time_days: s.leadTimeDays,
    deleted_at: s.deletedAt ?? null,
  }
}

function customerFromRow(row: Record<string, unknown>): Customer {
  return {
    id: row.id as string,
    name: row.name as string,
    phone: opt(row.phone),
    email: opt(row.email),
    notes: opt(row.notes),
    deletedAt: opt(row.deleted_at),
  }
}
function customerToRow(companyId: string, c: Customer) {
  return {
    id: c.id,
    company_id: companyId,
    name: c.name,
    phone: c.phone ?? null,
    email: c.email ?? null,
    notes: c.notes ?? null,
    deleted_at: c.deletedAt ?? null,
  }
}

function ledgerFromRow(row: Record<string, unknown>): LedgerEntry {
  return {
    id: row.id as string,
    date: row.date as string,
    type: row.type as LedgerEntry['type'],
    category: row.category as string,
    description: row.description as string,
    amount: Number(row.amount),
    currency: row.currency as LedgerEntry['currency'],
    exchangeRate: Number(row.exchange_rate),
    note: opt(row.note),
    vatRatePercent: optNum(row.vat_rate_percent),
    vatDirection: opt(row.vat_direction),
    dueDate: opt(row.due_date),
    isPaid: opt(row.is_paid),
    paidDate: opt(row.paid_date),
    correctsEntryId: opt(row.corrects_entry_id),
    recurringEntryId: opt(row.recurring_entry_id),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: opt(row.deleted_at),
  }
}
function ledgerToRow(companyId: string, e: LedgerEntry) {
  return {
    id: e.id,
    company_id: companyId,
    date: e.date,
    type: e.type,
    category: e.category,
    description: e.description,
    amount: e.amount,
    currency: e.currency,
    exchange_rate: e.exchangeRate,
    note: e.note ?? null,
    vat_rate_percent: e.vatRatePercent ?? null,
    vat_direction: e.vatDirection ?? null,
    due_date: e.dueDate ?? null,
    is_paid: e.isPaid ?? null,
    paid_date: e.paidDate ?? null,
    corrects_entry_id: e.correctsEntryId ?? null,
    recurring_entry_id: e.recurringEntryId ?? null,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
    deleted_at: e.deletedAt ?? null,
  }
}

function recurringFromRow(row: Record<string, unknown>): RecurringLedgerEntry {
  return {
    id: row.id as string,
    type: row.type as RecurringLedgerEntry['type'],
    category: row.category as string,
    description: row.description as string,
    amount: Number(row.amount),
    currency: row.currency as RecurringLedgerEntry['currency'],
    exchangeRate: Number(row.exchange_rate),
    note: opt(row.note),
    dayOfMonth: Number(row.day_of_month),
    startDate: row.start_date as string,
    endDate: opt(row.end_date),
    active: Boolean(row.active),
    lastGeneratedMonth: opt(row.last_generated_month),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: opt(row.deleted_at),
  }
}
function recurringToRow(companyId: string, r: RecurringLedgerEntry) {
  return {
    id: r.id,
    company_id: companyId,
    type: r.type,
    category: r.category,
    description: r.description,
    amount: r.amount,
    currency: r.currency,
    exchange_rate: r.exchangeRate,
    note: r.note ?? null,
    day_of_month: r.dayOfMonth,
    start_date: r.startDate,
    end_date: r.endDate ?? null,
    active: r.active,
    last_generated_month: r.lastGeneratedMonth ?? null,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    deleted_at: r.deletedAt ?? null,
  }
}

function settingsToRow(companyId: string, settings: Settings, ledgerCategories: string[]) {
  return { id: companyId, company_id: companyId, settings, ledger_categories: ledgerCategories, updated_at: new Date().toISOString() }
}

// --- letöltés (a szűrést a szerveren az RLS végzi) ----------------------------------

export async function fetchBusinessData(companyId: string, opts: { naplot: boolean }): Promise<BusinessSlices> {
  const db = client()
  // A raktárosnak a pénzügyi naplóhoz nincs joga (üres listát kapna); a lekérdezést nem is küldjük el.
  const ures = Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
  const [locations, products, lots, movements, dailyClosings, auditLog, pendingChanges, suppliers, customers, ledger, recurring, settings] =
    await Promise.all([
      db.from('locations').select('*'),
      db.from('products').select('*'),
      db.from('purchase_lots').select('*'),
      db.from('movements').select('*'),
      db.from('daily_closings').select('*'),
      db.from('audit_log').select('*').order('event_timestamp', { ascending: true }),
      db.from('pending_changes').select('*').order('requested_at', { ascending: false }),
      db.from('suppliers').select('*'),
      db.from('customers').select('*'),
      opts.naplot ? db.from('ledger_entries').select('*') : ures,
      opts.naplot ? db.from('recurring_ledger_entries').select('*') : ures,
      db.from('company_settings').select('*').eq('id', companyId).maybeSingle(),
    ])
  for (const result of [locations, products, lots, movements, dailyClosings, auditLog, pendingChanges, suppliers, customers, ledger, recurring, settings]) {
    if (result.error) throw result.error
  }
  const verziok = ismertVerziok
  verziok.clear()
  const jegyez = (tabla: string, rows: Record<string, unknown>[] | null) => {
    for (const row of rows ?? []) if (row.version !== undefined) verziok.set(`${tabla}:${row.id as string}`, Number(row.version))
    return rows ?? []
  }
  const beallitasSor = settings.data as Record<string, unknown> | null
  if (beallitasSor) jegyez('company_settings', [beallitasSor])
  return {
    locations: jegyez('locations', locations.data).map(locationFromRow),
    products: jegyez('products', products.data).map(productFromRow),
    lots: jegyez('purchase_lots', lots.data).map(lotFromRow),
    movements: jegyez('movements', movements.data).map(movementFromRow),
    dailyClosings: jegyez('daily_closings', dailyClosings.data).map(closingFromRow),
    auditLog: (auditLog.data ?? []).map(auditFromRow),
    pendingChanges: jegyez('pending_changes', pendingChanges.data).map(mapPendingChangeRow),
    suppliers: jegyez('suppliers', suppliers.data).map(supplierFromRow),
    customers: jegyez('customers', customers.data).map(customerFromRow),
    ledgerEntries: jegyez('ledger_entries', ledger.data).map(ledgerFromRow),
    recurringLedgerEntries: jegyez('recurring_ledger_entries', recurring.data).map(recurringFromRow),
    settings: beallitasSor ? { ...DEFAULT_SETTINGS, ...(beallitasSor.settings as Partial<Settings>) } : DEFAULT_SETTINGS,
    ledgerCategories: beallitasSor ? (beallitasSor.ledger_categories as string[]) : [...DEFAULT_LEDGER_CATEGORIES],
  }
}

// --- frissítés: amit az integrációs szolgáltatás változtatott (TERV.md F15.4) -------------------------

/** Csak ennyi napnál nem régebbi, a Könyvelőből jött mozgásokat frissítünk (a régiek már lezártak). */
const INTEGRACIO_FRISSITES_NAP = 60

/**
 * A szerveren az integrációs szolgáltatás által létrehozott vagy módosított sorok: a Könyvelőből jött
 * (jóváhagyandó) mozgások és a Könyvelő által követett fizetési állapot. Csak azokat a sorokat adja
 * vissza, amelyek újabbak (nagyobb verziójúak), mint amit a böngésző ismer, és nincsenek épp mentés alatt
 * (`foglalt`: „tabla:id” kulcsok); ezek verzióját fel is jegyzi. Így egy közben itt végzett, még el nem
 * küldött módosítás soha nem íródik felül.
 */
export async function integracioFrissitesLetoltese(foglalt: ReadonlySet<string>): Promise<{ movements: Movement[]; lots: PurchaseLot[] }> {
  const db = client()
  const tol = new Date(Date.now() - INTEGRACIO_FRISSITES_NAP * 86_400_000).toISOString()
  const [integracios, fizetett, tetelek] = await Promise.all([
    db.from('movements').select('*').not('integracio_esemeny_id', 'is', null).gte('created_at', tol),
    db.from('movements').select('*').eq('fizetes_konyvelobol', true),
    db.from('purchase_lots').select('*').eq('fizetes_konyvelobol', true),
  ])
  for (const r of [integracios, fizetett, tetelek]) if (r.error) throw r.error
  const ujabb = (tabla: string, rows: Record<string, unknown>[] | null) => {
    const kimenet = new Map<string, Record<string, unknown>>()
    for (const row of rows ?? []) {
      const kulcs = `${tabla}:${row.id as string}`
      if (foglalt.has(kulcs)) continue
      const v = Number(row.version)
      if (v > (ismertVerziok.get(kulcs) ?? 0)) kimenet.set(row.id as string, row)
    }
    for (const [id, row] of kimenet) ismertVerziok.set(`${tabla}:${id}`, Number(row.version))
    return [...kimenet.values()]
  }
  return {
    movements: ujabb('movements', [...(integracios.data ?? []), ...(fizetett.data ?? [])]).map(movementFromRow),
    lots: ujabb('purchase_lots', tetelek.data).map(lotFromRow),
  }
}

// --- feltöltés: egy felhasználói művelet = egy mentési köteg ------------------------------

/** A szerveren lévő sorok verziója, úgy, ahogy a sorban álló mentések után LESZ: minden sikeres
 * mentés pontosan eggyel növeli (új sornál 1). A mentés ezt küldi el, a szerver pedig elutasítja,
 * ha közben egy másik eszköz módosította a sort (ütközés). */
const ismertVerziok = new Map<string, number>()

/** Igaz, ha a cégnek már van beállítás-sora a szerveren (vagy épp most mentünk egyet). */
export function vanSzerverBeallitas(companyId: string): boolean {
  return ismertVerziok.has(`company_settings:${companyId}`)
}

/** A betöltés után még függő (pl. egy korábbi munkamenetből megmaradt) mentések verzióit is
 * beszámítja. */
export function fuggoMentesekBeszamitasa(tetelek: readonly MentesiTetel[]) {
  for (const tetel of tetelek) {
    for (const v of tetel.valtozasok) {
      if (v.tabla === 'audit_log') continue
      const kulcs = `${v.tabla}:${v.sor.id as string}`
      ismertVerziok.set(kulcs, ((v.sor.version as number | null) ?? 0) + 1)
    }
  }
}

function verzioKioszt(valtozasok: Valtozas[]): Valtozas[] {
  return valtozasok.map((v) => {
    if (v.tabla === 'audit_log') return v
    const kulcs = `${v.tabla}:${v.sor.id as string}`
    const version = ismertVerziok.get(kulcs) ?? null
    ismertVerziok.set(kulcs, (version ?? 0) + 1)
    return { tabla: v.tabla, sor: { ...v.sor, version } }
  })
}

function valtozottSorok<T extends { id: string }>(next: T[], prev: T[], tabla: string, toRow: (item: T) => Record<string, unknown>): Valtozas[] {
  if (next === prev) return []
  const prevById = new Map(prev.map((item) => [item.id, item]))
  return next.filter((item) => prevById.get(item.id) !== item).map((item) => ({ tabla, sor: toRow(item) }))
}

/** Egy állapotváltás (egy felhasználói művelet) összes szerverre menő változása, a szükséges
 * sorrendben (előbb a hivatkozott sorok, pl. termék a mozgás előtt). A változást referencia szerint
 * ismeri fel: a store minden módosítás csak az érintett elemeket cseréli le. */
export function valtozasokKiszamitasa(companyId: string, prev: BusinessSlices, next: BusinessSlices): Valtozas[] {
  const valtozasok = [
    ...valtozottSorok(next.locations, prev.locations, 'locations', (l) => locationToRow(companyId, l)),
    ...valtozottSorok(next.suppliers, prev.suppliers, 'suppliers', (s) => supplierToRow(companyId, s)),
    ...valtozottSorok(next.customers, prev.customers, 'customers', (c) => customerToRow(companyId, c)),
    ...valtozottSorok(next.products, prev.products, 'products', (p) => productToRow(companyId, p)),
    ...valtozottSorok(next.movements, prev.movements, 'movements', (m) => movementToRow(companyId, m)),
    ...valtozottSorok(next.lots, prev.lots, 'purchase_lots', (l) => lotToRow(companyId, l)),
    ...valtozottSorok(next.dailyClosings, prev.dailyClosings, 'daily_closings', (c) => closingToRow(companyId, c)),
    ...valtozottSorok(next.recurringLedgerEntries, prev.recurringLedgerEntries, 'recurring_ledger_entries', (r) => recurringToRow(companyId, r)),
    ...valtozottSorok(next.ledgerEntries, prev.ledgerEntries, 'ledger_entries', (e) => ledgerToRow(companyId, e)),
    ...valtozottSorok(next.pendingChanges, prev.pendingChanges, 'pending_changes', (c) => pendingChangeToRow(companyId, c)),
    ...valtozottSorok(next.auditLog, prev.auditLog, 'audit_log', (a) => auditToRow(companyId, a)),
  ]
  if (next.settings !== prev.settings || next.ledgerCategories !== prev.ledgerCategories) {
    valtozasok.push({ tabla: 'company_settings', sor: settingsToRow(companyId, next.settings, next.ledgerCategories) })
  }
  return valtozasok
}

const TABLA_LEIRAS: Record<string, string> = {
  locations: 'telephely módosítása',
  suppliers: 'beszállító módosítása',
  customers: 'vevő módosítása',
  products: 'termék módosítása',
  movements: 'mozgás módosítása',
  purchase_lots: 'beszerzési tétel módosítása',
  daily_closings: 'napi zárás módosítása',
  recurring_ledger_entries: 'ismétlődő tétel módosítása',
  ledger_entries: 'pénzügyi napló módosítása',
  pending_changes: 'jóváhagyási kérés',
  company_settings: 'beállítások módosítása',
}

/** Mentési tétel egy művelet változásaiból; a leírást a művelet audit-bejegyzéseiből veszi. */
export function mentesiTetel(companyId: string, valtozasok: Valtozas[]): MentesiTetel {
  const auditLeirasok = valtozasok.filter((v) => v.tabla === 'audit_log').map((v) => String(v.sor.description))
  const leirasok = auditLeirasok.length
    ? auditLeirasok
    : [...new Set(valtozasok.map((v) => TABLA_LEIRAS[v.tabla] ?? v.tabla))].map((l) => l.charAt(0).toUpperCase() + l.slice(1))
  return { id: createId(), companyId, letrehozva: new Date().toISOString(), leirasok, valtozasok: verzioKioszt(valtozasok) }
}

/** A mentési köteg elküldése a szervernek (public.keszlet_mentes). */
export async function mentesiTetelKuldese(tetel: MentesiTetel): Promise<KuldesEredmeny> {
  try {
    const { data, error, status } = await client().rpc('keszlet_mentes', { p_koteg_id: tetel.id, p_valtozasok: tetel.valtozasok })
    if (error) {
      const technikai = [error.code, error.message].filter(Boolean).join(': ')
      return { ok: false, fajta: hibaBesorolas({ code: error.code, message: error.message, status }), technikai }
    }
    return { ok: true, verziok: (data ?? []) as { tabla: string; id: string; version: number }[] }
  } catch (hiba) {
    return { ok: false, fajta: 'halozat', technikai: String(hiba) }
  }
}
