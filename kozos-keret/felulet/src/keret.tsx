// A keret és a modulok közti szerződés (TERV.md F22 K2), az értesítések és a gyorsbillentyű-rendszer (K5).
//
// A modul felülete egy csomag (`/modulok/<modul>/modul.js`), amely a keret által adott KÖZÖS példányokat
// használja (React, útválasztó, ez a komponenskészlet): `window.__keret`. Így egy alkalmazás van, egy
// React-fával: a modul a keret kontextusából (useKeret) kapja a céget, az időszakot, a témát, és ezen át
// navigál, értesít, regisztrálja a gyorsbillentyűit.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { KERET_GYORSBILLENTYUK, egyezik, feliratok, macGep, utkozesek, type Gyorsbillentyu, type Idoszak, type IdoszakFajta, type ModulKod } from '@aweboldal/modulok'
import { Parbeszed } from './komponensek.tsx'

export type Tema = 'vilagos' | 'sotet' | 'rendszer'

export interface KeretCeg {
  /** A portál cégazonosítója (a mester, F22 6. döntés). */
  id: string
  nev: string
  /** A modul saját cégazonosítója, ha a portál cégéhez már hozzá van rendelve. */
  modulCegId: string | null
  csakOlvashato: boolean
  /** A cég adószáma (pl. a modulbeli cég létrehozásához a portál adataival). */
  adoszam: string
  /** A felhasználó szerepe a portálon ennél a cégnél. */
  szerep: 'tulajdonos' | 'konyvelo' | 'munkatars'
}

export interface KeretKontextus {
  modul: ModulKod | null
  ceg: KeretCeg
  /** A felhasználó választása (cégenként megmarad, modulváltáskor is); null: a modul alapértelmezése. */
  valasztottIdoszak: Idoszak | null
  /** A modulnak szóló időszak: a választás a modul fajtájára igazítva, vagy a modul alapértelmezése. */
  idoszak: (fajta: IdoszakFajta | null, alap: () => Idoszak) => Idoszak
  idoszakValasztas: (i: Idoszak | null) => void
  tema: Tema
  /** Belső hivatkozás megnyitása ugyanazon a felületen (C5), pl. /keszlet/mozgas/123. */
  navigal: (cel: string) => void
  ertesit: (szoveg: string, fajta?: Ertesites['fajta']) => void
  /** A modul API-jának címe a keret címén (K1), pl. /api/konyvelo. */
  apiAlap: (modul: ModulKod) => string
  teendokFrissitese: () => void
  /** Belépési jegy a modulnak a kiválasztott céghez (a keret saját belépésével; F21), új ablak nélkül. */
  jegyKeres: (modul: ModulKod) => Promise<string>
  /**
   * A közös Supabase-projekt hozzáférési tokenje a keret munkamenetéből (F24 KS3): a modul ezzel éri el a
   * Supabase-t, saját munkamenetet nem tárol és nem frissít. Null, ha a keret nem Supabase-belépéssel fut.
   */
  supabaseToken?: () => Promise<string | null>
  /**
   * A modul második menüsorának pontjai, ha szerepkörtől függnek vagy számlálót mutatnak (F24 KS7); null: a keret
   * a modul leírásának menüjét mutatja.
   */
  modulMenuBeallitas?: (pontok: ModulMenuPont[] | null) => void
}

/** A modul második menüsorának egy pontja. */
export interface ModulMenuPont {
  cim: string
  /** Keretbeli útvonal, pl. /keszlet/mozgasnaplo. */
  utvonal: string
  /** Pl. a jóváhagyásra váró tételek száma; 0 vagy hiány: nincs jelvény. */
  szamlalo?: number
  /** Csak pontos egyezésre aktív (pl. a modul áttekintése). */
  pontos?: boolean
  /** Ezekre az útvonalakra is aktív (pl. egy csoport alpontjai). */
  alutvonalak?: string[]
}

const Kontextus = createContext<KeretKontextus | null>(null)
export const KeretSzolgaltato = Kontextus.Provider

/** A keret kontextusa, ha a modul a keretben fut; önálló futásnál null. */
export const useKeretHaVan = (): KeretKontextus | null => useContext(Kontextus)

export function useKeret(): KeretKontextus {
  const k = useContext(Kontextus)
  if (!k) throw new Error('A modul a kereten kívül fut: hiányzik a keret kontextusa.')
  return k
}

/** A modul felület-csomagja (window.__modulok[kod]). */
export interface ModulCsomag {
  szerzodes: 1
  kod: ModulKod
  /** A modul képernyői az útvonal-előtag alatt (pl. /konyvelo/*). */
  Kepernyok: ComponentType<{ alapUtvonal: string }>
  /** Összefoglaló kártya a közös Kezdőlapra. */
  Osszefoglalo?: ComponentType
  /** A modul időszak-fajtája (null: dátumtartománnyal dolgozik, a választást változatlanul kapja). */
  idoszakFajta: IdoszakFajta | null
  /** A modul gyorsbillentyűi (a keret ütközés-ellenőrzéssel veszi fel). */
  gyorsbillentyuk?: Gyorsbillentyu[]
  /** A modul stíluslapjai a csomag mappájában (pl. ["modul.css"]); a keret a megjelenítés előtt betölti. */
  stilusok?: string[]
}

// --- Értesítések -----------------------------------------------------------------------------------------

export interface Ertesites {
  id: number
  szoveg: string
  fajta: 'info' | 'siker' | 'hiba'
}

const ErtesitesKontextus = createContext<(szoveg: string, fajta?: Ertesites['fajta']) => void>(() => {})
export const useErtesites = () => useContext(ErtesitesKontextus)

export function ErtesitesSzolgaltato({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Ertesites[]>([])
  const n = useRef(0)
  const ertesit = useCallback((szoveg: string, fajta: Ertesites['fajta'] = 'info') => {
    const id = ++n.current
    setLista((l) => [...l, { id, szoveg, fajta }])
    setTimeout(() => setLista((l) => l.filter((e) => e.id !== id)), fajta === 'hiba' ? 10_000 : 5_000)
  }, [])
  return (
    <ErtesitesKontextus.Provider value={ertesit}>
      {children}
      <div className="fg-ertesitesek" role="status" aria-live="polite" data-ertesitesek>
        {lista.map((e) => (
          <div key={e.id} className={`fg-ertesites fg-ertesites--${e.fajta}`}>
            {e.szoveg}
          </div>
        ))}
      </div>
    </ErtesitesKontextus.Provider>
  )
}

// --- Gyorsbillentyűk -----------------------------------------------------------------------------------

interface Bejegyzes {
  g: Gyorsbillentyu
  kezelo: () => void
}

interface GyorsbillentyuApi {
  regisztral: (g: Gyorsbillentyu, kezelo: () => void) => () => void
  lista: () => Gyorsbillentyu[]
  mac: boolean
  egybetusBe: boolean
  sugoNyitas: () => void
}

const GyKontextus = createContext<GyorsbillentyuApi | null>(null)

const beviteliMezo = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && !(el instanceof HTMLInputElement && /^(checkbox|radio|button|submit)$/.test(el.type))

/**
 * Egy figyelő az egész felületre. A keret és a modul billentyűi egy listában; azonos billentyű két funkcióhoz
 * nem regisztrálható (a második helyett hibaüzenet a konzolon, fejlesztéskor kiderül).
 */
export function GyorsbillentyuSzolgaltato({ children, egybetusBe }: { children: ReactNode; egybetusBe: boolean }) {
  const bejegyzesek = useRef<Bejegyzes[]>([])
  const [sugo, setSugo] = useState(false)
  const [, frissit] = useState(0)
  const mac = typeof navigator !== 'undefined' && macGep(navigator.platform || navigator.userAgent)

  const api = useMemo<GyorsbillentyuApi>(
    () => ({
      regisztral: (g, kezelo) => {
        const ut = utkozesek([...bejegyzesek.current.map((b) => b.g).filter((x) => x.azon !== g.azon), g])
        if (ut.length) {
          console.error('Gyorsbillentyű-ütközés:', ut)
          return () => {}
        }
        const b = { g, kezelo }
        bejegyzesek.current = [...bejegyzesek.current.filter((x) => x.g.azon !== g.azon), b]
        frissit((n) => n + 1)
        return () => {
          bejegyzesek.current = bejegyzesek.current.filter((x) => x !== b)
          frissit((n) => n + 1)
        }
      },
      lista: () => bejegyzesek.current.map((b) => b.g),
      mac,
      egybetusBe,
      sugoNyitas: () => setSugo(true),
    }),
    [mac, egybetusBe],
  )

  useEffect(() => {
    const figyelo = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const o = { mezoben: beviteliMezo(e.target), mac, egybetusBe }
      if (document.querySelector('dialog[open]') && e.key !== 'Escape') return
      for (const b of bejegyzesek.current) {
        if (b.g.billentyuk.some((k) => egyezik(e, k, o))) {
          e.preventDefault()
          b.kezelo()
          return
        }
      }
    }
    window.addEventListener('keydown', figyelo)
    return () => window.removeEventListener('keydown', figyelo)
  }, [mac, egybetusBe])

  return (
    <GyKontextus.Provider value={api}>
      {children}
      <SugoAblak nyitva={sugo} onBezar={() => setSugo(false)} lista={api.lista()} mac={mac} egybetusBe={egybetusBe} />
    </GyKontextus.Provider>
  )
}

/** Gyorsbillentyű regisztrálása, amíg a komponens látszik. */
export function useGyorsbillentyu(g: Gyorsbillentyu | undefined, kezelo: () => void) {
  const api = useContext(GyKontextus)
  const ref = useRef(kezelo)
  ref.current = kezelo
  useEffect(() => {
    if (!api || !g) return
    return api.regisztral(g, () => ref.current())
  }, [api, g])
}

export function useGyorsbillentyuk() {
  const api = useContext(GyKontextus)
  if (!api) throw new Error('hiányzó gyorsbillentyű-szolgáltató')
  return api
}

/** A keret egy billentyűje azonosító szerint (a tooltipekhez és a regisztráláshoz). */
export const keretBillentyu = (azon: string) => KERET_GYORSBILLENTYUK.find((g) => g.azon === azon)!

/** A ? súgó: minden aktív gyorsbillentyű, forrás szerint csoportosítva. */
export function SugoAblak({ nyitva, onBezar, lista, mac, egybetusBe }: { nyitva: boolean; onBezar: () => void; lista: Gyorsbillentyu[]; mac: boolean; egybetusBe: boolean }) {
  const sorok = [...lista].sort((a, b) => (a.forras === b.forras ? 0 : a.forras === 'keret' ? -1 : 1))
  return (
    <Parbeszed nyitva={nyitva} cim="Gyorsbillentyűk" onBezar={onBezar}>
      <table className="fg-tablazat" data-sugo-tablazat>
        <caption className="fg-rejtett">Gyorsbillentyűk</caption>
        <thead>
          <tr>
            <th scope="col">Billentyű</th>
            <th scope="col">Mit csinál</th>
          </tr>
        </thead>
        <tbody>
          {sorok.map((g) => (
            <tr key={g.azon} data-sugo-sor={g.azon}>
              <td>
                <kbd>{feliratok(g, mac)}</kbd>
              </td>
              <td>
                {g.leiras}
                {g.megjegyzes && <span className="fg-halvany"> {g.megjegyzes}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fg-halvany">
        Az egybetűs billentyűk (pl. K, T, N) csak akkor működnek, ha nem beviteli mezőben áll a kurzor
        {egybetusBe ? '' : ' – most ki vannak kapcsolva (Beállításaim)'}. Ahol a böngésző a saját menüjének tartja fenn az Alt-os
        kombinációt, ott a tartalék billentyű működik.
      </p>
    </Parbeszed>
  )
}

// --- A közös példányok a modulcsomagoknak ------------------------------------------------------------------

export interface KozosPeldanyok {
  React: unknown
  ReactDOM: unknown
  jsxRuntime: unknown
  ReactRouter: unknown
  Felulet: unknown
  szerzodes: 1
}

declare global {
  interface Window {
    __keret?: KozosPeldanyok
    __modulok?: Partial<Record<ModulKod, ModulCsomag>>
  }
}
