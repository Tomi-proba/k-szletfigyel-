// F29: a valós idejű frissítés bekötése (Supabase Realtime privát csatorna + a store újratöltése). A logika a
// lib/eloFrissites.ts-ben van, itt csak a valódi függőségek.
import { EloFrissito, type CsatornaAllapot } from './eloFrissites'
import { mentesiSor } from './mentes'
import { supabase } from './supabase'
import { eloAdatBetoltes, useStore } from '../store/useStore'

function feliratkozik(ceg: string, jelzes: () => void, allapot: (a: CsatornaAllapot) => void): () => void {
  const kliens = supabase
  if (!kliens) {
    allapot('megszakadt')
    return () => {}
  }
  let csatorna: ReturnType<typeof kliens.channel> | null = null
  let leallitva = false
  void (async () => {
    try {
      // A privát csatornához a felhasználó tokenje kell (a keretben a keret tokenje).
      await kliens.realtime.setAuth()
    } catch {
      // ha nem sikerül, a feliratkozás hibát ad, és a tartalék frissítés fut
    }
    if (leallitva) return
    csatorna = kliens
      .channel(`keszlet:${ceg}`, { config: { private: true } })
      .on('broadcast', { event: 'valtozas' }, () => jelzes())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') allapot('el')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') allapot('megszakadt')
      })
  })()
  return () => {
    leallitva = true
    if (csatorna) void kliens.removeChannel(csatorna)
  }
}

export const eloFrissito = new EloFrissito({
  feliratkozik,
  frissit: eloAdatBetoltes,
  mentesUres: () => mentesiSor.fuggoTetelek.length === 0 && mentesiSor.aktualisAllapot.fajta !== 'elakadt',
  mentesFigyel: (fn) => mentesiSor.figyel(() => fn()),
  lathato: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  lathatosagFigyel: (fn) => {
    if (typeof document === 'undefined') return () => {}
    document.addEventListener('visibilitychange', fn)
    return () => document.removeEventListener('visibilitychange', fn)
  },
  idozito: {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  },
})

/** Egyszer, induláskor: a valós idejű frissítés a szerveres módhoz és a kiválasztott céghez igazodik (belépés,
 * cégváltás, kijelentkezés), így a belépési folyamatba nem kell külön bekötni. */
let bekotve = false
export function eloFrissitesBekotese(): void {
  if (bekotve) return
  bekotve = true
  const igazit = (s: { dataMode: string; remoteCompanyId: string | null }) => {
    if (s.dataMode === 'remote' && s.remoteCompanyId) eloFrissito.indit(s.remoteCompanyId)
    else eloFrissito.leallit()
  }
  igazit(useStore.getState())
  useStore.subscribe((s, elozo) => {
    if (s.dataMode !== elozo.dataMode || s.remoteCompanyId !== elozo.remoteCompanyId) igazit(s)
  })
}
