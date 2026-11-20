// @vitest-environment jsdom
// A raktáros megadja, mennyiért ment ki az áru (a felhasználó kérése). Olcsóbban csak indokkal; a fő iroda látja és
// átírhatja; az elfogadott ár lesz az eladás ára.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../src/store/useStore'
import { bruttobolNetto, nettobolBrutto, olcsobb } from '../src/lib/raktariAr'
import { DEFAULT_SETTINGS } from '../src/types'
import type { UserRole } from '../src/types/auth'

const store = () => useStore.getState()
const szerep = (remoteRole: UserRole | null) => useStore.setState({ dataMode: remoteRole ? 'remote' : 'local', remoteRole })
const NAP = '2026-11-20'
const mozgas = (id: string) => store().movements.find((m) => m.id === id)!

function setup() {
  szerep(null)
  store().clearAllData()
  store().updateSettings({ ...DEFAULT_SETTINGS, costingMethod: 'fifo' })
  const locationId = store().locations[0].id
  store().addProduct({ name: 'Alma', category: 'Gyümölcs', unit: 'kg', currentStock: 0, minStock: 0, purchasePrice: 300, salePrice: 500, locationId, defaultVatRatePercent: 27 })
  const alma = store().products[0].id
  store().recordMovement({ productId: alma, type: 'in', quantity: 100, date: '2026-11-19', unitPrice: 300 })
  return alma
}

beforeEach(() => localStorage.clear())

describe('raktári eladási ár', () => {
  it('áfás ár ↔ áfa nélküli ár, olcsóbb-e', () => {
    expect(nettobolBrutto(500, 27)).toBe(635)
    expect(bruttobolNetto(635, 27)).toBe(500)
    expect(olcsobb(499.99, 500)).toBe(false)
    expect(olcsobb(450, 500)).toBe(true)
  })

  it('a raktáros bejelentésében: olcsóbban csak indokkal; a fő iroda elfogadásakor ez az eladás ára', () => {
    const alma = setup()
    szerep('raktaros')
    expect(store().createWarehouseReport({ productId: alma, type: 'out', quantity: 10, date: NAP, eladasiAr: 400 })).toEqual({ ok: false, reason: 'price-reason-required' })
    const r = store().createWarehouseReport({ productId: alma, type: 'out', quantity: 10, date: NAP, eladasiAr: 400, arIndok: 'Akció' })
    expect(r.ok).toBe(true)
    const id = (r as { id: string }).id
    expect(mozgas(id)).toMatchObject({ saleUnitPrice: 400, note: 'Olcsóbban ment ki: Akció' })
    szerep('fo_iroda')
    expect(store().approveSalePrep(id).ok).toBe(true)
    expect(mozgas(id)).toMatchObject({ approvalStatus: 'approved', saleUnitPrice: 400 })
  })

  it('a listaáron nem kell indok; a fő iroda átírhatja; ár nélkül a termék ára marad', () => {
    const alma = setup()
    szerep('raktaros')
    const a = (store().createWarehouseReport({ productId: alma, type: 'out', quantity: 1, date: NAP, eladasiAr: 520 }) as { id: string }).id
    const b = (store().createWarehouseReport({ productId: alma, type: 'out', quantity: 1, date: NAP }) as { id: string }).id
    expect(mozgas(a).note).toBeUndefined()
    szerep('fo_iroda')
    expect(store().approveSalePrep(a, { saleUnitPrice: 480 }).ok).toBe(true)
    expect(store().approveSalePrep(b).ok).toBe(true)
    expect(mozgas(a).saleUnitPrice).toBe(480)
    expect(mozgas(b).saleUnitPrice).toBe(500)
  })

  it('az iroda által előkészített kiadás visszaigazolásakor is megadható', () => {
    const alma = setup()
    szerep('fo_iroda')
    expect(store().createPendingSalePrep({ productId: alma, quantity: 5, date: NAP }).ok).toBe(true)
    const ki = store().movements.find((m) => m.type === 'out' && m.approvalStatus === 'pending')!.id
    useStore.setState((s) => ({ movements: s.movements.map((m) => (m.id === ki ? { ...m, raktarVisszaigazolva: undefined, raktarMennyiseg: undefined } : m)) }))
    szerep('raktaros')
    expect(store().confirmByWarehouse(ki, { quantity: 5, eladasiAr: 300 })).toEqual({ ok: false, reason: 'price-reason-required' })
    expect(store().confirmByWarehouse(ki, { quantity: 5, eladasiAr: 300, arIndok: 'Sérült / romlott' })).toEqual({ ok: true })
    expect(mozgas(ki)).toMatchObject({ saleUnitPrice: 300, raktarMegjegyzes: 'Olcsóbban ment ki: Sérült / romlott' })
  })
})
