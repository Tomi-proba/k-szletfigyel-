// F29: valós idejű jelzés. Az adatbázis üzleti változáskor tranzakciónként és cégenként egy adat nélküli jelzést küld a
// cég privát Realtime-csatornájára; a jelzést csak a cég tagjai kapják. A Supabase Realtime itt egy kis utánzat
// (realtime.send naplóz, realtime.topic() a beállításból olvas).
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DB_URL, nevebenFut, ujAdatbazis, ujCeg, ujCsapattag, type TesztFelhasznalo } from './adatbazis'

const leiras = DB_URL ? describe : describe.skip
let pool: pg.Pool
let ceg: TesztFelhasznalo
let masikCeg: TesztFelhasznalo
let raktaros: TesztFelhasznalo
let termek: string

const F29 = (() => {
  const sema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  return sema.slice(sema.indexOf('-- F29: valós idejű'), sema.indexOf('-- F29 vége'))
})()

beforeAll(async () => {
  if (!DB_URL) return
  pool = await ujAdatbazis('elo_jelzes')
  await pool.query(`
    create schema realtime;
    create table realtime.kuldve (payload jsonb, event text, topic text, privat boolean);
    create table realtime.messages (id bigserial primary key, topic text, extension text);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to authenticated;
    grant select on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
    grant execute on function realtime.topic() to authenticated;
    create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language plpgsql as $$
    begin
      if payload ->> 'hibas' = '1' or current_setting('proba.send_hiba', true) = '1' then raise exception 'realtime nem elérhető'; end if;
      insert into realtime.kuldve values (payload, event, topic, private);
    end $$;
  `)
  // A blokk újrafuttatása most, hogy van Realtime: létrejön a csatorna-szabály is (ismételten futtatható).
  await pool.query(F29)
  ceg = await ujCeg(pool, 'Élő Kft.')
  masikCeg = await ujCeg(pool, 'Másik Kft.')
  raktaros = await ujCsapattag(pool, ceg, 'raktaros')
  termek = randomUUID()
  await pool.query("insert into public.products (id, company_id, location_id, name) values ($1, $2, $3, 'Alma')", [termek, ceg.companyId, ceg.locationId])
})
afterAll(async () => {
  await pool?.end()
})
beforeEach(async () => {
  if (DB_URL) await pool.query('truncate realtime.kuldve')
})

const kuldott = async () => (await pool.query('select payload, event, topic, privat from realtime.kuldve')).rows

leiras('valós idejű jelzés (F29)', () => {
  it('a raktáros bejelentése a cég privát csatornájára jelez, adat nélkül', async () => {
    await nevebenFut(pool, raktaros.id, (db) =>
      db.query("insert into public.movements (company_id, product_id, location_id, date, type, quantity, approval_status) values ($1, $2, $3, current_date, 'in', 5, 'pending')", [
        ceg.companyId,
        termek,
        ceg.locationId,
      ]),
    )
    expect(await kuldott()).toEqual([{ payload: { tabla: 'movements' }, event: 'valtozas', topic: `keszlet:${ceg.companyId}`, privat: true }])
  })

  it('tranzakciónként és cégenként egy jelzés', async () => {
    const db = await pool.connect()
    try {
      await db.query('begin')
      for (let i = 0; i < 3; i++) {
        await db.query("insert into public.movements (company_id, product_id, location_id, date, type, quantity) values ($1, $2, $3, current_date, 'in', 1)", [
          ceg.companyId,
          termek,
          ceg.locationId,
        ])
      }
      await db.query("update public.products set min_stock = 2 where id = $1", [termek])
      await db.query('commit')
    } finally {
      db.release()
    }
    expect((await kuldott()).length).toBe(1)
  })

  it('a jelzés hibája nem akadályozza a mentést', async () => {
    const db = await pool.connect()
    try {
      await db.query('begin')
      await db.query("select set_config('proba.send_hiba', '1', true)")
      await db.query("insert into public.movements (company_id, product_id, location_id, date, type, quantity) values ($1, $2, $3, current_date, 'in', 1)", [
        ceg.companyId,
        termek,
        ceg.locationId,
      ])
      await db.query('commit')
    } finally {
      db.release()
    }
    expect((await pool.query("select count(*)::int as db from public.movements where company_id = $1", [ceg.companyId])).rows[0].db).toBeGreaterThan(0)
    expect(await kuldott()).toEqual([])
  })

  it('a csatorna jelzéseit csak a cég tagjai kapják meg', async () => {
    await pool.query("insert into realtime.messages (topic, extension) values ($1, 'broadcast'), ($2, 'broadcast')", [
      `keszlet:${ceg.companyId}`,
      `keszlet:${masikCeg.companyId}`,
    ])
    const lat = (felhasznalo: string, topic: string) =>
      nevebenFut(pool, felhasznalo, async (db) => {
        await db.query("select set_config('realtime.topic', $1, true)", [topic])
        return (await db.query('select topic from realtime.messages where topic = $1', [topic])).rowCount
      })
    expect(await lat(raktaros.id, `keszlet:${ceg.companyId}`)).toBe(1)
    expect(await lat(ceg.id, `keszlet:${ceg.companyId}`)).toBe(1)
    expect(await lat(raktaros.id, `keszlet:${masikCeg.companyId}`)).toBe(0)
    expect(await lat(masikCeg.id, `keszlet:${ceg.companyId}`)).toBe(0)
  })
})
