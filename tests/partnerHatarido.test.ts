// @vitest-environment jsdom
// Partnerek fizetési határideje (AWEBOLDAL TERV.md F30): a vevőnek eladott, ki nem fizetett tétel határideje a
// dátum + a vevő határideje; a szállító határidejéből töltődik a beszerzés határideje; a raktáros a kimenő
// bejelentéshez vevőt adhat, a fő iroda elfogadáskor átírhatja.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../src/store/useStore'
import { computeUnpaidSales } from '../src/lib/alerts'
import { hataridoNapbol, isoPlusDays } from '../src/lib/dates'
import { DEFAULT_SETTINGS } from '../src/types'
import type { UserRole } from '../src/types/auth'

const store = () => useStore.getState()
const szerep = (remoteRole: UserRole | null) => useStore.setState({ dataMode: remoteRole ? 'remote' : 'local', remoteRole })

function setup() {
  szerep(null)
  store().clearAllData()
  store().updateSettings({ ...DEFAULT_SETTINGS, costingMethod: 'fifo' })
  const locationId = store().locations[0].id
  store().addSupplier({ name: 'Ablak Kft.', leadTimeDays: 3, paymentTermDays: 30 })
  const supplierId = store().suppliers.at(-1)!.id
  store().addCustomer({ name: 'Kovács Építő Kft.', paymentTermDays: 15 })
  store().addCustomer({ name: 'Nagy Bt.' })
  const [vevo, vevoHataridoNelkul] = store().customers.slice(-2).map((c) => c.id)
  store().addProduct({ name: 'Cement', category: 'Építőanyag', unit: 'zsák', currentStock: 0, minStock: 0, purchasePrice: 1000, salePrice: 2000, locationId, supplierId })
  const productId = store().products.at(-1)!.id
  store().recordMovement({ productId, type: 'in', quantity: 50, date: '2026-11-01', unitPrice: 1000 })
  return { productId, supplierId, vevo: vevo!, vevoHataridoNelkul: vevoHataridoNelkul! }
}

beforeEach(() => localStorage.clear())

describe('fizetési határidő a partnerből', () => {
  it('dátum + napok, hónapváltással is', () => {
    expect(isoPlusDays('2026-11-14', 15)).toBe('2026-11-29')
    expect(isoPlusDays('2026-12-20', 15)).toBe('2027-01-04')
    expect(hataridoNapbol('2026-11-14', undefined)).toBeUndefined()
    expect(hataridoNapbol('2026-11-14', 0)).toBe('2026-11-14')
  })

  it('a ki nem fizetett eladás határideje a vevő határidejéből; kifizetettnél és határidő nélküli vevőnél nincs', () => {
    const { productId, vevo, vevoHataridoNelkul } = setup()
    store().recordMovement({ productId, type: 'out', quantity: 2, date: '2026-11-14', customerId: vevo, isPaid: false })
    expect(store().movements.at(-1)!.dueDate).toBe('2026-11-29')
    store().recordMovement({ productId, type: 'out', quantity: 1, date: '2026-11-14', customerId: vevo, isPaid: true })
    expect(store().movements.at(-1)!.dueDate).toBeUndefined()
    store().recordMovement({ productId, type: 'out', quantity: 1, date: '2026-11-14', customerId: vevoHataridoNelkul, isPaid: false })
    expect(store().movements.at(-1)!.dueDate).toBeUndefined()
    const lista = computeUnpaidSales(store().movements, store().products, store().customers)
    expect(lista.map((s) => s.dueDate).sort()).toEqual(['2026-11-29', null].sort())
  })

  it('a raktáros vevőt ad a kiadáshoz; a fő iroda elfogadáskor átírhatja, a határidő az új vevőé', () => {
    const { productId, vevo, vevoHataridoNelkul } = setup()
    szerep('raktaros')
    const r = store().createWarehouseReport({ productId, type: 'out', quantity: 3, date: '2026-11-14', customerId: vevoHataridoNelkul })
    expect(r.ok).toBe(true)
    const id = (r as { id: string }).id
    const bejelentes = store().movements.find((m) => m.id === id)!
    expect(bejelentes.customerId).toBe(vevoHataridoNelkul)
    expect(bejelentes.isPaid).toBeUndefined()
    expect(bejelentes.dueDate).toBeUndefined()
    szerep('fo_iroda')
    expect(store().approveSalePrep(id, { isPaid: false, customerId: vevo }).ok).toBe(true)
    expect(store().movements.find((m) => m.id === id)).toMatchObject({ customerId: vevo, isPaid: false, dueDate: '2026-11-29', approvalStatus: 'approved' })
  })

  it('a fő iroda magánszemélyre (vevő nélkül) is átírhatja: akkor nincs fizetési adat', () => {
    const { productId, vevo } = setup()
    szerep('raktaros')
    const id = (store().createWarehouseReport({ productId, type: 'out', quantity: 1, date: '2026-11-14', customerId: vevo }) as { id: string }).id
    szerep('fo_iroda')
    expect(store().approveSalePrep(id, { customerId: null }).ok).toBe(true)
    const m = store().movements.find((x) => x.id === id)!
    expect([m.customerId, m.isPaid, m.dueDate]).toEqual([undefined, undefined, undefined])
  })

  it('a beszerzés határideje a szállító határidejéből töltődik', () => {
    const { productId, supplierId } = setup()
    szerep('fo_iroda')
    expect(store().createPendingPurchaseOrder({ productId, quantity: 5, date: '2026-11-14', unitPrice: 900, supplierId }).ok).toBe(true)
    const id = store().movements.at(-1)!.id
    expect(store().approvePurchaseOrder(id)).toEqual({ ok: true })
    expect(store().lots.find((l) => l.movementId === id)).toMatchObject({ dueDate: '2026-12-14', isPaid: false })
  })
})
