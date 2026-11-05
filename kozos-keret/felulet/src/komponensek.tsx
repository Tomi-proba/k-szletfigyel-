// A közös komponenskészlet (TERV.md F22 K3): a dizájn-tokenekre épül, akadálymentes (címkék, hibaüzenetek a
// mezőhöz kötve, billentyűzettel használható párbeszédablak). A Könyvelő bevált mintái szerint.
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { adoszamEllenoriz, datumFormaz, datumOlvas, osszegFormaz, osszegOlvas } from './ertekek.ts'

export function Gomb({ valtozat = 'alap', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { valtozat?: 'alap' | 'elsodleges' | 'veszelyes' | 'link' }) {
  return <button type="button" {...p} className={['fg-gomb', `fg-gomb--${valtozat}`, className].filter(Boolean).join(' ')} />
}

export interface MezoAzonositok {
  id: string
  'aria-invalid': boolean
  'aria-describedby': string | undefined
  'aria-required': boolean | undefined
}

/**
 * Címke, súgószöveg és hibaüzenet egy mezőhöz; a gyerek a bekötött azonosítókat kapja. A hiba a mező alatt
 * jelenik meg, és a mezőhöz van kötve (aria-describedby), így a képernyőolvasó is felolvassa. A `kiegeszites`
 * (pl. egy súgógomb) a címke mellé kerül, de nem a mező nevébe.
 */
export function Mezo({
  cimke,
  sugo,
  hiba,
  kotelezo,
  kiegeszites,
  children,
}: {
  cimke: string
  sugo?: ReactNode
  hiba?: string | null
  kotelezo?: boolean
  kiegeszites?: ReactNode
  children: (a: MezoAzonositok) => ReactNode
}) {
  const id = useId()
  const sugoId = sugo ? `${id}-sugo` : undefined
  const hibaId = hiba ? `${id}-hiba` : undefined
  const leiras = [hibaId, sugoId].filter(Boolean).join(' ') || undefined
  return (
    <div className={`fg-mezo field${hiba ? ' fg-mezo--hibas' : ''}`}>
      <div className="fg-mezo__cimkesor field-label-row">
        <label htmlFor={id}>
          {cimke}
          {kotelezo && (
            <span className="required-mark" aria-hidden="true">
              {' '}*
            </span>
          )}
        </label>
        {kiegeszites}
      </div>
      {children({ id, 'aria-invalid': Boolean(hiba), 'aria-describedby': leiras, 'aria-required': kotelezo || undefined })}
      {sugo && (
        <div id={sugoId} className="fg-mezo__sugo hint">
          {sugo}
        </div>
      )}
      {hiba && (
        <div id={hibaId} className="fg-mezo__hiba error">
          {hiba}
        </div>
      )}
    </div>
  )
}

type Bevitel = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>

/** Forintösszeg: „12500” vagy „12 500” is jó; kilépéskor „12 500” formára áll. */
export function OsszegMezo({ ertek, onValtozas, ...p }: Bevitel & { ertek: number | null; onValtozas: (n: number | null, hibas: boolean) => void }) {
  const [szoveg, setSzoveg] = useState(ertek == null ? '' : osszegFormaz(ertek))
  return (
    <input
      {...p}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className="fg-bevitel fg-bevitel--szam"
      value={szoveg}
      onChange={(e) => {
        setSzoveg(e.target.value)
        const v = osszegOlvas(e.target.value)
        onValtozas(v ?? null, v === undefined)
      }}
      onBlur={() => {
        const v = osszegOlvas(szoveg)
        if (typeof v === 'number') setSzoveg(osszegFormaz(v))
      }}
    />
  )
}

/**
 * Összegmező szöveges értékkel (a hívó tartja a szöveget, pl. filléres összegnél). Kilépéskor a `formaz`
 * egységes formára hozza; az „=” billentyű a hiányzó különbözetet kéri (`onKulonbozet`), ha meg van adva.
 */
export function OsszegSzovegMezo({
  szoveg,
  onSzoveg,
  formaz,
  onKulonbozet,
  className,
  ...p
}: Omit<Bevitel, 'className'> & { szoveg: string; onSzoveg: (s: string) => void; formaz?: (s: string) => string | null; onKulonbozet?: () => void; className?: string }) {
  const [t, setT] = useState(szoveg)
  const utolso = useRef(szoveg)
  useEffect(() => {
    if (szoveg !== utolso.current) {
      utolso.current = szoveg
      setT(szoveg)
    }
  }, [szoveg])
  const kuld = (x: string) => {
    utolso.current = x
    setT(x)
    onSzoveg(x)
  }
  return (
    <input
      {...p}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={['fg-bevitel fg-bevitel--szam', className].filter(Boolean).join(' ')}
      value={t}
      onChange={(e) => kuld(e.target.value)}
      onKeyDown={(e) => {
        p.onKeyDown?.(e)
        if (e.key === '=' && onKulonbozet) {
          e.preventDefault()
          onKulonbozet()
        }
      }}
      onBlur={(e) => {
        p.onBlur?.(e)
        const f = formaz?.(t)
        if (f != null && f !== t) kuld(f)
      }}
    />
  )
}

/**
 * Dátummező ISO értékkel (ÉÉÉÉ-HH-NN; érvénytelen vagy félig beírt dátumnál üres szöveg). Gyors bevitel:
 * „20261020”, „2026.10.20” vagy év nélkül „10.20” (az `alapEv` évével). Kilépéskor egységes formára áll.
 */
export function DatumIsoMezo({ ertek, onErtek, alapEv, ...p }: Bevitel & { ertek: string; onErtek: (iso: string) => void; alapEv?: number }) {
  const [t, setT] = useState(ertek ? datumFormaz(ertek) : '')
  const utolso = useRef(ertek)
  useEffect(() => {
    if (ertek !== utolso.current) {
      utolso.current = ertek
      setT(ertek ? datumFormaz(ertek) : '')
    }
  }, [ertek])
  return (
    <input
      {...p}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="ÉÉÉÉ.HH.NN."
      className={['fg-bevitel', p.className].filter(Boolean).join(' ')}
      value={t}
      onChange={(e) => {
        setT(e.target.value)
        const iso = datumOlvas(e.target.value, alapEv) ?? ''
        utolso.current = iso
        onErtek(iso)
      }}
      onBlur={(e) => {
        p.onBlur?.(e)
        const iso = datumOlvas(t, alapEv)
        if (iso) setT(datumFormaz(iso))
      }}
    />
  )
}

/** Dátum: „2026.11.05.”, „2026-11-05” vagy „11.05.” (az idei évben); kilépéskor „2026.11.05.”. */
export function DatumMezo({ ertek, onValtozas, ...p }: Bevitel & { ertek: string | null; onValtozas: (iso: string | null, hibas: boolean) => void }) {
  const [szoveg, setSzoveg] = useState(ertek ? datumFormaz(ertek) : '')
  return (
    <input
      {...p}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="ÉÉÉÉ.HH.NN."
      className="fg-bevitel"
      value={szoveg}
      onChange={(e) => {
        setSzoveg(e.target.value)
        const v = datumOlvas(e.target.value)
        onValtozas(v ?? null, v === undefined)
      }}
      onBlur={() => {
        const v = datumOlvas(szoveg)
        if (v) setSzoveg(datumFormaz(v))
      }}
    />
  )
}

/** Adószám (12345678-1-12), ellenőrző számjeggyel. */
export function AdoszamMezo({ ertek, onValtozas, ...p }: Bevitel & { ertek: string; onValtozas: (szoveg: string, hiba: string | null) => void }) {
  return (
    <input
      {...p}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="12345678-1-12"
      className="fg-bevitel"
      value={ertek}
      onChange={(e) => {
        const r = adoszamEllenoriz(e.target.value)
        onValtozas(e.target.value, e.target.value.trim() === '' || r.ok ? null : r.uzenet)
      }}
      onBlur={() => {
        const r = adoszamEllenoriz(ertek)
        if (r.ok && r.formazott !== ertek) onValtozas(r.formazott, null)
      }}
    />
  )
}

export interface Oszlop<T> {
  cim: string
  ertek: (sor: T) => ReactNode
  /** Számoszlop: jobbra igazítva. */
  szam?: boolean
}

export function Tablazat<T>({ felirat, oszlopok, sorok, kulcs, ures }: { felirat: string; oszlopok: Oszlop<T>[]; sorok: T[]; kulcs: (s: T) => string; ures?: ReactNode }) {
  if (!sorok.length) return <UresAllapot>{ures ?? 'Nincs megjeleníthető adat.'}</UresAllapot>
  return (
    <div className="fg-tablazat-keret">
      <table className="fg-tablazat">
        <caption className="fg-rejtett">{felirat}</caption>
        <thead>
          <tr>
            {oszlopok.map((o) => (
              <th key={o.cim} scope="col" className={o.szam ? 'fg-szam' : undefined}>
                {o.cim}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorok.map((s) => (
            <tr key={kulcs(s)}>
              {oszlopok.map((o) => (
                <td key={o.cim} className={o.szam ? 'fg-szam' : undefined}>
                  {o.ertek(s)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Párbeszédablak a böngésző saját (modális, fókuszt megtartó) <dialog> elemével; Esc bezárja. */
export function Parbeszed({ nyitva, cim, onBezar, children, labresz }: { nyitva: boolean; cim: string; onBezar: () => void; children: ReactNode; labresz?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const cimId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (nyitva && !d.open) d.showModal()
    if (!nyitva && d.open) d.close()
  }, [nyitva])
  return (
    <dialog ref={ref} className="fg-parbeszed" aria-labelledby={cimId} onClose={onBezar} onCancel={onBezar}>
      <div className="fg-parbeszed__fej">
        <h2 id={cimId}>{cim}</h2>
        <button type="button" className="fg-gomb fg-gomb--link" aria-label="Bezárás" onClick={onBezar}>
          ✕
        </button>
      </div>
      {/* A görgethető törzs billentyűzettel is elérhető (WCAG 2.1.1). */}
      <div className="fg-parbeszed__torzs" tabIndex={0}>
        {children}
      </div>
      {labresz && <div className="fg-parbeszed__lab">{labresz}</div>}
    </dialog>
  )
}

/**
 * Hibaösszesítő az űrlap tetején: megjelenéskor, új üzenetnél vagy új mentési kísérletnél (`kiserlet`) fókuszt
 * kap, és a képernyőolvasó felolvassa; a mezőnkénti hibák javítása közben a kurzor a mezőben marad.
 */
export function HibaOsszegzes({ uzenet, mezok, kiserlet }: { uzenet?: string | null; mezok?: Record<string, string>; kiserlet?: number }) {
  const lista = mezok ? Object.values(mezok) : []
  const ref = useRef<HTMLDivElement>(null)
  const latszik = Boolean(uzenet) || lista.length > 0
  useEffect(() => {
    if (latszik) ref.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uzenet, kiserlet])
  if (!latszik) return null
  return (
    <div className="fg-uzenet fg-uzenet--hiba alert alert-error" role="alert" tabIndex={-1} ref={ref}>
      <strong>{uzenet ?? 'Kérjük, javítsa a megjelölt mezőket.'}</strong>
      {lista.length > 1 && (
        <ul>
          {lista.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function UresAllapot({ children }: { children: ReactNode }) {
  return <div className="fg-ures">{children}</div>
}
