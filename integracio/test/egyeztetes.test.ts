// Egyeztető ellenőrzések a Készlet oldalán (TERV.md F16, I4.3), valódi PostgreSQL-en: a központ aláírt
// kérdésére a Készlet számai (készletérték mindkét módszerrel, az időszak ELÁBÉ-ja, a Könyvelőből jött függő
// mozgások, a rekordok állapota és kifizetettsége), és az eredmény fogadása Teendővel.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECONCILE_PATH, RECONCILE_RESULT_PATH, signedHeaders, type KeszletAnswer, type ReconcileResult } from "../esemenyek/src/index.ts";
import { fogado } from "../src/fogado.ts";
import { DB_URL, neveben, osszekapcsol, ujAdatbazis, ujCeg, type Ceg } from "./adatbazis.ts";

const leiras = DB_URL ? describe : describe.skip;
const TITOK = "e".repeat(40);

let pool: pg.Pool;
let server: Server;
let base: string;
let ceg: Ceg;
const id: Record<string, string> = {};

async function hivas(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify(body);
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...signedHeaders(TITOK, "kozpont", "POST", path, raw) }, body: raw });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const kerdes = (over: Record<string, unknown> = {}) => ({ runId: randomUUID(), companyRef: ceg.companyId, asOf: "2026-11-30", from: "2026-11-01", to: "2026-11-30", events: [], keys: [], ...over });

async function valasz(over: Record<string, unknown> = {}): Promise<KeszletAnswer> {
  const r = await hivas(RECONCILE_PATH, kerdes(over));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as unknown as KeszletAnswer;
}

async function termek(nev: string, keszlet: number, ar: number) {
  const r = await pool.query<{ id: string }>(
    "INSERT INTO public.products (company_id, location_id, name, unit, current_stock, purchase_price) VALUES ($1, $2, $3, 'db', $4, $5) RETURNING id",
    [ceg.companyId, ceg.locationId, nev, keszlet, ar],
  );
  return r.rows[0]!.id;
}

async function mozgas(termekId: string, over: Record<string, unknown>) {
  const sor = { company_id: ceg.companyId, product_id: termekId, location_id: ceg.locationId, date: "2026-11-05", type: "out", quantity: 1, ...over };
  const oszlopok = Object.keys(sor);
  const r = await pool.query<{ id: string }>(
    `INSERT INTO public.movements (${oszlopok.join(", ")}) VALUES (${oszlopok.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    Object.values(sor),
  );
  return r.rows[0]!.id;
}

const modszer = (m: "fifo" | "average") =>
  pool.query(
    `INSERT INTO public.company_settings (id, company_id, settings) VALUES ($1, $1, jsonb_build_object('costingMethod', $2::text))
     ON CONFLICT (id) DO UPDATE SET settings = public.company_settings.settings || jsonb_build_object('costingMethod', $2::text)`,
    [ceg.companyId, m],
  );

beforeAll(async () => {
  if (!DB_URL) return;
  pool = await ujAdatbazis("egyeztetes");
  ceg = await ujCeg(pool);
  await osszekapcsol(pool, ceg);
  // „A” termék: 10 db beszerzés 1 000 Ft-on, 1 000 Ft szállítással (egységköltség 1 010 Ft), ebből 6 maradt.
  id.a = await termek("Ajtó", 6, 1005);
  id.besz = await mozgas(id.a, { type: "in", quantity: 10, unit_price: 1000, date: "2026-10-10" });
  await pool.query(
    `INSERT INTO public.purchase_lots (company_id, product_id, movement_id, date, quantity, remaining_quantity, unit_price, shipping_cost, vat_rate_percent, vat_reclaimable)
     VALUES ($1, $2, $3, '2026-10-10', 10, 6, 1000, 100, 27, true)`,
    [ceg.companyId, id.a, id.besz],
  );
  // „B” termék: tételkövetés előtti készlet (3 db, 500 Ft) – FIFO-nál a beszerzési áron számít.
  id.b = await termek("Kilincs", 3, 500);
  // November: 4 db eladás, egy visszavont eladás, egy selejt, egy vevői visszavétel; októberi eladás nem számít.
  id.eladas = await mozgas(id.a, { quantity: 4, unit_cost: 1010, is_paid: true, fizetes_konyvelobol: true });
  id.visszavont = await mozgas(id.a, { quantity: 2, unit_cost: 1010, cancelled: true });
  await mozgas(id.a, { quantity: 1, unit_cost: 1010, ok: "selejt" });
  await mozgas(id.a, { type: "in", quantity: 1, return_of_movement_id: id.eladas, unit_price: 1010 });
  await mozgas(id.a, { quantity: 5, unit_cost: 1010, date: "2026-10-20" });
  // A Könyvelőből jött, jóváhagyásra váró beérkezés (2 db, 1 200 Ft) és kiadás (ez nem hat a készletértékre).
  await mozgas(id.a, { type: "in", quantity: 2, unit_price: 1200, approval_status: "pending", integracio_esemeny_id: randomUUID(), integracio_dokumentum_id: randomUUID() });
  await mozgas(id.a, { quantity: 1, sale_unit_price: 2000, approval_status: "pending", integracio_esemeny_id: randomUUID(), integracio_dokumentum_id: randomUUID() });
  // Törölt beszerzés.
  id.torolt = await mozgas(id.b, { type: "in", quantity: 1, unit_price: 500, deleted_at: "2026-11-06T10:00:00Z" });
  server = createServer(fogado({ pool, titok: TITOK, log: (m, e) => console.error(m, e) }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise((r) => server?.close(r));
  await pool?.end();
});

leiras("a Készlet számai a központ kérdésére", () => {
  it("aláírás nélkül és összekapcsolatlan cégre nem válaszol", async () => {
    const r = await fetch(base + RECONCILE_PATH, { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
    expect((await hivas(RECONCILE_PATH, kerdes({ companyRef: randomUUID() }))).status).toBe(409);
    expect((await hivas(RECONCILE_PATH, { companyRef: ceg.companyId })).status).toBe(422);
  });

  it("készletérték a cég módszerével: átlagár (alapértelmezés) és FIFO", async () => {
    let a = await valasz();
    expect(a).toMatchObject({ module: "keszlet", method: "AVERAGE", stockValue: (6 * 1005 + 3 * 500) * 100 });
    await modszer("fifo");
    a = await valasz();
    // 6 db × 1 010 Ft a tételből + a „B” termék 3 db × 500 Ft-ja (nincs tétele).
    expect(a).toMatchObject({ method: "FIFO", stockValue: (6 * 1010 + 3 * 500) * 100 });
  });

  it("az időszak ELÁBÉ-ja: eladás − vevői visszavétel; a visszavont eladás, a selejt és a más havi eladás nem számít", async () => {
    expect((await valasz()).cogs).toBe((4 * 1010 - 1 * 1010) * 100);
    expect((await valasz({ from: "2026-10-01", to: "2026-10-31" })).cogs).toBe(5 * 1010 * 100);
  });

  it("a Könyvelőből jött függő mozgások: mindkettő számít a darabszámba, de csak a beérkezés a készletértékbe", async () => {
    const a = await valasz();
    expect(a.pending).toMatchObject({ count: 2, inventory: 2 * 1200 * 100 });
    expect(a.pending.oldest).not.toBeNull();
  });

  it("a kért rekordok: él-e, és ki van-e fizetve (csak ha a fizetést a Könyvelő követi)", async () => {
    const zaras = randomUUID();
    const a = await valasz({
      keys: [
        { recordType: "eladas", recordId: id.eladas },
        { recordType: "eladas", recordId: id.visszavont },
        { recordType: "beszerzes", recordId: id.torolt },
        { recordType: "beszerzes", recordId: id.besz },
        { recordType: "napi_zaras", recordId: zaras },
        { recordType: "valami", recordId: "x" },
      ],
    });
    expect(a.records).toEqual([
      { recordType: "eladas", recordId: id.eladas, effective: true, paid: true },
      { recordType: "eladas", recordId: id.visszavont, effective: false, paid: null },
      { recordType: "beszerzes", recordId: id.torolt, effective: false, paid: null },
      { recordType: "beszerzes", recordId: id.besz, effective: true, paid: null },
      { recordType: "napi_zaras", recordId: zaras, effective: false, paid: null },
      { recordType: "valami", recordId: "x", effective: null, paid: null },
    ]);
  });

  it("elveszett esemény: ami a központ szerint átment, de a bejövő táblában nincs", async () => {
    const megvan = randomUUID();
    const nincs = randomUUID();
    await pool.query("INSERT INTO integracio.integration_inbox (event_id, outcome, result) VALUES ($1, 'APPLIED', '{}')", [megvan]);
    expect((await valasz({ events: [megvan, nincs] })).missingEvents).toEqual([nincs]);
  });

  it("a kimenő sor: az összeállításra és átadásra váró tételek", async () => {
    const a = await valasz();
    // A fenti mozgásokból a trigger változásokat írt; összeállító nem futott, így mind vár.
    expect(a.outbox.waiting).toBeGreaterThan(0);
    expect(a.outbox.oldest).not.toBeNull();
    expect(a.outbox.failed).toBe(0);
  });
});

leiras("az eredmény fogadása", () => {
  const eredmeny = (check: ReconcileResult["check"], status: ReconcileResult["status"], over: Partial<ReconcileResult> = {}): ReconcileResult => ({
    check,
    status,
    title: `${check}: ${status}`,
    detail: null,
    diff: null,
    explained: null,
    unexplained: null,
    tolerance: null,
    baselineProposal: null,
    items: [],
    ...over,
  });
  const jelentes = (runId: string, at: string, results: ReconcileResult[]) => ({ runId, companyRef: ceg.companyId, at, asOf: "2026-11-30", from: "2026-11-01", to: "2026-11-30", results });
  const teendok = async () =>
    (await pool.query<{ cim: string; reszletek: string | null }>("SELECT cim, reszletek FROM integracio.teendok WHERE company_id = $1 AND fajta = 'EGYEZTETES' AND megoldva IS NULL ORDER BY kulcs", [ceg.companyId])).rows;

  it("Teendő a nem rendben lévőből, lezárás a rendben lévőnél; a „nem futott” nem zár le; régebbi kör nem írja felül", async () => {
    const r = await hivas(
      RECONCILE_RESULT_PATH,
      jelentes(randomUUID(), "2026-11-30T01:31:00.000Z", [
        eredmeny("E1", "ELTERES", { title: "Készletérték: 1 500 Ft megmagyarázatlan eltérés", detail: "Készletérték a Készletben …" }),
        eredmeny("E4", "ELTERES", { title: "Kifizetettség: 1 számla kifizetettsége eltér", items: [{ label: "VSZ-1: a Könyvelőben kiegyenlítve", recordType: "eladas", recordId: "x", documentId: null, serialNumber: "VSZ-1", amount: 0, note: null }] }),
        eredmeny("E5", "RENDBEN"),
      ]),
    );
    expect(r.status).toBe(200);
    expect(await teendok()).toEqual([
      { cim: "Készletérték: 1 500 Ft megmagyarázatlan eltérés", reszletek: "Készletérték a Készletben …" },
      { cim: "Kifizetettség: 1 számla kifizetettsége eltér", reszletek: "• VSZ-1: a Könyvelőben kiegyenlítve" },
    ]);
    await hivas(RECONCILE_RESULT_PATH, jelentes(randomUUID(), "2026-11-29T01:31:00.000Z", [eredmeny("E1", "RENDBEN"), eredmeny("E4", "RENDBEN")]));
    expect(await teendok()).toHaveLength(2);
    await hivas(RECONCILE_RESULT_PATH, jelentes(randomUUID(), "2026-12-01T01:31:00.000Z", [eredmeny("E1", "NEM_FUTOTT"), eredmeny("E4", "RENDBEN")]));
    expect((await teendok()).map((t) => t.cim)).toEqual(["Készletérték: 1 500 Ft megmagyarázatlan eltérés"]);
  });

  it("az iroda az állapot-lekérdezésben látja a legutóbbi eredményt", async () => {
    const allapot = await neveben(pool, ceg.felhasznalo, async (db) => (await db.query("SELECT public.integracio_allapot() AS a")).rows[0].a as Record<string, unknown>);
    expect(allapot.egyeztetes).toMatchObject({ asOf: "2026-11-30", eredmenyek: [expect.objectContaining({ check: "E1", status: "NEM_FUTOTT" }), expect.objectContaining({ check: "E4" })] });
  });

  it("hibás eredményt nem fogad el", async () => {
    expect((await hivas(RECONCILE_RESULT_PATH, { runId: "x" })).status).toBe(422);
  });
});
