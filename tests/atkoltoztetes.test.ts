import { describe, expect, it } from 'vitest'
import {
  CSOPORT_SORREND,
  KOTEG_MERET,
  atkoltoztetesiTerv,
  demoAdatnakTunik,
  feltoltesiKotegek,
  helyiPillanatkep,
  hianyzoRekordok,
  type Csoport,
  type HelyiAdatok,
} from '../src/lib/atkoltoztetes'
import { emptyBusinessSlices } from '../src/lib/remoteSync'
import { buildSeedData } from '../src/store/seed'
import { DEFAULT_SETTINGS } from '../src/types'

function helyiDemo(): HelyiAdatok {
  return { ...buildSeedData(), recurringLedgerEntries: [], settings: DEFAULT_SETTINGS }
}

const osszes = (h: HelyiAdatok) => new Set<Csoport>(CSOPORT_SORREND.filter((c) => (h[c] as unknown[]).length > 0))

describe('a böngésző pillanatképének beolvasása', () => {
  it('a Zustand persist formátumát olvassa, a hiányzó részeket üresnek veszi', () => {
    const h = helyiPillanatkep(JSON.stringify({ state: { suppliers: [{ id: 's1', name: 'Ablak Kft.', leadTimeDays: 7 }] }, version: 1 }))
    expect(h?.suppliers).toHaveLength(1)
    expect(h?.products).toEqual([])
    expect(h?.settings.costingMethod).toBe(DEFAULT_SETTINGS.costingMethod)
  })

  it('hiányzó vagy sérült adatnál nincs mit átköltöztetni', () => {
    expect(helyiPillanatkep(null)).toBeNull()
    expect(helyiPillanatkep('{nem json')).toBeNull()
  })
})

describe('átköltöztetési terv', () => {
  it('üres cégnél (nincs még készletadat a szerveren) minden átkerülhet', () => {
    const h = helyiDemo()
    const terv = atkoltoztetesiTerv(h, emptyBusinessSlices, false)
    expect(terv.mod).toBe('teljes')
    expect(terv.feltoltheto.products).toHaveLength(h.products.length)
    expect(terv.feltoltheto.movements).toHaveLength(h.movements.length)
    expect(terv.kihagyott).toEqual({})
    expect(terv.beallitasok).not.toBeNull()
  })

  it('ha a szerveren már van készletadat, a böngésző készletadatát nem keveri hozzá, csak az irodai adatot viszi', () => {
    const h = helyiDemo()
    const masikGeprol = { ...h.products[0], id: 'masik-geprol-rogzitett-termek' }
    const szerver = { ...emptyBusinessSlices, products: [masikGeprol], suppliers: [h.suppliers[0]] }
    const terv = atkoltoztetesiTerv(h, szerver, true)
    expect(terv.mod).toBe('kiegeszito')
    expect(terv.feltoltheto.products).toBeUndefined()
    expect(terv.kihagyott.products).toBe(h.products.length)
    expect(terv.kihagyott.movements).toBe(h.movements.length)
    // ami már a szerveren van, az nem kerül fel még egyszer
    expect(terv.feltoltheto.suppliers).toHaveLength(h.suppliers.length - 1)
    expect(terv.feltoltheto.customers).toHaveLength(h.customers.length)
  })

  it('egy megszakadt átköltöztetés folytatása (a szerveren csak ebből a böngészőből való adat van) teljes módban folytatódik', () => {
    const h = helyiDemo()
    const szerver = { ...emptyBusinessSlices, products: h.products.slice(0, 2), movements: h.movements.slice(0, 5) }
    const terv = atkoltoztetesiTerv(h, szerver, false)
    expect(terv.mod).toBe('teljes')
    expect(terv.feltoltheto.movements).toHaveLength(h.movements.length - 5)
  })

  it('a szerveren már beállított értékeket nem írja felül, a napló-kategóriákat összefésüli', () => {
    const h = { ...helyiDemo(), ledgerCategories: ['ÁFA', 'Saját kategória'] }
    const szerver = { ...emptyBusinessSlices, settings: { ...DEFAULT_SETTINGS, costingMethod: 'fifo' as const }, ledgerCategories: ['ÁFA'] }
    const terv = atkoltoztetesiTerv(h, szerver, true)
    expect(terv.beallitasok).toEqual({ settings: szerver.settings, ledgerCategories: ['ÁFA', 'Saját kategória'] })
    expect(atkoltoztetesiTerv({ ...h, ledgerCategories: ['ÁFA'] }, szerver, true).beallitasok).toBeNull()
  })

  it('felismeri, ha a böngészőben csak a beépített bemutató adat van', () => {
    const h = helyiDemo()
    expect(demoAdatnakTunik(h)).toBe(true)
    expect(demoAdatnakTunik({ ...h, products: [...h.products, { ...h.products[0], id: 'x', name: 'Saját termék' }] })).toBe(false)
    expect(demoAdatnakTunik({ ...h, products: [] })).toBe(false)
  })
})

describe('kötegek és ellenőrzés', () => {
  it('a kötegek mérete korlátozott, a sorrend (telephely → termék → mozgás) megmarad, és semmi nem vész el', () => {
    const h = helyiDemo()
    const terv = atkoltoztetesiTerv(h, emptyBusinessSlices, false)
    const kotegek = feltoltesiKotegek(h, terv, osszes(h))
    expect(kotegek.length).toBeGreaterThan(1)
    for (const k of kotegek) expect(Object.values(k).reduce((n, l) => n + (l as unknown[]).length, 0)).toBeLessThanOrEqual(KOTEG_MERET)
    const sorrend = kotegek.flatMap((k) => CSOPORT_SORREND.filter((c) => k[c]))
    expect(sorrend.indexOf('locations')).toBeLessThan(sorrend.indexOf('products'))
    expect(sorrend.indexOf('products')).toBeLessThan(sorrend.indexOf('movements'))
    const darab = kotegek.reduce((s, k) => s + Object.values(k).reduce((n, l) => n + (l as unknown[]).length, 0), 0)
    expect(darab).toBe(terv.osszesen)
  })

  it('csak a kiválasztott csoportok kerülnek a kötegekbe', () => {
    const h = helyiDemo()
    const terv = atkoltoztetesiTerv(h, emptyBusinessSlices, false)
    const kotegek = feltoltesiKotegek(h, terv, new Set<Csoport>(['suppliers']))
    expect(kotegek).toEqual([{ suppliers: h.suppliers }])
  })

  it('az ellenőrzés kimutatja, ha egy rekord nem érkezett meg', () => {
    const h = helyiDemo()
    const terv = atkoltoztetesiTerv(h, emptyBusinessSlices, false)
    const szerverUtana = { ...emptyBusinessSlices, ...h, suppliers: h.suppliers.slice(1) }
    expect(hianyzoRekordok(terv, osszes(h), szerverUtana)).toEqual({ suppliers: 1 })
    expect(hianyzoRekordok(terv, osszes(h), { ...emptyBusinessSlices, ...h })).toEqual({})
  })
})
