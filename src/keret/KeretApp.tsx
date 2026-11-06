// A Készletkezelő a közös keretben (AWEBOLDAL TERV.md F24 KS2–KS8). A keret adja a céget, az időszakot, a témát,
// a gyorsbillentyűket, az értesítéseket és a menüt; a Készlet saját oldalsávja, fejléce és kijelentkezése itt
// nem jelenik meg. A belépés a keret Supabase-munkamenete (a token a keretből jön, a Készlet nem tárol sajátot).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { keretBillentyu, useGyorsbillentyu, useGyorsbillentyuk, useKeret } from '@aweboldal/felulet'
import { ariaFelirat, feliratok } from '@aweboldal/modulok'
import { AuthProvider, useAuth } from '../hooks/useAuth'
import { useAlerts } from '../hooks/useAlerts'
import { useHydrated } from '../hooks/useHydrated'
import { keretJegyBeallitas, keretSupabaseBeallitas } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { Utvonalak } from '../Utvonalak'
import { MentesJelzo } from '../components/MentesJelzo'
import { LemezJelzo } from '../components/LemezJelzo'
import { Modal } from '../components/Modal'
import { MovementForm } from '../components/MovementForm'
import { keretModBeallitas, sajatUtvonal, ut } from './futas'
import { CSOPORTOK, aktivCsoport, csoportPontjai, keszletMenu } from './menu'
import { Link } from './router'

/** A modul képernyői a keretben: ezt adja a csomag `Kepernyok`-ként. */
export function KeretKepernyok({ alapUtvonal }: { alapUtvonal: string }) {
  const k = useKeret()
  keretModBeallitas(alapUtvonal)
  if (!k.supabaseToken) {
    return (
      <div className="keszlet-keret__uzenet" role="status" data-keszlet-nincs-supabase>
        A Készletkezelő a keretben a közös (Supabase) belépéssel működik. A portál most saját belépéssel fut, ezért a
        Készletkezelőt a saját címén nyisd meg.
      </div>
    )
  }
  keretSupabaseBeallitas(k.supabaseToken)
  keretJegyBeallitas(() => k.jegyKeres('keszlet'))
  return (
    <AuthProvider>
      <KeretKeszlet />
    </AuthProvider>
  )
}

function KeretKeszlet() {
  const k = useKeret()
  const hydrated = useHydrated()
  const { loading, profile, company, nincsCeg, cegValtasFolyamatban, dataLoadError, reloadData, portalCegBeallitas, mfa } = useAuth()

  // A keret cégválasztója dönt: a portál cégéhez rendelt Készlet-cég (cégváltáskor az új).
  useEffect(() => {
    void portalCegBeallitas(k.ceg.id)
  }, [k.ceg.id, portalCegBeallitas])

  if (!hydrated || loading || cegValtasFolyamatban) return <Uzenet>A Készletkezelő megnyitása…</Uzenet>
  if (mfa && mfa !== 'ok') return <Uzenet>A Készletkezelőhöz kétlépcsős belépés szükséges. Lépj be újra a portálon.</Uzenet>
  if (dataLoadError) {
    return (
      <div className="keszlet-keret__uzenet" role="alert" data-keszlet-hiba>
        {dataLoadError}{' '}
        <button type="button" className="rounded-lg border px-3 py-1" onClick={() => void reloadData()}>
          Újrapróbálás
        </button>
      </div>
    )
  }
  if (nincsCeg) return <KeretCegOsszerendeles />
  if (!profile || !company) return <Uzenet>A Készletkezelő megnyitása…</Uzenet>
  return <Utvonalak elrendezes={<KeretLayout />} />
}

function Uzenet({ children }: { children: React.ReactNode }) {
  return (
    <div className="keszlet-keret__uzenet" role="status">
      {children}
    </div>
  )
}

/**
 * A portál cégéhez még nincs Készlet-cég (F24 KS4). A portál-cég tulajdonosa újat hoz létre a portál
 * cégadataival, vagy egy meglévő Készlet-cégét rendeli össze (ahol fő iroda vagy tulajdonos); más üzenetet kap.
 */
function KeretCegOsszerendeles() {
  const k = useKeret()
  const { tagsagok, ujCeg, portalOsszerendeles } = useAuth()
  const valaszthato = tagsagok.filter((t) => !t.company.portalCompanyId && (t.role === 'fo_iroda' || t.role === 'tulajdonos'))
  const [valasztott, setValasztott] = useState(valaszthato[0]?.company.id ?? '')
  const [hiba, setHiba] = useState<string | null>(null)
  const [fut, setFut] = useState(false)
  const futtat = async (f: () => Promise<{ error: string | null }>) => {
    setHiba(null)
    setFut(true)
    const r = await f()
    setFut(false)
    if (r.error) setHiba(r.error)
    else k.ertesit(`A Készletkezelő-cég össze van rendelve: ${k.ceg.nev}.`, 'siker')
  }
  if (k.ceg.szerep !== 'tulajdonos' && valaszthato.length === 0) {
    return (
      <div className="keszlet-keret keszlet-keret--keskeny" data-keszlet-osszerendeles="nem-tulajdonos">
        <h1 className="mb-3 text-2xl font-bold">Készletkezelő</h1>
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-info-bg)] p-3" role="status">
          A(z) {k.ceg.nev} cégnek még nincs Készletkezelő-cége, vagy még nem vagy a tagja. Az első megnyitáskor a cég
          tulajdonosa hozza létre; a fő iroda a Csapat oldalon vehet fel.
        </p>
      </div>
    )
  }
  return (
    <div className="keszlet-keret keszlet-keret--keskeny" data-keszlet-osszerendeles>
      <h1 className="mb-2 text-2xl font-bold">Készletkezelő – a cég első megnyitása</h1>
      <p className="mb-4 text-[var(--color-text-muted)]">
        A(z) {k.ceg.nev} céghez még nem tartozik Készletkezelő-cég. Ezt csak egyszer kell megtenni; utána a cégváltó ezt a
        céget nyitja meg.
      </p>
      {hiba && (
        <p className="mb-3 rounded-lg bg-[var(--color-danger-bg)] p-2 text-[var(--color-danger)]" role="alert">
          {hiba}
        </p>
      )}
      {k.ceg.szerep === 'tulajdonos' && (
        <section className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h2 className="mb-2 text-lg font-semibold">Új Készletkezelő-cég a portál cégadataival</h2>
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">
            Cégnév: <strong>{k.ceg.nev}</strong>. Te leszel a fő irodája; egy alapértelmezett telephely is létrejön.
          </p>
          <button
            type="button"
            disabled={fut}
            onClick={() => void futtat(() => ujCeg(k.ceg.nev, k.ceg.id))}
            className="min-h-11 rounded-lg bg-[var(--color-primary)] px-4 py-2 font-semibold text-[var(--color-on-primary)] disabled:opacity-50"
          >
            Készletkezelő-cég létrehozása
          </button>
        </section>
      )}
      {valaszthato.length > 0 && (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h2 className="mb-2 text-lg font-semibold">Meglévő Készletkezelő-cég összerendelése</h2>
          <label className="mb-1 block text-sm" htmlFor="meglevo-keszlet-ceg">
            Készletkezelő-cég
          </label>
          <select
            id="meglevo-keszlet-ceg"
            value={valasztott}
            onChange={(e) => setValasztott(e.target.value)}
            className="mb-3 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2"
          >
            {valaszthato.map((t) => (
              <option key={t.company.id} value={t.company.id}>
                {t.company.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={fut || !valasztott}
            onClick={() => void futtat(() => portalOsszerendeles(valasztott, k.ceg.id))}
            className="min-h-11 rounded-lg border border-[var(--color-primary)] px-4 py-2 font-semibold text-[var(--color-primary)] disabled:opacity-50"
          >
            Összerendelés
          </button>
        </section>
      )}
    </div>
  )
}

/** A keretbeli elrendezés: a fejléc és a főmenü a kereté; itt a jelzők, az oldalon belüli fülsor és a „+” gomb. */
function KeretLayout() {
  const k = useKeret()
  const gy = useGyorsbillentyuk()
  const { profile, effectiveRole, isReadOnly, isReadOnlyViewer } = useAuth()
  const alerts = useAlerts()
  const pendingChanges = useStore((s) => s.pendingChanges)
  const dailyClosings = useStore((s) => s.dailyClosings)
  const [gyorsMozgas, setGyorsMozgas] = useState(false)
  const { pathname } = useLocation()
  const sajat = sajatUtvonal(pathname)
  const ujTetel = keretBillentyu('uj-tetel')
  const irhat = !isReadOnly && !isReadOnlyViewer
  useGyorsbillentyu(irhat ? ujTetel : undefined, () => setGyorsMozgas(true))

  const isFoIroda = effectiveRole === 'fo_iroda'
  const modositasiKerelmek = pendingChanges.filter((c) => c.status === 'pending').length
  const riasztasok =
    alerts.needsReorder.length +
    alerts.slowMoving.length +
    alerts.transferSuggestions.length +
    alerts.kintlevoseg.db +
    alerts.fizetendoRiaszt.db +
    alerts.openSales.length +
    alerts.jovahagyasraVar.length +
    (isFoIroda ? modositasiKerelmek : 0)
  const szamlalok = {
    jovahagyasraVar: alerts.jovahagyasraVar.length,
    modositasiKerelmek,
    napiZarasok: effectiveRole === 'raktaros' ? 0 : dailyClosings.filter((c) => c.status !== 'approved').length,
    riasztasok,
  }
  const menu = useMemo(
    () => keszletMenu(effectiveRole, szamlalok).map((p) => ({ ...p, utvonal: ut(p.utvonal), alutvonalak: p.alutvonalak?.map(ut) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveRole, szamlalok.jovahagyasraVar, szamlalok.modositasiKerelmek, szamlalok.napiZarasok, szamlalok.riasztasok],
  )
  // A második menüsor a kereté; a Készlet adja a pontjait (szerepkör, számlálók). Elhagyáskor a keret visszaáll.
  const menuBeallitas = useRef(k.modulMenuBeallitas)
  useEffect(() => {
    menuBeallitas.current?.(menu)
  }, [menu])
  useEffect(() => () => menuBeallitas.current?.(null), [])

  const csoport = aktivCsoport(sajat, effectiveRole)
  return (
    <div className="keszlet-keret" data-keszlet-keret data-szerep={profile?.role}>
      <MentesJelzo />
      <LemezJelzo />
      {isReadOnly && (
        <div className="mb-4 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger-bg)] p-3 text-sm text-[var(--color-danger)]" role="status">
          Az előfizetés lejárt vagy le lett mondva: a Készletkezelő most csak megtekintésre szolgál.
        </div>
      )}
      {csoport && (
        <nav className="keszlet-keret__fulek" aria-label={`${CSOPORTOK[csoport]!.cim} almenü`} data-keszlet-fulek={csoport}>
          {csoportPontjai(csoport, effectiveRole).map((p) => (
            <Link key={p.utvonal} to={p.utvonal} aria-current={sajat === p.utvonal ? 'page' : undefined}>
              {p.cim}
            </Link>
          ))}
        </nav>
      )}
      <Outlet />
      {irhat && sajat !== '/' && (
        <button
          type="button"
          onClick={() => setGyorsMozgas(true)}
          aria-label="Új mozgás rögzítése"
          title={`Új mozgás rögzítése – ${feliratok(ujTetel, gy.mac)}`}
          aria-keyshortcuts={ariaFelirat(ujTetel)}
          className="keszlet-keret__plusz fixed bottom-6 right-5 z-30 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-lg"
        >
          <Plus size={28} />
        </button>
      )}
      {gyorsMozgas && (
        <Modal title="Mozgás rögzítése" onClose={() => setGyorsMozgas(false)}>
          <MovementForm onDone={() => setGyorsMozgas(false)} />
        </Modal>
      )}
    </div>
  )
}
