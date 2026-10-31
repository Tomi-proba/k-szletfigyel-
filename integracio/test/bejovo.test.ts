// A Könyvelőből érkező események kezelése és a jóváhagyandó mozgások útja (TERV.md F15.4, F15.8), valódi
// PostgreSQL-en: a központ aláírt kérése → jóváhagyandó mozgás → a raktáros jóváhagyása (a valódi
// keszlet_mentes-sel) → esemény a Könyvelőnek a várt és a tényleges mennyiséggel.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INBOUND_PATH, signedHeaders, validateEvent, type EventEnvelope, type InboundResult } from "../esemenyek/src/index.ts";
import { fogado } from "../src/fogado.ts";
import { osszeallitas } from "../src/osszeallito.ts";
import { DB_URL, ment, mozgas, neveben, osszekapcsol, szallito, termek, ujAdatbazis, ujCeg, ujCsapattag, vevo, type Ceg } from "./adatbazis.ts";

const leiras = DB_URL ? describe : describe.skip;
const TITOK = "b".repeat(40);

let pool: pg.Pool;
let server: Server;
let base: string;
let ceg: Ceg;
let raktaros: string;
let ajto: string;
let torolt: string;
let vevoId: string;
let szallitoId: string;

beforeAll(async () => {
  if (!DB_URL) return;
  pool = await ujAdatbazis("bejovo");
  ceg = await ujCeg(pool);
  raktaros = await ujCsapattag(pool, ceg, "raktaros");
  await osszekapcsol(pool, ceg);
  const t1 = termek(ceg, { unit: "db" });
  const t2 = termek(ceg, { name: "Régi kilincs", deleted_at: "2026-10-01T00:00:00Z" });
  const v = vevo(ceg, { tax_number: "11111111-1-11" });
  const sz = szallito(ceg, { name: "Ajtó Kft.", tax_number: "10537914-4-44" });
  ajto = String(t1.sor.id);
  torolt = String(t2.sor.id);
  vevoId = String(v.sor.id);
  szallitoId = String(sz.sor.id);
  await ment(pool, ceg.felhasznalo, [t1, t2, v, sz]);
  await osszeallitas(pool);
  server = createServer(fogado({ pool, titok: TITOK, log: (m, e) => console.error(m, e) }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server?.close(r));
  await pool?.end();
});

async function kuld(event: EventEnvelope): Promise<InboundResult & { code?: string }> {
  expect(validateEvent(event).ok, JSON.stringify(validateEvent(event))).toBe(true);
  const raw = JSON.stringify({ event, targetCompanyRef: ceg.companyId });
  const res = await fetch(base + INBOUND_PATH, { method: "POST", headers: { "content-type": "application/json", ...signedHeaders(TITOK, "kozpont", "POST", INBOUND_PATH, raw) }, body: raw });
  return (await res.json()) as InboundResult;
}

const konyvelo = (type: string, version: number, recordType: string, recordId: string, payload: Record<string, unknown>, sequence = 1): EventEnvelope => ({
  id: randomUUID(),
  type,
  version,
  source: { module: "konyvelo", companyRef: randomUUID(), recordType, recordId, sequence },
  occurredAt: "2026-11-02T08:00:00Z",
  payload,
});

type Sor = { productId: string; productName?: string; quantity: number; unit?: string | null; netAmount: number; vatRate?: number | null };
const bizonylat = (docType: "SZSZ" | "VSZ" | "HELY", sorok: Sor[] | null, over: Record<string, unknown> = {}) => {
  const documentId = randomUUID();
  return konyvelo("konyvelo.bizonylat.konyvelve", 2, "bizonylat", documentId, {
    documentId,
    serialNumber: `${docType}-2026-${String(Math.floor(Math.random() * 99999)).padStart(5, "0")}`,
    docType,
    accountingDate: "2026-11-02",
    issueDate: "2026-11-02",
    fulfillmentDate: "2026-11-01",
    dueDate: null,
    externalNumber: `K-${documentId.slice(0, 6)}`,
    description: null,
    currency: "HUF",
    fxAmount: null,
    fxRate: null,
    partner: docType === "VSZ" ? { name: "Vevő Bt.", taxNumber: "11111111-1-11" } : { name: "Ajtó Kft.", taxNumber: "10537914-4-44" },
    corrects: null,
    reverses: null,
    lines: [{ accountNumber: "261", side: "D", amount: 1 }, { accountNumber: "454", side: "C", amount: 1 }],
    ...(sorok
      ? {
          stockLines: sorok.map((s) => {
            const vatRate = s.vatRate === undefined ? 27 : s.vatRate;
            return { productId: s.productId, productName: s.productName ?? "Bejárati ajtó", quantity: s.quantity, unit: s.unit === undefined ? "db" : s.unit, netAmount: s.netAmount, vatRate, vatAmount: vatRate ? Math.round((s.netAmount * vatRate) / 100) : 0 };
          }),
        }
      : {}),
    ...over,
  });
};
const docOf = (e: EventEnvelope) => e.payload as { documentId: string; serialNumber: string };

const mozgasokDb = async (documentId: string) =>
  (await pool.query("SELECT *, date::text AS date FROM public.movements WHERE integracio_dokumentum_id = $1 ORDER BY created_at, quantity DESC, id", [documentId])).rows as Array<Record<string, unknown>>;

/** A raktáros jóváhagyása a valódi keszlet_mentes-sel (ahogy a böngésző menti a store változását). */
async function jovahagy(m: Record<string, unknown>, over: Record<string, unknown>) {
  await ment(pool, raktaros, [{ tabla: "movements", sor: { id: m.id, company_id: ceg.companyId, product_id: m.product_id, location_id: m.location_id, approval_status: "approved", approved_at: "2026-11-03T08:00:00Z", version: m.version, ...over } }]);
}

async function esemenyek(recordId: string): Promise<EventEnvelope[]> {
  await osszeallitas(pool);
  const r = await pool.query<{ envelope: EventEnvelope }>(
    `SELECT o.envelope FROM integracio.valtozasok v JOIN integracio.integration_outbox o ON o.id = v.esemeny_id
      WHERE v.company_id = $1 AND o.envelope -> 'source' ->> 'recordId' = $2 ORDER BY v.id`,
    [ceg.companyId, recordId],
  );
  for (const e of r.rows) expect(validateEvent(e.envelope).ok).toBe(true);
  return r.rows.map((x) => x.envelope);
}
const teendo = async (kulcs: string) => (await pool.query("SELECT * FROM integracio.teendok WHERE company_id = $1 AND kulcs = $2 AND megoldva IS NULL", [ceg.companyId, kulcs])).rows[0];

leiras("szállítói számla → jóváhagyandó beérkezés", () => {
  it("termékenként egy beérkezésre váró mozgás a számla árával; a készlet nem változik; pontosan egyszer", async () => {
    const e = bizonylat("SZSZ", [{ productId: ajto, quantity: 10, netAmount: 1_000_000 }]);
    const r = await kuld(e);
    expect(r).toMatchObject({ outcome: "APPLIED", target: { recordType: "mozgas", url: "/mozgasnaplo" } });
    expect(await kuld(e)).toMatchObject({ outcome: "DUPLICATE" });
    // Ugyanarról a bizonylatról egy másik esemény sem hoz létre újabb mozgást.
    expect(await kuld({ ...e, id: randomUUID() })).toMatchObject({ outcome: "APPLIED", target: r.target });
    const [m] = await mozgasokDb(docOf(e).documentId);
    expect(m).toMatchObject({
      type: "in", quantity: "10", ordered_quantity: "10", approval_status: "pending", unit_price: "1000", vat_rate_percent: "27",
      integracio_esemeny_id: e.id, integracio_forras: docOf(e).serialNumber, date: "2026-11-01",
    });
    expect((await pool.query("SELECT current_stock FROM public.products WHERE id = $1", [ajto])).rows[0].current_stock).toBe("0");
    // A függő mozgásból nem lesz esemény.
    expect(await esemenyek(String(m!.id))).toEqual([]);
  });

  it("nem találgat: ismeretlen, törölt termék vagy eltérő mértékegység → nincs mozgás, Teendő az okkal; termék nélküli számla → Teendő", async () => {
    const e = bizonylat("SZSZ", [
      { productId: ajto, quantity: 1, netAmount: 100 },
      { productId: torolt, productName: "Régi kilincs", quantity: 1, netAmount: 100 },
      { productId: ajto, quantity: 1, unit: "m2", netAmount: 100 },
      { productId: randomUUID(), productName: "Ismeretlen", quantity: 1, netAmount: 100 },
    ]);
    const r = await kuld(e);
    expect(r).toMatchObject({ outcome: "TODO", todo: { key: `bizonylat:${docOf(e).documentId}` } });
    expect(r.todo!.detail).toMatch(/törölve.*\n.*mértékegység eltér.*\n.*Ismeretlen.*nincs ilyen termék/s);
    expect(await mozgasokDb(docOf(e).documentId)).toEqual([]);
    expect(await teendo(`bizonylat:${docOf(e).documentId}`)).toMatchObject({ hub_kulcs: `bizonylat:${docOf(e).documentId}` });

    const ures = bizonylat("SZSZ", null);
    expect(await kuld(ures)).toMatchObject({ outcome: "TODO", todo: { key: `termek:${docOf(ures).documentId}` } });
    // Más bizonylattípus (pl. bank) a Készletet nem érinti.
    expect(await kuld(bizonylat("SZSZ", null, { docType: "BANK" }))).toEqual({ outcome: "APPLIED" });
  });

  it("eltérő mennyiséggel jóváhagyva: a Könyvelőbe a várt és a tényleges mennyiség megy, megjegyzéssel, visszhang-jelölés nélkül", async () => {
    const e = bizonylat("SZSZ", [{ productId: ajto, quantity: 10, netAmount: 1_000_000 }]);
    await kuld(e);
    const [m] = await mozgasokDb(docOf(e).documentId);
    await jovahagy(m!, { quantity: 8, discrepancy_note: "2 db sérülten érkezett" });
    const es = await esemenyek(String(m!.id));
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({
      type: "keszlet.mozgas.jovahagyva",
      source: { recordType: "konyvelo_mozgas", recordId: m!.id, sequence: 1 },
      payload: {
        movementId: m!.id, purpose: "RECEIPT", sourceDocument: { documentId: docOf(e).documentId, serialNumber: docOf(e).serialNumber, eventId: e.id },
        originalMovementId: null, expectedQuantity: 10, actualQuantity: 8, note: "2 db sérülten érkezett", costOfGoods: null, productId: ajto, unit: "db",
      },
    });
    // A Könyvelőnek el kell jutnia: nem hivatkozik a beérkezett eseményre (a központ különben nem adná át).
    expect(es[0]!.causedBy).toBeUndefined();
  });
});

leiras("vevőszámla → jóváhagyandó kiadás", () => {
  it("a vevő pontos adószám-egyezéssel; jóváhagyáskor ELÁBÉ megy a Könyvelőnek; a napi zárásba nem kerül készpénzként", async () => {
    const e = bizonylat("VSZ", [{ productId: ajto, quantity: 2, netAmount: 300_000 }]);
    await kuld(e);
    const [m] = await mozgasokDb(docOf(e).documentId);
    expect(m).toMatchObject({ type: "out", customer_id: vevoId, sale_unit_price: "1500", approval_status: "pending" });
    await jovahagy(m!, { unit_cost: 812.5, sale_status: "pending" });
    expect((await esemenyek(String(m!.id)))[0]).toMatchObject({ payload: { purpose: "ISSUE", expectedQuantity: 2, actualQuantity: 2, costOfGoods: 162_500 } });

    // Vevő nélkül sem lesz belőle készpénzes eladás (a Könyvelőben számla van róla).
    const e2 = bizonylat("VSZ", [{ productId: ajto, quantity: 1, netAmount: 100_000 }], { partner: { name: "Ismeretlen Kft.", taxNumber: "22222222-2-22" } });
    await kuld(e2);
    const [m2] = await mozgasokDb(docOf(e2).documentId);
    expect(m2).toMatchObject({ customer_id: null, note: expect.stringContaining("vevő: Ismeretlen Kft.") });
    await jovahagy(m2!, { unit_cost: 800 });
    const zaras = {
      tabla: "daily_closings",
      sor: { id: randomUUID(), company_id: ceg.companyId, location_id: ceg.locationId, date: "2026-11-01", submitted_at: "2026-11-01T18:00:00Z", status: "submitted", in_count: 0, out_count: 1, product_breakdown: [], movement_ids: [String(m2!.id)], created_at: "2026-11-01T18:00:00Z", version: null },
    };
    await ment(pool, raktaros, [zaras]);
    expect((await esemenyek(String(zaras.sor.id)))[0]!.payload).toMatchObject({ sales: [], saleIds: [], totals: { net: 0, vat: 0, gross: 0 } });
  });

  it("„nem ment ki”: az elutasítás is eljut, 0 tényleges mennyiséggel", async () => {
    const e = bizonylat("VSZ", [{ productId: ajto, quantity: 1, netAmount: 100_000 }]);
    await kuld(e);
    const [m] = await mozgasokDb(docOf(e).documentId);
    await ment(pool, raktaros, [{ tabla: "movements", sor: { id: m!.id, company_id: ceg.companyId, approval_status: "rejected", rejected_at: "2026-11-03T08:00:00Z", reject_reason: "A vevő nem vitte el", version: m!.version } }]);
    expect((await esemenyek(String(m!.id)))[0]).toMatchObject({ payload: { purpose: "ISSUE", expectedQuantity: 1, actualQuantity: 0, note: "A vevő nem vitte el", costOfGoods: 0 } });
  });
});

leiras("helyesbítő és sztornó", () => {
  it("helyesbítő a vevőszámlához: jóváhagyandó visszavétel az eladáskori költségen, legfeljebb az eladott mennyiségig; az eredeti rekordján megy", async () => {
    const vsz = bizonylat("VSZ", [{ productId: ajto, quantity: 3, netAmount: 450_000 }]);
    await kuld(vsz);
    const [eladas] = await mozgasokDb(docOf(vsz).documentId);
    await jovahagy(eladas!, { unit_cost: 700 });

    const tul = bizonylat("HELY", [{ productId: ajto, quantity: 4, netAmount: 600_000 }], { corrects: { documentId: docOf(vsz).documentId, serialNumber: docOf(vsz).serialNumber } });
    expect(await kuld(tul)).toMatchObject({ outcome: "TODO", todo: { detail: expect.stringMatching(/legfeljebb 3/) } });

    const hely = bizonylat("HELY", [{ productId: ajto, quantity: 2, netAmount: 300_000 }], { corrects: { documentId: docOf(vsz).documentId, serialNumber: docOf(vsz).serialNumber } });
    await kuld(hely);
    const [vissza] = await mozgasokDb(docOf(hely).documentId);
    expect(vissza).toMatchObject({ type: "in", return_of_movement_id: eladas!.id, unit_price: "700", quantity: "2", approval_status: "pending" });
    await jovahagy(vissza!, {});
    const es = await esemenyek(String(eladas!.id));
    expect(es.map((x) => `${x.payload.purpose}#${x.source.sequence}`)).toEqual(["ISSUE#1", "CUSTOMER_RETURN#2"]);
    expect(es[1]!.payload).toMatchObject({ movementId: vissza!.id, originalMovementId: eladas!.id, actualQuantity: 2, costOfGoods: 140_000, sourceDocument: { documentId: docOf(hely).documentId } });

    // A már visszavett mennyiség beszámít: újabb 2 db már nem vehető vissza.
    const megint = bizonylat("HELY", [{ productId: ajto, quantity: 2, netAmount: 300_000 }], { corrects: { documentId: docOf(vsz).documentId, serialNumber: docOf(vsz).serialNumber } });
    expect(await kuld(megint)).toMatchObject({ outcome: "TODO", todo: { detail: expect.stringMatching(/legfeljebb 1/) } });
  });

  it("sztornó a Könyvelőben: a függő mozgás magától visszavonva; a jóváhagyotthoz jóváhagyandó visszavétel, amelyből esemény lesz", async () => {
    const e = bizonylat("SZSZ", [
      { productId: ajto, quantity: 5, netAmount: 500_000 },
      { productId: ajto, quantity: 1, netAmount: 100_000 },
    ]);
    await kuld(e);
    const [jo, fuggo] = await mozgasokDb(docOf(e).documentId);
    await jovahagy(jo!, {});
    const szt = konyvelo("konyvelo.bizonylat.sztornozva", 1, "bizonylat", docOf(e).documentId, {
      documentId: docOf(e).documentId, serialNumber: docOf(e).serialNumber, reversalDocumentId: randomUUID(), reversalSerialNumber: "SZT-2026-00007", accountingDate: "2026-11-05",
    }, 2);
    expect(await kuld(szt)).toMatchObject({ outcome: "APPLIED", target: { label: "1 jóváhagyásra váró mozgás visszavonva, 1 visszavétel jóváhagyásra vár" } });
    expect(await kuld({ ...szt, id: randomUUID() })).toMatchObject({ outcome: "APPLIED" });
    const most = await mozgasokDb(docOf(e).documentId);
    expect(most.find((m) => m.id === fuggo!.id)).toMatchObject({ deleted_at: expect.any(Date) });
    const korrekciok = most.filter((m) => m.corrects_movement_id === jo!.id);
    expect(korrekciok).toHaveLength(1);
    expect(korrekciok[0]).toMatchObject({ type: "out", quantity: "5", approval_status: "pending", integracio_forras: "SZT-2026-00007", date: "2026-11-05" });
    // A visszavont függő mozgásból nem lesz esemény.
    expect(await esemenyek(String(fuggo!.id))).toEqual([]);

    await jovahagy(korrekciok[0]!, { unit_cost: 1000 });
    const es = await esemenyek(String(jo!.id));
    expect(es.map((x) => `${x.payload.purpose}#${x.source.sequence}`)).toEqual(["RECEIPT#1", "REVERSAL#2"]);
    expect(es[1]!.payload).toMatchObject({ movementId: korrekciok[0]!.id, originalMovementId: jo!.id, expectedQuantity: 5, actualQuantity: 5, costOfGoods: null });
    expect(es[1]!.causedBy).toBeUndefined();
  });

  it("a Könyvelő által nem ismert bizonylat sztornója semmit nem csinál", async () => {
    expect(await kuld(konyvelo("konyvelo.bizonylat.sztornozva", 1, "bizonylat", "X", { documentId: randomUUID(), serialNumber: "VSZ-1", reversalDocumentId: "r", reversalSerialNumber: "SZT-1", accountingDate: "2026-11-05" }))).toEqual({ outcome: "APPLIED" });
  });
});

leiras("kiegyenlítés, időszak, partner", () => {
  it("kiegyenlítés: a Könyvelő követi a fizetést (teljesen kiegyenlítve = fizetve); bontásnál vissza; ismeretlen tétel Teendő", async () => {
    const e = bizonylat("SZSZ", [{ productId: ajto, quantity: 1, netAmount: 100_000 }]);
    await kuld(e);
    const [m] = await mozgasokDb(docOf(e).documentId);
    await jovahagy(m!, {});
    await pool.query("INSERT INTO public.purchase_lots (id, company_id, product_id, movement_id, date, quantity, remaining_quantity, unit_price) VALUES ($1, $2, $3, $4, '2026-11-01', 1, 1, 1000)", [randomUUID(), ceg.companyId, ajto, m!.id]);
    const forras = [{ module: "keszlet", recordType: "konyvelo_mozgas", recordId: String(m!.id) }];
    const s = { settlementId: "S1", documentId: "B1", settledDocumentId: docOf(e).documentId, amount: 50_000, date: "2026-11-10", settledSources: forras };
    await kuld(konyvelo("konyvelo.kiegyenlites.rogzitve", 3, "kiegyenlites", "S1", { ...s, itemOpenAfter: 77_000 }));
    const lot = async () => (await pool.query("SELECT is_paid, paid_date::text, fizetes_konyvelobol FROM public.purchase_lots WHERE movement_id = $1", [m!.id])).rows[0];
    expect(await lot()).toEqual({ is_paid: false, paid_date: null, fizetes_konyvelobol: true });
    await kuld(konyvelo("konyvelo.kiegyenlites.rogzitve", 3, "kiegyenlites", "S2", { ...s, settlementId: "S2", itemOpenAfter: 0 }));
    expect(await lot()).toEqual({ is_paid: true, paid_date: "2026-11-10", fizetes_konyvelobol: true });
    const { date: _d, ...bontas } = s;
    await kuld(konyvelo("konyvelo.kiegyenlites.bontva", 2, "kiegyenlites", "S2", { ...bontas, settlementId: "S2", reason: "MANUAL", itemOpenAfter: 50_000 }, 2));
    expect(await lot()).toMatchObject({ is_paid: false });
    // Sztornó miatti bontásnál a fizetési állapothoz nem nyúl.
    await kuld(konyvelo("konyvelo.kiegyenlites.bontva", 2, "kiegyenlites", "S1", { ...bontas, settlementId: "S1", reason: "REVERSAL", itemOpenAfter: 0 }, 2));
    expect(await lot()).toMatchObject({ is_paid: false });

    const r = await kuld(konyvelo("konyvelo.kiegyenlites.rogzitve", 3, "kiegyenlites", "S3", { ...s, settlementId: "S3", itemOpenAfter: 0, settledSources: [{ module: "keszlet", recordType: "eladas", recordId: randomUUID() }] }));
    expect(r).toMatchObject({ outcome: "TODO", todo: { key: "kiegyenlites:S3" } });
  });

  it("időszakzárás: a Készlet nyilvántartja (minden szerepkör látja), feloldáskor törli", async () => {
    await kuld(konyvelo("konyvelo.idoszak.lezarva", 1, "idoszak", "I1", { kind: "PERIOD", startDate: "2026-10-01", endDate: "2026-10-31" }));
    const lista = () => neveben(pool, raktaros, async (db) => (await db.query("SELECT public.integracio_lezart_idoszakok() AS l")).rows[0].l);
    expect(await lista()).toEqual([{ fajta: "PERIOD", kezdet: "2026-10-01", veg: "2026-10-31" }]);
    await kuld(konyvelo("konyvelo.idoszak.feloldva", 1, "idoszak", "I1", { kind: "PERIOD", startDate: "2026-10-01", endDate: "2026-10-31" }, 2));
    expect(await lista()).toEqual([]);
  });

  it("beküldött áfabevallás (eÁFA, I5): az időszak bekerül, a felület figyelmeztet belőle (nem tilt)", async () => {
    const e = { ...konyvelo("eafa.bevallas.bekuldve", 1, "bevallas_idoszak", "2026-09-01_2026-09-30", {
      declarationId: "d1", periodStart: "2026-09-01", periodEnd: "2026-09-30", frequency: "MONTHLY", kind: "ORIGINAL", environment: "TEST", submittedAt: "2026-10-12T08:00:00Z",
    }) };
    e.source = { ...e.source, module: "eafa" };
    expect(await kuld(e)).toMatchObject({ outcome: "APPLIED" });
    const lista = await neveben(pool, raktaros, async (db) => (await db.query("SELECT public.integracio_lezart_idoszakok() AS l")).rows[0].l);
    expect(lista).toEqual([{ fajta: "AFA_BEKULDVE", kezdet: "2026-09-01", veg: "2026-09-30" }]);
  });

  it("partner: csak pontos adószám-egyezésnél frissíti a nevet (naplózva, a Könyvelő felé visszhang nélkül); egyébként Teendő", async () => {
    const e = konyvelo("torzs.partner.valtozott", 1, "partner", "P1", { partner: { name: "Ajtó és Ablak Kft.", taxNumber: "10537914-4-44" }, anonymized: false });
    expect(await kuld(e)).toMatchObject({ outcome: "APPLIED", target: { recordType: "partner", recordId: szallitoId } });
    expect((await pool.query("SELECT name FROM public.suppliers WHERE id = $1", [szallitoId])).rows[0].name).toBe("Ajtó és Ablak Kft.");
    const valt = await esemenyek(`suppliers:${szallitoId}`);
    expect(valt.at(-1)).toMatchObject({ type: "torzs.partner.valtozott", causedBy: e.id });
    expect((await pool.query("SELECT description FROM public.audit_log WHERE entity_id = $1 ORDER BY event_timestamp DESC LIMIT 1", [szallitoId])).rows[0].description).toMatch(/Könyvelőből/);

    expect(await kuld(konyvelo("torzs.partner.valtozott", 1, "partner", "P2", { partner: { name: "Új Kft.", taxNumber: "33333333-3-33" }, anonymized: false }))).toMatchObject({ outcome: "TODO" });
    expect(await kuld(konyvelo("torzs.partner.valtozott", 1, "partner", "P3", { partner: { name: "Ajtó és Ablak Kft.", taxNumber: "10537914-4-44" }, anonymized: true }))).toMatchObject({ outcome: "TODO" });
  });
});

leiras("kézi mozgás védelme", () => {
  it("a Könyvelő sztornója kézzel rögzített mozgáshoz nem nyúl", async () => {
    const kezi = mozgas(ceg, ajto, { unit_price: 10 });
    await ment(pool, ceg.felhasznalo, [kezi]);
    // Még ha valaki ugyanazt a bizonylat-azonosítót adná is meg, a kézi mozgásnak nincs integrációs forrása.
    expect(await kuld(konyvelo("konyvelo.bizonylat.sztornozva", 1, "bizonylat", "Y", { documentId: String(kezi.sor.id), serialNumber: "SZSZ-1", reversalDocumentId: "r", reversalSerialNumber: "SZT-2", accountingDate: "2026-11-05" }))).toEqual({ outcome: "APPLIED" });
    expect((await pool.query("SELECT deleted_at FROM public.movements WHERE id = $1", [kezi.sor.id])).rows[0].deleted_at).toBeNull();
  });
});
