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

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, { auth: { flowType: 'pkce' }, global: { fetch: cegesFetch() } })
  : null
