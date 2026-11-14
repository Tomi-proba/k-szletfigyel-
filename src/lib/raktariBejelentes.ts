// Raktári bejelentés → fő irodai elfogadás (2026-11-02, DOCUMENTATION.md 31. fejezet).
//
// Amit a raktáros rögzít, az bejelentés: a készletet, a pénzügyet és a Könyvelőnek küldött adatot csak a
// fő iroda elfogadása változtatja meg. Az irodától vagy a Könyvelőből érkező tételnél (rendelés, kiadás,
// visszáru) a raktáros csak visszaigazolja, mi történt ténylegesen; érvényessé ez is csak a fő iroda
// elfogadásával válik. Elfogadáskor nem jön létre új tétel, a bejelentés maga lesz érvényes, így egy
// esemény mindig csak egyszer van rögzítve.
//
// Ebben a fájlban csak tiszta függvények vannak (a felület és a tesztek is ezeket használják).
import type { Movement, Product } from '../types'

/** Jóváhagyásra vár-e még a tétel (nincs törölve, nincs elfogadva, nincs elutasítva). */
export function varakozo(m: Movement): boolean {
  return m.approvalStatus === 'pending' && !m.deletedAt
}

/** A raktár által jelzett (vagy, ha még nem jelzett, a várt) mennyiség. */
export function bejelentettMennyiseg(m: Movement): number {
  return m.raktarMennyiseg ?? m.quantity
}

/** Ennyit foglalnak le a termékből a még el nem fogadott kiadások. */
export function lefoglalt(movements: readonly Movement[], productId: string, kiveve?: string): number {
  let osszeg = 0
  for (const m of movements) {
    if (m.productId !== productId || m.type !== 'out' || m.id === kiveve || !varakozo(m)) continue
    osszeg += bejelentettMennyiseg(m)
  }
  return osszeg
}

/** Szabad készlet: az elfogadott készletből levonva a még el nem fogadott kiadásokat. */
export function szabadKeszlet(product: Pick<Product, 'id' | 'currentStock'>, movements: readonly Movement[], kiveve?: string): number {
  return Math.round((product.currentStock - lefoglalt(movements, product.id, kiveve)) * 1e6) / 1e6
}

export interface Szerep {
  raktaros: boolean
  foIroda: boolean
  csakOlvas: boolean
  /** Helyi (nem szerveres) mód: egyetlen felhasználó, mindent ő végez. */
  helyi: boolean
}

/** Mi a teendője a felhasználónak ezzel a tétellel: a raktáros visszaigazolja, mi történt; a fő iroda
 * véglegesíti (elfogadja vagy elutasítja), de csak miután a raktáros válaszolt (megjött, kevesebb, nem jött meg) –
 * addig csak látja. Az iroda és a tulajdonos csak látja. Helyi (egyfelhasználós) módban mindent ő végez. */
export type Teendo = 'visszaigazol' | 'veglegesit' | null

export function teendoje(m: Movement, szerep: Szerep): Teendo {
  if (szerep.csakOlvas || !varakozo(m)) return null
  if (szerep.helyi) return 'veglegesit'
  if (szerep.foIroda) return m.raktarVisszaigazolva ? 'veglegesit' : null
  if (szerep.raktaros && !m.raktarVisszaigazolva) return 'visszaigazol'
  return null
}

export type Allapot = 'raktarra_var' | 'fo_irodara_var' | 'elutasitva' | null

export function allapota(m: Movement): Allapot {
  if (m.deletedAt) return null
  if (m.approvalStatus === 'rejected') return 'elutasitva'
  if (m.approvalStatus !== 'pending') return null
  return m.raktarVisszaigazolva ? 'fo_irodara_var' : 'raktarra_var'
}

export const ALLAPOT_SZOVEG: Record<Exclude<Allapot, null>, string> = {
  raktarra_var: 'A raktár visszaigazolására vár',
  fo_irodara_var: 'A fő iroda elfogadására vár',
  elutasitva: 'Elutasítva – javítsa és küldje újra',
}

function napKulonbseg(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

/** Kettős rögzítés gyanúja: ugyanarra a termékre, ugyanabban az irányban, legfeljebb egy nap eltéréssel
 * már van el nem fogadott bejelentés vagy várakozó tétel. Az iroda ilyenkor inkább azt fogadja el. */
export function kettosRogzites(movements: readonly Movement[], uj: { productId: string; type: Movement['type']; date: string }): Movement[] {
  return movements.filter((m) => varakozo(m) && m.productId === uj.productId && m.type === uj.type && napKulonbseg(m.date, uj.date) <= 1)
}
