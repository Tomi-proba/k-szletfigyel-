// Az iroda itt hagyja jóvá (vagy utasítja el) a raktáros által előkészített
// kiszállítást - csak jóváhagyáskor csökken ténylegesen a készlet, snapshotolódik
// az eladási ár, és generálódik az automatikus ÁFA-tétel (lásd
// DOCUMENTATION.md 15. fejezet).
import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Movement } from '../types'
import { Modal } from './Modal'
import { Button, Field, Input, Textarea } from './ui'
import { formatCurrency, formatNumber } from '../lib/format'

export function ApproveSaleModal({ movement, onClose }: { movement: Movement; onClose: () => void }) {
  const approveSalePrep = useStore((s) => s.approveSalePrep)
  const rejectSalePrep = useStore((s) => s.rejectSalePrep)
  const products = useStore((s) => s.products)
  const customers = useStore((s) => s.customers)
  const product = products.find((p) => p.id === movement.productId)
  const customer = movement.customerId ? customers.find((c) => c.id === movement.customerId) : undefined

  const [view, setView] = useState<'approve' | 'reject'>('approve')
  const [vatRate, setVatRate] = useState(product?.defaultVatRatePercent !== undefined ? String(product.defaultVatRatePercent) : '')
  const [isPaid, setIsPaid] = useState(true)
  const [rejectReason, setRejectReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendingNegative, setPendingNegative] = useState<{ resultingStock: number } | null>(null)

  const vatRateNumber = vatRate.trim() === '' ? undefined : Number(vatRate.replace(',', '.'))

  function doApprove(allowNegativeStock = false) {
    setError(null)
    if (vatRate.trim() !== '' && (!Number.isFinite(vatRateNumber) || (vatRateNumber ?? 0) < 0)) {
      return setError('Az ÁFA kulcs nem lehet negatív.')
    }
    const result = approveSalePrep(
      movement.id,
      { vatRatePercent: vatRateNumber, isPaid: movement.customerId ? isPaid : undefined },
      { allowNegativeStock },
    )
    if (result.ok) return onClose()
    if (result.reason === 'insufficient-stock') {
      setPendingNegative({ resultingStock: result.resultingStock ?? 0 })
      return
    }
    setError('A jóváhagyás nem sikerült.')
  }

  function doReject() {
    setError(null)
    if (!rejectReason.trim()) return setError('Add meg az elutasítás indokát.')
    const result = rejectSalePrep(movement.id, rejectReason)
    if (!result.ok) return setError('Az elutasítás nem sikerült.')
    onClose()
  }

  return (
    <Modal title="Kiszállítás jóváhagyása" onClose={onClose}>
      <div className="mb-4 rounded-lg bg-black/5 p-3 text-sm">
        <div className="font-medium text-[var(--color-text)]">{product?.name ?? 'Törölt termék'}</div>
        <div className="text-xs text-[var(--color-text-muted)]">
          Mennyiség: {formatNumber(movement.quantity)} {product?.unit} · Eladási ár: {formatCurrency(product?.salePrice ?? 0)}
          {customer && <> · Vevő: {customer.name}</>}
        </div>
        {movement.note && <div className="mt-1 text-xs text-[var(--color-text-muted)]">Megjegyzés: {movement.note}</div>}
      </div>

      {view === 'approve' ? (
        <>
          <Field label="ÁFA kulcs (%, opcionális)">
            <Input inputMode="decimal" value={vatRate} onChange={(e) => setVatRate(e.target.value)} placeholder="pl. 27" />
          </Field>

          {movement.customerId && (
            <div className="mb-4">
              <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">Fizetési állapot</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsPaid(true)}
                  className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                    isPaid
                      ? 'border-[var(--color-success)] bg-[var(--color-success-bg)] text-[var(--color-success)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  Fizetve
                </button>
                <button
                  type="button"
                  onClick={() => setIsPaid(false)}
                  className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                    !isPaid
                      ? 'border-[var(--color-danger)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  Még nem fizetett
                </button>
              </div>
            </div>
          )}

          {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}

          <div className="flex justify-between gap-2">
            <Button variant="danger" onClick={() => setView('reject')}>
              Elutasítás
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Mégse
              </Button>
              <Button onClick={() => doApprove(false)}>Jóváhagyás</Button>
            </div>
          </div>

          {pendingNegative && (
            <div className="mt-4 rounded-lg bg-[var(--color-danger-bg)] p-3 text-sm text-[var(--color-danger)]">
              <p className="mb-2">
                Ez a mozgás {Math.abs(pendingNegative.resultingStock)} {product?.unit ?? ''} hiányba vinné a készletet - a raktáros
                előkészítése óta megváltozott a készlet. Biztosan jóváhagyod?
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setPendingNegative(null)}>
                  Mégse
                </Button>
                <Button variant="danger" onClick={() => doApprove(true)}>
                  Igen, jóváhagyom
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <Field label="Elutasítás indoka">
            <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="pl. hibás vevőadat, ellentmondó mennyiség…" autoFocus />
          </Field>
          {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView('approve')}>
              Vissza
            </Button>
            <Button variant="danger" onClick={doReject}>
              Elutasítás küldése
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
