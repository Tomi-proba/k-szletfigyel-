// Raktáros és fő iroda munkamegosztása (AWEBOLDAL TERV.md F28): a napi zárást a raktáros küldi be (az iroda csak
// régi zárást tölthet fel átköltöztetéskor), a bejövő tétel szállítóját a fő iroda adja meg, a raktáros nem.
// Futtatás: KESZLET_TEST_DATABASE_URL=postgresql://…/keszlet_test npm test
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, hibakod, ment, ujAdatbazis, ujCeg, ujCsapattag, type TesztFelhasznalo, type Valtozas } from './adatbazis'

const leiras = DB_URL ? describe : describe.skip

let pool: pg.Pool
let ceg: TesztFelhasznalo
let raktaros: TesztFelhasznalo
let iroda: TesztFelhasznalo
let termekId: string
let termekSzallito: string
let masikSzallito: string

const ma = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' })

beforeAll(async () => {
  if (!DB_URL) return
  pool = await ujAdatbazis('munkamegosztas')
  ceg = await ujCeg(pool)
  raktaros = await ujCsapattag(pool, ceg, 'raktaros')
  iroda = await ujCsapattag(pool, ceg, 'iroda')
  termekId = randomUUID()
  termekSzallito = randomUUID()
  masikSzallito = randomUUID()
  await ment(pool, ceg.id, randomUUID(), [
    { tabla: 'suppliers', sor: { id: termekSzallito, company_id: ceg.companyId, name: 'Ablak Kft.', lead_time_days: 7, version: null } },
    { tabla: 'suppliers', sor: { id: masikSzallito, company_id: ceg.companyId, name: 'Ajtó Bt.', lead_time_days: 3, version: null } },
    {
      tabla: 'products',
      sor: {
        id: termekId,
        company_id: ceg.companyId,
        location_id: ceg.locationId,
        name: 'Ablak 120×120',
        category: 'Ablak',
        unit: 'db',
        current_stock: 0,
        min_stock: 0,
        purchase_price: 1000,
        sale_price: 2000,
        supplier_id: termekSzallito,
        created_at: '2026-11-13T08:00:00Z',
        updated_at: '2026-11-13T08:00:00Z',
        version: null,
      },
    },
  ])
})

afterAll(async () => {
  await pool?.end()
})

function mozgas(felulirt: Record<string, unknown> = {}): Valtozas {
  return {
    tabla: 'movements',
    sor: { id: randomUUID(), company_id: ceg.companyId, product_id: termekId, location_id: ceg.locationId, date: ma(), type: 'in', quantity: 5, version: null, ...felulirt },
  }
}

function zaras(datum: string): Valtozas {
  return {
    tabla: 'daily_closings',
    sor: { id: randomUUID(), company_id: ceg.companyId, location_id: ceg.locationId, date: datum, in_count: 0, out_count: 0, version: null },
  }
}

const szallito = async (id: unknown) => (await pool.query('select supplier_id from public.movements where id = $1', [id])).rows[0]?.supplier_id

leiras('munkamegosztás: raktáros és fő iroda (adatbázis)', () => {
  it('a mai napi zárást csak a raktáros küldheti be; a fő iroda és az iroda nem', async () => {
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [zaras(ma())]))).toBe('42501')
    expect(await hibakod(ment(pool, iroda.id, randomUUID(), [zaras(ma())]))).toBe('42501')
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [zaras(ma())]))).toBeNull()
  })

  it('a fő iroda régi (korábbi napi) zárást feltölthet: a böngészős adatok átköltöztetése', async () => {
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [zaras('2026-10-01')]))).toBeNull()
  })

  it('a raktáros nem adhat meg szállítót a bejelentésben', async () => {
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [mozgas({ approval_status: 'pending', supplier_id: masikSzallito })]))).toBe('42501')
  })

  it('a raktáros nem írhatja át a fő iroda által megadott szállítót, a mennyiséget visszaigazolhatja', async () => {
    const r = mozgas({ approval_status: 'pending', ordered_quantity: 5, supplier_id: masikSzallito })
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [r]))).toBeNull()
    expect(await szallito(r.sor.id)).toBe(masikSzallito)
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [{ tabla: 'movements', sor: { ...r.sor, supplier_id: termekSzallito, version: 1 } }]))).toBe('42501')
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [{ tabla: 'movements', sor: { ...r.sor, supplier_id: null, version: 1 } }]))).toBe('42501')
    expect(
      await hibakod(
        ment(pool, raktaros.id, randomUUID(), [{ tabla: 'movements', sor: { ...r.sor, raktar_visszaigazolva: '2026-11-13T10:00:00Z', raktar_mennyiseg: 5, version: 1 } }]),
      ),
    ).toBeNull()
    expect(await szallito(r.sor.id)).toBe(masikSzallito)
  })

  it('a raktári bejelentés elfogadásakor a fő iroda pótolja a szállítót; üresen a termék szállítója kerül rá', async () => {
    const a = mozgas({ approval_status: 'pending' })
    await ment(pool, raktaros.id, randomUUID(), [a])
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [{ tabla: 'movements', sor: { ...a.sor, approval_status: 'approved', supplier_id: masikSzallito, version: 1 } }]))).toBeNull()
    expect(await szallito(a.sor.id)).toBe(masikSzallito)
    const b = mozgas({ approval_status: 'pending' })
    await ment(pool, raktaros.id, randomUUID(), [b])
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [{ tabla: 'movements', sor: { ...b.sor, approval_status: 'approved', version: 1 } }]))).toBeNull()
    expect(await szallito(b.sor.id)).toBe(termekSzallito)
  })

  it('a Könyvelőbe menő beszerzés a tétel szállítójával megy, ha van; különben a termékével', async () => {
    const sajat = mozgas({ supplier_id: masikSzallito })
    const nelkule = mozgas()
    await ment(pool, ceg.id, randomUUID(), [sajat, nelkule])
    const kep = async (id: unknown) => (await pool.query('select integracio.mozgas_kep($1) k', [id])).rows[0].k
    expect((await kep(sajat.sor.id)).szallito.name).toBe('Ajtó Bt.')
    expect((await kep(nelkule.sor.id)).szallito.name).toBe('Ablak Kft.')
  })
})
