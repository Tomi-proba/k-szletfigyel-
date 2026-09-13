// Automatic ÁFA (VAT) computed from tracked purchase batches and sales,
// kept separate from lib/ledger.ts's manually-entered ÁFA journal entries so
// the two sources never get mixed into one persisted row (no risk of
// double-counting - these are recomputed live from lots/movements, never
// written back as LedgerEntry rows).
import type { LedgerEntry, Movement, Product, PurchaseLot, Supplier } from '../types'
import { lotNetHuf, lotVatAmountHuf } from './costing'
import { computeVatSummary as computeManualVatSummary } from './ledger'

/** A sale's VAT amount in HUF - always owed to the tax authority, never
 * reclaimable (that distinction only applies to what the business itself
 * bought). 0 when the sale isn't tracked for VAT or has no snapshotted
 * sale price (movements recorded before per-sale price tracking existed). */
export function movementVatAmountHuf(m: Pick<Movement, 'quantity' | 'saleUnitPrice' | 'vatRatePercent'>): number {
  if (m.vatRatePercent === undefined || m.saleUnitPrice === undefined) return 0
  return m.quantity * m.saleUnitPrice * (m.vatRatePercent / 100)
}

function inRange(date: string, fromISO: string, toISO: string): boolean {
  return date >= fromISO && date <= toISO
}

export interface AutoVatTotals {
  purchaseReclaimable: number
  purchaseNonReclaimable: number
  sale: number
}

/** Sums the automatically tracked VAT for a period straight from lots and
 * movements - no product/supplier lookups needed, just totals. Soft-deleted
 * records never count, and neither does a cancelled (stornó'd) sale - its
 * VAT still shows up in listAutoVatRows (marked "Stornózva") for the audit
 * trail, but has zero effect on the actual balance. */
export function computeAutoVatTotals(lots: PurchaseLot[], movements: Movement[], fromISO: string, toISO: string): AutoVatTotals {
  const totals: AutoVatTotals = { purchaseReclaimable: 0, purchaseNonReclaimable: 0, sale: 0 }
  for (const l of lots) {
    if (l.vatRatePercent === undefined || !inRange(l.date, fromISO, toISO) || l.deletedAt) continue
    if (l.vatReclaimable === false) totals.purchaseNonReclaimable += lotVatAmountHuf(l)
    else totals.purchaseReclaimable += lotVatAmountHuf(l)
  }
  for (const m of movements) {
    if (
      m.type !== 'out' ||
      m.vatRatePercent === undefined ||
      !inRange(m.date, fromISO, toISO) ||
      m.deletedAt ||
      m.cancelled ||
      m.approvalStatus === 'pending' ||
      m.approvalStatus === 'rejected'
    )
      continue
    totals.sale += movementVatAmountHuf(m)
  }
  return totals
}

export type AutoVatSourceType = 'purchase-reclaimable' | 'purchase-nonreclaimable' | 'sale'

export interface AutoVatRow {
  id: string
  sourceType: AutoVatSourceType
  date: string
  description: string
  vatRatePercent: number
  /** The net amount (goods+shipping, or sale revenue) the rate was applied to. */
  netHuf: number
  amountHuf: number
  /** True for a sale that was later cancelled (stornó) - the row stays
   * visible here for auditability, but its amount is excluded from
   * computeAutoVatTotals's balance (see there). Always false for purchases. */
  cancelled: boolean
}

/** Every individual tracked purchase batch / sale that carries a VAT rate,
 * as one row per item - the detail behind computeAutoVatTotals, for display.
 * Deleted lots/movements are left out entirely; a cancelled sale is kept
 * (flagged) so it stays visible and traceable even though it no longer
 * contributes to the balance. */
export function listAutoVatRows(
  lots: PurchaseLot[],
  movements: Movement[],
  products: Product[],
  suppliers: Supplier[],
  fromISO: string,
  toISO: string,
): AutoVatRow[] {
  const productById = new Map(products.map((p) => [p.id, p]))
  const supplierById = new Map(suppliers.map((s) => [s.id, s]))

  const purchaseRows: AutoVatRow[] = lots
    .filter((l) => l.vatRatePercent !== undefined && inRange(l.date, fromISO, toISO) && !l.deletedAt)
    .map((l) => {
      const product = productById.get(l.productId)
      const supplier = product?.supplierId ? supplierById.get(product.supplierId) : undefined
      return {
        id: l.id,
        sourceType: (l.vatReclaimable === false ? 'purchase-nonreclaimable' : 'purchase-reclaimable') as AutoVatSourceType,
        date: l.date,
        description: `${product?.name ?? 'Törölt termék'}${supplier ? ` - ${supplier.name}` : ''}`,
        vatRatePercent: l.vatRatePercent as number,
        netHuf: lotNetHuf(l),
        amountHuf: lotVatAmountHuf(l),
        cancelled: false,
      }
    })

  const saleRows: AutoVatRow[] = movements
    .filter(
      (m) =>
        m.type === 'out' &&
        m.vatRatePercent !== undefined &&
        inRange(m.date, fromISO, toISO) &&
        !m.deletedAt &&
        m.approvalStatus !== 'pending' &&
        m.approvalStatus !== 'rejected',
    )
    .map((m) => {
      const product = productById.get(m.productId)
      return {
        id: m.id,
        sourceType: 'sale' as AutoVatSourceType,
        date: m.date,
        description: product?.name ?? 'Törölt termék',
        vatRatePercent: m.vatRatePercent as number,
        netHuf: m.quantity * (m.saleUnitPrice ?? 0),
        amountHuf: movementVatAmountHuf(m),
        cancelled: Boolean(m.cancelled),
      }
    })

  return [...purchaseRows, ...saleRows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export interface CombinedVatSummary {
  manualPayable: number
  manualReclaimable: number
  autoPurchaseReclaimable: number
  autoPurchaseNonReclaimable: number
  autoSalePayable: number
  /** manualPayable + autoSalePayable. */
  totalPayable: number
  /** manualReclaimable + autoPurchaseReclaimable. Non-reclaimable purchase
   * VAT is deliberately excluded - it's informative only, not part of the
   * balance (it's already folded into the product's cost instead). */
  totalReclaimable: number
  /** Positive = still owed to the tax authority; negative = refund due. */
  netBalance: number
}

/** Combines the manually-entered ÁFA journal entries (lib/ledger.ts) with
 * the automatically tracked purchase/sale VAT into one balance, source and
 * type always kept distinguishable (see listAutoVatRows for the per-item
 * breakdown) so nothing here risks double-counting a manual entry. */
export function computeCombinedVatSummary(
  entries: LedgerEntry[],
  lots: PurchaseLot[],
  movements: Movement[],
  fromISO: string,
  toISO: string,
): CombinedVatSummary {
  const manual = computeManualVatSummary(entries, fromISO, toISO)
  const auto = computeAutoVatTotals(lots, movements, fromISO, toISO)

  const totalPayable = manual.totalPayable + auto.sale
  const totalReclaimable = manual.totalReclaimable + auto.purchaseReclaimable

  return {
    manualPayable: manual.totalPayable,
    manualReclaimable: manual.totalReclaimable,
    autoPurchaseReclaimable: auto.purchaseReclaimable,
    autoPurchaseNonReclaimable: auto.purchaseNonReclaimable,
    autoSalePayable: auto.sale,
    totalPayable,
    totalReclaimable,
    netBalance: totalPayable - totalReclaimable,
  }
}
