// Outgoing payment obligations - what the business owes (supplier invoices,
// rent, payroll, anything booked with a due date) as opposed to what
// customers owe it (see computeUnpaidSales in lib/alerts.ts). Kept as pure
// functions over PurchaseLot/LedgerEntry data, same pattern as the rest of lib/.
import type { LedgerEntry, Product, PurchaseLot, Supplier } from '../types'
import { lotGrossHuf } from './costing'
import { ledgerEntryHuf } from './ledger'
import { daysBetween, todayISO } from './dates'

export type PayableSourceType = 'purchase' | 'ledger'
export type PayableUrgency = 'overdue' | 'upcoming'

export interface PayableObligation {
  /** The underlying PurchaseLot or LedgerEntry id. */
  id: string
  sourceType: PayableSourceType
  dueDate: string
  /** Who the money is owed to - the supplier for a purchase batch, or the
   * ledger category (Bérleti díj, Bérköltség, ...) for a general expense. */
  payee: string
  description: string
  /** HUF amount owed. */
  amount: number
  /** Negative when the due date has already passed. */
  daysUntilDue: number
  urgency: PayableUrgency
  /** Within the configured reminder window (or overdue) - this is what
   * should actually surface as an alert/badge, as opposed to every unpaid
   * item with a due date somewhere in the future. */
  isAlertWorthy: boolean
}

function classify(dueDate: string, reminderWindowDays: number, today: string): Pick<PayableObligation, 'daysUntilDue' | 'urgency' | 'isAlertWorthy'> {
  const daysUntilDue = daysBetween(today, dueDate)
  const urgency: PayableUrgency = daysUntilDue < 0 ? 'overdue' : 'upcoming'
  return { daysUntilDue, urgency, isAlertWorthy: daysUntilDue < 0 || daysUntilDue <= reminderWindowDays }
}

/** Every unpaid, due-date-tracked purchase batch and ledger expense,
 * combined and sorted soonest-due first. */
export function computePayableObligations(
  lots: PurchaseLot[],
  products: Product[],
  suppliers: Supplier[],
  ledgerEntries: LedgerEntry[],
  reminderDaysBefore: number[],
  today: string = todayISO(),
): PayableObligation[] {
  const productById = new Map(products.map((p) => [p.id, p]))
  const supplierById = new Map(suppliers.map((s) => [s.id, s]))
  const reminderWindowDays = reminderDaysBefore.length > 0 ? Math.max(...reminderDaysBefore) : 0

  const fromLots: PayableObligation[] = lots
    .filter((l): l is PurchaseLot & { dueDate: string } => Boolean(l.dueDate) && l.isPaid === false && !l.deletedAt)
    .map((l) => {
      const product = productById.get(l.productId)
      const supplier = product?.supplierId ? supplierById.get(product.supplierId) : undefined
      return {
        id: l.id,
        sourceType: 'purchase' as const,
        dueDate: l.dueDate,
        payee: supplier?.name ?? 'Ismeretlen beszállító',
        description: `${product?.name ?? 'Törölt termék'} - beszerzés (${l.quantity} ${product?.unit ?? 'db'})`,
        // The full invoice amount owed to the supplier - net + VAT (both
        // reclaimable and not), since that's what actually has to be paid,
        // not just the cost-basis part that ends up on the product.
        amount: Math.round(lotGrossHuf(l)),
        ...classify(l.dueDate, reminderWindowDays, today),
      }
    })

  const fromLedger: PayableObligation[] = ledgerEntries
    .filter((e): e is LedgerEntry & { dueDate: string } => e.type === 'expense' && Boolean(e.dueDate) && e.isPaid === false && !e.deletedAt)
    .map((e) => ({
      id: e.id,
      sourceType: 'ledger' as const,
      dueDate: e.dueDate,
      payee: e.category,
      description: e.description,
      amount: Math.round(ledgerEntryHuf(e)),
      ...classify(e.dueDate, reminderWindowDays, today),
    }))

  return [...fromLots, ...fromLedger].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
}
