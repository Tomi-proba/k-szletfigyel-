// Van-e raktáros a kiválasztott cégnél (F34 kiegészítés): a „raktáros jóváhagyása szükséges” pipa csak ekkor jelenik
// meg, és raktáros nélkül a fő iroda a raktárra váró tételt (pl. a Könyvelőből jöttet) közvetlenül elfogadhatja.
// A cég tagjait a fő iroda, az iroda és a tulajdonos olvashatja (company_members RLS); cégenként egyszer kérdezzük le.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { useAuth } from './useAuth'

// Rövid ideig érvényes: ha közben raktárost vesznek fel (a portálon), az ablak következő megnyitása már ezt mutatja.
const ERVENYES_MS = 30_000
const tar = new Map<string, { p: Promise<boolean | null>; ido: number }>()

function lekerdez(cegId: string): Promise<boolean | null> {
  const meglevo = tar.get(cegId)
  let p = meglevo && Date.now() - meglevo.ido < ERVENYES_MS ? meglevo.p : undefined
  if (!p) {
    const kliens = supabase
    p = kliens
      ? Promise.resolve(
          kliens.from('company_members').select('user_id', { count: 'exact', head: true }).eq('company_id', cegId).eq('role', 'raktaros'),
        ).then(({ count, error }) => (error ? null : (count ?? 0) > 0), () => null)
      : Promise.resolve(null)
    tar.set(cegId, { p, ido: Date.now() })
    // Hiba esetén legközelebb újra próbálja.
    void p.then((v) => {
      if (v === null) tar.delete(cegId)
    })
  }
  return p
}

/** true: van raktáros; false: nincs; null: még nem tudni, vagy nem lekérdezhető (raktáros felhasználó). Helyi (bemutató)
 * módban a szerepkör-kapcsolóval a raktáros is kipróbálható, ezért ott úgy vesszük, hogy van. */
export function useVanRaktaros(): boolean | null {
  const dataMode = useStore((s) => s.dataMode)
  const { company, effectiveRole } = useAuth()
  const helyi = dataMode !== 'remote'
  const cegId = company?.id ?? null
  const lekerdezheto = dataMode === 'remote' && Boolean(cegId) && (effectiveRole === 'fo_iroda' || effectiveRole === 'iroda' || effectiveRole === 'tulajdonos')
  const [ertek, setErtek] = useState<{ ceg: string; van: boolean | null } | null>(null)
  useEffect(() => {
    if (!lekerdezheto || !cegId) return
    let el = true
    void lekerdez(cegId).then((van) => {
      if (el) setErtek({ ceg: cegId, van })
    })
    return () => {
      el = false
    }
  }, [lekerdezheto, cegId])
  if (helyi) return true
  return lekerdezheto && ertek?.ceg === cegId ? ertek.van : null
}

/** Csak a tesztekhez: a gyorsítótár ürítése. */
export const vanRaktarosTarUrites = () => tar.clear()
