// A központ felőli végpontok és az átadó tesztjei (D13, aláírás, pontosan egyszer, központ nélkül is).
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INBOUND_PATH, LINK_PATH, signedHeaders, type EventEnvelope, type HubClient } from "../esemenyek/src/index.ts";
import { atadas, KOZPONT_NEM_ERHETO_EL_PERC } from "../src/atado.ts";
import { fogado } from "../src/fogado.ts";
import { osszeallitas } from "../src/osszeallito.ts";
import { DB_URL, ment, mozgas, neveben, szallito, tetel, termek, ujAdatbazis, ujCeg, ujCsapattag, type Ceg } from "./adatbazis.ts";

const leiras = DB_URL ? describe : describe.skip;
const TITOK = "k".repeat(40);
const ADOSZAM = "12345678-2-42";

let pool: pg.Pool;
let server: Server;
let base: string;
let ceg: Ceg;
// Az eseménykezelő tesztekhez: hányszor hatott ténylegesen.
const hatasok: string[] = [];

beforeAll(async () => {
  if (!DB_URL) return;
  pool = await ujAdatbazis("fogado");
  ceg = await ujCeg(pool, "Kapcsolódó Kft.");
  server = createServer(
    fogado({
      pool,
      titok: TITOK,
      log: (msg, err) => console.error(msg, err),
      kezelok: {
        "torzs.partner.valtozott@1": async (client, d) => {
          // Egy valódi táblába ír, hogy a visszagörgetés is látsszon.
          await client.query("INSERT INTO integracio.nonces (nonce) VALUES ($1)", [`hatas-${d.event.id}`]);
          await new Promise((r) => setTimeout(r, 30));
          hatasok.push(d.event.id);
          return { outcome: "APPLIED" };
        },
      },
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server?.close(r));
  await pool?.end();
});

async function hivas(method: string, path: string, body?: unknown, opts: { titok?: string; fejlec?: Record<string, string> } = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const headers = { "content-type": "application/json", ...signedHeaders(opts.titok ?? TITOK, "kozpont", method, path, raw), ...opts.fejlec };
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : raw });
  return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as Record<string, unknown>), headers };
}

const kodKeszites = (felhasznalo: string, adoszam = ADOSZAM) =>
  neveben(pool, felhasznalo, async (db) => (await db.query("SELECT public.integracio_kod_keszites($1) AS k", [adoszam])).rows[0].k as { kod: string; lejar: string });

const partnerEsemeny = (): EventEnvelope => ({
  id: randomUUID(),
  type: "torzs.partner.valtozott",
  version: 1,
  source: { module: "konyvelo", companyRef: randomUUID(), recordType: "partner", recordId: "P1", sequence: 1 },
  occurredAt: "2026-11-02T08:00:00Z",
  payload: { partner: { name: "Ajtó Kft.", taxNumber: "10537914-4-44" }, anonymized: false },
});

leiras("kapcsolódási kód (D13)", () => {
  it("csak a fő iroda készíthet kódot; az adatbázisba csak a lenyomata kerül", async () => {
    const iroda = await ujCsapattag(pool, ceg, "iroda");
    await expect(kodKeszites(iroda)).rejects.toThrow(/fő iroda/);
    await expect(kodKeszites(ceg.felhasznalo, "1234")).rejects.toThrow(/teljes adószámát/);
    const { kod, lejar } = await kodKeszites(ceg.felhasznalo);
    expect(kod).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(new Date(lejar).getTime() - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
    const tarolt = await pool.query("SELECT kod_hash FROM integracio.kapcsolodasi_kodok WHERE company_id = $1", [ceg.companyId]);
    expect(JSON.stringify(tarolt.rows)).not.toContain(kod.replace(/-/g, ""));
    // A böngészőből a séma nem olvasható.
    await expect(neveben(pool, ceg.felhasznalo, (db) => db.query("SELECT * FROM integracio.kapcsolodasi_kodok"))).rejects.toThrow(/permission denied/);
  });

  it("kód nélkül, csak az adószámmal nem kapcsolható össze; rossz, lejárt, visszavont, felhasznált kód és más adószám elutasítva", async () => {
    expect((await hivas("POST", LINK_PATH, { taxNumber: ADOSZAM })).status).toBe(422);
    expect((await hivas("POST", LINK_PATH, { code: "AAAA-BBBB-CCCC-DDDD", taxNumber: ADOSZAM })).status).toBe(422);
    const regi = await kodKeszites(ceg.felhasznalo);
    const uj = await kodKeszites(ceg.felhasznalo);
    expect((await hivas("POST", LINK_PATH, { code: regi.kod, taxNumber: ADOSZAM })).body).toMatchObject({ code: "INVALID_CODE" });
    expect((await hivas("POST", LINK_PATH, { code: uj.kod, taxNumber: "99999999-2-42" })).status).toBe(422);
    await pool.query("UPDATE integracio.kapcsolodasi_kodok SET lejar = now() - interval '1 minute' WHERE company_id = $1 AND visszavonva IS NULL", [ceg.companyId]);
    expect((await hivas("POST", LINK_PATH, { code: uj.kod, taxNumber: ADOSZAM })).status).toBe(422);
    expect((await neveben(pool, ceg.felhasznalo, async (db) => (await db.query("SELECT public.integracio_allapot() AS a")).rows[0].a)).osszekapcsolva).toBe(false);
  });

  it("érvényes kóddal összekapcsol, egyszer; a termékjegyzék és az adószámos partnerek kimennek; bontás", async () => {
    const t = termek(ceg);
    await ment(pool, ceg.felhasznalo, [t, szallito(ceg), szallito(ceg, { name: "Adószám nélküli", tax_number: null })]);
    const { kod } = await kodKeszites(ceg.felhasznalo);
    const r = await hivas("POST", LINK_PATH, { code: kod.toLowerCase(), taxNumber: "12345678242" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ companyRef: ceg.companyId, companyName: "Kapcsolódó Kft.", taxNumber: ADOSZAM });
    expect((await hivas("POST", LINK_PATH, { code: kod, taxNumber: ADOSZAM })).status).toBe(422);
    await osszeallitas(pool);
    const kezdo = await pool.query("SELECT envelope ->> 'type' AS t FROM integracio.integration_outbox WHERE envelope -> 'source' ->> 'companyRef' = $1", [ceg.companyId]);
    expect(kezdo.rows.map((x) => x.t).sort()).toEqual(["keszlet.termek.valtozott", "torzs.partner.valtozott"]);
    const naplo = await pool.query("SELECT description FROM public.audit_log WHERE company_id = $1 AND entity_type = 'integracio' ORDER BY event_timestamp", [ceg.companyId]);
    expect(naplo.rows.map((x) => x.description).join(" | ")).toMatch(/Kapcsolódási kód készült.*összekapcsolva/);
  });
});

leiras("aláírás", () => {
  it("aláírás nélkül, rossz titokkal, ismételt kéréssel nem megy át semmi; az egészség-végpont aláírás nélküli", async () => {
    expect((await fetch(`${base}${INBOUND_PATH}`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await hivas("POST", INBOUND_PATH, { event: partnerEsemeny(), targetCompanyRef: ceg.companyId }, { titok: "x".repeat(40) })).status).toBe(401);
    const elso = await hivas("POST", INBOUND_PATH, { event: partnerEsemeny(), targetCompanyRef: ceg.companyId });
    expect(elso.status).toBe(200);
    const ismetelt = await fetch(`${base}${INBOUND_PATH}`, { method: "POST", headers: elso.headers, body: JSON.stringify({ event: partnerEsemeny(), targetCompanyRef: ceg.companyId }) });
    expect(ismetelt.status).toBe(401);
    expect(await (await fetch(`${base}/egeszseg`)).json()).toEqual({ ok: true });
  });
});

leiras("beérkező események", () => {
  it("ugyanaz az esemény 2×, 5× és párhuzamosan is pontosan egyszer hat", async () => {
    const e = partnerEsemeny();
    const elso = await hivas("POST", INBOUND_PATH, { event: e, targetCompanyRef: ceg.companyId });
    expect(elso.body).toEqual({ outcome: "APPLIED" });
    expect((await hivas("POST", INBOUND_PATH, { event: e, targetCompanyRef: ceg.companyId })).body).toEqual({ outcome: "DUPLICATE" });
    const e2 = partnerEsemeny();
    const parh = await Promise.all(Array.from({ length: 5 }, () => hivas("POST", INBOUND_PATH, { event: e2, targetCompanyRef: ceg.companyId })));
    expect(parh.map((r) => r.body!.outcome).sort()).toEqual(["APPLIED", "DUPLICATE", "DUPLICATE", "DUPLICATE", "DUPLICATE"]);
    expect(hatasok.filter((id) => id === e.id || id === e2.id)).toHaveLength(2);
    expect(Number((await pool.query("SELECT count(*) FROM integracio.nonces WHERE nonce IN ($1, $2)", [`hatas-${e.id}`, `hatas-${e2.id}`])).rows[0].count)).toBe(2);
  });

  it("az ismeretlen verzió végleges elutasítás (a központban újraküldhető), nem csendes; semmi nem rögzül", async () => {
    const regi: EventEnvelope = {
      id: randomUUID(), type: "konyvelo.kiegyenlites.rogzitve", version: 2,
      source: { module: "konyvelo", companyRef: randomUUID(), recordType: "kiegyenlites", recordId: "S1", sequence: 1 }, occurredAt: "2026-11-02T08:00:00Z",
      payload: { settlementId: "s", documentId: "d", settledDocumentId: "d0", amount: 1, date: "2026-11-02" },
    };
    const r = await hivas("POST", INBOUND_PATH, { event: regi, targetCompanyRef: ceg.companyId });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: "UNSUPPORTED_EVENT" });
    expect((await pool.query("SELECT count(*) FROM integracio.integration_inbox WHERE event_id = $1", [regi.id])).rows[0].count).toBe("0");
  });

  it("a saját eseményét, hibás eseményt és nem összekapcsolt céget nem fogad", async () => {
    const sajat = { ...partnerEsemeny(), source: { module: "keszlet", companyRef: "x", recordType: "partner", recordId: "P", sequence: 1 } };
    expect((await hivas("POST", INBOUND_PATH, { event: sajat, targetCompanyRef: ceg.companyId })).status).toBe(422);
    expect((await hivas("POST", INBOUND_PATH, { event: { ...partnerEsemeny(), payload: {} }, targetCompanyRef: ceg.companyId })).status).toBe(422);
    const masik = await ujCeg(pool, "Nem kapcsolt Kft.");
    expect((await hivas("POST", INBOUND_PATH, { event: partnerEsemeny(), targetCompanyRef: masik.companyId })).body).toMatchObject({ code: "NOT_LINKED" });
  });
});

/** Memóriabeli ál-központ az átadóhoz. */
class AlKozpont implements HubClient {
  kapott: EventEnvelope[] = [];
  megoldott: string[] = [];
  le = false;
  async publish(events: EventEnvelope[]) {
    if (this.le) throw new Error("Az integrációs központ most nem érhető el.");
    for (const e of events) if (!this.kapott.some((x) => x.id === e.id)) this.kapott.push(e);
    return { accepted: events.map((e) => e.id), rejected: [] };
  }
  async resolveTodo(_ref: string, key: string) {
    if (this.le) throw new Error("nem érhető el");
    this.megoldott.push(key);
  }
  async links() {
    return [];
  }
}

leiras("átadás és önállóság", () => {
  it("ha a központ áll, a Készlet mentése sikerül, az esemény vár, 30 perc után Teendő; utána pontosan egyszer megy, és a Teendő lezárul", async () => {
    const hub = new AlKozpont();
    await atadas(pool, hub); // a korábbi tesztek eseményei
    hub.le = true;
    const t = termek(ceg, { name: "Központ nélkül" });
    const m = mozgas(ceg, String(t.sor.id), { unit_price: 10 });
    await ment(pool, ceg.felhasznalo, [t, m, tetel(ceg, String(t.sor.id), String(m.sor.id), { unit_price: 10 })]);
    await osszeallitas(pool);
    expect(await atadas(pool, hub)).toMatchObject({ elkuldve: 0, hiba: expect.stringMatching(/nem érhető el/) });
    const kesobb = new Date(Date.now() + (KOZPONT_NEM_ERHETO_EL_PERC + 1) * 60_000);
    await atadas(pool, hub, kesobb);
    const allapot = await neveben(pool, ceg.felhasznalo, async (db) => (await db.query("SELECT public.integracio_allapot() AS a")).rows[0].a);
    expect(allapot).toMatchObject({ atadasra_var: 2, utolso_hiba: expect.stringMatching(/nem érhető el/), teendok: [expect.objectContaining({ fajta: "KOZPONT_NEM_ERHETO_EL" })] });

    hub.le = false;
    expect(await atadas(pool, hub)).toMatchObject({ elkuldve: 2, hiba: null });
    expect(await atadas(pool, hub)).toMatchObject({ elkuldve: 0 });
    expect(hub.kapott.filter((e) => e.source.recordId === m.sor.id)).toHaveLength(1);
    const utana = await neveben(pool, ceg.felhasznalo, async (db) => (await db.query("SELECT public.integracio_allapot() AS a")).rows[0].a);
    expect(utana).toMatchObject({ atadasra_var: 0, teendok: [] });
  });

  it("a központba is bejelentett Teendő megoldását jelzi a központnak, egyszer", async () => {
    const hub = new AlKozpont();
    await pool.query("INSERT INTO integracio.teendok (company_id, kulcs, fajta, cim, hub_kulcs, megoldva) VALUES ($1, 'k1', 'X', 'Próba', 'termek:B1', now())", [ceg.companyId]);
    await atadas(pool, hub);
    await atadas(pool, hub);
    expect(hub.megoldott).toEqual(["termek:B1"]);
  });

  it("bontás után nem fogad és nem keletkezik új változás", async () => {
    expect((await hivas("DELETE", `${LINK_PATH}/${ceg.companyId}`)).status).toBe(204);
    expect((await hivas("POST", INBOUND_PATH, { event: partnerEsemeny(), targetCompanyRef: ceg.companyId })).body).toMatchObject({ code: "NOT_LINKED" });
    const elotte = Number((await pool.query("SELECT count(*) FROM integracio.valtozasok WHERE company_id = $1", [ceg.companyId])).rows[0].count);
    await ment(pool, ceg.felhasznalo, [termek(ceg, { name: "Bontás után" })]);
    expect(Number((await pool.query("SELECT count(*) FROM integracio.valtozasok WHERE company_id = $1", [ceg.companyId])).rows[0].count)).toBe(elotte);
  });
});
