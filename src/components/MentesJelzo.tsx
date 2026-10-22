import { AlertTriangle, CloudOff, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { mentesiSor, useMentesAllapot } from '../lib/mentes'
import { allapotUzenet } from '../lib/mentesiSor'
import { useStore } from '../store/useStore'
import { Button } from './ui'

/** A szerverre mentés állapota (csak bejelentkezett, szerveres módban). Mentés közben egy kis jelzés,
 * hiba esetén jól látható sáv érthető üzenettel - a nem mentett változás sosem tűnik el csendben. */
export function MentesJelzo() {
  const allapot = useMentesAllapot((s) => s.allapot)
  const remote = useStore((s) => s.dataMode === 'remote')
  const { reloadData } = useAuth()
  const [frissul, setFrissul] = useState(false)

  if (!remote || allapot.fajta === 'mentve') return null

  if (allapot.fajta === 'mentes') {
    return (
      <div role="status" className="fixed bottom-6 left-5 z-30 flex items-center gap-2 rounded-full bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] shadow-md">
        <Loader2 size={14} className="animate-spin" />
        {allapotUzenet(allapot)}
      </div>
    )
  }

  if (allapot.fajta === 'ujraprobalas') {
    return (
      <div role="status" className="mb-5 flex flex-wrap items-start gap-3 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-text)]">
        <CloudOff size={18} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1">{allapotUzenet(allapot)}</span>
        <Button variant="secondary" onClick={() => mentesiSor.ujraprobal()}>
          <RefreshCw size={14} /> Újrapróbálás most
        </Button>
      </div>
    )
  }

  return (
    <div role="alert" className="mb-5 flex flex-wrap items-start gap-3 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger-bg)] p-3 text-sm text-[var(--color-danger)]">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">{allapotUzenet(allapot)}</span>
      <Button
        variant="secondary"
        disabled={frissul}
        onClick={async () => {
          setFrissul(true)
          mentesiSor.elakadasLezarasa()
          await reloadData()
          setFrissul(false)
        }}
      >
        <RefreshCw size={14} /> Adatok frissítése
      </Button>
    </div>
  )
}
