// A Könyvelő nyitott tételei a Készletben (TERV.md F19, I6b, KK10), valódi PostgreSQL-en: a letöltés, a
// felület függvénye (ki látja), és a visszaállás a saját számításra, ha nincs Könyvelő.
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError, type EventEnvelope, type HubClient, type OpenItemsAnswer } from "../esemenyek/src/index.ts";
import { nyitottTetelekKor } from "../src/nyitott-tetelek.ts";
import { DB_URL, neveben, osszekapcsol, ujAdatbazis, ujCeg, ujCsapattag, type Ceg } from "./adatbazis.ts";

const leiras = DB_URL ? describe : describe.skip;
let pool: pg.Pool;
let ceg: Ceg;

class AlKozpont implements HubClient {
  valasz: OpenItemsAnswer | HubError | Error = { state: "NONE", asOf: null, mirroredAt: null, items: [], pendingDrafts: [] };
  async publish(events: EventEnvelope[]) {
    return { accepted: events.map((e) => e.id), rejected: [] };
  }
  async resolveTodo() {}
  async links() {
    return [];
  }
  async reconcileNow(): Promise<never> {
    throw new Error("nem kell");
  }
  async acceptBaseline(): Promise<never> {
    throw new Error("nem kell");
  }
  async mirrorTodos() {
    return { stored: 0 };
  }
  async sharedTodos(): Promise<never> {
    throw new Error("nem kell");
  }
  async mirrorOpenItems(): Promise<never> {
    throw new Error("nem kell");
  }
  async openItems() {
    if (this.valasz instanceof Error) throw this.valasz;
    return this.valasz;
  }
}

beforeAll(async () => {
  if (!DB_URL) return;
  pool = await ujAdatbazis("nyitott_tetelek");
  ceg = await ujCeg(pool, "Nyitott Kft.");
});
afterAll(async () => pool?.end());

const lekeres = (felhasznalo: string) => neveben(pool, felhasznalo, async (db) => (await db.query("SELECT public.integracio_konyvelo_nyitott() AS a")).rows[0].a);

leiras("a Könyvelő nyitott tételei (I6b)", () => {
  it("letöltés; az iroda, a fő iroda és a tulajdonos látja, a raktáros nem; a központ kiesésekor a régi lista marad", async () => {
    await osszekapcsol(pool, ceg);
    const hub = new AlKozpont();
    expect(await lekeres(ceg.felhasznalo)).toEqual({ allapot: "NINCS_KONYVELO" });
    expect(await nyitottTetelekKor(pool, hub)).toEqual({ letoltve: 1, nincs: 0, hibas: 0 });
    expect(await lekeres(ceg.felhasznalo)).toMatchObject({ allapot: "NINCS_ADAT", items: [], pendingDrafts: [] });

    hub.valasz = {
      state: "OK",
      asOf: "2026-11-02",
      mirroredAt: "2026-11-02T08:00:00.000Z",
      items: [
        { kind: "PAYABLE", documentId: "d1", serialNumber: "SZSZ-1", externalNumber: "A-1", partnerName: "Ajtó Kft.", description: null, issueDate: "2026-11-02", dueDate: null, open: 127_000_00, link: { module: "konyvelo", path: "/konyveles/d1?ceg=k" }, stockSources: [{ recordType: "beszerzes", recordId: "m1" }] },
      ],
      pendingDrafts: [{ kind: "RECEIVABLE", documentId: null, link: null, stockSources: [{ recordType: "eladas", recordId: "m2" }] }],
    };
    await nyitottTetelekKor(pool, hub, new Date("2026-11-02T08:01:00Z"));
    const a = await lekeres(ceg.felhasznalo);
    expect(a).toMatchObject({ allapot: "OK", asOf: "2026-11-02", items: [{ documentId: "d1", dueDate: null }], pendingDrafts: [{ kind: "RECEIVABLE" }] });
    expect(a.kuldve).toMatch(/^2026-11-02T08:00:00/);
    for (const role of ["iroda", "tulajdonos"] as const) expect((await lekeres(await ujCsapattag(pool, ceg, role))).allapot).toBe("OK");
    expect(await lekeres(await ujCsapattag(pool, ceg, "raktaros"))).toEqual({ allapot: "NINCS_JOGOSULTSAG" });

    hub.valasz = new HubError(503, "HUB_UNREACHABLE", "Az integrációs központ most nem érhető el.");
    expect((await nyitottTetelekKor(pool, hub)).hibas).toBe(1);
    expect(await lekeres(ceg.felhasznalo)).toMatchObject({ allapot: "KOZPONT_NEM_ERHETO_EL", items: [{ documentId: "d1" }] });
  });

  it("ha nincs Könyvelő vagy ki van kapcsolva a kapcsolat, a Készlet a saját számítására áll vissza", async () => {
    const hub = new AlKozpont();
    hub.valasz = new HubError(409, "PAIR_DISABLED", "A Könyvelő → Készlet kapcsolat ki van kapcsolva.");
    expect((await nyitottTetelekKor(pool, hub)).nincs).toBe(1);
    expect(await lekeres(ceg.felhasznalo)).toEqual({ allapot: "NINCS_KONYVELO" });
    // Bontás után sem marad régi lista.
    hub.valasz = { state: "NONE", asOf: null, mirroredAt: null, items: [], pendingDrafts: [] };
    await nyitottTetelekKor(pool, hub);
    await pool.query("UPDATE integracio.beallitas SET bontva = now() WHERE company_id = $1", [ceg.companyId]);
    await nyitottTetelekKor(pool, hub);
    expect((await pool.query("SELECT count(*)::int AS n FROM integracio.konyvelo_nyitott")).rows[0].n).toBe(0);
  });
});
