import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Location } from '../types'
import { Modal } from '../components/Modal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button, Card, Field, Input, PageHeader } from '../components/ui'

function LocationForm({ location, onDone }: { location?: Location; onDone: () => void }) {
  const addLocation = useStore((s) => s.addLocation)
  const updateLocation = useStore((s) => s.updateLocation)
  const [name, setName] = useState(location?.name ?? '')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('A telephely nevét kötelező megadni.')
    if (location) updateLocation(location.id, name)
    else addLocation(name)
    onDone()
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Telephely neve">
        <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Mégse
        </Button>
        <Button type="submit">{location ? 'Mentés' : 'Létrehozás'}</Button>
      </div>
    </form>
  )
}

export function Locations() {
  const locations = useStore((s) => s.locations)
  const products = useStore((s) => s.products)
  const deleteLocation = useStore((s) => s.deleteLocation)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Location | null>(null)
  const [deleting, setDeleting] = useState<Location | null>(null)

  return (
    <div>
      <PageHeader
        title="Telephelyek"
        subtitle="Több telephely esetén a készlet telephelyenként külön kezelhető"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={18} /> Új telephely
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {locations.map((l) => {
          const productCount = products.filter((p) => p.locationId === l.id).length
          const canDelete = productCount === 0 && locations.length > 1
          return (
            <Card key={l.id} className="flex flex-col gap-2">
              <div className="font-semibold text-[var(--color-text)]">{l.name}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{productCount} termék ezen a telephelyen</div>
              <div className="mt-1 flex justify-end gap-2 border-t border-[var(--color-border)] pt-3">
                <Button variant="secondary" onClick={() => setEditing(l)}>
                  <Pencil size={16} /> Szerkesztés
                </Button>
                <Button variant="danger" disabled={!canDelete} title={!canDelete ? 'Csak üres telephely törölhető' : undefined} onClick={() => setDeleting(l)}>
                  <Trash2 size={16} />
                </Button>
              </div>
            </Card>
          )
        })}
      </div>

      {creating && (
        <Modal title="Új telephely" onClose={() => setCreating(false)}>
          <LocationForm onDone={() => setCreating(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title="Telephely szerkesztése" onClose={() => setEditing(null)}>
          <LocationForm location={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Telephely törlése"
          message={`Biztosan törlöd a(z) "${deleting.name}" telephelyet?`}
          confirmLabel="Törlés"
          danger
          onConfirm={() => {
            deleteLocation(deleting.id)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
