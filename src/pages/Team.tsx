// Csapat (Team) oldal - iroda-jogosultsághoz kötött. Itt hoz létre az iroda
// AZONNAL (regisztrációs lépés nélkül) egy új raktáros vagy iroda
// felhasználót: megadja az email címet és egy jelszót, a rendszer pedig a
// "create-team-member" Edge Function-ön keresztül (lásd
// supabase/functions/create-team-member/index.ts) rögtön létrehozza a
// bejelentkezést - a meghívottnak nem kell linkre kattintania vagy saját
// magának regisztrálnia, csak be kell jelentkeznie a kapott adatokkal.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import type { UserRole } from '../types/auth'
import { Button, Card, EmptyState, Field, Input, PageHeader, Select } from '../components/ui'
import { Check, Copy, Pencil, UserPlus, X } from 'lucide-react'

interface CompanyUserRow {
  id: string
  email: string
  /** Null a name mező bevezetése előtt létrejött fiókoknál - a táblázat
   * ilyenkor az email címet mutatja helyette. */
  name: string | null
  role: UserRole
  assignedLocationName: string | null
  isPlatformAdmin: boolean
}

const ROLE_LABELS: Record<UserRole, string> = {
  raktaros: 'Raktáros',
  iroda: 'Iroda',
  fo_iroda: 'Fő iroda',
  tulajdonos: 'Tulajdonos (csak olvasó)',
}

/** Elég erős, könnyen diktálható ideiglenes jelszó - a meghívott utána a
 * "Beállítások" oldalon vagy az "Elfelejtett jelszó" folyamattal bármikor
 * lecserélheti sajátra. */
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export function Team() {
  const { company, effectiveRole, updateMemberName } = useAuth()
  // 'iroda' csak raktáros/iroda szintű felhasználót hozhat létre - magasabb
  // jogú (fő iroda, tulajdonos) fiók létrehozása kizárólag fő iroda joga.
  // Lásd ugyanez az ellenőrzés szerver oldalon is: create-team-member Edge
  // Function (ez itt csak UI-kényelem, a valódi határ ott van).
  const assignableRoles: UserRole[] = effectiveRole === 'fo_iroda' ? ['raktaros', 'iroda', 'fo_iroda', 'tulajdonos'] : ['raktaros', 'iroda']
  // A `.filter()`-t NEM szabad közvetlenül a Zustand selectorban hívni -
  // az minden hívásnál új tömböt adna vissza, amit a React
  // useSyncExternalStore (amire a Zustand épül) instabil pillanatképnek
  // lát, és ez végtelen render-ciklust ("Maximum update depth exceeded",
  // React error #185) okoz - pontosan ez történt élesben. A nyers tömböt
  // kell kiolvasni, és a szűrést külön useMemo-ban elvégezni.
  const allLocations = useStore((s) => s.locations)
  const locations = useMemo(() => allLocations.filter((l) => !l.deletedAt), [allLocations])

  const [users, setUsers] = useState<CompanyUserRow[] | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('raktaros')
  const [locationId, setLocationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)

  // Mások nevét kizárólag fő iroda módosíthatja (lásd update_member_name
  // schema.sql-ben - ez itt csak a felület, a valódi határ a DB-ben van).
  const [editingNameFor, setEditingNameFor] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [nameEditError, setNameEditError] = useState<string | null>(null)

  async function saveEditedName(userId: string) {
    setNameEditError(null)
    if (!editingNameValue.trim()) {
      setNameEditError('A név nem lehet üres.')
      return
    }
    const { error: saveError } = await updateMemberName(userId, editingNameValue)
    if (saveError) {
      setNameEditError(saveError)
      return
    }
    setEditingNameFor(null)
    reload()
  }

  async function reload() {
    if (!supabase || !company) return
    const { data } = await supabase.from('profiles').select('*').eq('company_id', company.id)
    if (data) {
      setUsers(
        data.map((row) => ({
          id: row.id as string,
          email: row.email as string,
          name: (row.name as string | null) ?? null,
          role: (row.role as UserRole) ?? 'iroda',
          assignedLocationName: (row.assigned_location_name as string | null) ?? null,
          isPlatformAdmin: Boolean(row.is_platform_admin),
        })),
      )
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id])

  // Egyetlen telephelyes vállalkozásnál nincs mit "választani" - a raktáros
  // automatikusan az egyetlen telephelyhez kerül, legördülő nélkül.
  useEffect(() => {
    if (role === 'raktaros' && locations.length === 1) setLocationId(locations[0].id)
  }, [role, locations])

  if (!company) return null

  async function createTeamMember(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setError(null)
    setCreated(null)
    if (!name.trim()) {
      setError('Add meg a felhasználó nevét.')
      return
    }
    if (!email.trim()) {
      setError('Add meg az email címet.')
      return
    }
    if (role === 'raktaros' && !locationId) {
      setError('Válassz telephelyet a raktáros felhasználóhoz.')
      return
    }
    const location = locations.find((l) => l.id === locationId)
    const password = generateTempPassword()
    setBusy(true)
    const { data, error: invokeError } = await supabase.functions.invoke('create-team-member', {
      body: {
        email: email.trim(),
        password,
        name: name.trim(),
        role,
        assignedLocationId: role === 'raktaros' ? locationId : null,
        assignedLocationName: role === 'raktaros' ? (location?.name ?? null) : null,
      },
    })
    setBusy(false)
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? 'Ismeretlen hiba.')
      return
    }
    setCreated({ email: email.trim(), password })
    setName('')
    setEmail('')
    setLocationId('')
    reload()
  }

  return (
    <div>
      <PageHeader title="Csapat" subtitle="Új felhasználó létrehozása és telephelyhez rendelése" />

      <Card className="mb-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Új felhasználó létrehozása</h2>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">
          A felhasználó azonnal létrejön, nem kell neki regisztrálnia - a létrehozás után megkapott jelszóval rögtön be tud jelentkezni.
        </p>
        <form onSubmit={createTeamMember} className="flex flex-wrap items-end gap-3">
          <Field label="Név">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email cím">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Szerepkör">
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          {role === 'raktaros' && (
            <Field label="Telephely">
              {locations.length === 1 ? (
                <div className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)]">
                  {locations[0].name}
                </div>
              ) : (
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Válassz…</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Button type="submit" disabled={busy}>
            <UserPlus size={16} /> {busy ? 'Létrehozás…' : 'Felhasználó létrehozása'}
          </Button>
        </form>
        {error && <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
        {created && (
          <div className="mt-4 rounded-lg bg-[var(--color-info-bg)] p-3 text-sm text-[var(--color-primary)]">
            <p className="mb-2">
              Létrejött a fiók — add át ezt a két adatot a felhasználónak (ezt a jelszót csak most látod, később nem kereshető vissza):
            </p>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-white/60 px-2 py-1 text-xs">{created.email}</code>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-white/60 px-2 py-1 text-xs">{created.password}</code>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigator.clipboard?.writeText(`${created.email} / ${created.password}`)}
                  aria-label="Belépési adatok másolása"
                >
                  <Copy size={14} />
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Felhasználók</h2>
        {!users ? (
          <EmptyState>Betöltés…</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="py-2 font-medium">Név</th>
                  <th className="py-2 font-medium">Email</th>
                  <th className="py-2 font-medium">Szerepkör</th>
                  <th className="py-2 font-medium">Telephely</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="py-2">
                      {editingNameFor === u.id ? (
                        <div className="flex items-center gap-1">
                          <Input autoFocus value={editingNameValue} onChange={(e) => setEditingNameValue(e.target.value)} />
                          <button
                            type="button"
                            onClick={() => saveEditedName(u.id)}
                            aria-label="Mentés"
                            className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-success)]"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNameFor(null)
                              setNameEditError(null)
                            }}
                            aria-label="Mégse"
                            className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-danger)]"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span>{u.name ?? <span className="text-[var(--color-text-muted)]">—</span>}</span>
                          {effectiveRole === 'fo_iroda' && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNameFor(u.id)
                                setEditingNameValue(u.name ?? '')
                                setNameEditError(null)
                              }}
                              aria-label="Név szerkesztése"
                              className="rounded-lg p-1 text-[var(--color-text-muted)] hover:bg-black/5"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                        </div>
                      )}
                      {editingNameFor === u.id && nameEditError && (
                        <p className="mt-1 text-xs text-[var(--color-danger)]">{nameEditError}</p>
                      )}
                    </td>
                    <td className="py-2">
                      {u.email} {u.isPlatformAdmin && <span className="text-xs text-[var(--color-text-muted)]">(üzemeltető)</span>}
                    </td>
                    <td className="py-2">{ROLE_LABELS[u.role] ?? u.role}</td>
                    <td className="py-2">{u.assignedLocationName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
