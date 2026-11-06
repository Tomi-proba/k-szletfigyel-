// Könyvelőiroda (AWEBOLDAL TERV.md F26a): minden ügyfél külön portál-cég és külön Készlet-cég. A portál csak a
// hozzárendelt irodai munkatársnak (és az irodavezetőnek) ad tagságot egy ügyfélben; a Készlet a portál
// igazítása szerint vesz fel vagy töröl tagot. Itt azt igazoljuk az adatbázis szintjén (RLS), hogy
//   - a nem hozzárendelt irodai munkatárs az ügyfél adataiból semmit nem lát és nem ír, akkor sem, ha a kérésben
//     kifejezetten azt a céget választja;
//   - az ügyfél saját embere csak a saját cégét látja, az iroda többi ügyfelét nem;
//   - a hozzárendelés megszűnésével a munkatárs az addigi ügyfelet sem látja.
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, hibakod, ment, nevebenFut, ujAdatbazis, ujCeg, type TesztFelhasznalo } from './adatbazis'

const leiras = DB_URL ? describe : describe.skip
let pool: pg.Pool
let u1: TesztFelhasznalo
let u2: TesztFelhasznalo
const portalUgyfel1 = randomUUID()
const portalUgyfel2 = randomUUID()
const munkatars = { id: randomUUID(), email: `munkatars-${randomUUID()}@iroda.example` }
const ugyfelEmbere = { id: randomUUID(), email: `raktar-${randomUUID()}@masodik.example` }

const igazit = async (ceg: string, email: string, szerep: string | null) =>
  (await pool.query("select public.portal_tagsag_igazitas($1, $2, $3, $4, now() + interval '5 minutes') as e", [ceg, email, szerep, randomUUID()])).rows[0].e as string

const termekSor = (u: TesztFelhasznalo, name: string) => ({
  tabla: 'products',
  sor: {
    id: randomUUID(),
    company_id: u.companyId,
    location_id: u.locationId,
    name,
    category: 'Teszt',
    unit: 'db',
    current_stock: 0,
    min_stock: 0,
    purchase_price: 100,
    sale_price: 200,
    created_at: '2026-11-06T08:00:00Z',
    updated_at: '2026-11-06T08:00:00Z',
    version: null,
  },
})

const termekei = (felhasznalo: string, ceg?: string) =>
  nevebenFut(pool, felhasznalo, async (db) => (await db.query('select name from public.products order by name')).rows.map((r) => r.name as string), ceg)

beforeAll(async () => {
  if (!DB_URL) return
  pool = await ujAdatbazis('iroda_elkulonites')
  u1 = await ujCeg(pool, 'Első Ügyfél Kft.')
  u2 = await ujCeg(pool, 'Második Ügyfél Bt.')
  await pool.query('update public.companies set portal_company_id = $1 where id = $2', [portalUgyfel1, u1.companyId])
  await pool.query('update public.companies set portal_company_id = $1 where id = $2', [portalUgyfel2, u2.companyId])
  for (const [u, nev] of [
    [u1, 'Első ügyfél terméke'],
    [u2, 'Második ügyfél terméke'],
  ] as const)
    await pool.query('insert into public.products (company_id, location_id, name, category, unit) values ($1, $2, $3, $4, $5)', [u.companyId, u.locationId, nev, 'Teszt', 'db'])
  for (const f of [munkatars, ugyfelEmbere]) await pool.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [f.id, f.email, { name: 'Teszt' }])
})
afterAll(async () => {
  await pool?.end()
})

leiras('könyvelőiroda: az ügyfelek elkülönítése a Készletben (F26a)', () => {
  it('a csak az első ügyfélhez rendelt munkatárs a második ügyfél adatait nem látja és nem írja', async () => {
    expect(await igazit(portalUgyfel1, munkatars.email, 'iroda')).toBe('igazitva')
    expect(await termekei(munkatars.id, u1.companyId)).toEqual(['Első ügyfél terméke'])
    // Kifejezetten a második ügyfelet választja: semmit nem lát, írni sem tud.
    expect(await termekei(munkatars.id, u2.companyId)).toEqual([])
    const kod = await hibakod(
      ment(pool, munkatars.id, randomUUID(), [termekSor(u2, 'Becsempészett')], u2.companyId),
    )
    expect(kod).not.toBeNull()
    expect((await pool.query("select count(*)::int as n from public.products where name = 'Becsempészett'")).rows[0].n).toBe(0)
    // Ellenpróba: ugyanez a sor a cég saját tulajdonosának mentődik (a hiba tehát a jogosultságé).
    await ment(pool, u2.id, randomUUID(), [termekSor(u2, 'Saját termék')], u2.companyId)
    expect((await pool.query("select count(*)::int as n from public.products where name = 'Saját termék'")).rows[0].n).toBe(1)
    // A tagjai között sem szerepel a második ügyfél.
    const cegei = (await pool.query('select company_id from public.company_members where user_id = $1', [munkatars.id])).rows.map((r) => r.company_id)
    expect(cegei).toEqual([u1.companyId])
  })

  it('az ügyfél saját embere csak a saját cégét látja, az iroda többi ügyfelét nem', async () => {
    expect(await igazit(portalUgyfel2, ugyfelEmbere.email, 'raktaros')).toBe('igazitva')
    expect(await termekei(ugyfelEmbere.id, u2.companyId)).toEqual(['Második ügyfél terméke', 'Saját termék'])
    expect(await termekei(ugyfelEmbere.id, u1.companyId)).toEqual([])
    expect(await termekei(ugyfelEmbere.id)).toEqual(['Második ügyfél terméke', 'Saját termék'])
  })

  it('a hozzárendelés megszűnésével a munkatárs az addigi ügyfelet sem látja', async () => {
    expect(await igazit(portalUgyfel1, munkatars.email, null)).toBe('eltavolitva')
    expect(await termekei(munkatars.id, u1.companyId)).toEqual([])
    expect(await termekei(munkatars.id)).toEqual([])
  })
})
