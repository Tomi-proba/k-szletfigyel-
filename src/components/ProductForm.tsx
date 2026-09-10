import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Product } from '../types'
import { COMMON_UNITS } from '../types'
import { lotUnitCost } from '../lib/costing'
import { formatCurrency, formatDate, formatNumber } from '../lib/format'
import { Button, Card, Field, Input, Select } from './ui'

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
  const lots = useStore((s) => s.lots)
  const costingMethod = useStore((s) => s.settings.costingMethod)
  const productLots = useMemo(
    () => (product ? lots.filter((l) => l.productId === product.id).sort((a, b) => (a.date < b.date ? 1 : -1)) : []),
    [lots, product],
  )
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
        <div>
          <Field label={product ? (costingMethod === 'fifo' ? 'Legutóbbi beszerzési ár (Ft)' : 'Átlagos beszerzési ár (Ft)') : 'Kezdő beszerzési ár (Ft)'}>
            <Input type="number" min={0} step="any" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} required />
          </Field>
          {product && (
            <p className="-mt-2 mb-3 text-xs text-[var(--color-text-muted)]">
              {costingMethod === 'fifo'
                ? 'Minden bejövő mozgásnál az ott megadott árra frissül (a FIFO költségszámítás a tételes előzményekből dolgozik, lásd lent).'
                : 'Ezt minden bejövő mozgásnál automatikusan frissíti a rendszer, ha eltérő árat adsz meg (súlyozott átlag).'}
            </p>
          )}
        </div>
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

      {product && productLots.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Beszerzési tételek</h3>
          <Card className="max-h-56 overflow-y-auto p-0">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-surface)]">
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="px-3 py-2 font-medium">Dátum</th>
                  <th className="px-3 py-2 text-right font-medium">Mennyiség</th>
                  <th className="px-3 py-2 text-right font-medium">Maradék</th>
                  <th className="px-3 py-2 text-right font-medium">Áru ára</th>
                  <th className="px-3 py-2 text-right font-medium">Szállítás</th>
                  <th className="px-3 py-2 text-right font-medium">Egységköltség</th>
                </tr>
              </thead>
              <tbody>
                {productLots.map((lot) => (
                  <tr key={lot.id} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(lot.date)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(lot.quantity)}</td>
                    <td className="px-3 py-2 text-right">
                      {lot.remainingQuantity > 0 ? (
                        formatNumber(lot.remainingQuantity)
                      ) : (
                        <span className="text-[var(--color-text-muted)]">elfogyott</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{formatCurrency(lot.unitPrice)}</td>
                    <td className="px-3 py-2 text-right">{lot.shippingCost > 0 ? formatCurrency(lot.shippingCost) : '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(lotUnitCost(lot))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

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
