// Business logic for the general financial ledger (income/expense journal),
// kept separate from stock/customer logic and pure like the rest of lib/.
import { VAT_CATEGORY, type LedgerEntry } from '../types'

/** An entry's amount converted to HUF - the currency/exchangeRate pattern
 * mirrors PurchaseLot (see lib/costing.ts). */
export function ledgerEntryHuf(entry: Pick<LedgerEntry, 'amount' | 'exchangeRate'>): number {
  return entry.amount * entry.exchangeRate
}

// Soft-deleted entries never count toward totals (they stay visible only via
// an explicit "show deleted" toggle on the raw list, never in aggregates). A
// correction entry (see deleteLedgerEntry) is a normal active entry and
// needs no special-casing here - it nets against the original by itself.
function inRange(entry: LedgerEntry, fromISO: string, toISO: string): boolean {
  return entry.date >= fromISO && entry.date <= toISO && !entry.deletedAt
}

export interface VatSummary {
  totalPayable: number
  totalReclaimable: number
  /** Positive = still owed to the tax authority; negative = refund due. */
  netBalance: number
}

export function computeVatSummary(entries: LedgerEntry[], fromISO: string, toISO: string): VatSummary {
  const relevant = entries.filter((e) => e.category === VAT_CATEGORY && inRange(e, fromISO, toISO))
  const totalPayable = relevant.filter((e) => e.vatDirection === 'payable').reduce((sum, e) => sum + ledgerEntryHuf(e), 0)
  const totalReclaimable = relevant.filter((e) => e.vatDirection === 'reclaimable').reduce((sum, e) => sum + ledgerEntryHuf(e), 0)
  return { totalPayable, totalReclaimable, netBalance: totalPayable - totalReclaimable }
}

export interface CategoryTotal {
  category: string
  income: number
  expense: number
}

/** Ledger-only totals per category (doesn't include inventory margin data -
 * see computeFinancialSummary for the combined view). */
export function computeCategoryTotals(entries: LedgerEntry[], fromISO: string, toISO: string): CategoryTotal[] {
  const byCategory = new Map<string, CategoryTotal>()
  for (const entry of entries.filter((e) => inRange(e, fromISO, toISO))) {
    const huf = ledgerEntryHuf(entry)
    const row = byCategory.get(entry.category) ?? { category: entry.category, income: 0, expense: 0 }
    if (entry.type === 'income') row.income += huf
    else row.expense += huf
    byCategory.set(entry.category, row)
  }
  return Array.from(byCategory.values()).sort((a, b) => a.category.localeCompare(b.category, 'hu'))
}

export interface FinancialSummary {
  categoryTotals: CategoryTotal[]
  ledgerIncomeTotal: number
  ledgerExpenseTotal: number
  /** From inventory sales (computeMarginReport's revenue) in the same period. */
  inventoryRevenue: number
  /** Cost-basis value of stock PURCHASED in the same period (see
   * computeInventoryPurchaseCost in lib/costing.ts) - buying goods into
   * inventory is a real expense the moment it happens, not only once the
   * goods eventually sell, so this is keyed off the purchase date, not any
   * later sale date. */
  inventoryCost: number
  /** Automatically tracked, reclaimable VAT from purchases in the same
   * period (see computeAutoVatTotals in lib/vat.ts) - counted as income the
   * moment the purchase happens, same accrual logic as inventoryCost above.
   * Non-reclaimable purchase VAT is deliberately excluded here: it's already
   * folded into inventoryCost via lotUnitCost, so adding it again here would
   * double-count it. */
  autoVatIncome: number
  /** Automatically tracked, payable VAT from sales in the same period -
   * counted as an expense (an obligation owed to the tax authority) the
   * moment the sale happens, not when the ÁFA return is actually filed. */
  autoVatExpense: number
  totalIncome: number
  totalExpense: number
  netResult: number
}

/** A simple profit & loss for the period: the ledger's own categories, the
 * stock trading activity (sale revenue as income, purchase spend as an
 * expense line - see inventoryCost above), and the automatically tracked
 * per-transaction VAT (see autoVatIncome/autoVatExpense above), combined
 * into one bottom line. */
export function computeFinancialSummary(
  entries: LedgerEntry[],
  inventoryRevenue: number,
  inventoryCost: number,
  autoVatIncome: number,
  autoVatExpense: number,
  fromISO: string,
  toISO: string,
): FinancialSummary {
  const categoryTotals = computeCategoryTotals(entries, fromISO, toISO)
  const ledgerIncomeTotal = categoryTotals.reduce((sum, c) => sum + c.income, 0)
  const ledgerExpenseTotal = categoryTotals.reduce((sum, c) => sum + c.expense, 0)
  const totalIncome = ledgerIncomeTotal + inventoryRevenue + autoVatIncome
  const totalExpense = ledgerExpenseTotal + inventoryCost + autoVatExpense
  return {
    categoryTotals,
    ledgerIncomeTotal,
    ledgerExpenseTotal,
    inventoryRevenue,
    inventoryCost,
    autoVatIncome,
    autoVatExpense,
    totalIncome,
    totalExpense,
    netResult: totalIncome - totalExpense,
  }
}
