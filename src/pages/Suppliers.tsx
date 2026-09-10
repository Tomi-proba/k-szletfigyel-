import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Supplier } from '../types'
import { Modal } from '../components/Modal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { HistoryPanel } from '../components/HistoryPanel'
import { Button, Card, Checkbox, EmptyState, Field, Input, PageHeader } from '../components/ui'

function SupplierForm({ supplier, onDone }: { supplier?: Supplier; onDone: () => void }) {
  const addSupplier = useStore((s) => s.addSupplier)
  const updateSupplier = useStore((s) => s.updateSupplier)
  const [name, setName] = useState(supplier?.name ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [email, setEmail] = useState(supplier?.email ?? '')
  const [leadTimeDays, setLeadTimeDays] = useState(String(supplier?.leadTimeDays ?? 7))
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const leadNum = Number(leadTimeDays)
    if (!name.trim()) return setError('A beszállító nevét kötelező megadni.')
    if (!Number.isFinite(leadNum) || leadNum < 0) return setError('A szállítási idő nem lehet negatív.')

    const payload = { name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined, leadTimeDays: leadNum }
    if (supplier) updateSupplier(supplier.id, payload)
    else addSupplier(payload)
    onDone()
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Beszállító neve">
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Telefonszám">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Átlagos szállítási idő (nap)">
        <Input type="number" min={0} value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} required />
      </Field>

      {supplier && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Előzmények</h3>
          <HistoryPanel entityType="supplier" entityId={supplier.id} />
        </div>
      )}

      {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Mégse
        </Button>
        <Button type="submit">{supplier ? 'Mentés' : 'Létrehozás'}</Button>
      </div>
    </form>
  )
}

export function Suppliers() {
  const suppliers = useStore((s) => s.suppliers)
  const products = useStore((s) => s.products)
  const deleteSupplier = useStore((s) => s.deleteSupplier)
  const restoreSupplier = useStore((s) => s.restoreSupplier)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [deleting, setDeleting] = useState<Supplier | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)

  const visibleSuppliers = suppliers.filter((s) => showDeleted || !s.deletedAt)

  return (
    <div>
      <PageHeader
        title="Beszállítók"
        subtitle="Beszállítói adatok és szállítási idők"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={18} /> Új beszállító
          </Button>
        }
      />

      <div className="mb-4">
        <Checkbox label="Törölt beszállítók megjelenítése" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
      </div>

      {visibleSuppliers.length === 0 ? (
        <EmptyState>Még nincs rögzített beszállító.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleSuppliers.map((s) => {
            const productCount = products.filter((p) => p.supplierId === s.id).length
            const isDeleted = Boolean(s.deletedAt)
            return (
              <Card key={s.id} className={`flex flex-col gap-2 ${isDeleted ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className={`font-semibold text-[var(--color-text)] ${isDeleted ? 'line-through' : ''}`}>{s.name}</div>
                  {isDeleted && (
                    <span className="whitespace-nowrap rounded-full bg-black/10 px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)]">
                      Törölve
                    </span>
                  )}
                </div>
                <div className="text-sm text-[var(--color-text-muted)]">{s.phone || '—'}</div>
                <div className="text-sm text-[var(--color-text-muted)]">{s.email || '—'}</div>
                <div className="text-sm text-[var(--color-text-muted)]">Szállítási idő: {s.leadTimeDays} nap</div>
                <div className="text-xs text-[var(--color-text-muted)]">{productCount} termékhez rendelve</div>
                <div className="mt-1 flex justify-end gap-2 border-t border-[var(--color-border)] pt-3">
                  {isDeleted ? (
                    <Button variant="secondary" onClick={() => restoreSupplier(s.id)}>
                      <RotateCcw size={16} /> Visszaállítás
                    </Button>
                  ) : (
                    <>
                      <Button variant="secondary" onClick={() => setEditing(s)}>
                        <Pencil size={16} /> Szerkesztés
                      </Button>
                      <Button variant="danger" onClick={() => setDeleting(s)}>
                        <Trash2 size={16} />
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {creating && (
        <Modal title="Új beszállító" onClose={() => setCreating(false)}>
          <SupplierForm onDone={() => setCreating(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title="Beszállító szerkesztése" onClose={() => setEditing(null)}>
          <SupplierForm supplier={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Beszállító törlése"
          message={`Biztosan törlöd a(z) "${deleting.name}" beszállítót? A hozzá rendelt termékek megtartják a hivatkozást, és a beszállító bármikor visszaállítható.`}
          confirmLabel="Törlés"
          danger
          onConfirm={() => {
            deleteSupplier(deleting.id)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
