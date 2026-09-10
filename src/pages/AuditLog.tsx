import { FileSpreadsheet, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { AuditAction, AuditEntityType } from '../types'
import { ACTION_LABELS, ENTITY_TYPE_LABELS } from '../lib/audit'
import { Button, Card, EmptyState, Input, PageHeader, Select } from '../components/ui'
import { formatDateTime } from '../lib/format'
import { isoDaysAgo, todayISO } from '../lib/dates'
import { exportToExcel, exportToPdf, type ExportColumn } from '../lib/export'

interface AuditRow {
  timestamp: string
  entityType: string
  entityLabel: string
  action: string
  description: string
  changes: string
}

export function AuditLog() {
  const auditLog = useStore((s) => s.auditLog)

  const [from, setFrom] = useState(isoDaysAgo(90))
  const [to, setTo] = useState(todayISO())
  const [entityTypeFilter, setEntityTypeFilter] = useState<'' | AuditEntityType>('')
  const [actionFilter, setActionFilter] = useState<'' | AuditAction>('')

  const filtered = useMemo(() => {
    const fromTs = `${from}T00:00:00`
    const toTs = `${to}T23:59:59.999`
    return auditLog
      .filter((e) => e.timestamp >= fromTs && e.timestamp <= toTs)
      .filter((e) => !entityTypeFilter || e.entityType === entityTypeFilter)
      .filter((e) => !actionFilter || e.action === actionFilter)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  }, [auditLog, from, to, entityTypeFilter, actionFilter])

  const rows: AuditRow[] = filtered.map((e) => ({
    timestamp: formatDateTime(e.timestamp),
    entityType: ENTITY_TYPE_LABELS[e.entityType],
    entityLabel: e.entityLabel,
    action: ACTION_LABELS[e.action],
    description: e.description,
    changes: (e.changes ?? []).map((c) => `${c.label}: ${c.oldValue} → ${c.newValue}`).join('; '),
  }))

  const columns: ExportColumn<AuditRow>[] = [
    { header: 'Időbélyeg', accessor: (r) => r.timestamp, width: 20 },
    { header: 'Típus', accessor: (r) => r.entityType, width: 16 },
    { header: 'Tétel', accessor: (r) => r.entityLabel, width: 26 },
    { header: 'Művelet', accessor: (r) => r.action, width: 14 },
    { header: 'Leírás', accessor: (r) => r.description, width: 36 },
    { header: 'Változások', accessor: (r) => r.changes, width: 44 },
  ]

  return (
    <div>
      <PageHeader
        title="Audit napló"
        subtitle="Minden létrehozás, módosítás, törlés, visszaállítás és visszavonás időrendben, az egész rendszerben"
        actions={
          <>
            <Button variant="secondary" onClick={() => exportToExcel(`audit_naplo_${from}_${to}.xlsx`, 'Audit napló', columns, rows)}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportToPdf(`audit_naplo_${from}_${to}.pdf`, 'Audit napló', columns, rows)}>
              <FileText size={16} /> PDF
            </Button>
          </>
        }
      />

      <Card className="mb-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Ettől</span>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Eddig</span>
            <Input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Entitás típusa</span>
            <Select value={entityTypeFilter} onChange={(e) => setEntityTypeFilter(e.target.value as '' | AuditEntityType)}>
              <option value="">Összes</option>
              {(Object.keys(ENTITY_TYPE_LABELS) as AuditEntityType[]).map((t) => (
                <option key={t} value={t}>
                  {ENTITY_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[var(--color-text)]">Művelet típusa</span>
            <Select value={actionFilter} onChange={(e) => setActionFilter(e.target.value as '' | AuditAction)}>
              <option value="">Összes</option>
              {(Object.keys(ACTION_LABELS) as AuditAction[]).map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a]}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState>Nincs a szűrésnek megfelelő eseménynapló-bejegyzés.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-medium">Időbélyeg</th>
                <th className="px-4 py-3 font-medium">Típus</th>
                <th className="px-4 py-3 font-medium">Tétel</th>
                <th className="px-4 py-3 font-medium">Művelet</th>
                <th className="px-4 py-3 font-medium">Leírás / változások</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--color-text-muted)]">{formatDateTime(e.timestamp)}</td>
                  <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{ENTITY_TYPE_LABELS[e.entityType]}</td>
                  <td className="px-4 py-3 font-medium text-[var(--color-text)]">{e.entityLabel}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-[var(--color-text)]">
                      {ACTION_LABELS[e.action]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[var(--color-text)]">{e.description}</div>
                    {e.changes && e.changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-text-muted)]">
                        {e.changes.map((c) => (
                          <li key={c.field}>
                            {c.label}: <span className="text-[var(--color-danger)] line-through">{c.oldValue}</span> →{' '}
                            <span className="text-[var(--color-success)]">{c.newValue}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
