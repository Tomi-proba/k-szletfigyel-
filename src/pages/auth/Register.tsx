import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Field, Input } from '../../components/ui'

export function Register({ onSwitchToLogin, inviteToken }: { onSwitchToLogin: () => void; inviteToken?: string }) {
  const { signUp } = useAuth()
  const isInvite = Boolean(inviteToken)
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordAgain, setPasswordAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isInvite && !companyName.trim()) return setError('Add meg a vállalkozásod nevét.')
    if (!email.trim()) return setError('Add meg az email címedet.')
    if (password.length < 6) return setError('A jelszónak legalább 6 karakter hosszúnak kell lennie.')
    if (password !== passwordAgain) return setError('A két jelszó nem egyezik.')

    setSubmitting(true)
    const { error: signUpError } = await signUp(email.trim(), password, companyName, inviteToken)
    setSubmitting(false)
    if (signUpError) return setError(signUpError)
    setDone(true)
  }

  if (done) {
    return (
      <AuthLayout title={isInvite ? 'Sikeres csatlakozás' : 'Sikeres regisztráció'}>
        <p className="text-sm text-[var(--color-text)]">
          Ha a fiókod emailes megerősítést igényel, nézd meg a postaládádat ({email}) - a megerősítő linkre kattintva tudsz majd
          bejelentkezni. Ha nem, akkor már be is léphetsz.
        </p>
        <Button className="mt-4 w-full" onClick={onSwitchToLogin}>
          Ugrás a bejelentkezéshez
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={isInvite ? 'Csatlakozás meghívóval' : 'Regisztráció'}
      subtitle={isInvite ? 'Hozz létre egy jelszót a fiókodhoz - a meghívó már tartalmazza, melyik céghez és milyen szerepkörrel csatlakozol.' : '14 napos próbaidőszak, kártyaadat megadása nélkül.'}
    >
      <form onSubmit={handleSubmit}>
        {!isInvite && (
          <Field label="Vállalkozás neve">
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoFocus required />
          </Field>
        )}
        <Field label="Email cím">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={isInvite} required />
        </Field>
        <Field label="Jelszó">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Jelszó megerősítése">
          <Input type="password" value={passwordAgain} onChange={(e) => setPasswordAgain(e.target.value)} required />
        </Field>
        {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? (isInvite ? 'Csatlakozás…' : 'Regisztráció…') : isInvite ? 'Csatlakozás' : 'Regisztráció'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-[var(--color-text-muted)]">
        Van már fiókod?{' '}
        <button type="button" onClick={onSwitchToLogin} className="font-medium text-[var(--color-primary)] hover:underline">
          Jelentkezz be
        </button>
      </p>
    </AuthLayout>
  )
}
