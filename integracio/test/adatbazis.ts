// Az integrációs tesztek adatbázisa: friss PostgreSQL-adatbázis a valódi supabase/schema.sql-ből (a
// Supabase minimális utánzatával), mint a Készlet tests/db tesztjeinél. A mentés a felhasználó nevében,
// a valódi keszlet_mentes() függvénnyel megy (authenticated szerepkör), a szolgáltatás pedig a saját,
// közvetlen kapcsolatával dolgozik - ahogy élesben.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { ujPool } from "../src/db.ts";

/** Pl. postgresql://postgres:postgres@localhost:5432/keszlet_test (a név végződése kötelezően „_test”). */
export const DB_URL = process.env.KESZLET_TEST_DATABASE_URL;

const gyoker = new URL("../../", import.meta.url);

export async function ujAdatbazis(fajlNev: string): Promise<pg.Pool> {
  if (!DB_URL) throw new Error("KESZLET_TEST_DATABASE_URL nincs megadva");
  const alap = new URL(DB_URL).pathname.slice(1);
  if (!alap.endsWith("_test")) throw new Error(`A tesztadatbázis neve „_test”-re kell végződjön: ${alap}`);
  const nev = `${alap.slice(0, -"_test".length)}_integracio_${fajlNev}_test`;
  const admin = new pg.Client({ connectionString: Object.assign(new URL(DB_URL), { pathname: "/postgres" }).toString() });
  await admin.connect();
  await admin.query(`drop database if exists ${nev} with (force)`);
  await admin.query(`create database ${nev}`);
  await admin.end();
  const url = Object.assign(new URL(DB_URL), { pathname: `/${nev}` }).toString();
  const setup = new pg.Client({ connectionString: url });
  await setup.connect();
  for (const fajl of ["supabase/test/supabase-utanzat.sql", "supabase/schema.sql"]) await setup.query(readFileSync(new URL(fajl, gyoker), "utf8"));
  await setup.end();
  return ujPool(url, 8);
}

export type Ceg = { felhasznalo: string; companyId: string; locationId: string };

export async function ujCeg(pool: pg.Pool, nev = "Teszt Kft."): Promise<Ceg> {
  const id = randomUUID();
  await pool.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${id}@teszt.example`, { company_name: nev, name: "Fő Iroda" }]);
  const companyId = (await pool.query("select company_id from public.profiles where id = $1", [id])).rows[0].company_id as string;
  const locationId = (await pool.query("select id from public.locations where company_id = $1", [companyId])).rows[0].id as string;
  return { felhasznalo: id, companyId, locationId };
}

export async function ujCsapattag(pool: pg.Pool, ceg: Ceg, role: "raktaros" | "iroda" | "fo_iroda" | "tulajdonos"): Promise<string> {
  const { rows } = await pool.query("insert into public.invites (company_id, role, assigned_location_id) values ($1, $2, $3) returning token", [
    ceg.companyId,
    role,
    role === "raktaros" ? ceg.locationId : null,
  ]);
  const id = randomUUID();
  await pool.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${id}@teszt.example`, { invite_token: rows[0].token, name: role }]);
  return id;
}

/** A felhasználó nevében futó tranzakció (mint a Supabase API-n át érkező kérés). */
export async function neveben<T>(pool: pg.Pool, felhasznalo: string, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [felhasznalo]);
    const r = await fn(db);
    await db.query("commit");
    return r;
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }
}

export type Valtozas = { tabla: string; sor: Record<string, unknown> };

/** Egy felhasználói művelet mentése a valódi keszlet_mentes() függvénnyel. */
export const ment = (pool: pg.Pool, felhasznalo: string, valtozasok: Valtozas[]) =>
  neveben(pool, felhasznalo, (db) => db.query("select public.keszlet_mentes($1, $2)", [randomUUID(), JSON.stringify(valtozasok)]));

/** Összekapcsolás a tesztekhez (a valódi út a kapcsolódási kód, azt a fogado.test.ts próbálja ki). */
export async function osszekapcsol(pool: pg.Pool, ceg: Ceg, adoszam = "12345678242") {
  await pool.query(
    `insert into integracio.beallitas (company_id, adoszam, osszekapcsolva) values ($1, $2, now())
     on conflict (company_id) do update set osszekapcsolva = now(), bontva = null`,
    [ceg.companyId, adoszam],
  );
}

// ---------- Sorok ----------

const most = "2026-11-02T08:00:00Z";

export const termek = (ceg: Ceg, over: Record<string, unknown> = {}): Valtozas => ({
  tabla: "products",
  sor: { id: randomUUID(), company_id: ceg.companyId, location_id: ceg.locationId, name: "Bejárati ajtó", category: "Ajtó", unit: "db", current_stock: 0, min_stock: 0, purchase_price: 0, sale_price: 0, default_vat_rate_percent: 27, created_at: most, updated_at: most, version: null, ...over },
});

export const szallito = (ceg: Ceg, over: Record<string, unknown> = {}): Valtozas => ({
  tabla: "suppliers",
  sor: { id: randomUUID(), company_id: ceg.companyId, name: "Ajtó Kft.", lead_time_days: 3, tax_number: "10537914-4-44", created_at: most, version: null, ...over },
});

export const vevo = (ceg: Ceg, over: Record<string, unknown> = {}): Valtozas => ({
  tabla: "customers",
  sor: { id: randomUUID(), company_id: ceg.companyId, name: "Vevő Bt.", tax_number: "11111111-1-11", created_at: most, version: null, ...over },
});

export const mozgas = (ceg: Ceg, termekId: string, over: Record<string, unknown> = {}): Valtozas => ({
  tabla: "movements",
  sor: { id: randomUUID(), company_id: ceg.companyId, product_id: termekId, location_id: ceg.locationId, date: "2026-11-02", type: "in", quantity: 1, created_at: most, version: null, ...over },
});

export const tetel = (ceg: Ceg, termekId: string, mozgasId: string, over: Record<string, unknown> = {}): Valtozas => ({
  tabla: "purchase_lots",
  sor: { id: randomUUID(), company_id: ceg.companyId, product_id: termekId, movement_id: mozgasId, date: "2026-11-02", quantity: 1, remaining_quantity: 1, unit_price: 0, shipping_cost: 0, currency: "HUF", exchange_rate: 1, created_at: most, version: null, ...over },
});
