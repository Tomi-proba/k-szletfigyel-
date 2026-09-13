// Field-level diffing for the audit log (see types/index.ts's AuditLogEntry).
// Pure and framework-agnostic like the rest of lib/ - the store calls
// diffFields whenever it updates an entity and appends whatever comes back
// to state.auditLog.
import type { AuditAction, AuditEntityType, AuditFieldChange } from '../types'

export const ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Létrehozva',
  update: 'Módosítva',
  delete: 'Törölve',
  restore: 'Visszaállítva',
  cancel: 'Visszavonva',
  correction: 'Korrekció',
}

export const ENTITY_TYPE_LABELS: Record<AuditEntityType, string> = {
  product: 'Termék',
  lot: 'Beszerzési tétel',
  movement: 'Mozgás',
  customer: 'Vevő',
  supplier: 'Beszállító',
  location: 'Telephely',
  ledgerEntry: 'Napló tétel',
  dailyClosing: 'Napi zárás',
}

// Only fields listed here are tracked - id/createdAt/updatedAt/deletedAt and
// other bookkeeping fields are deliberately excluded so the history reads
// as "what did the user actually change", not raw record noise.
const FIELD_LABELS: Record<AuditEntityType, Record<string, string>> = {
  product: {
    name: 'Név',
    sku: 'Cikkszám',
    category: 'Kategória',
    unit: 'Mértékegység',
    currentStock: 'Készlet',
    minStock: 'Minimum készletszint',
    purchasePrice: 'Beszerzési ár',
    salePrice: 'Eladási ár',
    supplierId: 'Beszállító',
    locationId: 'Telephely',
    defaultVatRatePercent: 'Alapértelmezett ÁFA kulcs',
  },
  lot: {
    quantity: 'Mennyiség',
    unitPrice: 'Áru egységára',
    shippingCost: 'Szállítási költség',
    currency: 'Pénznem',
    exchangeRate: 'Árfolyam',
    dueDate: 'Fizetési határidő',
    isPaid: 'Kifizetve',
    vatRatePercent: 'ÁFA kulcs',
    vatReclaimable: 'ÁFA visszaigényelhető',
  },
  movement: {
    quantity: 'Mennyiség',
    date: 'Dátum',
    note: 'Megjegyzés',
    unitPrice: 'Egységár',
    shippingCost: 'Szállítási költség',
    customerId: 'Vevő',
    isPaid: 'Fizetve',
    vatRatePercent: 'ÁFA kulcs',
    saleStatus: 'Eladási státusz',
    dueDate: 'Fizetési határidő',
    approvalStatus: 'Jóváhagyási állapot',
    discrepancyNote: 'Eltérés megjegyzése',
    rejectReason: 'Elutasítás indoka',
  },
  customer: {
    name: 'Név',
    phone: 'Telefonszám',
    email: 'Email',
    notes: 'Megjegyzés',
  },
  supplier: {
    name: 'Név',
    phone: 'Telefonszám',
    email: 'Email',
    leadTimeDays: 'Átlagos szállítási idő',
  },
  location: {
    name: 'Név',
  },
  ledgerEntry: {
    date: 'Dátum',
    type: 'Típus',
    category: 'Kategória',
    description: 'Megnevezés',
    amount: 'Összeg',
    currency: 'Pénznem',
    exchangeRate: 'Árfolyam',
    note: 'Megjegyzés',
    vatRatePercent: 'ÁFA kulcs',
    vatDirection: 'ÁFA irány',
    dueDate: 'Fizetési határidő',
    isPaid: 'Kifizetve',
  },
  dailyClosing: {
    status: 'Állapot',
  },
}

const SALE_STATUS_LABELS: Record<string, string> = { pending: 'Kiadásra vár', shipping: 'Kiszállítás alatt', delivered: 'Kézbesítve/átadva' }
const VAT_DIRECTION_LABELS: Record<string, string> = { payable: 'Befizetendő', reclaimable: 'Visszaigényelhető' }

function formatValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Igen' : 'Nem'
  if (field === 'saleStatus' && typeof value === 'string') return SALE_STATUS_LABELS[value] ?? value
  if (field === 'vatDirection' && typeof value === 'string') return VAT_DIRECTION_LABELS[value] ?? value
  if (field === 'type' && typeof value === 'string') return value === 'income' ? 'Bevétel' : value === 'expense' ? 'Kiadás' : value
  return String(value)
}

/** Compares two plain snapshots of the same entity and returns one
 * AuditFieldChange per tracked field that actually differs. */
export function diffFields<T extends object>(entityType: AuditEntityType, before: T, after: T): AuditFieldChange[] {
  const labels = FIELD_LABELS[entityType]
  const beforeRecord = before as Record<string, unknown>
  const afterRecord = after as Record<string, unknown>
  const changes: AuditFieldChange[] = []
  for (const field of Object.keys(labels)) {
    const oldV = beforeRecord[field]
    const newV = afterRecord[field]
    if (JSON.stringify(oldV ?? null) === JSON.stringify(newV ?? null)) continue
    changes.push({ field, label: labels[field], oldValue: formatValue(field, oldV), newValue: formatValue(field, newV) })
  }
  return changes
}
