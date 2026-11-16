// @vitest-environment jsdom
// F35: a fő iroda a raktártól kapott napi jelentés tételeit javíthatja (termék, mennyiség, ár, vevő), törölheti és
// pótolhatja, kötelező indoklással; az eredeti tétel érvénytelenítése és a javított tétel ugyanarra a napra kerül, így
// a jelentés és a készlet a javított állapotot mutatja; a zárás „utólag módosult” lesz.
import { beforeEach, describe, expect, it } from 'vitest'
import { napiValtozasok, useStore } from '../src/store/useStore'
import { DEFAULT_SETTINGS } from '../src/types'
import type { UserRole } from '../src/types/auth'

const store = () => useStore.getState()
const szerep = (remoteRole: UserRole | null) => useStore.setState({ dataMode: remoteRole ? 'remote' : 'local', remoteRole })
const NAP = '2026-11-10'

function setup() {
  szerep(null)
  store().clearAllData()
  store().updateSettings({ ...DEFAULT_SETTINGS, costingMethod: 'fifo' })
  const locationId = store().locations[0].id
  store().addProduct({ name: 'Alma', category: 'Gyümölcs', unit: 'kg', currentStock: 0, minStock: 0, purchasePrice: 300, salePrice: 500, locationId })
  store().addProduct({ name: 'Körte', category: 'Gyümölcs', unit: 'kg', currentStock: 0, minStock: 0, purchasePrice: 400, salePrice: 700, locationId })
  const [alma, korte] = store().products.map((p) => p.id)
  store().recordMovement({ productId: alma, type: 'in', quantity: 100, date: '2026-11-01', unitPrice: 300 })
  store().recordMovement({ productId: korte, type: 'in', quantity: 50, date: '2026-11-01', unitPrice: 400 })
  store().recordMovement({ productId: alma, type: 'out', quantity: 45, date: NAP })
  const eladas = store().movements.at(-1)!.id
  expect(store().submitDailyClosing(locationId, NAP).ok).toBe(true)
  return { locationId, alma, korte, eladas }
}
const zaras = (locationId: string) => store().dailyClosings.find((c) => c.locationId === locationId && c.date === NAP)!
const keszlet = (id: string) => store().products.find((p) => p.id === id)!.currentStock

beforeEach(() => localStorage.clear())

describe('napi jelentés javítása (F35)', () => {
  it('mennyiség javítása: 45 kg → 40 kg; a jelentés és a készlet a javítottat mutatja', () => {
    const { locationId, alma, eladas } = setup()
    expect(keszlet(alma)).toBe(55)
    const m = store().movements.find((x) => x.id === eladas)!
    expect(napiValtozasok(m, { productId: alma, quantity: 40 }, store())).toEqual(['Mennyiség: 45 kg → 40 kg'])
    expect(store().napiTetelJavitas(eladas, { productId: alma, quantity: 40 }, '')).toEqual({ ok: false, reason: 'reason-required' })
    expect(store().napiTetelJavitas(eladas, { productId: alma, quantity: 45 }, 'x')).toEqual({ ok: false, reason: 'no-change' })
    expect(store().napiTetelJavitas(eladas, { productId: alma, quantity: 40 }, 'elírás')).toEqual({ ok: true })
    expect(keszlet(alma)).toBe(60)
    const z = zaras(locationId)
    expect(z.modifiedAfterSubmission).toBe(true)
    expect(z.productBreakdown).toEqual([expect.objectContaining({ productName: 'Alma', inQuantity: 0, outQuantity: 40 })])
    expect(z.outCount).toBe(1)
    expect(z.inCount).toBe(0)
    // Egyszer javítható; a javított tétel újra javítható.
    expect(store().napiTetelJavitas(eladas, { productId: alma, quantity: 30 }, 'x')).toEqual({ ok: false, reason: 'not-editable' })
    expect(store().auditLog.at(-1)?.description).toContain('Mennyiség: 45 kg → 40 kg')
  })

  it('termékcsere: Alma → Körte', () => {
    const { locationId, alma, korte, eladas } = setup()
    expect(store().napiTetelJavitas(eladas, { productId: korte, quantity: 45 }, 'rossz termék')).toEqual({ ok: true })
    expect(keszlet(alma)).toBe(100)
    expect(keszlet(korte)).toBe(5)
    expect(zaras(locationId).productBreakdown.map((r) => r.productName)).toEqual(['Körte'])
  })

  it('törlés és pótlás', () => {
    const { locationId, alma, korte, eladas } = setup()
    expect(store().napiTetelTorles(eladas, 'tévesen rögzítették')).toEqual({ ok: true })
    expect(keszlet(alma)).toBe(100)
    expect(zaras(locationId).productBreakdown).toEqual([])
    expect(store().napiTetelPotlas({ productId: korte, type: 'in', quantity: 10, date: NAP, unitPrice: 420 }, 'kimaradt')).toEqual({ ok: true })
    expect(keszlet(korte)).toBe(60)
    expect(zaras(locationId).productBreakdown).toEqual([expect.objectContaining({ productName: 'Körte', inQuantity: 10, outQuantity: 0 })])
  })

  it('csak a fő iroda javíthat', () => {
    const { alma, eladas } = setup()
    for (const r of ['iroda', 'raktaros', 'tulajdonos'] as UserRole[]) {
      szerep(r)
      expect(store().napiTetelJavitas(eladas, { productId: alma, quantity: 40 }, 'x')).toEqual({ ok: false, reason: 'forbidden' })
      expect(store().napiTetelTorles(eladas, 'x')).toEqual({ ok: false, reason: 'forbidden' })
    }
  })
})
