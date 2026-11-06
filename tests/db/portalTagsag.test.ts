// Felhasználókezelés egy helyen (AWEBOLDAL TERV.md F25): a portál tagság-igazítása a Készletben. A függvényt
// csak a portal-tagsag Edge Function hívja (service role), a portál aláírt jelzése vagy belépési jegye után.
// Itt: létrehozás a portál szerepével, szerepváltás, eltávolítás (utána a tag a cég adataiból semmit nem lát),
// visszajátszás, ismeretlen cég/felhasználó, és hogy böngészőből (authenticated) nem hívható.
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, hibakod, nevebenFut, ujAdatbazis, ujCeg, type TesztFelhasznalo } from './adatbazis'

const leiras = DB_URL ? describe : describe.skip
let pool: pg.Pool
let tulaj: TesztFelhasznalo
const portalCeg = randomUUID()
let tagId: string
const tagEmail = `tag-${randomUUID()}@teszt.example`

const igazit = async (szerep: string | null, jti = randomUUID(), ceg = portalCeg, email = tagEmail) =>
  (await pool.query('select public.portal_tagsag_igazitas($1, $2, $3, $4, now() + interval \'5 minutes\') as e', [ceg, email, szerep, jti])).rows[0].e as string
const tagsag = async () => (await pool.query('select role, portal_kezeli, assigned_location_id from public.company_members where user_id = $1', [tagId])).rows

beforeAll(async () => {
  if (!DB_URL) return
  pool = await ujAdatbazis('portal_tagsag')
  tulaj = await ujCeg(pool, 'Portál Kft.')
  await pool.query('update public.companies set portal_company_id = $1 where id = $2', [portalCeg, tulaj.companyId])
  tagId = randomUUID()
  // A munkatárs a közös Supabase-ben regisztrált (a portálon), cég nélkül.
  await pool.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [tagId, tagEmail, { name: 'Raktár Rita' }])
  await pool.query('insert into public.products (company_id, location_id, name, category, unit) values ($1, $2, $3, $4, $5)', [
    tulaj.companyId,
    tulaj.locationId,
    'Titkos termék',
    'Teszt',
    'db',
  ])
})
afterAll(async () => {
  await pool?.end()
})

leiras('portál tagság-igazítás (F25)', () => {
  it('a portál szerepével jön létre; a raktáros a cég első telephelyét kapja; portálon kezelt', async () => {
    expect(await igazit('raktaros')).toBe('igazitva')
    expect(await tagsag()).toEqual([{ role: 'raktaros', portal_kezeli: true, assigned_location_id: tulaj.locationId }])
    const termekek = await nevebenFut(pool, tagId, async (db) => (await db.query('select name from public.products')).rows)
    expect(termekek).toEqual([{ name: 'Titkos termék' }])
  })

  it('szerepváltás azonnal érvényes, és az audit naplóba kerül', async () => {
    expect(await igazit('iroda')).toBe('igazitva')
    expect(await tagsag()).toEqual([{ role: 'iroda', portal_kezeli: true, assigned_location_id: null }])
    const naplo = (await pool.query("select action, description, created_by_name from public.audit_log where entity_type = 'csapat' and entity_id = $1 order by event_timestamp", [tagId])).rows
    expect(naplo.map((n) => n.action)).toEqual(['create', 'update'])
    expect(naplo[1].description).toContain('raktaros → iroda')
    expect(naplo[1].created_by_name).toBe('Portál')
  })

  it('ugyanaz a jelzés még egyszer: nincs hatása', async () => {
    const jti = randomUUID()
    expect(await igazit('tulajdonos', jti)).toBe('igazitva')
    expect(await igazit('raktaros', jti)).toBe('mar-felhasznalt')
    expect((await tagsag())[0].role).toBe('tulajdonos')
  })

  it('ismeretlen cég vagy felhasználó: nincs teendő; ismeretlen szerep: hiba', async () => {
    expect(await igazit('iroda', randomUUID(), randomUUID())).toBe('nincs-ceg')
    expect(await igazit('iroda', randomUUID(), portalCeg, 'senki@teszt.example')).toBe('nincs-felhasznalo')
    expect(await hibakod(igazit('fonok'))).toBe('22023')
  })

  it('böngészőből (bejelentkezett felhasználóként) nem hívható', async () => {
    const kod = await hibakod(
      nevebenFut(pool, tulaj.id, (db) => db.query("select public.portal_tagsag_igazitas($1, $2, 'fo_iroda', $3, now())", [portalCeg, tagEmail, randomUUID()])),
    )
    expect(kod).toBe('42501')
  })

  it('eltávolítás: a tagság megszűnik, a tag a cég adataiból semmit nem lát', async () => {
    expect(await igazit(null)).toBe('eltavolitva')
    expect(await tagsag()).toEqual([])
    const termekek = await nevebenFut(pool, tagId, async (db) => (await db.query('select name from public.products')).rows)
    expect(termekek).toEqual([])
    const naplo = (await pool.query("select action from public.audit_log where entity_type = 'csapat' and entity_id = $1 order by event_timestamp desc limit 1", [tagId])).rows
    expect(naplo[0].action).toBe('delete')
  })
})
