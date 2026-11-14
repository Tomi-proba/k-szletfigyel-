// A Készletkezelő stílusa a keretben (AWEBOLDAL TERV.md F24 KS6): minden szabály a Készlet dobozára szűkül, a
// Tailwind rétegei feloldva (különben a portál réteg nélküli stílusa felülírná).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import { KESZLET_DOBOZ, szukit, szukitettSelektor } from '../keret-css'

describe('stílus a keretben', () => {
  it('a :root, html, body maga a doboz; minden más a dobozon belül', () => {
    expect(szukitettSelektor(':root')).toBe(KESZLET_DOBOZ)
    expect(szukitettSelektor('html')).toBe(KESZLET_DOBOZ)
    expect(szukitettSelektor('body .x')).toBe(`${KESZLET_DOBOZ} .x`)
    expect(szukitettSelektor('*::before')).toBe(`${KESZLET_DOBOZ} *::before`)
    expect(szukitettSelektor('.px-4')).toBe(`${KESZLET_DOBOZ} .px-4`)
  })

  it('a rétegek feloldva, a @keyframes lépései érintetlenek, nincs szűkítetlen szabály', () => {
    const css = szukit(`@layer theme, base;
@layer base { *, ::before { box-sizing: border-box } button { font: inherit } }
@layer utilities { .px-4 { padding: 1rem } @media (min-width: 40rem) { .sm\\:px-6 { padding: 1.5rem } } }
:root { --color-bg: #fff }
@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`)
    expect(css).not.toContain('@layer')
    const gyoker = postcss.parse(css)
    const kint: string[] = []
    gyoker.walkRules((r) => {
      if (r.parent?.type === 'atrule' && /keyframes$/.test((r.parent as { name: string }).name)) return
      for (const s of r.selectors) if (!s.startsWith(KESZLET_DOBOZ)) kint.push(s)
    })
    expect(kint).toEqual([])
    expect(css).toContain('from { transform: rotate(0) }')
  })

  it('a keret-csomag a közös komponensek stílusát is betölti, a Tailwind előtt (gombok, chipek)', () => {
    const forras = readFileSync(new URL('../src/modul.tsx', import.meta.url), 'utf8')
    const kozos = forras.indexOf("import './kozos/kozos.css'")
    expect(kozos).toBeGreaterThanOrEqual(0)
    expect(kozos).toBeLessThan(forras.indexOf("import './index.css'"))
  })
})
