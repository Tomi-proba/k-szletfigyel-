// Üzemeltetői (platform admin) áttekintő - minden regisztrált vállalkozás,
// az előfizetési állapotuk és az összesített havi bevétel. Csak
// is_platform_admin = true jogosultsággal látható - lásd supabase/schema.sql
// (RLS: "Admin minden céget lát") a szerver-oldali kikényszerítésért. Ez a
// komponens saját magát is védi (nem admin usernek üres/hibaüzenetet mutat),
// de az igazi határ az adatbázisban van: egy nem-admin felhasználó
// lekérdezése RLS miatt eleve csak a saját cégét adná vissza, még akkor is,
// ha valahogy elérné ezt az oldalt.
import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { mapCompanyRow, type Company } from '../types/auth'
import { Card, EmptyState, PageHeader } from '../components/ui'
import { formatCurrency, formatDate } from '../lib/format'

const STATUS_LABELS: Record<string, string> = {
  trial: 'Próbaidőszak',
  active: 'Aktív',
  expired: 'Lejárt',
  cancelled: 'Lemondva',
}

const STATUS_CLASSES: Record<string, string> = {
  trial: 'bg-[var(--color-info-bg)] text-[var(--color-primary)]',
  active: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
  expired: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
  cancelled: 'bg-black/5 text-[var(--color-text-muted)]',
}

export function Admin() {
  const { profile } = useAuth()
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase || !profile?.isPlatformAdmin) return
    let cancelled = false
    supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (cancelled) return
        if (fetchError) setError(fetchError.message)
        else setCompanies((data ?? []).map(mapCompanyRow))
      })
    return () => {
      cancelled = true
    }
  }, [profile])

  if (!profile?.isPlatformAdmin) {
    return (
      <div>
        <PageHeader title="Admin" />
        <EmptyState>Ehhez az oldalhoz nincs jogosultságod.</EmptyState>
      </div>
    )
  }

  const activeCompanies = companies?.filter((c) => c.subscriptionStatus === 'active') ?? []
  const monthlyRevenueHuf = activeCompanies.reduce((sum, c) => sum + c.planPriceHuf, 0)

  return (
    <div>
      <PageHeader title="Admin" subtitle="Minden regisztrált vállalkozás és előfizetési állapotuk" />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Regisztrált vállalkozások</div>
          <div className="text-2xl font-bold text-[var(--color-text)]">{companies?.length ?? '—'}</div>
        </Card>
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Aktív előfizetők</div>
          <div className="text-2xl font-bold text-[var(--color-success)]">{activeCompanies.length}</div>
        </Card>
        <Card>
          <div className="text-sm text-[var(--color-text-muted)]">Havi bevétel (demó)</div>
          <div className="text-2xl font-bold text-[var(--color-text)]">{formatCurrency(monthlyRevenueHuf)}</div>
        </Card>
      </div>

      {error && <p className="mb-4 text-sm text-[var(--color-danger)]">{error}</p>}

      {!companies ? (
        <EmptyState>Betöltés…</EmptyState>
      ) : companies.length === 0 ? (
        <EmptyState>Még nincs regisztrált vállalkozás.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-medium">Vállalkozás</th>
                <th className="px-4 py-3 font-medium">Állapot</th>
                <th className="px-4 py-3 font-medium">Regisztrált</th>
                <th className="px-4 py-3 font-medium">Próbaidő vége / köv. fizetés</th>
                <th className="px-4 py-3 text-right font-medium">Havidíj</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="px-4 py-3 font-medium text-[var(--color-text)]">{c.name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASSES[c.subscriptionStatus] ?? ''}`}>
                      {STATUS_LABELS[c.subscriptionStatus] ?? c.subscriptionStatus}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-muted)]">{formatDate(c.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-muted)]">
                    {c.subscriptionStatus === 'trial' ? formatDate(c.trialEndsAt) : c.currentPeriodEnd ? formatDate(c.currentPeriodEnd) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">{formatCurrency(c.planPriceHuf)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
