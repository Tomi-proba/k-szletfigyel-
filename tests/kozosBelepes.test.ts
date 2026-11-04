// Kötelező kétlépcsős azonosítás és közös belépés a Készletben (AWEBOLDAL TERV.md F21): a felület tiszta része.
import { describe, expect, it } from 'vitest'
import { KESZLET_CIMZETT, jegyHiba, jegyTartalom, lejart, mfaAllapot, ssoAdatok, tetlensegPerc } from '../src/lib/kozosBelepes'

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jegy = (o: Record<string, unknown>) => `${b64({ alg: 'ES256' })}.${b64(o)}.alairas`
const MOST = Date.parse('2026-11-05T08:00:00Z')
const jo = { aud: KESZLET_CIMZETT, exp: MOST / 1000 + 100, email: 'Raktaros@Ceg.hu', aal: 'aal2', tetlenseg_perc: 480 }

describe('kétlépcsős állapot', () => {
  it('csak aal2 a teljes belépés; ellenőrzött tényezőnél kód kell, különben beállítás', () => {
    expect(mfaAllapot({ currentLevel: 'aal2', nextLevel: 'aal2' })).toBe('ok')
    expect(mfaAllapot({ currentLevel: 'aal1', nextLevel: 'aal2' })).toBe('kell-kod')
    expect(mfaAllapot({ currentLevel: 'aal1', nextLevel: 'aal1' })).toBe('kell-beallitas')
    expect(mfaAllapot({ currentLevel: null, nextLevel: null })).toBe('kell-beallitas')
  })
})

describe('belépés a portálról', () => {
  it('a cím adatai', () => {
    expect(ssoAdatok('#/sso?jegy=a.b.c&at=AT&rt=RT')).toEqual({ jegy: 'a.b.c', at: 'AT', rt: 'RT' })
    expect(ssoAdatok('#/sso?jegy=a.b.c')).toEqual({ jegy: 'a.b.c', at: null, rt: null })
    expect(ssoAdatok('#/keszlet')).toBeNull()
    expect(ssoAdatok('#/sso?x=1')).toBeNull()
  })

  it('jó jegy: ennek a modulnak szól, nem járt le, kétlépcsős, ugyanaz a felhasználó (e-mail kis-nagybetű nélkül)', () => {
    const t = jegyTartalom(jegy(jo))
    expect(t?.tetlenseg_perc).toBe(480)
    expect(jegyHiba(t, 'raktaros@ceg.hu', MOST)).toBeNull()
  })

  it('rossz jegyek', () => {
    expect(jegyHiba(jegyTartalom('nem-jegy'), 'raktaros@ceg.hu', MOST)).toMatch(/Érvénytelen/)
    expect(jegyHiba(jegyTartalom(jegy({ ...jo, aud: 'eafa-csomag:modul:afa' })), 'raktaros@ceg.hu', MOST)).toMatch(/nem a Készletkezelőnek/)
    expect(jegyHiba(jegyTartalom(jegy({ ...jo, exp: MOST / 1000 - 120 })), 'raktaros@ceg.hu', MOST)).toMatch(/lejárt/)
    expect(jegyHiba(jegyTartalom(jegy({ ...jo, aal: 'aal1' })), 'raktaros@ceg.hu', MOST)).toMatch(/kétlépcsős/)
    expect(jegyHiba(jegyTartalom(jegy(jo)), 'masik@ceg.hu', MOST)).toMatch(/nem ugyanahhoz/)
  })

  it('ékezetes név is olvasható a jegyből', () => {
    expect(jegyTartalom(jegy({ ...jo, name: 'Árvíztűrő Éva' }))).not.toBeNull()
  })
})

describe('tétlenség', () => {
  it('alapból 30 perc; raktárosnál a cég beállítása; közös belépésnél a jegyből; legfeljebb 12 óra', () => {
    expect(tetlensegPerc({ jegybol: null, szerep: 'iroda', cegRaktaros: 480 })).toBe(30)
    expect(tetlensegPerc({ jegybol: null, szerep: 'raktaros', cegRaktaros: 480 })).toBe(480)
    expect(tetlensegPerc({ jegybol: null, szerep: 'raktaros', cegRaktaros: null })).toBe(30)
    expect(tetlensegPerc({ jegybol: 120, szerep: 'raktaros', cegRaktaros: 480 })).toBe(120)
    expect(tetlensegPerc({ jegybol: 5000, szerep: null, cegRaktaros: null })).toBe(720)
  })

  it('lejár tétlenség után, és 12 óra után akkor is, ha közben dolgozott', () => {
    expect(lejart({ utolsoAktivitasMs: MOST - 29 * 60_000, belepesMs: MOST - 60_000, perc: 30, mostMs: MOST })).toBe(false)
    expect(lejart({ utolsoAktivitasMs: MOST - 31 * 60_000, belepesMs: MOST - 60_000, perc: 30, mostMs: MOST })).toBe(true)
    expect(lejart({ utolsoAktivitasMs: MOST, belepesMs: MOST - 13 * 3_600_000, perc: 720, mostMs: MOST })).toBe(true)
  })
})
