import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A keret közös csomagjai (felulet, modulok, arak, dizajn) itt csak MÁSOLATOK (AWEBOLDAL TERV.md F24 KS1). A teszt
 * jelez, ha a másolat eltér a keret eredetijétől: ha valaki helyben átírta, vagy fájlt adott hozzá. A változtatás
 * helye az AWEBOLDAL repó; utána újra kell másolni: `npx tsx scripts/kozos-masolas.ts ../k-szletfigyel-/kozos-keret`.
 */
const kozos = path.resolve(import.meta.dirname, '../kozos-keret')
const forras = JSON.parse(readFileSync(path.join(kozos, 'FORRAS.json'), 'utf8')) as { commit: string; fajlok: Record<string, string> }

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((n) => {
    const t = path.join(mappa, n)
    if (n === 'node_modules') return []
    return statSync(t).isDirectory() ? fajlok(t) : [path.relative(kozos, t)]
  })
}

describe('a keret közös csomagjainak másolata', () => {
  it('minden fájl változatlan az eredetihez képest', () => {
    for (const [f, h] of Object.entries(forras.fajlok)) expect(createHash('sha256').update(readFileSync(path.join(kozos, f))).digest('hex'), f).toBe(h)
  })
  it('nincs helyben hozzáadott vagy hiányzó fájl', () => {
    expect(fajlok(kozos).filter((f) => f !== 'FORRAS.json').sort()).toEqual(Object.keys(forras.fajlok).sort())
  })
  it('commitolt forrásból készült', () => {
    expect(forras.commit).toMatch(/^[0-9a-f]{40}$/)
  })
})
