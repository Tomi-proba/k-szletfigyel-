// A modulok és a jogosultság EGYETLEN leírása (TERV.md F20, P4).
//
// Egy közös keret van, nem hét alkalmazás: belépéskor a keret a cég előfizetéséből (a portál /me
// válaszából) számolja ki, mely menüpontok és funkciók látszanak. Ami itt van, az beállítás: új modul,
// új menüpont vagy új csomag (a @aweboldal/arak CSOMAGOK listájában) fejlesztés nélkül jelenik meg.
import { MODULOK, csomag, csomagModulokbol, modul, rendezettModulok, type CsomagKod, type ModulKod } from '@aweboldal/arak'

export type { ModulKod } from '@aweboldal/arak'

/** A modul állapota egy cégnél: aktív, vagy (lemondás vagy lejárt próbaidő után) csak olvasható. */
export type ModulAllapot = 'aktiv' | 'csak_olvashato'

export interface CegModul {
  kod: ModulKod
  allapot: ModulAllapot
}

export interface MenuPont {
  cim: string
  /** A keret útvonala (a modul felülete a beköltözésig a modul saját címén nyílik, ugyanabban a fülben). */
  utvonal: string
}

export interface ModulLeiras {
  kod: ModulKod
  nev: string
  /** A keret útvonal-előtagja. */
  elotag: string
  /** A modul neve az eseménycsatornán (@aweboldal/esemenyek MODULES). */
  esemenyNev: 'konyvelo' | 'eafa' | 'keszlet'
  /**
   * A modul menüpontjai: a keret főmenüjében a modul egy pont (az első menüpontra visz), a pontjai a modulon
   * belül, a második menüsorban jelennek meg (F23). Az előtaggal egyező pont a modul áttekintése.
   */
  menu: readonly MenuPont[]
}

export const MODUL_LEIRASOK: Record<ModulKod, ModulLeiras> = {
  konyvelo: {
    kod: 'konyvelo',
    nev: modul('konyvelo').nev,
    elotag: '/konyvelo',
    esemenyNev: 'konyvelo',
    // A Könyvelő 6 menüpontja (a Könyvelő saját főmenüje; a Kezdőlapja a keretben „Áttekintés”).
    menu: [
      { cim: 'Áttekintés', utvonal: '/konyvelo' },
      { cim: 'Könyvelés', utvonal: '/konyvelo/konyveles' },
      { cim: 'Partnerek', utvonal: '/konyvelo/partnerek' },
      { cim: 'Kimutatások', utvonal: '/konyvelo/kimutatasok' },
      { cim: 'Zárás', utvonal: '/konyvelo/zaras' },
      { cim: 'Beállítások', utvonal: '/konyvelo/beallitasok' },
    ],
  },
  afa: {
    kod: 'afa',
    nev: modul('afa').nev,
    elotag: '/afa',
    esemenyNev: 'eafa',
    menu: [
      { cim: 'Bevallások', utvonal: '/afa/bevallasok' },
      { cim: 'NAV-kapcsolat', utvonal: '/afa/nav' },
    ],
  },
  keszlet: {
    kod: 'keszlet',
    nev: modul('keszlet').nev,
    elotag: '/keszlet',
    esemenyNev: 'keszlet',
    menu: [
      { cim: 'Termékek', utvonal: '/keszlet/termekek' },
      { cim: 'Mozgásnapló', utvonal: '/keszlet/mozgasnaplo' },
      { cim: 'Jóváhagyásra vár', utvonal: '/keszlet/jovahagyasra-var' },
    ],
  },
}

export interface MenuCsoport {
  modul: ModulKod
  nev: string
  csakOlvashato: boolean
  pontok: readonly MenuPont[]
}

/** A keret menüje: csak a cég moduljai (aktív és csak olvasható), a MODULOK sorrendjében. */
export function menu(modulok: readonly CegModul[]): MenuCsoport[] {
  const allapot = new Map(modulok.map((m) => [m.kod, m.allapot]))
  return MODULOK.filter((m) => allapot.has(m.kod)).map((m) => ({
    modul: m.kod,
    nev: MODUL_LEIRASOK[m.kod].nev,
    csakOlvashato: allapot.get(m.kod) === 'csak_olvashato',
    pontok: MODUL_LEIRASOK[m.kod].menu,
  }))
}

/** Melyik modulhoz tartozik egy keretbeli útvonal (null: közös oldal, pl. Kezdőlap). */
export function utvonalModulja(utvonal: string): ModulKod | null {
  for (const l of Object.values(MODUL_LEIRASOK)) if (utvonal === l.elotag || utvonal.startsWith(`${l.elotag}/`)) return l.kod
  return null
}

export type Cel =
  | { fajta: 'modul'; modul: ModulKod; utvonal: string; csakOlvashato: boolean }
  | { fajta: 'kozos'; utvonal: string }
  /** A cél egy nem előfizetett modulhoz tartozik: nem hiba, hanem a csomagbővítés oldala. */
  | { fajta: 'bovites'; modul: ModulKod; utvonal: string }

/** Egy (pl. Teendőből jövő) hivatkozás célja a cég előfizetése szerint. Soha nem vezet hibához. */
export function cel(utvonal: string, modulok: readonly CegModul[]): Cel {
  const m = utvonalModulja(utvonal)
  if (!m) return { fajta: 'kozos', utvonal }
  const sajat = modulok.find((x) => x.kod === m)
  if (!sajat) return { fajta: 'bovites', modul: m, utvonal: `/bovites/${m}` }
  return { fajta: 'modul', modul: m, utvonal, csakOlvashato: sajat.allapot === 'csak_olvashato' }
}

/** Az eseménycsatorna hivatkozása ({ module, path }) keretbeli útvonallá. */
export function esemenyHivatkozas(link: { module: string; path: string }): string {
  const l = Object.values(MODUL_LEIRASOK).find((x) => x.esemenyNev === link.module)
  if (!l) return '/'
  const path = link.path.replace(/^#/, '')
  return `${l.elotag}${path.startsWith('/') ? path : `/${path}`}`
}

/** Az összekapcsolható modulpárok (F7): több modulnál ezek automatikusan összekapcsolódnak. */
export const KAPCSOLODO_PAROK: ReadonlyArray<readonly [ModulKod, ModulKod]> = [
  ['konyvelo', 'keszlet'],
  ['konyvelo', 'afa'],
  ['afa', 'keszlet'],
]

/** A cég moduljai közti kapcsolatok (csak az aktív modulok között). */
export function kapcsolatok(aktivModulok: readonly ModulKod[]): Array<readonly [ModulKod, ModulKod]> {
  const h = new Set(aktivModulok)
  return KAPCSOLODO_PAROK.filter(([a, b]) => h.has(a) && h.has(b))
}

export interface CsomagValtas {
  regi: CsomagKod | null
  uj: CsomagKod
  hozzaadott: ModulKod[]
  /** Lemondott modulok: csak olvashatók és exportálhatók maradnak, semmi nem törlődik. */
  elvett: ModulKod[]
  megmarad: ModulKod[]
  /** Az új csomagban újonnan létrejövő modulkapcsolatok. */
  ujKapcsolatok: Array<readonly [ModulKod, ModulKod]>
  /** A megszűnő (lemondott modult érintő) kapcsolatok. */
  megszunoKapcsolatok: Array<readonly [ModulKod, ModulKod]>
}

/** Csomagváltás előnézete: mi jön, mi megy, mi marad. Az adatok minden esetben megmaradnak. */
export function csomagValtas(regi: CsomagKod | null, uj: CsomagKod): CsomagValtas {
  const r = regi ? [...csomag(regi).modulok] : []
  const u = [...csomag(uj).modulok]
  const regiK = kapcsolatok(r).map((k) => k.join('+'))
  const ujK = kapcsolatok(u)
  return {
    regi,
    uj,
    hozzaadott: rendezettModulok(u.filter((m) => !r.includes(m))),
    elvett: rendezettModulok(r.filter((m) => !u.includes(m))),
    megmarad: rendezettModulok(r.filter((m) => u.includes(m))),
    ujKapcsolatok: ujK.filter((k) => !regiK.includes(k.join('+'))),
    megszunoKapcsolatok: kapcsolatok(r).filter((k) => !ujK.some((x) => x.join('+') === k.join('+'))),
  }
}

/** A csomag a modulokból (kényelmi továbbítás a portálnak). */
export function csomagKod(modulok: readonly ModulKod[]): CsomagKod | null {
  return csomagModulokbol(modulok)?.kod ?? null
}

export * from './idoszak.ts'
export * from './gyorsbillentyuk.ts'
