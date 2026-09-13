// Route-level enforcement for the raktáros/iroda role split (see
// DOCUMENTATION.md 14. fejezet) - hiding a nav link isn't enough on its own
// in a client-side SPA, since a raktáros could still type an iroda-only
// route straight into the address bar. This is the actual guard; Layout.tsx
// additionally hides the nav links so a raktáros never sees them offered in
// the first place.
import type { ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import type { UserRole } from '../types/auth'
import { EmptyState, PageHeader } from './ui'

export function RoleGate({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { effectiveRole } = useAuth()

  // No role at all (no Supabase configured and no "?demo_szerepkor=" - see
  // useAuth.tsx readDemoRole - or Supabase configured but the profile
  // hasn't loaded yet) means the raktáros/iroda split doesn't apply here,
  // so everything stays visible, exactly as before this feature existed.
  if (!effectiveRole || roles.includes(effectiveRole)) return <>{children}</>

  return (
    <div>
      <PageHeader title="Nincs jogosultságod" />
      <EmptyState>Ehhez az oldalhoz a szerepköröd (raktáros) nem fér hozzá - ezt csak iroda-jogosultsággal lehet elérni.</EmptyState>
    </div>
  )
}
