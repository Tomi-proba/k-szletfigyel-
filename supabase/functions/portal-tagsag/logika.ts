// A portal-tagsag Edge Function logikája (AWEBOLDAL TERV.md F25: felhasználókezelés egy helyen), a futtató
// környezettől függetlenül: a Deno-burok (index.ts) adja hozzá a JWT-ellenőrzést (a portál nyilvános kulcsaival)
// és a Supabase-hívásokat; a tesztek (tests/portalTagsag.test.ts) ugyanezt Node-ban futtatják.
//
// Két út:
//  1. A portál tagság-jelzése (szerverről szerverre): { jelzes } – a portál a tagság minden változása után
//     elküldi a felhasználó hatályos Készlet-szerepét (null = nincs hozzáférés).
//  2. A keret belépéskor: { jegy } + a felhasználó Supabase-tokenje – a portál belépési jegye (kétlépcsős,
//     egyszer használható); a jegyben lévő e-mail-címnek egyeznie kell a token felhasználójáéval.
// Mindkét esetben a portál a forrás: a tagság a portál szerint jön létre, változik vagy szűnik meg.

export const TAGSAG_CIMZETT = 'eafa-csomag:tagsag:keszlet'
export const BELEPESI_CIMZETT = 'eafa-csomag:modul:keszlet'
const SZEREPEK = ['raktaros', 'iroda', 'fo_iroda', 'tulajdonos']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Fuggosegek {
  /** Aláírás, kiadó, címzett, lejárat ellenőrzése (ES256, a portál JWKS-e); hibánál kivételt dob. */
  ellenoriz(token: string, cimzett: string): Promise<Record<string, unknown>>
  /** A Supabase-token felhasználójának e-mail-címe (null: érvénytelen token). */
  felhasznaloEmail(accessToken: string): Promise<string | null>
  /** public.portal_tagsag_igazitas (service role). */
  igazit(portalCeg: string, email: string, szerep: string | null, jti: string, lejar: Date): Promise<string>
}

export interface Valasz {
  statusz: number
  adat: Record<string, unknown>
}

const hiba = (statusz: number, kod: string, uzenet: string): Valasz => ({ statusz, adat: { hiba: kod, uzenet } })

function adatok(p: Record<string, unknown>) {
  const ceg = p.ceg as Record<string, unknown> | undefined
  const szerep = (p.modulSzerep ?? (ceg?.modulSzerep as unknown)) as unknown
  if (typeof p.jti !== 'string' || typeof p.email !== 'string' || typeof p.exp !== 'number' || !ceg || typeof ceg.id !== 'string' || !UUID.test(ceg.id))
    return null
  if (szerep !== null && szerep !== undefined && (typeof szerep !== 'string' || !SZEREPEK.includes(szerep))) return null
  return { jti: p.jti, email: p.email, lejar: new Date(p.exp * 1000), ceg: ceg.id, szerep: (szerep as string | null | undefined) ?? null }
}

export async function kezel(torzs: unknown, authorization: string | null, d: Fuggosegek): Promise<Valasz> {
  const b = (torzs ?? {}) as { jelzes?: unknown; jegy?: unknown }
  if (typeof b.jelzes === 'string') {
    let p: Record<string, unknown>
    try {
      p = await d.ellenoriz(b.jelzes, TAGSAG_CIMZETT)
    } catch {
      return hiba(401, 'ervenytelen-jelzes', 'Érvénytelen tagság-jelzés.')
    }
    const a = p.esemeny === 'tagsag' ? adatok(p) : null
    if (!a) return hiba(400, 'ervenytelen-jelzes', 'Érvénytelen tagság-jelzés.')
    const eredmeny = await d.igazit(a.ceg, a.email, a.szerep, a.jti, a.lejar)
    return { statusz: 200, adat: { eredmeny } }
  }
  if (typeof b.jegy === 'string') {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) return hiba(401, 'nincs-belepes', 'Lépj be újra.')
    let p: Record<string, unknown>
    try {
      p = await d.ellenoriz(b.jegy, BELEPESI_CIMZETT)
    } catch {
      return hiba(401, 'ervenytelen-jegy', 'Érvénytelen belépési jegy. Nyisd meg újra a Készletkezelőt a portálon.')
    }
    if (p.aal !== 'aal2') return hiba(401, 'nem-ketlepcsos', 'A belépéshez kétlépcsős azonosítás szükséges.')
    const a = adatok(p)
    if (!a) return hiba(400, 'ervenytelen-jegy', 'Érvénytelen belépési jegy.')
    const email = await d.felhasznaloEmail(token)
    // A jegy csak a saját fiókra érvényes: más felhasználó jegyével nem lehet tagságot szerezni.
    if (!email || email.toLowerCase() !== a.email.toLowerCase()) return hiba(403, 'mas-felhasznalo', 'A belépési jegy nem ehhez a fiókhoz tartozik.')
    const eredmeny = await d.igazit(a.ceg, a.email, a.szerep, a.jti, a.lejar)
    if (eredmeny === 'mar-felhasznalt') return hiba(401, 'mar-felhasznalt', 'Ezt a belépési jegyet már felhasználták.')
    return { statusz: 200, adat: { eredmeny, szerep: a.szerep } }
  }
  return hiba(400, 'hianyzo-adat', 'Jelzés vagy belépési jegy kell.')
}
