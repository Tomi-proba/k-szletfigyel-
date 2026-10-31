// A raktáros (vagy iroda) itt hagyja jóvá egy függőben lévő rendelés
// tényleges beérkezését - csak ez a lépés hozza létre a valódi
// PurchaseLot-ot és növeli a készletet, a ténylegesen beérkezett
// mennyiséggel (ami eltérhet a rendelttől - hiánycikk, sérült áru stb.).
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useStore } from '../store/useStore'
import type { Movement } from '../types'
import { Modal } from './Modal'
import { Button, Field, Input, Textarea } from './ui'
import { formatDate, formatMoney } from '../lib/format'

export function ApprovePurchaseOrderModal({ movement, onClose }: { movement: Movement; onClose: () => void }) {
  const approvePurchaseOrder = useStore((s) => s.approvePurchaseOrder)
  const products = useStore((s) => s.products)
  const product = products.find((p) => p.id === movement.productId)
  // A beszerzési ár érzékeny adatnak számít raktáros szerepkörben (lásd
  // DOCUMENTATION.md 14. fejezet) - a jóváhagyáshoz igazából csak a
  // mennyiség kell, az árat nem kell megmutatni neki.
  const { isWarehouseUser } = useAuth()

  const [actualQuantity, setActualQuantity] = useState(String(movement.quantity))
  const [note, setNote] = useState('')
  // A számlaszám és a szállítási díj kérdése az irodai adat (F15.3, F15.7/2): a raktáros nem látja.
  const [invoiceNumber, setInvoiceNumber] = useState(movement.invoiceNumber ?? '')
  const [szamlanVan, setSzamlanVan] = useState<'igen' | 'nem' | 'nemtudom'>(
    movement.shippingOnInvoice === undefined ? 'nemtudom' : movement.shippingOnInvoice ? 'igen' : 'nem',
  )
  const vanSzallitas = (movement.shippingCost ?? 0) > 0
  const [invoiceDate, setInvoiceDate] = useState(movement.invoiceDate ?? '')
  const [fulfillmentDate, setFulfillmentDate] = useState(movement.fulfillmentDate ?? '')
  const [error, setError] = useState<string | null>(null)

  const actualQtyNumber = Number(actualQuantity.replace(',', '.'))
  const mismatch = Number.isFinite(actualQtyNumber) && actualQtyNumber !== movement.quantity

  function approve() {
    setError(null)
    if (!Number.isFinite(actualQtyNumber) || actualQtyNumber <= 0) {
      return setError('A tényleges mennyiségnek pozitív számnak kell lennie.')
    }
    const result = approvePurchaseOrder(
      movement.id,
      actualQtyNumber,
      note.trim() || undefined,
      isWarehouseUser
        ? undefined
        : {
            invoiceNumber,
            shippingOnInvoice: vanSzallitas && szamlanVan !== 'nemtudom' ? szamlanVan === 'igen' : undefined,
            invoiceDate: invoiceDate || undefined,
            fulfillmentDate: fulfillmentDate || undefined,
          },
    )
    if (!result.ok) return setError('A jóváhagyás nem sikerült.')
    onClose()
  }

  return (
    <Modal title="Beérkezés jóváhagyása" onClose={onClose}>
      <div className="mb-4 rounded-lg bg-black/5 p-3 text-sm">
        <div className="font-medium text-[var(--color-text)]">{product?.name ?? 'Törölt termék'}</div>
        <div className="text-xs text-[var(--color-text-muted)]">
          Rendelve: {movement.quantity} {product?.unit} · Rendelés dátuma: {formatDate(movement.date)}
          {!isWarehouseUser && movement.unitPrice !== undefined && (
            <>
              {' '}
              · Várható egységár: {formatMoney(movement.unitPrice, movement.currency ?? 'HUF')}
            </>
          )}
        </div>
      </div>

      <Field label={`Ténylegesen beérkezett mennyiség${product ? ` (${product.unit})` : ''}`}>
        <Input inputMode="decimal" value={actualQuantity} onChange={(e) => setActualQuantity(e.target.value)} autoFocus />
      </Field>

      {mismatch && (
        <p className="mb-3 rounded-lg bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning)]">
          Ez eltér a rendelt {movement.quantity} {product?.unit}-tól - az eltérés automatikusan bekerül a megjegyzésbe, és az iroda látni
          fogja.
        </p>
      )}

      <Field label="Megjegyzés az eltérésről (opcionális)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="pl. sérült volt 2 db, ezért kevesebb…" />
      </Field>

      {!isWarehouseUser && (
        <Field label="Szállítói számla száma (opcionális)">
          <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="pl. SZ-2026-0042" />
        </Field>
      )}

      {!isWarehouseUser && (
        <div className="mb-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--color-text)]">Számla kelte (opcionális)</span>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--color-text)]">Teljesítés dátuma (opcionális)</span>
              <Input type="date" value={fulfillmentDate} onChange={(e) => setFulfillmentDate(e.target.value)} />
            </label>
          </div>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            A számláról. Ha megadja, a Könyvelő piszkozatára is átkerül; ha nem, ott a jóváhagyó írja be.
          </span>
        </div>
      )}

      {!isWarehouseUser && vanSzallitas && (
        <div className="kozos mb-3">
          <span className="mb-1 block text-sm font-medium">A szállítási díj a szállító számláján van?</span>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="A szállítási díj a szállító számláján van?">
            {(['igen', 'nem', 'nemtudom'] as const).map((v) => (
              <button key={v} type="button" className="chip" aria-pressed={szamlanVan === v} onClick={() => setSzamlanVan(v)}>
                {v === 'igen' ? 'Igen' : v === 'nem' ? 'Nem (külön számla)' : 'Nem tudom'}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Mégse
        </Button>
        <Button onClick={approve}>Jóváhagyás - készletbe vétel</Button>
      </div>
    </Modal>
  )
}
