// Adatbázis-tesztek segédfüggvényei: friss tesztadatbázis a valódi supabase/schema.sql-ből (a
// Supabase minimális utánzatával), felhasználók létrehozása, és hívások egy adott felhasználó
// nevében - ugyanúgy, ahogy a Supabase a böngészőből érkező kérést futtatja (authenticated
// szerepkör, auth.uid() = a felhasználó).
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

/** Pl. postgresql://postgres:postgres@localhost:5432/keszlet_test - a név végződése kötelezően
 * „_test”, mert a tesztek minden futáskor törlik és újraépítik. */
export const DB_URL = process.env.KESZLET_TEST_DATABASE_URL

const gyoker = new URL('../../', import.meta.url)

/** Friss tesztadatbázis. A tesztfájlok párhuzamosan futnak, ezért mindegyik a saját adatbázisát
 * kapja (pl. keszlet_test → keszlet_mentes_test). */
export async function ujAdatbazis(fajlNev: string): Promise<pg.Pool> {
  if (!DB_URL) throw new Error('KESZLET_TEST_DATABASE_URL nincs megadva')
  const alap = new URL(DB_URL).pathname.slice(1)
  if (!alap.endsWith('_test')) throw new Error(`A tesztadatbázis neve „_test”-re kell végződjön: ${alap}`)
  if (!/^[a-z0-9_]+$/.test(fajlNev)) throw new Error(`Érvénytelen tesztadatbázis-név: ${fajlNev}`)
  const nev = `${alap.slice(0, -'_test'.length)}_${fajlNev}_test`
  const admin = new pg.Client({ connectionString: Object.assign(new URL(DB_URL), { pathname: '/postgres' }).toString() })
  await admin.connect()
  await admin.query(`drop database if exists ${nev} with (force)`)
  await admin.query(`create database ${nev}`)
  await admin.end()

  const pool = new pg.Pool({ connectionString: Object.assign(new URL(DB_URL), { pathname: `/${nev}` }).toString(), max: 4 })
  for (const fajl of ['supabase/test/supabase-utanzat.sql', 'supabase/schema.sql']) {
    await pool.query(readFileSync(new URL(fajl, gyoker), 'utf8'))
  }
  return pool
}

export interface TesztFelhasznalo {
  id: string
  companyId: string
  locationId: string | null
}

/** Új cég a fő iroda felhasználójával - a regisztrációs trigger (handle_new_user) hozza létre. */
export async function ujCeg(pool: pg.Pool, cegnev = 'Teszt Kft.'): Promise<TesztFelhasznalo> {
  const id = randomUUID()
  await pool.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
    id,
    `${id}@teszt.example`,
    { company_name: cegnev, name: 'Fő Iroda' },
  ])
  const { rows } = await pool.query('select company_id from public.profiles where id = $1', [id])
  const companyId = rows[0].company_id as string
  const loc = await pool.query('select id from public.locations where company_id = $1', [companyId])
  return { id, companyId, locationId: loc.rows[0]?.id ?? null }
}

/** Csapattag meghívóval, a megadott szerepkörrel (raktárosnál telephellyel). */
export async function ujCsapattag(
  pool: pg.Pool,
  ceg: TesztFelhasznalo,
  role: 'raktaros' | 'iroda' | 'fo_iroda' | 'tulajdonos',
): Promise<TesztFelhasznalo> {
  const { rows } = await pool.query(
    'insert into public.invites (company_id, role, assigned_location_id) values ($1, $2, $3) returning token',
    [ceg.companyId, role, role === 'raktaros' ? ceg.locationId : null],
  )
  const id = randomUUID()
  await pool.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
    id,
    `${id}@teszt.example`,
    { invite_token: rows[0].token, name: role },
  ])
  return { id, companyId: ceg.companyId, locationId: role === 'raktaros' ? ceg.locationId : null }
}

/** A megadott felhasználó nevében futtat egy tranzakciót (mint a Supabase API-n át érkező kérés). */
export async function nevebenFut<T>(pool: pg.Pool, felhasznaloId: string, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect()
  try {
    await db.query('begin')
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [felhasznaloId])
    const eredmeny = await fn(db)
    await db.query('commit')
    return eredmeny
  } catch (hiba) {
    await db.query('rollback')
    throw hiba
  } finally {
    db.release()
  }
}

export type Valtozas = { tabla: string; sor: Record<string, unknown> }

export async function ment(pool: pg.Pool, felhasznaloId: string, kotegId: string, valtozasok: Valtozas[]) {
  return nevebenFut(pool, felhasznaloId, async (db) => {
    const { rows } = await db.query('select public.keszlet_mentes($1, $2) as eredmeny', [kotegId, JSON.stringify(valtozasok)])
    return rows[0].eredmeny as { tabla: string; id: string; version: number }[]
  })
}

/** A hiba SQLSTATE kódja (pl. 'KF409' ütközés, '42501' jogosultság). */
export async function hibakod(muvelet: Promise<unknown>): Promise<string | null> {
  try {
    await muvelet
    return null
  } catch (hiba) {
    return (hiba as { code?: string }).code ?? 'ismeretlen'
  }
}
