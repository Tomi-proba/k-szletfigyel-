// Futási mód (AWEBOLDAL TERV.md F24 KS2): önállóan minden útvonal a régi; a keretben a /keszlet előtag alatt.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { keretModBeallitas, keretben, sajatUtvonal, ut } from '../src/keret/futas'

afterEach(() => keretModBeallitas(''))

function forrasok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((n) => {
    const t = path.join(mappa, n)
    return statSync(t).isDirectory() ? forrasok(t) : /\.tsx?$/.test(n) ? [t] : []
  })
}

describe('futási mód', () => {
  it('önállóan az útvonalak változatlanok', () => {
    expect(keretben()).toBe(false)
    expect(ut('/mozgasnaplo')).toBe('/mozgasnaplo')
    expect(ut('/')).toBe('/')
  })

  it('a keretben a /keszlet előtag alá kerülnek, kétszer nem', () => {
    keretModBeallitas('/keszlet')
    expect(keretben()).toBe(true)
    expect(ut('/')).toBe('/keszlet')
    expect(ut('/mozgasnaplo')).toBe('/keszlet/mozgasnaplo')
    expect(ut('/keszlet')).toBe('/keszlet')
    expect(ut('/keszlet/mozgasnaplo')).toBe('/keszlet/mozgasnaplo')
    expect(ut('/riasztasok?szuro=fizetesi')).toBe('/keszlet/riasztasok?szuro=fizetesi')
    expect(ut('relativ')).toBe('relativ')
    expect(sajatUtvonal('/keszlet/mozgasnaplo')).toBe('/mozgasnaplo')
    expect(sajatUtvonal('/keszlet')).toBe('/')
  })

  it('a felület a react-router-dom hivatkozásait csak a keret/router.tsx-en át használja', () => {
    const src = path.resolve(import.meta.dirname, '../src')
    const hibak = forrasok(src)
      .filter((f) => !f.includes(`${path.sep}keret${path.sep}`))
      .filter((f) => /import \{[^}]*\b(Link|NavLink|Navigate|useNavigate)\b[^}]*\} from 'react-router-dom'/.test(readFileSync(f, 'utf8')))
    expect(hibak).toEqual([])
  })
})
