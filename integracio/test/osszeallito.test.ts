// A triggerek és az összeállító tesztjei valódi PostgreSQL-en (TERV.md F15.6).
// Futtatás: KESZLET_TEST_DATABASE_URL=postgresql://…/keszlet_test npm test
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateEvent, type EventEnvelope } from "../esemenyek/src/index.ts";
import { lotGoodsValueHuf, lotShippingHuf, lotUnitCost } from "../../src/lib/costing.ts";
import { movementVatAmountHuf } from "../../src/lib/vat.ts";
import { osszeallitas } from "../src/osszeallito.ts";
import { DB_URL, ment, mozgas, neveben, osszekapcsol, szallito, tetel, termek, ujAdatbazis, ujCeg, ujCsapattag, vevo, type Ceg } from "./adatbazis.ts";

const leiras = DB_URL ? describe : describe.skip;

let pool: pg.Pool;
let ceg: Ceg;
let raktaros: string;
let termekId: string;
let szallitoId: string;
let vevoId: string;

beforeAll(async () => {
  if (!DB_URL) return;
  pool = await ujAdatbazis("osszeallito");
  ceg = await ujCeg(pool);
  raktaros = await ujCsapattag(pool, ceg, "raktaros");
  await osszekapcsol(pool, ceg);
  const sz = szallito(ceg);
  szallitoId = String(sz.sor.id);
  const v = vevo(ceg);
  vevoId = String(v.sor.id);
  const t = termek(ceg, { supplier_id: szallitoId });
  termekId = String(t.sor.id);
  await ment(pool, ceg.felhasznalo, [sz, v, t]);
  await osszeallitas(pool);
});

afterAll(async () => {
  await pool?.end();
});

/** A cég összeállított eseményei a változások sorrendjében (opcionálisan egy forrásrekordra szűrve). */
async function esemenyek(recordId?: string): Promise<EventEnvelope[]> {
  const r = await pool.query<{ envelope: EventEnvelope }>(
    `SELECT o.envelope FROM integracio.valtozasok v JOIN integracio.integration_outbox o ON o.id = v.esemeny_id
      WHERE v.company_id = $1 AND ($2::text IS NULL OR o.envelope -> 'source' ->> 'recordId' = $2) ORDER BY v.id`,
    [ceg.companyId, recordId ?? null],
  );
  for (const e of r.rows) expect(validateEvent(e.envelope).ok, JSON.stringify(e.envelope)).toBe(true);
  return r.rows.map((x) => x.envelope);
}
const tipusok = (es: EventEnvelope[]) => es.map((e) => `${e.type}@${e.version}#${e.source.sequence}`);
const valtozasDb = async (companyId: string) => Number((await pool.query("SELECT count(*) FROM integracio.valtozasok WHERE company_id = $1", [companyId])).rows[0].count);

leiras("trigger: mikor keletkezik változás", () => {
  it("összekapcsolatlan cégnél semmi; összekapcsoltnál a kezdő termék és partnerek egyszer", async () => {
    const masik = await ujCeg(pool, "Másik Kft.");
    const t = termek(masik);
    const m = mozgas(masik, String(t.sor.id), { unit_price: 100 });
    await ment(pool, masik.felhasznalo, [t, m, tetel(masik, String(t.sor.id), String(m.sor.id), { unit_price: 100 })]);
    expect(await valtozasDb(masik.companyId)).toBe(0);
    expect(tipusok(await esemenyek())).toEqual(["torzs.partner.valtozott@1#1", "torzs.partner.valtozott@1#1", "keszlet.termek.valtozott@1#1"]);
  });

  it("a visszagörgetett mentésből nem lesz változás; a csak készletet érintő termékmódosításból sem", async () => {
    const elotte = await valtozasDb(ceg.companyId);
    const m = mozgas(ceg, termekId, { unit_price: 100 });
    const rossz = mozgas(ceg, randomUUID());
    await expect(ment(pool, ceg.felhasznalo, [m, tetel(ceg, termekId, String(m.sor.id)), rossz])).rejects.toThrow();
    await pool.query("UPDATE public.products SET current_stock = current_stock + 1, version = version WHERE id = $1", [termekId]);
    expect(await valtozasDb(ceg.companyId)).toBe(elotte);
    await pool.query("UPDATE public.products SET name = 'Bejárati ajtó (fehér)' WHERE id = $1", [termekId]);
    expect(await valtozasDb(ceg.companyId)).toBe(elotte + 1);
    await osszeallitas(pool);
    expect((await esemenyek(termekId)).at(-1)).toMatchObject({ type: "keszlet.termek.valtozott", source: { sequence: 2 }, payload: { name: "Bejárati ajtó (fehér)", active: true, vatRate: 27 } });
  });
});

leiras("beszerzés", () => {
  it("devizás, szállítási díjjal, nem visszaigényelhető áfával: a tartalom a Készlet számításával egyezik, fillérre", async () => {
    const m = mozgas(ceg, termekId, { quantity: 3, unit_price: 10.33, shipping_cost: 2.5, currency: "EUR", exchange_rate: 395.55, invoice_number: "SZ-2026-77", shipping_on_invoice: true });
    // A beszerzési tétel a köteg elején is lehet: a késleltetett trigger a tranzakció végén olvas.
    const l = tetel(ceg, termekId, String(m.sor.id), { quantity: 3, remaining_quantity: 3, unit_price: 10.33, shipping_cost: 2.5, currency: "EUR", exchange_rate: 395.55, vat_rate_percent: 27, vat_reclaimable: false });
    await ment(pool, ceg.felhasznalo, [l, m]);
    expect(await osszeallitas(pool)).toMatchObject({ keszult: 1, hibas: 0 });
    const [e] = await esemenyek(String(m.sor.id));
    const lot = { unitPrice: 10.33, shippingCost: 2.5, quantity: 3, exchangeRate: 395.55, vatRatePercent: 27, vatReclaimable: false };
    const aru = Math.round(lotGoodsValueHuf(lot) * 100);
    const fuvar = Math.round(lotShippingHuf(lot) * 100);
    expect(e).toMatchObject({
      type: "keszlet.beszerzes.veglegesitve",
      version: 3,
      source: { module: "keszlet", companyRef: ceg.companyId, recordType: "beszerzes", recordId: m.sor.id, sequence: 1 },
      payload: {
        purchaseId: m.sor.id,
        receivedDate: "2026-11-02",
        invoiceNumber: "SZ-2026-77",
        supplier: { name: "Ajtó Kft.", taxNumber: "10537914-4-44" },
        originalCurrency: { code: "EUR", rate: 395.55 },
        lines: [{ productId: termekId, quantity: 3, unit: "db", netAmount: aru, vatRate: 27, vatAmount: Math.round(aru * 0.27), vatReclaimable: false }],
        shipping: { netAmount: fuvar, vatRate: 27, vatAmount: Math.round(fuvar * 0.27), vatReclaimable: false, onSupplierInvoice: true },
      },
    });
    const p = e!.payload as { totals: { net: number; vat: number; gross: number } };
    expect(p.totals).toEqual({ net: aru + fuvar, vat: Math.round(aru * 0.27) + Math.round(fuvar * 0.27), gross: aru + fuvar + Math.round(aru * 0.27) + Math.round(fuvar * 0.27) });
    expect(e!.causedBy).toBeUndefined();
  });

  it("a számla kelte és teljesítési dátuma: ha a Készletben megadták, az eseménybe kerül; ha nem, üres marad (nem találgatunk)", async () => {
    const m = mozgas(ceg, termekId, { unit_price: 10, invoice_date: "2026-11-01", fulfillment_date: "2026-10-30" });
    const n = mozgas(ceg, termekId, { unit_price: 10 });
    await ment(pool, ceg.felhasznalo, [m, tetel(ceg, termekId, String(m.sor.id), { unit_price: 10 }), n, tetel(ceg, termekId, String(n.sor.id), { unit_price: 10 })]);
    await osszeallitas(pool);
    expect((await esemenyek(String(m.sor.id)))[0]!.payload).toMatchObject({ receivedDate: "2026-11-02", invoiceDate: "2026-11-01", fulfillmentDate: "2026-10-30" });
    expect((await esemenyek(String(n.sor.id)))[0]!.payload).toMatchObject({ invoiceDate: null, fulfillmentDate: null });
  });

  it("a raktárosnak jóváhagyásra váró rendelésből csak a jóváhagyáskor lesz esemény, a ténylegesen beérkezett mennyiséggel", async () => {
    const m = mozgas(ceg, termekId, { quantity: 10, ordered_quantity: 10, unit_price: 1000, approval_status: "pending" });
    await ment(pool, ceg.felhasznalo, [m]);
    expect(await osszeallitas(pool)).toMatchObject({ keszult: 0 });
    const jovahagyva = { ...m.sor, quantity: 8, approval_status: "approved", approved_at: "2026-11-03T08:00:00Z", discrepancy_note: "2 db sérült", version: 1 };
    await ment(pool, raktaros, [{ tabla: "movements", sor: jovahagyva }, tetel(ceg, termekId, String(m.sor.id), { quantity: 8, remaining_quantity: 8, unit_price: 1000, vat_rate_percent: 27 })]);
    await osszeallitas(pool);
    const es = await esemenyek(String(m.sor.id));
    expect(tipusok(es)).toEqual(["keszlet.beszerzes.veglegesitve@3#1"]);
    expect(es[0]!.payload).toMatchObject({ lines: [{ quantity: 8, netAmount: 800_000, vatAmount: 216_000, vatReclaimable: true }], shipping: null, totals: { gross: 1_016_000 } });
  });

  it("a jóváhagyásra váró, majd törölt rendelésből semmi; a jóváhagyott beszerzés törléséből és korrekciójából visszavonás", async () => {
    const fuggo = mozgas(ceg, termekId, { approval_status: "pending", unit_price: 1 });
    await ment(pool, ceg.felhasznalo, [fuggo]);
    await ment(pool, ceg.felhasznalo, [{ tabla: "movements", sor: { ...fuggo.sor, deleted_at: "2026-11-03T08:00:00Z", version: 1 } }]);

    const torolt = mozgas(ceg, termekId, { unit_price: 500 });
    await ment(pool, ceg.felhasznalo, [torolt, tetel(ceg, termekId, String(torolt.sor.id), { unit_price: 500 })]);
    await ment(pool, ceg.felhasznalo, [{ tabla: "movements", sor: { ...torolt.sor, deleted_at: "2026-11-03T08:00:00Z", version: 1 } }]);

    const korrigalt = mozgas(ceg, termekId, { unit_price: 700 });
    await ment(pool, ceg.felhasznalo, [korrigalt, tetel(ceg, termekId, String(korrigalt.sor.id), { unit_price: 700 })]);
    const korrekcio = mozgas(ceg, termekId, { type: "out", corrects_movement_id: korrigalt.sor.id, unit_cost: 700, note: "Korrekció - érvényteleníti a mozgást" });
    await ment(pool, ceg.felhasznalo, [korrekcio]);
    await osszeallitas(pool);

    expect(await esemenyek(String(fuggo.sor.id))).toEqual([]);
    expect(tipusok(await esemenyek(String(torolt.sor.id)))).toEqual(["keszlet.beszerzes.veglegesitve@3#1", "keszlet.mozgas.sztornozva@3#2"]);
    const k = await esemenyek(String(korrigalt.sor.id));
    expect(tipusok(k)).toEqual(["keszlet.beszerzes.veglegesitve@3#1", "keszlet.mozgas.sztornozva@3#2"]);
    expect(k[1]!.payload).toMatchObject({ movementKind: "PURCHASE", movementId: korrigalt.sor.id, reason: "Korrekció - érvényteleníti a mozgást" });
    // A korrekciós tétel maga nem eladás.
    expect(await esemenyek(String(korrekcio.sor.id))).toEqual([]);
  });
});

leiras("eladás, visszavonás, leltár, visszáru", () => {
  it("eladás a Készlet áfaszámításával és ELÁBÉ-val; a visszavonás egyszer megy, a visszavételezés nem eladás", async () => {
    const m = mozgas(ceg, termekId, { type: "out", quantity: 2, sale_unit_price: 1234.56, unit_cost: 600.4, vat_rate_percent: 27, customer_id: vevoId, invoice_number: "V-1" });
    await ment(pool, ceg.felhasznalo, [m]);
    await ment(pool, ceg.felhasznalo, [
      { tabla: "movements", sor: { ...m.sor, cancelled: true, cancelled_at: "2026-11-04T08:00:00Z", cancel_reason: "ügyfél lemondta", version: 1 } },
      mozgas(ceg, termekId, { quantity: 2, unit_price: 600.4, corrects_movement_id: m.sor.id, date: "2026-11-04" }),
    ]);
    await osszeallitas(pool);
    const es = await esemenyek(String(m.sor.id));
    expect(tipusok(es)).toEqual(["keszlet.eladas.veglegesitve@2#1", "keszlet.mozgas.sztornozva@3#2"]);
    const vat = Math.round(movementVatAmountHuf({ quantity: 2, saleUnitPrice: 1234.56, vatRatePercent: 27 }) * 100);
    expect(es[0]!.payload).toMatchObject({
      saleId: m.sor.id, cash: false, invoiceNumber: "V-1", customer: { name: "Vevő Bt.", taxNumber: "11111111-1-11" }, costOfGoods: 120_080,
      lines: [{ netAmount: 246_912, vatRate: 27, vatAmount: vat }], totals: { net: 246_912, vat, gross: 246_912 + vat },
    });
    expect(es[1]!.payload).toMatchObject({ movementKind: "SALE", reason: "ügyfél lemondta" });
  });

  it("leltári hiány, többlet és selejt a bekerülési értékkel; az irány ellentmondása nem megy ki", async () => {
    const hiany = mozgas(ceg, termekId, { type: "out", quantity: 1.5, unit_cost: 333.333, ok: "leltar_hiany", note: "leltár 2026-11" });
    const tobblet = mozgas(ceg, termekId, { type: "in", quantity: 2, unit_price: 100, shipping_cost: 10, ok: "leltar_tobblet" });
    const selejt = mozgas(ceg, termekId, { type: "out", quantity: 1, unit_cost: 50, ok: "selejt" });
    await ment(pool, ceg.felhasznalo, [hiany, tobblet, tetel(ceg, termekId, String(tobblet.sor.id), { quantity: 2, remaining_quantity: 2, unit_price: 100, shipping_cost: 10 }), selejt]);
    await osszeallitas(pool);
    expect((await esemenyek(String(hiany.sor.id)))[0]).toMatchObject({ type: "keszlet.leltar.elteres", source: { recordType: "leltar" }, payload: { kind: "SHORTAGE", quantity: 1.5, value: 50_000, note: "leltár 2026-11", location: { id: ceg.locationId } } });
    const egyseg = lotUnitCost({ unitPrice: 100, shippingCost: 10, quantity: 2, exchangeRate: 1 });
    expect((await esemenyek(String(tobblet.sor.id)))[0]).toMatchObject({ payload: { kind: "SURPLUS", value: Math.round(egyseg * 2 * 100) } });
    expect((await esemenyek(String(selejt.sor.id)))[0]).toMatchObject({ payload: { kind: "SCRAP", value: 5_000 } });
    // Visszavonása is eljut (eddig erre nem volt esemény).
    await ment(pool, ceg.felhasznalo, [{ tabla: "movements", sor: { ...selejt.sor, deleted_at: "2026-11-05T08:00:00Z", version: 1 } }]);
    await osszeallitas(pool);
    expect((await esemenyek(String(selejt.sor.id)))[1]).toMatchObject({ type: "keszlet.mozgas.sztornozva", payload: { movementKind: "INVENTORY" } });
  });

  it("részleges vevői visszavétel és szállítói visszaküldés: az eredeti rekordján, az eredeti áraiból arányosan", async () => {
    const elad = mozgas(ceg, termekId, { type: "out", quantity: 5, sale_unit_price: 1000, unit_cost: 400, vat_rate_percent: 27, customer_id: vevoId });
    const besz = mozgas(ceg, termekId, { quantity: 10, unit_price: 300, shipping_cost: 100 });
    await ment(pool, ceg.felhasznalo, [elad, besz, tetel(ceg, termekId, String(besz.sor.id), { quantity: 10, remaining_quantity: 10, unit_price: 300, shipping_cost: 100, vat_rate_percent: 27, vat_reclaimable: true })]);
    const vv = mozgas(ceg, termekId, { type: "in", quantity: 2, return_of_movement_id: elad.sor.id, note: "sérült" });
    const vk = mozgas(ceg, termekId, { type: "out", quantity: 3, return_of_movement_id: besz.sor.id, unit_cost: 310 });
    await ment(pool, ceg.felhasznalo, [vv, tetel(ceg, termekId, String(vv.sor.id), { quantity: 2, remaining_quantity: 2, unit_price: 400 }), vk]);
    await osszeallitas(pool);
    const e1 = await esemenyek(String(elad.sor.id));
    expect(tipusok(e1)).toEqual(["keszlet.eladas.veglegesitve@2#1", "keszlet.visszaru.veglegesitve@1#2"]);
    expect(e1[1]!.payload).toMatchObject({
      returnId: vv.sor.id, kind: "CUSTOMER_RETURN", original: { movementKind: "SALE", movementId: elad.sor.id }, partner: { name: "Vevő Bt." }, cash: false, reason: "sérült",
      lines: [{ quantity: 2, netAmount: 200_000, vatAmount: 54_000 }], totals: { gross: 254_000 }, costOfGoods: 80_000, vatReclaimable: null,
    });
    const e2 = await esemenyek(String(besz.sor.id));
    expect(tipusok(e2)).toEqual(["keszlet.beszerzes.veglegesitve@3#1", "keszlet.visszaru.veglegesitve@1#2"]);
    // A szállítási díj a beszerzéshez tartozott: a visszaküldés az áru árán megy.
    expect(e2[1]!.payload).toMatchObject({ kind: "SUPPLIER_RETURN", partner: { name: "Ajtó Kft." }, lines: [{ quantity: 3, netAmount: 90_000, vatAmount: 24_300 }], vatReclaimable: true, costOfGoods: null });
  });
});

leiras("napi zárás", () => {
  it("a készpénzes eladások és visszavételek kulcsonként; utólagos mozgásnál „módosult”, a zárás nem íródik felül", async () => {
    const nap = "2026-11-10";
    const k1 = mozgas(ceg, termekId, { type: "out", date: nap, quantity: 1, sale_unit_price: 1000, unit_cost: 1, vat_rate_percent: 27 });
    const k2 = mozgas(ceg, termekId, { type: "out", date: nap, quantity: 3, sale_unit_price: 333.33, unit_cost: 1, vat_rate_percent: 27 });
    const k3 = mozgas(ceg, termekId, { type: "out", date: nap, quantity: 1, sale_unit_price: 2000, unit_cost: 1, vat_rate_percent: 5 });
    const vevos = mozgas(ceg, termekId, { type: "out", date: nap, quantity: 1, sale_unit_price: 9999, unit_cost: 1, vat_rate_percent: 27, customer_id: vevoId });
    await ment(pool, ceg.felhasznalo, [k1, k2, k3, vevos]);
    const vissza = mozgas(ceg, termekId, { type: "in", date: nap, quantity: 1, return_of_movement_id: k2.sor.id });
    await ment(pool, ceg.felhasznalo, [vissza, tetel(ceg, termekId, String(vissza.sor.id), { unit_price: 1 })]);
    const zaras = {
      tabla: "daily_closings",
      sor: {
        id: randomUUID(), company_id: ceg.companyId, location_id: ceg.locationId, date: nap, submitted_at: "2026-11-10T18:00:00Z", status: "submitted",
        in_count: 1, out_count: 4, product_breakdown: [], movement_ids: [k1, k2, k3, vevos, vissza].map((m) => String(m.sor.id)), created_at: "2026-11-10T18:00:00Z", version: null,
      },
    };
    await ment(pool, raktaros, [zaras]);
    await osszeallitas(pool);
    const [z] = await esemenyek(String(zaras.sor.id));
    expect(z).toMatchObject({ type: "keszlet.napi_zaras.elkuldve", source: { recordType: "napi_zaras", sequence: 1 } });
    expect(z!.payload).toMatchObject({
      closingId: zaras.sor.id, date: nap, location: { id: ceg.locationId },
      sales: [{ vatRate: 5, net: 200_000, vat: 10_000, gross: 210_000 }, { vatRate: 27, net: 199_999, vat: 54_000, gross: 253_999 }],
      returns: [{ vatRate: 27, net: 33_333, vat: 9_000, gross: 42_333 }],
      saleIds: [k1, k2, k3].map((m) => m.sor.id),
      returnIds: [vissza.sor.id],
      totals: { net: 366_666, vat: 55_000, gross: 421_666 },
    });

    const utolag = mozgas(ceg, termekId, { type: "out", date: nap, quantity: 1, sale_unit_price: 100, unit_cost: 1, vat_rate_percent: 27 });
    await ment(pool, raktaros, [utolag]);
    await osszeallitas(pool);
    const es = await esemenyek(String(zaras.sor.id));
    expect(tipusok(es)).toEqual(["keszlet.napi_zaras.elkuldve@1#1", "keszlet.napi_zaras.modosult@1#2"]);
    expect(es[1]!.payload).toMatchObject({ closingId: zaras.sor.id, movementIds: [utolag.sor.id] });
  });
});

leiras("nem találgat, nem veszít, nem visszhangzik", () => {
  it("hiányzó adatnál nem megy ki, Teendő lesz, és az ugyanarra a rekordra vonatkozó későbbi változás vár; kihagyni csak a fő iroda tud, indoklással", async () => {
    const m = mozgas(ceg, termekId, { type: "out", quantity: 1, vat_rate_percent: 27 }); // nincs eladási ár és ELÁBÉ
    await ment(pool, ceg.felhasznalo, [m]);
    await ment(pool, ceg.felhasznalo, [{ tabla: "movements", sor: { ...m.sor, cancelled: true, cancelled_at: "2026-11-04T08:00:00Z", version: 1 } }]);
    const masik = mozgas(ceg, termekId, { unit_price: 10 });
    await ment(pool, ceg.felhasznalo, [masik, tetel(ceg, termekId, String(masik.sor.id), { unit_price: 10 })]);
    const r = await osszeallitas(pool);
    expect(r).toMatchObject({ hibas: 1, varakozik: 1 });
    expect(await esemenyek(String(m.sor.id))).toEqual([]);
    expect(await esemenyek(String(masik.sor.id))).toHaveLength(1);
    const allapot = await neveben(pool, ceg.felhasznalo, async (db) => (await db.query("SELECT public.integracio_allapot() AS a")).rows[0].a);
    expect(allapot).toMatchObject({ osszekapcsolva: true, osszeallitasra_var: 2, teendok: [expect.objectContaining({ fajta: "OSSZEALLITAS_HIBA", reszletek: expect.stringMatching(/nincs rögzített eladási ára/) })] });

    const hibas = (await pool.query("SELECT id FROM integracio.valtozasok WHERE rekord_id = $1 AND utolso_hiba IS NOT NULL", [m.sor.id])).rows[0].id as number;
    const iroda = await ujCsapattag(pool, ceg, "iroda");
    await expect(neveben(pool, iroda, (db) => db.query("SELECT public.integracio_kihagyas($1, 'x')", [hibas]))).rejects.toThrow(/fő iroda/);
    await expect(neveben(pool, ceg.felhasznalo, (db) => db.query("SELECT public.integracio_kihagyas($1, ' ')", [hibas]))).rejects.toThrow(/miért/);
    await neveben(pool, ceg.felhasznalo, (db) => db.query("SELECT public.integracio_kihagyas($1, 'Régi, ár nélküli eladás; a Könyvelőben kézzel rögzítettük')", [hibas]));
    await osszeallitas(pool);
    // A kihagyott eladás után a visszavonása is kimegy (a Könyvelő ott Teendőt nyit, mert az eladást nem ismeri).
    expect(tipusok(await esemenyek(String(m.sor.id)))).toEqual(["keszlet.mozgas.sztornozva@3#1"]);
    const naplo = await pool.query("SELECT description FROM public.audit_log WHERE company_id = $1 AND entity_type = 'integracio' AND action = 'delete'", [ceg.companyId]);
    expect(naplo.rows[0].description).toMatch(/kihagyva.*kézzel rögzítettük/);
    const teendok = await neveben(pool, ceg.felhasznalo, async (db) => (await db.query("SELECT public.integracio_allapot() AS a")).rows[0].a.teendok);
    expect(teendok).toEqual([]);
  });

  it("a hibás adószámú partner Teendő; csak a fogadó tranzakciójában történt változás hivatkozik a beérkezett eseményre", async () => {
    await ment(pool, ceg.felhasznalo, [szallito(ceg, { name: "Elírt Kft.", tax_number: "1234" })]);
    await osszeallitas(pool);
    const t = await pool.query("SELECT reszletek FROM integracio.teendok WHERE company_id = $1 AND fajta = 'OSSZEALLITAS_HIBA' AND megoldva IS NULL", [ceg.companyId]);
    expect(t.rows[0].reszletek).toMatch(/Elírt Kft.*adószáma nem értelmezhető/);

    const oka = randomUUID();
    const m = mozgas(ceg, termekId, { unit_price: 10, integracio_esemeny_id: oka });
    await ment(pool, ceg.felhasznalo, [m, tetel(ceg, termekId, String(m.sor.id), { unit_price: 10 })]);
    const oka2 = randomUUID();
    const c = await pool.connect();
    await c.query("BEGIN");
    await c.query("SELECT set_config('integracio.oka_esemeny', $1, true)", [oka2]);
    await c.query("UPDATE public.movements SET deleted_at = now() WHERE id = $1", [m.sor.id]);
    await c.query("COMMIT");
    c.release();
    await osszeallitas(pool);
    const es = await esemenyek(String(m.sor.id));
    // A mozgáson tárolt esemény-azonosító önmagában nem visszhang (a jóváhagyás új tény); a fogadó tranzakciójában
    // történt visszavonás viszont igen.
    expect(es.map((e) => e.causedBy)).toEqual([undefined, oka2]);
  });

  it("két összeállító egyszerre sem készít egy változásból két eseményt", async () => {
    const m = mozgas(ceg, termekId, { unit_price: 10 });
    await ment(pool, ceg.felhasznalo, [m, tetel(ceg, termekId, String(m.sor.id), { unit_price: 10 })]);
    await Promise.all([osszeallitas(pool), osszeallitas(pool), osszeallitas(pool)]);
    await osszeallitas(pool);
    expect(await esemenyek(String(m.sor.id))).toHaveLength(1);
  });
});
