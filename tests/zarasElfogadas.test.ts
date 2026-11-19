// @vitest-environment jsdom
// F39: a raktáros várakozó tételekkel is beküldheti a napi zárást; a fő iroda a zárás jóváhagyásakor egyben elfogadja a
// nap várakozó tételeit (a raktár szerinti mennyiséggel). Ami nem fogadható el (nincs szállító, nincs elég készlet,
// „nem jött meg”, a raktár még nem igazolta vissza), az a Jóváhagyás oldalon marad, az okkal.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../src/store/useStore'
import { zarasElfogadasTerv } from '../src/lib/zarasElfogadas'
import { DEFAULT_SETTINGS } from '../src/types'
import type { UserRole } from '../src/types/auth'

const store = () => useStore.getState()
const mozgas = (id: string) => store().movements.find((m) => m.id === id)!
const szerep = (remoteRole: UserRole | null) => useStore.setState({ dataMode: remoteRole ? 'remote' : 'local', remoteRole })
const NAP = '2026-11-19'

function setup() {
  szerep(null)
  store().clearAllData()
  store().updateSettings({ ...DEFAULT_SETTINGS, costingMethod: 'fifo' })
  const locationId = store().locations[0].id
  store().addSupplier({ name: 'Nagyker Kft.', leadTimeDays: 2 })
  const szallitoId = store().suppliers.at(-1)!.id
  store().addProduct({ name: 'Alma', category: 'Gyümölcs', unit: 'kg', currentStock: 0, minStock: 0, purchasePrice: 300, salePrice: 500, locationId, supplierId: szallitoId })
  store().addProduct({ name: 'Körte', category: 'Gyümölcs', unit: 'kg', currentStock: 0, minStock: 0, purchasePrice: 400, salePrice: 700, locationId })
  const [alma, korte] = store().products
  store().recordMovement({ productId: alma.id, type: 'in', quantity: 20, date: '2026-11-18', unitPrice: 300 })
  return { locationId, alma: alma.id, korte: korte.id }
}

beforeEach(() => localStorage.clear())

describe('napi zárás várakozó tételekkel (F39)', () => {
  it('a raktáros elküldheti, a fő iroda jóváhagyása egyben elfogadja, ami elfogadható', () => {
    const { locationId, alma, korte } = setup()
    szerep('raktaros')
    const be = (store().createWarehouseReport({ productId: alma, type: 'in', quantity: 10, date: NAP }) as { id: string }).id
    const ki = (store().createWarehouseReport({ productId: alma, type: 'out', quantity: 5, date: NAP }) as { id: string }).id
    // A Körtének nincs szállítója: nem fogadható el automatikusan.
    const szallitoNelkul = (store().createWarehouseReport({ productId: korte, type: 'in', quantity: 3, date: NAP }) as { id: string }).id
    // Még semmi nincs elfogadva, a zárás mégis elküldhető.
    const z = store().submitDailyClosing(locationId, NAP)
    expect(z.ok).toBe(true)
    const zarasId = (z as { closingId: string }).closingId

    const terv = zarasElfogadasTerv(store().movements, store().products, locationId, NAP)
    expect(terv.elfogadhato.map((e) => [e.m.id, e.mod, e.mennyiseg])).toEqual([
      [be, 'beszerzes', 10],
      [ki, 'kiadas', 5],
    ])
    expect(terv.kihagyott.map((k) => [k.m.id, k.ok])).toEqual([[szallitoNelkul, 'nincs megadva a szállító – adja meg az elfogadáskor']])

    // Az iroda (nem fő iroda) a zárást jóváhagyhatja, a tételeket nem.
    szerep('iroda')
    const irodai = store().approveDailyClosingWithPending(zarasId)
    expect(irodai).toMatchObject({ ok: true, elfogadva: [] })
    expect(mozgas(be).approvalStatus).toBe('pending')

    szerep('fo_iroda')
    useStore.setState((s) => ({ dailyClosings: s.dailyClosings.map((c) => (c.id === zarasId ? { ...c, status: 'submitted' } : c)) }))
    const r = store().approveDailyClosingWithPending(zarasId)
    expect(r).toEqual({ ok: true, elfogadva: [be, ki], kihagyott: [{ id: szallitoNelkul, ok: 'nincs megadva a szállító – adja meg az elfogadáskor' }] })
    expect(mozgas(be).approvalStatus).toBe('approved')
    expect(mozgas(ki).approvalStatus).toBe('approved')
    expect(mozgas(szallitoNelkul).approvalStatus).toBe('pending')
    expect(store().products.find((p) => p.id === alma)!.currentStock).toBe(25)
    expect(store().dailyClosings.find((c) => c.id === zarasId)!.status).toBe('approved')
  })

  it('a „nem jött meg” és a raktár által még vissza nem igazolt tétel kézi döntésre marad', () => {
    const { locationId, alma } = setup()
    expect(store().createPendingPurchaseOrder({ productId: alma, quantity: 8, date: NAP }).ok).toBe(true)
    expect(store().createPendingPurchaseOrder({ productId: alma, quantity: 4, date: NAP }).ok).toBe(true)
    const nemJott = store().movements.find((m) => m.approvalStatus === 'pending' && m.quantity === 4)!.id
    szerep('raktaros')
    expect(store().confirmByWarehouse(nemJott, { quantity: 0, note: 'nem hozták' })).toEqual({ ok: true })
    const terv = zarasElfogadasTerv(store().movements, store().products, locationId, NAP)
    expect(terv.elfogadhato).toEqual([])
    expect(terv.kihagyott.map((k) => k.ok).sort()).toEqual(['a raktár még nem igazolta vissza', 'a raktár szerint nem jött meg – kézzel döntsön róla'])
  })

  it('nincs elég készlet: a kiadás a Jóváhagyás oldalon marad, az okkal', () => {
    const { locationId, alma } = setup()
    szerep('raktaros')
    const ki = (store().createWarehouseReport({ productId: alma, type: 'out', quantity: 15, date: NAP }) as { id: string }).id
    szerep('fo_iroda')
    // Közben máshol elfogyott a készlet.
    useStore.setState((s) => ({ products: s.products.map((p) => (p.id === alma ? { ...p, currentStock: 2 } : p)) }))
    const zarasId = (store().submitDailyClosing(locationId, NAP) as { closingId: string }).closingId
    const r = store().approveDailyClosingWithPending(zarasId)
    expect(r).toMatchObject({ ok: true, elfogadva: [], kihagyott: [{ id: ki, ok: expect.stringMatching(/nincs elég készlet/) }] })
    expect(mozgas(ki).approvalStatus).toBe('pending')
  })
})
