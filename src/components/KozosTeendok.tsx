import { useAuth } from '../hooks/useAuth'
import { modulHivatkozas, useKozosTeendok } from '../lib/integracio'
import { Card } from './ui'

/**
 * A többi program Teendői a Kezdőlapon (TERV.md F18). A közös belépésig csak a fő iroda és a tulajdonos
 * látja, csak a címet; a hivatkozás ugyanabban a fülben nyílik (a másik program kérheti a belépést).
 */
export function KozosTeendokKartya() {
  const { effectiveRole } = useAuth()
  const latja = effectiveRole === 'fo_iroda' || effectiveRole === 'tulajdonos'
  const adat = useKozosTeendok(latja)
  if (!latja || !adat || adat.allapot === 'NINCS_JOGOSULTSAG' || adat.allapot === 'NINCS_OSSZEKAPCSOLVA') return null
  const nemKuldott = adat.modulok.filter((m) => !m.kuldve).map((m) => m.modulNev)
  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold text-[var(--color-text)]">A többi program teendői</h2>
      {adat.allapot === 'MEG_NINCS_ADAT' && <p className="text-sm text-[var(--color-text-muted)]">A lista néhány percen belül megjelenik.</p>}
      {adat.allapot === 'KOZPONT_NEM_ERHETO_EL' && (
        <p className="mb-2 text-sm text-[var(--color-warning)]">Az integrációs központ most nem érhető el; az alábbi lista a legutóbbi állapot.</p>
      )}
      {adat.allapot !== 'MEG_NINCS_ADAT' && adat.teendok.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Nincs nyitott teendő.</p>}
      {adat.teendok.length > 0 && (
        <ul className="divide-y divide-[var(--color-border)]">
          {adat.teendok.map((t, i) => {
            const url = modulHivatkozas(t.hivatkozas)
            return (
              <li key={i} className="py-2 text-sm">
                <span className="text-[var(--color-text-muted)]">{t.modulNev}:</span>{' '}
                {url ? (
                  <a href={url} className="font-medium text-[var(--color-primary)] hover:underline">
                    {t.cim}
                  </a>
                ) : (
                  <span>{t.cim}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {nemKuldott.length > 0 && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Még nem küldte el a teendőit: {nemKuldott.join(', ')}.</p>}
    </Card>
  )
}

/** „Honnan jött?” (F18): a Könyvelő forrásbizonylata hivatkozásként, ha a Könyvelő címe be van állítva. */
export function KonyveloForras({ forras, utvonal, className }: { forras: string; utvonal?: string; className?: string }) {
  const url = utvonal ? modulHivatkozas({ module: 'konyvelo', path: utvonal }) : null
  return url ? (
    <a href={url} className={`${className ?? ''} hover:underline`}>
      {forras}
    </a>
  ) : (
    <span className={className}>{forras}</span>
  )
}
