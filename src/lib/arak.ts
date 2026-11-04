// Az árak EGYETLEN forrása a portál árlistája (AWEBOLDAL packages/arak, a portál /api/v1/arak
// végpontján). A Készletkezelőben sehol nincs beégetett ár: ha az árlista nem érhető el, „–” látszik.
// A portál címe beállításból jön (VITE_PORTAL_URL), alapból a helyben futó portál.
import { useEffect, useState } from 'react'

export interface ArlistaCsomag {
  kod: string
  nev: string
  modulok: string[]
  havidijNetto: number
  havidijBrutto: number
  kulonOsszeg: number
  megtakaritas: number
  megtakaritasSzazalek: number
  kiemelt: boolean
}

export interface Arlista {
  penznem: 'HUF'
  afaKulcs: number
  probaidoNap: number
  csomagok: ArlistaCsomag[]
}

export const PORTAL_URL = (import.meta.env.VITE_PORTAL_URL || 'http://localhost:3400').replace(/\/+$/, '')

/** Az árlista ellenőrzése: csak a várt alakú választ fogadjuk el. */
export function arlistaErvenyes(adat: unknown): adat is Arlista {
  const a = adat as Partial<Arlista> | null
  return Boolean(
    a &&
      typeof a.afaKulcs === 'number' &&
      Array.isArray(a.csomagok) &&
      a.csomagok.every((c) => typeof c?.kod === 'string' && Number.isFinite(c?.havidijNetto)),
  )
}

export async function arlistaLetoltese(fetchFn: typeof fetch = fetch): Promise<Arlista | null> {
  try {
    const r = await fetchFn(`${PORTAL_URL}/api/v1/arak`)
    if (!r.ok) return null
    const adat: unknown = await r.json()
    return arlistaErvenyes(adat) ? adat : null
  } catch {
    return null
  }
}

/** A Készletkezelő önálló csomagja az árlistából (null, ha nem érhető el). */
export function keszletCsomag(a: Arlista | null): ArlistaCsomag | null {
  return a?.csomagok.find((c) => c.kod === 'keszlet') ?? null
}

export function useArlista(): { arlista: Arlista | null; betolt: boolean } {
  const [arlista, setArlista] = useState<Arlista | null>(null)
  const [betolt, setBetolt] = useState(true)
  useEffect(() => {
    let el = true
    void arlistaLetoltese().then((a) => {
      if (!el) return
      setArlista(a)
      setBetolt(false)
    })
    return () => {
      el = false
    }
  }, [])
  return { arlista, betolt }
}
