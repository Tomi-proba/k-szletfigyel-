import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Field, Input } from '../../components/ui'

export function Login({ onSwitchToRegister, onSwitchToForgotPassword }: { onSwitchToRegister: () => void; onSwitchToForgotPassword: () => void }) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: signInError } = await signIn(email.trim(), password)
    setSubmitting(false)
    if (signInError) setError(signInError)
  }

  return (
    <AuthLayout title="Bejelentkezés">
      <form onSubmit={handleSubmit}>
        <Field label="Email cím">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </Field>
        <Field label="Jelszó">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Belépés…' : 'Belépés'}
        </Button>
      </form>
      <div className="mt-4 flex flex-col items-center gap-2 text-sm">
        <button type="button" onClick={onSwitchToForgotPassword} className="text-[var(--color-primary)] hover:underline">
          Elfelejtett jelszó?
        </button>
        <p className="text-[var(--color-text-muted)]">
          Még nincs fiókod?{' '}
          <button type="button" onClick={onSwitchToRegister} className="font-medium text-[var(--color-primary)] hover:underline">
            Regisztrálj
          </button>
        </p>
      </div>
    </AuthLayout>
  )
}
