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
  mentesiSorFajlba(tartalom: string): void
  mentesiSorFajlbol(): string | null
  nemMentett(darab: number): void
}

export const asztali: AsztaliFelulet | null =
  typeof window !== 'undefined' ? ((window as unknown as { keszletAsztali?: AsztaliFelulet }).keszletAsztali ?? null) : null

interface Tarolo {
  getItem(kulcs: string): string | null
  setItem(kulcs: string, ertek: string): void
}

/**
 * A mentési sor tárolója az asztali programban: a böngészőtároló mellett fájlba is másol (a felhasználó
 * mappájába), és ha a böngészőtárolóban nincs meg a sor (pl. törölték), a fájlból tölti vissza. Így a
 * még nem mentett változás akkor sem vész el, ha a böngészőtároló elveszne.
 */
export function asztaliTarolo(alap: Tarolo, felulet: Pick<AsztaliFelulet, 'mentesiSorFajlba' | 'mentesiSorFajlbol'> | null, sorKulcs: string): Tarolo {
  if (!felulet) return alap
  return {
    getItem(kulcs) {
      const helyi = alap.getItem(kulcs)
      if (helyi !== null || kulcs !== sorKulcs) return helyi
      return felulet.mentesiSorFajlbol()
    },
    setItem(kulcs, ertek) {
      alap.setItem(kulcs, ertek)
      if (kulcs === sorKulcs) felulet.mentesiSorFajlba(ertek)
    },
  }
}
