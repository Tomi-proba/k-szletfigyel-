// Kétlépcsős azonosítás és közös belépés (AWEBOLDAL TERV.md F21) – a felület tiszta, tesztelhető része.
//
// A Készletkezelőnek nincs saját szervere: a hitelesítés a közös Supabase-projekt munkamenete. A portál a
// belépési jegy mellé a (kétlépcsős, aal2) Supabase-munkamenetet is átadja (`#/sso?jegy=…&at=…&rt=…`); a
// Készlet ezt veszi át, és csak aal2 munkamenetet fogad el. A jegyből a tétlenségi időt és az ellenőrzéshez
// a címzettet, a lejáratot és az e-mail-címet használja.

export const KESZLET_CIMZETT = 'eafa-csomag:modul:keszlet'
export const TETLENSEG_ALAP_PERC = 30
export const TETLENSEG_MAX_PERC = 12 * 60
/** A munkamenet abszolút felső határa, tétlenségtől függetlenül. */
export const MUNKAMENET_MAX_MS = 12 * 60 * 60 * 1000

export type MfaAllapot = 'ok' | 'kell-kod' | 'kell-beallitas'

/** A Supabase getAuthenticatorAssuranceLevel() eredményéből: mi kell még a teljes belépéshez. */
export function mfaAllapot(aal: { currentLevel: string | null; nextLevel: string | null }): MfaAllapot {
  if (aal.currentLevel === 'aal2') return 'ok'
  return aal.nextLevel === 'aal2' ? 'kell-kod' : 'kell-beallitas'
}

export interface SsoAdatok {
  jegy: string
  at: string | null
  rt: string | null
}

/** A portálról érkező cím (`#/sso?jegy=…&at=…&rt=…`) adatai; más címnél null. */
export function ssoAdatok(hash: string): SsoAdatok | null {
  const m = /^#\/sso\?(.*)$/.exec(hash)
  if (!m) return null
  const p = new URLSearchParams(m[1])
  const jegy = p.get('jegy')
  if (!jegy) return null
  return { jegy, at: p.get('at'), rt: p.get('rt') }
}

export interface JegyTartalom {
  aud: string | string[]
  exp: number
  email: string
  aal: string
  tetlenseg_perc: number
}

/** A jegy tartalma (aláírás-ellenőrzés nélkül: a hitelesítés itt a Supabase-munkamenet). */
export function jegyTartalom(jegy: string): JegyTartalom | null {
  const resz = jegy.split('.')
  if (resz.length !== 3) return null
  try {
    const b64 = resz[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    )
    const t = JSON.parse(json) as Partial<JegyTartalom>
    if (!t || typeof t.exp !== 'number' || typeof t.email !== 'string') return null
    return { aud: t.aud ?? '', exp: t.exp, email: t.email, aal: String(t.aal ?? ''), tetlenseg_perc: Number(t.tetlenseg_perc ?? TETLENSEG_ALAP_PERC) }
  } catch {
    return null
  }
}

/** Hiba szövege, ha a jegy nem ennek a modulnak szól, lejárt, nem kétlépcsős, vagy más felhasználóé; különben null. */
export function jegyHiba(t: JegyTartalom | null, munkamenetEmail: string | null | undefined, mostMs: number): string | null {
  if (!t) return 'Érvénytelen belépési jegy. Nyisd meg a Készletkezelőt újra a portálról.'
  const aud = Array.isArray(t.aud) ? t.aud : [t.aud]
  if (!aud.includes(KESZLET_CIMZETT)) return 'Ez a belépési jegy nem a Készletkezelőnek szól.'
  if (t.exp * 1000 + 30_000 < mostMs) return 'A belépési jegy lejárt. Nyisd meg a Készletkezelőt újra a portálról.'
  if (t.aal !== 'aal2') return 'A belépéshez kétlépcsős azonosítás szükséges.'
  if (!munkamenetEmail || munkamenetEmail.toLowerCase() !== t.email.toLowerCase()) return 'A belépési jegy és a munkamenet nem ugyanahhoz a felhasználóhoz tartozik.'
  return null
}

/** A tétlenségi idő percben: a jegyből (közös belépés), különben a raktárosnál a cég beállítása, másnál 30 perc. */
export function tetlensegPerc(o: { jegybol: number | null; szerep: string | null; cegRaktaros: number | null | undefined }): number {
  const nyers = o.jegybol ?? (o.szerep === 'raktaros' ? (o.cegRaktaros ?? TETLENSEG_ALAP_PERC) : TETLENSEG_ALAP_PERC)
  return Math.min(TETLENSEG_MAX_PERC, Math.max(1, Math.round(nyers)))
}

/** Le kell-e zárni a munkamenetet (tétlenség, vagy a 12 órás felső határ). */
export function lejart(o: { utolsoAktivitasMs: number; belepesMs: number | null; perc: number; mostMs: number }): boolean {
  if (o.mostMs - o.utolsoAktivitasMs > o.perc * 60_000) return true
  return o.belepesMs !== null && o.mostMs - o.belepesMs > MUNKAMENET_MAX_MS
}

// A közös belépés jelzése és a jegyben kapott tétlenségi idő (a böngészőfülre; kijelentkezéskor törlődik).
const KULCS = 'keszlet.kozosBelepes'
const BELEPES_KULCS = 'keszlet.belepesIdeje'

export function kozosBelepesMentes(perc: number) {
  try {
    sessionStorage.setItem(KULCS, JSON.stringify({ perc }))
  } catch {
    // privát mód: nincs mentés
  }
}

export function kozosBelepes(): { perc: number } | null {
  try {
    const v = sessionStorage.getItem(KULCS)
    return v ? (JSON.parse(v) as { perc: number }) : null
  } catch {
    return null
  }
}

export function belepesIdeje(): number | null {
  try {
    const v = localStorage.getItem(BELEPES_KULCS)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function belepesIdejeMentes(ms: number | null) {
  try {
    if (ms === null) localStorage.removeItem(BELEPES_KULCS)
    else localStorage.setItem(BELEPES_KULCS, String(ms))
  } catch {
    // nincs tároló
  }
}

export function kozosBelepesTorles() {
  try {
    sessionStorage.removeItem(KULCS)
  } catch {
    // nincs tároló
  }
  belepesIdejeMentes(null)
}
