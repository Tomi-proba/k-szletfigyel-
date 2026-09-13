// Auth/company/subscription state for the SaaS réteg - a React context so
// AuthGate, Layout, Subscription and Admin can all read the same session
// without prop-drilling. Talks to Supabase Auth (session) plus the
// companies/profiles tables (see supabase/schema.sql) for the tenant and
// subscription state layered on top.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { computeIsReadOnly } from '../lib/subscription'
import { mapCompanyRow, mapProfileRow, type Company, type Profile } from '../types/auth'
import { emptyBusinessSlices, fetchBusinessData } from '../lib/remoteSync'
import { hydrateFromRemote, resetToLocalMode } from '../store/useStore'

interface AuthResult {
  error: string | null
}

interface AuthContextValue {
  loading: boolean
  session: Session | null
  profile: Profile | null
  company: Company | null
  isReadOnly: boolean
  /** True once profile.role === 'raktaros' - the restricted, single-location
   * warehouse view. See DOCUMENTATION.md 14. fejezet for what this does and
   * doesn't restrict. */
  isWarehouseUser: boolean
  /** companyName is only used for a brand-new company (no inviteToken).
   * When inviteToken is set, the account joins that invite's existing
   * company/role/location instead - see handle_new_user() in schema.sql. */
  signUp: (email: string, password: string, companyName: string, inviteToken?: string) => Promise<AuthResult>
  signIn: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<AuthResult>
  updatePassword: (newPassword: string) => Promise<AuthResult>
  refreshCompany: () => Promise<void>
  /** Demo-only: simulates a successful subscription payment by writing
   * directly to the companies row - no real Stripe charge happens. See
   * pages/Subscription.tsx and supabase/functions/create-checkout-session
   * for what a real integration would replace this with. */
  demoActivateSubscription: () => Promise<AuthResult>
  demoCancelSubscription: () => Promise<AuthResult>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function friendlyAuthError(message: string): string {
  if (message.includes('Invalid login credentials')) return 'Hibás email cím vagy jelszó.'
  if (message.includes('User already registered')) return 'Ezzel az email címmel már regisztráltak.'
  if (message.includes('Password should be at least')) return 'A jelszónak legalább 6 karakter hosszúnak kell lennie.'
  // The invite-token check lives in the handle_new_user() Postgres trigger
  // (supabase/schema.sql) - a raised exception there surfaces here either as
  // its own text or wrapped in Supabase's generic "Database error saving new
  // user", depending on the Supabase version, so both are mapped.
  if (message.includes('Érvénytelen vagy lejárt meghívó') || message.includes('Database error saving new user')) {
    return 'Ez a meghívó érvénytelen, lejárt, vagy már felhasználásra került. Kérj újat attól, aki meghívott.'
  }
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [company, setCompany] = useState<Company | null>(null)

  const loadProfileAndCompany = useCallback(async (userId: string) => {
    if (!supabase) return
    const { data: profileRow } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (!profileRow) {
      setProfile(null)
      setCompany(null)
      resetToLocalMode()
      return
    }
    const mappedProfile = mapProfileRow(profileRow)
    setProfile(mappedProfile)
    const { data: companyRow } = await supabase.from('companies').select('*').eq('id', mappedProfile.companyId).maybeSingle()
    setCompany(companyRow ? mapCompanyRow(companyRow) : null)

    // Switches the store from the local/demo data every fresh browser starts
    // with over to this company's shared, Supabase-backed data (see
    // store/useStore.ts hydrateFromRemote + lib/remoteSync.ts) - what makes
    // the raktáros/iroda role split (DOCUMENTATION.md 14. fejezet) actually
    // share data across separate devices instead of each seeing its own
    // browser's local copy.
    try {
      const slices = await fetchBusinessData()
      hydrateFromRemote(mappedProfile.companyId, slices, mappedProfile.role)
    } catch (err) {
      console.error('[useAuth] failed to load business data from Supabase', err)
      hydrateFromRemote(mappedProfile.companyId, emptyBusinessSlices, mappedProfile.role)
    }
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let cancelled = false

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      setSession(data.session)
      if (data.session) await loadProfileAndCompany(data.session.user.id)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      if (newSession) {
        await loadProfileAndCompany(newSession.user.id)
      } else {
        setProfile(null)
        setCompany(null)
        resetToLocalMode()
      }
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [loadProfileAndCompany])

  const signUp = useCallback(async (email: string, password: string, companyName: string, inviteToken?: string): Promise<AuthResult> => {
    if (!supabase) return { error: 'A Supabase nincs beállítva.' }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: inviteToken ? { invite_token: inviteToken } : { company_name: companyName.trim() } },
    })
    return { error: error ? friendlyAuthError(error.message) : null }
  }, [])

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!supabase) return { error: 'A Supabase nincs beállítva.' }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? friendlyAuthError(error.message) : null }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }, [])

  const requestPasswordReset = useCallback(async (email: string): Promise<AuthResult> => {
    if (!supabase) return { error: 'A Supabase nincs beállítva.' }
    // No "#..." here on purpose - PKCE appends "?code=..." to this URL, and
    // that has to land before any "#/route" the HashRouter would otherwise
    // own. AuthGate.tsx detects the "?code=" on load and shows the new-
    // password screen regardless of whatever hash is (or isn't) present.
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${window.location.pathname}` })
    return { error: error ? friendlyAuthError(error.message) : null }
  }, [])

  const updatePassword = useCallback(async (newPassword: string): Promise<AuthResult> => {
    if (!supabase) return { error: 'A Supabase nincs beállítva.' }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error: error ? friendlyAuthError(error.message) : null }
  }, [])

  const refreshCompany = useCallback(async () => {
    if (session) await loadProfileAndCompany(session.user.id)
  }, [session, loadProfileAndCompany])

  const demoActivateSubscription = useCallback(async (): Promise<AuthResult> => {
    if (!supabase || !company) return { error: 'Nincs betöltött cég.' }
    const now = new Date()
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const { error } = await supabase
      .from('companies')
      .update({
        subscription_status: 'active',
        current_period_end: periodEnd.toISOString(),
        payment_failed_at: null,
        cancelled_at: null,
      })
      .eq('id', company.id)
    if (!error) await refreshCompany()
    return { error: error?.message ?? null }
  }, [company, refreshCompany])

  const demoCancelSubscription = useCallback(async (): Promise<AuthResult> => {
    if (!supabase || !company) return { error: 'Nincs betöltött cég.' }
    const { error } = await supabase
      .from('companies')
      .update({ subscription_status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', company.id)
    if (!error) await refreshCompany()
    return { error: error?.message ?? null }
  }, [company, refreshCompany])

  const isReadOnly = useMemo(() => computeIsReadOnly(company), [company])
  const isWarehouseUser = profile?.role === 'raktaros'

  const value: AuthContextValue = {
    loading,
    session,
    profile,
    company,
    isReadOnly,
    isWarehouseUser,
    signUp,
    signIn,
    signOut,
    requestPasswordReset,
    updatePassword,
    refreshCompany,
    demoActivateSubscription,
    demoCancelSubscription,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
