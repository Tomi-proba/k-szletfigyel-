// Részleges visszáru rögzítése (TERV.md F15.8): vevői visszavétel egy eladásból, vagy szállítói
// visszaküldés egy beszerzésből. Jóváhagyandóként jön létre: a visszavételt a raktár, a visszaküldést az
// iroda hagyja jóvá (a „Jóváhagyásra vár” listában); a készlet csak akkor változik. Az összegek az
// eredeti mozgásból jönnek, arányosan - itt csak a mennyiség és az ok kérdés.
import { useState } from 'react'
import { Modal } from './Modal'
import { returnableQuantity, useStore, type CreateReturnResult } from '../store/useStore'
import { formatNumber } from '../lib/format'
import type { Movement } from '../types'

const HIBA: Record<Exclude<CreateReturnResult, { ok: true }>['reason'], string> = {
  'not-found': 'Az eredeti mozgás nem található.',
  'not-returnable': 'Ehhez a mozgáshoz nem rögzíthető visszáru (visszavont, törölt, vagy maga is visszáru/korrekció).',
  'invalid-quantity': 'Adj meg 0-nál nagyobb mennyiséget.',
  'reason-required': 'Írd be az okát (a naplóba és a Könyvelőbe is ez kerül).',
  'too-much': 'Ennyit nem lehet: többet, mint amennyi még visszavehető.',
  'not-enough-in-lot': 'Ebből a beszerzésből nincs ennyi a raktárban; a program más tételből nem küld vissza.',
}

export function VisszaruModal({ original, onClose }: { original: Movement; onClose: () => void }) {
  const createReturn = useStore((s) => s.createReturn)
  const product = useStore((s) => s.products.find((p) => p.id === original.productId))
  const movements = useStore((s) => s.movements)
  const lot = useStore((s) => s.lots.find((l) => l.movementId === original.id && !l.deletedAt))
  const vevoi = original.type === 'out'
  const egyseg = product?.unit ?? 'db'
  const maradt = returnableQuantity(movements, original)
  const legfeljebb = vevoi ? maradt : Math.min(maradt, lot?.remainingQuantity ?? 0)
  const [mennyiseg, setMennyiseg] = useState('')
  const [ok, setOk] = useState('')
  const [hiba, setHiba] = useState<string | null>(null)
  const [kesz, setKesz] = useState(false)

  const rogzit = () => {
    const q = Number(mennyiseg.replace(',', '.'))
    const r = createReturn({ originalId: original.id, quantity: q, reason: ok })
    if (r.ok) return setKesz(true)
    setHiba(r.available !== undefined ? `${HIBA[r.reason]} Legfeljebb ${formatNumber(r.available)} ${egyseg}.` : HIBA[r.reason])
  }

  return (
    <Modal title={vevoi ? 'Visszavétel (a vevő visszahozza)' : 'Visszaküldés a szállítónak'} onClose={onClose}>
      <div className="kozos flex flex-col gap-3">
        {kesz ? (
          <>
            <p className="alert alert-success">
              Rögzítve. {vevoi ? 'A raktár hagyja jóvá, amikor az áru visszaérkezett' : 'Az iroda hagyja jóvá, amikor az áru elment'} („Jóváhagyásra vár” lista);
              a készlet csak akkor változik.
            </p>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Rendben
            </button>
          </>
        ) : (
          <>
            <p>
              <strong>{product?.name ?? 'Termék'}</strong> – eredetileg {formatNumber(original.quantity)} {egyseg}
              {original.invoiceNumber ? ` (számla: ${original.invoiceNumber})` : ''}.
            </p>
            <p className="muted text-sm">
              {legfeljebb > 0
                ? `Legfeljebb ${formatNumber(legfeljebb)} ${egyseg} ${vevoi ? 'vehető vissza' : 'küldhető vissza ebből a beszerzésből'}. Az ár és az áfa az eredetiből jön.`
                : vevoi
                  ? 'Ebből az eladásból már mindent visszavettek.'
                  : 'Ebből a beszerzésből nincs már raktáron (vagy mindent visszaküldtek).'}
            </p>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Mennyiség ({egyseg})</span>
              <input
                className="w-40 rounded-lg border border-[var(--szin-keret)] bg-[var(--szin-hatter)] px-3 py-2.5 text-lg tabular-nums"
                inputMode="decimal"
                value={mennyiseg}
                onChange={(e) => setMennyiseg(e.target.value)}
                disabled={legfeljebb <= 0}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Oka</span>
              <textarea
                className="w-full rounded-lg border border-[var(--szin-keret)] bg-[var(--szin-hatter)] px-3 py-2"
                rows={2}
                value={ok}
                placeholder={vevoi ? 'pl. sérült, nem megfelelő méret' : 'pl. hibás, rossz terméket küldtek'}
                onChange={(e) => setOk(e.target.value)}
                disabled={legfeljebb <= 0}
              />
            </label>
            {hiba && (
              <p className="alert alert-danger text-sm" role="alert">
                {hiba}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn" onClick={onClose}>
                Mégse
              </button>
              <button type="button" className="btn btn-primary" onClick={rogzit} disabled={legfeljebb <= 0}>
                Rögzítem
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
