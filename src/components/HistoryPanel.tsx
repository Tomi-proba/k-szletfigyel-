import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import type { AuditAction, AuditEntityType } from '../types'
import { ACTION_LABELS } from '../lib/audit'
import { formatDateTime } from '../lib/format'

const ACTION_COLORS: Record<AuditAction, string> = {
  create: 'text-[var(--color-success)]',
  update: 'text-[var(--color-primary)]',
  delete: 'text-[var(--color-danger)]',
  restore: 'text-[var(--color-success)]',
  cancel: 'text-[var(--color-danger)]',
  correction: 'text-[var(--color-warning)]',
}

/** A chronological (newest first) "Előzmények" panel for one entity, sourced
 * from the shared audit log (see types/index.ts's AuditLogEntry and
 * lib/audit.ts's diffing) - the same data also backs the standalone Audit
 * napló page, just filtered down to entityType + entityId here. */
export function HistoryPanel({ entityType, entityId }: { entityType: AuditEntityType; entityId: string }) {
  const auditLog = useStore((s) => s.auditLog)
  const entries = useMemo(
    () =>
      auditLog
        .filter((e) => e.entityType === entityType && e.entityId === entityId)
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
    [auditLog, entityType, entityId],
  )

  if (entries.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Még nincs rögzített módosítás ehhez a tételhez.</p>
  }

  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <div key={e.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className={`font-medium ${ACTION_COLORS[e.action]}`}>{ACTION_LABELS[e.action]}</span>
            <span className="text-xs text-[var(--color-text-muted)]">{formatDateTime(e.timestamp)}</span>
          </div>
          <div className="mt-1 text-[var(--color-text-muted)]">{e.description}</div>
          {e.changes && e.changes.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2 text-xs">
              {e.changes.map((c) => (
                <li key={c.field}>
                  <span className="font-medium text-[var(--color-text)]">{c.label}:</span>{' '}
                  <span className="text-[var(--color-danger)] line-through">{c.oldValue}</span>{' '}
                  <span className="text-[var(--color-text-muted)]">→</span>{' '}
                  <span className="text-[var(--color-success)]">{c.newValue}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
