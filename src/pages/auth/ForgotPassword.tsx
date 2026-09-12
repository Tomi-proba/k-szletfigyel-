import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Field, Input } from '../../components/ui'

export function ForgotPassword({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: resetError } = await requestPasswordReset(email.trim())
    setSubmitting(false)
    if (resetError) return setError(resetError)
    setSent(true)
  }

  if (sent) {
    return (
      <AuthLayout title="Email elküldve">
        <p className="text-sm text-[var(--color-text)]">
          Ha létezik fiók ehhez az email címhez ({email}), küldtünk rá egy jelszó-visszaállító linket.
        </p>
        <Button className="mt-4 w-full" onClick={onSwitchToLogin}>
          Vissza a bejelentkezéshez
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Elfelejtett jelszó" subtitle="Add meg az email címed, és küldünk egy jelszó-visszaállító linket.">
      <form onSubmit={handleSubmit}>
        <Field label="Email cím">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </Field>
        {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Küldés…' : 'Visszaállító link küldése'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-[var(--color-text-muted)]">
        <button type="button" onClick={onSwitchToLogin} className="font-medium text-[var(--color-primary)] hover:underline">
          Vissza a bejelentkezéshez
        </button>
      </p>
    </AuthLayout>
  )
}
