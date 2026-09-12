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

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

// PKCE flow delivers the password-recovery token as a "?code=" query
// param, which sits BEFORE the "#" in the URL - the app's own HashRouter
// only ever looks at what's after the "#", so the two never collide. The
// default (implicit) flow instead appends "#access_token=..." to the
// redirect URL, which would corrupt/replace whatever "#/route" the
// HashRouter was using - see AuthGate.tsx for how the "?code=" is detected
// on load, independent of the current hash route.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, { auth: { flowType: 'pkce' } })
  : null
