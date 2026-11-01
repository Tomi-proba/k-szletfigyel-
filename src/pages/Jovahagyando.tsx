// „Jóváhagyásra vár”: a Könyvelő számláiból jött mozgások és a visszáruk (TERV.md F15.4, F15.8).
// A raktáros többnyire telefonról dolgozik: nagy, egyértelmű gombok, egyszerű szavak („Beérkezett”,
// „Kevesebb jött”, „Nem érkezett meg”), egy koppintás a szokásos esetre. A készlet csak itt, a
// jóváhagyáskor változik; az eltérés a megjegyzéssel együtt eljut a Könyvelőbe (ott Teendő lesz).
//
// A gombok és kártyák a közös komponensekből vannak (src/kozos/kozos.css: .btn, .card, .badge), hogy
// a közös felületbe változtatás nélkül beköltözhessenek.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, MinusCircle, RefreshCw, XCircle } from 'lucide-react'
import { useStore, type ApproveIntegrationResult } from '../store/useStore'
import { useAuth } from '../hooks/useAuth'
import { jovahagyandoIntegracios, useIntegracioFrissites } from '../lib/integracio'
import { formatDate, formatNumber } from '../lib/format'
import type { Movement, Product } from '../types'
import { fajtaja, jovahagyhatja, SZOVEG } from '../lib/jovahagyando'
import { KonyveloForras } from '../components/KozosTeendok'

const HIBA: Record<Exclude<ApproveIntegrationResult, { ok: true }>['reason'], string> = {
  'not-found': 'Ez a tétel már nincs meg (közben törölték?). Frissítsd a listát.',
  'not-pending': 'Ezt a tételt közben már jóváhagyták vagy visszavonták.',
  'not-integration': 'Ezt a tételt a Mozgásnaplóban kell jóváhagyni.',
  'invalid-quantity': 'Adj meg 0-nál nagyobb mennyiséget. Ha semmi nem mozdult, a „Nem …” gombot használd.',
  'note-required': 'Írd be röviden, mi történt (vagy koppints egy okra).',
  'insufficient-stock': 'Nincs ennyi a raktárban.',
  'insufficient-lot': 'Az eredeti beszerzésből nincs ennyi a raktárban.',
}

type Panel = { id: string; mod: 'kevesebb' | 'nem' } | null

function Kartya({
  m,
  termek,
  telephely,
  vevo,
  lehet,
  panel,
  setPanel,
  onKesz,
}: {
  m: Movement
  termek: Product | undefined
  telephely: string | null
  vevo: string | null
  lehet: boolean
  panel: Panel
  setPanel: (p: Panel) => void
  onKesz: (uzenet: string) => void
}) {
  const approve = useStore((s) => s.approveIntegrationMovement)
  const reject = useStore((s) => s.rejectIntegrationMovement)
  const fajta = fajtaja(m)
  const t = SZOVEG[fajta]
  const egyseg = termek?.unit ?? 'db'
  const vart = m.orderedQuantity ?? m.quantity
  const nyitva = panel?.id === m.id ? panel.mod : null
  const [mennyiseg, setMennyiseg] = useState('')
  const [megjegyzes, setMegjegyzes] = useState('')
  const [hiba, setHiba] = useState<string | null>(null)
  const [keszletHiany, setKeszletHiany] = useState<number | null>(null)

  const nyit = (mod: 'kevesebb' | 'nem') => {
    setHiba(null)
    setKeszletHiany(null)
    setMegjegyzes('')
    setMennyiseg(mod === 'kevesebb' ? String(vart) : '')
    setPanel(nyitva === mod ? null : { id: m.id, mod })
  }

  const jovahagy = (actualQuantity?: number, note?: string, allowNegativeStock = false) => {
    const r = approve(m.id, { actualQuantity, note }, { allowNegativeStock })
    if (r.ok) {
      setPanel(null)
      onKesz(`Rendben: ${termek?.name ?? 'tétel'} – ${formatNumber(actualQuantity ?? m.quantity)} ${egyseg} ${t.kesz}.`)
      return
    }
    if (r.reason === 'insufficient-stock') {
      setKeszletHiany(r.resultingStock ?? null)
      setHiba(`${HIBA[r.reason]} A rendszer szerint a készlet ${formatNumber(r.resultingStock ?? 0)} ${egyseg} lenne. Számold meg a polcot.`)
      return
    }
    if (r.reason === 'insufficient-lot') {
      setHiba(`${HIBA[r.reason]} Ebből a beszerzésből már csak ${formatNumber(r.available ?? 0)} ${egyseg} maradt; másik tételből a program nem küld vissza.`)
      return
    }
    setHiba(HIBA[r.reason])
  }

  const kevesebbRogzites = () => {
    const q = Number(mennyiseg.replace(',', '.'))
    if (!Number.isFinite(q) || q <= 0) return setHiba(HIBA['invalid-quantity'])
    if (q >= vart) return setHiba(`Ez nem kevesebb a vártnál (${formatNumber(vart)} ${egyseg}). Ha minden megvan, nyomd meg: „${t.rendben}”.`)
    if (!megjegyzes.trim()) return setHiba(HIBA['note-required'])
    jovahagy(q, megjegyzes)
  }

  const nemRogzites = () => {
    if (!megjegyzes.trim()) return setHiba(HIBA['note-required'])
    const r = reject(m.id, megjegyzes)
    if (r.ok) {
      setPanel(null)
      onKesz(`Rögzítve: ${termek?.name ?? 'tétel'} – ${t.nem.toLowerCase()}.`)
    } else setHiba(r.reason === 'reason-required' ? HIBA['note-required'] : HIBA[r.reason])
  }

  const forras = m.integracioForras ? `Könyvelő, ${m.integracioForras}` : m.returnOfMovementId ? 'Visszáru' : 'Könyvelő'
  const okok = nyitva === 'nem' ? t.nemOkok : t.okok

  return (
    <li className="card kozos flex flex-col gap-3" aria-labelledby={`cim-${m.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`cim-${m.id}`} className="text-lg font-semibold leading-snug break-words">
            {termek?.name ?? 'Törölt termék'}
          </h3>
          <p className="muted text-sm">
            {m.integracioForras ? <KonyveloForras forras={forras} utvonal={m.integracioForrasUtvonal} /> : forras} · {formatDate(m.date)}
            {telephely ? ` · ${telephely}` : ''}
          </p>
        </div>
        <span className="badge badge-warning">{t.cim}</span>
      </div>

      <p className="text-3xl font-bold tabular-nums" aria-label={`Várt mennyiség: ${formatNumber(vart)} ${egyseg}`}>
        {formatNumber(vart)} <span className="text-xl font-semibold">{egyseg}</span>
      </p>
      {(vevo || m.note) && (
        <p className="muted text-sm break-words">
          {vevo ? `Vevő: ${vevo}` : ''}
          {vevo && m.note ? ' · ' : ''}
          {m.note}
        </p>
      )}

      {!lehet ? (
        <p className="alert text-sm">{m.type === 'in' ? 'Ezt a raktár hagyja jóvá.' : 'Ezt az iroda hagyja jóvá.'}</p>
      ) : (
        <>
          <button type="button" className="btn btn-success btn-big btn-block" onClick={() => jovahagy()}>
            <CheckCircle2 size={22} aria-hidden="true" /> {t.rendben}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn" aria-expanded={nyitva === 'kevesebb'} aria-controls={`panel-${m.id}`} onClick={() => nyit('kevesebb')}>
              <MinusCircle size={18} aria-hidden="true" /> {t.kevesebb}
            </button>
            <button type="button" className="btn btn-danger" aria-expanded={nyitva === 'nem'} aria-controls={`panel-${m.id}`} onClick={() => nyit('nem')}>
              <XCircle size={18} aria-hidden="true" /> {t.nem}
            </button>
          </div>
        </>
      )}

      {lehet && nyitva && (
        <div id={`panel-${m.id}`} className="card card-muted flex flex-col gap-3">
          {nyitva === 'kevesebb' && (
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t.kevesebbKerdes}</span>
              <span className="flex items-center gap-2">
                <input
                  className="w-32 rounded-lg border border-[var(--szin-keret)] bg-[var(--szin-hatter)] px-3 py-3 text-2xl font-semibold tabular-nums"
                  inputMode="decimal"
                  autoFocus
                  value={mennyiseg}
                  onChange={(e) => setMennyiseg(e.target.value)}
                  aria-describedby={`vart-${m.id}`}
                />
                <span className="text-lg">{egyseg}</span>
              </span>
              <span id={`vart-${m.id}`} className="muted text-sm">
                {m.integracioEsemenyId ? 'A számlán' : 'Várt mennyiség'}: {formatNumber(vart)} {egyseg}
              </span>
            </label>
          )}
          <div className="flex flex-col gap-1">
            <span className="font-medium">{nyitva === 'kevesebb' ? 'Mi történt?' : 'Miért?'}</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Gyakori okok">
              {okok.map((ok) => (
                <button key={ok} type="button" className="chip" aria-pressed={megjegyzes === ok} onClick={() => setMegjegyzes(ok)}>
                  {ok}
                </button>
              ))}
            </div>
            <textarea
              className="mt-1 w-full rounded-lg border border-[var(--szin-keret)] bg-[var(--szin-hatter)] px-3 py-2"
              rows={2}
              placeholder="Vagy írd be röviden…"
              value={megjegyzes}
              onChange={(e) => setMegjegyzes(e.target.value)}
              aria-label="Megjegyzés"
            />
          </div>
          {hiba && (
            <p className="alert alert-danger text-sm" role="alert">
              {hiba}
            </p>
          )}
          {keszletHiany !== null && nyitva === 'kevesebb' && (
            <button type="button" className="btn btn-danger" onClick={() => jovahagy(Number(mennyiseg.replace(',', '.')), megjegyzes, true)}>
              Megszámoltam, mégis kiadom
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn" onClick={() => setPanel(null)}>
              Mégse
            </button>
            <button type="button" className="btn btn-primary" onClick={nyitva === 'kevesebb' ? kevesebbRogzites : nemRogzites}>
              Rögzítem
            </button>
          </div>
        </div>
      )}

      {!nyitva && hiba && (
        <div className="flex flex-col gap-2">
          <p className="alert alert-danger text-sm" role="alert">
            {hiba}
          </p>
          {keszletHiany !== null && (
            <button type="button" className="btn btn-danger" onClick={() => jovahagy(undefined, undefined, true)}>
              Megszámoltam, mégis kiadom
            </button>
          )}
        </div>
      )}
    </li>
  )
}

export function Jovahagyando() {
  const movements = useStore((s) => s.movements)
  const products = useStore((s) => s.products)
  const locations = useStore((s) => s.locations)
  const customers = useStore((s) => s.customers)
  const dataMode = useStore((s) => s.dataMode)
  const { isWarehouseUser, isReadOnlyViewer, effectiveRole } = useAuth()
  const { remote, utolso, hiba, fut, frissit } = useIntegracioFrissites()
  const [panel, setPanel] = useState<Panel>(null)
  const [uzenet, setUzenet] = useState<string | null>(null)

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers])
  const lista = useMemo(
    () => movements.filter(jovahagyandoIntegracios).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.localeCompare(b.createdAt))),
    [movements],
  )
  const szerep = {
    raktaros: isWarehouseUser,
    iroda: effectiveRole === 'fo_iroda' || effectiveRole === 'iroda',
    csakOlvas: isReadOnlyViewer,
    helyi: dataMode !== 'remote' || !effectiveRole,
  }
  const csoportok: Array<{ cim: string; elemek: Movement[] }> = [
    { cim: 'Beérkező áru', elemek: lista.filter((m) => fajtaja(m) === 'beerkezes') },
    { cim: 'Kiadandó áru', elemek: lista.filter((m) => fajtaja(m) === 'kiadas') },
    { cim: 'Visszáru', elemek: lista.filter((m) => fajtaja(m) === 'visszavetel' || fajtaja(m) === 'visszakuldes') },
  ].filter((g) => g.elemek.length)

  return (
    // Alul hely a lebegő „+” gombnak, hogy az utolsó kártya gombjait ne takarja (telefonon).
    <div className="kozos mx-auto max-w-3xl pb-28">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Jóváhagyásra vár</h1>
          <p className="muted mt-1 text-sm">A Könyvelő számláiból jött áru és a visszáruk. Azt hagyd jóvá, ami ténylegesen beérkezett vagy kiment.</p>
        </div>
        {remote && (
          <button type="button" className="btn btn-small" onClick={() => void frissit()} disabled={fut} aria-label="Lista frissítése">
            <RefreshCw size={16} aria-hidden="true" className={fut ? 'animate-spin' : ''} /> Frissítés
          </button>
        )}
      </div>

      <div aria-live="polite" className="mb-3 flex flex-col gap-2">
        {uzenet && (
          <p className="alert alert-success flex items-center justify-between gap-2" role="status">
            <span>{uzenet}</span>
            <button type="button" className="btn btn-small" onClick={() => setUzenet(null)} aria-label="Üzenet bezárása">
              OK
            </button>
          </p>
        )}
        {hiba && <p className="alert alert-warning text-sm">{hiba}</p>}
      </div>

      {csoportok.length === 0 ? (
        <div className="card card-muted text-center">
          <p className="font-medium">Most nincs jóváhagyásra váró tétel.</p>
          <p className="muted mt-1 text-sm">
            {remote ? 'Az új tételek maguktól megjelennek (percenként frissül).' : 'A Könyvelőből jövő tételek csak szerveres módban (bejelentkezve) jelennek meg.'}{' '}
            <Link to="/mozgasnaplo" className="underline">
              Mozgásnapló
            </Link>
          </p>
        </div>
      ) : (
        csoportok.map((g) => (
          <section key={g.cim} className="mb-6" aria-label={g.cim}>
            <h2 className="mb-2 text-base font-semibold">
              {g.cim} <span className="badge">{g.elemek.length}</span>
            </h2>
            <ul className="flex flex-col gap-3">
              {g.elemek.map((m) => (
                <Kartya
                  key={m.id}
                  m={m}
                  termek={productById.get(m.productId)}
                  telephely={locations.length > 1 ? (locationById.get(m.locationId) ?? null) : null}
                  vevo={m.customerId ? (customerById.get(m.customerId) ?? null) : null}
                  lehet={jovahagyhatja(m, szerep)}
                  panel={panel}
                  setPanel={setPanel}
                  onKesz={setUzenet}
                />
              ))}
            </ul>
          </section>
        ))
      )}
      {remote && utolso && <p className="muted text-center text-xs">Frissítve: {utolso.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}</p>}
    </div>
  )
}
