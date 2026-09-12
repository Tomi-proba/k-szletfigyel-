import { useState, type ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import { isSupabaseConfigured } from '../lib/supabase'
import { Login } from '../pages/auth/Login'
import { Register } from '../pages/auth/Register'
import { ForgotPassword } from '../pages/auth/ForgotPassword'
import { ResetPassword } from '../pages/auth/ResetPassword'

type AuthView = 'login' | 'register' | 'forgot-password'

/** Detected once, at module load, before any React state exists - a
 * password-recovery link always lands with a "?code=" query param
 * (independent of the "#/route" HashRouter hash, see lib/supabase.ts),
 * so this works no matter what the current hash happens to be. */
const hasPasswordRecoveryCode = new URLSearchParams(window.location.search).has('code')

/** Gates the whole app behind Supabase Auth - but only when Supabase is
 * actually configured (see .env.example). Until then this is a no-op
 * pass-through, so the existing single-tenant app keeps working exactly as
 * before for anyone who hasn't set up the SaaS layer yet. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AuthView>('login')
  const [passwordRecoveryHandled, setPasswordRecoveryHandled] = useState(false)

  if (!isSupabaseConfigured) return <>{children}</>

  return <ConfiguredAuthGate view={view} setView={setView} passwordRecoveryHandled={passwordRecoveryHandled} setPasswordRecoveryHandled={setPasswordRecoveryHandled}>{children}</ConfiguredAuthGate>
}

function ConfiguredAuthGate({
  children,
  view,
  setView,
  passwordRecoveryHandled,
  setPasswordRecoveryHandled,
}: {
  children: ReactNode
  view: AuthView
  setView: (v: AuthView) => void
  passwordRecoveryHandled: boolean
  setPasswordRecoveryHandled: (v: boolean) => void
}) {
  const { loading, session, profile, company } = useAuth()

  if (hasPasswordRecoveryCode && !passwordRecoveryHandled) {
    return <ResetPassword onDone={() => setPasswordRecoveryHandled(true)} />
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--color-text-muted)]">
        Betöltés…
      </div>
    )
  }

  if (!session) {
    if (view === 'register') return <Register onSwitchToLogin={() => setView('login')} />
    if (view === 'forgot-password') return <ForgotPassword onSwitchToLogin={() => setView('login')} />
    return <Login onSwitchToRegister={() => setView('register')} onSwitchToForgotPassword={() => setView('forgot-password')} />
  }

  if (!profile || !company) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center text-sm text-[var(--color-text-muted)]">
        A fiókod előkészítése folyamatban van - ha ez a képernyő sokáig nem tűnik el, jelentkezz be újra, vagy vedd fel a kapcsolatot az
        üzemeltetővel.
      </div>
    )
  }

  return <>{children}</>
}
