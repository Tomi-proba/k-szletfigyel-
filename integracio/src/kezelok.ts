import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { InboundDelivery, InboundResult } from "../esemenyek/src/index.ts";
import { teendoNyitas } from "./teendok.ts";

/**
 * A beérkező események kezelői (TERV.md F15.3–F15.4). A kezelő a kapott kliensen, a bejövő tábla
 * bejegyzésével EGY tranzakcióban dolgozik (applyOnce), így minden esemény pontosan egyszer hat. Amit itt
 * a Készlet tábláiban változtatunk, azt a trigger a beérkezett eseményhez köti (visszhang tiltása).
 *
 * Elvek:
 * - A készlet magától soha nem változik: a Könyvelő számlájából csak JÓVÁHAGYANDÓ mozgás lesz, amelyet a
 *   raktáros hagy jóvá (a tényleges mennyiséggel).
 * - Nem találgat: ha a termék nincs meg, törölt, a mértékegység nem egyezik, vagy nem egyértelmű, melyik
 *   mozgásról van szó, nincs mozgás, csak Teendő.
 * - Kézzel rögzített mozgáshoz soha nem nyúl.
 * - Ismeretlen típusra vagy verzióra végleges elutasítás (422): a központban „Átadási hiba” Teendő lesz,
 *   és a Készlet frissítése után újraküldhető.
 */

export type Kezelo = (client: pg.PoolClient, d: InboundDelivery) => Promise<InboundResult>;
export type Kezelok = Record<string, Kezelo>;

export class FogadoHiba extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Sor = Record<string, unknown>;
type StockLine = { productId: string; productName: string; quantity: number; unit: string | null; netAmount: number; vatRate: number | null; vatAmount: number };
type Bizonylat = {
  documentId: string;
  serialNumber: string;
  docType: string;
  accountingDate: string;
  fulfillmentDate: string | null;
  externalNumber: string | null;
  partner: { name: string; taxNumber?: string } | null;
  corrects: { documentId: string; serialNumber: string } | null;
  stockLines?: StockLine[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const szamjegyek = (t: unknown) => String(t ?? "").replace(/\D/g, "");
const egyseg = (u: unknown) => String(u ?? "").trim().toLowerCase().replace(/[\s.²]/g, (c) => (c === "²" ? "2" : ""));
const hatalyos = (m: Sor) => !m.deleted_at && (m.approval_status === null || m.approval_status === "approved");

/** Teendő a Készletben és a központban is (a központ a kulcs alapján mutatja és zárja le). */
async function teendo(client: pg.PoolClient, d: InboundDelivery, kulcs: string, cim: string, reszletek?: string, url?: string): Promise<InboundResult> {
  await teendoNyitas(client, d.targetCompanyRef, { kulcs, fajta: "BEERKEZO", cim, reszletek: reszletek ?? null, hubKulcs: kulcs });
  return { outcome: "TODO", todo: { key: kulcs, title: cim.slice(0, 300), ...(reszletek ? { detail: reszletek.slice(0, 2000) } : {}), ...(url ? { url } : {}) } };
}

async function vevoAdoszamra(client: pg.PoolClient, ceg: string, ado: string | undefined): Promise<string | null> {
  if (!ado) return null;
  const r = await client.query<{ id: string }>(
    "SELECT id FROM public.customers WHERE company_id = $1 AND deleted_at IS NULL AND regexp_replace(coalesce(tax_number, ''), '\\D', '', 'g') = $2",
    [ceg, szamjegyek(ado)],
  );
  // Csak pontos, egyértelmű egyezés; egyébként vevő nélkül (a Könyvelőből jött mozgás akkor sem készpénzes).
  return r.rowCount === 1 ? r.rows[0]!.id : null;
}

type UjMozgas = {
  productId: string;
  locationId: string;
  date: string;
  type: "in" | "out";
  quantity: number;
  note: string;
  unitPrice?: number | null;
  unitCost?: number | null;
  saleUnitPrice?: number | null;
  vatRate?: number | null;
  customerId?: string | null;
  invoiceNumber?: string | null;
  returnOf?: string | null;
  corrects?: string | null;
  dokumentum: string;
  forras: string;
};

async function jovahagyandoMozgas(client: pg.PoolClient, d: InboundDelivery, m: UjMozgas): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.movements (id, company_id, product_id, location_id, date, type, quantity, ordered_quantity, note, created_at,
       unit_price, unit_cost, sale_unit_price, vat_rate_percent, customer_id, invoice_number, return_of_movement_id, corrects_movement_id,
       approval_status, integracio_esemeny_id, integracio_dokumentum_id, integracio_forras, integracio_forras_utvonal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, now(), $9, $10, $11, $12, $13, $14, $15, $16, 'pending', $17, $18, $19, $20)`,
    [
      id, d.targetCompanyRef, m.productId, m.locationId, m.date, m.type, m.quantity, m.note.slice(0, 500),
      m.unitPrice ?? null, m.unitCost ?? null, m.saleUnitPrice ?? null, m.vatRate ?? null, m.customerId ?? null, m.invoiceNumber ?? null,
      m.returnOf ?? null, m.corrects ?? null, d.event.id, m.dokumentum, m.forras,
      // „Honnan jött?” (F18): a forrásbizonylat útvonala a Könyvelő felületén, ha a forrás megadta.
      d.event.source.module === "konyvelo" && d.event.source.url && /^(\/|#\/)/.test(d.event.source.url) ? d.event.source.url : null,
    ],
  );
  return id;
}

const mozgasCel = (ids: string[], cimke: string): InboundResult["target"] => ({ recordType: "mozgas", recordId: ids[0]!, url: "/mozgasnaplo", label: `${cimke}: ${ids.length} jóváhagyandó mozgás` });

// ---------- Könyvelt bizonylat (KK3, F15.4, F15.8) ----------

async function bizonylatKonyvelve(client: pg.PoolClient, d: InboundDelivery): Promise<InboundResult> {
  const p = d.event.payload as unknown as Bizonylat;
  const ceg = d.targetCompanyRef;
  const helyesbito = p.docType === "HELY" && p.corrects;
  if (p.docType !== "SZSZ" && p.docType !== "VSZ" && !helyesbito) return { outcome: "APPLIED" };
  const sorok = p.stockLines ?? [];
  const forras = p.serialNumber;

  // Ugyanabból a bizonylatból kétszer nem lesz mozgás (pl. a központ adatainak helyreállítása után).
  const megvan = await client.query<{ id: string }>("SELECT id FROM public.movements WHERE company_id = $1 AND integracio_dokumentum_id = $2 ORDER BY created_at, id", [ceg, p.documentId]);
  if (megvan.rowCount) return { outcome: "APPLIED", target: mozgasCel(megvan.rows.map((r) => r.id), forras) };

  if (!sorok.length) {
    return teendo(
      client, d, `termek:${p.documentId}`,
      `A Könyvelőben könyvelt ${forras} ${helyesbito ? "helyesbítő számlához" : "számlához"} nem adtak meg terméket: ha árut érint, a mozgást kézzel rögzítse.`,
      helyesbito ? "Termék nélküli helyesbítőből a Készlet nem tudja, változott-e a mennyiség (pl. csak árengedmény); nem találgatunk." : undefined,
      "/mozgasnaplo",
    );
  }

  // A termékek ellenőrzése: hiánynál semmi nem lesz, csak Teendő (nem rögzítünk félig).
  const ids = sorok.map((s) => s.productId).filter((x) => UUID.test(x));
  const termekek = new Map(
    (await client.query<Sor>("SELECT id, name, unit, location_id, deleted_at FROM public.products WHERE company_id = $1 AND id = ANY($2::uuid[])", [ceg, ids])).rows.map((t) => [String(t.id), t]),
  );
  const gondok: string[] = [];
  for (const s of sorok) {
    const t = termekek.get(s.productId);
    if (!t) gondok.push(`„${s.productName}”: nincs ilyen termék a Készletben.`);
    else if (t.deleted_at) gondok.push(`„${String(t.name)}”: a termék törölve van a Készletben.`);
    else if (s.unit && t.unit && egyseg(s.unit) !== egyseg(t.unit)) gondok.push(`„${String(t.name)}”: a mértékegység eltér (számla: ${s.unit}, Készlet: ${String(t.unit)}).`);
    if (!(s.quantity > 0)) gondok.push(`„${s.productName}”: a mennyiség nem pozitív.`);
  }
  if (gondok.length) {
    return teendo(client, d, `bizonylat:${p.documentId}`, `A Könyvelőben könyvelt ${forras} tételeiből nem lett Készlet-mozgás: rögzítse kézzel, vagy javítsa a terméket.`, gondok.join("\n"), "/mozgasnaplo");
  }

  if (!helyesbito) {
    const beerkezes = p.docType === "SZSZ";
    const vevo = beerkezes ? null : await vevoAdoszamra(client, ceg, p.partner?.taxNumber);
    const letrejott: string[] = [];
    for (const s of sorok) {
      const t = termekek.get(s.productId)!;
      const ar = s.netAmount / 100 / s.quantity;
      letrejott.push(
        await jovahagyandoMozgas(client, d, {
          productId: s.productId,
          locationId: String(t.location_id),
          date: p.fulfillmentDate ?? p.accountingDate,
          type: beerkezes ? "in" : "out",
          quantity: s.quantity,
          note: `${beerkezes ? "Beérkezésre vár" : "Kiadásra vár"} – Könyvelő, ${forras}${!beerkezes && p.partner && !vevo ? ` (vevő: ${p.partner.name})` : ""}`,
          ...(beerkezes ? { unitPrice: ar } : { saleUnitPrice: ar, customerId: vevo }),
          vatRate: s.vatRate,
          invoiceNumber: p.externalNumber,
          dokumentum: p.documentId,
          forras,
        }),
      );
    }
    return { outcome: "APPLIED", target: mozgasCel(letrejott, forras) };
  }

  // Helyesbítő (F15.8): a termék-sorok a visszáru mennyiségét jelentik; az eredeti számla mozgásaihoz kötve.
  const eredetiek = (
    await client.query<Sor>(
      "SELECT * FROM public.movements WHERE company_id = $1 AND integracio_dokumentum_id = $2 AND return_of_movement_id IS NULL AND corrects_movement_id IS NULL ORDER BY created_at, id",
      [ceg, p.corrects!.documentId],
    )
  ).rows;
  if (!eredetiek.length) {
    return teendo(client, d, `bizonylat:${p.documentId}`, `A ${forras} helyesbítő számla eredetijéből (${p.corrects!.serialNumber}) nem lett Készlet-mozgás: ha árut érint, a visszárut kézzel rögzítse.`, undefined, "/mozgasnaplo");
  }
  const tervek: Array<{ s: StockLine; e: Sor }> = [];
  for (const s of sorok) {
    const illo = eredetiek.filter((e) => String(e.product_id) === s.productId);
    if (illo.length !== 1) {
      gondok.push(`„${s.productName}”: ${illo.length ? "az eredeti számlán többször is szerepel, nem egyértelmű, melyikhez tartozik" : "nem szerepelt az eredeti számlán"}.`);
      continue;
    }
    const e = illo[0]!;
    if (!hatalyos(e) || e.cancelled) {
      gondok.push(`„${s.productName}”: az eredeti mozgás ${e.approval_status === "pending" ? "még jóváhagyásra vár (ott javítsa a mennyiséget)" : "nem érvényes (elutasítva, törölve vagy visszavonva)"}.`);
      continue;
    }
    const vissza = await client.query<{ q: string }>(
      "SELECT coalesce(sum(coalesce(ordered_quantity, quantity)), 0)::text AS q FROM public.movements WHERE return_of_movement_id = $1 AND deleted_at IS NULL AND approval_status IS DISTINCT FROM 'rejected'",
      [e.id],
    );
    const maradt = Number(e.quantity) - Number(vissza.rows[0]!.q);
    if (s.quantity > maradt + 1e-9) gondok.push(`„${s.productName}”: legfeljebb ${maradt} vehető vissza (eredetileg ${String(e.quantity)}).`);
    else tervek.push({ s, e });
  }
  if (gondok.length) {
    return teendo(client, d, `bizonylat:${p.documentId}`, `A ${forras} helyesbítő számlából nem lett visszáru a Készletben: nézze át.`, gondok.join("\n"), "/mozgasnaplo");
  }
  const letrejott: string[] = [];
  for (const { s, e } of tervek) {
    const vevoi = e.type === "out";
    letrejott.push(
      await jovahagyandoMozgas(client, d, {
        productId: s.productId,
        locationId: String(e.location_id),
        date: p.fulfillmentDate ?? p.accountingDate,
        type: vevoi ? "in" : "out",
        quantity: s.quantity,
        note: `${vevoi ? "Visszavételre vár" : "Visszaküldésre vár"} – Könyvelő, ${forras} (helyesbíti: ${p.corrects!.serialNumber})`,
        // Vevői visszavételnél az eladáskori egységköltségen kerül vissza a készletbe.
        ...(vevoi ? { unitPrice: e.unit_cost === null ? null : Number(e.unit_cost), customerId: (e.customer_id as string | null) ?? null } : {}),
        vatRate: s.vatRate,
        invoiceNumber: p.externalNumber,
        returnOf: String(e.id),
        dokumentum: p.documentId,
        forras,
      }),
    );
  }
  return { outcome: "APPLIED", target: mozgasCel(letrejott, forras) };
}

// ---------- Sztornó a Könyvelőben (F15.4) ----------

async function bizonylatSztornozva(client: pg.PoolClient, d: InboundDelivery): Promise<InboundResult> {
  const p = d.event.payload as unknown as { documentId: string; serialNumber: string; reversalDocumentId: string; reversalSerialNumber: string; accountingDate: string };
  const ceg = d.targetCompanyRef;
  const mozgasok = (await client.query<Sor>("SELECT * FROM public.movements WHERE company_id = $1 AND integracio_dokumentum_id = $2 AND corrects_movement_id IS NULL ORDER BY created_at, id", [ceg, p.documentId])).rows;
  if (!mozgasok.length) return { outcome: "APPLIED" };
  const visszavonva: string[] = [];
  const visszavetel: string[] = [];
  for (const m of mozgasok) {
    if (m.deleted_at || m.approval_status === "rejected" || m.cancelled) continue;
    if (m.approval_status === "pending") {
      // Még nem hatott a készletre: magától visszavonható.
      await client.query("UPDATE public.movements SET deleted_at = now(), reject_reason = $2 WHERE id = $1", [m.id, `A Könyvelőben sztornózták (${p.reversalSerialNumber})`]);
      visszavonva.push(String(m.id));
      continue;
    }
    // Már jóváhagyott: jóváhagyandó visszavétel (a raktáros hagyja jóvá a tényleges mennyiséggel).
    const van = await client.query("SELECT 1 FROM public.movements WHERE corrects_movement_id = $1 AND deleted_at IS NULL AND approval_status IS DISTINCT FROM 'rejected'", [m.id]);
    if (van.rowCount) continue;
    const ki = m.type === "in";
    visszavetel.push(
      await jovahagyandoMozgas(client, d, {
        productId: String(m.product_id),
        locationId: String(m.location_id),
        date: p.accountingDate,
        type: ki ? "out" : "in",
        quantity: Number(m.quantity),
        note: `${ki ? "Visszaküldésre vár" : "Visszavételre vár"} – a Könyvelőben sztornózták: ${p.serialNumber} (sztornó: ${p.reversalSerialNumber})`,
        ...(ki ? {} : { unitPrice: m.unit_cost === null ? null : Number(m.unit_cost) }),
        corrects: String(m.id),
        dokumentum: p.documentId,
        forras: p.reversalSerialNumber,
      }),
    );
  }
  const reszek = [visszavonva.length ? `${visszavonva.length} jóváhagyásra váró mozgás visszavonva` : null, visszavetel.length ? `${visszavetel.length} visszavétel jóváhagyásra vár` : null].filter(Boolean);
  return { outcome: "APPLIED", ...(reszek.length ? { target: { recordType: "mozgas", recordId: (visszavetel[0] ?? visszavonva[0])!, url: "/mozgasnaplo", label: reszek.join(", ") } } : {}) };
}

// ---------- Kiegyenlítés (KK6) ----------

type Kiegyenlites = { settledDocumentId: string; amount: number; date?: string; reason?: "MANUAL" | "REVERSAL"; itemOpenAfter: number; settledSources: Array<{ module: string; recordType: string; recordId: string }> };

async function kiegyenlites(client: pg.PoolClient, d: InboundDelivery): Promise<InboundResult> {
  const p = d.event.payload as unknown as Kiegyenlites;
  // Sztornó miatti bontás: a számla megszűnt, nem „ki nem fizetett” lett; a fizetési állapothoz nem nyúlunk.
  if (p.reason === "REVERSAL") return { outcome: "APPLIED" };
  const forrasok = p.settledSources.filter((s) => s.module === "keszlet" && UUID.test(s.recordId));
  if (!forrasok.length) return { outcome: "APPLIED" };
  const fizetve = p.itemOpenAfter === 0;
  const hianyzik: string[] = [];
  for (const s of forrasok) {
    const m = (await client.query<Sor>("SELECT id, type FROM public.movements WHERE company_id = $1 AND id = $2", [d.targetCompanyRef, s.recordId])).rows[0];
    if (!m) {
      hianyzik.push(`${s.recordType} ${s.recordId}`);
      continue;
    }
    if (m.type === "out") {
      await client.query("UPDATE public.movements SET is_paid = $2, fizetes_konyvelobol = true WHERE id = $1 AND (is_paid IS DISTINCT FROM $2 OR NOT fizetes_konyvelobol)", [m.id, fizetve]);
    } else {
      await client.query(
        `UPDATE public.purchase_lots SET is_paid = $2, paid_date = CASE WHEN $2 THEN $3::date ELSE NULL END, fizetes_konyvelobol = true
          WHERE movement_id = $1 AND deleted_at IS NULL AND (is_paid IS DISTINCT FROM $2 OR NOT fizetes_konyvelobol)`,
        [m.id, fizetve, p.date ?? null],
      );
    }
  }
  if (hianyzik.length) {
    return teendo(client, d, `kiegyenlites:${d.event.source.recordId}`, "A Könyvelő kiegyenlítést jelzett egy Készlet-tételre, amely nincs meg a Készletben.", hianyzik.join(", "));
  }
  return { outcome: "APPLIED" };
}

// ---------- Időszak (KK9) ----------

async function idoszak(client: pg.PoolClient, d: InboundDelivery): Promise<InboundResult> {
  const p = d.event.payload as unknown as { kind: "PERIOD" | "FISCAL_YEAR"; startDate: string; endDate: string };
  if (d.event.type === "konyvelo.idoszak.lezarva") {
    await client.query(
      `INSERT INTO integracio.lezart_idoszakok (company_id, fajta, kezdet, veg) VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, fajta, kezdet) DO UPDATE SET veg = EXCLUDED.veg, lezarva = now()`,
      [d.targetCompanyRef, p.kind, p.startDate, p.endDate],
    );
  } else {
    await client.query("DELETE FROM integracio.lezart_idoszakok WHERE company_id = $1 AND fajta = $2 AND kezdet = $3", [d.targetCompanyRef, p.kind, p.startDate]);
  }
  return { outcome: "APPLIED" };
}

// ---------- Beküldött áfabevallás (I5, F17.2) ----------

/** Az eÁFA-ban beküldött áfaidőszak: a Készlet figyelmeztet, ha erre az időszakra rögzítenek (nem tilt). */
async function afaBekuldve(client: pg.PoolClient, d: InboundDelivery): Promise<InboundResult> {
  const p = d.event.payload as unknown as { periodStart: string; periodEnd: string };
  await client.query(
    `INSERT INTO integracio.lezart_idoszakok (company_id, fajta, kezdet, veg) VALUES ($1, 'AFA_BEKULDVE', $2, $3)
     ON CONFLICT (company_id, fajta, kezdet) DO UPDATE SET veg = EXCLUDED.veg, lezarva = now()`,
    [d.targetCompanyRef, p.periodStart, p.periodEnd],
  );
  return { outcome: "APPLIED" };
}

// ---------- Partner (M2) ----------

async function partner(client: pg.PoolClient, d: InboundDelivery): Promise<InboundResult> {
  const p = d.event.payload as unknown as { partner: { name: string; taxNumber?: string }; anonymized: boolean };
  const kulcs = `partner:${d.event.source.recordId}`;
  if (!p.partner.taxNumber) return teendo(client, d, kulcs, `Partner változott a Könyvelőben (${p.partner.name}), de adószám nélkül nem párosítható. Nézze át a szállítókat és a vevőket.`);
  const ado = szamjegyek(p.partner.taxNumber);
  const talalat: Array<{ tabla: string; id: string; name: string }> = [];
  for (const tabla of ["suppliers", "customers"]) {
    const r = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM public.${tabla} WHERE company_id = $1 AND deleted_at IS NULL AND regexp_replace(coalesce(tax_number, ''), '\\D', '', 'g') = $2`,
      [d.targetCompanyRef, ado],
    );
    for (const x of r.rows) talalat.push({ tabla, ...x });
  }
  if (!talalat.length) return teendo(client, d, kulcs, `Új partner a Könyvelőben: ${p.partner.name} (${p.partner.taxNumber}). Ha a Készletben is kell, vegye fel.`);
  if (p.anonymized) return teendo(client, d, kulcs, `A Könyvelőben anonimizálták a(z) ${talalat[0]!.name} partnert. A Készlet magától nem anonimizál; nézze át.`);
  const tablak = new Set(talalat.map((t) => t.tabla));
  if (talalat.length > tablak.size) return teendo(client, d, kulcs, `Több partner is ugyanezzel az adószámmal szerepel a Készletben (${p.partner.taxNumber}); a névváltozást (${p.partner.name}) kézzel vezesse át.`);
  for (const t of talalat) {
    if (t.name === p.partner.name) continue;
    await client.query(`UPDATE public.${t.tabla} SET name = $2 WHERE id = $1`, [t.id, p.partner.name]);
    await client.query(
      `INSERT INTO public.audit_log (company_id, entity_type, entity_id, entity_label, action, description, changes, created_by, created_by_name)
       VALUES ($1::uuid, $2, $3, $4, 'update', 'Név frissítve a Könyvelőből (pontos adószám-egyezés)', $5, NULL, 'Integrációs központ')`,
      [d.targetCompanyRef, t.tabla === "suppliers" ? "supplier" : "customer", t.id, p.partner.name, JSON.stringify([{ field: "name", from: t.name, to: p.partner.name }])],
    );
  }
  return { outcome: "APPLIED", target: { recordType: "partner", recordId: talalat[0]!.id, url: talalat[0]!.tabla === "suppliers" ? "/beszallitok" : "/vevok", label: p.partner.name } };
}

/** A Készlet által fogadott (típus@verzió) párok és kezelőik (F15.3). */
export const KEZELOK: Kezelok = {
  "konyvelo.bizonylat.konyvelve@2": bizonylatKonyvelve,
  "konyvelo.bizonylat.sztornozva@1": bizonylatSztornozva,
  "konyvelo.kiegyenlites.rogzitve@3": kiegyenlites,
  "konyvelo.kiegyenlites.bontva@2": kiegyenlites,
  "konyvelo.idoszak.lezarva@1": idoszak,
  "konyvelo.idoszak.feloldva@1": idoszak,
  "eafa.bevallas.bekuldve@1": afaBekuldve,
  "torzs.partner.valtozott@1": partner,
};

export function kezelo(kezelok: Kezelok = KEZELOK): Kezelo {
  return async (client, d) => {
    const kulcs = `${d.event.type}@${d.event.version}`;
    const k = kezelok[kulcs];
    if (k) return k(client, d);
    throw new FogadoHiba(422, "UNSUPPORTED_EVENT", `A Készlet ezt az eseményt nem dolgozza fel: ${d.event.type} v${d.event.version}. A Készlet frissítése után a központból újraküldhető.`);
  };
}
