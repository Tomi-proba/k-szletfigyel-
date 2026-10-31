// @vitest-environment jsdom
// Az I3 5. lépésének store-oldali működése (TERV.md F15.5, F15.8, KK6): részleges visszáru, az „Ok”
// mező, a számlaszám és a szállítási díj kérdése, a Könyvelő által követett fizetés, a szerveren
// keletkezett tételek frissítése, és a jóváhagyási lista szerepkör-szabályai.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const letoltes = vi.hoisted(() => ({ eredmeny: { movements: [] as unknown[], lots: [] as unknown[] } }))
vi.mock('../src/lib/remoteSync', async (eredeti) => ({
  ...(await eredeti<typeof import('../src/lib/remoteSync')>()),
  integracioFrissitesLetoltese: vi.fn(async () => letoltes.eredmeny),
}))

import { integracioFrissites, returnableQuantity, useStore } from '../src/store/useStore'
import { fajtaja, jovahagyhatja, SZOVEG } from '../src/lib/jovahagyando'
import { lezartIdoszakban } from '../src/lib/integracio'
import { DEFAULT_SETTINGS, type Movement } from '../src/types'

const store = () => useStore.getState()
const utolso = () => store().movements.at(-1)!

function setup() {
  store().clearAllData()
  store().updateSettings({ ...DEFAULT_SETTINGS, costingMethod: 'fifo' })
  const locationId = store().locations[0].id
  store().addProduct({ name: 'Bejárati ajtó', category: 'Ajtó', unit: 'db', currentStock: 0, minStock: 0, purchasePrice: 0, salePrice: 2000, locationId })
  return store().products[0].id
}

beforeEach(() => localStorage.clear())

describe('részleges visszáru (F15.8)', () => {
  it('vevői visszavétel részletekben, legfeljebb az eladott mennyiségig; a készlet csak jóváhagyáskor nő, az eladáskori költségen', () => {
    const p = setup()
    store().recordMovement({ productId: p, type: 'in', quantity: 10, date: '2026-11-01', unitPrice: 400 })
    store().addCustomer({ name: 'Vevő Bt.' })
    const vevo = store().customers[0].id
    store().recordMovement({ productId: p, type: 'out', quantity: 5, date: '2026-11-02', customerId: vevo })
    const eladas = utolso()
    expect(store().createReturn({ originalId: eladas.id, quantity: 2, reason: ' ' })).toEqual({ ok: false, reason: 'reason-required' })
    const r = store().createReturn({ originalId: eladas.id, quantity: 2, reason: 'sérült' })
    expect(r.ok).toBe(true)
    const vissza = utolso()
    expect(vissza).toMatchObject({ type: 'in', returnOfMovementId: eladas.id, approvalStatus: 'pending', unitPrice: 400, customerId: vevo, quantity: 2 })
    expect(store().products[0].currentStock).toBe(5)
    // A függő visszáru is beszámít: legfeljebb 3 vehető még vissza.
    expect(returnableQuantity(store().movements, eladas)).toBe(3)
    expect(store().createReturn({ originalId: eladas.id, quantity: 4, reason: 'x' })).toEqual({ ok: false, reason: 'too-much', available: 3 })
    expect(store().approveIntegrationMovement(vissza.id)).toEqual({ ok: true })
    expect(store().products[0].currentStock).toBe(7)
    expect(store().lots.at(-1)).toMatchObject({ movementId: vissza.id, unitPrice: 400, vatRatePercent: undefined })
    // Visszárura nem rögzíthető újabb visszáru, és a visszavont eladásra sem.
    expect(store().createReturn({ originalId: vissza.id, quantity: 1, reason: 'x' })).toEqual({ ok: false, reason: 'not-returnable' })
  })

  it('szállítói visszaküldés csak az eredeti beszerzési tételből, ami még raktáron van', () => {
    const p = setup()
    store().recordMovement({ productId: p, type: 'in', quantity: 4, date: '2026-11-01', unitPrice: 1000 })
    const besz = utolso()
    store().recordMovement({ productId: p, type: 'in', quantity: 10, date: '2026-11-02', unitPrice: 500 })
    store().recordMovement({ productId: p, type: 'out', quantity: 3, date: '2026-11-03' }) // FIFO: az első tételből
    expect(store().createReturn({ originalId: besz.id, quantity: 2, reason: 'hibás' })).toEqual({ ok: false, reason: 'not-enough-in-lot', available: 1 })
    expect(store().createReturn({ originalId: besz.id, quantity: 1, reason: 'hibás' }).ok).toBe(true)
    const vk = utolso()
    expect(vk).toMatchObject({ type: 'out', returnOfMovementId: besz.id, approvalStatus: 'pending' })
    expect(store().approveIntegrationMovement(vk.id)).toEqual({ ok: true })
    expect(utolso()).toMatchObject({ unitCost: 1000, approvalStatus: 'approved' })
  })
})

describe('„Ok” mező, számlaszám, szállítási díj (F15.5, F15.7/2)', () => {
  it('a leltári hiány nem eladás (nincs ár, áfa, vevő); az irány ellentmondása elutasítva', () => {
    const p = setup()
    store().recordMovement({ productId: p, type: 'in', quantity: 5, date: '2026-11-01', unitPrice: 100 })
    expect(store().recordMovement({ productId: p, type: 'in', quantity: 1, date: '2026-11-01', ok: 'leltar_hiany' })).toEqual({ ok: false, reason: 'invalid-reason' })
    expect(store().recordMovement({ productId: p, type: 'out', quantity: 1, date: '2026-11-02', ok: 'leltar_hiany', vatRatePercent: 27 }).ok).toBe(true)
    expect(utolso()).toMatchObject({ ok: 'leltar_hiany', saleUnitPrice: undefined, vatRatePercent: undefined, saleStatus: undefined, unitCost: 100 })
    expect(store().recordMovement({ productId: p, type: 'in', quantity: 1, date: '2026-11-02', ok: 'leltar_tobblet', unitPrice: 90, vatRatePercent: 27 }).ok).toBe(true)
    expect(store().lots.at(-1)).toMatchObject({ unitPrice: 90, vatRatePercent: undefined })
  })

  it('számlaszám és „a szállítási díj a számlán van?” a rögzítéskor, a rendeléskor és a jóváhagyáskor', () => {
    const p = setup()
    store().recordMovement({ productId: p, type: 'in', quantity: 1, date: '2026-11-01', unitPrice: 100, shippingCost: 10, invoiceNumber: ' SZ-1 ', shippingOnInvoice: true })
    expect(utolso()).toMatchObject({ invoiceNumber: 'SZ-1', shippingOnInvoice: true })
    // Szállítási díj nélkül a kérdésnek nincs értelme.
    store().recordMovement({ productId: p, type: 'in', quantity: 1, date: '2026-11-01', unitPrice: 100, shippingOnInvoice: true })
    expect(utolso().shippingOnInvoice).toBeUndefined()
    store().createPendingPurchaseOrder({ productId: p, quantity: 2, date: '2026-11-03', unitPrice: 100, shippingCost: 20 })
    const rendeles = utolso()
    expect(store().approvePurchaseOrder(rendeles.id, 2, undefined, { invoiceNumber: 'SZ-2', shippingOnInvoice: false })).toEqual({ ok: true })
    expect(store().movements.find((m) => m.id === rendeles.id)).toMatchObject({ invoiceNumber: 'SZ-2', shippingOnInvoice: false })
  })
})

describe('a Könyvelő által követett fizetés (KK6) és a szerveren keletkezett tételek', () => {
  it('a Könyvelő által követett fizetés kézzel nem állítható', () => {
    const p = setup()
    store().addCustomer({ name: 'Vevő Bt.' })
    store().recordMovement({ productId: p, type: 'in', quantity: 2, date: '2026-11-01', unitPrice: 100 })
    store().recordMovement({ productId: p, type: 'out', quantity: 1, date: '2026-11-02', customerId: store().customers[0].id, isPaid: false })
    const e = utolso()
    useStore.setState((s) => ({ movements: s.movements.map((m) => (m.id === e.id ? { ...m, fizetesKonyvelobol: true } : m)) }))
    store().setMovementPaid(e.id, true)
    expect(utolso().isPaid).toBe(false)
  })

  it('a frissítés csak szerveres módban fut, és beilleszti az új és a módosult tételeket', async () => {
    const p = setup()
    letoltes.eredmeny = { movements: [], lots: [] }
    expect(await integracioFrissites()).toBe(false)
    useStore.setState({ dataMode: 'remote' })
    const uj: Movement = {
      id: 'k1', productId: p, locationId: store().locations[0].id, date: '2026-11-02', type: 'in', quantity: 3, createdAt: '2026-11-02T08:00:00Z',
      approvalStatus: 'pending', orderedQuantity: 3, integracioEsemenyId: 'e1', integracioDokumentumId: 'd1', integracioForras: 'SZSZ-1',
    }
    letoltes.eredmeny = { movements: [uj], lots: [] }
    expect(await integracioFrissites()).toBe(true)
    expect(store().movements.find((m) => m.id === 'k1')).toMatchObject({ integracioForras: 'SZSZ-1' })
    letoltes.eredmeny = { movements: [{ ...uj, deletedAt: '2026-11-03T08:00:00Z' }], lots: [] }
    await integracioFrissites()
    expect(store().movements.filter((m) => m.id === 'k1')).toHaveLength(1)
    expect(store().movements.find((m) => m.id === 'k1')!.deletedAt).toBe('2026-11-03T08:00:00Z')
    useStore.setState({ dataMode: 'local' })
  })
})

describe('jóváhagyási lista: szavak és szerepkörök', () => {
  const m = (over: Partial<Movement>): Movement => ({ id: 'x', productId: 'p', locationId: 'l', date: '2026-11-02', type: 'in', quantity: 1, createdAt: '', approvalStatus: 'pending', ...over })
  const raktaros = { raktaros: true, iroda: false, csakOlvas: false, helyi: false }
  const iroda = { raktaros: false, iroda: true, csakOlvas: false, helyi: false }

  it('egyszerű, a helyzethez illő feliratok', () => {
    expect(SZOVEG[fajtaja(m({ integracioEsemenyId: 'e' }))]).toMatchObject({ rendben: 'Beérkezett', kevesebb: 'Kevesebb jött', nem: 'Nem érkezett meg' })
    expect(SZOVEG[fajtaja(m({ type: 'out', integracioEsemenyId: 'e' }))]).toMatchObject({ rendben: 'Kiadva', kevesebb: 'Kevesebb ment ki', nem: 'Nem ment ki' })
    expect(SZOVEG[fajtaja(m({ returnOfMovementId: 'o' }))].rendben).toBe('Visszajött')
    expect(SZOVEG[fajtaja(m({ type: 'out', returnOfMovementId: 'o' }))].rendben).toBe('Visszaküldve')
  })

  it('a Könyvelőből jöttet bárki jóváhagyhatja (a tulajdonos nem); a kézi visszárut a másik fél', () => {
    expect(jovahagyhatja(m({ integracioEsemenyId: 'e' }), raktaros)).toBe(true)
    expect(jovahagyhatja(m({ integracioEsemenyId: 'e' }), { ...iroda, csakOlvas: true })).toBe(false)
    expect(jovahagyhatja(m({ returnOfMovementId: 'o' }), raktaros)).toBe(true)
    expect(jovahagyhatja(m({ returnOfMovementId: 'o' }), iroda)).toBe(false)
    expect(jovahagyhatja(m({ type: 'out', returnOfMovementId: 'o' }), raktaros)).toBe(false)
    expect(jovahagyhatja(m({ type: 'out', returnOfMovementId: 'o' }), iroda)).toBe(true)
  })

  it('lezárt időszak: figyelmeztetés a napra', () => {
    const l = [{ fajta: 'PERIOD' as const, kezdet: '2026-10-01', veg: '2026-10-31' }]
    expect(lezartIdoszakban('2026-10-15', l)).toEqual(l[0])
    expect(lezartIdoszakban('2026-11-01', l)).toBeNull()
  })
})
