// Az űrlapmezők értékei: forintösszeg, dátum, adószám – a Könyvelő bevált szabályai szerint, egy helyen.

/** Forintösszeg szövegből (egész forint): üres → null, hibás → undefined. „12500”, „12 500”, „12.500”, „-3 000”. */
export function osszegOlvas(szoveg: string): number | null | undefined {
  const s = szoveg.replace(/[\s  ]/g, '').replace(/Ft$/i, '')
  if (s === '') return null
  if (!/^-?\d{1,3}(\.\d{3})*$|^-?\d+$/.test(s)) return undefined
  const n = Number(s.replace(/\./g, ''))
  return Number.isSafeInteger(n) ? n : undefined
}

/** „12 500” (ezres tagolás nem törő szóközzel). */
export function osszegFormaz(n: number, ft = false): string {
  const s = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(n).replace(/\s/g, ' ')
  return ft ? `${s} Ft` : s
}

const ket = (n: number) => String(n).padStart(2, '0')

/** Dátum szövegből (ÉÉÉÉ-HH-NN): „2026.11.05.”, „2026-11-05”, „11.05.” (az adott évben). Üres → null, hibás → undefined. */
export function datumOlvas(szoveg: string, alapEv = new Date().getFullYear()): string | null | undefined {
  const s = szoveg.trim().replace(/\s+/g, '')
  if (s === '') return null
  let m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$/.exec(s)
  let ev: number, ho: number, nap: number
  if (m) [ev, ho, nap] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) [ev, ho, nap] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else if ((m = /^(\d{1,2})[.\-/](\d{1,2})\.?$/.exec(s))) [ev, ho, nap] = [alapEv, Number(m[1]), Number(m[2])]
  else return undefined
  const d = new Date(Date.UTC(ev, ho - 1, nap))
  if (d.getUTCFullYear() !== ev || d.getUTCMonth() !== ho - 1 || d.getUTCDate() !== nap) return undefined
  return `${ev}-${ket(ho)}-${ket(nap)}`
}

/** „2026.11.05.” */
export const datumFormaz = (iso: string) => `${iso.slice(0, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)}.`

const SULYOK = [9, 7, 3, 1, 9, 7, 3]

/** Magyar adószám (12345678-1-12) ellenőrzése az ellenőrző számjeggyel. */
export function adoszamEllenoriz(szoveg: string): { ok: true; formazott: string } | { ok: false; uzenet: string } {
  const d = szoveg.replace(/[\s-]/g, '')
  if (!/^\d{11}$/.test(d)) return { ok: false, uzenet: 'Az adószám formája: 12345678-1-12 (11 számjegy).' }
  const osszeg = SULYOK.reduce((s, w, i) => s + w * Number(d[i]), 0)
  if ((10 - (osszeg % 10)) % 10 !== Number(d[7])) return { ok: false, uzenet: 'Az adószám ellenőrző számjegye nem stimmel. Ellenőrizd a számot.' }
  if (!/[1-5]/.test(d[8]!)) return { ok: false, uzenet: 'Az adószám 9. számjegye (áfakód) 1–5 lehet.' }
  return { ok: true, formazott: `${d.slice(0, 8)}-${d[8]}-${d.slice(9)}` }
}
