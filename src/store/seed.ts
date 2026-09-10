// Generates realistic-looking demo data (locations, suppliers, products and
// ~14 months of movement history) so a first-time user immediately sees the
// alerting logic in action instead of an empty app.
import { addDays, formatISO, subDays, subMonths } from 'date-fns'
import { createId } from './id'
import { consumeFifo } from '../lib/costing'
import { DEFAULT_LEDGER_CATEGORIES, VAT_CATEGORY } from '../types'
import type { AuditLogEntry, Customer, LedgerEntry, Location, Movement, Product, PurchaseLot, SaleStatus, Supplier } from '../types'

interface SeedResult {
  locations: Location[]
  suppliers: Supplier[]
  customers: Customer[]
  products: Product[]
  movements: Movement[]
  lots: PurchaseLot[]
  ledgerEntries: LedgerEntry[]
  ledgerCategories: string[]
  auditLog: AuditLogEntry[]
}

/** Walks each product's movements in date order, creating a PurchaseLot for
 * every "in" and consuming lots FIFO for every "out" - so there's a
 * consistent lot ledger to demo FIFO costing with, not just the running
 * average. Seed movements don't carry real historical prices, so every lot
 * uses the product's (single, final) purchasePrice as an approximation. */
function deriveLots(movements: Movement[], products: Product[]): PurchaseLot[] {
  let lots: PurchaseLot[] = []
  for (const product of products) {
    const productMovements = movements
      .filter((m) => m.productId === product.id)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.localeCompare(b.createdAt)))

    for (const m of productMovements) {
      if (m.type === 'in') {
        lots.push({
          id: createId(),
          productId: product.id,
          movementId: m.id,
          date: m.date,
          quantity: m.quantity,
          remainingQuantity: m.quantity,
          unitPrice: product.purchasePrice,
          shippingCost: 0,
          currency: 'HUF',
          exchangeRate: 1,
          createdAt: m.createdAt,
        })
      } else {
        lots = consumeFifo(lots, product.id, m.quantity, product.purchasePrice).updatedLots
      }
    }
  }
  return lots
}

/** Attaches a tracked customer + payment status to the N most recent "out"
 * movements for one product, so the unpaid-sales alert has something to
 * show out of the box. Mutates the given movement objects in place. */
function attachCustomerSales(
  movements: Movement[],
  productId: string,
  salePrice: number,
  entries: { customerId: string; isPaid: boolean }[],
) {
  const candidates = movements
    .filter((m) => m.productId === productId && m.type === 'out')
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, entries.length)

  candidates.forEach((movement, i) => {
    const entry = entries[i]
    movement.customerId = entry.customerId
    movement.isPaid = entry.isPaid
    movement.saleUnitPrice = salePrice
  })
}

function iso(d: Date): string {
  return formatISO(d, { representation: 'date' })
}

/** Builds daily "out" movements plus periodic restock "in" movements for one
 * product across `days` days ending today, honoring an optional seasonal
 * multiplier keyed by month (0-11) so year-over-year comparisons make sense. */
function buildHistory(opts: {
  productId: string
  locationId: string
  days: number
  avgPerDay: number
  varianceRatio?: number
  restockEveryDays?: number
  restockQty?: number
  seasonal?: (month: number) => number
  startingStock: number
}): { movements: Movement[]; endingStock: number } {
  const {
    productId,
    locationId,
    days,
    avgPerDay,
    varianceRatio = 0.4,
    restockEveryDays = 14,
    restockQty,
    seasonal,
    startingStock,
  } = opts
  const movements: Movement[] = []
  let stock = startingStock
  const today = new Date()
  const start = subDays(today, days)

  for (let dayOffset = 0; dayOffset <= days; dayOffset++) {
    const date = addDays(start, dayOffset)
    const month = date.getMonth()
    const seasonalFactor = seasonal ? seasonal(month) : 1
    const noise = 1 + (Math.random() * 2 - 1) * varianceRatio
    const qty = Math.max(0, Math.round(avgPerDay * seasonalFactor * noise))

    if (qty > 0) {
      const outQty = Math.min(qty, stock)
      if (outQty > 0) {
        stock -= outQty
        movements.push({
          id: createId(),
          productId,
          locationId,
          date: iso(date),
          type: 'out',
          quantity: outQty,
          createdAt: date.toISOString(),
        })
      }
    }

    if (dayOffset > 0 && dayOffset % restockEveryDays === 0) {
      const qtyIn = restockQty ?? Math.round(avgPerDay * restockEveryDays * 1.3)
      stock += qtyIn
      movements.push({
        id: createId(),
        productId,
        locationId,
        date: iso(date),
        type: 'in',
        quantity: qtyIn,
        note: 'Beszerzés',
        createdAt: date.toISOString(),
      })
    }
  }

  return { movements, endingStock: stock }
}

export function buildSeedData(): SeedResult {
  const now = new Date()
  const locBelvaros: Location = { id: createId(), name: 'Belvárosi telephely' }
  const locIpari: Location = { id: createId(), name: 'Ipari parki raktár' }
  const locations = [locBelvaros, locIpari]

  const supMetal: Supplier = {
    id: createId(),
    name: 'Metal-King Kft.',
    phone: '+36 30 111 2233',
    email: 'rendeles@metalking.hu',
    leadTimeDays: 5,
  }
  const supFa: Supplier = {
    id: createId(),
    name: 'Faáru Trade Bt.',
    phone: '+36 20 444 5566',
    email: 'info@faarutrade.hu',
    leadTimeDays: 10,
  }
  const supEpker: Supplier = {
    id: createId(),
    name: 'ÉpKerám Zrt.',
    phone: '+36 70 777 8899',
    email: 'ertekesites@epkeram.hu',
    leadTimeDays: 14,
  }
  const suppliers = [supMetal, supFa, supEpker]

  const custKovacs: Customer = {
    id: createId(),
    name: 'Kovács Építő Kft.',
    phone: '+36 30 222 3344',
    email: 'info@kovacsepito.hu',
  }
  const custNagy: Customer = {
    id: createId(),
    name: 'Nagy Ferenc (egyéni vállalkozó)',
    phone: '+36 20 555 1122',
  }
  const custSzabo: Customer = {
    id: createId(),
    name: 'Szabó és Társa Bt.',
    phone: '+36 70 333 9988',
    email: 'szabo.tarsa@gmail.com',
  }
  const customers = [custKovacs, custNagy, custSzabo]

  const products: Product[] = []
  const movements: Movement[] = []

  const mk = (p: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'currentStock'>, currentStock: number): Product => ({
    ...p,
    id: createId(),
    currentStock,
    createdAt: subMonths(now, 15).toISOString(),
    updatedAt: now.toISOString(),
  })

  // 1) Csavar 4x40 - same article at both locations: low at Belváros, high at Ipari park -> transfer suggestion
  const csavarBelvaros = mk(
    {
      name: 'Csavar 4x40mm',
      sku: 'CSV-440',
      category: 'Kötőelemek',
      unit: 'db',
      minStock: 500,
      purchasePrice: 8,
      salePrice: 18,
      supplierId: supMetal.id,
      locationId: locBelvaros.id,
      defaultVatRatePercent: 27,
    },
    0,
  )
  const hCsavarB = buildHistory({
    productId: csavarBelvaros.id,
    locationId: locBelvaros.id,
    days: 150,
    avgPerDay: 45,
    restockEveryDays: 21,
    startingStock: 900,
  })
  csavarBelvaros.currentStock = Math.min(hCsavarB.endingStock, 140)
  products.push(csavarBelvaros)
  movements.push(...hCsavarB.movements)

  const csavarIpari = mk(
    {
      name: 'Csavar 4x40mm',
      sku: 'CSV-440',
      category: 'Kötőelemek',
      unit: 'db',
      minStock: 500,
      purchasePrice: 8,
      salePrice: 18,
      supplierId: supMetal.id,
      locationId: locIpari.id,
      defaultVatRatePercent: 27,
    },
    0,
  )
  const hCsavarI = buildHistory({
    productId: csavarIpari.id,
    locationId: locIpari.id,
    days: 150,
    avgPerDay: 15,
    restockEveryDays: 14,
    restockQty: 1200,
    startingStock: 2000,
  })
  csavarIpari.currentStock = hCsavarI.endingStock + 2200
  products.push(csavarIpari)
  movements.push(...hCsavarI.movements)

  // 2) Gipszkarton lap - healthy, normal stock
  const gipsz = mk(
    {
      name: 'Gipszkarton lap 12.5mm',
      sku: 'GK-125',
      category: 'Építőanyag',
      unit: 'm²',
      minStock: 100,
      purchasePrice: 1200,
      salePrice: 2100,
      supplierId: supEpker.id,
      locationId: locBelvaros.id,
      defaultVatRatePercent: 27,
    },
    0,
  )
  const hGipsz = buildHistory({
    productId: gipsz.id,
    locationId: locBelvaros.id,
    days: 150,
    avgPerDay: 8,
    restockEveryDays: 20,
    startingStock: 300,
  })
  gipsz.currentStock = hGipsz.endingStock + 180
  products.push(gipsz)
  movements.push(...hGipsz.movements)

  // 3) OSB lap - slow moving: consumption stopped in the last 60 days
  const osb = mk(
    {
      name: 'OSB lap 18mm',
      sku: 'OSB-18',
      category: 'Építőanyag',
      unit: 'm²',
      minStock: 50,
      purchasePrice: 3200,
      salePrice: 5400,
      supplierId: supFa.id,
      locationId: locIpari.id,
      defaultVatRatePercent: 27,
    },
    0,
  )
  const hOsbOld = buildHistory({
    productId: osb.id,
    locationId: locIpari.id,
    days: 150,
    avgPerDay: 6,
    restockEveryDays: 60,
    startingStock: 400,
  })
  // Zero out any "out" movements from the last 60 days to simulate the stall.
  const cutoff = iso(subDays(now, 60))
  const filteredOsb = hOsbOld.movements.filter((m) => !(m.type === 'out' && m.date >= cutoff))
  osb.currentStock = 260
  products.push(osb)
  movements.push(...filteredOsb)

  // 4) Ragasztóhab - dead stock, no movement at all in the tracked window
  const ragasztohab = mk(
    {
      name: 'Poliuretán ragasztóhab',
      sku: 'RH-750',
      category: 'Vegyi termékek',
      unit: 'db',
      minStock: 20,
      purchasePrice: 1500,
      salePrice: 2900,
      supplierId: supFa.id,
      locationId: locBelvaros.id,
    },
    65,
  )
  products.push(ragasztohab)
  movements.push({
    id: createId(),
    productId: ragasztohab.id,
    locationId: locBelvaros.id,
    date: iso(subMonths(now, 8)),
    type: 'in',
    quantity: 65,
    note: 'Kezdő készlet',
    createdAt: subMonths(now, 8).toISOString(),
  })

  // 5) Cement 25kg - healthy volume seller
  const cement = mk(
    {
      name: 'Cement 25kg zsák',
      sku: 'CEM-25',
      category: 'Építőanyag',
      unit: 'db',
      minStock: 80,
      purchasePrice: 1800,
      salePrice: 2600,
      supplierId: supEpker.id,
      locationId: locIpari.id,
      defaultVatRatePercent: 27,
    },
    0,
  )
  const hCement = buildHistory({
    productId: cement.id,
    locationId: locIpari.id,
    days: 150,
    avgPerDay: 12,
    restockEveryDays: 15,
    startingStock: 500,
  })
  cement.currentStock = hCement.endingStock + 150
  products.push(cement)
  movements.push(...hCement.movements)
  attachCustomerSales(hCement.movements, cement.id, cement.salePrice, [
    { customerId: custKovacs.id, isPaid: false },
    { customerId: custSzabo.id, isPaid: true },
  ])

  // 6) PVC csővezeték - trending toward a reorder alert (below safety window, not yet under minStock)
  const pvc = mk(
    {
      name: 'PVC csővezeték 32mm',
      sku: 'PVC-32',
      category: 'Vízvezeték',
      unit: 'fm',
      minStock: 60,
      purchasePrice: 450,
      salePrice: 890,
      supplierId: supMetal.id,
      locationId: locBelvaros.id,
      defaultVatRatePercent: 27,
    },
    0,
  )
  const hPvc = buildHistory({
    productId: pvc.id,
    locationId: locBelvaros.id,
    days: 150,
    avgPerDay: 9,
    restockEveryDays: 25,
    startingStock: 350,
  })
  pvc.currentStock = 75
  products.push(pvc)
  movements.push(...hPvc.movements)
  attachCustomerSales(hPvc.movements, pvc.id, pvc.salePrice, [
    { customerId: custKovacs.id, isPaid: false },
    { customerId: custNagy.id, isPaid: true },
  ])

  // 7) Zsanér szett - normal
  const zsanér = mk(
    {
      name: 'Zsanér szett (3 db)',
      sku: 'ZSN-3',
      category: 'Vasalatok',
      unit: 'csomag',
      minStock: 15,
      purchasePrice: 950,
      salePrice: 1790,
      supplierId: supMetal.id,
      locationId: locIpari.id,
    },
    0,
  )
  const hZsaner = buildHistory({
    productId: zsanér.id,
    locationId: locIpari.id,
    days: 150,
    avgPerDay: 2,
    restockEveryDays: 30,
    startingStock: 60,
  })
  zsanér.currentStock = hZsaner.endingStock + 30
  products.push(zsanér)
  movements.push(...hZsaner.movements)

  // 8) Kerti locsolótömlő - seasonal item with 14 months of history so the
  // year-over-year seasonality note has data to compare against.
  const tomlo = mk(
    {
      name: 'Kerti locsolótömlő 25m',
      sku: 'LOC-25',
      category: 'Kerti felszerelés',
      unit: 'db',
      minStock: 10,
      purchasePrice: 3500,
      salePrice: 6900,
      supplierId: supFa.id,
      locationId: locBelvaros.id,
    },
    0,
  )
  const hTomlo = buildHistory({
    productId: tomlo.id,
    locationId: locBelvaros.id,
    days: 420,
    avgPerDay: 1.2,
    restockEveryDays: 30,
    restockQty: 25,
    seasonal: (month) => {
      // Peak in summer (May-Aug), minimal in winter (Nov-Feb).
      const summerMonths = [4, 5, 6, 7]
      const winterMonths = [10, 11, 0, 1]
      if (summerMonths.includes(month)) return 3
      if (winterMonths.includes(month)) return 0.15
      return 1
    },
    startingStock: 20,
  })
  tomlo.currentStock = hTomlo.endingStock + 18
  products.push(tomlo)
  movements.push(...hTomlo.movements)

  // A discontinued item, soft-deleted so the "Törölt termékek megjelenítése"
  // toggle on the Készlet page has a real example out of the box. It stays
  // fully present in movements/reports, just hidden from normal browsing.
  ragasztohab.deletedAt = subDays(now, 20).toISOString()

  // Every historical "out" movement defaults to "delivered" (it's old, so
  // presumably already handed over) - a few recent ones get bumped to
  // "pending"/"shipping" below to demo the new open-sales alert section.
  for (const m of movements) {
    if (m.type === 'out' && m.saleStatus === undefined) {
      m.saleStatus = 'delivered'
      m.saleStatusChangedAt = m.createdAt
    }
  }
  const setLatestSaleStatus = (productId: string, status: Exclude<SaleStatus, 'delivered'>): Movement | undefined => {
    const target = movements.filter((m) => m.productId === productId && m.type === 'out').sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    if (target) {
      target.saleStatus = status
      target.saleStatusChangedAt = target.createdAt
    }
    return target
  }
  const pendingSale = setLatestSaleStatus(csavarBelvaros.id, 'pending')
  setLatestSaleStatus(gipsz.id, 'shipping')

  // One cancelled (stornó) sale, complete with its restocking correction
  // movement - the cement sales that attachSaleVat below tags with VAT, so
  // the ÁFA balance also has a "Stornózva" example to show.
  const cancelTarget = movements
    .filter((m) => m.productId === cement.id && m.type === 'out')
    .sort((a, b) => (a.date < b.date ? 1 : -1))[1]
  if (cancelTarget) {
    cancelTarget.cancelled = true
    cancelTarget.cancelledAt = now.toISOString()
    cancelTarget.cancelReason = 'Hibás termék'
    const correctionMovement: Movement = {
      id: createId(),
      productId: cancelTarget.productId,
      locationId: cancelTarget.locationId,
      date: iso(now),
      type: 'in',
      quantity: cancelTarget.quantity,
      note: 'Visszavétel - eladás visszavonása miatt',
      createdAt: now.toISOString(),
      unitPrice: cement.purchasePrice,
      correctsMovementId: cancelTarget.id,
    }
    movements.push(correctionMovement)
    cement.currentStock += cancelTarget.quantity
  }

  let lots = deriveLots(movements, products)

  // Attach a payment due date to each product's most recent "in" batch, so
  // the payment-obligation alert has both an "upcoming" and an "overdue"
  // example to show out of the box.
  const attachLotDueDate = (targetLots: PurchaseLot[], productId: string, dueDate: string, isPaid = false): PurchaseLot[] => {
    const mostRecent = targetLots
      .filter((l) => l.productId === productId)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    if (!mostRecent) return targetLots
    return targetLots.map((l) => (l.id === mostRecent.id ? { ...l, dueDate, isPaid } : l))
  }
  lots = attachLotDueDate(lots, cement.id, iso(addDays(now, 5)))
  lots = attachLotDueDate(lots, pvc.id, iso(subDays(now, 2)))

  // A couple of purchase batches tracked for ÁFA - one reclaimable (the
  // common case), one not (so the unit-cost impact and the "nem
  // visszaigényelhető" summary bucket both have something to show).
  const attachLotVat = (targetLots: PurchaseLot[], productId: string, vatRatePercent: number, vatReclaimable: boolean): PurchaseLot[] => {
    const mostRecent = targetLots.filter((l) => l.productId === productId).sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    if (!mostRecent) return targetLots
    return targetLots.map((l) => (l.id === mostRecent.id ? { ...l, vatRatePercent, vatReclaimable } : l))
  }
  lots = attachLotVat(lots, gipsz.id, 27, true)
  lots = attachLotVat(lots, osb.id, 27, false)

  // A handful of recent sales tracked for ÁFA (sale VAT is always payable,
  // regardless of whether the sale is tied to a customer).
  const attachSaleVat = (targetMovements: Movement[], productId: string, salePrice: number, vatRatePercent: number, count: number) => {
    const candidates = targetMovements
      .filter((m) => m.productId === productId && m.type === 'out')
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, count)
    for (const m of candidates) {
      m.vatRatePercent = vatRatePercent
      if (m.saleUnitPrice === undefined) m.saleUnitPrice = salePrice
    }
  }
  attachSaleVat(movements, csavarBelvaros.id, csavarBelvaros.salePrice, 27, 6)
  attachSaleVat(movements, gipsz.id, gipsz.salePrice, 27, 4)
  attachSaleVat(movements, cement.id, cement.salePrice, 27, 4)

  // A handful of general ledger entries so the financial journal isn't
  // empty on first open - rent, payroll, a dividend, and a payable/
  // reclaimable ÁFA pair to demo the VAT balance.
  const mkLedgerEntry = (
    monthsAgo: number,
    day: number,
    type: LedgerEntry['type'],
    category: string,
    description: string,
    amount: number,
    extra?: Partial<Pick<LedgerEntry, 'vatRatePercent' | 'vatDirection' | 'note' | 'dueDate' | 'isPaid' | 'paidDate'>>,
  ): LedgerEntry => {
    const date = new Date(subMonths(now, monthsAgo))
    date.setDate(day)
    return {
      id: createId(),
      date: iso(date),
      type,
      category,
      description,
      amount,
      currency: 'HUF',
      exchangeRate: 1,
      createdAt: date.toISOString(),
      updatedAt: date.toISOString(),
      ...extra,
    }
  }

  const ledgerEntries: LedgerEntry[] = [
    mkLedgerEntry(2, 5, 'expense', 'Bérleti díj', 'Belvárosi telephely bérleti díja', 280000),
    mkLedgerEntry(1, 5, 'expense', 'Bérleti díj', 'Belvárosi telephely bérleti díja', 280000),
    mkLedgerEntry(0, 5, 'expense', 'Bérleti díj', 'Belvárosi telephely bérleti díja', 280000),
    mkLedgerEntry(1, 10, 'expense', 'Bérköltség', '2 fő eladó bére', 950000),
    mkLedgerEntry(0, 10, 'expense', 'Bérköltség', '2 fő eladó bére', 950000),
    mkLedgerEntry(1, 10, 'expense', 'Bérjárulék', 'Bérköltséghez kapcsolódó járulékok', 185000),
    mkLedgerEntry(0, 10, 'expense', 'Bérjárulék', 'Bérköltséghez kapcsolódó járulékok', 185000),
    mkLedgerEntry(0, 20, 'expense', 'Osztalék', 'Tulajdonosi osztalékfizetés', 500000),
    // An unpaid, upcoming payment obligation - due in 2 days.
    mkLedgerEntry(0, 1, 'expense', 'Bérleti díj', 'Ipari parki raktár bérleti díja', 210000, {
      dueDate: iso(addDays(now, 2)),
      isPaid: false,
    }),
    // An unpaid, overdue payment obligation.
    mkLedgerEntry(0, 1, 'expense', 'Egyéb', 'Irodai internet és telefon szolgáltatás díja', 18500, {
      dueDate: iso(subDays(now, 4)),
      isPaid: false,
    }),
    mkLedgerEntry(1, 20, 'expense', VAT_CATEGORY, 'Negyedéves ÁFA bevallás - fizetendő', 620000, {
      vatRatePercent: 27,
      vatDirection: 'payable',
    }),
    mkLedgerEntry(1, 20, 'income', VAT_CATEGORY, 'Beszerzésekre jutó visszaigényelhető ÁFA', 214000, {
      vatRatePercent: 27,
      vatDirection: 'reclaimable',
    }),
    mkLedgerEntry(0, 3, 'expense', 'Egyéb', 'Irodaszer beszerzés', 24500),
    mkLedgerEntry(0, 8, 'expense', 'Marketing', 'Közösségi média hirdetés', 45000),
  ]

  const ledgerCategories = Array.from(new Set([...DEFAULT_LEDGER_CATEGORIES, ...ledgerEntries.map((e) => e.category)]))

  // A handful of illustrative audit entries so the Audit napló page and each
  // entity's "Előzmények" panel aren't empty on first open. The bulk of the
  // seeded movement history predates the audit log (same as real legacy data
  // would) - only these recent, hand-picked edits get logged.
  const osbNonReclaimableLot = lots.find((l) => l.productId === osb.id && l.vatReclaimable === false)
  const auditLog: AuditLogEntry[] = [
    {
      id: createId(),
      timestamp: subDays(now, 10).toISOString(),
      entityType: 'supplier',
      entityId: supMetal.id,
      entityLabel: supMetal.name,
      action: 'update',
      description: `"${supMetal.name}" beszállító adatai módosultak`,
      changes: [{ field: 'phone', label: 'Telefonszám', oldValue: '+36 30 111 2200', newValue: supMetal.phone ?? '—' }],
    },
    {
      id: createId(),
      timestamp: subDays(now, 3).toISOString(),
      entityType: 'lot',
      entityId: osbNonReclaimableLot?.id ?? createId(),
      entityLabel: osb.name,
      action: 'update',
      description: 'Beszerzési tétel ÁFA adatai módosultak',
      changes: [{ field: 'vatReclaimable', label: 'ÁFA visszaigényelhető', oldValue: 'Igen', newValue: 'Nem' }],
    },
    {
      id: createId(),
      timestamp: subDays(now, 1).toISOString(),
      entityType: 'movement',
      entityId: cancelTarget?.id ?? createId(),
      entityLabel: cement.name,
      action: 'cancel',
      description: 'Eladás visszavonva (Hibás termék)',
    },
    {
      id: createId(),
      timestamp: now.toISOString(),
      entityType: 'movement',
      entityId: pendingSale?.id ?? createId(),
      entityLabel: csavarBelvaros.name,
      action: 'update',
      description: 'Eladási státusz módosítva',
      changes: [{ field: 'saleStatus', label: 'Eladási státusz', oldValue: '—', newValue: 'Kiadásra vár' }],
    },
    {
      id: createId(),
      timestamp: subDays(now, 20).toISOString(),
      entityType: 'product',
      entityId: ragasztohab.id,
      entityLabel: ragasztohab.name,
      action: 'delete',
      description: `"${ragasztohab.name}" termék törölve`,
    },
  ]

  return { locations, suppliers, customers, products, movements, lots, ledgerEntries, ledgerCategories, auditLog }
}
