// A 2026-11-05-i (előkészített, élesben még nem futtatott) migráció: a kétlépcsős adatbázis-szabály
// kikapcsolva jön létre; csak akkor kapcsolható be, ha minden felhasználónak van ellenőrzött kétlépcsős
// tényezője (senki nem zárhatja ki magát); bekapcsolva aal2 nélkül semmilyen cégadat nem érhető el;
// átállási lista; raktáros tétlenségi idő. Futtatás: KESZLET_TEST_DATABASE_URL=postgresql://…/keszlet_test npm test
import { readFileSync } from 'node:fs'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, hibakod, ujAdatbazis, ujCeg, ujCsapattag, type TesztFelhasznalo } from './adatbazis'

const leiras = DB_URL ? describe : describe.skip
let pool: pg.Pool
let ceg: TesztFelhasznalo
let raktaros: TesztFelhasznalo
let tulajdonos: TesztFelhasznalo

/** Lekérdezés a felhasználó nevében, a megadott hitelesítési szinttel (aal1: csak jelszó, aal2: kétlépcsős). */
async function neveben<T>(f: TesztFelhasznalo, aal: 'aal1' | 'aal2', sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await pool.connect()
  try {
    await db.query('begin')
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [f.id])
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.id, aal })])
    const { rows } = await db.query(sql, params)
    await db.query('commit')
    return rows as T[]
  } catch (e) {
    await db.query('rollback')
    throw e
  } finally {
    db.release()
  }
}

const tenyezo = (f: TesztFelhasznalo, status = 'verified') =>
  pool.query('insert into auth.mfa_factors (user_id, status) values ($1, $2)', [f.id, status])

beforeAll(async () => {
  if (!DB_URL) return
  pool = await ujAdatbazis('ketlepcsos')
  await pool.query(readFileSync(new URL('../../supabase/migrations/2026-11-05_ketlepcsos_kozos_belepes.sql', import.meta.url), 'utf8'))
  ceg = await ujCeg(pool)
  raktaros = await ujCsapattag(pool, ceg, 'raktaros')
  tulajdonos = await ujCsapattag(pool, ceg, 'tulajdonos')
})
afterAll(async () => {
  await pool?.end()
})

leiras('kétlépcsős adatbázis-szabály (2026-11-05)', () => {
  it('a migráció után a szabály kikapcsolva: aal1-gyel is minden úgy működik, mint eddig', async () => {
    expect(await neveben(ceg, 'aal1', 'select id from public.companies')).toHaveLength(1)
    expect(await neveben(ceg, 'aal1', 'select public.my_role() as r')).toEqual([{ r: 'fo_iroda' }])
  })

  it('a migráció újrafuttatható', async () => {
    await pool.query(readFileSync(new URL('../../supabase/migrations/2026-11-05_ketlepcsos_kozos_belepes.sql', import.meta.url), 'utf8'))
  })

  it('átállási lista: a fő iroda és a tulajdonos látja, ki nem állította még be; a raktáros nem', async () => {
    await tenyezo(ceg)
    await tenyezo(raktaros, 'unverified')
    const lista = await neveben<{ id: string; ketlepcsos: boolean }>(ceg, 'aal2', 'select id, ketlepcsos from public.ketlepcsos_allapot()')
    expect(lista).toHaveLength(3)
    expect(lista.find((x) => x.id === ceg.id)?.ketlepcsos).toBe(true)
    expect(lista.find((x) => x.id === raktaros.id)?.ketlepcsos).toBe(false)
    expect(await neveben(tulajdonos, 'aal2', 'select id from public.ketlepcsos_allapot()')).toHaveLength(3)
    expect(await neveben(raktaros, 'aal2', 'select id from public.ketlepcsos_allapot()')).toHaveLength(0)
  })

  it('a böngészőből nem kapcsolható be, és amíg valakinek hiányzik, az SQL-szerkesztőből sem', async () => {
    expect(await hibakod(neveben(ceg, 'aal2', 'select public.ketlepcsos_kotelezove_tetel()'))).toBe('42501')
    expect(await hibakod(pool.query('select public.ketlepcsos_kotelezove_tetel()'))).toBe('KF2FA')
    expect((await pool.query('select public.ketlepcsos_hianyzik() as n')).rows[0].n).toBe(2)
    expect((await pool.query('select ketlepcsos_kotelezo from public.biztonsagi_beallitas')).rows[0].ketlepcsos_kotelezo).toBe(false)
    // A beállítás táblája a böngészőből nem olvasható.
    expect(await hibakod(neveben(ceg, 'aal2', 'select * from public.biztonsagi_beallitas'))).toBe('42501')
  })

  it('ha mindenki beállította, bekapcsolható: aal2 nélkül semmilyen cégadat nem érhető el', async () => {
    await pool.query("update auth.mfa_factors set status = 'verified' where user_id = $1", [raktaros.id])
    await tenyezo(tulajdonos)
    expect((await pool.query('select public.ketlepcsos_kotelezove_tetel() as u')).rows[0].u).toMatch(/bekapcsolva/)

    expect(await neveben(ceg, 'aal1', 'select id from public.companies')).toHaveLength(0)
    expect(await neveben(ceg, 'aal1', 'select id from public.products')).toHaveLength(0)
    expect(await neveben(ceg, 'aal1', 'select public.my_company_id() as c')).toEqual([{ c: null }])
    expect(await hibakod(neveben(ceg, 'aal1', "insert into public.locations (company_id, name) values ($1, 'X')", [ceg.companyId]))).toBe('42501')
    // Kétlépcsős azonosítással minden a régi.
    expect(await neveben(ceg, 'aal2', 'select id from public.companies')).toHaveLength(1)
    // A saját profilját aal1-gyel is látja (a program ebből tudja, hogy kódot kell kérnie).
    expect(await neveben(ceg, 'aal1', 'select id from public.profiles where id = auth.uid()')).toHaveLength(1)
  })

  it('kikapcsolás az SQL-szerkesztőből', async () => {
    await pool.query('select public.ketlepcsos_kikapcsolasa()')
    expect(await neveben(ceg, 'aal1', 'select id from public.companies')).toHaveLength(1)
  })

  it('raktáros tétlenségi idő: alapból 30 perc, a fő iroda 30 perc és 12 óra között állíthatja', async () => {
    expect((await pool.query('select raktaros_tetlenseg_perc as p from public.companies where id = $1', [ceg.companyId])).rows[0].p).toBe(30)
    expect(await hibakod(neveben(raktaros, 'aal2', 'select public.raktaros_tetlenseg_beallitasa(480)'))).toBe('42501')
    expect(await hibakod(neveben(ceg, 'aal2', 'select public.raktaros_tetlenseg_beallitasa(20)'))).toBe('22023')
    expect(await hibakod(neveben(ceg, 'aal2', 'select public.raktaros_tetlenseg_beallitasa(800)'))).toBe('22023')
    await neveben(ceg, 'aal2', 'select public.raktaros_tetlenseg_beallitasa(480)')
    const sor = await neveben<{ p: number }>(raktaros, 'aal2', 'select raktaros_tetlenseg_perc as p from public.companies')
    expect(sor).toEqual([{ p: 480 }])
  })
})
