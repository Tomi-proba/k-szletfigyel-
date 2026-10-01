// Jóváhagyások oldal - kizárólag fő iroda jogosultság (lásd App.tsx
// RoleGate). Itt látja és bírálja el a fő iroda az 'iroda' szerepkör
// telephely/termék törzsadat-módosítási kéréseit - lásd
// types/auth.ts PendingChange, store/useStore.ts approvePendingChange/
// rejectPendingChange, supabase/schema.sql pending_changes tábla.
import { useMemo, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Button, Card, EmptyState, Field, PageHeader, Textarea } from '../components/ui'
import { Modal } from '../components/Modal'
import { formatDateTime } from '../lib/format'

export function Approvals() {
  const allPendingChanges = useStore((s) => s.pendingChanges)
  const approvePendingChange = useStore((s) => s.approvePendingChange)
  const rejectPendingChange = useStore((s) => s.rejectPendingChange)

  const pending = useMemo(() => allPendingChanges.filter((c) => c.status === 'pending').sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1)), [allPendingChanges])
  const decided = useMemo(
    () => allPendingChanges.filter((c) => c.status !== 'pending').sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1)),
    [allPendingChanges],
  )

  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  function closeRejectModal() {
    setRejectingId(null)
    setReason('')
  }

  return (
    <div>
      <PageHeader title="Jóváhagyások" subtitle="Az iroda törzsadat-módosítási kérései - telephely és termék adatok" />

      {pending.length === 0 ? (
        <EmptyState>Nincs jóváhagyásra váró módosítás.</EmptyState>
      ) : (
        <Card className="mb-5 overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-medium">Mi</th>
                <th className="px-4 py-3 font-medium">Ki kérte</th>
                <th className="px-4 py-3 font-medium">Mikor</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {pending.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="px-4 py-3">{c.summary}</td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.requestedByEmail ?? '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-muted)]">{formatDateTime(c.requestedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => approvePendingChange(c.id)}
                      aria-label="Jóváhagyás"
                      title="Jóváhagyás"
                      className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-success)]"
                    >
                      <CheckCircle2 size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectingId(c.id)}
                      aria-label="Elutasítás"
                      title="Elutasítás"
                      className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-danger)]"
                    >
                      <XCircle size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {decided.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <div className="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold text-[var(--color-text)]">Korábbi döntések</div>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-medium">Mi</th>
                <th className="px-4 py-3 font-medium">Ki kérte</th>
                <th className="px-4 py-3 font-medium">Állapot</th>
                <th className="px-4 py-3 font-medium">Ki döntött</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="px-4 py-3">{c.summary}</td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.requestedByEmail ?? '—'}</td>
                  <td className="px-4 py-3">
                    {c.status === 'approved' ? (
                      <span className="rounded-full bg-[var(--color-success-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--color-success)]">Jóváhagyva</span>
                    ) : (
                      <span className="rounded-full bg-[var(--color-danger-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--color-danger)]">
                        Elutasítva{c.rejectReason ? `: ${c.rejectReason}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.reviewedByEmail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {rejectingId && (
        <Modal title="Módosítás elutasítása" onClose={closeRejectModal}>
          <Field label="Indoklás (opcionális, az irodának látszik)">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={closeRejectModal}>
              Mégse
            </Button>
            <Button
              onClick={() => {
                rejectPendingChange(rejectingId, reason.trim() || undefined)
                closeRejectModal()
              }}
            >
              Elutasítás
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
