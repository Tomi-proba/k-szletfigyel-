// Generates realistic-looking demo data (locations, suppliers, products and
// ~14 months of movement history) so a first-time user immediately sees the
// alerting logic in action instead of an empty app.
import { addDays, formatISO, subDays, subMonths } from 'date-fns'
import { createId } from './id'
import type { Location, Movement, Product, Supplier } from '../types'

interface SeedResult {
  locations: Location[]
  suppliers: Supplier[]
  products: Product[]
  movements: Movement[]
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

  return { locations, suppliers, products, movements }
}
