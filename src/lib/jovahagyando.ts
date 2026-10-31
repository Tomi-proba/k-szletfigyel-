// A „Jóváhagyásra vár” lista szövegei és szabályai (pages/Jovahagyando.tsx): külön fájlban, hogy a
// lista komponense csak komponenst exportáljon, és a szabályok külön tesztelhetők legyenek.
import type { Movement } from '../types'

/** Mit jelent a mozgás a raktárban: ebből adódnak a gombok feliratai. */
export type Fajta = 'beerkezes' | 'kiadas' | 'visszavetel' | 'visszakuldes'

export function fajtaja(m: Movement): Fajta {
  const visszaru = Boolean(m.returnOfMovementId || m.correctsMovementId)
  if (m.type === 'in') return visszaru ? 'visszavetel' : 'beerkezes'
  return visszaru ? 'visszakuldes' : 'kiadas'
}

export const SZOVEG: Record<Fajta, { cim: string; rendben: string; kevesebb: string; nem: string; kevesebbKerdes: string; okok: string[]; nemOkok: string[]; kesz: string }> = {
  beerkezes: {
    cim: 'Beérkezésre vár',
    rendben: 'Beérkezett',
    kevesebb: 'Kevesebb jött',
    nem: 'Nem érkezett meg',
    kevesebbKerdes: 'Mennyi jött ténylegesen?',
    okok: ['Hiányzott', 'Sérült', 'Más termék jött'],
    nemOkok: ['Nem jött meg', 'Visszaküldtük'],
    kesz: 'beérkezett',
  },
  kiadas: {
    cim: 'Kiadásra vár',
    rendben: 'Kiadva',
    kevesebb: 'Kevesebb ment ki',
    nem: 'Nem ment ki',
    kevesebbKerdes: 'Mennyi ment ki ténylegesen?',
    okok: ['Nem volt elég a polcon', 'A vevő kevesebbet vitt el', 'Sérült volt'],
    nemOkok: ['A vevő nem vitte el', 'Nem volt a polcon'],
    kesz: 'kiadva',
  },
  visszavetel: {
    cim: 'Visszavételre vár',
    rendben: 'Visszajött',
    kevesebb: 'Kevesebb jött vissza',
    nem: 'Nem jött vissza',
    kevesebbKerdes: 'Mennyi jött vissza ténylegesen?',
    okok: ['Hiányzott', 'Sérült'],
    nemOkok: ['Nem hozták vissza'],
    kesz: 'visszajött',
  },
  visszakuldes: {
    cim: 'Visszaküldésre vár',
    rendben: 'Visszaküldve',
    kevesebb: 'Kevesebbet küldtünk',
    nem: 'Nem küldtük vissza',
    kevesebbKerdes: 'Mennyit küldtünk vissza ténylegesen?',
    okok: ['Nem volt meg mind', 'A szállító kevesebbet vett vissza'],
    nemOkok: ['A szállító nem vette vissza', 'Nem volt meg'],
    kesz: 'visszaküldve',
  },
}

/** Ki hagyhatja jóvá: a Könyvelőből jöttet a raktár (és az iroda); a kézi visszárunál a rögzítő NEM
 * hagyhatja jóvá a sajátját: a vevői visszavételt a raktár, a szállítói visszaküldést az iroda (F15.8). */
export function jovahagyhatja(m: Movement, szerep: { raktaros: boolean; iroda: boolean; csakOlvas: boolean; helyi: boolean }): boolean {
  if (szerep.csakOlvas) return false
  if (szerep.helyi || m.integracioEsemenyId) return true
  return m.type === 'in' ? szerep.raktaros : szerep.iroda
}
