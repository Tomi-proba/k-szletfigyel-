// Egy fő gomb oldalanként (AWEBOLDAL TERV.md F27 B3): a keretben az oldal fő művelete (pl. „Új termék”, „Új vevő”)
// nem az oldal fejlécében, hanem a Készletkezelő eszközsorán, a fülsor mellett, mindig jobb fent jelenik meg, egyetlen
// kiemelt gombként, a gyorsbillentyűvel (Alt+N, F2, N) és a tooltipben a jelölésével. Ha az oldal nem ad meg saját
// fő műveletet, az alapértelmezés az „Új mozgás”. Önálló használatban minden a régi: a gomb az oldal fejlécében marad.
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../components/ui'
import { keretben } from './futas'

export interface FoMuvelet {
  cim: string
  onClick: () => void
}

/** undefined: az alapértelmezés („Új mozgás”); null: ezen az oldalon nincs fő gomb. */
type Beallito = (m: FoMuvelet | null | undefined) => void

export const FoGombKontextus = createContext<Beallito | null>(null)

/** Az oldal fő művelete a keret eszközsorán; az oldal elhagyásakor visszaáll az alapértelmezésre. */
export function useFoMuvelet(m: FoMuvelet | null | undefined) {
  const beallit = useContext(FoGombKontextus)
  const legutobbi = useRef(m)
  useEffect(() => {
    legutobbi.current = m
  })
  const kulcs = m === null ? 'nincs' : m ? m.cim : 'alap'
  useEffect(() => {
    if (!beallit) return
    beallit(m ? { cim: m.cim, onClick: () => legutobbi.current?.onClick() } : m)
    return () => beallit(undefined)
    // A cím (kulcs) változásakor jegyzi be újra; a friss onClick a refen át fut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beallit, kulcs])
}

/**
 * Az oldal fő gombja. A keretben a Készletkezelő eszközsorára kerül (itt nem jelenik meg); önállóan a megszokott
 * helyén, a megszokott kinézettel.
 */
export function FoGomb({ cim, onClick, children }: FoMuvelet & { children?: ReactNode }) {
  const keret = keretben()
  useFoMuvelet(keret ? { cim, onClick } : undefined)
  if (keret) return null
  return (
    <Button onClick={onClick}>
      {children ?? (
        <>
          <Plus size={18} /> {cim}
        </>
      )}
    </Button>
  )
}
