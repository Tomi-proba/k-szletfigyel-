// Partnerek fizetési határideje és a raktáros vevőválasztása (AWEBOLDAL TERV.md F30): a vevőnek eladott, ki nem
// fizetett tétel határideje elfogadáskor a dátum + a vevő határideje; a raktáros a kimenő bejelentéshez vevőt adhat,
// de a fizetési adatokat (kifizetve, határidő) nem írhatja, és vevőt nem vehet fel.
// Futtatás: KESZLET_TEST_DATABASE_URL=postgresql://…/keszlet_test npm test
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, hibakod, ment, ujAdatbazis, ujCeg, ujCsapattag, type TesztFelhasznalo, type Valtozas } from './adatbazis'

const leiras = DB_URL ? describe : describe.skip

let pool: pg.Pool
let ceg: TesztFelhasznalo
let raktaros: TesztFelhasznalo
let termekId: string
let vevoId: string

beforeAll(async () => {
  if (!DB_URL) return
  pool = await ujAdatbazis('partner_hatarido')
  ceg = await ujCeg(pool)
  raktaros = await ujCsapattag(pool, ceg, 'raktaros')
  termekId = randomUUID()
  vevoId = randomUUID()
  await ment(pool, ceg.id, randomUUID(), [
    { tabla: 'customers', sor: { id: vevoId, company_id: ceg.companyId, name: 'Kovács Építő Kft.', payment_term_days: 15, version: null } },
    { tabla: 'suppliers', sor: { id: randomUUID(), company_id: ceg.companyId, name: 'Ablak Kft.', lead_time_days: 3, payment_term_days: 30, version: null } },
    {
      tabla: 'products',
      sor: {
        id: termekId,
        company_id: ceg.companyId,
        location_id: ceg.locationId,
        name: 'Cement',
        category: 'Építőanyag',
        unit: 'zsák',
        current_stock: 100,
        min_stock: 0,
        purchase_price: 1000,
        sale_price: 2000,
        created_at: '2026-11-14T08:00:00Z',
        updated_at: '2026-11-14T08:00:00Z',
        version: null,
      },
    },
  ])
})

afterAll(async () => {
  await pool?.end()
})

function kiadas(felulirt: Record<string, unknown> = {}): Valtozas {
  return {
    tabla: 'movements',
    sor: { id: randomUUID(), company_id: ceg.companyId, product_id: termekId, location_id: ceg.locationId, date: '2026-11-14', type: 'out', quantity: 2, version: null, ...felulirt },
  }
}
const sor = async (id: unknown) => (await pool.query('select customer_id, is_paid, due_date::text, approval_status from public.movements where id = $1', [id])).rows[0]

leiras('partnerek fizetési határideje (adatbázis)', () => {
  it('a határidő 0 és 365 nap között lehet', async () => {
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [{ tabla: 'customers', sor: { id: randomUUID(), company_id: ceg.companyId, name: 'Hibás', payment_term_days: 400, version: null } }]))).toBe('23514')
  })

  it('a raktáros a kimenő bejelentéshez vevőt adhat, a fizetési adatot nem', async () => {
    const jo = kiadas({ approval_status: 'pending', customer_id: vevoId })
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [jo]))).toBeNull()
    expect((await sor(jo.sor.id)).customer_id).toBe(vevoId)
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [kiadas({ approval_status: 'pending', customer_id: vevoId, is_paid: false })]))).toBe('42501')
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [kiadas({ approval_status: 'pending', customer_id: vevoId, due_date: '2026-12-01' })]))).toBe('42501')
  })

  it('a raktáros vevőt nem vehet fel', async () => {
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [{ tabla: 'customers', sor: { id: randomUUID(), company_id: ceg.companyId, name: 'Új vevő', version: null } }]))).toBe('42501')
  })

  it('elfogadáskor a ki nem fizetett eladás határideje a dátum + a vevő határideje', async () => {
    const b = kiadas({ approval_status: 'pending', customer_id: vevoId })
    await ment(pool, raktaros.id, randomUUID(), [b])
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [{ tabla: 'movements', sor: { ...b.sor, approval_status: 'approved', is_paid: false, version: 1 } }]))).toBeNull()
    expect(await sor(b.sor.id)).toMatchObject({ approval_status: 'approved', is_paid: false, due_date: '2026-11-29' })
  })

  it('a kifizetett (készpénzes) eladásnak nincs határideje', async () => {
    const k = kiadas({ customer_id: vevoId, is_paid: true })
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [k]))).toBeNull()
    expect((await sor(k.sor.id)).due_date).toBeNull()
  })
})
