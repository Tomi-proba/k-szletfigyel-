import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store/useStore'
import { useAlerts } from '../hooks/useAlerts'
import type { Customer } from '../types'
import { Modal } from '../components/Modal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button, Card, EmptyState, Field, Input, PageHeader } from '../components/ui'
import { formatCurrency, formatDate } from '../lib/format'

function CustomerForm({ customer, onDone }: { customer?: Customer; onDone: () => void }) {
  const addCustomer = useStore((s) => s.addCustomer)
  const updateCustomer = useStore((s) => s.updateCustomer)
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [email, setEmail] = useState(customer?.email ?? '')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('A vevő nevét kötelező megadni.')

    const payload = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      notes: notes.trim() || undefined,
    }
    if (customer) updateCustomer(customer.id, payload)
    else addCustomer(payload)
    onDone()
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Vevő neve">
        <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Telefonszám">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Megjegyzés">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Mégse
        </Button>
        <Button type="submit">{customer ? 'Mentés' : 'Létrehozás'}</Button>
      </div>
    </form>
  )
}

export function Customers() {
  const customers = useStore((s) => s.customers)
  const deleteCustomer = useStore((s) => s.deleteCustomer)
  const setMovementPaid = useStore((s) => s.setMovementPaid)
  const alerts = useAlerts()

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [deleting, setDeleting] = useState<Customer | null>(null)

  const balanceByCustomer = new Map(alerts.customerBalances.map((b) => [b.customerId, b]))

  return (
    <div>
      <PageHeader
        title="Vevők"
        subtitle="Névre rögzített eladások és fizetési állapotuk nyomon követése"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={18} /> Új vevő
          </Button>
        }
      />

      {alerts.unpaidSales.length > 0 && (
        <Card className="mb-5 border-l-4 border-l-[var(--color-danger)]">
          <h2 className="mb-1 text-base font-semibold text-[var(--color-text)]">Kifizetetlen eladások</h2>
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">
            Összesen {formatCurrency(alerts.unpaidSales.reduce((sum, s) => sum + s.amount, 0))} tartozás {alerts.unpaidSales.length}{' '}
            tételből.
          </p>
          <div className="divide-y divide-[var(--color-border)]">
            {alerts.unpaidSales.map((sale) => (
              <div key={sale.movementId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <div className="font-medium text-[var(--color-text)]">{sale.customerName}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {formatDate(sale.date)} · {sale.productName} · {sale.quantity} {sale.unit}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-[var(--color-danger)]">{formatCurrency(sale.amount)}</span>
                  <Button variant="secondary" onClick={() => setMovementPaid(sale.movementId, true)}>
                    <CheckCircle2 size={16} /> Kifizetve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {customers.length === 0 ? (
        <EmptyState>Még nincs rögzített vevő.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {customers.map((c) => {
            const balance = balanceByCustomer.get(c.id)
            return (
              <Card key={c.id} className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-[var(--color-text)]">{c.name}</div>
                  {balance && (
                    <span className="whitespace-nowrap rounded-full bg-[var(--color-danger-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-danger)]">
                      {formatCurrency(balance.unpaidAmount)} tartozás
                    </span>
                  )}
                </div>
                <div className="text-sm text-[var(--color-text-muted)]">{c.phone || '—'}</div>
                <div className="text-sm text-[var(--color-text-muted)]">{c.email || '—'}</div>
                {c.notes && <div className="text-xs text-[var(--color-text-muted)]">{c.notes}</div>}
                <div className="mt-1 flex justify-end gap-2 border-t border-[var(--color-border)] pt-3">
                  <Button variant="secondary" onClick={() => setEditing(c)}>
                    <Pencil size={16} /> Szerkesztés
                  </Button>
                  <Button variant="danger" onClick={() => setDeleting(c)}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {creating && (
        <Modal title="Új vevő" onClose={() => setCreating(false)}>
          <CustomerForm onDone={() => setCreating(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title="Vevő szerkesztése" onClose={() => setEditing(null)}>
          <CustomerForm customer={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Vevő törlése"
          message={`Biztosan törlöd a(z) "${deleting.name}" vevőt? A hozzá rögzített eladások megmaradnak a mozgásnaplóban, de vevő nélkül.`}
          confirmLabel="Törlés"
          danger
          onConfirm={() => {
            deleteCustomer(deleting.id)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
