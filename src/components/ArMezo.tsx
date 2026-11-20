// „Mennyiért ment ki?” – a raktáros eladásnál megadja az egységárat úgy, ahogy a vevő fizette (áfával). Alapból a termék
// eladási ára (áfával) áll benne, így ha annyiért ment, nincs vele dolga. Olcsóbban csak indokkal (a felhasználó kérése).
import { useState } from 'react'
import { useStore } from '../store/useStore'
import { AR_INDOKOK, bruttobolNetto, nettobolBrutto, olcsobb } from '../lib/raktariAr'
import { formatCurrency, formatNumber } from '../lib/format'
import type { Product } from '../types'

export interface ArErtek {
  eladasiAr?: number
  arIndok?: string
}

export function useArMezo(product: Product | undefined) {
  const alapAfa = useStore((s) => s.settings.defaultVatRatePercentForNewProducts)
  const afa = product?.defaultVatRatePercent ?? alapAfa ?? 0
  const listaBrutto = product ? nettobolBrutto(product.salePrice, afa) : 0
  const [ar, setAr] = useState<string | null>(null)
  const [indok, setIndok] = useState('')
  const szoveg = ar ?? (product ? String(listaBrutto) : '')
  const brutto = Number(szoveg.replace(/\s/g, '').replace(',', '.'))
  const netto = Number.isFinite(brutto) && szoveg.trim() !== '' ? bruttobolNetto(brutto, afa) : undefined
  const olcsobban = product !== undefined && netto !== undefined && olcsobb(netto, product.salePrice)

  /** Ellenőrzés mentés előtt: hibaüzenet, vagy a store-nak átadandó érték. */
  const ertek = (): { hiba: string } | ArErtek => {
    if (!product) return {}
    if (netto === undefined || brutto < 0) return { hiba: 'Adja meg, mennyiért ment ki (egységár).' }
    if (olcsobban && !indok.trim()) return { hiba: 'Olcsóbban ment ki, mint a termék ára: válassza ki vagy írja be, miért.' }
    return { eladasiAr: netto, arIndok: olcsobban ? indok.trim() : undefined }
  }

  const visszaallit = () => {
    setAr(null)
    setIndok('')
  }

  return { szoveg, setAr, indok, setIndok, olcsobban, listaBrutto, brutto, ertek, visszaallit, afa }
}

export function ArMezo({ product, mennyiseg, allapot }: { product: Product; mennyiseg?: number; allapot: ReturnType<typeof useArMezo> }) {
  const { szoveg, setAr, indok, setIndok, olcsobban, listaBrutto, brutto } = allapot
  return (
    <div className="mb-4 flex flex-col gap-1" data-ar-mezo>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Mennyiért ment ki?</span>
        <span className="flex items-center gap-2">
          <input
            className="w-36 rounded-lg border border-[var(--szin-keret,var(--color-border))] bg-[var(--szin-hatter,var(--color-surface))] px-3 py-3 text-2xl font-semibold tabular-nums"
            inputMode="decimal"
            value={szoveg}
            onChange={(e) => setAr(e.target.value)}
            aria-describedby={`ar-sugo-${product.id}`}
            data-ar-input
          />
          <span className="text-lg">Ft / {product.unit}</span>
        </span>
      </label>
      <span id={`ar-sugo-${product.id}`} className="text-sm text-[var(--color-text-muted)]">
        Amennyit a vevő fizetett egy {product.unit}-ért (áfával). A termék ára: {formatCurrency(listaBrutto)} / {product.unit}.
        {mennyiseg && Number.isFinite(brutto) ? ` Összesen: ${formatCurrency(brutto * mennyiseg)} (${formatNumber(mennyiseg)} ${product.unit}).` : ''}
      </span>
      {olcsobban && (
        <div className="mt-1 flex flex-col gap-1" data-ar-indok>
          <span className="font-medium text-[var(--color-danger)]">Olcsóbban ment ki – miért?</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Miért olcsóbb?">
            {AR_INDOKOK.map((o) => (
              <button key={o} type="button" className="chip" aria-pressed={indok === o} onClick={() => setIndok(o)}>
                {o}
              </button>
            ))}
          </div>
          <input
            className="mt-1 w-full rounded-lg border border-[var(--szin-keret,var(--color-border))] bg-[var(--szin-hatter,var(--color-surface))] px-3 py-2"
            placeholder="Vagy írja be röviden…"
            value={indok}
            onChange={(e) => setIndok(e.target.value)}
            aria-label="Miért olcsóbb?"
          />
        </div>
      )}
    </div>
  )
}
