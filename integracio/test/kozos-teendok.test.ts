// Közös Teendők a Készlet oldalán (TERV.md F18, I6.3), valódi PostgreSQL-en: a Teendő-tükör küldése a
// központnak (csak változáskor, de legalább 10 percenként), a többi program Teendőinek letöltése, és a
// felület függvénye (csak a fő iroda és a tulajdonos látja, csak a címet és a hivatkozást).
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todoMirrorHash, type EventEnvelope, type HubClient, type ModuleTodo, type SharedTodosAnswer } from "../esemenyek/src/index.ts";
import { kozosTeendokKor, teendoTukor } from "../src/kozos-teendok.ts";
import { DB_URL, neveben, osszekapcsol, ujAdatbazis, ujCeg, ujCsapattag, type Ceg } from "./adatbazis.ts";

const leiras = DB_URL ? describe : describe.skip;

let pool: pg.Pool;
let ceg: Ceg;

class AlKozpont implements HubClient {
  tukrok: Array<{ ref: string; todos: ModuleTodo[] }> = [];
  valasz: SharedTodosAnswer = { todos: [], modules: [] };
  le = false;
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
  async mirrorTodos(ref: string, todos: ModuleTodo[]) {
    if (this.le) throw new Error("Az integrációs központ most nem érhető el.");
    this.tukrok.push({ ref, todos });
    return { stored: todos.length };
  }
  async sharedTodos() {
    if (this.le) throw new Error("Az integrációs központ most nem érhető el.");
    return this.valasz;
  }
  async mirrorOpenItems(): Promise<never> {
    throw new Error("nem kell");
  }
  async openItems(): Promise<never> {
    throw new Error("nem kell");
  }
}

beforeAll(async () => {
  if (!DB_URL) return;
  pool = await ujAdatbazis("kozos_teendok");
  ceg = await ujCeg(pool, "Közös Kft.");
});
afterAll(async () => pool?.end());

leiras("közös Teendők (I6)", () => {
  it("összekapcsolás nélkül nem küld és nem tölt le semmit", async () => {
    const hub = new AlKozpont();
    expect(await kozosTeendokKor(pool, hub)).toEqual({ kuldve: 0, valtozatlan: 0, letoltve: 0, hibas: 0 });
    expect(hub.tukrok).toEqual([]);
  });

  it("a Készlet Teendői (a visszhang nélkül) a központba mennek, csak változáskor vagy a frissítési idő után", async () => {
    await osszekapcsol(pool, ceg);
    await pool.query("INSERT INTO public.products (company_id, location_id, name, unit, current_stock, min_stock) VALUES ($1, $2, 'Ajtó', 'db', 1, 5)", [ceg.companyId, ceg.locationId]);
    await pool.query(
      `INSERT INTO integracio.teendok (company_id, kulcs, fajta, cim) VALUES ($1, 'b1', 'BEERKEZO', 'Ismeretlen termék a Könyvelőből'),
         ($1, 'e1', 'EGYEZTETES', 'Készletérték: eltérés'), ($1, 'k1', 'KOZPONT_NEM_ERHETO_EL', 'A központ nem érhető el')`,
      [ceg.companyId],
    );
    const hub = new AlKozpont();
    const t0 = new Date("2026-11-02T08:00:00Z");
    expect(await kozosTeendokKor(pool, hub, t0)).toMatchObject({ kuldve: 1, letoltve: 1, hibas: 0 });
    const kuldott = hub.tukrok[0]!;
    expect(kuldott.ref).toBe(ceg.companyId);
    expect(kuldott.todos.map((t) => t.kind).sort()).toEqual(["ALACSONY_KESZLET", "BEERKEZO"]);
    expect(kuldott.todos.find((t) => t.kind === "BEERKEZO")!.link).toEqual({ module: "keszlet", path: "#/jovahagyasra-var" });
    expect(kuldott.todos.find((t) => t.kind === "ALACSONY_KESZLET")).toMatchObject({ title: "1 termék készlete a minimum alatt", link: { module: "keszlet", path: "#/riasztasok" } });
    const lenyomat = (await pool.query("SELECT lenyomat FROM integracio.teendo_tukor WHERE company_id = $1", [ceg.companyId])).rows[0].lenyomat;
    expect(lenyomat).toBe(todoMirrorHash(kuldott.todos));

    expect(await kozosTeendokKor(pool, hub, new Date(t0.getTime() + 60_000))).toMatchObject({ kuldve: 0, valtozatlan: 1 });
    expect(await kozosTeendokKor(pool, hub, new Date(t0.getTime() + 11 * 60_000))).toMatchObject({ kuldve: 1 });
    // Változás: a Teendő megoldódott → azonnal megy, nélküle.
    await pool.query("UPDATE integracio.teendok SET megoldva = now() WHERE company_id = $1 AND kulcs = 'b1'", [ceg.companyId]);
    expect(await kozosTeendokKor(pool, hub, new Date(t0.getTime() + 12 * 60_000))).toMatchObject({ kuldve: 1 });
    expect(hub.tukrok.at(-1)!.todos.map((t) => t.kind)).toEqual(["ALACSONY_KESZLET"]);
    // Új összekapcsolás után (ugyanaz a lista is) újra megy.
    await osszekapcsol(pool, ceg);
    expect(await kozosTeendokKor(pool, hub, new Date(t0.getTime() + 12 * 60_000 + 1))).toMatchObject({ kuldve: 1 });
  });

  it("a többi program Teendői: csak a fő iroda és a tulajdonos látja, csak a címet és a hivatkozást; a központ kiesésekor jelzi", async () => {
    const hub = new AlKozpont();
    hub.valasz = {
      todos: [
        { module: "konyvelo", moduleLabel: "Könyvelő", key: "p", kind: "DRAFTS", title: "3 piszkozat vár könyvelésre", detail: "belső részlet", link: { module: "konyvelo", path: "/konyveles?ceg=k1" }, since: "2026-11-02T08:00:00.000Z" },
        { module: "kozpont", moduleLabel: "Integrációs központ", key: "a", kind: "ATADASI_HIBA", title: "Átadási hiba", detail: null, link: null, since: null },
      ],
      modules: [
        { module: "keszlet", moduleLabel: "Készlet", mirroredAt: "2026-11-02T08:00:00.000Z" },
        { module: "konyvelo", moduleLabel: "Könyvelő", mirroredAt: null },
      ],
    };
    await kozosTeendokKor(pool, hub);
    const lekeres = (felhasznalo: string) => neveben(pool, felhasznalo, async (db) => (await db.query("SELECT public.integracio_kozos_teendok() AS a")).rows[0].a);
    const fo = await lekeres(ceg.felhasznalo);
    expect(fo).toMatchObject({
      allapot: "OK",
      teendok: [
        { modul: "konyvelo", modulNev: "Könyvelő", cim: "3 piszkozat vár könyvelésre", hivatkozas: { module: "konyvelo", path: "/konyveles?ceg=k1" } },
        { modul: "kozpont", modulNev: "Integrációs központ", cim: "Átadási hiba", hivatkozas: null },
      ],
      modulok: [{ modulNev: "Könyvelő", kuldve: null }],
    });
    expect(JSON.stringify(fo)).not.toContain("belső részlet");
    const raktaros = await ujCsapattag(pool, ceg, "raktaros");
    expect(await lekeres(raktaros)).toMatchObject({ allapot: "NINCS_JOGOSULTSAG", teendok: [] });
    const iroda = await ujCsapattag(pool, ceg, "iroda");
    expect(await lekeres(iroda)).toMatchObject({ allapot: "NINCS_JOGOSULTSAG" });
    const tulaj = await ujCsapattag(pool, ceg, "tulajdonos");
    expect(await lekeres(tulaj)).toMatchObject({ allapot: "OK" });

    hub.le = true;
    // A saját lista nem változott (nem kell küldeni), csak a letöltés hibázik.
    expect(await kozosTeendokKor(pool, hub)).toMatchObject({ valtozatlan: 1, hibas: 1 });
    expect(await lekeres(ceg.felhasznalo)).toMatchObject({ allapot: "KOZPONT_NEM_ERHETO_EL", teendok: expect.arrayContaining([expect.objectContaining({ cim: "3 piszkozat vár könyvelésre" })]) });

    // Bontás után semmi nem látszik.
    await pool.query("UPDATE integracio.beallitas SET bontva = now() WHERE company_id = $1", [ceg.companyId]);
    expect(await lekeres(ceg.felhasznalo)).toMatchObject({ allapot: "NINCS_OSSZEKAPCSOLVA", teendok: [] });
  });

  it("a fő iroda jóváhagyására és a raktárban váró mozgások külön Teendő", async () => {
    const masik = await ujCeg(pool, "Mozgás Kft.");
    const t = await pool.query<{ id: string }>("INSERT INTO public.products (company_id, location_id, name, unit) VALUES ($1, $2, 'Csavar', 'db') RETURNING id", [masik.companyId, masik.locationId]);
    for (const esemeny of [null, "00000000-0000-0000-0000-000000000001"]) {
      await pool.query(
        "INSERT INTO public.movements (company_id, product_id, location_id, date, type, quantity, approval_status, integracio_esemeny_id) VALUES ($1, $2, $3, '2026-11-02', 'in', 1, 'pending', $4)",
        [masik.companyId, t.rows[0]!.id, masik.locationId, esemeny],
      );
    }
    const lista = await teendoTukor(pool, masik.companyId);
    expect(lista.map((x) => [x.kind, x.title, x.link?.path])).toEqual([
      ["JOVAHAGYANDO", "1 tétel vár beérkezésre vagy kiadásra a raktárban", "#/jovahagyasra-var"],
      ["JOVAHAGYAS", "1 mozgás vár a fő iroda jóváhagyására", "#/jovahagyasok"],
    ]);
  });
});
