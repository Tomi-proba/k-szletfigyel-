// Raktári bejelentés → fő irodai elfogadás az adatbázisban (2026-11-02, DOCUMENTATION.md 31. fejezet):
// a raktáros csak jóváhagyásra váró mozgást rögzíthet és csak a még el nem fogadottat módosíthatja; elfogadni
// vagy elutasítani csak a fő iroda tud; a raktáros beszerzési tételt nem írhat.
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

beforeAll(async () => {
  if (!DB_URL) return
  pool = await ujAdatbazis('raktari_bejelentes')
  ceg = await ujCeg(pool)
  raktaros = await ujCsapattag(pool, ceg, 'raktaros')
  iroda = await ujCsapattag(pool, ceg, 'iroda')
  termekId = randomUUID()
  await ment(pool, ceg.id, randomUUID(), [
    {
      tabla: 'products',
      sor: {
        id: termekId,
        company_id: ceg.companyId,
        location_id: ceg.locationId,
        name: 'Bejárati ajtó',
        category: 'Ajtó',
        unit: 'db',
        current_stock: 0,
        min_stock: 0,
        purchase_price: 1000,
        sale_price: 2000,
        created_at: '2026-11-02T08:00:00Z',
        updated_at: '2026-11-02T08:00:00Z',
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
    sor: {
      id: randomUUID(),
      company_id: ceg.companyId,
      product_id: termekId,
      location_id: ceg.locationId,
      date: '2026-11-02',
      type: 'in',
      quantity: 5,
      version: null,
      ...felulirt,
    },
  }
}

const allapot = async (id: unknown) => (await pool.query('select approval_status from public.movements where id = $1', [id])).rows[0]?.approval_status

leiras('raktári bejelentés (adatbázis)', () => {
  it('a raktáros csak jóváhagyásra váró mozgást rögzíthet', async () => {
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [mozgas()]))).toBe('42501')
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [mozgas({ approval_status: 'approved' })]))).toBe('42501')
    const b = mozgas({ approval_status: 'pending', raktar_visszaigazolva: '2026-11-02T09:00:00Z', raktar_mennyiseg: 5 })
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [b]))).toBeNull()
    expect(await allapot(b.sor.id)).toBe('pending')
  })

  it('a saját bejelentését nem fogadhatja el; az iroda sem; a fő iroda igen', async () => {
    const b = mozgas({ approval_status: 'pending' })
    await ment(pool, raktaros.id, randomUUID(), [b])
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [{ tabla: 'movements', sor: { ...b.sor, approval_status: 'approved', version: 1 } }]))).toBe('42501')
    expect(await hibakod(ment(pool, iroda.id, randomUUID(), [{ tabla: 'movements', sor: { ...b.sor, approval_status: 'approved', version: 1 } }]))).toBe('42501')
    expect(await hibakod(ment(pool, iroda.id, randomUUID(), [{ tabla: 'movements', sor: { ...b.sor, approval_status: 'rejected', version: 1 } }]))).toBe('42501')
    expect(await allapot(b.sor.id)).toBe('pending')
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [{ tabla: 'movements', sor: { ...b.sor, approval_status: 'approved', version: 1 } }]))).toBeNull()
    expect(await allapot(b.sor.id)).toBe('approved')
  })

  it('érvényes mozgást a raktáros nem módosíthat és nem törölhet', async () => {
    const m = mozgas()
    await ment(pool, ceg.id, randomUUID(), [m])
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [{ tabla: 'movements', sor: { ...m.sor, deleted_at: '2026-11-02T10:00:00Z', version: 1 } }]))).toBe(
      '42501',
    )
    expect((await pool.query('select deleted_at from public.movements where id = $1', [m.sor.id])).rows[0].deleted_at).toBeNull()
  })

  it('az elutasított bejelentését javíthatja és újraküldheti, vagy visszavonhatja', async () => {
    const b = mozgas({ approval_status: 'pending' })
    await ment(pool, raktaros.id, randomUUID(), [b])
    await ment(pool, ceg.id, randomUUID(), [{ tabla: 'movements', sor: { ...b.sor, approval_status: 'rejected', reject_reason: 'Hibás', version: 1 } }])
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [{ tabla: 'movements', sor: { ...b.sor, quantity: 4, approval_status: 'pending', version: 2 } }]))).toBeNull()
    expect(await allapot(b.sor.id)).toBe('pending')
    const c = mozgas({ approval_status: 'pending' })
    await ment(pool, raktaros.id, randomUUID(), [c])
    await ment(pool, ceg.id, randomUUID(), [{ tabla: 'movements', sor: { ...c.sor, approval_status: 'rejected', version: 1 } }])
    expect(
      await hibakod(ment(pool, raktaros.id, randomUUID(), [{ tabla: 'movements', sor: { ...c.sor, approval_status: 'rejected', deleted_at: '2026-11-02T11:00:00Z', version: 2 } }])),
    ).toBeNull()
  })

  it('a raktáros visszaigazolhatja a várakozó tételt, de beszerzési tételt nem írhat', async () => {
    const r = mozgas({ approval_status: 'pending', ordered_quantity: 5 })
    await ment(pool, ceg.id, randomUUID(), [r])
    expect(
      await hibakod(
        ment(pool, raktaros.id, randomUUID(), [
          { tabla: 'movements', sor: { ...r.sor, raktar_visszaigazolva: '2026-11-02T12:00:00Z', raktar_mennyiseg: 4, raktar_megjegyzes: 'Sérült', version: 1 } },
        ]),
      ),
    ).toBeNull()
    const sor = (await pool.query('select raktar_mennyiseg, raktar_megjegyzes, approval_status from public.movements where id = $1', [r.sor.id])).rows[0]
    expect({ ...sor, raktar_mennyiseg: Number(sor.raktar_mennyiseg) }).toEqual({ raktar_mennyiseg: 4, raktar_megjegyzes: 'Sérült', approval_status: 'pending' })
    const tetel = { id: randomUUID(), company_id: ceg.companyId, product_id: termekId, date: '2026-11-02', quantity: 1, remaining_quantity: 1 }
    const { rowCount } = await pool
      .connect()
      .then(async (db) => {
        try {
          await db.query('begin')
          await db.query('set local role authenticated')
          await db.query("select set_config('request.jwt.claim.sub', $1, true)", [raktaros.id])
          return await db.query(
            'insert into public.purchase_lots (id, company_id, product_id, date, quantity, remaining_quantity) values ($1, $2, $3, $4, $5, $6)',
            Object.values(tetel),
          )
        } catch (hiba) {
          return { rowCount: (hiba as { code?: string }).code === '42501' ? -1 : -2 }
        } finally {
          await db.query('rollback')
          db.release()
        }
      })
    expect(rowCount).toBe(-1)
  })
})
