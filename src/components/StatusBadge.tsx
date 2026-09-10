import type { StockStatus } from '../lib/alerts'

const STYLES: Record<StockStatus, { label: string; className: string }> = {
  low: { label: 'Alacsony', className: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]' },
  'slow-moving': { label: 'Lassan fogyó', className: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]' },
  normal: { label: 'Normál', className: 'bg-[var(--color-success-bg)] text-[var(--color-success)]' },
}

export function StatusBadge({ status }: { status: StockStatus }) {
  const s = STYLES[status]
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  )
}
