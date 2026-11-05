// A Készlet menüje a közös keretben (AWEBOLDAL TERV.md F24 KS7): a keret második menüsorának pontjai
// szerepkörönként, számlálókkal, és a csoportok alpontjai az oldalon belüli fülsorhoz. Az útvonalak a Készlet
// saját útvonalai; a keretbeli előtagot (ut) a hívó teszi rá.
import type { UserRole } from '../types/auth'

export interface MenuPont {
  cim: string
  utvonal: string
  szamlalo?: number
  pontos?: boolean
  alutvonalak?: string[]
}

export interface Szamlalok {
  /** Ami a felhasználóra vár a jóváhagyásban (bejelentések, visszaigazolások, Könyvelőből jött tételek). */
  jovahagyasraVar: number
  /** A fő irodára váró törzsadat-módosítási kérések. */
  modositasiKerelmek: number
  /** Megtekintésre/jóváhagyásra váró napi zárások. */
  napiZarasok: number
  /** Riasztások összesen. */
  riasztasok: number
}

/** Az oldalon belüli fülsor: csoportonként az alpontok (csak ahol egynél több van). */
export const CSOPORTOK: Record<string, { cim: string; pontok: Array<{ cim: string; utvonal: string; csakIroda?: boolean; csakFoIroda?: boolean }> }> = {
  jovahagyas: {
    cim: 'Jóváhagyás',
    pontok: [
      { cim: 'Jóváhagyásra vár', utvonal: '/jovahagyasra-var' },
      { cim: 'Törzsadat-kérések', utvonal: '/jovahagyasok', csakFoIroda: true },
      { cim: 'Beérkezett napi jelentések', utvonal: '/napi-jelentesek', csakIroda: true },
    ],
  },
  keszlet: {
    cim: 'Készlet',
    pontok: [
      { cim: 'Termékek', utvonal: '/keszlet' },
      { cim: 'Mozgásnapló', utvonal: '/mozgasnaplo' },
      { cim: 'Napi zárás', utvonal: '/napi-zaras' },
    ],
  },
  partnerek: {
    cim: 'Partnerek',
    pontok: [
      { cim: 'Vevők', utvonal: '/vevok' },
      { cim: 'Beszállítók', utvonal: '/beszallitok' },
    ],
  },
  penzugy: {
    cim: 'Pénzügy',
    pontok: [
      { cim: 'Pénzügyi napló', utvonal: '/penzugyi-naplo' },
      { cim: 'Áfa', utvonal: '/afa' },
      { cim: 'Riportok', utvonal: '/riportok' },
    ],
  },
  beallitasok: {
    cim: 'Beállítások',
    pontok: [
      { cim: 'Beállítások', utvonal: '/beallitasok' },
      { cim: 'Telephelyek', utvonal: '/telephelyek' },
      { cim: 'Csapat', utvonal: '/csapat', csakIroda: true },
      { cim: 'Audit napló', utvonal: '/audit-naplo' },
    ],
  },
}

const irodai = (szerep: UserRole | null) => szerep === 'fo_iroda' || szerep === 'iroda' || szerep === 'tulajdonos'

/** A csoport alpontjai a szerepkörnek megfelelően. */
export function csoportPontjai(kulcs: string, szerep: UserRole | null) {
  return (CSOPORTOK[kulcs]?.pontok ?? []).filter(
    (p) => (!p.csakFoIroda || szerep === 'fo_iroda') && (!p.csakIroda || szerep === 'fo_iroda' || szerep === 'iroda'),
  )
}

/** A keret második menüsora: iroda 7 pont (alpontokkal), raktáros 6 egyszerű pont. */
export function keszletMenu(szerep: UserRole | null, sz: Szamlalok): MenuPont[] {
  if (!irodai(szerep)) {
    return [
      { cim: 'Kezdőlap', utvonal: '/', pontos: true },
      { cim: 'Jóváhagyásra vár', utvonal: '/jovahagyasra-var', szamlalo: sz.jovahagyasraVar },
      { cim: 'Riasztások', utvonal: '/riasztasok', szamlalo: sz.riasztasok },
      { cim: 'Termékek', utvonal: '/keszlet' },
      { cim: 'Mozgásnapló', utvonal: '/mozgasnaplo' },
      { cim: 'Napi zárás', utvonal: '/napi-zaras' },
    ]
  }
  const csoport = (kulcs: string, szamlalo?: number): MenuPont => {
    const pontok = csoportPontjai(kulcs, szerep)
    return { cim: CSOPORTOK[kulcs]!.cim, utvonal: pontok[0]!.utvonal, alutvonalak: pontok.slice(1).map((p) => p.utvonal), szamlalo }
  }
  return [
    { cim: 'Áttekintés', utvonal: '/', pontos: true },
    csoport('jovahagyas', sz.jovahagyasraVar + (szerep === 'fo_iroda' ? sz.modositasiKerelmek : 0) + sz.napiZarasok),
    csoport('keszlet'),
    csoport('partnerek'),
    csoport('penzugy'),
    { cim: 'Riasztások', utvonal: '/riasztasok', szamlalo: sz.riasztasok },
    csoport('beallitasok'),
  ]
}

/** Melyik csoport fülsorát kell mutatni ezen az útvonalon (a Készlet saját útvonala). */
export function aktivCsoport(utvonal: string, szerep: UserRole | null): string | null {
  if (!irodai(szerep)) return null
  for (const kulcs of Object.keys(CSOPORTOK)) {
    const pontok = csoportPontjai(kulcs, szerep)
    if (pontok.length > 1 && pontok.some((p) => utvonal === p.utvonal)) return kulcs
  }
  return null
}
