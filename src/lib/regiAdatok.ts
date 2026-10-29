// A Windowsos program korábbi (véletlen portos) indításai alatt tárolt adatok visszatöltése.
// Tiszta függvények: a felület (components/AsztaliAdatMento.tsx) és a tesztek is ezeket használják.
import { demoAdatnakTunik, helyiPillanatkep } from './atkoltoztetes'
import type { RegiAdat } from './asztali'
import { TAROLO_KULCS } from './mentesiSor'

export const ADAT_KULCS = 'keszletfigyelo-storage'

export interface JelenlegiAllapot {
  /** Van-e a mostani (új címen lévő) tárolóban valódi (nem bemutató) adat. */
  valodiAdat: boolean
  fuggoMentesek: number
}

export function jelenlegiAllapot(adat: string | null, sor: string | null): JelenlegiAllapot {
  const helyi = helyiPillanatkep(adat)
  const valodiAdat = Boolean(helyi && (helyi.products.length > 0 || helyi.movements.length > 0 || helyi.ledgerEntries.length > 0) && !demoAdatnakTunik(helyi))
  return { valodiAdat, fuggoMentesek: sorHossz(sor) }
}

function sorHossz(sor: string | null): number {
  try {
    return sor ? ((JSON.parse(sor) as { tetelek?: unknown[] }).tetelek ?? []).length : 0
  } catch {
    return 0
  }
}

/** A visszatölthető régi adatok: amelyikben valódi adat vagy nem mentett változás van. */
export function visszatolthetok(regiek: RegiAdat[]): RegiAdat[] {
  return regiek.filter((r) => {
    if (r.fuggoMentesek > 0) return true
    const h = helyiPillanatkep(r.adat)
    return Boolean(h && (h.products.length > 0 || h.movements.length > 0 || h.ledgerEntries.length > 0) && !demoAdatnakTunik(h))
  })
}

/**
 * Két mentési sor összefésülése (a régi tételei előre, ugyanaz a tétel egyszer): a régi sorban maradt,
 * szerverre még el nem jutott változás sem vész el. A szerver a tétel azonosítója alapján egyszer
 * hajtja végre, így az esetleges ismétlés sem okoz kárt.
 */
export function sorokOsszefesulese(regi: string | null, mostani: string | null): string | null {
  const olvas = (s: string | null) => {
    try {
      return s ? ((JSON.parse(s) as { tetelek?: Array<{ id: string }> }).tetelek ?? []) : []
    } catch {
      return []
    }
  }
  const a = olvas(regi)
  const b = olvas(mostani)
  if (!a.length) return mostani
  const ids = new Set(a.map((t) => t.id))
  const alap = (() => {
    try {
      return mostani ? (JSON.parse(mostani) as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  })()
  return JSON.stringify({ ...alap, tetelek: [...a, ...b.filter((t) => !ids.has(t.id))] })
}

interface Tarolo {
  getItem(kulcs: string): string | null
  setItem(kulcs: string, ertek: string): void
}

/**
 * A választott régi adat visszatöltése a mostani tárolóba. Előtte biztonsági mentés fájlba (a mostani és
 * a régi adat is), és semmit nem töröl: a régi tároló érintetlen marad.
 */
export async function visszatoltes(regi: RegiAdat, tarolo: Tarolo, biztonsagiMentes: (nev: string, tartalom: string) => Promise<string>): Promise<{ mentesHelye: string }> {
  const mostaniAdat = tarolo.getItem(ADAT_KULCS)
  const mostaniSor = tarolo.getItem(TAROLO_KULCS)
  const mentesHelye = await biztonsagiMentes(
    'visszatoltes-elott',
    JSON.stringify({ keszult: new Date().toISOString(), mostani: { adat: mostaniAdat, sor: mostaniSor }, visszatoltott: { cim: regi.cim, adat: regi.adat, sor: regi.sor } }),
  )
  if (regi.adat) tarolo.setItem(ADAT_KULCS, regi.adat)
  const sor = sorokOsszefesulese(regi.sor, mostaniSor)
  if (sor !== null && sor !== mostaniSor) tarolo.setItem(TAROLO_KULCS, sor)
  return { mentesHelye }
}
