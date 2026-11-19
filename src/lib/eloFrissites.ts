// F29: valós idejű frissítés oldalújratöltés nélkül (AWEBOLDAL TERV.md F29).
//
// Az adatbázis minden üzleti változáskor egy adat nélküli „változott valami" jelzést küld a cég privát Realtime-
// csatornájára (keszlet:<cég>, supabase/schema.sql F29 blokk). Erre a program a szokásos, jogosultság-ellenőrzött
// lekérdezéssel tölti újra az adatot - így a raktáros csak a saját telephelyét kapja, a több céghez tartozó felhasználó
// pedig csak a kiválasztott cégét.
//
// Szabályok:
// - több jelzés gyors egymásutánban egy frissítés (várakozás után);
// - amíg a saját mentés még nincs a szerveren, nem töltünk újra (az felülírná a még el nem küldött változást, és a
//   verziók is összekeverednének): a mentési sor kiürülése után frissítünk;
// - ha a kapcsolat nem jön létre vagy megszakad, a régi módon, időnként frissítünk; visszakapcsoláskor és amikor a lap
//   újra előtérbe kerül, egyszer azonnal;
// - a lap háttérben: nem frissítünk (a visszatéréskor egyszer igen).

export type CsatornaAllapot = 'kapcsolodik' | 'el' | 'megszakadt'

export interface EloFrissitesFuggosegek {
  /** Feliratkozás a cég jelzéseire; a visszaadott függvény leiratkozik. */
  feliratkozik(ceg: string, jelzes: () => void, allapot: (a: CsatornaAllapot) => void): () => void
  /** Az adatok újratöltése a szerverről (a store-ba). */
  frissit(): Promise<void>
  /** Igaz, ha nincs el nem küldött saját mentés. */
  mentesUres(): boolean
  /** Értesítés a mentési sor változásáról; a visszaadott függvény leiratkozik. */
  mentesFigyel(fn: () => void): () => void
  /** Igaz, ha a lap látható. */
  lathato(): boolean
  /** Értesítés, ha a lap láthatósága változik; a visszaadott függvény leiratkozik. */
  lathatosagFigyel(fn: () => void): () => void
  idozito: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void; setInterval(fn: () => void, ms: number): unknown; clearInterval(id: unknown): void }
}

export const VARAKOZAS_MS = 600
export const TARTALEK_MS = 60_000

export class EloFrissito {
  private ceg: string | null = null
  private leiratkozasok: (() => void)[] = []
  private kesleltetes: unknown = null
  private tartalek: unknown = null
  private fut = false
  private ujraKell = false
  private varakozik = false
  private allapot: CsatornaAllapot = 'kapcsolodik'

  private f: EloFrissitesFuggosegek

  constructor(f: EloFrissitesFuggosegek) {
    this.f = f
  }

  get csatornaAllapot(): CsatornaAllapot {
    return this.allapot
  }

  indit(ceg: string): void {
    if (this.ceg === ceg) return
    this.leallit()
    this.ceg = ceg
    this.allapot = 'kapcsolodik'
    this.leiratkozasok.push(
      this.f.feliratkozik(ceg, () => this.jelzes(), (a) => this.allapotValtozas(a)),
      this.f.mentesFigyel(() => {
        if (this.varakozik && this.f.mentesUres()) {
          this.varakozik = false
          this.jelzes()
        }
      }),
      this.f.lathatosagFigyel(() => {
        if (this.f.lathato()) this.jelzes(0)
      }),
    )
    // Amíg a csatorna nem él, a tartalék időnkénti frissítés fut.
    this.tartalekInditas()
  }

  leallit(): void {
    for (const l of this.leiratkozasok.splice(0)) l()
    if (this.kesleltetes !== null) this.f.idozito.clearTimeout(this.kesleltetes)
    this.kesleltetes = null
    this.tartalekLeallitas()
    this.ceg = null
    this.varakozik = false
    this.ujraKell = false
  }

  /** Egy jelzés (vagy tartalék / visszatérés): várakozás után egy frissítés. */
  jelzes(ms = VARAKOZAS_MS): void {
    if (!this.ceg) return
    if (this.kesleltetes !== null) this.f.idozito.clearTimeout(this.kesleltetes)
    this.kesleltetes = this.f.idozito.setTimeout(() => {
      this.kesleltetes = null
      void this.frissites()
    }, ms)
  }

  private async frissites(): Promise<void> {
    if (!this.ceg) return
    if (!this.f.lathato()) return // visszatéréskor úgyis frissít
    if (!this.f.mentesUres()) {
      this.varakozik = true
      return
    }
    if (this.fut) {
      this.ujraKell = true
      return
    }
    this.fut = true
    const ceg = this.ceg
    try {
      await this.f.frissit()
    } catch (hiba) {
      console.warn('[eloFrissites] a frissítés nem sikerült, a következő jelzésnél újra próbáljuk', hiba)
    } finally {
      this.fut = false
    }
    if (this.ujraKell && this.ceg === ceg) {
      this.ujraKell = false
      this.jelzes()
    }
  }

  private allapotValtozas(a: CsatornaAllapot): void {
    const korabban = this.allapot
    this.allapot = a
    if (a === 'el') {
      this.tartalekLeallitas()
      // Visszakapcsoláskor a kimaradt változások pótlása.
      if (korabban === 'megszakadt') this.jelzes(0)
    } else {
      this.tartalekInditas()
    }
  }

  private tartalekInditas(): void {
    if (this.tartalek !== null) return
    this.tartalek = this.f.idozito.setInterval(() => this.jelzes(0), TARTALEK_MS)
  }

  private tartalekLeallitas(): void {
    if (this.tartalek !== null) this.f.idozito.clearInterval(this.tartalek)
    this.tartalek = null
  }
}
