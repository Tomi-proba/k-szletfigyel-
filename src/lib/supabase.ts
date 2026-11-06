// Supabase client for the SaaS réteg (regisztráció/bejelentkezés, cégenkénti
// előfizetés, admin nézet) - see supabase/schema.sql for the tables/RLS this
// talks to, and .env.example for the two required env vars.
//
// Deliberately tolerant of missing configuration: until VITE_SUPABASE_URL
// and VITE_SUPABASE_ANON_KEY are set, isSupabaseConfigured is false and the
// app falls back to today's behavior (no login, single-tenant) - see
// components/AuthGate.tsx. This means merging/deploying this layer never
// breaks the existing app for anyone who hasn't set up Supabase yet.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { asztali } from './asztali'

// Az asztali programban a szerver címe a felhasználó mappájában lévő beállítófájlból jön
// (keszletfigyelo-beallitas.json), nem a telepítőbe fordítva: így a szolgáltató cseréje nem igényel új
// telepítőt. A webes változatban a build-környezetváltozók adják, mint eddig.
const supabaseUrl = (asztali?.beallitas.supabaseUrl || import.meta.env.VITE_SUPABASE_URL) as string | undefined
const supabaseAnonKey = (asztali?.beallitas.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

// PKCE flow delivers the password-recovery token as a "?code=" query
// param, which sits BEFORE the "#" in the URL - the app's own HashRouter
// only ever looks at what's after the "#", so the two never collide. The
// default (implicit) flow instead appends "#access_token=..." to the
// redirect URL, which would corrupt/replace whatever "#/route" the
// HashRouter was using - see AuthGate.tsx for how the "?code=" is detected
// on load, independent of the current hash route.
// A kiválasztott cég (AWEBOLDAL TERV.md F24 KS4): egy felhasználó több cégnek is tagja lehet. Minden kérés
// az x-keszlet-ceg fejlécben viszi, melyik cégben dolgozik; az adatbázis jogosultsági szabályai (RLS) csak
// ennek a cégnek az adatait engedik, és csak akkor, ha a felhasználó tagja.
let kivalasztottCeg: string | null = null
export const kivalasztottCegBeallitas = (cegId: string | null) => {
  kivalasztottCeg = cegId
}
export const kivalasztottCegAzonosito = () => kivalasztottCeg

/** A fetch, amely minden kéréshez hozzáteszi a kiválasztott cég fejlécét (exportálva a teszthez). */
export function cegesFetch(alap: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const fejlec = new Headers(init?.headers)
    if (kivalasztottCeg) fejlec.set('x-keszlet-ceg', kivalasztottCeg)
    return alap(input, { ...init, headers: fejlec })
  }
}

// `let`: a közös keretben (keretSupabaseBeallitas) egy másik, a keret tokenjével dolgozó kliensre cserélődik; az
// ES-modulok élő kötése miatt minden importáló az újat látja.
export let supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, { auth: { flowType: 'pkce' }, global: { fetch: cegesFetch() } })
  : null

/** A keret tokenforrása (AWEBOLDAL TERV.md F24 KS3); null: önálló futás. */
let keretToken: (() => Promise<string | null>) | null = null
export const keretTokenForras = () => keretToken

/** A keret belépési jegye a Készletnek (a kiválasztott portál-céghez): a tagság a portál szerint igazodik (F25). */
let keretJegy: (() => Promise<string>) | null = null
export const keretJegyBeallitas = (fn: () => Promise<string>) => {
  keretJegy = fn
}

/**
 * Felhasználókezelés egy helyen (AWEBOLDAL TERV.md F25): a keretben belépéskor és cégváltáskor a portál jegyével
 * a portal-tagsag Edge Function a portál szerint létrehozza, igazítja vagy megszünteti a tagságot. Ha nem érhető
 * el (pl. még nincs telepítve), a meglévő tagsággal megyünk tovább; a portál jelzése később igazít.
 */
/**
 * Önálló (nem a keretből) belépéskor (AWEBOLDAL TERV.md F26): a portal-tagsag függvény a felhasználó tokenjével
 * lekéri a portál tagsági kivonatát, és a portálról kezelt tagságokat aszerint igazítja – ahogy a Könyvelő is
 * belépéskor igazodik. Ha nincs portál (önálló telepítés) vagy a függvény nem érhető el, nincs változás.
 */
export async function portalTagsagOnalloIgazitas(): Promise<void> {
  if (!supabase || keretToken) return
  try {
    const { error } = await supabase.functions.invoke('portal-tagsag', { body: { onallo: true } })
    if (error) console.warn('A tagság igazítása a portál szerint nem sikerült:', error.message)
  } catch (e) {
    console.warn('A tagság igazítása a portál szerint nem sikerült:', e)
  }
}

export async function portalTagsagIgazitas(): Promise<string | null> {
  if (!supabase || !keretJegy) return null
  try {
    const jegy = await keretJegy()
    const { data, error } = await supabase.functions.invoke('portal-tagsag', { body: { jegy } })
    if (error) {
      console.warn('A tagság igazítása a portál szerint nem sikerült:', error.message)
      return null
    }
    return (data as { eredmeny?: string } | null)?.eredmeny ?? null
  } catch (e) {
    console.warn('A tagság igazítása a portál szerint nem sikerült:', e)
    return null
  }
}

/**
 * A közös keretben a Készlet a keret Supabase-munkamenetét HASZNÁLJA: minden kéréshez a keret adja a hozzáférési
 * tokent (a keret frissíti), a Készlet saját munkamenetet nem tárol és nem frissít – így a két program frissítő
 * tokenjei nem ütköznek. Ilyenkor a supabase.auth nem érhető el; a belépés állapotát a token adja (useAuth).
 */
export function keretSupabaseBeallitas(token: () => Promise<string | null>) {
  if (keretToken === token || !isSupabaseConfigured) return
  keretToken = token
  supabase = createClient(supabaseUrl as string, supabaseAnonKey as string, {
    accessToken: async () => (await token()) ?? null,
    global: { fetch: cegesFetch() },
  })
}

/** A JWT tartalma (aláírás-ellenőrzés nélkül: a hitelesítést a Supabase végzi minden kérésnél). */
export function tokenTartalom(token: string): { sub: string; email: string | null; aal: string | null } | null {
  const resz = token.split('.')
  if (resz.length !== 3) return null
  try {
    const b64 = resz[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    )
    const t = JSON.parse(json) as { sub?: string; email?: string; aal?: string }
    return t.sub ? { sub: t.sub, email: t.email ?? null, aal: t.aal ?? null } : null
  } catch {
    return null
  }
}
