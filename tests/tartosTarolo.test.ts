// A helyi mód tartós mentése (DOCUMENTATION.md 22.): asztali programban szinkron lemezre írás, a
// böngészőben IndexedDB-tükör szigorú tartóssággal és jelzéssel, amíg nincs lemezen.
import { describe, expect, it } from 'vitest'
import { asztaliTartosTarolo, bongeszoTartosTarolo, type AszinkronLemez, type LemezAllapot } from '../src/lib/tartosTarolo'

class Mem {
  m = new Map<string, string>()
  getItem = (k: string) => this.m.get(k) ?? null
  setItem = (k: string, v: string) => void this.m.set(k, v)
  removeItem = (k: string) => void this.m.delete(k)
}

describe('asztali program: szinkron, lemezre kényszerített írás', () => {
  it('az írás a lemezre kerül, mielőtt a hívás visszatér; olvasáskor a lemezen lévő az elsődleges', () => {
    const helyi = new Mem()
    const lemez = new Map<string, string>()
    const allapotok: LemezAllapot[] = []
    const t = asztaliTartosTarolo(
      helyi,
      { tartosIras: (k, v) => (lemez.set(k, v), { ok: true }), tartosOlvasas: (k) => lemez.get(k) ?? null },
      (s) => allapotok.push((s as { allapot: LemezAllapot }).allapot),
    )
    t.setItem('adat', 'v1')
    expect(lemez.get('adat')).toBe('v1')
    // Hirtelen leállás után a böngészőtároló régebbi lehet; a lemezen lévő érvényes.
    helyi.setItem('adat', 'regi')
    expect(t.getItem('adat')).toBe('v1')
    expect(allapotok.at(-1)).toEqual({ fajta: 'rendben' })
  })

  it('ha a lemezre írás nem sikerül, a hiba látszik, és újrapróbálható', () => {
    let hibas = true
    const lemez = new Map<string, string>()
    let utolso: { allapot: LemezAllapot; ujraprobal: (() => void) | null } = { allapot: { fajta: 'rendben' }, ujraprobal: null }
    const t = asztaliTartosTarolo(
      new Mem(),
      { tartosIras: (k, v) => (hibas ? { ok: false, hiba: 'Nincs elég hely a lemezen.' } : (lemez.set(k, v), { ok: true })), tartosOlvasas: (k) => lemez.get(k) ?? null },
      (s) => (utolso = s as typeof utolso),
    )
    t.setItem('adat', 'v1')
    expect(utolso.allapot).toEqual({ fajta: 'hiba', uzenet: 'Nincs elég hely a lemezen.' })
    hibas = false
    utolso.ujraprobal!()
    expect(lemez.get('adat')).toBe('v1')
    expect(utolso.allapot).toEqual({ fajta: 'rendben' })
  })
})

describe('böngésző: IndexedDB-tükör, jelzés a lemezre kerülésig', () => {
  function lemez() {
    const tar = new Map<string, { seq: number; ertek: string }>()
    const varakozok: Array<() => void> = []
    const l: AszinkronLemez & { tar: typeof tar; befejez: () => void } = {
      tar,
      ir: (k, r) => new Promise<void>((ok) => varakozok.push(() => (tar.set(k, r), ok()))),
      olvas: async (k) => tar.get(k) ?? null,
      befejez: () => varakozok.splice(0).forEach((f) => f()),
    }
    return l
  }

  it('„Mentés lemezre…” a tartós írás befejezéséig, utána „rendben”', async () => {
    const l = lemez()
    const allapotok: LemezAllapot[] = []
    const t = bongeszoTartosTarolo(new Mem(), l, (s) => allapotok.push((s as { allapot: LemezAllapot }).allapot))
    t.setItem('adat', 'v1')
    expect(allapotok.at(-1)).toEqual({ fajta: 'iras' })
    l.befejez()
    await Promise.resolve()
    await Promise.resolve()
    expect(allapotok.at(-1)).toEqual({ fajta: 'rendben' })
  })

  it('indításkor a frissebb (nagyobb sorszámú) példány töltődik be', async () => {
    const helyi = new Mem()
    const l = lemez()
    const t = bongeszoTartosTarolo(helyi, l, () => undefined)
    t.setItem('adat', 'v1')
    l.befejez()
    t.setItem('adat', 'v2')
    l.befejez()
    await Promise.resolve()
    // Leállás: a böngészőtároló utolsó írása elveszett (a régit őrzi), az IndexedDB-ben a v2 megvan.
    helyi.setItem('adat', 'v1')
    helyi.setItem('adat::sorszam', '1')
    expect(await t.getItem('adat')).toBe('v2')
    // Fordítva: ha a böngészőtároló a frissebb, az marad.
    helyi.setItem('adat', 'v3')
    helyi.setItem('adat::sorszam', '9')
    expect(await t.getItem('adat')).toBe('v3')
  })
})
