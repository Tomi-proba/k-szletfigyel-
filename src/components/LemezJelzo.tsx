import { AlertTriangle, HardDrive, RefreshCw } from 'lucide-react'
import { useLemezAllapot } from '../lib/tartosTarolo'
import { Button } from './ui'

/**
 * A helyi mentés lemezre kerülésének állapota (lib/tartosTarolo.ts). Amíg egy művelet még nincs
 * biztonságosan a lemezen, kis jelzés; ha a lemezre írás nem sikerült, jól látható figyelmeztetés.
 */
export function LemezJelzo() {
  const { allapot, ujraprobal } = useLemezAllapot()
  if (allapot.fajta === 'rendben') return null
  if (allapot.fajta === 'iras') {
    return (
      <div role="status" className="fixed bottom-6 right-5 z-30 flex items-center gap-2 rounded-full bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] shadow-md">
        <HardDrive size={14} />
        Mentés lemezre… (még ne zárja be)
      </div>
    )
  }
  return (
    <div role="alert" className="mb-5 flex flex-wrap items-start gap-3 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger-bg,#fdecec)] p-3 text-sm text-[var(--color-text)]">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />
      <span className="min-w-0 flex-1">
        <strong>A legutóbbi művelet nincs biztonságosan a lemezen.</strong> Hirtelen leállásnál elveszhet. Ne zárja be a programot; próbálja újra, és ha nem
        sikerül, szabadítson fel helyet a lemezen. ({allapot.uzenet})
      </span>
      {ujraprobal && (
        <Button variant="secondary" onClick={() => ujraprobal()}>
          <RefreshCw size={14} /> Újrapróbálás
        </Button>
      )}
    </div>
  )
}
