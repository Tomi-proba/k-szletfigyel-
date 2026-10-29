// A Windowsos (Electron) asztali program felülete a webes kód felé (electron/preload.js). A böngészős
// változatban nincs ilyen: ott minden függvény üres hatású, és a program pontosan úgy működik, mint eddig.

export interface RegiAdat {
  /** A korábbi (véletlen portos) cím, ahol az adat volt. */
  cim: string
  modositva: string | null
  osszesites: { termekek: number; mozgasok: number; telephelyek: number; naploTetelek: number; beszallitok: number } | null
  fuggoMentesek: number
  /** A tároló nyers tartalma (a visszatöltéshez). */
  adat: string | null
  sor: string | null
}

export interface AsztaliFelulet {
  beallitas: { supabaseUrl: string | null; supabaseAnonKey: string | null }
  regiAdatok(): Promise<RegiAdat[]>
  biztonsagiMentes(nev: string, tartalom: string): Promise<string>
  regiAdatokElintezve(): Promise<void>
  regiAdatokElintezveVan: boolean
  /** Szinkron, lemezre kényszerített írás (fsync); csak utána tér vissza. */
  tartosIras(kulcs: string, tartalom: string): { ok: boolean; hiba?: string }
  tartosOlvasas(kulcs: string): string | null
  nemMentett(darab: number): void
}

export const asztali: AsztaliFelulet | null =
  typeof window !== 'undefined' ? ((window as unknown as { keszletAsztali?: AsztaliFelulet }).keszletAsztali ?? null) : null

interface Tarolo {
  getItem(kulcs: string): string | null
  setItem(kulcs: string, ertek: string): void
}

/**
 * A mentési sor tárolója az asztali programban: a böngészőtároló mellett fájlba is írja, lemezre
 * kényszerítve, mielőtt a művelet sikeresnek látszana; ha a böngészőtárolóban nincs meg a sor, a fájlból
 * tölti vissza (lib/tartosTarolo.ts).
 */
export function asztaliTarolo(alap: Tarolo, felulet: Pick<AsztaliFelulet, 'tartosIras' | 'tartosOlvasas'> | null, sorKulcs: string, hibaJelzes?: (hiba: string | null) => void): Tarolo {
  if (!felulet) return alap
  return {
    getItem(kulcs) {
      if (kulcs !== sorKulcs) return alap.getItem(kulcs)
      return felulet.tartosOlvasas(kulcs) ?? alap.getItem(kulcs)
    },
    setItem(kulcs, ertek) {
      if (kulcs === sorKulcs) {
        const r = felulet.tartosIras(kulcs, ertek)
        hibaJelzes?.(r.ok ? null : (r.hiba ?? 'ismeretlen hiba'))
      }
      alap.setItem(kulcs, ertek)
    },
  }
}
