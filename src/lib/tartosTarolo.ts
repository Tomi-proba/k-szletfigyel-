// Tartós (lemezre írt) helyi mentés. A kérés: egyetlen mentett művelet se veszhessen el hirtelen
// leállásnál (áramszünet, a program kilövése), és a felület csak akkor mutasson sikert, ha az adat már a
// lemezen van; ha ez nem biztosítható, a felület mutassa (DOCUMENTATION.md 22.).
//
// - Asztali program: TELJES megoldás. Minden írás szinkron megy a főfolyamathoz, amely fájlba írja és
//   lemezre kényszeríti (fsync), és csak utána tér vissza. Mivel a hívás szinkron, a felület az
//   eredményt csak ezután rajzolja ki.
// - Böngésző: szinkron, lemezre kényszerített írás nincs. A legjobb elérhető megoldás: minden írás az
//   IndexedDB-be is, „szigorú tartóssággal” (a tranzakció akkor zárul, amikor a böngésző lemezre írt).
//   Amíg ez meg nem történt, a felület „Mentés lemezre…” jelzést mutat; ha nem sikerül, jól látható hibát.
//   Indításkor a két példány közül a frissebbet (nagyobb sorszámút) töltjük be.
import { create } from 'zustand'

export type LemezAllapot =
  | { fajta: 'rendben' }
  | { fajta: 'iras' }
  | { fajta: 'hiba'; uzenet: string }

export const useLemezAllapot = create<{ allapot: LemezAllapot; ujraprobal: (() => void) | null }>(() => ({ allapot: { fajta: 'rendben' }, ujraprobal: null }))

export interface Helyi {
  getItem(kulcs: string): string | null
  setItem(kulcs: string, ertek: string): void
  removeItem(kulcs: string): void
}

/** Az asztali program szinkron, lemezre kényszerített írása (electron/preload.js). */
export interface SzinkronLemez {
  tartosIras(kulcs: string, tartalom: string): { ok: boolean; hiba?: string }
  tartosOlvasas(kulcs: string): string | null
}

/** A böngésző aszinkron, tartós tárolója (IndexedDB, szigorú tartóssággal). */
export interface AszinkronLemez {
  ir(kulcs: string, rekord: { seq: number; ertek: string }): Promise<void>
  olvas(kulcs: string): Promise<{ seq: number; ertek: string } | null>
}

const seqKulcs = (k: string) => `${k}::sorszam`

/** Asztali tároló: az írás csak a lemezre kerülés után tér vissza; olvasáskor a lemezen lévő az elsődleges. */
export function asztaliTartosTarolo(helyi: Helyi, lemez: SzinkronLemez, jelez = useLemezAllapot.setState) {
  const ir = (kulcs: string, ertek: string) => {
    const r = lemez.tartosIras(kulcs, ertek)
    if (r.ok) jelez({ allapot: { fajta: 'rendben' }, ujraprobal: null })
    else jelez({ allapot: { fajta: 'hiba', uzenet: r.hiba ?? 'ismeretlen hiba' }, ujraprobal: () => ir(kulcs, ertek) })
    return r.ok
  }
  return {
    getItem(kulcs: string): string | null {
      return lemez.tartosOlvasas(kulcs) ?? helyi.getItem(kulcs)
    },
    setItem(kulcs: string, ertek: string) {
      ir(kulcs, ertek)
      // A böngészőtároló is megkapja (régi változattal való visszafelé kompatibilitás).
      try {
        helyi.setItem(kulcs, ertek)
      } catch {
        // megtelt: a lemezen lévő példány az elsődleges
      }
    },
    removeItem(kulcs: string) {
      helyi.removeItem(kulcs)
    },
  }
}

/** Böngészős tároló: a böngészőtároló mellett IndexedDB, szigorú tartóssággal; a jelzés a lemezre kerülésig. */
export function bongeszoTartosTarolo(helyi: Helyi, lemez: AszinkronLemez, jelez = useLemezAllapot.setState) {
  let fuggo = 0
  const ir = (kulcs: string, rekord: { seq: number; ertek: string }) => {
    fuggo++
    jelez({ allapot: { fajta: 'iras' }, ujraprobal: null })
    lemez.ir(kulcs, rekord).then(
      () => {
        fuggo--
        if (fuggo === 0) jelez({ allapot: { fajta: 'rendben' }, ujraprobal: null })
      },
      (e: unknown) => {
        fuggo--
        jelez({ allapot: { fajta: 'hiba', uzenet: e instanceof Error ? e.message : String(e) }, ujraprobal: () => ir(kulcs, rekord) })
      },
    )
  }
  return {
    async getItem(kulcs: string): Promise<string | null> {
      const h = helyi.getItem(kulcs)
      const hSeq = Number(helyi.getItem(seqKulcs(kulcs)) ?? 0)
      let l: { seq: number; ertek: string } | null = null
      try {
        l = await lemez.olvas(kulcs)
      } catch {
        l = null
      }
      return l && (h === null || l.seq > hSeq) ? l.ertek : h
    },
    setItem(kulcs: string, ertek: string) {
      const seq = Number(helyi.getItem(seqKulcs(kulcs)) ?? 0) + 1
      try {
        helyi.setItem(kulcs, ertek)
        helyi.setItem(seqKulcs(kulcs), String(seq))
      } catch {
        // megtelt: az IndexedDB-példány marad
      }
      ir(kulcs, { seq, ertek })
    },
    removeItem(kulcs: string) {
      helyi.removeItem(kulcs)
    },
  }
}

/** IndexedDB szigorú tartóssággal (a tranzakció a lemezre kerülés után zárul). */
export function indexedDbLemez(nev = 'keszletfigyelo-tartos'): AszinkronLemez | null {
  if (typeof indexedDB === 'undefined') return null
  let db: Promise<IDBDatabase> | null = null
  const nyit = () =>
    (db ??= new Promise((ok, hiba) => {
      const r = indexedDB.open(nev, 1)
      r.onupgradeneeded = () => r.result.createObjectStore('adat')
      r.onsuccess = () => ok(r.result)
      r.onerror = () => hiba(r.error)
    }))
  return {
    async ir(kulcs, rekord) {
      const d = await nyit()
      await new Promise<void>((ok, hiba) => {
        const tx = d.transaction('adat', 'readwrite', { durability: 'strict' })
        tx.objectStore('adat').put(rekord, kulcs)
        tx.oncomplete = () => ok()
        tx.onerror = () => hiba(tx.error)
        tx.onabort = () => hiba(tx.error ?? new Error('Az írás megszakadt.'))
      })
    },
    async olvas(kulcs) {
      const d = await nyit()
      return new Promise((ok, hiba) => {
        const r = d.transaction('adat', 'readonly').objectStore('adat').get(kulcs)
        r.onsuccess = () => ok((r.result as { seq: number; ertek: string } | undefined) ?? null)
        r.onerror = () => hiba(r.error)
      })
    },
  }
}

/** A helyi mód tárolója: asztali programban szinkron lemezre írás, böngészőben IndexedDB-tükör. */
export function helyiTartosTarolo(): {
  getItem(kulcs: string): string | null | Promise<string | null>
  setItem(kulcs: string, ertek: string): void
  removeItem(kulcs: string): void
} {
  const helyi: Helyi = {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k),
  }
  const felulet = typeof window !== 'undefined' ? (window as unknown as { keszletAsztali?: SzinkronLemez }).keszletAsztali : undefined
  if (felulet?.tartosIras) return asztaliTartosTarolo(helyi, felulet)
  const idb = indexedDbLemez()
  if (idb) return bongeszoTartosTarolo(helyi, idb)
  return helyi
}
