// A raktáros megadhatja, mennyiért ment ki az áru (a felhasználó kérése). A raktáros azt írja be, amennyit a vevő egy
// egységért fizetett (áfával); a program a termék áfakulcsával áfa nélküli árra számolja, mert a termék eladási ára és az
// eladás ára (saleUnitPrice) áfa nélkül értendő. Olcsóbban csak indokkal adható ki (sérült, akció stb.); a fő iroda az
// elfogadáskor látja és átírhatja.

export const AR_INDOKOK = ['Sérült / romlott', 'Akció', 'Mennyiségi kedvezmény', 'Lejárathoz közeli'] as const

const kerekit = (x: number) => Math.round(x * 100) / 100

export function bruttobolNetto(brutto: number, afaKulcs: number): number {
  return kerekit(brutto / (1 + afaKulcs / 100))
}

export function nettobolBrutto(netto: number, afaKulcs: number): number {
  return kerekit(netto * (1 + afaKulcs / 100))
}

/** Olcsóbb-e a listaárnál (fillérnyi kerekítési eltérés nem számít). */
export function olcsobb(nettoAr: number, listaAr: number): boolean {
  return nettoAr < listaAr - 0.01
}

/** A megjegyzéshez fűzött sor, amit a fő iroda lát. */
export function arMegjegyzes(nettoAr: number, listaAr: number, indok?: string): string | undefined {
  if (!olcsobb(nettoAr, listaAr)) return undefined
  return `Olcsóbban ment ki${indok?.trim() ? `: ${indok.trim()}` : ''}`
}
