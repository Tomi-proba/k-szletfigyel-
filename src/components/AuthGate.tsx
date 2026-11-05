import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { belepesIdeje, belepesIdejeMentes, jegyHiba, jegyTartalom, kozosBelepes, kozosBelepesMentes, lejart, ssoAdatok, tetlensegPerc } from '../lib/kozosBelepes'
import { Ketlepcsos } from '../pages/auth/Ketlepcsos'
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

/** A "Csapat" oldalon (pages/Team.tsx) generált meghívó-link is egy plain
 * "?meghivo=TOKEN" query parammal érkezik, ugyanazon okból (a "#/route"
 * hash elé kerül, HashRouter-biztosan). Jelenléte esetén a Register a
 * meglévő céghez csatlakozás módban nyílik meg, sima regisztráció helyett. */
const inviteToken = new URLSearchParams(window.location.search).get('meghivo')

/** A portálról nyitott belépés (`#/sso?jegy=…&at=…&rt=…`, AWEBOLDAL TERV.md F21). */
const portalBelepes = ssoAdatok(window.location.hash)

/** Gates the whole app behind Supabase Auth - but only when Supabase is
 * actually configured (see .env.example). Until then this is a no-op
 * pass-through, so the existing single-tenant app keeps working exactly as
 * before for anyone who hasn't set up the SaaS layer yet. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AuthView>('login')
  const [passwordRecoveryHandled, setPasswordRecoveryHandled] = useState(false)
  const [ssoKesz, setSsoKesz] = useState(portalBelepes === null)

  if (!isSupabaseConfigured) return <>{children}</>
  if (!ssoKesz) return <SsoAtvetel onKesz={() => setSsoKesz(true)} />

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
  const { loading, session, profile, company, dataLoadError, reloadData, signOut, mfa } = useAuth()

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
    if (inviteToken) return <Register inviteToken={inviteToken} onSwitchToLogin={() => setView('login')} />
    if (view === 'register') return <Register onSwitchToLogin={() => setView('login')} />
    if (view === 'forgot-password') return <ForgotPassword onSwitchToLogin={() => setView('login')} />
    return <Login onSwitchToRegister={() => setView('register')} onSwitchToForgotPassword={() => setView('forgot-password')} />
  }

  // A kétlépcsős azonosítás kötelező: a kód (vagy első alkalommal a beállítás) nélkül semmi nem érhető el.
  if (mfa === 'kell-kod' || mfa === 'kell-beallitas') return <Ketlepcsos beallitas={mfa === 'kell-beallitas'} />

  if (dataLoadError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div role="alert" className="max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-text)] shadow-sm">
          <h1 className="mb-2 text-lg font-semibold">Az adatok most nem tölthetők be</h1>
          <p className="mb-4 text-[var(--color-text-muted)]">{dataLoadError}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void reloadData()} className="rounded-lg bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white">
              Újrapróbálás
            </button>
            <button type="button" onClick={() => void signOut()} className="rounded-lg bg-black/5 px-4 py-2.5 font-medium">
              Kijelentkezés
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!profile || !company) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center text-sm text-[var(--color-text-muted)]">
        A fiókod előkészítése folyamatban van - ha ez a képernyő sokáig nem tűnik el, jelentkezz be újra, vagy vedd fel a kapcsolatot az
        üzemeltetővel.
      </div>
    )
  }

  return <MunkamenetFigyelo>{children}</MunkamenetFigyelo>
}

/**
 * A portálról átadott munkamenet átvétele: csak kétlépcsős (aal2) Supabase-munkamenet és ennek a modulnak szóló,
 * érvényes jegy fogadható el. Utána a jegy és a tokenek eltűnnek a címsorból.
 */
function SsoAtvetel({ onKesz }: { onKesz: () => void }) {
  const [hiba, setHiba] = useState<string | null>(null)
  const elinditva = useRef(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (elinditva.current || !portalBelepes || !supabase) return
    elinditva.current = true
    const sb = supabase
    // A jegy és a tokenek eltűnnek a címsorból. Az útválasztón át, hogy a HashRouter is a kezdőoldalt lássa
    // (a közvetlen history.replaceState-et nem veszi észre, és üres oldal maradna).
    navigate('/', { replace: true })
    void (async () => {
      if (!portalBelepes.at || !portalBelepes.rt) {
        setHiba('A közös belépés a Készletkezelőbe a közös Supabase-projekttel működik. Addig lépj be a Készletkezelő saját belépésével.')
        return
      }
      const { data, error } = await sb.auth.setSession({ access_token: portalBelepes.at, refresh_token: portalBelepes.rt })
      if (error || !data.session) {
        setHiba('A belépés nem sikerült. Nyisd meg a Készletkezelőt újra a portálról.')
        return
      }
      const t = jegyTartalom(portalBelepes.jegy)
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
      const jegyGond = jegyHiba(t, data.session.user.email, Date.now())
      if (jegyGond || aal?.currentLevel !== 'aal2') {
        await sb.auth.signOut({ scope: 'local' })
        setHiba(jegyGond ?? 'A belépéshez kétlépcsős azonosítás szükséges.')
        return
      }
      kozosBelepesMentes(t!.tetlenseg_perc)
      belepesIdejeMentes(Date.now())
      onKesz()
    })()
  }, [onKesz, navigate])

  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-center text-sm">
      {hiba ? (
        <div role="alert" className="max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <p className="mb-4">{hiba}</p>
          <button type="button" onClick={onKesz} className="rounded-lg bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white">
            Tovább a belépéshez
          </button>
        </div>
      ) : (
        <span className="text-[var(--color-text-muted)]">Belépés a portálról…</span>
      )}
    </div>
  )
}

/**
 * Tétlenségi idő (alapból 30 perc; a raktárosnál a cég beállítása, közös belépésnél a jegyben kapott idő,
 * legfeljebb 12 óra) és a munkamenet 12 órás felső határa. Percenként azt is ellenőrzi, hogy a munkamenet a
 * szerveren él-e még: a portálon kijelentkezve (globális kijelentkeztetés) itt is kilép. Hálózati hiba nem
 * léptet ki (a raktáros munka közben, gyenge térerőnél is dolgozik).
 */
function MunkamenetFigyelo({ children }: { children: ReactNode }) {
  const { signOut, effectiveRole, company } = useAuth()
  const utolso = useRef(0)
  const perc = tetlensegPerc({ jegybol: kozosBelepes()?.perc ?? null, szerep: effectiveRole, cegRaktaros: company?.raktarosTetlensegPerc })

  useEffect(() => {
    const aktiv = () => {
      utolso.current = Date.now()
    }
    aktiv()
    const esemenyek = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const
    for (const e of esemenyek) window.addEventListener(e, aktiv, { passive: true })
    const ora = window.setInterval(() => {
      if (lejart({ utolsoAktivitasMs: utolso.current, belepesMs: belepesIdeje(), perc, mostMs: Date.now() })) void signOut()
    }, 30_000)
    const el = window.setInterval(() => {
      if (!supabase || !navigator.onLine) return
      void supabase.auth.getUser().then(({ error }) => {
        const status = (error as { status?: number } | null)?.status
        if (error && (status === 401 || status === 403)) void supabase!.auth.signOut({ scope: 'local' })
      })
    }, 60_000)
    return () => {
      for (const e of esemenyek) window.removeEventListener(e, aktiv)
      window.clearInterval(ora)
      window.clearInterval(el)
    }
  }, [perc, signOut])

  return <>{children}</>
}
