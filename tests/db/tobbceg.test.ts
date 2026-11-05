// Több cég egy felhasználónak (AWEBOLDAL TERV.md F24 KS4): a cégtagság felhasználó–cég kapcsolat, cégenként
// szerepkörrel; minden RLS-szabály a KIVÁLASZTOTT cég (x-keszlet-ceg fejléc) tagsága szerint ellenőriz. Egy cég
// adatai soha nem látszanak egy másikéban: sem olvasva, sem írva, sem a mentési függvényen át.
// Futtatás: KESZLET_TEST_DATABASE_URL=postgresql://…/keszlet_test npm test
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, hibakod, ment, nevebenFut, ujAdatbazis, ujCeg, ujCsapattag, type TesztFelhasznalo, type Valtozas } from './adatbazis'

const leiras = DB_URL ? describe : describe.skip
let pool: pg.Pool
/** Könyvelőiroda munkatársa: az X cég fő irodája (regisztrált), és létrehozta az Y céget is. */
let iroda: TesztFelhasznalo
let cegX: string
let cegY: string
let telephelyY: string
/** Egy harmadik, idegen cég. */
let idegen: TesztFelhasznalo

const lekerdez = <T = Record<string, unknown>>(f: string, ceg: string | undefined, sql: string, p: unknown[] = []) =>
  nevebenFut(pool, f, async (db) => (await db.query(sql, p)).rows as T[], ceg)

function termek(companyId: string, locationId: string, nev: string): Valtozas {
  return {
    tabla: 'products',
    sor: {
      id: randomUUID(),
      company_id: companyId,
      location_id: locationId,
      name: nev,
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
  }
}

beforeAll(async () => {
  if (!DB_URL) return
  pool = await ujAdatbazis('tobbceg')
  iroda = await ujCeg(pool, 'X Kft.')
  cegX = iroda.companyId
  cegY = (await lekerdez<{ id: string }>(iroda.id, cegX, "select public.ceg_letrehozasa('Y Bt.') as id"))[0]!.id
  telephelyY = (await pool.query('select id from public.locations where company_id = $1', [cegY])).rows[0].id
  idegen = await ujCeg(pool, 'Idegen Zrt.')
  await ment(pool, iroda.id, randomUUID(), [termek(cegX, iroda.locationId!, 'X-termék')], cegX)
  await ment(pool, iroda.id, randomUUID(), [termek(cegY, telephelyY, 'Y-termék')], cegY)
  await ment(pool, idegen.id, randomUUID(), [termek(idegen.companyId, idegen.locationId!, 'Idegen termék')])
})
afterAll(async () => {
  await pool?.end()
})

leiras('több cég egy felhasználónak, a kiválasztott cég szerint', () => {
  it('a felhasználó mindkét cégének tagja (cégenként a saját szerepkörével), és a cégválasztóhoz mindkettőt látja – az idegent nem', async () => {
    const tagsag = (await pool.query('select company_id, role from public.company_members where user_id = $1 order by role', [iroda.id])).rows
    expect(tagsag.map((t) => t.company_id).sort()).toEqual([cegX, cegY].sort())
    const cegek = await lekerdez<{ name: string }>(iroda.id, cegX, 'select name from public.companies order by name')
    expect(cegek.map((c) => c.name)).toEqual(['X Kft.', 'Y Bt.'])
  })

  it('a kiválasztott cég adatait látja, a másikét soha', async () => {
    expect((await lekerdez<{ name: string }>(iroda.id, cegX, 'select name from public.products')).map((t) => t.name)).toEqual(['X-termék'])
    expect((await lekerdez<{ name: string }>(iroda.id, cegY, 'select name from public.products')).map((t) => t.name)).toEqual(['Y-termék'])
    // Akkor sem, ha a lekérdezés kifejezetten a másik cégre szűr.
    expect(await lekerdez(iroda.id, cegX, 'select name from public.products where company_id = $1', [cegY])).toEqual([])
    expect(await lekerdez(iroda.id, cegX, 'select id from public.locations where company_id = $1', [cegY])).toEqual([])
  })

  it('cég kiválasztása nélkül (két tagság mellett) semmi nem látszik; idegen céget kiválasztva sem', async () => {
    expect(await lekerdez(iroda.id, undefined, 'select id from public.products')).toEqual([])
    expect(await lekerdez(iroda.id, undefined, 'select public.my_company_id() as c')).toEqual([{ c: null }])
    expect(await lekerdez(iroda.id, idegen.companyId, 'select id from public.products')).toEqual([])
    expect(await lekerdez(iroda.id, idegen.companyId, 'select public.my_role() as r')).toEqual([{ r: null }])
    // Hibás fejléc: nem cégazonosító.
    expect(await lekerdez(iroda.id, "x' or 1=1 --", 'select id from public.products')).toEqual([])
  })

  it('írni csak a kiválasztott cégbe lehet: a másik cég sorát sem beszúrni, sem módosítani nem lehet', async () => {
    expect(await hibakod(ment(pool, iroda.id, randomUUID(), [termek(cegY, telephelyY, 'Rossz helyre')], cegX))).not.toBeNull()
    expect(
      await hibakod(
        lekerdez(iroda.id, cegX, 'insert into public.locations (company_id, name) values ($1, $2)', [cegY, 'Becsempészett']),
      ),
    ).toBe('42501')
    await lekerdez(iroda.id, cegX, "update public.products set name = 'Átírva' where company_id = $1", [cegY])
    expect((await pool.query('select name from public.products where company_id = $1', [cegY])).rows).toEqual([{ name: 'Y-termék' }])
    expect(await hibakod(ment(pool, iroda.id, randomUUID(), [termek(idegen.companyId, idegen.locationId!, 'Idegenbe')], idegen.companyId))).not.toBeNull()
  })

  it('a szerepkör cégenként más: aki X-ben raktáros, az ott csak a saját telephelyét látja, a saját cégében fő iroda', async () => {
    const raktaros = await ujCsapattag(pool, iroda, 'raktaros')
    // A raktárosnak saját cége is lesz (fő iroda).
    const sajat = (await lekerdez<{ id: string }>(raktaros.id, cegX, "select public.ceg_letrehozasa('Raktáros saját cége') as id"))[0]!.id
    expect(await lekerdez(raktaros.id, cegX, 'select public.my_role() as r')).toEqual([{ r: 'raktaros' }])
    expect(await lekerdez(raktaros.id, sajat, 'select public.my_role() as r')).toEqual([{ r: 'fo_iroda' }])
    expect(await lekerdez(raktaros.id, cegY, 'select id from public.products')).toEqual([])
    // X-ben raktárosként nem hoz létre telephelyet; a saját cégében fő irodaként igen.
    expect(await hibakod(lekerdez(raktaros.id, cegX, 'insert into public.locations (company_id, name) values ($1, $2)', [cegX, 'Új']))).toBe('42501')
    await lekerdez(raktaros.id, sajat, 'insert into public.locations (company_id, name) values ($1, $2)', [sajat, 'Második telephely'])
  })

  it('a cég tagjait és profilját csak a kiválasztott cég iroda-szintű tagjai látják', async () => {
    const xTagok = await lekerdez<{ user_id: string }>(iroda.id, cegX, 'select user_id from public.company_members where company_id = $1', [cegX])
    expect(xTagok.length).toBeGreaterThanOrEqual(2)
    expect(await lekerdez(idegen.id, idegen.companyId, 'select user_id from public.company_members where company_id = $1', [cegX])).toEqual([])
    expect(await lekerdez(idegen.id, idegen.companyId, 'select id from public.profiles where id = $1', [iroda.id])).toEqual([])
  })

  it('tagság API-hívással nem szerezhető; meghívót létező felhasználóra csak a szerveroldali függvény fogad el', async () => {
    expect(
      await hibakod(lekerdez(idegen.id, idegen.companyId, "insert into public.company_members (company_id, user_id, role) values ($1, $2, 'fo_iroda')", [cegX, idegen.id])),
    ).toBe('42501')
    const { rows } = await pool.query("insert into public.invites (company_id, role) values ($1, 'iroda') returning token", [cegY])
    const email = (await pool.query('select email from public.profiles where id = $1', [idegen.id])).rows[0].email
    expect(await hibakod(lekerdez(idegen.id, idegen.companyId, 'select public.meghivo_elfogadasa($1, $2)', [rows[0].token, email]))).toBe('42501')
    // A service role (szerveroldali függvény) elfogadja: az idegen felhasználó Y-ban iroda lesz.
    await pool.query('select public.meghivo_elfogadasa($1, $2)', [rows[0].token, email])
    expect(await lekerdez(idegen.id, cegY, 'select public.my_role() as r')).toEqual([{ r: 'iroda' }])
    expect((await lekerdez<{ name: string }>(idegen.id, cegY, 'select name from public.products')).map((t) => t.name)).toEqual(['Y-termék'])
    // A saját cégében továbbra is a saját adatait látja.
    expect((await lekerdez<{ name: string }>(idegen.id, idegen.companyId, 'select name from public.products')).map((t) => t.name)).toEqual(['Idegen termék'])
    expect(await hibakod(pool.query('select public.meghivo_elfogadasa($1, $2)', [rows[0].token, email]))).toBe('22023')
  })

  it('a Készlet-cég összerendelése a portál cégével: csak fő iroda vagy tulajdonos, egyszer, és egy portál-céghez egy Készlet-cég', async () => {
    const portalX = randomUUID()
    await lekerdez(iroda.id, cegX, 'select public.ceg_portal_osszerendeles($1)', [portalX])
    await lekerdez(iroda.id, cegX, 'select public.ceg_portal_osszerendeles($1)', [portalX])
    expect(await hibakod(lekerdez(iroda.id, cegY, 'select public.ceg_portal_osszerendeles($1)', [portalX]))).toBe('23505')
    expect(await hibakod(lekerdez(iroda.id, cegX, 'select public.ceg_portal_osszerendeles($1)', [randomUUID()]))).toBe('23505')
    expect(await hibakod(lekerdez(iroda.id, cegX, "select public.ceg_letrehozasa('Másik', $1)", [portalX]))).toBe('23505')
    const tag = await ujCsapattag(pool, iroda, 'iroda')
    expect(await hibakod(lekerdez(tag.id, cegX, 'select public.ceg_portal_osszerendeles($1)', [randomUUID()]))).toBe('42501')
    const portalZ = randomUUID()
    const z = (await lekerdez<{ id: string }>(iroda.id, cegX, "select public.ceg_letrehozasa('Z Kft.', $1) as id", [portalZ]))[0]!.id
    expect((await pool.query('select portal_company_id from public.companies where id = $1', [z])).rows[0].portal_company_id).toBe(portalZ)
  })
})
