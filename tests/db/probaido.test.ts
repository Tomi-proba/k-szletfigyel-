// Az új cégek 30 napos próbát kapnak, beégetett ár nélkül (F20, az egységes sémában). Futtatás: KESZLET_TEST_DATABASE_URL=postgresql://…/keszlet_test npm test
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, ujAdatbazis, ujCeg } from './adatbazis'

const leiras = DB_URL ? describe : describe.skip
let pool: pg.Pool

beforeAll(async () => {
  if (!DB_URL) return
  pool = await ujAdatbazis('probaido')
})
afterAll(async () => {
  await pool?.end()
})

leiras('30 napos próba', () => {

  it('az új regisztráció 30 napos próbát kap, beégetett ár nélkül', async () => {
    const ceg = await ujCeg(pool, 'Új Kft.')
    const r = (await pool.query("select extract(epoch from trial_ends_at - now()) / 86400 as nap, plan_price_huf from public.companies where id = $1", [ceg.companyId])).rows[0]
    expect(Math.round(Number(r.nap))).toBe(30)
    expect(r.plan_price_huf).toBeNull()
  })
})
