// Mentési sor: a szerverre még el nem jutott változások biztonságos, sorrendtartó elküldése.
//
// - Minden felhasználói művelet EGY tétel a sorban, és a szerveren EGY tranzakcióban mentődik
//   (public.keszlet_mentes, lásd supabase/migrations/2026-10-23_szerveroldali_adatok.sql).
// - A sor a böngésző tárolójában is megmarad, így egy bezárt fül vagy kifogyott internet sem
//   veszíti el a még nem mentett változást; a következő indításkor folytatódik.
// - A tételek szigorúan sorban mennek, egyszerre egy; ugyanaz a tétel újraküldve is csak egyszer
//   hat (a szerver a tétel azonosítója alapján ismeri fel).
// - Hálózati vagy szerverhiba: automatikus újrapróbálás, növekvő várakozással.
// - Ütközés, jogosultsági vagy adathiba: a sor megáll, és a felhasználó érthető üzenetet kap arról,
//   mely műveletei NEM mentődtek; ezeket csendben soha nem dobjuk el.
//
// A modul nem függ a Reacttól és a Supabase-től (a küldést és a tárolót kívülről kapja), így
// önállóan tesztelhető.

export interface Valtozas {
  tabla: string
  sor: Record<string, unknown>
}

export interface MentesiTetel {
  /** A mentési köteg azonosítója: ugyanazzal újraküldve a szerver nem hajtja végre még egyszer. */
  id: string
  companyId: string
  letrehozva: string
  /** Ember-olvasható leírás(ok) a művelet(ek)ről, a hibaüzenethez (pl. „Eladás rögzítve - Ajtó (2 db)”). */
  leirasok: string[]
  valtozasok: Valtozas[]
}

export type HibaFajta = 'halozat' | 'szerver' | 'utkozes' | 'jogosultsag' | 'ervenytelen'

export type KuldesEredmeny =
  | { ok: true; verziok: { tabla: string; id: string; version: number }[] }
  | { ok: false; fajta: HibaFajta; technikai: string }

export type Kuldo = (tetel: MentesiTetel) => Promise<KuldesEredmeny>

export type SorAllapot =
  | { fajta: 'mentve' }
  | { fajta: 'mentes'; fuggo: number }
  | { fajta: 'ujraprobalas'; fuggo: number; ok: 'halozat' | 'szerver'; probalkozas: number; kovetkezo: number }
  | { fajta: 'elakadt'; ok: 'utkozes' | 'jogosultsag' | 'ervenytelen'; elveszett: string[]; technikai: string }

export interface Tarolo {
  getItem(kulcs: string): string | null
  setItem(kulcs: string, ertek: string): void
}

export interface Idozito {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(azonosito: unknown): void
  now(): number
}

export const TAROLO_KULCS = 'keszletfigyelo-mentesi-sor'

/** Újrapróbálás várakozása: 1, 2, 4, 8, 16, 32, majd legfeljebb 60 másodperc. */
export function varakozas(probalkozas: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, probalkozas - 1))
}

export class MentesiSor {
  private tetelek: MentesiTetel[] = []
  private companyId: string | null = null
  private folyamatban = false
  private idozitett: unknown = null
  private probalkozas = 0
  private allapot: SorAllapot = { fajta: 'mentve' }
  private readonly figyelok = new Set<(a: SorAllapot) => void>()

  private readonly kuldo: Kuldo
  private readonly tarolo: Tarolo
  private readonly idozito: Idozito

  constructor(kuldo: Kuldo, tarolo: Tarolo, idozito: Idozito) {
    this.kuldo = kuldo
    this.tarolo = tarolo
    this.idozito = idozito
  }

  /** A megadott cég még el nem küldött tételeinek betöltése (pl. bejelentkezéskor). */
  betolt(companyId: string): void {
    this.leallit()
    this.companyId = companyId
    this.tetelek = this.olvas()[companyId] ?? []
    this.probalkozas = 0
    this.allapotBeallit(this.tetelek.length ? { fajta: 'mentes', fuggo: this.tetelek.length } : { fajta: 'mentve' })
  }

  /** Kijelentkezéskor: a sor a tárolóban marad, csak a feldolgozás áll le. */
  leallit(): void {
    if (this.idozitett !== null) this.idozito.clearTimeout(this.idozitett)
    this.idozitett = null
    this.companyId = null
    this.tetelek = []
  }

  get fuggoTetelek(): readonly MentesiTetel[] {
    return this.tetelek
  }

  get aktualisAllapot(): SorAllapot {
    return this.allapot
  }

  figyel(fn: (a: SorAllapot) => void): () => void {
    this.figyelok.add(fn)
    fn(this.allapot)
    return () => this.figyelok.delete(fn)
  }

  hozzaad(tetel: MentesiTetel): void {
    if (tetel.companyId !== this.companyId) throw new Error('A mentési tétel nem az aktuális céghez tartozik.')
    this.tetelek.push(tetel)
    this.ment()
    if (this.allapot.fajta === 'elakadt') return
    if (this.allapot.fajta !== 'ujraprobalas') this.allapotBeallit({ fajta: 'mentes', fuggo: this.tetelek.length })
    else this.allapotBeallit({ ...this.allapot, fuggo: this.tetelek.length })
    void this.feldolgoz()
  }

  /** Azonnali újrapróbálás (pl. a felhasználó gombnyomására, vagy ha visszajött az internet). */
  ujraprobal(): void {
    if (this.allapot.fajta === 'elakadt') return
    if (this.idozitett !== null) this.idozito.clearTimeout(this.idozitett)
    this.idozitett = null
    void this.feldolgoz()
  }

  /** Elakadás után: a hibás és az utána következő (rá épülő) tételek eldobása, miután a felhasználó
   * látta, mi nem mentődött. Utána a hívónak a szerverről újra kell töltenie az adatokat. */
  elakadasLezarasa(): string[] {
    const elveszett = this.tetelek.flatMap((t) => t.leirasok)
    this.tetelek = []
    this.ment()
    this.probalkozas = 0
    this.allapotBeallit({ fajta: 'mentve' })
    return elveszett
  }

  /** Megvárja, amíg a sor kiürül vagy elakad (bejelentkezéskor, a szerveradatok betöltése előtt). */
  kiurulesig(): Promise<SorAllapot> {
    return new Promise((resolve) => {
      const leiratkozas = this.figyel((a) => {
        if (a.fajta === 'mentve' || a.fajta === 'elakadt' || a.fajta === 'ujraprobalas') {
          queueMicrotask(() => leiratkozas())
          resolve(a)
        }
      })
      void this.feldolgoz()
    })
  }

  private async feldolgoz(): Promise<void> {
    if (this.folyamatban || this.allapot.fajta === 'elakadt') return
    this.folyamatban = true
    try {
      while (this.tetelek.length > 0 && this.companyId) {
        const tetel = this.tetelek[0]
        const eredmeny = await this.kuldo(tetel)
        if (this.tetelek[0] !== tetel) return // közben kijelentkeztek vagy cégváltás történt
        if (eredmeny.ok) {
          this.tetelek.shift()
          this.ment()
          this.probalkozas = 0
          this.allapotBeallit(this.tetelek.length ? { fajta: 'mentes', fuggo: this.tetelek.length } : { fajta: 'mentve' })
          continue
        }
        if (eredmeny.fajta === 'halozat' || eredmeny.fajta === 'szerver') {
          this.probalkozas += 1
          const ms = varakozas(this.probalkozas)
          this.allapotBeallit({
            fajta: 'ujraprobalas',
            fuggo: this.tetelek.length,
            ok: eredmeny.fajta,
            probalkozas: this.probalkozas,
            kovetkezo: this.idozito.now() + ms,
          })
          this.idozitett = this.idozito.setTimeout(() => {
            this.idozitett = null
            void this.feldolgoz()
          }, ms)
          return
        }
        this.allapotBeallit({
          fajta: 'elakadt',
          ok: eredmeny.fajta,
          elveszett: this.tetelek.flatMap((t) => t.leirasok),
          technikai: eredmeny.technikai,
        })
        return
      }
    } finally {
      this.folyamatban = false
    }
  }

  private olvas(): Record<string, MentesiTetel[]> {
    try {
      return JSON.parse(this.tarolo.getItem(TAROLO_KULCS) ?? '{}') as Record<string, MentesiTetel[]>
    } catch {
      return {}
    }
  }

  private ment(): void {
    if (!this.companyId) return
    const minden = this.olvas()
    if (this.tetelek.length) minden[this.companyId] = this.tetelek
    else delete minden[this.companyId]
    this.tarolo.setItem(TAROLO_KULCS, JSON.stringify(minden))
  }

  private allapotBeallit(a: SorAllapot): void {
    this.allapot = a
    for (const fn of this.figyelok) fn(a)
  }
}

/** A Supabase-hívás hibájának besorolása. A hálózati és átmeneti szerverhibát újrapróbáljuk, a
 * többit nem (azok újraküldve is ugyanúgy hibáznának). */
export function hibaBesorolas(hiba: { code?: string; message?: string; status?: number }): HibaFajta {
  const kod = hiba.code ?? ''
  const uzenet = hiba.message ?? ''
  if (kod === 'KF409') return 'utkozes'
  if (kod === 'PGRST301' || /JWT expired/i.test(uzenet)) return 'szerver' // lejárt munkamenet: a kliens megújítja, újrapróbáljuk
  if (kod === '42501' || hiba.status === 401 || hiba.status === 403) return 'jogosultsag'
  if (!kod && (!hiba.status || hiba.status === 0 || /fetch|network|NetworkError|timeout/i.test(uzenet))) return 'halozat'
  if ((hiba.status ?? 0) >= 500 || kod.startsWith('08') || kod === '57014' || kod === '40001' || kod === '40P01') return 'szerver'
  return 'ervenytelen'
}

/** Érthető magyar üzenet a sor állapotáról. */
export function allapotUzenet(a: SorAllapot): string {
  switch (a.fajta) {
    case 'mentve':
      return 'Minden változás elmentve.'
    case 'mentes':
      return a.fuggo === 1 ? 'Mentés…' : `Mentés… (${a.fuggo} változás)`
    case 'ujraprobalas':
      return a.ok === 'halozat'
        ? `Nincs kapcsolat a szerverrel. ${a.fuggo} nem mentett változásod biztonságban van ezen az eszközön, és automatikusan elmentjük, amint helyreáll a kapcsolat. Addig ne töröld a böngésző adatait, és ne jelentkezz ki.`
        : `A szerver átmenetileg nem válaszol. ${a.fuggo} változás vár mentésre; automatikusan újrapróbáljuk.`
    case 'elakadt': {
      const mi = a.elveszett.length ? a.elveszett.map((l) => `„${l}”`).join(', ') : 'a legutóbbi változás'
      if (a.ok === 'utkozes')
        return `Nem sikerült menteni: ${mi}. Ugyanezt az adatot közben egy másik eszközön módosították, és hogy azt ne írjuk felül, ezt a változást nem mentettük. Frissítsd az adatokat, és ha szükséges, rögzítsd újra.`
      if (a.ok === 'jogosultsag')
        return `Nem sikerült menteni: ${mi}. Ehhez a művelethez nincs jogosultságod (vagy közben megváltozott a szerepköröd). Frissítsd az adatokat; ha szerinted ez hiba, keresd a cég fő irodáját.`
      return `Nem sikerült menteni: ${mi}. A szerver nem fogadta el az adatot. Frissítsd az adatokat, és próbáld újra; ha a hiba ismétlődik, jelezd a következő azonosítóval: ${a.technikai}`
    }
  }
}
