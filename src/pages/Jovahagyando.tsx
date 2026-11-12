// „Jóváhagyásra vár”: minden olyan tétel, ami még nem érvényes (DOCUMENTATION.md 31. fejezet).
//
// Két lépés, két szerep:
// 1. a RAKTÁROS visszaigazolja, mi történt ténylegesen (az irodai rendelésnél, a Könyvelőből jött
//    tételnél és a vevői visszavételnél); a saját bejelentésénél ez maga a rögzítés;
// 2. a FŐ IRODA elfogadja (ekkor változik a készlet, a pénzügy és ekkor megy a Könyvelőbe) vagy
//    indoklással elutasítja. Az iroda és a tulajdonos a listát csak látja.
//
// A raktáros többnyire telefonról dolgozik: nagy, egyértelmű gombok, egyszerű szavak („Beérkezett”,
// „Kevesebb jött”, „Nem érkezett meg”), egy koppintás a szokásos esetre. A gombok és kártyák a közös
// komponensekből vannak (src/kozos/kozos.css: .btn, .card, .badge).
import { useMemo, useState } from 'react'
import { Link } from '../keret/router'
import { CheckCircle2, ChevronDown, ChevronUp, MinusCircle, Pencil, RefreshCw, XCircle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAuth } from '../hooks/useAuth'
import { useIntegracioFrissites } from '../lib/integracio'
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format'
import type { Movement, Product } from '../types'
import { bejelentesCimke, fajtaja, forrasa, SZOVEG } from '../lib/jovahagyando'
import { allapota, ALLAPOT_SZOVEG, teendoje, varakozo, type Szerep, type Teendo } from '../lib/raktariBejelentes'
import { KonyveloForras } from '../components/KozosTeendok'
import { ApprovePurchaseOrderModal } from '../components/ApprovePurchaseOrderModal'
import { ApproveSaleModal } from '../components/ApproveSaleModal'
import { ResubmitSaleModal } from '../components/ResubmitSaleModal'

const HIBA: Record<string, string> = {
  'not-found': 'Ez a tétel már nincs meg (közben törölték?). Frissítse a listát.',
  'not-pending': 'Ezt a tételt közben már elfogadták vagy visszavonták.',
  'already-confirmed': 'Ezt a tételt már visszaigazolták.',
  'invalid-quantity': 'Adjon meg 0-nál nagyobb mennyiséget. Ha semmi nem mozdult, a „Nem …” gombot használja.',
  'note-required': 'Írja be röviden, mi történt (vagy koppintson egy okra).',
  'reason-required': 'Írja be röviden, miért.',
  'insufficient-stock': 'Nincs ennyi szabad készlet.',
  'insufficient-lot': 'Az eredeti beszerzésből nincs ennyi a raktárban.',
  forbidden: 'Ezt csak a fő iroda fogadhatja el.',
  'not-integration': 'Ezt a tételt a megnyíló ablakban kell elfogadni.',
}

type Panel = { id: string; mod: 'kevesebb' | 'nem' } | null
type Ablak = { fajta: 'beszerzes' | 'kiadas' | 'javitas'; m: Movement } | null

function Kartya({
  m,
  termek,
  telephely,
  vevo,
  bekuldo,
  arLathato,
  teendo,
  panel,
  setPanel,
  setAblak,
  onKesz,
}: {
  m: Movement
  termek: Product | undefined
  telephely: string | null
  vevo: string | null
  /** Ki rögzítette (a naplóból; csak szerveres módban ismert). */
  bekuldo: string | null
  /** A raktáros árat nem lát (DOCUMENTATION.md 14. fejezet). */
  arLathato: boolean
  teendo: Teendo
  panel: Panel
  setPanel: (p: Panel) => void
  setAblak: (a: Ablak) => void
  onKesz: (uzenet: string) => void
}) {
  const confirm = useStore((s) => s.confirmByWarehouse)
  const approveIntegration = useStore((s) => s.approveIntegrationMovement)
  const approvePurchase = useStore((s) => s.approvePurchaseOrder)
  const reject = useStore((s) => s.rejectPendingMovement)
  const deleteMovement = useStore((s) => s.deleteMovement)
  const t = SZOVEG[fajtaja(m)]
  const egyseg = termek?.unit ?? 'db'
  const vart = m.orderedQuantity ?? m.quantity
  const raktarSzerint = m.raktarVisszaigazolva ? (m.raktarMennyiseg ?? m.quantity) : null
  const nyitva = panel?.id === m.id ? panel.mod : null
  const [mennyiseg, setMennyiseg] = useState('')
  const [megjegyzes, setMegjegyzes] = useState('')
  const [hiba, setHiba] = useState<string | null>(null)
  const [keszletHiany, setKeszletHiany] = useState(false)
  const [reszletek, setReszletek] = useState(false)
  const allapot = allapota(m)
  const cimke = bejelentesCimke(m)
  // A Könyvelőből jött és a visszáru-tételt itt, egy koppintással lehet elfogadni; az irodai rendelésnél
  // és a raktári bejelentésnél (ár, áfa, számla) egy ablak nyílik.
  const egyLepesben = Boolean(m.integracioEsemenyId || m.returnOfMovementId)
  const veglegesit = teendo === 'veglegesit'

  const nyit = (mod: 'kevesebb' | 'nem') => {
    setHiba(null)
    setKeszletHiany(false)
    setMegjegyzes(mod === 'nem' && veglegesit && raktarSzerint === 0 ? (m.raktarMegjegyzes ?? '') : '')
    setMennyiseg(mod === 'kevesebb' ? String(raktarSzerint || vart) : '')
    setPanel(nyitva === mod ? null : { id: m.id, mod })
  }

  const hibaKiir = (r: { reason: string; available?: number }) => {
    if (r.reason === 'insufficient-stock') {
      setKeszletHiany(true)
      setHiba(`${HIBA[r.reason]}${r.available !== undefined ? ` Szabad készlet: ${formatNumber(r.available)} ${egyseg}.` : ''} Számolja meg a polcot.`)
      return
    }
    setHiba(HIBA[r.reason] ?? 'Váratlan hiba történt.')
  }

  // 1. lépés: a raktár visszaigazolja, mi történt.
  const visszaigazol = (q: number, note?: string, allowNegativeStock = false) => {
    const r = confirm(m.id, { quantity: q, note }, { allowNegativeStock })
    if (r.ok) {
      setPanel(null)
      onKesz(`Elküldve a fő irodának: ${termek?.name ?? 'tétel'} – ${q === 0 ? t.nem.toLowerCase() : `${formatNumber(q)} ${egyseg} ${t.kesz}`}.`)
    } else hibaKiir(r)
  }

  // 2. lépés: a fő iroda elfogadja.
  const elfogad = (q?: number, note?: string, allowNegativeStock = false) => {
    if (!egyLepesben) {
      if (q !== undefined && m.type === 'in') {
        const r = approvePurchase(m.id, q, note)
        if (r.ok) {
          setPanel(null)
          onKesz(`Elfogadva: ${termek?.name ?? 'tétel'} – ${formatNumber(q)} ${egyseg}.`)
        } else hibaKiir(r)
        return
      }
      setAblak({ fajta: m.type === 'in' ? 'beszerzes' : 'kiadas', m })
      return
    }
    const r = approveIntegration(m.id, { actualQuantity: q, note }, { allowNegativeStock })
    if (r.ok) {
      setPanel(null)
      onKesz(`Elfogadva: ${termek?.name ?? 'tétel'} – ${formatNumber(q ?? raktarSzerint ?? m.quantity)} ${egyseg} ${t.kesz}.`)
    } else hibaKiir(r)
  }

  const kevesebbRogzites = () => {
    const q = Number(mennyiseg.replace(',', '.'))
    if (!Number.isFinite(q) || q <= 0) return setHiba(HIBA['invalid-quantity'])
    if (!veglegesit && q >= vart) return setHiba(`Ez nem kevesebb a vártnál (${formatNumber(vart)} ${egyseg}). Ha minden megvan, nyomja meg: „${t.rendben}”.`)
    if (q !== vart && !megjegyzes.trim()) return setHiba(HIBA['note-required'])
    if (veglegesit) elfogad(q, megjegyzes, keszletHiany)
    else visszaigazol(q, megjegyzes, keszletHiany)
  }

  const nemRogzites = () => {
    if (!megjegyzes.trim()) return setHiba(HIBA['note-required'])
    if (!veglegesit) return visszaigazol(0, megjegyzes)
    const r = reject(m.id, megjegyzes)
    if (r.ok) {
      setPanel(null)
      onKesz(`Elutasítva: ${termek?.name ?? 'tétel'}.`)
    } else hibaKiir(r)
  }

  const okok = nyitva === 'nem' ? (veglegesit ? ['Nem egyezik a papírokkal', 'Kétszer rögzítették', 'Hibás mennyiség'] : t.nemOkok) : t.okok

  return (
    <li className="card kozos flex flex-col gap-3" aria-labelledby={`cim-${m.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`cim-${m.id}`} className="text-lg font-semibold leading-snug break-words">
            {termek?.name ?? 'Törölt termék'}
          </h3>
          <p className="muted text-sm">
            {m.integracioForras ? <KonyveloForras forras={forrasa(m)} utvonal={m.integracioForrasUtvonal} /> : forrasa(m)} · {formatDate(m.date)}
            {telephely ? ` · ${telephely}` : ''}
          </p>
        </div>
        <span className={`badge ${allapot === 'elutasitva' ? 'badge-danger' : 'badge-warning'}`}>{cimke ?? t.cim}</span>
      </div>

      <p className="text-3xl font-bold tabular-nums" aria-label={`Mennyiség: ${formatNumber(vart)} ${egyseg}`}>
        {formatNumber(vart)} <span className="text-xl font-semibold">{egyseg}</span>
      </p>
      {(vevo || m.note) && (
        <p className="muted text-sm break-words">
          {vevo ? `Vevő: ${vevo}` : ''}
          {vevo && m.note ? ' · ' : ''}
          {m.note}
        </p>
      )}
      {raktarSzerint !== null && raktarSzerint !== vart && (
        <p className="alert alert-warning text-sm">
          A raktár szerint: <strong>{raktarSzerint === 0 ? 'nem történt meg' : `${formatNumber(raktarSzerint)} ${egyseg}`}</strong>
          {m.raktarMegjegyzes ? ` – ${m.raktarMegjegyzes}` : ''}
        </p>
      )}
      {allapot === 'elutasitva' && m.rejectReason && <p className="alert alert-danger text-sm">A fő iroda elutasította: {m.rejectReason}</p>}

      <button
        type="button"
        className="btn btn-small self-start"
        aria-expanded={reszletek}
        aria-controls={`reszletek-${m.id}`}
        onClick={() => setReszletek((r) => !r)}
      >
        {reszletek ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        {reszletek ? 'Részletek elrejtése' : 'Részletek megtekintése'}
      </button>
      {reszletek && (
        // Minden mező látszik; ami nincs rögzítve, ott „–” áll.
        <dl id={`reszletek-${m.id}`} className="card card-muted grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          {(
            [
              ['Fajta', cimke ?? t.cim],
              ['Forrás', forrasa(m)],
              ['Rögzítette', bekuldo],
              ['Rögzítve', formatDateTime(m.createdAt)],
              ['Dátum', formatDate(m.date)],
              ['Telephely', telephely],
              ['Mennyiség', `${formatNumber(vart)} ${egyseg}`],
              ['A raktár szerint', raktarSzerint === null ? null : raktarSzerint === 0 ? 'nem történt meg' : `${formatNumber(raktarSzerint)} ${egyseg}`],
              ['Raktári visszaigazolás', m.raktarVisszaigazolva ? formatDateTime(m.raktarVisszaigazolva) : null],
              ['Megjegyzés', m.note],
              ['A raktár megjegyzése', m.raktarMegjegyzes],
              ['Vevő', vevo],
              ['Számlaszám', m.invoiceNumber],
              ...(arLathato ? [['Várható egységár', m.unitPrice !== undefined ? formatMoney(m.unitPrice, m.currency ?? 'HUF') : null] as const] : []),
              ...(m.rejectReason ? [['Elutasítás oka', m.rejectReason] as const] : []),
            ] as ReadonlyArray<readonly [string, string | null | undefined]>
          ).map(([cim, ertek]) => (
            <div key={cim} className="contents">
              <dt className="muted">{cim}</dt>
              <dd className="mb-1 break-words font-medium sm:mb-0">{ertek || '–'}</dd>
            </div>
          ))}
        </dl>
      )}

      {teendo === null ? (
        allapot === 'elutasitva' ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary" onClick={() => setAblak({ fajta: 'javitas', m })}>
              <Pencil size={18} aria-hidden="true" /> Javítás és újraküldés
            </button>
            <button type="button" className="btn" onClick={() => deleteMovement(m.id, 'soft-delete')}>
              Visszavonom
            </button>
          </div>
        ) : (
          <p className="alert text-sm">{allapot ? ALLAPOT_SZOVEG[allapot] : ''}</p>
        )
      ) : (
        <>
          {veglegesit && raktarSzerint === null && (
            <p className="muted text-sm">A raktár még nem igazolta vissza. Csak akkor fogadja el, ha biztosan tudja, mi történt.</p>
          )}
          {veglegesit && raktarSzerint === 0 ? (
            <button type="button" className="btn btn-danger btn-big btn-block" onClick={() => nyit('nem')}>
              <XCircle size={22} aria-hidden="true" /> Elutasítás megerősítése
            </button>
          ) : (
            <button type="button" className="btn btn-success btn-big btn-block" onClick={() => (veglegesit ? elfogad() : visszaigazol(vart))}>
              <CheckCircle2 size={22} aria-hidden="true" />{' '}
              {veglegesit ? `Elfogadom${raktarSzerint !== null ? ` (${formatNumber(raktarSzerint)} ${egyseg})` : ''}` : t.rendben}
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(!veglegesit || egyLepesben || m.type === 'in') && (
              <button type="button" className="btn" aria-expanded={nyitva === 'kevesebb'} aria-controls={`panel-${m.id}`} onClick={() => nyit('kevesebb')}>
                <MinusCircle size={18} aria-hidden="true" /> {veglegesit ? 'Más mennyiséggel' : t.kevesebb}
              </button>
            )}
            {!(veglegesit && raktarSzerint === 0) && (
              <button type="button" className="btn btn-danger" aria-expanded={nyitva === 'nem'} aria-controls={`panel-${m.id}`} onClick={() => nyit('nem')}>
                <XCircle size={18} aria-hidden="true" /> {veglegesit ? 'Elutasítom' : t.nem}
              </button>
            )}
          </div>
        </>
      )}

      {teendo && nyitva && (
        <div id={`panel-${m.id}`} className="card card-muted flex flex-col gap-3">
          {nyitva === 'kevesebb' && (
            <label className="flex flex-col gap-1">
              <span className="font-medium">{veglegesit ? 'Mennyit fogad el?' : t.kevesebbKerdes}</span>
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
                Várt mennyiség: {formatNumber(vart)} {egyseg}
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
              placeholder="Vagy írja be röviden…"
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
          {keszletHiany && nyitva === 'kevesebb' && (
            <button type="button" className="btn btn-danger" onClick={kevesebbRogzites}>
              Megszámoltam, mégis
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
          {keszletHiany && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => (veglegesit ? elfogad(undefined, undefined, true) : visszaigazol(vart, undefined, true))}
            >
              Megszámoltam, mégis
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
  const auditLog = useStore((s) => s.auditLog)
  const { isWarehouseUser, isReadOnlyViewer, effectiveRole } = useAuth()
  const { remote, utolso, hiba, fut, frissit } = useIntegracioFrissites()
  const [panel, setPanel] = useState<Panel>(null)
  const [ablak, setAblak] = useState<Ablak>(null)
  const [uzenet, setUzenet] = useState<string | null>(null)

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers])
  // Ki rögzítette a tételt: a mozgás létrehozásának naplóbejegyzéséből.
  const bekuldoById = useMemo(() => {
    const t = new Map<string, string>()
    for (const e of auditLog) {
      if (e.entityType === 'movement' && e.action === 'create' && (e.performedByName || e.performedByEmail)) t.set(e.entityId, (e.performedByName || e.performedByEmail)!)
    }
    return t
  }, [auditLog])
  const szerep: Szerep = {
    raktaros: isWarehouseUser,
    foIroda: effectiveRole === 'fo_iroda',
    csakOlvas: isReadOnlyViewer,
    helyi: dataMode !== 'remote' || !effectiveRole,
  }
  const lista = useMemo(
    () =>
      movements
        // A várakozók, és a raktárnak a saját elutasított bejelentései (javításra).
        .filter((m) => varakozo(m) || (allapota(m) === 'elutasitva' && Boolean(m.raktarVisszaigazolva)))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.localeCompare(b.createdAt))),
    [movements],
  )
  const teendoMap = new Map(lista.map((m) => [m.id, teendoje(m, szerep)]))
  const csoportok: Array<{ cim: string; elemek: Movement[] }> = (
    szerep.raktaros
      ? [
          { cim: 'Visszaigazolásra vár', elemek: lista.filter((m) => teendoMap.get(m.id) === 'visszaigazol') },
          { cim: 'Elutasított bejelentéseim', elemek: lista.filter((m) => allapota(m) === 'elutasitva') },
          { cim: 'A fő iroda elfogadására vár', elemek: lista.filter((m) => allapota(m) === 'fo_irodara_var') },
        ]
      : [
          { cim: 'Elfogadásra vár – a raktár visszaigazolta', elemek: lista.filter((m) => allapota(m) === 'fo_irodara_var') },
          { cim: 'A raktár visszaigazolására vár', elemek: lista.filter((m) => allapota(m) === 'raktarra_var') },
          { cim: 'Elutasítva, a raktár javítására vár', elemek: lista.filter((m) => allapota(m) === 'elutasitva') },
        ]
  ).filter((g) => g.elemek.length)

  const leiras = szerep.raktaros
    ? 'Amit rögzít, az bejelentés: a készlet csak a fő iroda elfogadásakor változik. Itt igazolja vissza, mi érkezett vagy ment ki ténylegesen.'
    : szerep.foIroda || szerep.helyi
      ? 'A raktár bejelentései és visszaigazolásai. Elfogadáskor változik a készlet és ekkor megy a Könyvelőbe; nem kell külön rögzíteni.'
      : 'A raktár bejelentései. Elfogadni csak a fő iroda tudja.'

  return (
    // Alul hely a lebegő „+” gombnak, hogy az utolsó kártya gombjait ne takarja (telefonon).
    <div className="kozos mx-auto max-w-3xl pb-28">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Jóváhagyásra vár</h1>
          <p className="muted mt-1 text-sm">{leiras}</p>
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
                  telephely={locationById.get(m.locationId) ?? null}
                  vevo={m.customerId ? (customerById.get(m.customerId) ?? null) : null}
                  bekuldo={bekuldoById.get(m.id) ?? null}
                  arLathato={!isWarehouseUser}
                  teendo={teendoMap.get(m.id) ?? null}
                  panel={panel}
                  setPanel={setPanel}
                  setAblak={setAblak}
                  onKesz={setUzenet}
                />
              ))}
            </ul>
          </section>
        ))
      )}
      {remote && utolso && <p className="muted text-center text-xs">Frissítve: {utolso.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}</p>}

      {ablak?.fajta === 'beszerzes' && <ApprovePurchaseOrderModal movement={ablak.m} onClose={() => setAblak(null)} />}
      {ablak?.fajta === 'kiadas' && <ApproveSaleModal movement={ablak.m} onClose={() => setAblak(null)} />}
      {ablak?.fajta === 'javitas' && <ResubmitSaleModal movement={ablak.m} onClose={() => setAblak(null)} />}
    </div>
  )
}
