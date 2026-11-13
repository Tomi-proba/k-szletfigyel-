// A bejövő tétel szállítója (AWEBOLDAL TERV.md F28): a fő iroda adja meg rendeléskor és a raktári bejelentés
// elfogadásakor; a raktáros csak megnézi (szallitoNeve). Üresen a termék szállítója érvényes.
import { useStore } from '../store/useStore'
import type { Movement, Product } from '../types'
import { Select } from './ui'

/** A tétel szállítójának neve: a tételé, ha nincs, a termékéé; null, ha egyik sincs. */
export function useSzallitoNeve(m: Pick<Movement, 'supplierId'> | null, termek: Pick<Product, 'supplierId'> | undefined | null): string | null {
  const suppliers = useStore((s) => s.suppliers)
  const id = m?.supplierId ?? termek?.supplierId
  return (id && suppliers.find((s) => s.id === id)?.name) || null
}

export function SzallitoValaszto({
  value,
  onChange,
  id,
  kotelezo,
}: {
  value: string
  onChange: (id: string) => void
  id?: string
  kotelezo?: boolean
}) {
  const suppliers = useStore((s) => s.suppliers).filter((s) => !s.deletedAt || s.id === value)
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-required={kotelezo || undefined} data-szallito-valaszto>
      <option value="">{kotelezo ? 'Válasszon szállítót…' : 'Nincs megadva'}</option>
      {[...suppliers]
        .sort((a, b) => a.name.localeCompare(b.name, 'hu'))
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
    </Select>
  )
}
