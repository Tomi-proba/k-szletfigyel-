import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import {
  computeCustomerBalances,
  computeProductInsight,
  computeSlowMoving,
  computeTransferSuggestions,
  computeUnpaidSales,
  getStockStatus,
  type CustomerBalance,
  type ProductInsight,
  type SlowMovingResult,
  type StockStatus,
  type TransferSuggestion,
  type UnpaidSale,
} from '../lib/alerts'
import { computePayableObligations, type PayableObligation } from '../lib/payables'
import { todayISO } from '../lib/dates'
import type { Product } from '../types'

export interface ProductAlertInfo {
  product: Product
  insight: ProductInsight
  slowMoving: SlowMovingResult
  status: StockStatus
}

export interface AlertsData {
  byProductId: Map<string, ProductAlertInfo>
  all: ProductAlertInfo[]
  lowStock: ProductAlertInfo[]
  needsReorder: ProductAlertInfo[]
  slowMoving: ProductAlertInfo[]
  transferSuggestions: TransferSuggestion[]
  unpaidSales: UnpaidSale[]
  customerBalances: CustomerBalance[]
  /** Every unpaid, due-date-tracked purchase batch or ledger expense. */
  payables: PayableObligation[]
  /** The subset of payables that's actually alert-worthy (overdue or within the reminder window). */
  urgentPayables: PayableObligation[]
}

/** Recomputes every alert/insight derived value whenever the underlying data changes. */
export function useAlerts(): AlertsData {
  const products = useStore((s) => s.products)
  const movements = useStore((s) => s.movements)
  const suppliers = useStore((s) => s.suppliers)
  const customers = useStore((s) => s.customers)
  const locations = useStore((s) => s.locations)
  const lots = useStore((s) => s.lots)
  const ledgerEntries = useStore((s) => s.ledgerEntries)
  const settings = useStore((s) => s.settings)

  return useMemo(() => {
    const now = new Date()
    const all: ProductAlertInfo[] = products.map((product) => {
      const insight = computeProductInsight(product, movements, suppliers, settings, now)
      const slowMoving = computeSlowMoving(product, movements, settings, now)
      const status = getStockStatus(insight.isLowStock, slowMoving.isSlowMoving)
      return { product, insight, slowMoving, status }
    })

    const byProductId = new Map(all.map((a) => [a.product.id, a]))
    const lowStock = all.filter((a) => a.insight.isLowStock)
    const needsReorder = all.filter((a) => a.insight.needsReorder)
    const slowMoving = all.filter((a) => a.slowMoving.isSlowMoving)
    const transferSuggestions = computeTransferSuggestions(products, movements, locations, settings, now)
    const unpaidSales = computeUnpaidSales(movements, products, customers)
    const customerBalances = computeCustomerBalances(unpaidSales)
    const payables = computePayableObligations(lots, products, suppliers, ledgerEntries, settings.paymentReminderDaysBefore, todayISO())
    const urgentPayables = payables.filter((p) => p.isAlertWorthy)

    return { byProductId, all, lowStock, needsReorder, slowMoving, transferSuggestions, unpaidSales, customerBalances, payables, urgentPayables }
  }, [products, movements, suppliers, customers, locations, lots, ledgerEntries, settings])
}
