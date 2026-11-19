// F39: a napi zárás jóváhagyásakor a nap még el nem fogadott tételei egyben elfogadódnak (a felhasználó kérése).
// Itt csak a terv: mi fogadható el automatikusan (a raktár által visszaigazolt mennyiséggel), és mi nem, miért.
// Ami nem fogadható el, a Jóváhagyás oldalon marad, kézi döntésre.
import type { Movement, Product } from '../types'
import { varakozo } from './raktariBejelentes'

export type ElfogadasMod = 'beszerzes' | 'kiadas' | 'integracio'

export interface ElfogadhatoTetel {
  m: Movement
  mod: ElfogadasMod
  /** a raktár által visszaigazolt mennyiség */
  mennyiseg: number
}

export interface KihagyottTetel {
  m: Movement
  ok: string
}

export interface ZarasElfogadasTerv {
  elfogadhato: ElfogadhatoTetel[]
  kihagyott: KihagyottTetel[]
}

export function zarasElfogadasTerv(movements: readonly Movement[], products: readonly Product[], locationId: string, date: string): ZarasElfogadasTerv {
  const termekek = new Map(products.map((p) => [p.id, p]))
  const terv: ZarasElfogadasTerv = { elfogadhato: [], kihagyott: [] }
  for (const m of movements) {
    if (!varakozo(m) || m.locationId !== locationId || m.date !== date) continue
    if (!m.raktarVisszaigazolva) {
      terv.kihagyott.push({ m, ok: 'a raktár még nem igazolta vissza' })
      continue
    }
    const mennyiseg = m.raktarMennyiseg ?? m.quantity
    if (mennyiseg === 0) {
      terv.kihagyott.push({ m, ok: m.type === 'in' ? 'a raktár szerint nem jött meg – kézzel döntsön róla' : 'a raktár szerint nem történt meg – kézzel döntsön róla' })
      continue
    }
    if (m.integracioEsemenyId || m.returnOfMovementId) {
      terv.elfogadhato.push({ m, mod: 'integracio', mennyiseg })
      continue
    }
    if (m.type === 'in') {
      if (!m.ok && !(m.supplierId ?? termekek.get(m.productId)?.supplierId)) {
        terv.kihagyott.push({ m, ok: 'nincs megadva a szállító – adja meg az elfogadáskor' })
        continue
      }
      terv.elfogadhato.push({ m, mod: 'beszerzes', mennyiseg })
      continue
    }
    terv.elfogadhato.push({ m, mod: 'kiadas', mennyiseg })
  }
  return terv
}

/** Az elfogadó műveletek hibakódjai érthető okként. */
export const ELFOGADAS_HIBA: Record<string, string> = {
  'insufficient-stock': 'nincs elég készlet – számolja meg a polcot, és fogadja el kézzel',
  'supplier-required': 'nincs megadva a szállító – adja meg az elfogadáskor',
  forbidden: 'csak a fő iroda fogadhatja el',
  'not-pending': 'közben már nem vár elfogadásra',
  'not-found': 'a tétel nem található',
}
