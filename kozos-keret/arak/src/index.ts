// Az árak és a csomagok EGYETLEN helye. A weboldal, a regisztráció, a portál és (a portál nyilvános
// /api/v1/arak végpontján át) a Készletkezelő is innen olvas; árváltozáskor csak ezt a fájlt kell
// módosítani. Minden ár nettó, forintban, havonta; az áfát külön tüntetjük fel.
//
// A csomagok ADATKÉNT szerepelnek (nem kedvezményszabályként): egy új csomag egy új sor a CSOMAGOK
// listában, fejlesztés nélkül. A megtakarítás mindig a külön megvásárolt modulok árához képest számít.

/**
 * A termék neve EGYETLEN helyen. Munkanév: a végleges név eldöntésekor csak ezt kell átírni – a weboldal, a portál
 * (fejléc, belépés, regisztráció, böngészőfül címe), a kétlépcsős azonosítás kiadóneve és a későbbi e-mailek is
 * innen olvasnak.
 */
export const TERMEK_NEV = 'eÁFA Csomag'

export type ModulKod = 'konyvelo' | 'afa' | 'keszlet'

export interface Modul {
  kod: ModulKod
  nev: string
  /** Egy mondat a csomagválasztóhoz. */
  rovidLeiras: string
}

/** A megjelenítés sorrendje is ez. */
export const MODULOK: readonly Modul[] = [
  {
    kod: 'konyvelo',
    nev: 'Könyvelő',
    rovidLeiras: 'Kettős könyvvitel bizonylatokkal, analitikával, kimutatásokkal és zárással.',
  },
  {
    kod: 'afa',
    nev: 'eÁFA',
    rovidLeiras: 'Áfabevallás a NAV adataiból: egyeztetés, javítás és beküldés egy helyen.',
  },
  {
    kod: 'keszlet',
    nev: 'Készletkezelő',
    rovidLeiras: 'Készletmozgás, beszerzés és eladás, telephelyek, riasztás, ha rendelni kell.',
  },
]

export type CsomagKod = 'konyvelo' | 'afa' | 'keszlet' | 'konyvelo-afa' | 'konyvelo-keszlet' | 'afa-keszlet' | 'teljes'

export interface Csomag {
  kod: CsomagKod
  nev: string
  /** A csomagban lévő modulok, a MODULOK sorrendjében. */
  modulok: readonly ModulKod[]
  /** Nettó havidíj, Ft. */
  havidijNetto: number
  /** A vizuálisan kiemelt csomag (a hárommodulos, komplett megoldás). */
  kiemelt?: boolean
  /** Rövid alcím az árazási oldalra. */
  alcim: string
}

/** Az összes választható csomag. Minden modulkombinációhoz pontosan egy tartozik. */
export const CSOMAGOK: readonly Csomag[] = [
  { kod: 'konyvelo', nev: 'Könyvelő', modulok: ['konyvelo'], havidijNetto: 12_990, alcim: 'Teljes kettős könyvvitel' },
  { kod: 'afa', nev: 'eÁFA', modulok: ['afa'], havidijNetto: 2_990, alcim: 'Áfabevallás a NAV adataiból' },
  { kod: 'keszlet', nev: 'Készletkezelő', modulok: ['keszlet'], havidijNetto: 7_990, alcim: 'Készlet, beszerzés, eladás' },
  { kod: 'konyvelo-afa', nev: 'Könyvelő + eÁFA', modulok: ['konyvelo', 'afa'], havidijNetto: 14_990, alcim: 'Könyvelés és áfabevallás együtt' },
  { kod: 'konyvelo-keszlet', nev: 'Könyvelő + Készletkezelő', modulok: ['konyvelo', 'keszlet'], havidijNetto: 17_990, alcim: 'Kereskedőknek, könyveléssel' },
  { kod: 'afa-keszlet', nev: 'eÁFA + Készletkezelő', modulok: ['afa', 'keszlet'], havidijNetto: 9_990, alcim: 'Készlet és áfabevallás' },
  {
    kod: 'teljes',
    nev: 'Teljes vállalkozásirányítás',
    modulok: ['konyvelo', 'afa', 'keszlet'],
    havidijNetto: 19_990,
    kiemelt: true,
    alcim: 'Könyvelő + eÁFA + Készletkezelő: komplett vállalkozásirányítási megoldás',
  },
]

/** Az áfa kulcsa, %. Az árak nettók, ezt csak a bruttó tájékoztató összeghez használjuk. */
export const AFA_KULCS = 27

/** Ingyenes próbaidő napokban, minden csomagra egységesen. */
export const PROBAIDO_NAP = 30

const MODUL_KODOK = new Set<string>(MODULOK.map((m) => m.kod))
const CSOMAG_KODOK = new Set<string>(CSOMAGOK.map((c) => c.kod))

export function isModulKod(kod: string): kod is ModulKod {
  return MODUL_KODOK.has(kod)
}

export function isCsomagKod(kod: string): kod is CsomagKod {
  return CSOMAG_KODOK.has(kod)
}

export function modul(kod: ModulKod): Modul {
  return MODULOK.find((m) => m.kod === kod)!
}

export function csomag(kod: CsomagKod): Csomag {
  return CSOMAGOK.find((c) => c.kod === kod)!
}

/** Ismétlés nélkül, a MODULOK sorrendjében. */
export function rendezettModulok(modulok: readonly string[]): ModulKod[] {
  const halmaz = new Set(modulok)
  return MODULOK.filter((m) => halmaz.has(m.kod)).map((m) => m.kod)
}

const kulcs = (modulok: readonly ModulKod[]) => rendezettModulok(modulok).join(',')

/** A modulkombinációhoz tartozó csomag (üres kiválasztásra null). */
export function csomagModulokbol(modulok: readonly string[]): Csomag | null {
  const k = kulcs(rendezettModulok(modulok))
  if (!k) return null
  return CSOMAGOK.find((c) => kulcs(c.modulok) === k) ?? null
}

/** Egy modul önálló (egymodulos csomag szerinti) havidíja – a „külön megvéve” összeghez. */
export function modulAr(kod: ModulKod): number {
  return csomagModulokbol([kod])!.havidijNetto
}

export function bruttoAr(netto: number): number {
  return Math.round((netto * (100 + AFA_KULCS)) / 100)
}

export interface Arajanlat {
  csomag: Csomag
  /** Fizetendő nettó havidíj. */
  netto: number
  /** Tájékoztató bruttó összeg (nettó + áfa, egész forintra kerekítve). */
  brutto: number
  /** A modulok külön megvásárolt árának összege. */
  kulonOsszeg: number
  /** Megtakarítás a külön vásárláshoz képest, Ft (egymodulos csomagnál 0). */
  megtakaritas: number
  /** Megtakarítás százalékban, egészre kerekítve. */
  megtakaritasSzazalek: number
}

export function arajanlat(cs: Csomag): Arajanlat {
  const kulonOsszeg = cs.modulok.reduce((s, m) => s + modulAr(m), 0)
  const megtakaritas = Math.max(0, kulonOsszeg - cs.havidijNetto)
  return {
    csomag: cs,
    netto: cs.havidijNetto,
    brutto: bruttoAr(cs.havidijNetto),
    kulonOsszeg,
    megtakaritas,
    megtakaritasSzazalek: kulonOsszeg > 0 ? Math.round((megtakaritas / kulonOsszeg) * 100) : 0,
  }
}

/** Ajánlat a kiválasztott modulokra (üres kiválasztásra null). */
export function arajanlatModulokra(modulok: readonly string[]): Arajanlat | null {
  const cs = csomagModulokbol(modulok)
  return cs ? arajanlat(cs) : null
}

/** A teljes árlista géppel olvasható alakban (a portál /api/v1/arak végpontja ezt adja). */
export function arlista() {
  return {
    penznem: 'HUF',
    afaKulcs: AFA_KULCS,
    probaidoNap: PROBAIDO_NAP,
    modulok: MODULOK.map((m) => ({ kod: m.kod, nev: m.nev })),
    csomagok: CSOMAGOK.map((c) => {
      const a = arajanlat(c)
      return {
        kod: c.kod,
        nev: c.nev,
        modulok: [...c.modulok],
        havidijNetto: a.netto,
        havidijBrutto: a.brutto,
        kulonOsszeg: a.kulonOsszeg,
        megtakaritas: a.megtakaritas,
        megtakaritasSzazalek: a.megtakaritasSzazalek,
        kiemelt: Boolean(c.kiemelt),
      }
    }),
  }
}

/** „19 990 Ft” alakban, szóközzel tagolva. */
export function forint(osszeg: number): string {
  const egesz = Math.round(osszeg)
  const jel = egesz < 0 ? '-' : ''
  const tagolt = String(Math.abs(egesz)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${jel}${tagolt} Ft`
}

/** A `?modulok=afa,keszlet` paraméter értelmezése; az ismeretlen kódokat kihagyja. */
export function modulokParameterbol(ertek: string | null | undefined): ModulKod[] {
  if (!ertek) return []
  return rendezettModulok(ertek.split(',').map((k) => k.trim()).filter(isModulKod))
}

export function modulokParameterbe(modulok: readonly ModulKod[]): string {
  return rendezettModulok(modulok).join(',')
}

// --- Irodai előfizetés (TERV.md F26a) -------------------------------------------------------------------
// Könyvelőirodánál minden ügyfél külön cég. Ügyfelenként eldönthető (és később adatvesztés nélkül átállítható),
// hogy az iroda fizet-e érte, vagy az ügyfél maga. Ha az iroda fizet, az ügyfél csomagjának díja a kedvezmény
// szerint: a küszöb FELETT az iroda által fizetett ÖSSZES ügyfél díja a csomagár meghatározott része. A pontos
// értékek üzleti döntés: itt egy helyen állíthatók (kiindulás: 10 ügyfél felett a csomagár 70%-a).
export const IRODAI_KEDVEZMENY = {
  /** Ennél több irodai fizetésű ügyfélnél jár a kedvezmény. */
  kuszobUgyfelszam: 10,
  /** A csomagár ennyi része (0–1) a küszöb felett. */
  arany: 0.7,
} as const

export interface IrodaiKedvezmeny {
  kuszobUgyfelszam: number
  arany: number
}

/** Egy irodai fizetésű ügyfél havidíja (nettó, egész forintra kerekítve). */
export function irodaiUgyfelDij(cs: Csomag, irodaiUgyfelSzam: number, k: IrodaiKedvezmeny = IRODAI_KEDVEZMENY): number {
  return irodaiUgyfelSzam > k.kuszobUgyfelszam ? Math.round(cs.havidijNetto * k.arany) : cs.havidijNetto
}

/** Az iroda havi elszámolása: a fizetett ügyfelek díja és összege. */
export function irodaiElszamolas(ugyfelek: ReadonlyArray<{ id: string; csomag: Csomag }>, k: IrodaiKedvezmeny = IRODAI_KEDVEZMENY) {
  const tetelek = ugyfelek.map((u) => ({ id: u.id, csomag: u.csomag.kod, listaar: u.csomag.havidijNetto, dij: irodaiUgyfelDij(u.csomag, ugyfelek.length, k) }))
  return { tetelek, osszesen: tetelek.reduce((s, t) => s + t.dij, 0), kedvezmenyes: ugyfelek.length > k.kuszobUgyfelszam }
}
