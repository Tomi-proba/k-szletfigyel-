import { useMemo } from 'react'
import { useAuth } from './useAuth'
import { useStore } from '../store/useStore'
import {
  computeCustomerBalances,
  computeOpenSales,
  computeProductInsight,
  computeSlowMoving,
  computeTransferSuggestions,
  computeUnpaidSales,
  getStockStatus,
  type CustomerBalance,
  type OpenSale,
  type ProductInsight,
  type SlowMovingResult,
  type StockStatus,
  type TransferSuggestion,
  type UnpaidSale,
} from '../lib/alerts'
import { computePayableObligations, type PayableObligation } from '../lib/payables'
import { useKonyveloNyitott } from '../lib/integracio'
import { allapota, teendoje, varakozo } from '../lib/raktariBejelentes'
import { egyIgazsag, type EgyIgazsag } from '../lib/egyIgazsag'
import { computeMissingClosings, type MissingClosingAlert } from '../lib/dailyClosing'
import { todayISO } from '../lib/dates'
import type { Movement, Product } from '../types'

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
  /** Sales recorded but not yet delivered (pending/shipping) - see computeOpenSales. */
  openSales: OpenSale[]
  /** Locations that had movement activity on a day but never submitted a
   * napi zárás for it - see computeMissingClosings. */
  missingClosings: MissingClosingAlert[]
  /** Raktári bejelentés → fő irodai elfogadás (DOCUMENTATION.md 31. fejezet): ami a bejelentkezett
   * felhasználóra vár. Raktárosnál a visszaigazolandók és az elutasított saját bejelentései, a fő irodánál
   * (és helyi módban) minden el nem fogadott tétel; az irodánál és a tulajdonosnál üres. */
  jovahagyasraVar: Movement[]
  /** Az összes még el nem fogadott tétel (tájékoztatásul, szereptől függetlenül). */
  varakozoTetelek: Movement[]
  /**
   * Egy igazság (TERV.md F19, KK10): ha a cégnek van Könyvelője, a fizetési kötelezettségek és a kintlévőség a
   * Könyvelő nyitott tételeiből és a Készlet három csoportba sorolt saját tételeiből; null, ha nincs Könyvelő
   * (ekkor a fenti saját számítás él, mint eddig).
   */
  egyIgazsag: EgyIgazsag | null
  /** A jelvényekhez: a riasztásban számító fizetendő és kintlévő tételek száma és összege (forint). */
  fizetendoRiaszt: { db: number; osszeg: number }
  kintlevoseg: { db: number; osszeg: number }
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
  const dailyClosings = useStore((s) => s.dailyClosings)
  const settings = useStore((s) => s.settings)
  // A vevő/fizetés/beszállítói-fizetés jellegű riasztások irodai adatnak
  // számítanak (lásd DOCUMENTATION.md 14. fejezet) - raktáros szerepkörben
  // ezek ki sem számolódnak, nem csak a felületen vannak elrejtve. Ez azért
  // is fontos, mert `suppliers`/`customers`/`ledgerEntries` egy raktáros
  // böngészőjében NEM a cég valódi (megosztott) adata, hanem az adott
  // eszköz saját, helyi (jellemzően demó-)állapota - kiszámolásuk raktáros
  // nézetben félrevezető, nem valós adatot mutatna.
  const { isWarehouseUser, isReadOnlyViewer, effectiveRole } = useAuth()
  const dataMode = useStore((s) => s.dataMode)
  const konyveloNyitott = useKonyveloNyitott(!isWarehouseUser)

  return useMemo(() => {
    const now = new Date()
    const activeProducts = products.filter((p) => !p.deletedAt)
    const all: ProductAlertInfo[] = activeProducts.map((product) => {
      const insight = computeProductInsight(product, movements, suppliers, settings, now)
      const slowMoving = computeSlowMoving(product, movements, settings, now)
      const status = getStockStatus(insight.isLowStock, slowMoving.isSlowMoving)
      return { product, insight, slowMoving, status }
    })

    const byProductId = new Map(all.map((a) => [a.product.id, a]))
    const lowStock = all.filter((a) => a.insight.isLowStock)
    const needsReorder = all.filter((a) => a.insight.needsReorder)
    const slowMoving = all.filter((a) => a.slowMoving.isSlowMoving)
    const transferSuggestions = isWarehouseUser ? [] : computeTransferSuggestions(products, movements, locations, settings, now)
    const unpaidSales = isWarehouseUser ? [] : computeUnpaidSales(movements, products, customers)
    const customerBalances = isWarehouseUser ? [] : computeCustomerBalances(unpaidSales)
    const payables = isWarehouseUser
      ? []
      : computePayableObligations(lots, products, suppliers, ledgerEntries, settings.paymentReminderDaysBefore, todayISO())
    const urgentPayables = payables.filter((p) => p.isAlertWorthy)
    const openSales = isWarehouseUser ? [] : computeOpenSales(movements, products, customers)
    const missingClosings = computeMissingClosings(locations, movements, dailyClosings, settings.missingClosingGraceDays, todayISO())

    const szerep = {
      raktaros: isWarehouseUser,
      foIroda: effectiveRole === 'fo_iroda',
      csakOlvas: isReadOnlyViewer,
      helyi: dataMode !== 'remote' || !effectiveRole,
    }
    const varakozoTetelek = movements.filter(varakozo)
    const jovahagyasraVar = movements.filter(
      (m) => teendoje(m, szerep) !== null || (isWarehouseUser && allapota(m) === 'elutasitva' && Boolean(m.raktarVisszaigazolva)),
    )

    const reminderWindowDays = settings.paymentReminderDaysBefore.length ? Math.max(...settings.paymentReminderDaysBefore) : 0
    const egy = isWarehouseUser ? null : egyIgazsag(konyveloNyitott, payables, unpaidSales, lots, reminderWindowDays, now)
    const osszeg = (l: Array<{ osszeg: number }>) => l.reduce((s, x) => s + x.osszeg, 0)
    const fizetendoRiaszt = egy
      ? { db: egy.fizetendo.filter((x) => x.riaszt).length, osszeg: osszeg(egy.fizetendo.filter((x) => x.riaszt)) }
      : { db: urgentPayables.length, osszeg: urgentPayables.reduce((s, p) => s + p.amount, 0) }
    const kintlevoseg = egy ? { db: egy.kintlevoseg.length, osszeg: osszeg(egy.kintlevoseg) } : { db: unpaidSales.length, osszeg: unpaidSales.reduce((s, x) => s + x.amount, 0) }

    return {
      egyIgazsag: egy,
      fizetendoRiaszt,
      kintlevoseg,
      byProductId,
      all,
      lowStock,
      needsReorder,
      slowMoving,
      transferSuggestions,
      unpaidSales,
      customerBalances,
      payables,
      urgentPayables,
      openSales,
      missingClosings,
      jovahagyasraVar,
      varakozoTetelek,
    }
  }, [
    products,
    movements,
    suppliers,
    customers,
    locations,
    lots,
    ledgerEntries,
    dailyClosings,
    settings,
    isWarehouseUser,
    isReadOnlyViewer,
    effectiveRole,
    dataMode,
    konyveloNyitott,
  ])
}
