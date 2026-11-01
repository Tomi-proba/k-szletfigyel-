import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { CSOPORT_CIM, CSOPORT_MAGYARAZAT, type Csoport, type EgyIgazsag, type EgyIgazsagSor } from '../lib/egyIgazsag'
import { formatCurrency, formatDate, formatDateTime } from '../lib/format'
import { Button, Card, EmptyState } from './ui'

/**
 * Egy igazság (TERV.md F19, KK10): a fizetési kötelezettségek, illetve a kintlévőség három csoportban, ha a
 * cégnek van Könyvelője. A Könyvelő tételére nincs „Kifizetve” gomb (a fizetést ott rögzítik, KK6); a Készlet
 * saját tételei a mai módon jelölhetők.
 */
export function EgyIgazsagAllapot({ e }: { e: EgyIgazsag }) {
  if (e.allapot === 'NINCS_ADAT') return <p className="mb-3 text-sm text-[var(--color-text-muted)]">A Könyvelő még nem küldte el a nyitott tételeit; a lista néhány percen belül megjelenik.</p>
  if (!e.elavult && e.allapot === 'OK') return null
  return (
    <div role="alert" className="mb-3 flex items-start gap-2 rounded-md bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning)]">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>
        {e.elavult
          ? `A Könyvelő adatai ${e.frissitve ? formatDateTime(e.frissitve) : 'régóta'} óta nem frissültek (24 óránál régebbiek). A lista a legutóbbi állapot.`
          : 'Az integrációs központ most nem érhető el; a lista a legutóbbi állapot.'}
      </span>
    </div>
  )
}

export function EgyIgazsagLista({
  sorok,
  ures,
  csakRiaszto,
  onKifizetve,
  jelolheto,
}: {
  sorok: EgyIgazsagSor[]
  ures: string
  /** csak a riasztásban számító sorok (lejárt vagy közeli határidő) */
  csakRiaszto?: boolean
  onKifizetve?: (s: EgyIgazsagSor) => void
  /** a Könyvelő által követett saját tétel (KK6) itt sem jelölhető */
  jelolheto?: (s: EgyIgazsagSor) => boolean
}) {
  const lathato = csakRiaszto ? sorok.filter((s) => s.riaszt) : sorok
  if (lathato.length === 0) return <EmptyState>{ures}</EmptyState>
  const csoportok = (['konyvelo', 'konyvelesre_var', 'csak_keszlet'] as Csoport[]).filter((c) => lathato.some((s) => s.csoport === c))
  return (
    <div className="flex flex-col gap-4">
      {csoportok.map((c) => (
        <div key={c}>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{CSOPORT_CIM[c]}</h3>
          <p className="mb-2 text-xs text-[var(--color-text-muted)]">{CSOPORT_MAGYARAZAT[c]}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {lathato
              .filter((s) => s.csoport === c)
              .map((s) => (
                <Sor key={s.kulcs} s={s} onKifizetve={onKifizetve && (!jelolheto || jelolheto(s)) ? onKifizetve : undefined} />
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Sor({ s, onKifizetve }: { s: EgyIgazsagSor; onKifizetve?: (s: EgyIgazsagSor) => void }) {
  const lejart = s.napHataridoig !== null && s.napHataridoig < 0
  const keret = lejart ? 'border-l-[var(--color-danger)]' : s.riaszt ? 'border-l-[var(--color-warning)]' : 'border-l-[var(--color-border)]'
  return (
    <Card className={`border-l-4 ${keret}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-[var(--color-text)]">{s.partner}</span>
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold">
          {s.hatarido === null ? 'nincs határidő' : lejart ? `${Math.abs(s.napHataridoig!)} napja lejárt` : `${s.napHataridoig} nap múlva esedékes`}
        </span>
      </div>
      <div className="mt-1 text-sm text-[var(--color-text-muted)]">
        {s.hivatkozas ? (
          <a href={s.hivatkozas} className="hover:underline">
            {s.leiras}
          </a>
        ) : (
          s.leiras
        )}
      </div>
      {s.hatarido && <div className="text-xs text-[var(--color-text-muted)]">Határidő: {formatDate(s.hatarido)}</div>}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-lg font-bold text-[var(--color-text)]">{formatCurrency(s.osszeg)}</span>
        {s.csoport === 'konyvelo' ? (
          <span className="badge badge-info kozos" title="A fizetést a Könyvelőben rögzítik; itt nem állítható.">
            A Könyvelő követi
          </span>
        ) : (
          s.helyi &&
          onKifizetve && (
            <Button variant="secondary" onClick={() => onKifizetve(s)}>
              <CheckCircle2 size={16} /> Kifizetve
            </Button>
          )
        )}
      </div>
    </Card>
  )
}
