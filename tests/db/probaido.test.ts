// A 2026-11-04-i migráció: az új cégek 30 napos próbát kapnak, a meglévők próbaideje és adatai nem
// változnak; beégetett ár nincs. Futtatás: KESZLET_TEST_DATABASE_URL=postgresql://…/keszlet_test npm test
import { readFileSync } from 'node:fs'
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

leiras('30 napos próba (2026-11-04)', () => {
  it('a meglévő cég próbaideje és ára változatlan marad a migráció (újra)futtatásakor', async () => {
    const { rows } = await pool.query(
      "insert into public.companies (name, trial_ends_at, plan_price_huf) values ('Régi Kft.', '2026-11-10T00:00:00Z', 9990) returning id",
    )
    await pool.query(readFileSync(new URL('../../supabase/migrations/2026-11-04_proba_30_nap.sql', import.meta.url), 'utf8'))
    const r = (await pool.query('select trial_ends_at, plan_price_huf from public.companies where id = $1', [rows[0].id])).rows[0]
    expect(new Date(r.trial_ends_at).toISOString()).toBe('2026-11-10T00:00:00.000Z')
    expect(r.plan_price_huf).toBe(9990)
  })

  it('az új regisztráció 30 napos próbát kap, beégetett ár nélkül', async () => {
    const ceg = await ujCeg(pool, 'Új Kft.')
    const r = (await pool.query("select extract(epoch from trial_ends_at - now()) / 86400 as nap, plan_price_huf from public.companies where id = $1", [ceg.companyId])).rows[0]
    expect(Math.round(Number(r.nap))).toBe(30)
    expect(r.plan_price_huf).toBeNull()
  })
})
