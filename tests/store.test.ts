// @vitest-environment jsdom
// A store (useStore) fő mozgásrögzítő műveletei helyi módban, a böngésző
// localStorage-ával (jsdom). Minden teszt üres adattal indul (clearAllData).
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../src/store/useStore'
import { DEFAULT_SETTINGS, type CostingMethod } from '../src/types'

function setup(costingMethod: CostingMethod = 'average') {
  const s = useStore.getState()
  s.clearAllData()
  s.updateSettings({ ...DEFAULT_SETTINGS, costingMethod })
  const locationId = useStore.getState().locations[0].id
  useStore.getState().addProduct({
    name: 'Bejárati ajtó',
    category: 'Ajtó',
    unit: 'db',
    currentStock: 0,
    minStock: 1,
    purchasePrice: 0,
    salePrice: 2000,
    locationId,
  })
  return useStore.getState().products[0].id
}

const store = () => useStore.getState()
const productById = (id: string) => store().products.find((p) => p.id === id)!

beforeEach(() => {
  localStorage.clear()
})

describe('mozgásrögzítés', () => {
  it('a beérkezés növeli a készletet, beszerzési tételt hoz létre, és naplóz', () => {
    const id = setup()
    expect(store().recordMovement({ productId: id, type: 'in', quantity: 10, date: '2026-10-01', unitPrice: 1000 })).toEqual({ ok: true })
    expect(productById(id).currentStock).toBe(10)
    expect(productById(id).purchasePrice).toBe(1000)
    expect(store().lots).toHaveLength(1)
    expect(store().lots[0]).toMatchObject({ quantity: 10, remainingQuantity: 10, unitPrice: 1000 })
    expect(store().auditLog.at(-1)!.description).toContain('Bejövő mozgás rögzítve')
  })

  it('átlagáras módszernél a második beérkezés súlyozott átlagot ad', () => {
    const id = setup('average')
    store().recordMovement({ productId: id, type: 'in', quantity: 10, date: '2026-10-01', unitPrice: 1000 })
    store().recordMovement({ productId: id, type: 'in', quantity: 10, date: '2026-10-02', unitPrice: 1200 })
    expect(productById(id).purchasePrice).toBe(1100)
  })

  it('FIFO-nál az eladás a legrégebbi tétel költségét viszi, átlagárnál az átlagot', () => {
    for (const [method, expected] of [['fifo', 1000], ['average', 1100]] as const) {
      const id = setup(method)
      store().recordMovement({ productId: id, type: 'in', quantity: 10, date: '2026-10-01', unitPrice: 1000 })
      store().recordMovement({ productId: id, type: 'in', quantity: 10, date: '2026-10-02', unitPrice: 1200 })
      store().recordMovement({ productId: id, type: 'out', quantity: 5, date: '2026-10-03' })
      const sale = store().movements.at(-1)!
      expect(sale.unitCost).toBe(expected)
      expect(sale.saleUnitPrice).toBe(2000)
      expect(productById(id).currentStock).toBe(15)
      // A tételek mindkét módszernél FIFO szerint fogynak.
      expect(store().lots.map((l) => l.remainingQuantity)).toEqual([5, 10])
    }
  })

  it('nem enged negatív készletet, csak kifejezett engedéllyel', () => {
    const id = setup()
    store().recordMovement({ productId: id, type: 'in', quantity: 2, date: '2026-10-01', unitPrice: 1000 })
    expect(store().recordMovement({ productId: id, type: 'out', quantity: 3, date: '2026-10-02' })).toEqual({
      ok: false,
      reason: 'insufficient-stock',
      resultingStock: -1,
    })
    expect(productById(id).currentStock).toBe(2)
    expect(store().recordMovement({ productId: id, type: 'out', quantity: 3, date: '2026-10-02' }, { allowNegativeStock: true })).toEqual({ ok: true })
    expect(productById(id).currentStock).toBe(-1)
  })

  it('érvénytelen mennyiséget, árat és ismeretlen terméket elutasít', () => {
    const id = setup()
    expect(store().recordMovement({ productId: id, type: 'in', quantity: 0, date: '2026-10-01' })).toMatchObject({ ok: false, reason: 'invalid-quantity' })
    expect(store().recordMovement({ productId: id, type: 'in', quantity: 1, date: '2026-10-01', unitPrice: -5 })).toMatchObject({ ok: false })
    expect(store().recordMovement({ productId: id, type: 'in', quantity: 1, date: '2026-10-01', unitPrice: 5, currency: 'EUR' })).toMatchObject({ ok: false })
    expect(store().recordMovement({ productId: 'nincs', type: 'in', quantity: 1, date: '2026-10-01' })).toMatchObject({ ok: false, reason: 'product-not-found' })
    expect(store().movements).toHaveLength(0)
  })

  it('a stornó visszaadja a készletet, az eredeti eladás megmarad, jelölve', () => {
    const id = setup()
    store().recordMovement({ productId: id, type: 'in', quantity: 5, date: '2026-10-01', unitPrice: 1000 })
    store().recordMovement({ productId: id, type: 'out', quantity: 2, date: '2026-10-02', vatRatePercent: 27 })
    const saleId = store().movements.at(-1)!.id
    expect(store().cancelSale(saleId, 'Téves rögzítés')).toMatchObject({ ok: true })
    expect(productById(id).currentStock).toBe(5)
    expect(store().movements.find((m) => m.id === saleId)!.cancelled).toBe(true)
    expect(store().cancelSale(saleId)).toMatchObject({ ok: false, reason: 'already-cancelled' })
  })
})

describe('kétlépcsős beszerzés (iroda → raktár)', () => {
  it('a rendelés leadása nem mozgat készletet; csak a beérkezés jóváhagyása, a ténylegesen átvett mennyiséggel', () => {
    const id = setup()
    expect(store().createPendingPurchaseOrder({ productId: id, quantity: 10, date: '2026-10-01', unitPrice: 1000 })).toEqual({ ok: true })
    const orderId = store().movements.at(-1)!.id
    expect(store().movements.at(-1)!.approvalStatus).toBe('pending')
    expect(productById(id).currentStock).toBe(0)
    expect(store().lots).toHaveLength(0)

    expect(store().approvePurchaseOrder(orderId, 8, 'Két darab sérült')).toEqual({ ok: true })
    expect(productById(id).currentStock).toBe(8)
    expect(store().lots).toHaveLength(1)
    expect(store().lots[0].quantity).toBe(8)
    expect(store().approvePurchaseOrder(orderId)).toMatchObject({ ok: false, reason: 'not-pending' })
  })
})

describe('helyi mentés', () => {
  it('a store állapota a localStorage-ba kerül, helyi módban', () => {
    setup()
    const saved = JSON.parse(localStorage.getItem('keszletfigyelo-storage')!)
    expect(saved.state.dataMode).toBe('local')
    expect(saved.state.products).toHaveLength(1)
  })
})
