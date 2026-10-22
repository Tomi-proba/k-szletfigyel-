import { describe, expect, it } from 'vitest'
import {
  MentesiSor,
  TAROLO_KULCS,
  allapotUzenet,
  hibaBesorolas,
  varakozas,
  type KuldesEredmeny,
  type MentesiTetel,
  type SorAllapot,
} from '../src/lib/mentesiSor'

function memoriaTarolo() {
  const adat = new Map<string, string>()
  return { getItem: (k: string) => adat.get(k) ?? null, setItem: (k: string, v: string) => void adat.set(k, v), adat }
}

/** Kézzel léptethető időzítő: a tesztek maguk „telik az idő” lépéseket adnak. */
function kezIdozito() {
  let most = 0
  const varo: { fn: () => void; ido: number; id: number }[] = []
  let kovId = 1
  return {
    setTimeout: (fn: () => void, ms: number) => {
      const id = kovId++
      varo.push({ fn, ido: most + ms, id })
      return id
    },
    clearTimeout: (id: unknown) => {
      const i = varo.findIndex((v) => v.id === id)
      if (i >= 0) varo.splice(i, 1)
    },
    now: () => most,
    async telik(ms: number) {
      most += ms
      for (const v of [...varo].filter((x) => x.ido <= most)) {
        varo.splice(varo.indexOf(v), 1)
        v.fn()
      }
      await kiurul()
    },
    vart: () => varo.length,
  }
}

const kiurul = () => new Promise((r) => setTimeout(r, 0))

function tetel(n: number, ceg = 'c1'): MentesiTetel {
  return { id: `koteg-${n}`, companyId: ceg, letrehozva: '2026-10-23T08:00:00Z', leirasok: [`Művelet ${n}`], valtozasok: [{ tabla: 'products', sor: { id: `p${n}` } }] }
}

/** Kuldő, amelynek a válaszait a teszt sorban adja meg; minden hívást rögzít. */
function forgatokonyv(...valaszok: KuldesEredmeny[]) {
  const hivasok: string[] = []
  const kuldo = async (t: MentesiTetel) => {
    hivasok.push(t.id)
    return valaszok.shift() ?? { ok: true as const, verziok: [] }
  }
  return { kuldo, hivasok }
}

const OK: KuldesEredmeny = { ok: true, verziok: [] }
const HALOZAT: KuldesEredmeny = { ok: false, fajta: 'halozat', technikai: 'Failed to fetch' }
const UTKOZES: KuldesEredmeny = { ok: false, fajta: 'utkozes', technikai: 'KF409: utkozes' }

describe('mentési sor', () => {
  it('a tételeket sorrendben, egyenként küldi, és a végén „minden mentve” lesz', async () => {
    const { kuldo, hivasok } = forgatokonyv()
    const sor = new MentesiSor(kuldo, memoriaTarolo(), kezIdozito())
    sor.betolt('c1')
    sor.hozzaad(tetel(1))
    sor.hozzaad(tetel(2))
    sor.hozzaad(tetel(3))
    await kiurul()
    expect(hivasok).toEqual(['koteg-1', 'koteg-2', 'koteg-3'])
    expect(sor.aktualisAllapot).toEqual({ fajta: 'mentve' })
  })

  it('hálózati hibánál nem veszít el semmit: vár, újrapróbál, és a tételek sorrendje megmarad', async () => {
    const ido = kezIdozito()
    const { kuldo, hivasok } = forgatokonyv(HALOZAT, HALOZAT, OK, OK)
    const sor = new MentesiSor(kuldo, memoriaTarolo(), ido)
    sor.betolt('c1')
    sor.hozzaad(tetel(1))
    sor.hozzaad(tetel(2))
    await kiurul()
    expect(sor.aktualisAllapot).toMatchObject({ fajta: 'ujraprobalas', ok: 'halozat', fuggo: 2, probalkozas: 1 })
    await ido.telik(1000)
    expect(sor.aktualisAllapot).toMatchObject({ fajta: 'ujraprobalas', probalkozas: 2 })
    await ido.telik(2000)
    expect(hivasok).toEqual(['koteg-1', 'koteg-1', 'koteg-1', 'koteg-2'])
    expect(sor.aktualisAllapot).toEqual({ fajta: 'mentve' })
  })

  it('a várakozás növekszik, legfeljebb 60 másodpercig', () => {
    expect([1, 2, 3, 4, 7, 20].map(varakozas)).toEqual([1000, 2000, 4000, 8000, 60000, 60000])
  })

  it('a nem mentett tételek a böngésző tárolójában is megvannak, és újraindítás után folytatódnak', async () => {
    const tarolo = memoriaTarolo()
    const elso = new MentesiSor(forgatokonyv(HALOZAT).kuldo, tarolo, kezIdozito())
    elso.betolt('c1')
    elso.hozzaad(tetel(1))
    elso.hozzaad(tetel(2))
    await kiurul()
    expect(JSON.parse(tarolo.adat.get(TAROLO_KULCS)!).c1).toHaveLength(2)

    // „Újraindítás”: új példány ugyanazzal a tárolóval
    const { kuldo, hivasok } = forgatokonyv()
    const masodik = new MentesiSor(kuldo, tarolo, kezIdozito())
    masodik.betolt('c1')
    expect(masodik.fuggoTetelek.map((t) => t.id)).toEqual(['koteg-1', 'koteg-2'])
    expect(await masodik.kiurulesig()).toEqual({ fajta: 'mentve' })
    expect(hivasok).toEqual(['koteg-1', 'koteg-2'])
    expect(JSON.parse(tarolo.adat.get(TAROLO_KULCS)!).c1).toBeUndefined()
  })

  it('ütközésnél megáll, megnevezi a nem mentett műveleteket, és nem küld tovább', async () => {
    const { kuldo, hivasok } = forgatokonyv(OK, UTKOZES)
    const sor = new MentesiSor(kuldo, memoriaTarolo(), kezIdozito())
    sor.betolt('c1')
    sor.hozzaad(tetel(1))
    sor.hozzaad(tetel(2))
    sor.hozzaad(tetel(3))
    await kiurul()
    expect(hivasok).toEqual(['koteg-1', 'koteg-2'])
    const a = sor.aktualisAllapot as Extract<SorAllapot, { fajta: 'elakadt' }>
    expect(a).toMatchObject({ fajta: 'elakadt', ok: 'utkozes', elveszett: ['Művelet 2', 'Művelet 3'] })
    expect(allapotUzenet(a)).toContain('„Művelet 2”, „Művelet 3”')
    expect(allapotUzenet(a)).toContain('másik eszközön')

    // új művelet elakadás alatt sem megy ki, amíg a felhasználó nem frissít
    sor.hozzaad(tetel(4))
    await kiurul()
    expect(hivasok).toHaveLength(2)
    expect(sor.elakadasLezarasa()).toEqual(['Művelet 2', 'Művelet 3', 'Művelet 4'])
    expect(sor.aktualisAllapot).toEqual({ fajta: 'mentve' })
  })

  it('másik cég tételét nem fogadja el, és cégenként külön tárol', async () => {
    const tarolo = memoriaTarolo()
    const sor = new MentesiSor(forgatokonyv(HALOZAT, HALOZAT).kuldo, tarolo, kezIdozito())
    sor.betolt('c1')
    expect(() => sor.hozzaad(tetel(1, 'c2'))).toThrow()
    sor.hozzaad(tetel(1))
    await kiurul()
    sor.betolt('c2')
    expect(sor.fuggoTetelek).toEqual([])
    sor.betolt('c1')
    expect(sor.fuggoTetelek).toHaveLength(1)
  })

  it('kiurulesig: offline állapotban nem vár a végtelenségig, hanem jelzi az újrapróbálást', async () => {
    const sor = new MentesiSor(forgatokonyv(HALOZAT).kuldo, memoriaTarolo(), kezIdozito())
    sor.betolt('c1')
    sor.hozzaad(tetel(1))
    expect((await sor.kiurulesig()).fajta).toBe('ujraprobalas')
  })
})

describe('hibák besorolása és üzenetek', () => {
  it('a Supabase-hibákat a megfelelő csoportba sorolja', () => {
    expect(hibaBesorolas({ code: 'KF409', message: 'utkozes', status: 400 })).toBe('utkozes')
    expect(hibaBesorolas({ code: '42501', message: 'new row violates row-level security policy', status: 403 })).toBe('jogosultsag')
    expect(hibaBesorolas({ code: '', message: 'TypeError: Failed to fetch', status: 0 })).toBe('halozat')
    expect(hibaBesorolas({ code: 'PGRST301', message: 'JWT expired', status: 401 })).toBe('szerver')
    expect(hibaBesorolas({ code: '', message: 'Service Unavailable', status: 503 })).toBe('szerver')
    expect(hibaBesorolas({ code: '23503', message: 'foreign key', status: 409 })).toBe('ervenytelen')
  })

  it('érthető magyar üzenetet ad minden állapotra', () => {
    expect(allapotUzenet({ fajta: 'mentve' })).toBe('Minden változás elmentve.')
    expect(allapotUzenet({ fajta: 'ujraprobalas', fuggo: 3, ok: 'halozat', probalkozas: 1, kovetkezo: 0 })).toContain('3 nem mentett változásod biztonságban van')
    expect(allapotUzenet({ fajta: 'elakadt', ok: 'jogosultsag', elveszett: ['Termék létrehozva'], technikai: '42501' })).toContain('nincs jogosultságod')
    expect(allapotUzenet({ fajta: 'elakadt', ok: 'ervenytelen', elveszett: [], technikai: '23503: fk' })).toContain('23503: fk')
  })
})
