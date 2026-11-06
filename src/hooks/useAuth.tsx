// Auth/company/subscription state for the SaaS réteg - a React context so
// AuthGate, Layout, Subscription and Admin can all read the same session
// without prop-drilling. Talks to Supabase Auth (session) plus the
// companies/profiles tables (see supabase/schema.sql) for the tenant and
// subscription state layered on top.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, keretTokenForras, kivalasztottCegBeallitas, portalTagsagIgazitas, portalTagsagOnalloIgazitas, supabase, tokenTartalom } from '../lib/supabase'
import { computeIsReadOnly } from '../lib/subscription'
import { mapProfileRow, mapTagsagRow, type CegTagsag, type Company, type Profile, type UserRole } from '../types/auth'
import { fetchBusinessData } from '../lib/remoteSync'
import { mentesiSor } from '../lib/mentes'
import { allapotUzenet } from '../lib/mentesiSor'
import { hydrateFromRemote, resetToLocalMode, useStore } from '../store/useStore'
import { belepesIdeje, belepesIdejeMentes, kozosBelepes, kozosBelepesTorles, mfaAllapot, type MfaAllapot } from '../lib/kozosBelepes'
import { PORTAL_URL } from '../lib/arak'

/** TEMP DEMO HOOK - a Supabase nélküli, ideiglenes szerepkör-szimulációhoz
 * (két böngészőfül, ugyanaz a localStorage, más-más "?demo_szerepkor="
 * paraméter), amíg nincs élesben Supabase-projekt bekötve a teszteléshez.
 * Szándékosan CSAK akkor él, ha `isSupabaseConfigured` false - így valódi
 * Supabase-bejelentkezés mellett semmilyen hatása nincs, és sosem gyengíti
 * a valódi (RLS-alapú) jogosultság-ellenőrzést. Törölhető, ha már nincs rá
 * szükség - lásd DOCUMENTATION.md 17. fejezet. */
function readDemoRole(): UserRole | null {
  if (isSupabaseConfigured || typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('demo_szerepkor')
  return value === 'raktaros' || value === 'iroda' || value === 'fo_iroda' || value === 'tulajdonos' ? value : null
}

const CEG_KULCS = 'keszlet.kivalasztottCeg'
function taroltCeg(): string | null {
  try {
    return localStorage.getItem(CEG_KULCS)
  } catch {
    return null
  }
}
function cegTarolasa(cegId: string) {
  try {
    localStorage.setItem(CEG_KULCS, cegId)
  } catch {
    // privát mód: nincs mentés
  }
}

interface AuthResult {
  error: string | null
}

interface AuthContextValue {
  loading: boolean
  session: Session | null
  /** A kétlépcsős azonosítás állapota (kötelező): 'ok' csak aal2 munkamenetnél; addig semmilyen adat nem töltődik be. */
  mfa: MfaAllapot | null
  /** A kétlépcsős állapot újraellenőrzése (a kód megadása után). */
  mfaUjraellenorzes: () => Promise<void>
  /** A felhasználó a kiválasztott cégben (szerepkör, raktárosnál telephely). */
  profile: Profile | null
  /** A kiválasztott cég. */
  company: Company | null
  /** A felhasználó összes cége (a cégválasztóhoz); üres, ha még egyetlen cégnek sem tagja. */
  tagsagok: CegTagsag[]
  /** Igaz, ha a felhasználó be van lépve, de még egyetlen Készlet-cégnek sem tagja. */
  nincsCeg: boolean
  /** Igaz, amíg egy cégváltás betölti az új cég adatait. */
  cegValtasFolyamatban: boolean
  /** Váltás egy másik cégre: előbb a függő mentések mennek el, utána az új cég adatai töltődnek be. */
  cegValasztas: (cegId: string) => Promise<AuthResult>
  /** Új Készlet-cég a bejelentkezett felhasználónak (ő lesz a fő irodája); a keretből a portál cégével. */
  ujCeg: (nev: string, portalCegId?: string | null) => Promise<AuthResult & { cegId?: string }>
  /**
   * A közös keretben a keret cégválasztója dönt: a portál cégéhez rendelt Készlet-céget kell mutatni. Ha a
   * felhasználónak ilyen cége nincs, `nincsCeg` igaz (a keretben az összerendelés vagy új cég következik).
   */
  portalCegBeallitas: (portalCegId: string) => Promise<void>
  /** A kiválasztott Készlet-cég összerendelése a portál cégével (fő iroda vagy tulajdonos). */
  portalOsszerendeles: (cegId: string, portalCegId: string) => Promise<AuthResult>
  isReadOnly: boolean
  /** True once profile.role === 'raktaros' (or, temporarily, the
   * `?demo_szerepkor=raktaros` override - see readDemoRole above) - the
   * restricted, single-location warehouse view. See DOCUMENTATION.md 14.
   * fejezet for what this does and doesn't restrict. */
  isWarehouseUser: boolean
  /** profile?.role when Supabase is configured, the `?demo_szerepkor=`
   * override otherwise, null if neither applies. RoleGate reads this so
   * the same demo override also gates full pages, not just isWarehouseUser
   * checks inside them. */
  effectiveRole: UserRole | null
  /** True for 'fo_iroda', and also true with no Supabase/role concept at
   * all (local/demo mode) - full, IMMEDIATE write access to the shared
   * törzsadat (telephely/termék). 'iroda' is NOT this - its writes go
   * through requestChange/pending_changes instead (see store/useStore.ts).
   * 'tulajdonos' and 'raktaros' (outside its own location) are never this. */
  canWriteDirectly: boolean
  /** 'tulajdonos' - lát mindent, de SEMMIT nem írhat, még jóváhagyásra váró
   * kérést sem adhat be. Kizárólag UI-kényelem (gombok elrejtése) - a
   * valódi, megkerülhetetlen határ a Supabase RLS (nincs INSERT/UPDATE
   * policy tulajdonosnak semmilyen táblán). */
  isReadOnlyViewer: boolean
  /** Igaz, ha ez a szerepkör jóváhagyhatja/elutasíthatja a raktáros
   * bejelentéseit (movements.approval_status) - 2026-11-02-től csak a fő
   * iroda (helyi módban az egyetlen felhasználó). Iroda, tulajdonos és
   * raktáros nem. */
  canApproveWarehouseRequests: boolean
  /** companyName is only used for a brand-new company (no inviteToken).
   * When inviteToken is set, the account joins that invite's existing
   * company/role/location instead - see handle_new_user() in schema.sql. */
  signUp: (email: string, password: string, name: string, companyName: string, inviteToken?: string) => Promise<AuthResult>
  signIn: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<AuthResult>
  updatePassword: (newPassword: string) => Promise<AuthResult>
  /** A profiles.name mező utólagos beállítása/javítása - a
   * public.update_my_name(...) security definer SQL function hívásán
   * keresztül, mert a profiles táblán nincs általános UPDATE policy (lásd
   * schema.sql). Sikeres hívás után frissíti a helyi `profile` state-et is,
   * hogy az audit napló rögzítésénél (store/useStore.ts setAuditActor) is
   * azonnal az új név legyen érvényben, kijelentkezés/újratöltés nélkül. */
  updateMyName: (name: string) => Promise<AuthResult>
  /** Fő iroda módosítja egy MÁSIK, saját cégéhez tartozó csapattag nevét
   * (lásd pages/Team.tsx) - a public.update_member_name(...) függvényen
   * keresztül, ami szerver oldalon is ellenőrzi, hogy a hívó fő iroda-e és
   * a célfelhasználó a saját cégéhez tartozik-e (lásd schema.sql). Nem
   * frissíti a helyi `profile` state-et (az a hívó saját profilja, nem a
   * módosított felhasználóé) - a Team.tsx oldal saját `reload()`-ja
   * tölti újra a csapatlistát a sikeres hívás után. */
  updateMemberName: (memberId: string, name: string) => Promise<AuthResult>
  refreshCompany: () => Promise<void>
  /** Ha a szerveradatok betöltése nem sikerült (pl. nincs internet), itt az érthető ok; ilyenkor a
   * program NEM indul üres adattal, hanem hibaképernyőt mutat (lásd AuthGate). */
  dataLoadError: string | null
  /** Az adatok újratöltése a szerverről (betöltési hiba után, vagy egy elakadt mentés lezárása után). */
  reloadData: () => Promise<void>
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
  const [tagsagok, setTagsagok] = useState<CegTagsag[]>([])
  const [nincsCeg, setNincsCeg] = useState(false)
  const [cegValtasFolyamatban, setCegValtasFolyamatban] = useState(false)
  const portalCeg = useRef<string | null>(null)
  const cegBetolteseRef = useRef<(t: CegTagsag, p: Record<string, unknown>) => Promise<void>>(async () => {})
  const profilSor = useRef<Record<string, unknown> | null>(null)
  const [dataLoadError, setDataLoadError] = useState<string | null>(null)
  const [mfa, setMfa] = useState<MfaAllapot | null>(null)

  const loadProfileAndCompany = useCallback(async (userId: string) => {
    if (!supabase) return
    // Kétlépcsős azonosítás nélkül (aal1) semmilyen adatot nem töltünk be: előbb a kód, illetve első
    // alkalommal a beállítás (lásd pages/auth/Ketlepcsos.tsx). AWEBOLDAL TERV.md F21.
    // A keretben a keret munkamenetének tokenje mondja meg (a portál csak kétlépcsős belépés után ad tokent).
    const keretTok = keretTokenForras()
    const aal = keretTok
      ? { currentLevel: tokenTartalom((await keretTok()) ?? '')?.aal ?? null, nextLevel: 'aal2' }
      : (await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).data
    const allapot = mfaAllapot({ currentLevel: aal?.currentLevel ?? null, nextLevel: aal?.nextLevel ?? null })
    setMfa(allapot)
    if (allapot !== 'ok') return
    if (belepesIdeje() === null) belepesIdejeMentes(Date.now())
    const { data: profileRow } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (!profileRow) {
      // Élő session, de nincs hozzá profil (pl. a felhasználót törölték az
      // Auth > Users listából, de a böngésző még a régi, gyorsítótárazott
      // bejelentkezést őrzi) - enélkül a kijelentkeztetés nélkül az
      // AuthGate örökre a "fiókod előkészítése" képernyőn ragadna, hiszen
      // `profile` sosem töltődne be. A kijelentkezés újra előhozza a
      // bejelentkező/regisztrációs képernyőt.
      // A keretben nincs saját munkamenet, amiből ki lehetne lépni: érthető hibaüzenet.
      if (keretTok) {
        setDataLoadError('A felhasználói profil nem tölthető be. Lépj be újra a portálon.')
        return
      }
      await supabase.auth.signOut()
      return
    }
    profilSor.current = profileRow
    // A keretben a portál az egyetlen hely (F25): a kiválasztott portál-cégben a tagság a portál szerint igazodik.
    if (keretTok && portalCeg.current) await portalTagsagIgazitas()
    // Önálló belépéskor is a portálhoz igazodik a szerep (F26), nem csak a portál jelzéséből.
    else if (!keretTok) await portalTagsagOnalloIgazitas()
    // A felhasználó cégei (AWEBOLDAL TERV.md F24 KS4): a cégválasztóhoz mindet látja, az adatokat csak a
    // kiválasztott cégben (az x-keszlet-ceg fejléc szerint, lásd lib/supabase.ts).
    const { data: tagSorok, error: tagHiba } = await supabase
      .from('company_members')
      .select('role, assigned_location_id, assigned_location_name, companies(*)')
      .eq('user_id', userId)
    if (tagHiba) {
      setDataLoadError('Nem sikerült betölteni a cégeidet a szerverről. Ellenőrizd az internetkapcsolatot, majd próbáld újra.')
      return
    }
    const lista = (tagSorok ?? []).map((r) => mapTagsagRow(r as Record<string, unknown>)).sort((a, b) => a.company.name.localeCompare(b.company.name, 'hu'))
    setTagsagok(lista)
    const valasztott = portalCeg.current
      ? lista.find((t) => t.company.portalCompanyId === portalCeg.current)
      : (lista.find((t) => t.company.id === taroltCeg()) ?? lista[0])
    if (!valasztott) {
      setNincsCeg(true)
      setProfile(null)
      setCompany(null)
      kivalasztottCegBeallitas(null)
      return
    }
    setNincsCeg(false)
    await cegBetolteseRef.current(valasztott, profileRow)
  }, [])

  /** A kiválasztott cég adatainak betöltése (bejelentkezéskor és cégváltáskor). */
  const cegBetoltese = useCallback(async (tagsag: CegTagsag, profileRow: Record<string, unknown>) => {
    const mappedProfile = mapProfileRow(profileRow, tagsag)
    kivalasztottCegBeallitas(tagsag.company.id)
    cegTarolasa(tagsag.company.id)
    setProfile(mappedProfile)
    setCompany(tagsag.company)

    // Switches the store from the local/demo data every fresh browser starts
    // with over to this company's shared, Supabase-backed data (see
    // store/useStore.ts hydrateFromRemote + lib/remoteSync.ts).
    setDataLoadError(null)
    // Egy korábbi munkamenetből (pl. internetkimaradás alatt) megmaradt mentések előbb mennek el,
    // hogy a betöltött adat már tartalmazza őket. A mentési sor cégenként külön van.
    mentesiSor.betolt(mappedProfile.companyId)
    const sorAllapot = await mentesiSor.kiurulesig()
    if (sorAllapot.fajta === 'ujraprobalas') {
      setDataLoadError(allapotUzenet(sorAllapot))
      return
    }

    try {
      const slices = await fetchBusinessData(mappedProfile.companyId, { naplot: mappedProfile.role !== 'raktaros' })
      hydrateFromRemote(mappedProfile.companyId, mappedProfile.id, mappedProfile.email, mappedProfile.name, slices, mappedProfile.role)
    } catch (err) {
      console.error('[useAuth] failed to load business data from Supabase', err)
      setDataLoadError(
        'Nem sikerült betölteni az adatokat a szerverről. Ellenőrizd az internetkapcsolatot, majd próbáld újra. Az adataid a szerveren biztonságban vannak.',
      )
      return
    }
    // Az esedékessé vált ismétlődő napló-tételeket az irodai felhasználó gépe rögzíti (a raktárosnak
    // nincs joga a naplóhoz). Ha két gép egyszerre tenné, a második mentése ütközésként elakad, és
    // nem jön létre kétszer ugyanaz a tétel.
    if (mappedProfile.role === 'fo_iroda' || mappedProfile.role === 'iroda') {
      useStore.getState().generateDueRecurringLedgerEntries()
    }
  }, [])
  cegBetolteseRef.current = cegBetoltese

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let cancelled = false

    const keretTok = keretTokenForras()
    if (keretTok) {
      // A közös keretben (F24 KS3): a felhasználó a keret munkamenetének tokenjéből; saját belépés nincs.
      void (async () => {
        const t = tokenTartalom((await keretTok()) ?? '')
        if (cancelled) return
        if (t) {
          setSession({ user: { id: t.sub, email: t.email ?? undefined } } as unknown as Session)
          await loadProfileAndCompany(t.sub)
        }
        setLoading(false)
      })()
      return () => {
        cancelled = true
      }
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      setSession(data.session)
      if (data.session) await loadProfileAndCompany(data.session.user.id)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      setSession(newSession)
      // Az óránkénti tokenmegújításkor nem töltjük újra az adatokat: az egy folyamatban lévő mentés
      // közben a felületet régebbi adatra cserélhetné.
      if (event === 'TOKEN_REFRESHED') return
      if (newSession) {
        await loadProfileAndCompany(newSession.user.id)
      } else {
        setProfile(null)
        setCompany(null)
        setTagsagok([])
        setNincsCeg(false)
        kivalasztottCegBeallitas(null)
        setMfa(null)
        kozosBelepesTorles()
        setDataLoadError(null)
        mentesiSor.leallit()
        resetToLocalMode()
      }
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [loadProfileAndCompany])

  const signUp = useCallback(async (email: string, password: string, name: string, companyName: string, inviteToken?: string): Promise<AuthResult> => {
    if (!supabase) return { error: 'A Supabase nincs beállítva.' }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: inviteToken ? { invite_token: inviteToken, name: name.trim() } : { company_name: companyName.trim(), name: name.trim() } },
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
    // Közös belépésnél a kijelentkezés mindenhonnan szól (a frissítő tokenek visszavonva), és a portálon
    // folytatódik: onnan a többi modul is kilépési jelzést kap.
    const kozos = kozosBelepes() !== null
    await supabase.auth.signOut({ scope: kozos ? 'global' : 'local' })
    kozosBelepesTorles()
    if (kozos) window.location.assign(`${PORTAL_URL}/kilepes`)
  }, [])

  const mfaUjraellenorzes = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.auth.getSession()
    if (data.session) await loadProfileAndCompany(data.session.user.id)
  }, [loadProfileAndCompany])

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

  const updateMyName = useCallback(async (name: string): Promise<AuthResult> => {
    if (!supabase) return { error: 'A Supabase nincs beállítva.' }
    if (!name.trim()) return { error: 'A név nem lehet üres.' }
    const { error } = await supabase.rpc('update_my_name', { new_name: name.trim() })
    if (error) return { error: error.message }
    // A profiles-on nincs UPDATE policy (lásd schema.sql), ezért a helyi
    // `profile` state-et a sima rpc-válaszból nem tudjuk frissíteni -
    // ehelyett újratöltjük (ez a setAuditActor-t is frissen hívja).
    await refreshCompany()
    return { error: null }
  }, [refreshCompany])

  const updateMemberName = useCallback(async (memberId: string, name: string): Promise<AuthResult> => {
    if (!supabase) return { error: 'A Supabase nincs beállítva.' }
    if (!name.trim()) return { error: 'A név nem lehet üres.' }
    const { error } = await supabase.rpc('update_member_name', { member_id: memberId, new_name: name.trim() })
    return { error: error ? error.message : null }
  }, [])

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

  const cegValasztas = useCallback(
    async (cegId: string): Promise<AuthResult> => {
      if (cegId === company?.id) return { error: null }
      const t = tagsagok.find((x) => x.company.id === cegId)
      if (!t || !profilSor.current) return { error: 'Ennek a cégnek nem vagy tagja.' }
      // A függő mentések a jelenlegi céghez tartoznak: előbb azok mennek el, csak utána vált.
      const sor = await mentesiSor.kiurulesig()
      if (sor.fajta === 'ujraprobalas') return { error: `${allapotUzenet(sor)} A cég a mentés után váltható.` }
      setCegValtasFolyamatban(true)
      try {
        mentesiSor.leallit()
        resetToLocalMode()
        await cegBetoltese(t, profilSor.current)
      } finally {
        setCegValtasFolyamatban(false)
      }
      return { error: null }
    },
    [company?.id, tagsagok, cegBetoltese],
  )

  const ujCeg = useCallback(
    async (nev: string, portalCegId?: string | null): Promise<AuthResult & { cegId?: string }> => {
      if (!supabase || !session) return { error: 'Nincs bejelentkezve.' }
      if (!nev.trim()) return { error: 'A cégnév kötelező.' }
      const { data, error } = await supabase.rpc('ceg_letrehozasa', { p_nev: nev.trim(), p_portal_ceg: portalCegId ?? null })
      if (error) return { error: error.message }
      cegTarolasa(data as string)
      await loadProfileAndCompany(session.user.id)
      return { error: null, cegId: data as string }
    },
    [session, loadProfileAndCompany],
  )

  const portalCegBeallitas = useCallback(
    async (portalCegId: string) => {
      if (portalCeg.current === portalCegId) return
      portalCeg.current = portalCegId
      if (!session) return
      const t = tagsagok.find((x) => x.company.portalCompanyId === portalCegId)
      // A keretben cégváltáskor is a portál szerint igazítunk (F25): ha a tagság változott, teljes újratöltés.
      const igazitas = keretTokenForras() ? await portalTagsagIgazitas() : null
      if (t && profilSor.current && (igazitas === null || igazitas === 'mar-felhasznalt')) {
        await cegValasztas(t.company.id)
        return
      }
      // Ehhez a portál-céghez nincs (betöltött) Készlet-cég: újratöltés (a tagságok is), utána dönt.
      const sor = await mentesiSor.kiurulesig()
      if (sor.fajta === 'ujraprobalas') return
      mentesiSor.leallit()
      resetToLocalMode()
      await loadProfileAndCompany(session.user.id)
    },
    [session, tagsagok, cegValasztas, loadProfileAndCompany],
  )

  const portalOsszerendeles = useCallback(
    async (cegId: string, portalCegId: string): Promise<AuthResult> => {
      if (!supabase || !session) return { error: 'Nincs bejelentkezve.' }
      // Az összerendelés a kiválasztott cégre vonatkozik (x-keszlet-ceg): erre a cégre váltunk a hívás idejére.
      kivalasztottCegBeallitas(cegId)
      const { error } = await supabase.rpc('ceg_portal_osszerendeles', { p_portal_ceg: portalCegId })
      if (error) return { error: error.message }
      await loadProfileAndCompany(session.user.id)
      return { error: null }
    },
    [session, loadProfileAndCompany],
  )

  const reloadData = useCallback(async () => {
    if (session) await loadProfileAndCompany(session.user.id)
  }, [session, loadProfileAndCompany])

  const isReadOnly = useMemo(() => computeIsReadOnly(company), [company])
  const effectiveRole: UserRole | null = profile?.role ?? readDemoRole()
  const isWarehouseUser = effectiveRole === 'raktaros'
  const canWriteDirectly = !effectiveRole || effectiveRole === 'fo_iroda'
  const isReadOnlyViewer = effectiveRole === 'tulajdonos'
  // 2026-11-02-től a raktár bejelentéseit csak a fő iroda fogadhatja el (DOCUMENTATION.md 31. fejezet).
  const canApproveWarehouseRequests = !effectiveRole || effectiveRole === 'fo_iroda'

  const value: AuthContextValue = {
    loading,
    session,
    mfa,
    mfaUjraellenorzes,
    profile,
    company,
    tagsagok,
    nincsCeg,
    cegValtasFolyamatban,
    cegValasztas,
    ujCeg,
    portalCegBeallitas,
    portalOsszerendeles,
    isReadOnly,
    isWarehouseUser,
    effectiveRole,
    canWriteDirectly,
    isReadOnlyViewer,
    canApproveWarehouseRequests,
    signUp,
    signIn,
    signOut,
    requestPasswordReset,
    updatePassword,
    updateMyName,
    updateMemberName,
    refreshCompany,
    dataLoadError,
    reloadData,
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
