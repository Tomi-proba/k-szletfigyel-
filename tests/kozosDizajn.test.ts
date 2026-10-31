// A közös dizájn-tokenek itt csak másolat (src/kozos/FORRAS.json): a teszt jelzi, ha helyben átírták.
// A változtatás helye az AWEBOLDAL repó packages/dizajn/tokens.css-e; utána újra kell másolni.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const olvas = (ut: string) => readFileSync(new URL(`../src/kozos/${ut}`, import.meta.url))

describe('közös dizájn', () => {
  it('a tokenek másolata változatlan a forráshoz képest', () => {
    const forras = JSON.parse(olvas('FORRAS.json').toString('utf8')) as { sha256: Record<string, string> }
    for (const [fajl, hash] of Object.entries(forras.sha256)) expect(createHash('sha256').update(olvas(fajl)).digest('hex'), fajl).toBe(hash)
  })

  it('a közös komponensek csak a közös tokenekre építenek (nincs beégetett szín)', () => {
    const css = olvas('kozos.css').toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i)
    const hasznalt = new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]))
    const tokenek = olvas('dizajn-tokens.css').toString('utf8')
    for (const t of hasznalt) expect(tokenek, `${t} nincs a közös tokenek között`).toContain(`${t}:`)
  })
})
