// Csapat (Team) oldal - iroda-jogosultsághoz kötött. Itt hoz létre az iroda
// meghívót egy új raktáros (vagy másik iroda-tag) felhasználónak, és itt
// látja, ki melyik telephelyhez van rendelve. A meghívó egy egyszer
// felhasználható, 7 napig érvényes token - lásd supabase/schema.sql
// invites tábla + handle_new_user() trigger, és pages/auth/Register.tsx a
// csatlakozás oldalán.
import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { mapInviteRow, type Invite, type UserRole } from '../types/auth'
import { Button, Card, EmptyState, Field, PageHeader, Select } from '../components/ui'
import { formatDate } from '../lib/format'
import { Copy, UserPlus } from 'lucide-react'

interface CompanyUserRow {
  id: string
  email: string
  role: UserRole
  assignedLocationName: string | null
  isPlatformAdmin: boolean
}

export function Team() {
  const { profile, company } = useAuth()
  const locations = useStore((s) => s.locations.filter((l) => !l.deletedAt))

  const [users, setUsers] = useState<CompanyUserRow[] | null>(null)
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [role, setRole] = useState<UserRole>('raktaros')
  const [locationId, setLocationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newLink, setNewLink] = useState<string | null>(null)

  async function reload() {
    if (!supabase || !company) return
    const [usersRes, invitesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('company_id', company.id),
      supabase.from('invites').select('*').eq('company_id', company.id).order('created_at', { ascending: false }),
    ])
    if (usersRes.data) {
      setUsers(
        usersRes.data.map((row) => ({
          id: row.id as string,
          email: row.email as string,
          role: (row.role as UserRole) ?? 'iroda',
          assignedLocationName: (row.assigned_location_name as string | null) ?? null,
          isPlatformAdmin: Boolean(row.is_platform_admin),
        })),
      )
    }
    if (invitesRes.data) setInvites(invitesRes.data.map(mapInviteRow))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id])

  if (!company) return null

  async function createInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase || !company) return
    setError(null)
    if (role === 'raktaros' && !locationId) {
      setError('Válassz telephelyet a raktáros-meghívóhoz.')
      return
    }
    const location = locations.find((l) => l.id === locationId)
    setBusy(true)
    const { data, error: insertError } = await supabase
      .from('invites')
      .insert({
        company_id: company.id,
        role,
        assigned_location_id: role === 'raktaros' ? locationId : null,
        assigned_location_name: role === 'raktaros' ? (location?.name ?? null) : null,
        created_by: profile?.id,
      })
      .select('*')
      .single()
    setBusy(false)
    if (insertError || !data) {
      setError(insertError?.message ?? 'Ismeretlen hiba.')
      return
    }
    const token = data.token as string
    setNewLink(`${window.location.origin}${window.location.pathname}?meghivo=${token}`)
    reload()
  }

  const pendingInvites = invites?.filter((i) => !i.usedAt && new Date(i.expiresAt).getTime() > Date.now()) ?? []
  const otherInvites = invites?.filter((i) => i.usedAt || new Date(i.expiresAt).getTime() <= Date.now()) ?? []

  return (
    <div>
      <PageHeader title="Csapat" subtitle="Felhasználók meghívása és telephelyhez rendelése" />

      <Card className="mb-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Új felhasználó meghívása</h2>
        <form onSubmit={createInvite} className="flex flex-wrap items-end gap-3">
          <Field label="Szerepkör">
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="raktaros">Raktáros (egy telephelyhez kötve)</option>
              <option value="iroda">Iroda (teljes hozzáférés)</option>
            </Select>
          </Field>
          {role === 'raktaros' && (
            <Field label="Telephely">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Válassz…</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button type="submit" disabled={busy}>
            <UserPlus size={16} /> Meghívó létrehozása
          </Button>
        </form>
        {error && <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
        {newLink && (
          <div className="mt-4 rounded-lg bg-[var(--color-info-bg)] p-3 text-sm text-[var(--color-primary)]">
            <p className="mb-2">Küldd el ezt a linket a meghívottnak (7 napig érvényes, egyszer használható fel):</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-white/60 px-2 py-1 text-xs">{newLink}</code>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigator.clipboard?.writeText(newLink)}
                aria-label="Link másolása"
              >
                <Copy size={14} />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Felhasználók</h2>
        {!users ? (
          <EmptyState>Betöltés…</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="py-2 font-medium">Email</th>
                  <th className="py-2 font-medium">Szerepkör</th>
                  <th className="py-2 font-medium">Telephely</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="py-2">
                      {u.email} {u.isPlatformAdmin && <span className="text-xs text-[var(--color-text-muted)]">(üzemeltető)</span>}
                    </td>
                    <td className="py-2">{u.role === 'raktaros' ? 'Raktáros' : 'Iroda'}</td>
                    <td className="py-2">{u.assignedLocationName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pendingInvites.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Függőben lévő meghívók</h2>
          <ul className="flex flex-col gap-2 text-sm text-[var(--color-text)]">
            {pendingInvites.map((i) => (
              <li key={i.id} className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 last:border-b-0">
                <span>
                  {i.role === 'raktaros' ? `Raktáros - ${i.assignedLocationName ?? 'ismeretlen telephely'}` : 'Iroda'}
                </span>
                <span className="text-[var(--color-text-muted)]">lejár: {formatDate(i.expiresAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {otherInvites.length > 0 && (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          {otherInvites.filter((i) => i.usedAt).length} felhasznált, {otherInvites.filter((i) => !i.usedAt).length} lejárt meghívó nem
          jelenik meg fent.
        </p>
      )}
    </div>
  )
}
