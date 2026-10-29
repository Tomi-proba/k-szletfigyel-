// Az asztali (Windowsos) program javításai: a korábbi, véletlen portos indítások adatainak visszakeresése
// valódi Chromium-tárolóból, a visszatöltés, és a mentési sor fájlmásolata.
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { asztaliTarolo, type RegiAdat } from '../src/lib/asztali'
import { jelenlegiAllapot, sorokOsszefesulese, visszatoltes, visszatolthetok } from '../src/lib/regiAdatok'
import { buildSeedData } from '../src/store/seed'

const require = createRequire(import.meta.url)
const { readLocalStorage, snappyDecompress } = require('../electron/leveldb.js') as {
  readLocalStorage: (dir: string) => Map<string, { adatok: Map<string, string>; modositva: Date | null }>
  snappyDecompress: (b: Buffer) => Buffer
}
const { regiAdatokKeresese } = require('../electron/regiAdatok.js') as { regiAdatokKeresese: (dir: string) => RegiAdat[] }

// Valódi Chromium által írt tároló: két „indítás” két különböző porton (tests/fixtures/chromium-localstorage-keszites.cjs).
const FIXTURE = path.join(__dirname, 'fixtures', 'chromium-localstorage')

class MemTarolo {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
}

describe('a Chromium-tároló olvasása (csak olvasás)', () => {
  it('a tömörített táblából és az írási naplóból is a legfrissebb értéket adja, a törölt kulcs nélkül', () => {
    const d = readLocalStorage(FIXTURE)
    const cimek = [...d.keys()].filter((c) => c.startsWith('http://127.0.0.1:'))
    expect(cimek).toHaveLength(2)
    const termekSzamok = cimek.map((c) => JSON.parse(d.get(c)!.adatok.get('keszletfigyelo-storage')!).state.products.length).sort((a, b) => a - b)
    expect(termekSzamok).toEqual([5, 3000])
    for (const c of cimek) {
      const t = d.get(c)!
      expect(t.adatok.has('torolt')).toBe(false)
      expect(JSON.parse(t.adatok.get('keszletfigyelo-storage')!).state.products[0].name).toBe('Termék 0 – ékezet ŐŰ')
      expect(t.modositva).toBeInstanceOf(Date)
    }
  })

  it('Snappy: literál és visszahivatkozás', () => {
    // "abcabcabc" = hossz 9, literál "abc", majd másolás 6 bájt az 3-mal korábbiról
    const tomoritett = Buffer.from([9, 0x08, 0x61, 0x62, 0x63, 0x09 | (0 << 5), 0x03])
    expect(snappyDecompress(tomoritett).toString()).toBe('abcabcabc')
  })

  it('a régi címek a legutóbbi elöl, összesítéssel és a nem mentett műveletek számával', () => {
    const r = regiAdatokKeresese(FIXTURE)
    expect(r.map((x) => x.osszesites?.termekek)).toEqual([5, 3000])
    expect(r.every((x) => x.fuggoMentesek === 1)).toBe(true)
  })

  it('nem létező mappa: üres lista, hiba nélkül', () => {
    expect(regiAdatokKeresese(path.join(FIXTURE, 'nincs-ilyen'))).toEqual([])
  })
})

const regi = (over: Partial<RegiAdat> = {}): RegiAdat => ({
  cim: 'http://127.0.0.1:50000',
  modositva: '2026-10-01T10:00:00.000Z',
  osszesites: null,
  fuggoMentesek: 0,
  adat: JSON.stringify({ state: { products: [{ id: 'p1', name: 'Saját termék' }], movements: [], suppliers: [] }, version: 1 }),
  sor: null,
  ...over,
})

describe('visszatöltés', () => {
  it('a csak bemutató adatot tartalmazó régi tárolót nem ajánlja; a valódi adatot és a nem mentett sort igen', () => {
    const demo = buildSeedData()
    const demoRegi = regi({ adat: JSON.stringify({ state: demo, version: 1 }) })
    expect(visszatolthetok([demoRegi, regi()]).map((x) => x.cim)).toHaveLength(1)
    expect(visszatolthetok([regi({ adat: null, sor: JSON.stringify({ tetelek: [{ id: 't1' }] }), fuggoMentesek: 1 })])).toHaveLength(1)
  })

  it('előbb biztonsági mentés (a mostani és a régi adattal), utána visszatöltés; a nem mentett sorok összefésülve', async () => {
    const t = new MemTarolo()
    t.setItem('keszletfigyelo-storage', JSON.stringify({ state: buildSeedData(), version: 1 }))
    t.setItem('keszletfigyelo-mentesi-sor', JSON.stringify({ tetelek: [{ id: 'uj' }] }))
    const mentesek: string[] = []
    const r = regi({ sor: JSON.stringify({ tetelek: [{ id: 'regi' }, { id: 'uj' }] }), fuggoMentesek: 2 })
    const { mentesHelye } = await visszatoltes(r, t, async (_nev, tartalom) => {
      mentesek.push(tartalom)
      return 'C:/mentes.json'
    })
    expect(mentesHelye).toBe('C:/mentes.json')
    const mentes = JSON.parse(mentesek[0]!)
    expect(JSON.parse(mentes.mostani.adat).state.products.length).toBeGreaterThan(0)
    expect(mentes.visszatoltott.cim).toBe(r.cim)
    expect(JSON.parse(t.getItem('keszletfigyelo-storage')!).state.products[0].name).toBe('Saját termék')
    expect(JSON.parse(t.getItem('keszletfigyelo-mentesi-sor')!).tetelek.map((x: { id: string }) => x.id)).toEqual(['regi', 'uj'])
  })

  it('a mostani állapot: bemutató adat nem számít valódinak', () => {
    expect(jelenlegiAllapot(JSON.stringify({ state: buildSeedData(), version: 1 }), null).valodiAdat).toBe(false)
    expect(jelenlegiAllapot(regi().adat, JSON.stringify({ tetelek: [{ id: 'a' }] }))).toEqual({ valodiAdat: true, fuggoMentesek: 1 })
    expect(sorokOsszefesulese(null, '{"tetelek":[]}')).toBe('{"tetelek":[]}')
  })
})

describe('a mentési sor fájlmásolata', () => {
  it('írás a böngészőtárolóba és fájlba is; ha a böngészőtárolóból eltűnt, a fájlból tölti vissza', () => {
    const alap = new MemTarolo()
    let fajl: string | null = null
    const t = asztaliTarolo(alap, { mentesiSorFajlba: (s) => (fajl = s), mentesiSorFajlbol: () => fajl }, 'sor')
    t.setItem('sor', '{"tetelek":[1]}')
    t.setItem('mas', 'x')
    expect(fajl).toBe('{"tetelek":[1]}')
    alap.m.delete('sor')
    expect(t.getItem('sor')).toBe('{"tetelek":[1]}')
    expect(t.getItem('mas')).toBe('x')
    // Böngészőben (asztali felület nélkül) változatlan.
    expect(asztaliTarolo(alap, null, 'sor')).toBe(alap)
  })
})
