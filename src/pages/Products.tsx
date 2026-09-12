import { FileSpreadsheet, FileText, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAlerts } from '../hooks/useAlerts'
import { useAuth } from '../hooks/useAuth'
import { useStore } from '../store/useStore'
import type { Product } from '../types'
import { Modal } from '../components/Modal'
import { ProductForm } from '../components/ProductForm'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { StatusBadge } from '../components/StatusBadge'
import { Button, Card, Checkbox, EmptyState, Input, PageHeader, Select } from '../components/ui'
import { formatCurrency, formatNumber } from '../lib/format'
import { exportToExcel, exportToPdf, type ExportColumn } from '../lib/export'
import { getStockStatus, type StockStatus } from '../lib/alerts'

interface InventoryRow {
  name: string
  sku: string
  category: string
  locationName: string
  unit: string
  currentStock: number
  minStock: number
  status: StockStatus
  supplierName: string
  purchasePrice: number
  salePrice: number
}

const STATUS_LABEL: Record<StockStatus, string> = { low: 'Alacsony', 'slow-moving': 'Lassan fogyó', normal: 'Normál' }

export function Products() {
  const products = useStore((s) => s.products)
  const suppliers = useStore((s) => s.suppliers)
  const locations = useStore((s) => s.locations)
  const deleteProduct = useStore((s) => s.deleteProduct)
  const restoreProduct = useStore((s) => s.restoreProduct)
  const alerts = useAlerts()
  // A raktáros csak megtekinti a saját telephelye készletét - a beszerzési
  // ár/egységköltség érzékeny adatnak számít (lásd DOCUMENTATION.md 14.
  // fejezet), ezért rejtve marad, és a termék létrehozás/szerkesztés/törlés
  // is irodai jog marad. A telephely-szűrés magától eltűnik (nincs mit
  // szűrni): a `products`/`locations` tömb már csak a raktáros saját
  // telephelyét tartalmazza, mert a Supabase RLS eleve úgy szűri a
  // lekérdezést - lásd supabase/schema.sql.
  const { isWarehouseUser } = useAuth()

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Product | null>(null)

  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category))).sort(), [products])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products
      .filter((p) => showDeleted || !p.deletedAt)
      .filter((p) => !categoryFilter || p.category === categoryFilter)
      .filter((p) => !supplierFilter || p.supplierId === supplierFilter)
      .filter((p) => !locationFilter || p.locationId === locationFilter)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'))
  }, [products, search, categoryFilter, supplierFilter, locationFilter, showDeleted])

  const supplierName = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? '—'
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? '—'

  const inventoryRows: InventoryRow[] = filtered.map((p) => {
    const info = alerts.byProductId.get(p.id)
    const status = info ? info.status : getStockStatus(p.currentStock < p.minStock, false)
    return {
      name: p.name,
      sku: p.sku ?? '',
      category: p.category,
      locationName: locationName(p.locationId),
      unit: p.unit,
      currentStock: p.currentStock,
      minStock: p.minStock,
      status,
      supplierName: supplierName(p.supplierId),
      purchasePrice: p.purchasePrice,
      salePrice: p.salePrice,
    }
  })

  const inventoryColumns: ExportColumn<InventoryRow>[] = [
    { header: 'Termék', accessor: (r) => r.name, width: 28 },
    { header: 'Cikkszám', accessor: (r) => r.sku, width: 14 },
    { header: 'Kategória', accessor: (r) => r.category, width: 18 },
    ...(locations.length > 1 ? [{ header: 'Telephely', accessor: (r: InventoryRow) => r.locationName, width: 18 }] : []),
    { header: 'Készlet', accessor: (r) => r.currentStock, width: 12 },
    { header: 'Min. szint', accessor: (r) => r.minStock, width: 12 },
    { header: 'Egység', accessor: (r) => r.unit, width: 10 },
    { header: 'Státusz', accessor: (r) => STATUS_LABEL[r.status], width: 14 },
    { header: 'Beszállító', accessor: (r) => r.supplierName, width: 22 },
    ...(isWarehouseUser ? [] : [{ header: 'Beszerzési ár', accessor: (r: InventoryRow) => r.purchasePrice, width: 14 }]),
    { header: 'Eladási ár', accessor: (r) => r.salePrice, width: 14 },
  ]

  return (
    <div>
      <PageHeader
        title="Készlet"
        subtitle="Termékek kezelése és aktuális készletszintek"
        actions={
          <>
            <Button variant="secondary" onClick={() => exportToExcel('keszletlista.xlsx', 'Készletlista', inventoryColumns, inventoryRows)}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportToPdf('keszletlista.pdf', 'Készletlista', inventoryColumns, inventoryRows)}>
              <FileText size={16} /> PDF
            </Button>
            {!isWarehouseUser && (
              <Button onClick={() => setCreating(true)}>
                <Plus size={18} /> Új termék
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Keresés név vagy cikkszám alapján…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Összes kategória</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="">Összes beszállító</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {locations.length > 1 && (
            <Select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <option value="">Összes telephely</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <Checkbox label="Törölt termékek megjelenítése" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState>Nincs a szűrésnek megfelelő termék.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((product) => {
            const info = alerts.byProductId.get(product.id)
            const isDeleted = Boolean(product.deletedAt)
            return (
              <Card key={product.id} className={`flex flex-col gap-3 ${isDeleted ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className={`font-semibold text-[var(--color-text)] ${isDeleted ? 'line-through' : ''}`}>{product.name}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {product.sku && `${product.sku} · `}
                      {product.category}
                    </div>
                  </div>
                  {isDeleted ? (
                    <span className="whitespace-nowrap rounded-full bg-black/10 px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)]">
                      Törölve
                    </span>
                  ) : (
                    info && <StatusBadge status={info.status} />
                  )}
                </div>

                {locations.length > 1 && (
                  <div className="text-xs text-[var(--color-text-muted)]">Telephely: {locationName(product.locationId)}</div>
                )}

                <div className="flex items-baseline justify-between rounded-lg bg-black/5 px-3 py-2">
                  <span className="text-sm text-[var(--color-text-muted)]">Készlet</span>
                  <span className="text-lg font-bold text-[var(--color-text)]">
                    {formatNumber(product.currentStock)} {product.unit}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
                  <span>Min. szint: {formatNumber(product.minStock)} {product.unit}</span>
                  <span>Beszállító: {supplierName(product.supplierId)}</span>
                </div>
                <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
                  {!isWarehouseUser && <span>Beszerzési ár: {formatCurrency(product.purchasePrice)}</span>}
                  <span>Eladási ár: {formatCurrency(product.salePrice)}</span>
                </div>

                {!isWarehouseUser && (
                  <div className="mt-1 flex justify-end gap-2 border-t border-[var(--color-border)] pt-3">
                    {isDeleted ? (
                      <Button variant="secondary" onClick={() => restoreProduct(product.id)}>
                        <RotateCcw size={16} /> Visszaállítás
                      </Button>
                    ) : (
                      <>
                        <Button variant="secondary" onClick={() => setEditing(product)}>
                          <Pencil size={16} /> Szerkesztés
                        </Button>
                        <Button variant="danger" onClick={() => setDeleting(product)}>
                          <Trash2 size={16} />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {creating && (
        <Modal title="Új termék" onClose={() => setCreating(false)} wide>
          <ProductForm onDone={() => setCreating(false)} />
        </Modal>
      )}

      {editing && (
        <Modal title="Termék szerkesztése" onClose={() => setEditing(null)} wide>
          <ProductForm product={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Termék törlése"
          message={`Biztosan törlöd a(z) "${deleting.name}" terméket? A mozgásnapló bejegyzései megmaradnak, és a termék bármikor visszaállítható a "Törölt termékek megjelenítése" nézetből.`}
          confirmLabel="Törlés"
          danger
          onConfirm={() => {
            deleteProduct(deleting.id)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
