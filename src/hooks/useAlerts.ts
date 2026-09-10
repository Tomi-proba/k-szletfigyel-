import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import {
  computeProductInsight,
  computeSlowMoving,
  computeTransferSuggestions,
  getStockStatus,
  type ProductInsight,
  type SlowMovingResult,
  type StockStatus,
  type TransferSuggestion,
} from '../lib/alerts'
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
}

/** Recomputes every alert/insight derived value whenever the underlying data changes. */
export function useAlerts(): AlertsData {
  const products = useStore((s) => s.products)
  const movements = useStore((s) => s.movements)
  const suppliers = useStore((s) => s.suppliers)
  const locations = useStore((s) => s.locations)
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

    return { byProductId, all, lowStock, needsReorder, slowMoving, transferSuggestions }
  }, [products, movements, suppliers, locations, settings])
}
