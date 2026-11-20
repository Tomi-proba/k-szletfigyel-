// @vitest-environment jsdom
// Sérülten érkezett áru (a felhasználó kérése): a raktáros az „Eltérés van” alatt megadja, mennyi jött összesen és ebből
// mennyi sérült. A fő iroda elfogadásakor a teljes mennyiség bevételeződik (a számlán rajta van), a sérült rész rögtön
// selejtként kimegy, és reklamációs teendő keletkezik, amíg a fő iroda le nem zárja.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../src/store/useStore'
import { DEFAULT_SETTINGS } from '../src/types'
import type { UserRole } from '../src/types/auth'

const store = () => useStore.getState()
const szerep = (remoteRole: UserRole | null) => useStore.setState({ dataMode: remoteRole ? 'remote' : 'local', remoteRole })
const NAP = '2026-11-20'

function setup() {
  szerep(null)
  store().clearAllData()
  store().updateSettings({ ...DEFAULT_SETTINGS, costingMethod: 'fifo' })
  const locationId = store().locations[0].id
  store().addSupplier({ name: 'Nagyker Kft.', leadTimeDays: 1 })
  const szallitoId = store().suppliers.at(-1)!.id
  store().addProduct({ name: 'Alma', category: 'Gyümölcs', unit: 'kg', currentStock: 0, minStock: 0, purchasePrice: 300, salePrice: 500, locationId, supplierId: szallitoId })
  const alma = store().products[0].id
  expect(store().createPendingPurchaseOrder({ productId: alma, quantity: 30, date: NAP, unitPrice: 300 }).ok).toBe(true)
  const rendeles = store().movements.find((m) => m.approvalStatus === 'pending')!.id
  return { alma, rendeles }
}

beforeEach(() => localStorage.clear())

describe('sérülten érkezett áru', () => {
  it('a raktáros megadja a sérült részt; elfogadáskor bevételeződik, a sérült rész selejtként kimegy, reklamáció lesz', () => {
    const { alma, rendeles } = setup()
    szerep('raktaros')
    // Megjegyzés nélkül nem megy; a sérült rész nem lehet több, mint ami jött.
    expect(store().confirmByWarehouse(rendeles, { quantity: 30, selejt: 4 })).toEqual({ ok: false, reason: 'note-required' })
    expect(store().confirmByWarehouse(rendeles, { quantity: 30, selejt: 31, note: 'x' })).toEqual({ ok: false, reason: 'invalid-quantity' })
    expect(store().confirmByWarehouse(rendeles, { quantity: 30, selejt: 4, note: 'Sérült / romlott volt' })).toEqual({ ok: true })
    expect(store().movements.find((m) => m.id === rendeles)).toMatchObject({ raktarMennyiseg: 30, raktarSelejt: 4 })

    szerep('fo_iroda')
    expect(store().approvePurchaseOrder(rendeles).ok).toBe(true)
    const selejt = store().movements.find((m) => m.type === 'out' && m.ok === 'selejt')!
    expect(selejt).toMatchObject({ quantity: 4, date: NAP, productId: alma })
    expect(selejt.approvalStatus ?? 'approved').toBe('approved')
    expect(store().products[0].currentStock).toBe(26)
    expect(store().movements.find((m) => m.id === rendeles)!.quantity).toBe(30)

    // Reklamációs teendő, amíg le nem zárják; csak a fő iroda zárhatja le.
    szerep('raktaros')
    expect(store().reklamacioLezarasa(rendeles).ok).toBe(false)
    szerep('fo_iroda')
    expect(store().reklamacioLezarasa(rendeles).ok).toBe(true)
    expect(store().movements.find((m) => m.id === rendeles)!.reklamacioLezarva).toBeTruthy()
    expect(store().reklamacioLezarasa(rendeles).ok).toBe(false)
  })

  it('kimenőnél a sérült rész nem adható meg', () => {
    const { alma } = setup()
    szerep('fo_iroda')
    const r = store().createPendingSalePrep({ productId: alma, quantity: 1, date: NAP }, { allowNegativeStock: true })
    expect(r.ok).toBe(true)
    const ki = store().movements.find((m) => m.type === 'out')!
    useStore.setState((s) => ({ movements: s.movements.map((m) => (m.id === ki.id ? { ...m, raktarVisszaigazolva: undefined } : m)) }))
    szerep('raktaros')
    expect(store().confirmByWarehouse(ki.id, { quantity: 1, selejt: 1 }, { allowNegativeStock: true })).toEqual({ ok: true })
    expect(store().movements.find((m) => m.id === ki.id)!.raktarSelejt).toBeUndefined()
  })
})
