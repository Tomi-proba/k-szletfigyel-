// Egységes szavak (AWEBOLDAL TERV.md F27 B4): a felület magáz (Ön), az áfát a helyesírás szerint írja ("áfa",
// "áfakulcs"; a termék neve, az "eÁFA" marad), a szállítót "szállító"-nak hívja, és az üres állapot egy minta.
// A megjegyzések és a tárolt adatok (pl. az 'ÁFA' naplókategória, a bemutató adatok) kivételek.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const GYOKER = path.resolve(__dirname, '../src')
const KIHAGY = new Set(['kozos', 'kozos-keret'])
const ADAT = new Set(['types/index.ts', 'store/seed.ts'])

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((n) => {
    const p = path.join(mappa, n)
    if (statSync(p).isDirectory()) return KIHAGY.has(n) ? [] : fajlok(p)
    return /\.(tsx?|ts)$/.test(n) && !/\.test\./.test(n) ? [p] : []
  })
}

/** A felület szövegsorai (a megjegyzések nélkül), fájl:sor címkével. */
function sorok(): Array<{ hol: string; sor: string; fajl: string }> {
  return fajlok(GYOKER).flatMap((f) => {
    const rel = path.relative(GYOKER, f).replace(/\\/g, '/')
    return readFileSync(f, 'utf8')
      .split('\n')
      .map((sor, i) => ({ hol: `${rel}:${i + 1}`, sor, fajl: rel }))
      .filter(({ sor }) => !/^\s*(\/\/|\*|\/\*)/.test(sor))
  })
}

// A szóhatár a magyar ékezetes betűknél is (a \b csak az angol betűket ismeri).
const TEGEZO =
  /(?<![\p{L}])(Válassz|válassz|Add meg|add meg|Adj meg|vedd fel|Vedd fel|próbáld|Próbáld|ellenőrizd|Ellenőrizd|Nyisd|nyisd|Lépj|lépj|kattints|Kattints|Frissítsd|frissítsd|töröld|Töröld|törlöd|fiókod|céged|szerepköröd|jogosultságod|jelszavad|előfizetésed|változásod|telefonod|Várj|Írd|írd|Olvasd|Igazold|Számold|nyomd|fogadd|rögzítsd|kijelentkezel|folytatod|visszavonod|jóváhagyod|rögzíted|kezeled|látod|tudod|vagy bejelentkezve|vár rád|telefonodra|telefonodon|Telepíts|kódodat|koppints)(?![\p{L}])/u

describe('egységes szavak a Készletkezelőben', () => {
  const s = sorok()

  it('a felület magáz: nincs tegező felszólítás vagy birtokos', () => {
    expect(s.filter(({ sor }) => TEGEZO.test(sor)).map(({ hol, sor }) => `${hol}: ${sor.trim()}`)).toEqual([])
  })

  it('az áfa a helyesírás szerint: "ÁFA" csak az eÁFA nevében és a tárolt naplókategóriában', () => {
    const hibak = s.filter(({ sor, fajl }) => !ADAT.has(fajl) && /ÁFA/.test(sor.replace(/eÁFA/g, '')) && !/VAT_CATEGORY/.test(sor))
    expect(hibak.map(({ hol, sor }) => `${hol}: ${sor.trim()}`)).toEqual([])
  })

  it('szállító, nem beszállító (a felületen)', () => {
    const hibak = s.filter(({ sor, fajl }) => !ADAT.has(fajl) && /[Bb]eszállító/.test(sor))
    expect(hibak.map(({ hol, sor }) => `${hol}: ${sor.trim()}`)).toEqual([])
  })

  it('a szóhatár-figyelő az ékezetes szavakat is megtalálja', () => {
    expect(TEGEZO.test('Ha nem tudod beolvasni, írd be')).toBe(true)
    expect(TEGEZO.test('Ha nem tudja beolvasni, írja be')).toBe(false)
  })

  it('az üres állapot egy közös összetevő (EmptyState → fg-ures), nem saját szaggatott keretes doboz', () => {
    const sajat = s.filter(({ sor, fajl }) => fajl !== 'components/ui.tsx' && /border-dashed/.test(sor) && /text-center/.test(sor))
    expect(sajat.map(({ hol }) => hol)).toEqual([])
    expect(readFileSync(path.join(GYOKER, 'components/ui.tsx'), 'utf8')).toMatch(/fg-ures[^"]*"[^>]*data-ures-allapot/)
  })
})
