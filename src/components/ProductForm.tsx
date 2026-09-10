import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Product } from '../types'
import { COMMON_UNITS } from '../types'
import { Button, Field, Input, Select } from './ui'

interface ProductFormProps {
  product?: Product
  onDone: () => void
}

export function ProductForm({ product, onDone }: ProductFormProps) {
  const addProduct = useStore((s) => s.addProduct)
  const updateProduct = useStore((s) => s.updateProduct)
  const suppliers = useStore((s) => s.suppliers)
  const locations = useStore((s) => s.locations)
  const products = useStore((s) => s.products)
  // Computed with useMemo, not inline in the selector - a selector that
  // allocates a new array every call breaks zustand's useSyncExternalStore
  // snapshot caching and can trigger an infinite render loop.
  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category))).sort(), [products])

  const [name, setName] = useState(product?.name ?? '')
  const [sku, setSku] = useState(product?.sku ?? '')
  const [category, setCategory] = useState(product?.category ?? '')
  const [unit, setUnit] = useState(product?.unit ?? COMMON_UNITS[0])
  const [currentStock, setCurrentStock] = useState(String(product?.currentStock ?? 0))
  const [minStock, setMinStock] = useState(String(product?.minStock ?? 0))
  const [purchasePrice, setPurchasePrice] = useState(String(product?.purchasePrice ?? 0))
  const [salePrice, setSalePrice] = useState(String(product?.salePrice ?? 0))
  const [supplierId, setSupplierId] = useState(product?.supplierId ?? '')
  const [locationId, setLocationId] = useState(product?.locationId ?? locations[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const stockNum = Number(currentStock)
    const minNum = Number(minStock)
    const purchaseNum = Number(purchasePrice)
    const saleNum = Number(salePrice)

    if (!name.trim()) return setError('A termék nevét kötelező megadni.')
    if (!category.trim()) return setError('A kategóriát kötelező megadni.')
    if (!locationId) return setError('Válassz telephelyet.')
    if ([stockNum, minNum, purchaseNum, saleNum].some((n) => !Number.isFinite(n) || n < 0)) {
      return setError('A készlet, a küszöb és az árak nem lehetnek negatívak.')
    }

    const payload = {
      name: name.trim(),
      sku: sku.trim() || undefined,
      category: category.trim(),
      unit,
      currentStock: stockNum,
      minStock: minNum,
      purchasePrice: purchaseNum,
      salePrice: saleNum,
      supplierId: supplierId || undefined,
      locationId,
    }

    if (product) {
      updateProduct(product.id, payload)
    } else {
      addProduct(payload)
    }
    onDone()
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Termék neve">
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Cikkszám (opcionális)">
          <Input value={sku} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <Field label="Kategória">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} list="category-options" required />
          <datalist id="category-options">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Mértékegység">
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} list="unit-options" required />
          <datalist id="unit-options">
            {COMMON_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
        <Field label="Telephely">
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={product ? 'Aktuális készlet' : 'Kezdő készlet'}>
          <Input type="number" min={0} step="any" value={currentStock} onChange={(e) => setCurrentStock(e.target.value)} required />
        </Field>
        <Field label="Minimum készletszint (riasztási küszöb)">
          <Input type="number" min={0} step="any" value={minStock} onChange={(e) => setMinStock(e.target.value)} required />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Beszerzési ár (Ft)">
          <Input type="number" min={0} step="any" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} required />
        </Field>
        <Field label="Eladási ár (Ft)">
          <Input type="number" min={0} step="any" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} required />
        </Field>
      </div>

      <Field label="Beszállító (opcionális)">
        <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Nincs megadva</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>

      {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Mégse
        </Button>
        <Button type="submit">{product ? 'Mentés' : 'Létrehozás'}</Button>
      </div>
    </form>
  )
}
