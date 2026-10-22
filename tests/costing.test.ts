import { describe, expect, it } from 'vitest'
import {
  computeInventoryPurchaseCost,
  consumeFifo,
  lotGrossHuf,
  lotNetHuf,
  lotUnitCost,
  lotVatAmountHuf,
  weightedAverageAfterReceipt,
} from '../src/lib/costing'
import { lot } from './fixtures'

describe('beszerzési tétel értékei', () => {
  it('a nettó érték az áru és a szállítás összege, forintra átszámolva', () => {
    expect(lotNetHuf(lot({ unitPrice: 10, quantity: 5, shippingCost: 20, exchangeRate: 400 }))).toBe(28000)
  })

  it('áfa nélküli tételnél az áfa 0, a bruttó a nettó', () => {
    const l = lot({ unitPrice: 1000, quantity: 2 })
    expect(lotVatAmountHuf(l)).toBe(0)
    expect(lotGrossHuf(l)).toBe(2000)
  })

  it('az áfa a nettóra (áru + szállítás) számolódik', () => {
    const l = lot({ unitPrice: 1000, quantity: 2, shippingCost: 500, vatRatePercent: 27 })
    expect(lotVatAmountHuf(l)).toBeCloseTo(675)
    expect(lotGrossHuf(l)).toBeCloseTo(3175)
  })

  it('az egységköltségbe a szállítás arányosan beépül, a visszaigényelhető áfa nem', () => {
    const l = lot({ unitPrice: 1000, quantity: 4, shippingCost: 400, vatRatePercent: 27, vatReclaimable: true })
    expect(lotUnitCost(l)).toBe(1100)
  })

  it('a nem visszaigényelhető áfa az egységköltség része', () => {
    const l = lot({ unitPrice: 1000, quantity: 4, shippingCost: 400, vatRatePercent: 27, vatReclaimable: false })
    expect(lotUnitCost(l)).toBeCloseTo(1100 * 1.27)
  })

  it('a devizás tétel egységköltsége forintban jön ki', () => {
    expect(lotUnitCost(lot({ unitPrice: 10, quantity: 2, shippingCost: 4, currency: 'EUR', exchangeRate: 400 }))).toBe(4800)
  })
})

describe('súlyozott átlagár', () => {
  it('a meglévő és a beérkező készlet értékével súlyoz, két tizedesre kerekít', () => {
    expect(weightedAverageAfterReceipt(10, 1000, 5, 1300)).toBe(1100)
    expect(weightedAverageAfterReceipt(3, 1000, 4, 1001)).toBe(1000.57)
  })

  it('üres (vagy negatív) készletnél a beérkező ár lesz az átlag', () => {
    expect(weightedAverageAfterReceipt(0, 999, 5, 1300)).toBe(1300)
    expect(weightedAverageAfterReceipt(-5, 999, 5, 1300)).toBe(1300)
  })
})

describe('FIFO-fogyasztás', () => {
  const lots = [
    lot({ id: 'uj', date: '2026-10-03', quantity: 5, remainingQuantity: 5, unitPrice: 1200 }),
    lot({ id: 'regi', date: '2026-10-01', quantity: 5, remainingQuantity: 5, unitPrice: 1000 }),
    lot({ id: 'mas-termek', productId: 'p2', date: '2026-09-01', unitPrice: 1 }),
  ]

  it('a legrégebbi tételből fogy először', () => {
    const r = consumeFifo(lots, 'p1', 7, 0)
    expect(r.totalCost).toBe(5 * 1000 + 2 * 1200)
    expect(r.unitCost).toBeCloseTo(7400 / 7)
    expect(r.shortageQty).toBe(0)
    expect(r.updatedLots.find((l) => l.id === 'regi')!.remainingQuantity).toBe(0)
    expect(r.updatedLots.find((l) => l.id === 'uj')!.remainingQuantity).toBe(3)
    expect(r.updatedLots.find((l) => l.id === 'mas-termek')!.remainingQuantity).toBe(10)
  })

  it('a bemenő tömböt nem módosítja', () => {
    consumeFifo(lots, 'p1', 7, 0)
    expect(lots.find((l) => l.id === 'regi')!.remainingQuantity).toBe(5)
  })

  it('a tételeken felüli mennyiséget a tartalék egységköltséggel árazza', () => {
    const r = consumeFifo(lots, 'p1', 12, 900)
    expect(r.shortageQty).toBe(2)
    expect(r.totalCost).toBe(5000 + 6000 + 1800)
  })

  it('a törölt tételt kihagyja', () => {
    const r = consumeFifo([lot({ deletedAt: '2026-10-02T00:00:00Z' }), lot({ id: 'l2', unitPrice: 2000 })], 'p1', 1, 0)
    expect(r.totalCost).toBe(2000)
  })
})

describe('időszaki beszerzési költség', () => {
  it('csak az időszakba eső, nem törölt tételek számítanak', () => {
    const lots = [
      lot({ id: 'a', date: '2026-10-01', quantity: 2, unitPrice: 1000 }),
      lot({ id: 'b', date: '2026-11-01', quantity: 2, unitPrice: 1000 }),
      lot({ id: 'c', date: '2026-10-15', quantity: 2, unitPrice: 1000, deletedAt: '2026-10-16T00:00:00Z' }),
    ]
    expect(computeInventoryPurchaseCost(lots, '2026-10-01', '2026-10-31')).toBe(2000)
  })
})
