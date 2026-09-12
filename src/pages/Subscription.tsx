// Előfizetés oldal - a cég aktuális csomagja, a próbaidőszak/következő
// fizetés dátuma, és a lemondás/módosítás lehetősége. A tényleges terhelés
// egyelőre DEMÓ MÓDBAN fut (lásd hooks/useAuth.ts demoActivateSubscription/
// demoCancelSubscription) - nincs valódi bankkártya-terhelés, csak a
// companies tábla állapotát írja át, hogy a felület és a jogosultság-
// korlátozás (isReadOnly) tesztelhető legyen éles Stripe nélkül is.
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { PAYMENT_FAILED_GRACE_DAYS, trialDaysRemaining } from '../lib/subscription'
import { Button, Card, PageHeader } from '../components/ui'
import { formatCurrency, formatDate } from '../lib/format'

const STATUS_LABELS: Record<string, string> = {
  trial: 'Próbaidőszak',
  active: 'Aktív',
  expired: 'Lejárt',
  cancelled: 'Lemondva',
}

export function Subscription() {
  const { company, isReadOnly, demoActivateSubscription, demoCancelSubscription } = useAuth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!company) return null

  async function activate() {
    setBusy(true)
    setMessage(null)
    const { error } = await demoActivateSubscription()
    setBusy(false)
    setMessage(error ? `Hiba: ${error}` : 'Előfizetés aktiválva (demó mód - nem történt valódi terhelés).')
  }

  async function cancel() {
    setBusy(true)
    setMessage(null)
    const { error } = await demoCancelSubscription()
    setBusy(false)
    setMessage(error ? `Hiba: ${error}` : 'Előfizetés lemondva.')
  }

  const daysLeft = trialDaysRemaining(company)

  return (
    <div>
      <PageHeader title="Előfizetés" subtitle={company.name} />

      <Card className="mb-5 flex items-start gap-3 border-l-4 border-l-[var(--color-primary)] bg-[var(--color-info-bg)]">
        <Info size={18} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
        <p className="text-sm text-[var(--color-primary)]">
          Ez az oldal jelenleg <b>demó módban</b> működik: az "Előfizetés indítása" és "Lemondás" gombok nem terhelnek meg valódi
          bankkártyát, csak az előfizetési állapotot állítják be a teszteléshez. Az éles Stripe-integráció előkészítve, de még nincs
          bekötve (lásd DOCUMENTATION.md).
        </p>
      </Card>

      <Card className="mb-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm text-[var(--color-text-muted)]">Csomag</div>
            <div className="text-lg font-semibold text-[var(--color-text)]">{company.plan === 'havi_elofizetes' ? 'Havi előfizetés' : company.plan}</div>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              company.subscriptionStatus === 'active'
                ? 'bg-[var(--color-success-bg)] text-[var(--color-success)]'
                : company.subscriptionStatus === 'trial'
                  ? 'bg-[var(--color-info-bg)] text-[var(--color-primary)]'
                  : 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
            }`}
          >
            {STATUS_LABELS[company.subscriptionStatus] ?? company.subscriptionStatus}
          </span>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="text-sm text-[var(--color-text-muted)]">Havidíj</div>
            <div className="text-xl font-bold text-[var(--color-text)]">{formatCurrency(company.planPriceHuf)}</div>
          </div>
          {company.subscriptionStatus === 'trial' && (
            <div>
              <div className="text-sm text-[var(--color-text-muted)]">Próbaidőszak vége</div>
              <div className="text-sm font-semibold text-[var(--color-text)]">{formatDate(company.trialEndsAt)}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{daysLeft > 0 ? `még ${daysLeft} nap` : 'lejárt'}</div>
            </div>
          )}
          {company.subscriptionStatus === 'active' && company.currentPeriodEnd && (
            <div>
              <div className="text-sm text-[var(--color-text-muted)]">Következő fizetés</div>
              <div className="text-sm font-semibold text-[var(--color-text)]">{formatDate(company.currentPeriodEnd)}</div>
            </div>
          )}
        </div>

        {isReadOnly && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-[var(--color-danger-bg)] p-3 text-sm text-[var(--color-danger)]">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>
              Az előfizetésed lejárt vagy le lett mondva - az alkalmazás jelenleg csak megtekintésre szolgál, új rögzítés nem lehetséges.
              Aktiváld az előfizetést a hozzáférés visszaállításához.
            </span>
          </div>
        )}
        {company.subscriptionStatus === 'active' && company.paymentFailedAt && !isReadOnly && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning)]">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>
              A legutóbbi fizetés sikertelen volt ({formatDate(company.paymentFailedAt)}). {PAYMENT_FAILED_GRACE_DAYS} nap türelmi időd
              van a fizetési mód frissítésére, mielőtt a hozzáférés korlátozódna.
            </span>
          </div>
        )}

        {message && <p className="mb-4 text-sm text-[var(--color-text)]">{message}</p>}

        <div className="flex flex-wrap gap-2">
          {company.subscriptionStatus !== 'active' && (
            <Button onClick={activate} disabled={busy}>
              <CheckCircle2 size={16} /> Előfizetés indítása (demó)
            </Button>
          )}
          {company.subscriptionStatus === 'active' && (
            <Button variant="danger" onClick={cancel} disabled={busy}>
              Előfizetés lemondása
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}
