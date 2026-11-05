// A keret közös gyorsbillentyű-rendszere (TERV.md F22 K5): egy kiosztás mind a négy felületen, ütközés-
// ellenőrzéssel. A modul a sajátjait regisztrálja; a ? súgó és a tooltipek mindet mutatják.
//
// Szabályok (jóváhagyva 2026-11-05):
//   - minden Alt-os billentyűnek van beviteli mezőn kívül működő tartaléka (mint az Alt+N mellett az F2 és az N),
//     mert a böngészők és a rendszerek egy része az Alt-os kombinációkat a saját menüjének tartja fenn
//     (BONGESZO_UTKOZESEK);
//   - a billentyűt a fizikai gomb (KeyboardEvent.code) azonosítja, így a magyar kiosztásnál és a Mac
//     Option-billentyűjénél is ugyanaz a gomb működik;
//   - AltGr-rel (magyar billentyűzeten a @, &, [, ] stb.) soha nem indul gyorsbillentyű;
//   - Macen beviteli mezőben az Option (Alt) karaktert ír, ezért ott mezőben az Alt-os kombinációk nem
//     működnek; Windowson mezőben is igen;
//   - az egybetűs (módosító nélküli) billentyűk csak beviteli mezőn kívül működnek, és a felhasználó
//     kikapcsolhatja őket (WCAG 2.1.4).
import type { ModulKod } from '@aweboldal/arak'

export interface Billentyu {
  /** A fizikai gomb (KeyboardEvent.code), pl. KeyK, Digit1, F2, Enter, Escape. */
  kod?: string
  /** A leütött karakter (KeyboardEvent.key) – csak ahol a kiosztástól függetlenül a karakter számít (?). */
  karakter?: string
  alt?: boolean
  ctrl?: boolean
  shift?: boolean
  /** Beviteli mezőben is működik (pl. Ctrl+Enter mentés, Esc). Az egybetűs billentyűknél soha. */
  mezobenIs?: boolean
}

export interface Gyorsbillentyu {
  azon: string
  leiras: string
  /** Az első a fő billentyű, a többi tartalék. */
  billentyuk: readonly Billentyu[]
  forras: 'keret' | ModulKod
  megjegyzes?: string
}

export interface BillentyuEsemeny {
  code: string
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  getModifierState?: (k: string) => boolean
}

const egybetus = (b: Billentyu) => !b.alt && !b.ctrl && (b.karakter !== undefined || /^(Key[A-Z]|Digit\d)$/.test(b.kod ?? ''))

/**
 * Egyezik-e a lenyomott billentyű. `mezoben`: a fókusz beviteli mezőben van; `mac`: Mac gép;
 * `egybetusBe`: a felhasználó nem kapcsolta ki az egybetűs gyorsbillentyűket.
 */
export function egyezik(e: BillentyuEsemeny, b: Billentyu, o: { mezoben: boolean; mac: boolean; egybetusBe: boolean }): boolean {
  if (e.metaKey) return false
  // AltGr (a magyar billentyűzet harmadik szintje): Windowson Ctrl+Alt-ként jelentkezik.
  if (e.getModifierState?.('AltGraph') || (e.altKey && e.ctrlKey && !(b.alt && b.ctrl))) return false
  if (Boolean(b.alt) !== e.altKey || Boolean(b.ctrl) !== e.ctrlKey) return false
  if (b.karakter === undefined && Boolean(b.shift) !== e.shiftKey) return false
  if (egybetus(b)) {
    if (o.mezoben || !o.egybetusBe) return false
  } else if (o.mezoben && !b.mezobenIs && !(b.alt && !o.mac)) return false
  if (b.karakter !== undefined) return e.key === b.karakter
  return e.code === b.kod
}

const gombNev = (kod: string) =>
  kod.startsWith('Key') ? kod.slice(3) : kod.startsWith('Digit') ? kod.slice(5) : kod === 'Escape' ? 'Esc' : kod === 'Enter' ? 'Enter' : kod

/** Egy billentyű felirata: Alt+K, F2, ?, Ctrl+Enter. Macen az Alt „Option”. */
export function felirat(b: Billentyu, mac = false): string {
  const r: string[] = []
  if (b.ctrl) r.push('Ctrl')
  if (b.alt) r.push(mac ? 'Option' : 'Alt')
  if (b.shift && b.karakter === undefined) r.push('Shift')
  r.push(b.karakter ?? gombNev(b.kod ?? ''))
  return r.join('+')
}

/** A tooltip szövege: „Alt+K vagy K”, „Alt+N, F2 vagy N”. */
export function feliratok(g: Pick<Gyorsbillentyu, 'billentyuk'>, mac = false): string {
  const f = g.billentyuk.map((b) => felirat(b, mac))
  return f.length <= 1 ? (f[0] ?? '') : `${f.slice(0, -1).join(', ')} vagy ${f.at(-1)}`
}

/** aria-keyshortcuts érték (szóközzel elválasztva). */
export const ariaFelirat = (g: Pick<Gyorsbillentyu, 'billentyuk'>) => g.billentyuk.map((b) => felirat(b).replace('Esc', 'Escape')).join(' ')

const azonos = (a: Billentyu, b: Billentyu) =>
  (a.kod ?? '') === (b.kod ?? '') && (a.karakter ?? '') === (b.karakter ?? '') && !!a.alt === !!b.alt && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift

/** Azonos billentyű két különböző funkcióhoz (a modul regisztrálásakor ellenőrizve). */
export function utkozesek(lista: readonly Gyorsbillentyu[]): Array<{ billentyu: string; a: string; b: string }> {
  const ki: Array<{ billentyu: string; a: string; b: string }> = []
  lista.forEach((g, i) =>
    lista.slice(i + 1).forEach((h) => {
      for (const x of g.billentyuk) for (const y of h.billentyuk) if (azonos(x, y)) ki.push({ billentyu: felirat(x), a: g.azon, b: h.azon })
    }),
  )
  return ki
}

/** Az Alt-os billentyűk, amelyeknek nincs módosító nélküli tartaléka (a szabály szerint üres). */
export const tartalekNelkul = (lista: readonly Gyorsbillentyu[]) =>
  lista.filter((g) => g.billentyuk.some((b) => b.alt) && !g.billentyuk.some((b) => !b.alt && !b.ctrl)).map((g) => g.azon)

const alt = (kod: string): Billentyu => ({ kod, alt: true })
const sima = (kod: string): Billentyu => ({ kod })

/** A keret billentyűi. A modulváltó (Alt+1/2/3) a menü sorrendjében az előfizetett modulokra mutat. */
export const KERET_GYORSBILLENTYUK: readonly Gyorsbillentyu[] = [
  { azon: 'kezdolap', leiras: 'Kezdőlap', billentyuk: [alt('KeyK'), sima('KeyK')], forras: 'keret' },
  { azon: 'teendok', leiras: 'Teendők', billentyuk: [alt('KeyT'), sima('KeyT')], forras: 'keret' },
  { azon: 'cegvalto', leiras: 'Cégváltó', billentyuk: [alt('KeyC'), sima('KeyC')], forras: 'keret' },
  { azon: 'idoszak', leiras: 'Időszak választása', billentyuk: [alt('KeyI'), sima('KeyI')], forras: 'keret' },
  { azon: 'modul-1', leiras: 'Az első modul', billentyuk: [alt('Digit1'), sima('Digit1')], forras: 'keret', megjegyzes: 'A menü sorrendjében.' },
  { azon: 'modul-2', leiras: 'A második modul', billentyuk: [alt('Digit2'), sima('Digit2')], forras: 'keret' },
  { azon: 'modul-3', leiras: 'A harmadik modul', billentyuk: [alt('Digit3'), sima('Digit3')], forras: 'keret' },
  { azon: 'uj-tetel', leiras: 'Új tétel rögzítése (az aktuális modulban)', billentyuk: [alt('KeyN'), sima('F2'), sima('KeyN')], forras: 'keret' },
  { azon: 'mentes', leiras: 'Mentés', billentyuk: [{ kod: 'Enter', ctrl: true, mezobenIs: true }], forras: 'keret', megjegyzes: 'Űrlapokon.' },
  { azon: 'megse', leiras: 'Mégse / ablak bezárása', billentyuk: [{ kod: 'Escape', mezobenIs: true }], forras: 'keret' },
  { azon: 'sugo', leiras: 'Gyorsbillentyűk listája', billentyuk: [{ karakter: '?' }], forras: 'keret' },
]

export type UtkozesSzint = 'szabad' | 'utkozhet' | 'utkozik'

export interface BongeszoUtkozes {
  billentyu: string
  /** Windows: Chrome, Edge, Firefox (magyar); Mac: Chrome, Edge, Firefox. */
  chromeWin: UtkozesSzint
  edgeWin: UtkozesSzint
  firefoxWin: UtkozesSzint
  mac: UtkozesSzint
  megjegyzes: string
}

/**
 * Az Alt-os billentyűk és a böngészők saját billentyűi (a gyártók közzétett billentyűlistái alapján, 2026-11).
 * Ahol „ütközhet” vagy „ütközik”, a tartalék billentyű (mezőn kívül) mindig működik.
 */
export const BONGESZO_UTKOZESEK: readonly BongeszoUtkozes[] = [
  {
    billentyu: 'Alt+1, Alt+2, Alt+3',
    chromeWin: 'szabad',
    edgeWin: 'szabad',
    firefoxWin: 'szabad',
    mac: 'utkozhet',
    megjegyzes:
      'Windowson a fülváltás Ctrl+1–9, az Alt+szám szabad. Macen az Option+szám karaktert ír (mezőn kívül nem gond). Linuxon a Chrome és a Firefox fület vált: ott az 1, 2, 3 a tartalék.',
  },
  {
    billentyu: 'Alt+K',
    chromeWin: 'szabad',
    edgeWin: 'szabad',
    firefoxWin: 'utkozik',
    mac: 'utkozhet',
    megjegyzes: 'A magyar Firefox menüsorában a Könyvjelzők menü hozzáférési betűje a K. Macen az Option+K karaktert ír. Tartalék: K.',
  },
  {
    billentyu: 'Alt+T',
    chromeWin: 'szabad',
    edgeWin: 'szabad',
    firefoxWin: 'utkozhet',
    mac: 'utkozhet',
    megjegyzes: 'A Firefox menüsorának hozzáférési betűi nyelvi változatonként mások (angolul az Eszközök: T). Tartalék: T.',
  },
  {
    billentyu: 'Alt+C',
    chromeWin: 'szabad',
    edgeWin: 'szabad',
    firefoxWin: 'utkozhet',
    mac: 'utkozhet',
    megjegyzes: 'A Firefox menüsorának hozzáférési betűi nyelvi változatonként mások. Macen az Option+C karaktert ír (ç). Tartalék: C.',
  },
  {
    billentyu: 'Alt+I',
    chromeWin: 'szabad',
    edgeWin: 'szabad',
    firefoxWin: 'utkozhet',
    mac: 'utkozhet',
    megjegyzes: 'Az Edge a Shift+Alt+I-t használja (visszajelzés), az Alt+I-t nem. Macen az Option+I ékezet-előtag. Tartalék: I.',
  },
  {
    billentyu: 'Alt+N (meglévő)',
    chromeWin: 'szabad',
    edgeWin: 'szabad',
    firefoxWin: 'utkozik',
    mac: 'utkozhet',
    megjegyzes: 'A magyar Firefox menüsorában a Nézet menü hozzáférési betűje az N. Tartalék: F2 és N.',
  },
]

export const macGep = (platform: string) => /Mac|iPhone|iPad/i.test(platform)
