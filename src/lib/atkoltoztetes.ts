// A böngészőben tárolt (helyi módú) adatok veszteség nélküli átköltöztetése a szerverre.
//
// Elvek:
// - Semmit nem törlünk: a böngésző pillanatképe érintetlen marad, az átköltöztetés előtt pedig egy
//   biztonsági másolat is készül (és letölthető fájlként is).
// - Semmit nem találgatunk: a felhasználó előnézetet lát (mi, mennyi kerül át), maga dönt, és ha a
//   böngészőben valószínűleg csak a bemutató (demó) adat van, erre külön figyelmeztetünk.
// - Ugyanaz a rekord kétszer nem kerül fel: azonosító alapján csak a szerveren még nem létezőket
//   töltjük fel; a feltöltés megszakadás után is biztonságosan folytatható (a mentési sor kötegei
//   egyszer hatnak).
// - Ha a cégnél a szerveren már van készletadat (termék, mozgás), a böngésző készletadatát NEM
//   keverjük hozzá automatikusan, csak a korábban kizárólag böngészőben tárolt irodai adatokat
//   (beszállítók, vevők, pénzügyi napló, beállítások).
import { buildSeedData } from '../store/seed'
import { DEFAULT_LEDGER_CATEGORIES, DEFAULT_SETTINGS, type Settings } from '../types'
import type { BusinessSlices } from './remoteSync'

export const HELYI_KULCS = 'keszletfigyelo-storage'
export const BIZTONSAGI_KULCS = 'keszletfigyelo-storage-biztonsagi-masolat'
export const jeloloKulcs = (companyId: string) => `keszletfigyelo-atkoltoztetes:${companyId}`

export type Csoport =
  | 'locations'
  | 'suppliers'
  | 'customers'
  | 'products'
  | 'movements'
  | 'lots'
  | 'dailyClosings'
  | 'ledgerEntries'
  | 'recurringLedgerEntries'
  | 'auditLog'

export const CSOPORT_NEV: Record<Csoport, string> = {
  locations: 'Telephelyek',
  suppliers: 'Beszállítók',
  customers: 'Vevők',
  products: 'Termékek',
  movements: 'Készletmozgások',
  lots: 'Beszerzési tételek',
  dailyClosings: 'Napi zárások',
  ledgerEntries: 'Pénzügyi napló tételei',
  recurringLedgerEntries: 'Ismétlődő napló-tételek',
  auditLog: 'Napló (ki, mikor, mit módosított)',
}

/** A feltöltés sorrendje: előbb a hivatkozott adat (telephely a termék előtt, termék a mozgás előtt). */
export const CSOPORT_SORREND: Csoport[] = [
  'locations',
  'suppliers',
  'customers',
  'products',
  'movements',
  'lots',
  'dailyClosings',
  'recurringLedgerEntries',
  'ledgerEntries',
  'auditLog',
]

const KESZLET_CSOPORTOK: Csoport[] = ['locations', 'products', 'movements', 'lots', 'dailyClosings', 'auditLog']

export type HelyiAdatok = Omit<BusinessSlices, 'pendingChanges'>

/** A böngésző helyi pillanatképe (a Zustand persist formátumából); null, ha nincs vagy olvashatatlan. */
export function helyiPillanatkep(nyers: string | null): HelyiAdatok | null {
  if (!nyers) return null
  try {
    const s = (JSON.parse(nyers) as { state?: Partial<HelyiAdatok> }).state
    if (!s) return null
    return {
      locations: s.locations ?? [],
      suppliers: s.suppliers ?? [],
      customers: s.customers ?? [],
      products: s.products ?? [],
      movements: s.movements ?? [],
      lots: s.lots ?? [],
      dailyClosings: s.dailyClosings ?? [],
      auditLog: s.auditLog ?? [],
      ledgerEntries: s.ledgerEntries ?? [],
      recurringLedgerEntries: s.recurringLedgerEntries ?? [],
      settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) } as Settings,
      ledgerCategories: s.ledgerCategories ?? [...DEFAULT_LEDGER_CATEGORIES],
    }
  } catch {
    return null
  }
}

/** Igaz, ha a böngésző termékei és beszállítói pontosan a beépített bemutató adatok (névre). */
export function demoAdatnakTunik(helyi: HelyiAdatok): boolean {
  if (helyi.products.length === 0) return false
  const demo = buildSeedData()
  const nevek = (lista: { name: string }[]) => [...new Set(lista.map((x) => x.name))].sort().join('|')
  return nevek(helyi.products) === nevek(demo.products) && nevek(helyi.suppliers) === nevek(demo.suppliers)
}

export interface AtkoltoztetesiTerv {
  /** 'teljes': a szerveren nincs más (nem ebből a böngészőből származó) készletadat, minden átkerülhet.
   *  'kiegeszito': a szerveren már van más készletadat; csak a korábban böngészős irodai adat kerül át. */
  mod: 'teljes' | 'kiegeszito'
  /** Csoportonként a feltölthető (a szerveren még nem létező) rekordok. */
  feltoltheto: Partial<Record<Csoport, { id: string }[]>>
  /** A böngészőben lévő, de ebben a módban szándékosan NEM feltöltött készletadat (darab). */
  kihagyott: Partial<Record<Csoport, number>>
  beallitasok: { settings: Settings; ledgerCategories: string[] } | null
  demo: boolean
  osszesen: number
}

export function atkoltoztetesiTerv(helyi: HelyiAdatok, szerver: BusinessSlices, szerverenVanBeallitas: boolean): AtkoltoztetesiTerv {
  // „Idegen” készletadat: a szerveren van, de nem ebből a böngészőből került oda. Ha minden szerveres
  // készletrekord ebből a böngészőből való, az egy korábban megszakadt átköltöztetés folytatása.
  const keszlet: Csoport[] = ['products', 'movements', 'lots', 'dailyClosings']
  const vanIdegenKeszletAdat = keszlet.some((c) => {
    const helyiIdk = new Set((helyi[c] as { id: string }[]).map((x) => x.id))
    return (szerver[c] as { id: string }[]).some((x) => !helyiIdk.has(x.id))
  })
  const mod = vanIdegenKeszletAdat ? 'kiegeszito' : 'teljes'
  const feltoltheto: AtkoltoztetesiTerv['feltoltheto'] = {}
  const kihagyott: AtkoltoztetesiTerv['kihagyott'] = {}

  for (const csoport of CSOPORT_SORREND) {
    const meglevo = new Set((szerver[csoport] as { id: string }[]).map((x) => x.id))
    const uj = (helyi[csoport] as { id: string }[]).filter((x) => !meglevo.has(x.id))
    if (uj.length === 0) continue
    if (mod === 'kiegeszito' && KESZLET_CSOPORTOK.includes(csoport)) kihagyott[csoport] = uj.length
    else feltoltheto[csoport] = uj
  }

  const ujKategoriak = helyi.ledgerCategories.filter((k) => !szerver.ledgerCategories.includes(k))
  const beallitasok =
    !szerverenVanBeallitas || ujKategoriak.length > 0
      ? {
          // A szerveren már beállított értékeket nem írjuk felül; a kategóriákat összefésüljük.
          settings: szerverenVanBeallitas ? szerver.settings : helyi.settings,
          ledgerCategories: [...szerver.ledgerCategories, ...ujKategoriak],
        }
      : null

  const osszesen = Object.values(feltoltheto).reduce((s, l) => s + (l?.length ?? 0), 0)
  return { mod, feltoltheto, kihagyott, beallitasok, demo: demoAdatnakTunik(helyi), osszesen }
}

/** Kötegekre bontás: egy köteg legfeljebb ennyi rekord (a szerver kéréseinek mérete miatt). */
export const KOTEG_MERET = 300

/** A feltöltendő rekordok kötegei, a hivatkozási sorrendet megtartva. */
export function feltoltesiKotegek(helyi: HelyiAdatok, terv: AtkoltoztetesiTerv, kivalasztott: Set<Csoport>): Partial<HelyiAdatok>[] {
  const kotegek: Partial<HelyiAdatok>[] = []
  let aktualis: Partial<HelyiAdatok> = {}
  let meret = 0
  for (const csoport of CSOPORT_SORREND) {
    if (!kivalasztott.has(csoport)) continue
    const idk = new Set((terv.feltoltheto[csoport] ?? []).map((x) => x.id))
    const rekordok = (helyi[csoport] as { id: string }[]).filter((x) => idk.has(x.id))
    for (const rekord of rekordok) {
      if (meret >= KOTEG_MERET) {
        kotegek.push(aktualis)
        aktualis = {}
        meret = 0
      }
      ;((aktualis[csoport] ??= [] as never) as { id: string }[]).push(rekord)
      meret += 1
    }
  }
  if (meret > 0) kotegek.push(aktualis)
  return kotegek
}

/** Ellenőrzés a feltöltés után: minden feltöltött rekord megvan-e a szerverről újratöltött adatban. */
export function hianyzoRekordok(terv: AtkoltoztetesiTerv, kivalasztott: Set<Csoport>, szerver: BusinessSlices): Partial<Record<Csoport, number>> {
  const hiany: Partial<Record<Csoport, number>> = {}
  for (const csoport of CSOPORT_SORREND) {
    if (!kivalasztott.has(csoport)) continue
    const meglevo = new Set((szerver[csoport] as { id: string }[]).map((x) => x.id))
    const n = (terv.feltoltheto[csoport] ?? []).filter((x) => !meglevo.has(x.id)).length
    if (n > 0) hiany[csoport] = n
  }
  return hiany
}
