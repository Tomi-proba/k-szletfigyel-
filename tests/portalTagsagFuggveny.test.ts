// A portal-tagsag Edge Function logikája (AWEBOLDAL TERV.md F25): csak a portál aláírt, a Készletnek szóló
// jelzése és kétlépcsős belépési jegye fogadható el; a jegy csak a saját fiókra érvényes.
import { randomUUID } from 'node:crypto'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, type CryptoKey, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { BELEPESI_CIMZETT, KERES_CIMZETT, TAGSAG_CIMZETT, kezel, type Fuggosegek } from '../supabase/functions/portal-tagsag/logika'

const KIADO = 'http://portal.teszt'
let kulcs: CryptoKey
let idegenKulcs: CryptoKey
let jwk: JWK
const ceg = randomUUID()
let hivasok: Array<{ ceg: string; email: string; szerep: string | null; jti: string }>
let kivonatHivasok: Array<{ email: string; cegek: Array<{ id: string; modulSzerep: string | null }> }> = []
let portalKivonat: string | null = null
const felhasznalt = new Set<string>()

function fuggosegek(email: string | null = 'rita@pelda.hu'): Fuggosegek {
  const kulcsok = createLocalJWKSet({ keys: [jwk] })
  return {
    ellenoriz: async (t, cimzett) => (await jwtVerify(t, kulcsok, { issuer: KIADO, audience: cimzett, algorithms: ['ES256'] })).payload,
    felhasznaloEmail: async (t) => (t === 'jo-token' ? email : null),
    igazit: async (c, e, sz, jti) => {
      hivasok.push({ ceg: c, email: e, szerep: sz, jti })
      if (felhasznalt.has(jti)) return 'mar-felhasznalt'
      felhasznalt.add(jti)
      return sz === null ? 'eltavolitva' : 'igazitva'
    },
    kivonatKeres: async (t) => (t === 'jo-token' ? portalKivonat : null),
    kivonat: async (e, cegek) => (kivonatHivasok.push({ email: e, cegek }), 'igazitva'),
    kapcsolodasiKod: async (c, adoszam, jti) => {
      kodHivasok.push({ ceg: c, adoszam })
      if (felhasznalt.has(jti)) return { hiba: 'mar-felhasznalt' }
      felhasznalt.add(jti)
      return c === ceg ? { kod: 'ABCD-EFGH-JKMN-PQRS', lejar: '2026-11-13T00:00:00Z' } : { hiba: 'nincs-ceg' }
    },
  }
}
const kodHivasok: Array<{ ceg: string; adoszam: string }> = []

const alair = (payload: Record<string, unknown>, cimzett: string, k: CryptoKey = kulcs) =>
  new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(KIADO).setAudience(cimzett).setSubject('portal-sub').setJti(randomUUID()).setIssuedAt().setExpirationTime('120s').sign(k)

const jelzes = (modulSzerep: string | null, cimzett = TAGSAG_CIMZETT, k?: CryptoKey) =>
  alair({ esemeny: 'tagsag', email: 'rita@pelda.hu', name: 'Raktár Rita', ceg: { id: ceg, nev: 'Minta Kft.' }, modulSzerep }, cimzett, k)
const jegy = (modulSzerep: string | null, aal = 'aal2') =>
  alair({ sid: 'sid-1', email: 'Rita@Pelda.hu', name: 'Raktár Rita', aal, tetlenseg_perc: 480, ceg: { id: ceg, nev: 'Minta Kft.', szerep: 'munkatars', modulSzerep, csakOlvashato: false } }, BELEPESI_CIMZETT)

beforeAll(async () => {
  const p = await generateKeyPair('ES256', { extractable: true })
  kulcs = p.privateKey
  jwk = { ...(await exportJWK(p.publicKey)), kid: 'k1', alg: 'ES256' }
  idegenKulcs = (await generateKeyPair('ES256')).privateKey
})

describe('portal-tagsag (F25)', () => {
  it('a portál jelzése a tagságot a portál szerint igazítja, eltávolításkor is', async () => {
    hivasok = []
    expect(await kezel({ jelzes: await jelzes('raktaros') }, null, fuggosegek())).toEqual({ statusz: 200, adat: { eredmeny: 'igazitva' } })
    expect(await kezel({ jelzes: await jelzes(null) }, null, fuggosegek())).toEqual({ statusz: 200, adat: { eredmeny: 'eltavolitva' } })
    expect(hivasok.map((h) => [h.ceg, h.email, h.szerep])).toEqual([
      [ceg, 'rita@pelda.hu', 'raktaros'],
      [ceg, 'rita@pelda.hu', null],
    ])
  })

  it('hamis aláírás, más modulnak szóló jelzés, ismeretlen szerep: elutasítva, semmi nem változik', async () => {
    hivasok = []
    expect((await kezel({ jelzes: await jelzes('raktaros', TAGSAG_CIMZETT, idegenKulcs) }, null, fuggosegek())).statusz).toBe(401)
    expect((await kezel({ jelzes: await jelzes('raktaros', 'eafa-csomag:tagsag:konyvelo') }, null, fuggosegek())).statusz).toBe(401)
    expect((await kezel({ jelzes: await jelzes('fonok') }, null, fuggosegek())).statusz).toBe(400)
    // A belépési jegy nem jelzés.
    expect((await kezel({ jelzes: await jegy('raktaros') }, null, fuggosegek())).statusz).toBe(401)
    expect(hivasok).toEqual([])
  })

  it('belépéskor a jegy a saját fiókra igazít; más fiók tokenjével, kétlépcsős nélkül vagy kétszer nem', async () => {
    hivasok = []
    const j = await jegy('raktaros')
    expect(await kezel({ jegy: j }, null, fuggosegek())).toMatchObject({ statusz: 401 })
    expect(await kezel({ jegy: j }, 'Bearer jo-token', fuggosegek('masik@pelda.hu'))).toMatchObject({ statusz: 403, adat: { hiba: 'mas-felhasznalo' } })
    expect(await kezel({ jegy: j }, 'Bearer jo-token', fuggosegek())).toEqual({ statusz: 200, adat: { eredmeny: 'igazitva', szerep: 'raktaros' } })
    expect(await kezel({ jegy: j }, 'Bearer jo-token', fuggosegek())).toMatchObject({ statusz: 401, adat: { hiba: 'mar-felhasznalt' } })
    expect(await kezel({ jegy: await jegy('raktaros', 'aal1') }, 'Bearer jo-token', fuggosegek())).toMatchObject({ statusz: 401, adat: { hiba: 'nem-ketlepcsos' } })
    expect(hivasok.map((h) => h.szerep)).toEqual(['raktaros', 'raktaros'])
  })

  it('üres kérés: 400', async () => {
    expect((await kezel({}, null, fuggosegek())).statusz).toBe(400)
  })
  it('F26: önálló belépéskor a portál aláírt kivonata szerint igazít; hamis vagy más fiókra szóló kivonat nem jó', async () => {
    const ceg2 = randomUUID()
    const kiv = (email = 'rita@pelda.hu', k: CryptoKey = kulcs) =>
      alair({ esemeny: 'kivonat', email, cegek: [{ id: ceg, modulSzerep: 'raktaros', modulJogok: [] }, { id: ceg2, modulSzerep: null, modulJogok: [] }] }, TAGSAG_CIMZETT, k)
    kivonatHivasok = []
    portalKivonat = await kiv()
    expect(await kezel({ onallo: true }, 'Bearer jo-token', fuggosegek())).toEqual({ statusz: 200, adat: { eredmeny: 'igazitva' } })
    expect(kivonatHivasok).toEqual([{ email: 'rita@pelda.hu', cegek: [{ id: ceg, modulSzerep: 'raktaros' }, { id: ceg2, modulSzerep: null }] }])
    // Token nélkül nincs; nem portál-felhasználó: nincs változás.
    expect((await kezel({ onallo: true }, null, fuggosegek())).statusz).toBe(401)
    portalKivonat = null
    expect(await kezel({ onallo: true }, 'Bearer jo-token', fuggosegek())).toEqual({ statusz: 200, adat: { eredmeny: 'nincs-portal' } })
    // Hamis aláírás, más fiókra szóló kivonat: elutasítva.
    portalKivonat = await kiv('rita@pelda.hu', idegenKulcs)
    expect((await kezel({ onallo: true }, 'Bearer jo-token', fuggosegek())).statusz).toBe(502)
    portalKivonat = await kiv('masik@pelda.hu')
    expect((await kezel({ onallo: true }, 'Bearer jo-token', fuggosegek())).statusz).toBe(403)
    expect(kivonatHivasok).toHaveLength(1)
  })
})

describe('a portál kérése (F27 K): kapcsolódási kód a központhoz kód másolása nélkül', () => {
  const keres = (c = ceg, cimzett = KERES_CIMZETT, k?: CryptoKey, feladat = 'kozpont-kod') =>
    alair({ esemeny: 'kapcsolat', feladat, ceg: { id: c, nev: 'Minta Kft.', adoszam: '10773381-2-44' } }, cimzett, k)

  it('a portál aláírt, a Készletnek szóló kérésére kódot ad a portál cégéhez rendelt cégre', async () => {
    const v = await kezel({ keres: await keres() }, null, fuggosegek())
    expect(v).toEqual({ statusz: 200, adat: { kod: 'ABCD-EFGH-JKMN-PQRS', lejar: '2026-11-13T00:00:00Z' } })
    expect(kodHivasok.at(-1)).toEqual({ ceg, adoszam: '10773381-2-44' })
  })

  it('amíg a cég nincs meg a Készletben: 409 nincs-ceg (a portál később újra próbálja)', async () => {
    expect((await kezel({ keres: await keres(randomUUID()) }, null, fuggosegek())).statusz).toBe(409)
  })

  it('ismételt, idegen kulccsal aláírt, más címzettnek szóló vagy ismeretlen feladatú kérés nem jó', async () => {
    const j = await keres()
    expect((await kezel({ keres: j }, null, fuggosegek())).statusz).toBe(200)
    expect((await kezel({ keres: j }, null, fuggosegek())).statusz).toBe(401)
    expect((await kezel({ keres: await keres(ceg, KERES_CIMZETT, idegenKulcs) }, null, fuggosegek())).statusz).toBe(401)
    expect((await kezel({ keres: await keres(ceg, TAGSAG_CIMZETT) }, null, fuggosegek())).statusz).toBe(401)
    expect((await kezel({ keres: await keres(ceg, KERES_CIMZETT, undefined, 'nav-kod') }, null, fuggosegek())).statusz).toBe(422)
  })
})
