// Route-level enforcement for the raktáros/iroda role split (see
// DOCUMENTATION.md 14. fejezet) - hiding a nav link isn't enough on its own
// in a client-side SPA, since a raktáros could still type an iroda-only
// route straight into the address bar. This is the actual guard; Layout.tsx
// additionally hides the nav links so a raktáros never sees them offered in
// the first place.
import type { ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import { isSupabaseConfigured } from '../lib/supabase'
import type { UserRole } from '../types/auth'
import { EmptyState, PageHeader } from './ui'

export function RoleGate({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { profile } = useAuth()

  // The raktáros/iroda role split only exists once the SaaS/multi-user layer
  // is active. The single-tenant app (Supabase not configured - the current
  // unconfigured web deploy, or the Electron desktop build) has no concept
  // of roles at all, so it keeps showing everything, exactly as before this
  // feature existed.
  if (!isSupabaseConfigured) return <>{children}</>
  if (!profile || roles.includes(profile.role)) return <>{children}</>

  return (
    <div>
      <PageHeader title="Nincs jogosultságod" />
      <EmptyState>Ehhez az oldalhoz a szerepköröd (raktáros) nem fér hozzá - ezt csak iroda-jogosultsággal lehet elérni.</EmptyState>
    </div>
  )
}
