// Kötelező kétlépcsős azonosítás (Supabase MFA, TOTP): a jelszó után a hitelesítő alkalmazás kódja; első
// alkalommal a beállítás (QR-kód). Amíg ez nincs meg, a program semmilyen adatot nem tölt be.
import { useEffect, useState } from 'react'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Field, Input } from '../../components/ui'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

function hibaSzoveg(uzenet: string): string {
  if (/invalid|expired/i.test(uzenet)) return 'A kód nem megfelelő vagy lejárt. Írd be a hitelesítő alkalmazásban éppen látható kódot.'
  if (/rate|too many/i.test(uzenet)) return 'Túl sok próbálkozás. Várj egy kicsit, majd próbáld újra.'
  return uzenet
}

export function Ketlepcsos({ beallitas }: { beallitas: boolean }) {
  const { signOut, mfaUjraellenorzes } = useAuth()
  const [kod, setKod] = useState('')
  const [hiba, setHiba] = useState<string | null>(null)
  const [folyamatban, setFolyamatban] = useState(false)
  const [uj, setUj] = useState<{ factorId: string; qr: string; titok: string } | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)

  useEffect(() => {
    if (beallitas || !supabase) return
    void supabase.auth.mfa.listFactors().then(({ data }) => setFactorId(data?.totp.find((f) => f.status === 'verified')?.id ?? null))
  }, [beallitas])

  async function qrKeres() {
    if (!supabase) return
    setHiba(null)
    setFolyamatban(true)
    try {
      // Egy korábban félbehagyott (nem ellenőrzött) beállítás ne akadályozza az újat.
      const { data: lista } = await supabase.auth.mfa.listFactors()
      for (const f of lista?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Készletkezelő ${new Date().toISOString().slice(0, 10)}` })
      if (error || !data) throw new Error(error?.message ?? 'A beállítás nem indítható.')
      setUj({ factorId: data.id, qr: data.totp.qr_code, titok: data.totp.secret })
    } catch (e) {
      setHiba(hibaSzoveg((e as Error).message))
    } finally {
      setFolyamatban(false)
    }
  }

  async function ellenoriz(e: React.FormEvent) {
    e.preventDefault()
    const id = uj?.factorId ?? factorId
    if (!supabase || !id) return
    setHiba(null)
    setFolyamatban(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: kod.trim() })
    setFolyamatban(false)
    if (error) {
      setHiba(hibaSzoveg(error.message))
      return
    }
    await mfaUjraellenorzes()
  }

  const kodMezo = (
    <Field label="A hitelesítő alkalmazásban látható 6 jegyű kód">
      <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={kod} onChange={(e) => setKod(e.target.value.replace(/\D/g, ''))} autoFocus required />
    </Field>
  )

  return (
    <AuthLayout title={beallitas ? 'Kétlépcsős azonosítás beállítása' : 'Kétlépcsős azonosítás'}>
      {beallitas && (
        <p className="mb-3 text-sm text-[var(--color-text-muted)]">
          A belépéshez a jelszó mellett egy telefonos hitelesítő alkalmazás (pl. Google Authenticator, Microsoft Authenticator) kódja is kell. Ez
          mindenkinek kötelező, egyszer kell beállítani.
        </p>
      )}
      {beallitas && !uj ? (
        <Button type="button" className="w-full" disabled={folyamatban} onClick={() => void qrKeres()}>
          QR-kód kérése
        </Button>
      ) : (
        <form onSubmit={ellenoriz}>
          {uj && (
            <div className="mb-3 text-sm">
              <p className="mb-2">1. Olvasd be a QR-kódot a hitelesítő alkalmazással:</p>
              <img src={uj.qr} alt="QR-kód a hitelesítő alkalmazáshoz" width={200} height={200} className="mx-auto bg-white p-2" />
              <p className="mt-2 text-[var(--color-text-muted)]">
                Ha nem tudod beolvasni, írd be kézzel ezt a kulcsot: <code data-totp-titok>{uj.titok}</code>
              </p>
              <p className="mt-2">2. Írd be az alkalmazás által mutatott kódot:</p>
            </div>
          )}
          {kodMezo}
          <Button type="submit" className="w-full" disabled={folyamatban || kod.length !== 6}>
            {uj ? 'Bekapcsolás és belépés' : 'Belépés'}
          </Button>
        </form>
      )}
      {hiba && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
          {hiba}
        </p>
      )}
      {!beallitas && (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          Elveszett a telefonod? Szólj az üzemeltetőnek: ő törölheti a régi beállítást, és belépéskor újra beállíthatod.
        </p>
      )}
      <div className="mt-4 text-center text-sm">
        <button type="button" onClick={() => void signOut()} className="text-[var(--color-primary)] hover:underline">
          Kijelentkezés
        </button>
      </div>
    </AuthLayout>
  )
}
