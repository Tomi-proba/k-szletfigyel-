// F39: a napi zárás jóváhagyása előtti megerősítés. Felsorolja, mely várakozó tételek fogadódnak el egyben (a raktár
// szerinti mennyiséggel), és melyek maradnak a Jóváhagyás oldalon, miért. A jóváhagyás után az eredményt mutatja.
import { useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './ui'
import { useStore, type ZarasJovahagyasEredmeny } from '../store/useStore'
import { zarasElfogadasTerv } from '../lib/zarasElfogadas'
import { formatDate, formatNumber } from '../lib/format'
import type { DailyClosing } from '../types'

export function ZarasJovahagyas({ zaras, foIroda, onClose }: { zaras: DailyClosing; foIroda: boolean; onClose: () => void }) {
  const movements = useStore((s) => s.movements)
  const products = useStore((s) => s.products)
  const locations = useStore((s) => s.locations)
  const jovahagy = useStore((s) => s.approveDailyClosingWithPending)
  const [eredmeny, setEredmeny] = useState<ZarasJovahagyasEredmeny | null>(null)
  const terv = useMemo(() => zarasElfogadasTerv(movements, products, zaras.locationId, zaras.date), [movements, products, zaras])
  const termek = (id: string) => products.find((p) => p.id === id)
  const sor = (id: string, q?: number) => {
    const m = movements.find((x) => x.id === id)
    if (!m) return 'Tétel'
    const p = termek(m.productId)
    return `${m.type === 'in' ? 'Be' : 'Ki'}: ${p?.name ?? 'Törölt termék'} – ${formatNumber(q ?? m.raktarMennyiseg ?? m.quantity)} ${p?.unit ?? 'db'}`
  }
  const telephely = locations.find((l) => l.id === zaras.locationId)?.name ?? 'Telephely'

  if (eredmeny?.ok) {
    return (
      <Modal title="Napi zárás jóváhagyva" onClose={onClose}>
        <div className="flex flex-col gap-3 text-sm" data-zaras-eredmeny>
          <p className="alert alert-success">
            {telephely}, {formatDate(zaras.date)}: a zárás jóváhagyva{eredmeny.elfogadva.length ? `, ${eredmeny.elfogadva.length} várakozó tétel elfogadva` : ''}.
          </p>
          {eredmeny.kihagyott.length > 0 && (
            <div>
              <p className="mb-1 font-semibold">A Jóváhagyás oldalon maradt ({eredmeny.kihagyott.length}):</p>
              <ul className="list-disc pl-5">
                {eredmeny.kihagyott.map((k) => (
                  <li key={k.id}>
                    {sor(k.id)} – <span className="text-[var(--szin-hiba)]">{k.ok}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Rendben</Button>
          </div>
        </div>
      </Modal>
    )
  }

  const elfogadhato = foIroda ? terv.elfogadhato : []
  const kihagyott = [...terv.kihagyott.map((k) => ({ id: k.m.id, ok: k.ok })), ...(foIroda ? [] : terv.elfogadhato.map((e) => ({ id: e.m.id, ok: 'csak a fő iroda fogadhatja el' })))]

  return (
    <Modal title="Biztosan jóváhagyja a napi zárást?" onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm" data-zaras-megerosites>
        <p>
          {telephely}, {formatDate(zaras.date)}.
        </p>
        {elfogadhato.length > 0 && (
          <div>
            <p className="mb-1 font-semibold">Ezek a tételek is elfogadódnak, a raktár szerinti mennyiséggel ({elfogadhato.length}):</p>
            <ul className="list-disc pl-5" data-zaras-elfogadhato>
              {elfogadhato.map((e) => (
                <li key={e.m.id}>{sor(e.m.id, e.mennyiseg)}</li>
              ))}
            </ul>
          </div>
        )}
        {kihagyott.length > 0 && (
          <div>
            <p className="mb-1 font-semibold">Ezek a Jóváhagyás oldalon maradnak, kézi döntésre ({kihagyott.length}):</p>
            <ul className="list-disc pl-5" data-zaras-kihagyott>
              {kihagyott.map((k) => (
                <li key={k.id}>
                  {sor(k.id)} – <span className="text-[var(--szin-hiba)]">{k.ok}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {elfogadhato.length === 0 && kihagyott.length === 0 && <p className="muted">Ezen a napon nincs várakozó tétel.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Mégse
          </Button>
          <Button onClick={() => setEredmeny(jovahagy(zaras.id))} data-zaras-jovahagyom>
            <CheckCircle2 size={16} /> {elfogadhato.length ? `Igen, jóváhagyom (${elfogadhato.length} tétel elfogadásával)` : 'Igen, jóváhagyom'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
