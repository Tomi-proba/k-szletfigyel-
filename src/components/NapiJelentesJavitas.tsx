// F35: a fő iroda a raktártól kapott napi jelentés tételeit javíthatja (termék, mennyiség, ár, vevő, fizetett,
// megjegyzés), törölheti és pótolhatja. Mentés előtt a program felsorolja a változásokat („Mennyiség: 45 kg → 40 kg”),
// kötelező indoklást kér, és rákérdez: „Biztosan így javítja?”. A javítás a napra kerül (az eredeti tétel érvénytelenítése
// + a javított tétel), így a jelentés és a készlet a javított állapotot mutatja; az előzmény a naplóban marad.
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { napHatasosMozgasai } from '../lib/dailyClosing'
import { formatNumber } from '../lib/format'
import { napiJavithato, napiValtozasok, useStore, type NapiTetelUj } from '../store/useStore'
import type { Movement, MovementType } from '../types'
import { Field, Input, Select } from './ui'

type Mod = { fajta: 'javit'; m: Movement } | { fajta: 'torol'; m: Movement } | { fajta: 'potol' }

interface Urlap {
  productId: string
  type: MovementType
  quantity: string
  unitPrice: string
  customerId: string
  isPaid: boolean
  note: string
  indoklas: string
}

export function NapiJelentesJavitas({ locationId, date }: { locationId: string; date: string }) {
  const movements = useStore((s) => s.movements)
  const products = useStore((s) => s.products)
  const customers = useStore((s) => s.customers)
  const javit = useStore((s) => s.napiTetelJavitas)
  const torol = useStore((s) => s.napiTetelTorles)
  const potol = useStore((s) => s.napiTetelPotlas)
  const [mod, setMod] = useState<Mod | null>(null)
  const [urlap, setUrlap] = useState<Urlap | null>(null)
  const [megerosit, setMegerosit] = useState<string[] | null>(null)
  const [hiba, setHiba] = useState<string | null>(null)
  const [uzenet, setUzenet] = useState<string | null>(null)

  const tetelek = useMemo(() => napHatasosMozgasai(movements, locationId, date), [movements, locationId, date])
  const termekek = useMemo(() => products.filter((p) => !p.deletedAt && p.locationId === locationId).sort((a, b) => a.name.localeCompare(b.name, 'hu')), [products, locationId])
  const vevok = useMemo(() => customers.filter((c) => !c.deletedAt).sort((a, b) => a.name.localeCompare(b.name, 'hu')), [customers])
  const termek = (id: string) => products.find((p) => p.id === id)
  const vevoNeve = (id?: string) => (id ? (customers.find((c) => c.id === id)?.name ?? '') : '')

  function nyit(uj: Mod) {
    setMod(uj)
    setMegerosit(null)
    setHiba(null)
    setUzenet(null)
    const m = uj.fajta === 'potol' ? null : uj.m
    setUrlap({
      productId: m?.productId ?? termekek[0]?.id ?? '',
      type: m?.type ?? 'in',
      quantity: m ? String(m.quantity) : '',
      unitPrice: m?.unitPrice !== undefined ? String(m.unitPrice) : '',
      customerId: m?.customerId ?? '',
      isPaid: m?.isPaid ?? true,
      note: m?.note ?? '',
      indoklas: '',
    })
  }
  function bezar() {
    setMod(null)
    setUrlap(null)
    setMegerosit(null)
    setHiba(null)
  }

  function ujAdat(u: Urlap): NapiTetelUj {
    return {
      productId: u.productId,
      quantity: Number(u.quantity.replace(',', '.')),
      unitPrice: u.type === 'in' && u.unitPrice.trim() !== '' ? Number(u.unitPrice.replace(',', '.')) : undefined,
      customerId: u.type === 'out' ? u.customerId || undefined : undefined,
      isPaid: u.type === 'out' && u.customerId ? u.isPaid : undefined,
      note: u.note,
    }
  }

  function tovabb() {
    if (!mod || !urlap) return
    setHiba(null)
    if (!urlap.indoklas.trim()) return setHiba('Írja be, miért javítja (a naplóba kerül).')
    if (mod.fajta === 'torol') {
      const t = termek(mod.m.productId)
      return setMegerosit([`Törlés: ${t?.name ?? 'tétel'} ${formatNumber(mod.m.quantity)} ${t?.unit ?? ''} (${mod.m.type === 'in' ? 'bejövő' : 'kimenő'})`])
    }
    const uj = ujAdat(urlap)
    if (!Number.isFinite(uj.quantity) || uj.quantity <= 0) return setHiba('A mennyiség legyen pozitív szám.')
    if (mod.fajta === 'potol') {
      const t = termek(uj.productId)
      return setMegerosit([
        `Új ${urlap.type === 'in' ? 'bejövő' : 'kimenő'} tétel: ${t?.name ?? '?'} ${formatNumber(uj.quantity)} ${t?.unit ?? ''}` +
          (uj.unitPrice !== undefined ? `, ${formatNumber(uj.unitPrice)} Ft/egység` : '') +
          (uj.customerId ? `, vevő: ${vevoNeve(uj.customerId)} (${uj.isPaid ? 'fizetett' : 'nem fizetett'})` : ''),
      ])
    }
    const v = napiValtozasok(mod.m, uj, { products, customers })
    if (v.length === 0) return setHiba('Nem változtatott semmit.')
    setMegerosit(v)
  }

  function vegrehajt() {
    if (!mod || !urlap) return
    const ind = urlap.indoklas
    const r =
      mod.fajta === 'javit'
        ? javit(mod.m.id, ujAdat(urlap), ind)
        : mod.fajta === 'torol'
          ? torol(mod.m.id, ind)
          : potol({ ...ujAdat(urlap), type: urlap.type, date }, ind)
    if (!r.ok) {
      setMegerosit(null)
      return setHiba(
        r.reason === 'not-editable'
          ? 'Ez a tétel már nem javítható (például korábban már javították).'
          : r.reason === 'forbidden'
            ? 'Javítani csak a fő iroda tud.'
            : 'A javítás nem sikerült.',
      )
    }
    setUzenet(mod.fajta === 'javit' ? 'A tétel javítva.' : mod.fajta === 'torol' ? 'A tétel törölve.' : 'A tétel pótolva.')
    bezar()
  }

  const valasztott = urlap ? termek(urlap.productId) : undefined

  return (
    <div className="kozos mb-4" data-napi-javitas>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Tételek javítása (fő iroda)</h3>
        <button type="button" className="btn btn-small" onClick={() => nyit({ fajta: 'potol' })} data-napi-potlas>
          <Plus size={16} aria-hidden="true" /> Hiányzó tétel pótlása
        </button>
      </div>
      {uzenet && (
        <p className="alert alert-success mb-2 text-sm" role="status">
          {uzenet}
        </p>
      )}
      <ul className="mb-2 flex flex-col gap-2">
        {tetelek.map((m) => {
          const t = termek(m.productId)
          const javithato = napiJavithato(m, movements)
          return (
            <li key={m.id} className="card card-muted flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-napi-tetel={m.id}>
              <span className="min-w-0">
                <strong>{t?.name ?? 'Törölt termék'}</strong>{' '}
                <span className={m.type === 'in' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>
                  {m.type === 'in' ? '+' : '−'}
                  {formatNumber(m.quantity)} {t?.unit ?? ''}
                </span>
                {m.customerId ? <span className="muted"> · {vevoNeve(m.customerId)}</span> : null}
                {m.note ? <span className="muted"> · {m.note}</span> : null}
              </span>
              {javithato && (
                <span className="flex gap-2">
                  <button type="button" className="btn btn-small" onClick={() => nyit({ fajta: 'javit', m })} aria-label={`${t?.name ?? 'Tétel'} javítása`}>
                    <Pencil size={14} aria-hidden="true" /> Javítás
                  </button>
                  <button type="button" className="btn btn-small btn-danger" onClick={() => nyit({ fajta: 'torol', m })} aria-label={`${t?.name ?? 'Tétel'} törlése`}>
                    <Trash2 size={14} aria-hidden="true" /> Törlés
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {mod && urlap && (
        <div className="card flex flex-col gap-1" data-napi-urlap>
          <h4 className="mb-2 font-semibold">
            {mod.fajta === 'javit' ? 'Tétel javítása' : mod.fajta === 'torol' ? 'Tétel törlése' : 'Hiányzó tétel pótlása'}
          </h4>
          {megerosit ? (
            <div data-napi-megerosites>
              <p className="mb-2 font-medium">
                {mod.fajta === 'javit' ? 'Biztosan így javítja?' : mod.fajta === 'torol' ? 'Biztosan törli?' : 'Biztosan pótolja?'}
              </p>
              <ul className="mb-2 list-disc pl-5 text-sm">
                {megerosit.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p className="muted mb-3 text-sm">Indoklás: {urlap.indoklas.trim()}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" className={`btn btn-big ${mod.fajta === 'torol' ? 'btn-danger-solid' : 'btn-success'}`} onClick={vegrehajt} data-napi-igen>
                  {mod.fajta === 'javit' ? 'Igen, javítom' : mod.fajta === 'torol' ? 'Igen, törlöm' : 'Igen, pótolom'}
                </button>
                <button type="button" className="btn btn-big" onClick={() => setMegerosit(null)}>
                  Vissza
                </button>
              </div>
            </div>
          ) : (
            <>
              {mod.fajta !== 'torol' && (
                <>
                  {mod.fajta === 'potol' && (
                    <Field label="Irány">
                      <Select value={urlap.type} onChange={(e) => setUrlap({ ...urlap, type: e.target.value as MovementType })}>
                        <option value="in">Bejövő</option>
                        <option value="out">Kimenő</option>
                      </Select>
                    </Field>
                  )}
                  <Field label="Termék">
                    <Select value={urlap.productId} onChange={(e) => setUrlap({ ...urlap, productId: e.target.value })}>
                      {termekek.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={`Mennyiség${valasztott ? ` (${valasztott.unit})` : ''}`}>
                    <Input inputMode="decimal" value={urlap.quantity} onChange={(e) => setUrlap({ ...urlap, quantity: e.target.value })} />
                  </Field>
                  {urlap.type === 'in' && (
                    <Field label="Beszerzési egységár (Ft)">
                      <Input inputMode="decimal" value={urlap.unitPrice} onChange={(e) => setUrlap({ ...urlap, unitPrice: e.target.value })} placeholder={valasztott ? String(valasztott.purchasePrice) : ''} />
                    </Field>
                  )}
                  {urlap.type === 'out' && (
                    <>
                      <Field label="Vevő">
                        <Select value={urlap.customerId} onChange={(e) => setUrlap({ ...urlap, customerId: e.target.value })}>
                          <option value="">Magánszemély</option>
                          {vevok.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {urlap.customerId && (
                        <Field label="Fizetett?">
                          <Select value={urlap.isPaid ? 'igen' : 'nem'} onChange={(e) => setUrlap({ ...urlap, isPaid: e.target.value === 'igen' })}>
                            <option value="igen">Igen, fizetett</option>
                            <option value="nem">Nem fizetett</option>
                          </Select>
                        </Field>
                      )}
                    </>
                  )}
                  <Field label="Megjegyzés">
                    <Input value={urlap.note} onChange={(e) => setUrlap({ ...urlap, note: e.target.value })} />
                  </Field>
                </>
              )}
              <Field label="Indoklás (kötelező, a naplóba kerül)">
                <Input value={urlap.indoklas} onChange={(e) => setUrlap({ ...urlap, indoklas: e.target.value })} data-napi-indoklas />
              </Field>
              {hiba && (
                <p className="mb-2 text-sm text-[var(--color-danger)]" role="alert">
                  {hiba}
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" className="btn btn-primary btn-big" onClick={tovabb} data-napi-tovabb>
                  Tovább
                </button>
                <button type="button" className="btn btn-big" onClick={bezar}>
                  Mégse
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
