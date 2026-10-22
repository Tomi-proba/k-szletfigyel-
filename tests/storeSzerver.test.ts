// @vitest-environment jsdom
// A store szerveres (bejelentkezett) módja: minden felhasználói művelet pontosan EGY mentési tétel
// lesz, a korábban csak böngészős adatok is a szerverre mennek, és a böngésző helyi pillanatképe
// érintetlen marad (ez kell a veszteség nélküli átköltöztetéshez).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mentesiSor } from '../src/lib/mentes'
import type { MentesiTetel } from '../src/lib/mentesiSor'
import { emptyBusinessSlices } from '../src/lib/remoteSync'
import { hydrateFromRemote, resetToLocalMode, useStore } from '../src/store/useStore'
import { DEFAULT_SETTINGS } from '../src/types'

const CEG = '11111111-1111-4111-8111-111111111111'
const HELY = '22222222-2222-4222-8222-222222222222'

let kuldott: MentesiTetel[]

beforeEach(() => {
  kuldott = []
  vi.spyOn(mentesiSor, 'hozzaad').mockImplementation((t) => void kuldott.push(t))
})

afterEach(() => {
  vi.restoreAllMocks()
  resetToLocalMode()
})

function bejelentkezes(role: 'fo_iroda' | 'iroda' | 'raktaros' = 'fo_iroda') {
  hydrateFromRemote(CEG, 'u1', 'fo@teszt.example', 'Fő Iroda', { ...emptyBusinessSlices, locations: [{ id: HELY, name: 'Fő telephely' }] }, role)
}

function ujTermek() {
  useStore.getState().addProduct({
    name: 'Bejárati ajtó',
    category: 'Ajtó',
    unit: 'db',
    currentStock: 0,
    minStock: 1,
    purchasePrice: 0,
    salePrice: 2000,
    locationId: HELY,
  })
  return useStore.getState().products[0].id
}

const tablak = (t: MentesiTetel) => t.valtozasok.map((v) => v.tabla)

describe('szerveres mód: egy művelet = egy mentési tétel', () => {
  it('termék felvétele: termék + naplóbejegyzés egy tételben, új sorként (verzió nélkül)', () => {
    bejelentkezes()
    ujTermek()
    expect(kuldott).toHaveLength(1)
    expect(tablak(kuldott[0])).toEqual(['products', 'audit_log'])
    expect(kuldott[0].valtozasok[0].sor).toMatchObject({ company_id: CEG, location_id: HELY, name: 'Bejárati ajtó', version: null })
    expect(kuldott[0].leirasok[0]).toContain('Bejárati ajtó')
  })

  it('beérkezés: a termék, a mozgás, a beszerzési tétel és a napló együtt megy, a termék már ismert verzióval', () => {
    bejelentkezes()
    const id = ujTermek()
    useStore.getState().recordMovement({ productId: id, type: 'in', quantity: 10, date: '2026-10-23', unitPrice: 1000 })
    expect(kuldott).toHaveLength(2)
    expect(tablak(kuldott[1])).toEqual(['products', 'movements', 'purchase_lots', 'audit_log'])
    expect(kuldott[1].valtozasok[0].sor).toMatchObject({ current_stock: 10, version: 1 })
    // a következő módosítás már a 2. verzióra épül
    useStore.getState().recordMovement({ productId: id, type: 'out', quantity: 2, date: '2026-10-23' })
    expect(kuldott[2].valtozasok[0].sor).toMatchObject({ current_stock: 8, version: 2 })
  })

  it('a korábban csak böngészőben tárolt adatok is a szerverre mennek: beszállító, vevő, napló, beállítások', () => {
    bejelentkezes()
    useStore.getState().addSupplier({ name: 'Ablak Kft.', leadTimeDays: 7 })
    useStore.getState().addCustomer({ name: 'Kovács Bt.' })
    useStore.getState().addLedgerEntry({
      date: '2026-10-23',
      type: 'expense',
      category: 'Bérleti díj',
      description: 'Raktárbérlet',
      amount: 100000,
      currency: 'HUF',
      exchangeRate: 1,
    })
    useStore.getState().updateSettings({ ...DEFAULT_SETTINGS, costingMethod: 'fifo' })
    expect(kuldott.map((t) => tablak(t)[0])).toEqual(['suppliers', 'customers', 'ledger_entries', 'company_settings'])
    expect(kuldott[3].valtozasok[0].sor).toMatchObject({ id: CEG, company_id: CEG, settings: { costingMethod: 'fifo' } })
  })

  it('helyi módban semmi nem megy a szerverre', () => {
    useStore.getState().clearAllData()
    useStore.getState().addSupplier({ name: 'Helyi beszállító', leadTimeDays: 3 })
    expect(kuldott).toEqual([])
  })
})

describe('a helyi pillanatkép védelme', () => {
  it('szerveres munkamenet alatt a böngésző helyi adatai érintetlenek, kijelentkezés után visszajönnek', async () => {
    useStore.getState().clearAllData()
    useStore.getState().addSupplier({ name: 'Helyi beszállító', leadTimeDays: 3 })
    const elotte = localStorage.getItem('keszletfigyelo-storage')
    expect(elotte).toContain('Helyi beszállító')

    bejelentkezes()
    useStore.getState().addSupplier({ name: 'Céges beszállító', leadTimeDays: 5 })
    expect(localStorage.getItem('keszletfigyelo-storage')).toBe(elotte)

    resetToLocalMode()
    await Promise.resolve()
    expect(localStorage.getItem('keszletfigyelo-storage')).toBe(elotte)
    expect(useStore.getState().dataMode).toBe('local')
    expect(useStore.getState().suppliers.map((s) => s.name)).toEqual(['Helyi beszállító'])
  })
})
