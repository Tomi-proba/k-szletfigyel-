// Combined revenue lookup: product sales and Pénzügyi napló income entries
// merged into one day-precision-searchable list, each row tagged with its
// source so the two can always be told apart - see pages/Reports.tsx's
// "Bevétel kereső" tab. Kept pure like the rest of lib/.
import type { Customer, LedgerEntry, Movement, Product } from '../types'
import { ledgerEntryHuf } from './ledger'

export type RevenueSourceType = 'sale' | 'ledger'

export interface RevenueRow {
  id: string
  sourceType: RevenueSourceType
  /** Day-precision ISO date (YYYY-MM-DD) - the same value the record was
   * originally entered with, regardless of which day/week/month/year
   * breakdown a report later views it through. */
  date: string
  description: string
  amountHuf: number
  /** 'sale' rows only. */
  productName?: string
  quantity?: number
  unit?: string
  customerName?: string
  /** 'ledger' rows only. */
  category?: string
  note?: string
}

function inRange(date: string, fromISO: string, toISO: string): boolean {
  return date >= fromISO && date <= toISO
}

/** Every individual revenue item in a period - product sales (active,
 * non-cancelled, non-deleted "out" movements) and general-ledger income
 * entries (active) alike, sorted most-recent first. */
export function listRevenueRows(
  movements: Movement[],
  products: Product[],
  customers: Customer[],
  ledgerEntries: LedgerEntry[],
  fromISO: string,
  toISO: string,
): RevenueRow[] {
  const productById = new Map(products.map((p) => [p.id, p]))
  const customerById = new Map(customers.map((c) => [c.id, c]))

  const saleRows: RevenueRow[] = movements
    .filter((m) => m.type === 'out' && !m.deletedAt && !m.cancelled && inRange(m.date, fromISO, toISO))
    .map((m) => {
      const product = productById.get(m.productId)
      const unitPrice = m.saleUnitPrice ?? product?.salePrice ?? 0
      return {
        id: m.id,
        sourceType: 'sale' as const,
        date: m.date,
        description: product?.name ?? 'Törölt termék',
        amountHuf: m.quantity * unitPrice,
        productName: product?.name ?? 'Törölt termék',
        quantity: m.quantity,
        unit: product?.unit,
        customerName: m.customerId ? (customerById.get(m.customerId)?.name ?? 'Törölt vevő') : undefined,
      }
    })

  const ledgerRows: RevenueRow[] = ledgerEntries
    .filter((e) => e.type === 'income' && !e.deletedAt && inRange(e.date, fromISO, toISO))
    .map((e) => ({
      id: e.id,
      sourceType: 'ledger' as const,
      date: e.date,
      description: e.description,
      amountHuf: ledgerEntryHuf(e),
      category: e.category,
      note: e.note,
    }))

  return [...saleRows, ...ledgerRows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export interface RevenueTotals {
  total: number
  fromSales: number
  fromLedger: number
}

export function computeRevenueTotals(rows: RevenueRow[]): RevenueTotals {
  return rows.reduce<RevenueTotals>(
    (acc, r) => {
      if (r.sourceType === 'sale') acc.fromSales += r.amountHuf
      else acc.fromLedger += r.amountHuf
      acc.total += r.amountHuf
      return acc
    },
    { total: 0, fromSales: 0, fromLedger: 0 },
  )
}
