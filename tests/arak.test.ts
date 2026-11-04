// Az árak a portál árlistájából jönnek; beégetett ár nincs, hibás vagy elérhetetlen árlistánál semmi.
import { describe, expect, it } from 'vitest'
import { arlistaLetoltese, keszletCsomag } from '../src/lib/arak'

const valasz = (adat: unknown, ok = true) => (async () => ({ ok, json: async () => adat })) as unknown as typeof fetch

describe('árlista a portálról', () => {
  const arlista = {
    penznem: 'HUF',
    afaKulcs: 27,
    probaidoNap: 30,
    csomagok: [{ kod: 'keszlet', nev: 'Készletkezelő', modulok: ['keszlet'], havidijNetto: 7990, havidijBrutto: 10147, kulonOsszeg: 7990, megtakaritas: 0, megtakaritasSzazalek: 0, kiemelt: false }],
  }

  it('a Készletkezelő ára az árlistából', async () => {
    expect(keszletCsomag(await arlistaLetoltese(valasz(arlista)))?.havidijNetto).toBe(7990)
  })

  it('elérhetetlen vagy hibás árlistánál nincs ár (nincs beégetett tartalék)', async () => {
    expect(await arlistaLetoltese(valasz(arlista, false))).toBeNull()
    expect(await arlistaLetoltese(valasz({ csomagok: 'x' }))).toBeNull()
    expect(await arlistaLetoltese((async () => { throw new Error('nincs hálózat') }) as unknown as typeof fetch)).toBeNull()
    expect(keszletCsomag(null)).toBeNull()
  })

  it('a forráskódban sehol nincs régi beégetett ár', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const fajlok = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? fajlok(join(d, f)) : [join(d, f)]))
    const talalat = fajlok('src').filter((f) => /\.(ts|tsx)$/.test(f) && /\b9 ?990\b|planPriceHuf/.test(readFileSync(f, 'utf8')))
    expect(talalat).toEqual([])
  })
})
