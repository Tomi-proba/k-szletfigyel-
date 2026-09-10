// Shipping-cost reporting: groups purchase batches by supplier and/or by
// period, keeping freight broken out from the goods value even after the
// fact (the two are tracked separately per lot - see PurchaseLot.shippingCost
// - but blended into one costing number by lib/costing.ts's lotUnitCost).
import { endOfWeek, format, formatISO, startOfWeek } from 'date-fns'
import { hu } from 'date-fns/locale'
import type { Product, PurchaseLot, Supplier } from '../types'
import { lotGoodsValueHuf, lotShippingHuf } from './costing'

export type ShippingPeriodGranularity = 'day' | 'week' | 'month' | 'year'

function inRange(date: string, fromISO: string, toISO: string): boolean {
  return date >= fromISO && date <= toISO
}

export interface ShippingBySupplierRow {
  supplierId: string
  supplierName: string
  batchCount: number
  goodsValueHuf: number
  shippingHuf: number
  totalHuf: number
}

export function groupShippingBySupplier(
  lots: PurchaseLot[],
  products: Product[],
  suppliers: Supplier[],
  fromISO: string,
  toISO: string,
): ShippingBySupplierRow[] {
  const productById = new Map(products.map((p) => [p.id, p]))
  const supplierById = new Map(suppliers.map((s) => [s.id, s]))
  const byId = new Map<string, ShippingBySupplierRow>()

  for (const lot of lots) {
    if (!inRange(lot.date, fromISO, toISO)) continue
    const supplierId = productById.get(lot.productId)?.supplierId ?? '__none__'
    const row = byId.get(supplierId) ?? {
      supplierId,
      supplierName: supplierById.get(supplierId)?.name ?? 'Nincs megadva',
      batchCount: 0,
      goodsValueHuf: 0,
      shippingHuf: 0,
      totalHuf: 0,
    }
    row.batchCount += 1
    row.goodsValueHuf += lotGoodsValueHuf(lot)
    row.shippingHuf += lotShippingHuf(lot)
    row.totalHuf = row.goodsValueHuf + row.shippingHuf
    byId.set(supplierId, row)
  }

  return Array.from(byId.values()).sort((a, b) => b.shippingHuf - a.shippingHuf)
}

export interface ShippingByPeriodRow {
  periodKey: string
  periodLabel: string
  batchCount: number
  goodsValueHuf: number
  shippingHuf: number
  totalHuf: number
}

function periodKeyAndLabel(dateIso: string, granularity: ShippingPeriodGranularity): { key: string; label: string } {
  const date = new Date(dateIso)
  switch (granularity) {
    case 'day':
      return { key: dateIso, label: format(date, 'yyyy. MM. dd.', { locale: hu }) }
    case 'week': {
      const start = startOfWeek(date, { weekStartsOn: 1 })
      const end = endOfWeek(date, { weekStartsOn: 1 })
      return { key: formatISO(start, { representation: 'date' }), label: `${format(start, 'MM.dd.')} - ${format(end, 'MM.dd.')}` }
    }
    case 'month':
      return { key: format(date, 'yyyy-MM'), label: format(date, 'yyyy. MMMM', { locale: hu }) }
    case 'year':
      return { key: format(date, 'yyyy'), label: format(date, 'yyyy') }
  }
}

export function groupShippingByPeriod(
  lots: PurchaseLot[],
  fromISO: string,
  toISO: string,
  granularity: ShippingPeriodGranularity,
): ShippingByPeriodRow[] {
  const byKey = new Map<string, ShippingByPeriodRow>()

  for (const lot of lots) {
    if (!inRange(lot.date, fromISO, toISO)) continue
    const { key, label } = periodKeyAndLabel(lot.date, granularity)
    const row = byKey.get(key) ?? { periodKey: key, periodLabel: label, batchCount: 0, goodsValueHuf: 0, shippingHuf: 0, totalHuf: 0 }
    row.batchCount += 1
    row.goodsValueHuf += lotGoodsValueHuf(lot)
    row.shippingHuf += lotShippingHuf(lot)
    row.totalHuf = row.goodsValueHuf + row.shippingHuf
    byKey.set(key, row)
  }

  return Array.from(byKey.values()).sort((a, b) => (a.periodKey < b.periodKey ? -1 : 1))
}
