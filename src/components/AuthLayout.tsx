import type { ReactNode } from 'react'
import { Card } from './ui'

/** Centered-card shell for the logged-out auth screens (Login/Register/
 * ForgotPassword/ResetPassword) - deliberately separate from the main
 * Layout.tsx, since there's no sidebar/nav to show before the user is
 * authenticated. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-xl font-bold text-[var(--color-text)]">Készletfigyelő</div>
        </div>
        <Card>
          <h1 className="mb-1 text-lg font-semibold text-[var(--color-text)]">{title}</h1>
          {subtitle && <p className="mb-4 text-sm text-[var(--color-text-muted)]">{subtitle}</p>}
          {children}
        </Card>
      </div>
    </div>
  )
}
