// Business logic for the general financial ledger (income/expense journal),
// kept separate from stock/customer logic and pure like the rest of lib/.
import { VAT_CATEGORY, type LedgerEntry } from '../types'

/** An entry's amount converted to HUF - the currency/exchangeRate pattern
 * mirrors PurchaseLot (see lib/costing.ts). */
export function ledgerEntryHuf(entry: Pick<LedgerEntry, 'amount' | 'exchangeRate'>): number {
  return entry.amount * entry.exchangeRate
}

function inRange(entry: LedgerEntry, fromISO: string, toISO: string): boolean {
  return entry.date >= fromISO && entry.date <= toISO
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
  /** From inventory sales (computeMarginReport's cost/COGS) in the same period. */
  inventoryCost: number
  totalIncome: number
  totalExpense: number
  netResult: number
}

/** A simple profit & loss for the period: the ledger's own categories plus
 * the stock margin data (sale revenue as income, cost of goods sold as an
 * expense line), combined into one bottom line. */
export function computeFinancialSummary(
  entries: LedgerEntry[],
  inventoryRevenue: number,
  inventoryCost: number,
  fromISO: string,
  toISO: string,
): FinancialSummary {
  const categoryTotals = computeCategoryTotals(entries, fromISO, toISO)
  const ledgerIncomeTotal = categoryTotals.reduce((sum, c) => sum + c.income, 0)
  const ledgerExpenseTotal = categoryTotals.reduce((sum, c) => sum + c.expense, 0)
  const totalIncome = ledgerIncomeTotal + inventoryRevenue
  const totalExpense = ledgerExpenseTotal + inventoryCost
  return {
    categoryTotals,
    ledgerIncomeTotal,
    ledgerExpenseTotal,
    inventoryRevenue,
    inventoryCost,
    totalIncome,
    totalExpense,
    netResult: totalIncome - totalExpense,
  }
}
