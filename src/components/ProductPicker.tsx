import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Product } from '../types'
import { formatNumber } from '../lib/format'

interface ProductPickerProps {
  value: string | null
  onChange: (productId: string) => void
  locationFilter?: string | null
}

export function ProductPicker({ value, onChange, locationFilter }: ProductPickerProps) {
  const products = useStore((s) => s.products)
  const locations = useStore((s) => s.locations)
  const [query, setQuery] = useState('')

  const selected = products.find((p) => p.id === value) ?? null

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => (locationFilter ? p.locationId === locationFilter : true))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
      .slice(0, 50)
  }, [products, query, locationFilter])

  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? ''

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-black/5 px-3 py-2.5">
        <div>
          <div className="font-medium text-[var(--color-text)]">{selected.name}</div>
          <div className="text-xs text-[var(--color-text-muted)]">
            {selected.sku && `${selected.sku} · `}
            {locations.length > 1 && `${locationName(selected.locationId)} · `}
            készleten: {formatNumber(selected.currentStock)} {selected.unit}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Termék módosítása"
          className="rounded-full p-2 text-[var(--color-text-muted)] hover:bg-black/10"
        >
          <X size={18} />
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Keresés név, cikkszám vagy kategória szerint…"
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pl-10 pr-3 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
        />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)]">
        {results.length === 0 && <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">Nincs találat.</div>}
        {results.map((p: Product) => (
          <button
            type="button"
            key={p.id}
            onClick={() => onChange(p.id)}
            className="flex w-full items-center justify-between border-b border-[var(--color-border)] px-3 py-3 text-left last:border-b-0 hover:bg-black/5"
          >
            <div>
              <div className="font-medium text-[var(--color-text)]">{p.name}</div>
              <div className="text-xs text-[var(--color-text-muted)]">
                {p.sku && `${p.sku} · `}
                {p.category}
                {locations.length > 1 && ` · ${locationName(p.locationId)}`}
              </div>
            </div>
            <div className="whitespace-nowrap text-sm text-[var(--color-text-muted)]">
              {formatNumber(p.currentStock)} {p.unit}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
