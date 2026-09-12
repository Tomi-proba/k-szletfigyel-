import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Field, Input } from '../../components/ui'

/** Shown when the user lands on the app via a Supabase password-recovery
 * link - see AuthGate.tsx for how the "?code=" query param is detected and
 * routed here, and useAuth.tsx's requestPasswordReset for why that's a
 * query param rather than a "#..." hash token (HashRouter compatibility). */
export function ResetPassword({ onDone }: { onDone: () => void }) {
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [passwordAgain, setPasswordAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) return setError('A jelszónak legalább 6 karakter hosszúnak kell lennie.')
    if (password !== passwordAgain) return setError('A két jelszó nem egyezik.')

    setSubmitting(true)
    const { error: updateError } = await updatePassword(password)
    setSubmitting(false)
    if (updateError) return setError(updateError)
    setDone(true)
  }

  if (done) {
    return (
      <AuthLayout title="Jelszó frissítve">
        <p className="mb-4 text-sm text-[var(--color-text)]">Az új jelszavaddal már be is vagy jelentkezve.</p>
        <Button className="w-full" onClick={onDone}>
          Tovább az alkalmazásba
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Új jelszó beállítása">
      <form onSubmit={handleSubmit}>
        <Field label="Új jelszó">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
        </Field>
        <Field label="Új jelszó megerősítése">
          <Input type="password" value={passwordAgain} onChange={(e) => setPasswordAgain(e.target.value)} required />
        </Field>
        {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Mentés…' : 'Jelszó mentése'}
        </Button>
      </form>
    </AuthLayout>
  )
}
