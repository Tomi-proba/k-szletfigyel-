// F29: a valós idejű frissítés szabályai (lib/eloFrissites.ts), hamis csatornával és órával.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EloFrissito, TARTALEK_MS, VARAKOZAS_MS, type CsatornaAllapot, type EloFrissitesFuggosegek } from '../src/lib/eloFrissites'

function kornyezet() {
  let jelzes: () => void = () => {}
  let allapot: (a: CsatornaAllapot) => void = () => {}
  const mentesFigyelok = new Set<() => void>()
  const lathatosagFigyelok = new Set<() => void>()
  const k = {
    frissitesek: 0,
    feliratkozasok: [] as string[],
    leiratkozva: 0,
    mentesUres: true,
    lathato: true,
    jelez: () => jelzes(),
    csatorna: (a: CsatornaAllapot) => allapot(a),
    mentesValtozott: () => mentesFigyelok.forEach((f) => f()),
    lathatosagValtozott: () => lathatosagFigyelok.forEach((f) => f()),
  }
  const f: EloFrissitesFuggosegek = {
    feliratkozik(ceg, j, a) {
      k.feliratkozasok.push(ceg)
      jelzes = j
      allapot = a
      return () => k.leiratkozva++
    },
    frissit: async () => {
      k.frissitesek++
    },
    mentesUres: () => k.mentesUres,
    mentesFigyel: (fn) => (mentesFigyelok.add(fn), () => mentesFigyelok.delete(fn)),
    lathato: () => k.lathato,
    lathatosagFigyel: (fn) => (lathatosagFigyelok.add(fn), () => lathatosagFigyelok.delete(fn)),
    idozito: { setTimeout, clearTimeout, setInterval, clearInterval } as EloFrissitesFuggosegek['idozito'],
  }
  return { k, frissito: new EloFrissito(f) }
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('valós idejű frissítés (F29)', () => {
  it('több jelzés gyors egymásutánban egy frissítés', async () => {
    const { k, frissito } = kornyezet()
    frissito.indit('ceg-1')
    k.csatorna('el')
    k.jelez()
    k.jelez()
    k.jelez()
    await vi.advanceTimersByTimeAsync(VARAKOZAS_MS + 10)
    expect(k.frissitesek).toBe(1)
    expect(k.feliratkozasok).toEqual(['ceg-1'])
  })

  it('amíg a saját mentés nincs a szerveren, nem tölt újra; utána igen', async () => {
    const { k, frissito } = kornyezet()
    frissito.indit('ceg-1')
    k.csatorna('el')
    k.mentesUres = false
    k.jelez()
    await vi.advanceTimersByTimeAsync(VARAKOZAS_MS + 10)
    expect(k.frissitesek).toBe(0)
    k.mentesUres = true
    k.mentesValtozott()
    await vi.advanceTimersByTimeAsync(VARAKOZAS_MS + 10)
    expect(k.frissitesek).toBe(1)
  })

  it('kapcsolat nélkül a tartalék időnként frissít; élő csatornánál nem; visszakapcsoláskor pótol', async () => {
    const { k, frissito } = kornyezet()
    frissito.indit('ceg-1')
    await vi.advanceTimersByTimeAsync(TARTALEK_MS + 10)
    expect(k.frissitesek).toBe(1)
    k.csatorna('el')
    await vi.advanceTimersByTimeAsync(3 * TARTALEK_MS)
    expect(k.frissitesek).toBe(1)
    k.csatorna('megszakadt')
    await vi.advanceTimersByTimeAsync(TARTALEK_MS + 10)
    expect(k.frissitesek).toBe(2)
    k.csatorna('el')
    await vi.advanceTimersByTimeAsync(10)
    expect(k.frissitesek).toBe(3)
  })

  it('háttérben lévő lapnál nem frissít, előtérbe kerüléskor egyszer igen', async () => {
    const { k, frissito } = kornyezet()
    frissito.indit('ceg-1')
    k.csatorna('el')
    k.lathato = false
    k.jelez()
    await vi.advanceTimersByTimeAsync(VARAKOZAS_MS + 10)
    expect(k.frissitesek).toBe(0)
    k.lathato = true
    k.lathatosagValtozott()
    await vi.advanceTimersByTimeAsync(10)
    expect(k.frissitesek).toBe(1)
  })

  it('cégváltáskor és leállításkor leiratkozik, utána nem frissít', async () => {
    const { k, frissito } = kornyezet()
    frissito.indit('ceg-1')
    frissito.indit('ceg-2')
    expect(k.feliratkozasok).toEqual(['ceg-1', 'ceg-2'])
    expect(k.leiratkozva).toBeGreaterThan(0)
    frissito.leallit()
    k.jelez()
    await vi.advanceTimersByTimeAsync(TARTALEK_MS * 2)
    expect(k.frissitesek).toBe(0)
  })
})
