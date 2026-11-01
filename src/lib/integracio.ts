// A kapcsolat a többi programmal (Könyvelő, eÁFA) a felület felől (TERV.md F15, DOCUMENTATION.md 23-25.).
// A böngésző az integrációs adatokat nem olvashatja közvetlenül: csak ezt a néhány szerveroldali függvényt
// hívhatja (supabase/migrations/2026-10-29_integracio.sql, 2026-10-31_integracio_bejovo.sql).
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { integracioFrissites, useStore } from '../store/useStore'
import type { Movement } from '../types'
import type { KonyveloNyitott } from './egyIgazsag'

export type IntegracioTeendo = {
  id: string
  kulcs: string
  fajta: string
  cim: string
  reszletek: string | null
  valtozasId: number | null
  letrehozva: string
}

/** Az egyeztetés egy ellenőrzésének eredménye (a központtól, változatlanul; TERV.md F16). */
export type EgyeztetesEredmeny = {
  check: 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6'
  status: 'RENDBEN' | 'FUGGO' | 'REGOTA_FUGG' | 'ELTERES' | 'NYITO_ELFOGADASRA_VAR' | 'NEM_FUTOTT'
  title: string
  detail: string | null
  items: Array<{ label: string }>
}

export type IntegracioAllapot = {
  osszekapcsolva: boolean
  beallitas: { adoszam: string; osszekapcsolva: string | null; bontva: string | null } | null
  ervenyes_kod_lejar: string | null
  osszeallitasra_var: number
  atadasra_var: number
  legregebbi_varakozo: string | null
  utolso_hiba: string | null
  /** A központ legutóbbi egyeztetése (éjszakánként és kérésre); null, ha még nem volt. */
  egyeztetes?: { runId: string; at: string; asOf: string; from: string; to: string; eredmenyek: EgyeztetesEredmeny[] } | null
  teendok: IntegracioTeendo[]
}

/** PERIOD, FISCAL_YEAR: a Könyvelőben lezárt időszak; AFA_BEKULDVE: az eÁFA-ban beküldött áfabevallás időszaka. */
export type LezartIdoszak = { fajta: 'PERIOD' | 'FISCAL_YEAR' | 'AFA_BEKULDVE'; kezdet: string; veg: string }

function db() {
  if (!supabase) throw new Error('A kapcsolat a többi programmal csak szerveres módban (bejelentkezve) érhető el.')
  return supabase
}

async function rpc<T>(nev: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(nev, args)
  if (error) {
    // A szerver hibaüzenetei magyarok (pl. „Kapcsolódási kódot csak a fő iroda készíthet.”); ha a függvény
    // nincs meg, a szerveren még nem futott le az integrációs migráció.
    if (error.code === 'PGRST202' || /function .* does not exist/i.test(error.message)) {
      throw new Error('A szerveren még nincs bekapcsolva a kapcsolat a többi programmal (lásd ELESITES.md).')
    }
    throw new Error(error.message || 'A szerver hibát jelzett.')
  }
  return data as T
}

/** Programfüggetlen hivatkozás (TERV.md F18): melyik program, és azon belül melyik útvonal. */
export type ModulHivatkozas = { module: 'konyvelo' | 'keszlet' | 'eafa'; path: string }

/** A cég többi programjának Teendői (csak a cím és a hivatkozás), ahogy az integrációs szolgáltatás legutóbb letöltötte. */
export type KozosTeendok = {
  allapot: 'OK' | 'KOZPONT_NEM_ERHETO_EL' | 'NINCS_JOGOSULTSAG' | 'NINCS_OSSZEKAPCSOLVA' | 'MEG_NINCS_ADAT'
  teendok: Array<{ modul: string; modulNev: string; cim: string; hivatkozas: ModulHivatkozas | null; ota: string | null }>
  modulok: Array<{ modulNev: string; kuldve: string | null }>
  lekerve?: string
}

const MODUL_CIMEK: Record<ModulHivatkozas['module'], string | undefined> = {
  konyvelo: import.meta.env.VITE_KONYVELO_URL,
  eafa: import.meta.env.VITE_EAFA_URL,
  keszlet: undefined,
}

/**
 * A hivatkozás webcíme: a program beállított címe + az útvonal (ugyanabban a fülben nyílik). A Készlet saját
 * útvonala a saját felületén belül marad; ha a másik program címe nincs beállítva, null (csak szöveg).
 */
export function modulHivatkozas(h: ModulHivatkozas | null | undefined, cimek: Partial<Record<ModulHivatkozas['module'], string | undefined>> = MODUL_CIMEK): string | null {
  if (!h || !/^(\/|#\/)/.test(h.path) || h.path.startsWith('//')) return null
  if (h.module === 'keszlet') return h.path.startsWith('#') ? h.path : `#${h.path}`
  const alap = cimek[h.module]?.trim().replace(/\/+$/, '')
  if (!alap) return null
  return `${alap}${h.path.startsWith('#') ? '/' : ''}${h.path}`
}

/** A Könyvelő nyitott tételei (TERV.md F19): szerveres módban, percenként frissítve; hiba vagy helyi mód esetén null. */
export function useKonyveloNyitott(enabled: boolean): KonyveloNyitott | null {
  const remote = useStore((s) => s.dataMode === 'remote')
  const [adat, setAdat] = useState<KonyveloNyitott | null>(null)
  useEffect(() => {
    if (!remote || !enabled) return
    let el = false
    const betolt = () =>
      rpc<KonyveloNyitott>('integracio_konyvelo_nyitott')
        .then((a) => !el && setAdat(a))
        .catch(() => undefined)
    void betolt()
    const t = setInterval(betolt, 60_000)
    return () => {
      el = true
      clearInterval(t)
    }
  }, [remote, enabled])
  return remote && enabled ? adat : null
}

export const kozosTeendokLekerese = () => rpc<KozosTeendok>('integracio_kozos_teendok')

/** A többi program Teendői (szerveres módban, percenként frissítve); hiba esetén null. */
export function useKozosTeendok(enabled: boolean): KozosTeendok | null {
  const remote = useStore((s) => s.dataMode === 'remote')
  const [adat, setAdat] = useState<KozosTeendok | null>(null)
  useEffect(() => {
    if (!remote || !enabled) return
    let el = false
    const betolt = () =>
      kozosTeendokLekerese()
        .then((a) => !el && setAdat(a))
        .catch(() => undefined)
    void betolt()
    const t = setInterval(betolt, 60_000)
    return () => {
      el = true
      clearInterval(t)
    }
  }, [remote, enabled])
  return adat
}

export const integracioAllapot = () => rpc<IntegracioAllapot>('integracio_allapot')
export const kapcsolodasiKodKeszitese = (adoszam: string) => rpc<{ kod: string; lejar: string }>('integracio_kod_keszites', { p_adoszam: adoszam })
export const valtozasKihagyasa = (valtozasId: number, indok: string) => rpc<void>('integracio_kihagyas', { p_valtozas_id: valtozasId, p_indok: indok })
export const lezartIdoszakokLekerese = () => rpc<LezartIdoszak[]>('integracio_lezart_idoszakok')

/** A dátum a Könyvelőben lezárt időszakba esik-e (a Készlet figyelmeztet, de nem tilt; KK9). */
export function lezartIdoszakban(datum: string, lista: readonly LezartIdoszak[]): LezartIdoszak | null {
  return lista.find((l) => l.fajta !== 'AFA_BEKULDVE' && l.kezdet <= datum && datum <= l.veg) ?? null
}

/** A dátum az eÁFA-ban már beküldött áfabevallás időszakába esik-e (figyelmeztetés, nem tiltás; F17.2). */
export function bekuldottAfaIdoszakban(datum: string, lista: readonly LezartIdoszak[]): LezartIdoszak | null {
  return lista.find((l) => l.fajta === 'AFA_BEKULDVE' && l.kezdet <= datum && datum <= l.veg) ?? null
}

/** A Könyvelőben lezárt időszakok (szerveres módban, 5 percenként frissítve). Hiba esetén üres lista: a
 * figyelmeztetés csak segítség, a rögzítést soha nem akadályozza. */
export function useLezartIdoszakok(): LezartIdoszak[] {
  const remote = useStore((s) => s.dataMode === 'remote')
  const [lista, setLista] = useState<LezartIdoszak[]>([])
  useEffect(() => {
    if (!remote) return
    let el = false
    const betolt = () =>
      lezartIdoszakokLekerese()
        .then((l) => !el && setLista(l ?? []))
        .catch(() => undefined)
    void betolt()
    const t = setInterval(betolt, 5 * 60_000)
    return () => {
      el = true
      clearInterval(t)
    }
  }, [remote])
  return lista
}

/** A Könyvelőből jött vagy visszáruként rögzített, jóváhagyásra váró mozgás (F15.4, F15.8). */
export function jovahagyandoIntegracios(m: Movement): boolean {
  return m.approvalStatus === 'pending' && !m.deletedAt && Boolean(m.integracioEsemenyId || m.returnOfMovementId)
}

/** A szerveren keletkezett jóváhagyandó tételek percenkénti betöltése, amíg a lista látszik. */
export function useIntegracioFrissites(intervalMs = 60_000) {
  const remote = useStore((s) => s.dataMode === 'remote')
  const [utolso, setUtolso] = useState<Date | null>(null)
  const [hiba, setHiba] = useState<string | null>(null)
  const [fut, setFut] = useState(false)
  const futRef = useRef(false)
  const frissit = useCallback(async () => {
    if (!remote || futRef.current) return
    futRef.current = true
    setFut(true)
    try {
      await integracioFrissites()
      setUtolso(new Date())
      setHiba(null)
    } catch {
      setHiba('Most nem sikerült frissíteni (nincs internet?). A lista a legutóbbi állapotot mutatja; később újra próbáljuk.')
    } finally {
      futRef.current = false
      setFut(false)
    }
  }, [remote])
  useEffect(() => {
    if (!remote) return
    void frissit()
    const t = setInterval(() => void frissit(), intervalMs)
    return () => clearInterval(t)
  }, [remote, frissit, intervalMs])
  return { remote, utolso, hiba, fut, frissit }
}

/** Össze van-e kapcsolva a cég (az irodai nézetekhez; hiba vagy helyi mód esetén: nem). */
export function useOsszekapcsolva(): boolean {
  const remote = useStore((s) => s.dataMode === 'remote')
  const [igen, setIgen] = useState(false)
  useEffect(() => {
    if (!remote) return
    let el = false
    integracioAllapot()
      .then((a) => !el && setIgen(a.osszekapcsolva))
      .catch(() => undefined)
    return () => {
      el = true
    }
  }, [remote])
  return remote && igen
}
