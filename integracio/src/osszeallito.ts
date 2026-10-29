import { randomUUID } from "node:crypto";
import type pg from "pg";
import { enqueueEvent, nextSequence } from "../esemenyek/src/postgres.ts";
import type { EventEnvelope } from "../esemenyek/src/index.ts";
import { lotGoodsValueHuf, lotShippingHuf, lotUnitCost } from "../../src/lib/costing.ts";
import { teendoLezaras, teendoNyitas } from "./teendok.ts";

/**
 * Az összeállító (TERV.md F15.2): a változások sorából (integracio.valtozasok, a mentés tranzakciójában
 * írja a trigger) eseményt készít, és a kimenő táblába teszi. A tartalom a változás PILLANATKÉPÉBŐL
 * készül, a Készlet saját számolófüggvényeivel (src/lib/costing.ts), így ugyanaz, amit a felület mutat.
 *
 * - Kerekítés (F15.7/3): soronként egész fillérre; a bruttó a nettó és az áfa összege.
 * - Nem találgat: ha egy adat hiányzik (pl. az eladásnak nincs rögzített ára), a változás nem megy ki,
 *   hanem vár, a hiba látszik, és Teendő lesz. Csak a fő iroda hagyhatja ki, indoklással.
 * - Sorrend: azonosító szerint. Ha egy változás nem állítható össze, az ugyanarra a rekordra vonatkozó
 *   későbbiek is várnak (a központ a rekord sorszáma szerint adja át őket).
 */

type Sor = Record<string, unknown>;
export type Valtozas = {
  id: number;
  company_id: string;
  fajta: "mozgas_veglegesites" | "mozgas_visszavonas" | "mozgas_kezeletlen" | "napi_zaras" | "napi_zaras_modosult" | "termek" | "partner";
  rekord_id: string;
  pillanatkep: Sor;
  oka_esemeny: string | null;
  nap: string;
  letrehozva: Date | string;
  elso_hiba: Date | string | null;
};

/** Adathiány vagy ellentmondás: emberi beavatkozás kell, újrapróbálással nem javul. */
export class EpitesiHiba extends Error {}

export type Terv = {
  record: { type: string; id: string; url?: string; label?: string };
  esemeny: { type: string; version: number; payload: Record<string, unknown>; causedBy?: string } | null;
  /** Esemény helyett (vagy mellett) a Készletben nyitandó Teendő. */
  teendo?: { kulcs: string; fajta: string; cim: string; reszletek?: string };
};

// ---------- Segédek ----------

/** Forint → egész fillér (a lebegőpontos maradékot előbb levágva, hogy pl. 1,005 Ft ne 100 fillér legyen). */
export const filler = (huf: number) => Math.round(Number((huf * 100).toPrecision(15)));
/** Az áfa a már fillérre kerekített nettóból, hogy a tételből bárki ugyanazt számolja vissza (F15.7/3). */
const afaja = (nettoHuf: number, kulcs: number | null) => (kulcs === null ? 0 : Math.round(Number(((filler(nettoHuf) * kulcs) / 100).toPrecision(15))));
const szam = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const szoveg = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v));
const kotelezo = (v: unknown, mi: string): number => {
  const n = szam(v);
  if (n === null || !Number.isFinite(n)) throw new EpitesiHiba(mi);
  return n;
};

/** Adószám kanonikus alakra (12345678-1-12); ha nem értelmezhető, null (nem találgatunk). */
export function adoszam(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 8)}-${d.slice(8, 9)}-${d.slice(9)}` : null;
}

const partnerRef = (p: Sor | null | undefined) => {
  if (!p) return null;
  const tax = adoszam(p.tax_number);
  return { name: String(p.name), ...(tax ? { taxNumber: tax } : {}) };
};

const hatalyos = (m: Sor) => !m.deleted_at && (m.approval_status === null || m.approval_status === undefined || m.approval_status === "approved");

const LELTAR: Record<string, "SHORTAGE" | "SURPLUS" | "SCRAP"> = { leltar_hiany: "SHORTAGE", leltar_tobblet: "SURPLUS", selejt: "SCRAP" };

export type MozgasFajta = "PURCHASE" | "SALE" | "INVENTORY" | "RETURN";
export function mozgasFajta(m: Sor): MozgasFajta {
  if (m.return_of_movement_id) return "RETURN";
  if (typeof m.ok === "string" && LELTAR[m.ok]) return "INVENTORY";
  return m.type === "in" ? "PURCHASE" : "SALE";
}

type Kep = {
  mozgas: Sor;
  tetel: Sor | null;
  termek: Sor;
  telephely: Sor | null;
  szallito: Sor | null;
  vevo: Sor | null;
  eredeti: Sor | null;
  eredeti_tetel: Sor | null;
  eredeti_vevo: Sor | null;
  korrekcio?: Sor;
};

const tetelKoltseg = (l: Sor) => ({
  unitPrice: kotelezo(l.unit_price, "A beszerzési tételnek nincs egységára."),
  shippingCost: szam(l.shipping_cost) ?? 0,
  quantity: kotelezo(l.quantity, "A beszerzési tételnek nincs mennyisége."),
  exchangeRate: szam(l.exchange_rate) ?? 1,
  vatRatePercent: szam(l.vat_rate_percent) ?? undefined,
  vatReclaimable: l.vat_reclaimable === null || l.vat_reclaimable === undefined ? undefined : Boolean(l.vat_reclaimable),
});

/** Egy mozgás eseményeinek forrásrekordja. A visszáru az eredeti mozgás rekordján megy (sorrend). */
export function mozgasRekordja(k: Kep): { type: string; id: string } {
  const m = k.mozgas;
  const fajta = mozgasFajta(m);
  if (fajta === "RETURN") {
    if (!k.eredeti) throw new EpitesiHiba("A visszáru eredeti mozgása nem található.");
    return { type: k.eredeti.type === "in" ? "beszerzes" : "eladas", id: String(k.eredeti.id) };
  }
  if (fajta === "INVENTORY") return { type: "leltar", id: String(m.id) };
  return { type: fajta === "PURCHASE" ? "beszerzes" : "eladas", id: String(m.id) };
}

function mennyiseg(m: Sor): number {
  const q = kotelezo(m.quantity, "A mozgásnak nincs mennyisége.");
  if (!(q > 0)) throw new EpitesiHiba("A mozgás mennyisége nem pozitív.");
  return q;
}

const cimke = (fajta: string, k: Kep) => `${fajta}: ${String(k.termek.name)} (${String(k.mozgas.quantity)} ${String(k.termek.unit ?? "")})`.trim().slice(0, 300);

// ---------- Tartalmak ----------

function beszerzes(k: Kep) {
  const m = k.mozgas;
  if (!k.tetel) throw new EpitesiHiba("A beszerzésnek nincs beszerzési tétele.");
  const lot = tetelKoltseg(k.tetel);
  const kulcs = lot.vatRatePercent ?? null;
  const visszaigenyelheto = lot.vatReclaimable !== false;
  const aru = lotGoodsValueHuf(lot);
  const fuvar = lotShippingHuf(lot);
  const line = {
    productId: String(k.termek.id),
    productName: String(k.termek.name),
    quantity: mennyiseg(m),
    unit: szoveg(k.termek.unit),
    netAmount: filler(aru),
    vatRate: kulcs,
    vatAmount: afaja(aru, kulcs),
    vatReclaimable: visszaigenyelheto,
  };
  const shipping =
    filler(fuvar) > 0
      ? {
          netAmount: filler(fuvar),
          vatRate: kulcs,
          vatAmount: afaja(fuvar, kulcs),
          vatReclaimable: visszaigenyelheto,
          onSupplierInvoice: m.shipping_on_invoice === null || m.shipping_on_invoice === undefined ? null : Boolean(m.shipping_on_invoice),
        }
      : null;
  const szamlan = shipping?.onSupplierInvoice === true ? shipping : null;
  const net = line.netAmount + (szamlan?.netAmount ?? 0);
  const vat = line.vatAmount + (szamlan?.vatAmount ?? 0);
  const devizanem = szoveg(k.tetel.currency) ?? "HUF";
  return {
    purchaseId: String(m.id),
    receivedDate: String(m.date),
    invoiceDate: null,
    fulfillmentDate: null,
    invoiceNumber: szoveg(m.invoice_number),
    supplier: partnerRef(k.szallito),
    originalCurrency: devizanem !== "HUF" ? { code: devizanem, rate: lot.exchangeRate } : null,
    lines: [line],
    shipping,
    totals: { net, vat, gross: net + vat },
  };
}

function eladasSor(m: Sor, termek: Sor, ar: number | null, kulcs: number | null, q: number) {
  if (ar === null) throw new EpitesiHiba("Az eladásnak nincs rögzített eladási ára (a Készlet régi mozgása?).");
  const netto = q * ar;
  return { productId: String(termek.id), productName: String(termek.name), quantity: q, unit: szoveg(termek.unit), netAmount: filler(netto), vatRate: kulcs, vatAmount: afaja(netto, kulcs) };
}

const osszesen = (lines: Array<{ netAmount: number; vatAmount: number }>) => {
  const net = lines.reduce((s, l) => s + l.netAmount, 0);
  const vat = lines.reduce((s, l) => s + l.vatAmount, 0);
  return { net, vat, gross: net + vat };
};

function eladas(k: Kep) {
  const m = k.mozgas;
  const q = mennyiseg(m);
  const line = eladasSor(m, k.termek, szam(m.sale_unit_price), szam(m.vat_rate_percent), q);
  const egysegKoltseg = kotelezo(m.unit_cost, "Az eladásnak nincs rögzített bekerülési értéke (ELÁBÉ).");
  return {
    saleId: String(m.id),
    date: String(m.date),
    customer: partnerRef(k.vevo),
    cash: !m.customer_id,
    invoiceNumber: szoveg(m.invoice_number),
    costOfGoods: Math.max(0, filler(q * egysegKoltseg)),
    lines: [line],
    totals: osszesen([line]),
  };
}

function leltar(k: Kep) {
  const m = k.mozgas;
  const kind = LELTAR[String(m.ok)]!;
  const q = mennyiseg(m);
  if ((kind === "SURPLUS") !== (m.type === "in")) throw new EpitesiHiba("A leltáreltérés iránya nem egyezik a mozgás irányával (többlet csak bejövő, hiány és selejt csak kimenő lehet).");
  let value: number;
  if (kind === "SURPLUS") {
    if (!k.tetel) throw new EpitesiHiba("A leltári többletnek nincs beszerzési tétele (egységár).");
    value = filler(lotUnitCost(tetelKoltseg(k.tetel)) * q);
  } else {
    value = filler(q * kotelezo(m.unit_cost, "A kiadásnak nincs rögzített egységköltsége."));
  }
  return {
    movementId: String(m.id),
    date: String(m.date),
    kind,
    productId: String(k.termek.id),
    productName: String(k.termek.name),
    quantity: q,
    unit: szoveg(k.termek.unit),
    location: k.telephely ? { id: String(k.telephely.id), name: String(k.telephely.name) } : null,
    value: Math.max(0, value),
    note: szoveg(m.note)?.slice(0, 500) ?? null,
  };
}

function visszaru(k: Kep) {
  const m = k.mozgas;
  const e = k.eredeti;
  if (!e) throw new EpitesiHiba("A visszáru eredeti mozgása nem található.");
  if (e.return_of_movement_id || (typeof e.ok === "string" && LELTAR[e.ok]) || e.corrects_movement_id) throw new EpitesiHiba("Visszáru csak beszerzéshez vagy eladáshoz rögzíthető.");
  const q = mennyiseg(m);
  const base = { returnId: String(m.id), date: String(m.date), reason: (szoveg(m.note) ?? "").slice(0, 500) };
  if (m.type === "in") {
    if (e.type !== "out") throw new EpitesiHiba("A vevői visszavétel eredetije nem eladás.");
    const line = eladasSor(e, k.termek, szam(e.sale_unit_price), szam(e.vat_rate_percent), q);
    return {
      ...base,
      kind: "CUSTOMER_RETURN",
      original: { movementKind: "SALE", movementId: String(e.id) },
      partner: partnerRef(k.eredeti_vevo),
      cash: !e.customer_id,
      lines: [line],
      totals: osszesen([line]),
      vatReclaimable: null,
      costOfGoods: Math.max(0, filler(q * kotelezo(e.unit_cost, "Az eredeti eladásnak nincs rögzített bekerülési értéke."))),
    };
  }
  if (e.type !== "in") throw new EpitesiHiba("A szállítói visszaküldés eredetije nem beszerzés.");
  if (!k.eredeti_tetel) throw new EpitesiHiba("Az eredeti beszerzésnek nincs beszerzési tétele.");
  const lot = tetelKoltseg(k.eredeti_tetel);
  const kulcs = lot.vatRatePercent ?? null;
  // Az eredeti tétel árán (szállítási díj nélkül, az a beszerzéshez tartozott).
  const netto = q * lot.unitPrice * lot.exchangeRate;
  const line = { productId: String(k.termek.id), productName: String(k.termek.name), quantity: q, unit: szoveg(k.termek.unit), netAmount: filler(netto), vatRate: kulcs, vatAmount: afaja(netto, kulcs) };
  return {
    ...base,
    kind: "SUPPLIER_RETURN",
    original: { movementKind: "PURCHASE", movementId: String(e.id) },
    partner: partnerRef(k.szallito),
    cash: false,
    lines: [line],
    totals: osszesen([line]),
    vatReclaimable: lot.vatReclaimable !== false,
    costOfGoods: null,
  };
}

function visszavonasOka(k: Kep): string {
  const m = k.mozgas;
  if (k.korrekcio) return (szoveg(k.korrekcio.note) ?? "Korrekciós tétel a Készletben").slice(0, 500);
  if (m.cancelled) return (szoveg(m.cancel_reason) ?? "Az eladást visszavonták a Készletben").slice(0, 500);
  return "A mozgást törölték a Készletben";
}

type Csoport = { vatRate: number | null; net: number; vat: number; gross: number };
function kulcsonkent(sorok: Array<{ vatRate: number | null; netAmount: number; vatAmount: number }>): Csoport[] {
  const by = new Map<string, Csoport>();
  for (const s of sorok) {
    const key = String(s.vatRate);
    const g = by.get(key) ?? { vatRate: s.vatRate, net: 0, vat: 0, gross: 0 };
    g.net += s.netAmount;
    g.vat += s.vatAmount;
    g.gross = g.net + g.vat;
    by.set(key, g);
  }
  return [...by.values()].sort((a, b) => (a.vatRate ?? -1) - (b.vatRate ?? -1));
}

function napiZaras(kep: Sor) {
  const zaras = kep.zaras as Sor;
  const telephely = kep.telephely as Sor | null;
  const elad: Array<ReturnType<typeof eladasSor>> = [];
  const vissza: Array<ReturnType<typeof eladasSor>> = [];
  const saleIds: string[] = [];
  const returnIds: string[] = [];
  for (const k of (kep.mozgasok as Kep[]) ?? []) {
    const m = k.mozgas;
    if (!hatalyos(m) || m.cancelled || m.corrects_movement_id) continue;
    const fajta = mozgasFajta(m);
    if (fajta === "SALE" && !m.customer_id) {
      elad.push(eladasSor(m, k.termek, szam(m.sale_unit_price), szam(m.vat_rate_percent), mennyiseg(m)));
      saleIds.push(String(m.id));
    } else if (fajta === "RETURN" && m.type === "in" && k.eredeti && k.eredeti.type === "out" && !k.eredeti.customer_id) {
      vissza.push(eladasSor(k.eredeti, k.termek, szam(k.eredeti.sale_unit_price), szam(k.eredeti.vat_rate_percent), mennyiseg(m)));
      returnIds.push(String(m.id));
    }
  }
  const sales = kulcsonkent(elad);
  const returns = kulcsonkent(vissza);
  const net = sales.reduce((s, r) => s + r.net, 0) - returns.reduce((s, r) => s + r.net, 0);
  const vat = sales.reduce((s, r) => s + r.vat, 0) - returns.reduce((s, r) => s + r.vat, 0);
  return {
    closingId: String(zaras.id),
    date: String(zaras.date),
    location: { id: String(zaras.location_id), name: String(telephely?.name ?? "") },
    sales,
    returns,
    saleIds,
    returnIds,
    totals: { net, vat, gross: net + vat },
  };
}

// ---------- Változás → terv ----------

export function tervez(v: Valtozas): Terv {
  const oka = v.oka_esemeny ?? undefined;
  switch (v.fajta) {
    case "mozgas_veglegesites": {
      const k = v.pillanatkep as unknown as Kep;
      const fajta = mozgasFajta(k.mozgas);
      const record = { ...mozgasRekordja(k), url: "/mozgasnaplo" };
      // A Könyvelőből érkezett és itt jóváhagyott mozgás a beérkezett eseményre hivatkozik (visszhang tiltása).
      const causedBy = oka ?? (szoveg(k.mozgas.integracio_esemeny_id) ?? undefined);
      if (fajta === "PURCHASE") return { record: { ...record, label: cimke("Beszerzés", k) }, esemeny: { type: "keszlet.beszerzes.veglegesitve", version: 3, payload: beszerzes(k), causedBy } };
      if (fajta === "SALE") return { record: { ...record, label: cimke("Eladás", k) }, esemeny: { type: "keszlet.eladas.veglegesitve", version: 2, payload: eladas(k), causedBy } };
      if (fajta === "INVENTORY") return { record: { ...record, label: cimke("Leltáreltérés", k) }, esemeny: { type: "keszlet.leltar.elteres", version: 1, payload: leltar(k), causedBy } };
      return { record: { ...record, label: cimke("Visszáru", k) }, esemeny: { type: "keszlet.visszaru.veglegesitve", version: 1, payload: visszaru(k), causedBy } };
    }
    case "mozgas_visszavonas": {
      const k = v.pillanatkep as unknown as Kep;
      return {
        record: { ...mozgasRekordja(k), url: "/mozgasnaplo", label: cimke("Visszavonás", k) },
        esemeny: {
          type: "keszlet.mozgas.sztornozva",
          version: 3,
          payload: { movementKind: mozgasFajta(k.mozgas), movementId: String(k.mozgas.id), date: v.nap, reason: visszavonasOka(k) },
          causedBy: oka,
        },
      };
    }
    case "mozgas_kezeletlen": {
      const k = v.pillanatkep as unknown as Kep;
      return {
        record: { type: "korrekcio", id: String(k.mozgas.id) },
        esemeny: null,
        teendo: {
          kulcs: `korrekcio-torolve:${String(k.mozgas.id)}`,
          fajta: "KEZELETLEN_VALTOZAS",
          cim: `Egy korrekciós tételt töröltek (${String(k.termek.name)}); a többi program ezt magától nem követi.`,
          reszletek:
            "A korrekciós tétel törlése az eredeti mozgást „visszaállítaná”. Ezt a program nem találgatja ki: ha az eredeti mozgás újra érvényes, rögzítse a Könyvelőben is, vagy rögzítse a mozgást újra a Készletben.",
        },
      };
    }
    case "napi_zaras":
      return {
        record: { type: "napi_zaras", id: v.rekord_id, url: "/napi-jelentesek", label: `Napi zárás ${String((v.pillanatkep.zaras as Sor).date)}` },
        esemeny: { type: "keszlet.napi_zaras.elkuldve", version: 1, payload: napiZaras(v.pillanatkep), causedBy: oka },
      };
    case "napi_zaras_modosult": {
      const z = v.pillanatkep.zaras as Sor;
      const t = v.pillanatkep.telephely as Sor | null;
      return {
        record: { type: "napi_zaras", id: v.rekord_id, url: "/napi-jelentesek", label: `Napi zárás ${String(z.date)} – utólag módosult` },
        esemeny: {
          type: "keszlet.napi_zaras.modosult",
          version: 1,
          payload: { closingId: String(z.id), date: String(z.date), location: { id: String(z.location_id), name: String(t?.name ?? "") }, movementIds: [String(v.pillanatkep.mozgas_id)] },
          causedBy: oka,
        },
      };
    }
    case "termek": {
      const p = v.pillanatkep;
      return {
        record: { type: "termek", id: v.rekord_id, url: "/keszlet", label: String(p.name).slice(0, 300) },
        esemeny: {
          type: "keszlet.termek.valtozott",
          version: 1,
          payload: { productId: String(p.id), name: String(p.name), sku: szoveg(p.sku), unit: szoveg(p.unit), vatRate: szam(p.default_vat_rate_percent), active: !p.deleted_at },
          causedBy: oka,
        },
      };
    }
    case "partner": {
      const p = v.pillanatkep;
      const tax = adoszam(p.tax_number);
      if (!tax) throw new EpitesiHiba(`A(z) „${String(p.name)}” adószáma nem értelmezhető (${String(p.tax_number)}); javítsa 12345678-1-12 alakra.`);
      return {
        record: { type: "partner", id: v.rekord_id, url: p.tabla === "suppliers" ? "/beszallitok" : "/vevok", label: String(p.name).slice(0, 300) },
        esemeny: { type: "torzs.partner.valtozott", version: 1, payload: { partner: { name: String(p.name), taxNumber: tax }, anonymized: false }, causedBy: oka },
      };
    }
  }
}

/** A forrásrekord kulcsa, a payload összeállítása nélkül (a sorrend-tartáshoz hiba esetén is kell). */
function rekordKulcs(v: Valtozas): string | null {
  try {
    if (v.fajta === "mozgas_veglegesites" || v.fajta === "mozgas_visszavonas") {
      const r = mozgasRekordja(v.pillanatkep as unknown as Kep);
      return `${r.type}:${r.id}`;
    }
    if (v.fajta === "napi_zaras" || v.fajta === "napi_zaras_modosult") return `napi_zaras:${v.rekord_id}`;
    return `${v.fajta}:${v.rekord_id}`;
  } catch {
    return null;
  }
}

// ---------- A kör ----------

/** Ennyi perc után nyit Teendőt egy átmeneti hiba is. */
export const HIBA_TEENDO_PERC = 30;
const ZAR = 7_301_202_601; // tetszőleges, állandó azonosító a tanácsadó zárhoz

export type OsszeallitasEredmeny = { keszult: number; hibas: number; varakozik: number };

export async function osszeallitas(pool: pg.Pool, now = new Date(), batch = 200): Promise<OsszeallitasEredmeny> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Egyszerre csak egy összeállító fut (a sorszámok és a sorrend miatt).
    const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS ok", [ZAR]);
    if (!lock.rows[0]!.ok) {
      await client.query("COMMIT");
      return { keszult: 0, hibas: 0, varakozik: 0 };
    }
    const rows = await client.query<Valtozas>(
      `SELECT id, company_id, fajta, rekord_id, pillanatkep, oka_esemeny, nap::text AS nap, letrehozva, elso_hiba
         FROM integracio.valtozasok WHERE feldolgozva IS NULL AND kihagyva IS NULL ORDER BY id LIMIT $1`,
      [batch],
    );
    const blokkolt = new Set<string>();
    const blokkoltCeg = new Set<string>();
    let keszult = 0;
    let hibas = 0;
    let varakozik = 0;
    for (const v of rows.rows) {
      const kulcs = rekordKulcs(v);
      if (blokkoltCeg.has(v.company_id) || (kulcs && blokkolt.has(`${v.company_id}|${kulcs}`))) {
        varakozik++;
        continue;
      }
      await client.query("SAVEPOINT valtozas");
      try {
        const terv = tervez(v);
        let esemenyId: string | null = null;
        if (terv.esemeny) {
          const event: EventEnvelope = {
            id: randomUUID(),
            type: terv.esemeny.type,
            version: terv.esemeny.version,
            source: {
              module: "keszlet",
              companyRef: v.company_id,
              recordType: terv.record.type,
              recordId: terv.record.id,
              sequence: await nextSequence(client, terv.record.type, terv.record.id),
              ...(terv.record.url ? { url: terv.record.url } : {}),
              ...(terv.record.label ? { label: terv.record.label } : {}),
            },
            occurredAt: new Date(v.letrehozva).toISOString(),
            ...(terv.esemeny.causedBy ? { causedBy: terv.esemeny.causedBy } : {}),
            payload: terv.esemeny.payload,
          };
          // Hibás eseményt nem fogad el; ilyenkor a mentőpont visszagörgeti a sorszámot is.
          await enqueueEvent(client, event);
          esemenyId = event.id;
        }
        if (terv.teendo) await teendoNyitas(client, v.company_id, { ...terv.teendo, valtozasId: v.id });
        await client.query("UPDATE integracio.valtozasok SET feldolgozva = now(), esemeny_id = $2, utolso_hiba = NULL WHERE id = $1", [v.id, esemenyId]);
        await teendoLezaras(client, v.company_id, `valtozas:${v.id}`);
        await client.query("RELEASE SAVEPOINT valtozas");
        keszult++;
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT valtozas");
        hibas++;
        if (kulcs) blokkolt.add(`${v.company_id}|${kulcs}`);
        else blokkoltCeg.add(v.company_id);
        const uzenet = e instanceof Error ? e.message : String(e);
        await client.query("UPDATE integracio.valtozasok SET probalkozasok = probalkozasok + 1, utolso_hiba = $2, elso_hiba = coalesce(elso_hiba, now()) WHERE id = $1", [v.id, uzenet.slice(0, 2000)]);
        const regota = v.elso_hiba && now.getTime() - new Date(v.elso_hiba).getTime() >= HIBA_TEENDO_PERC * 60_000;
        if (e instanceof EpitesiHiba || regota) {
          await teendoNyitas(client, v.company_id, {
            kulcs: `valtozas:${v.id}`,
            fajta: "OSSZEALLITAS_HIBA",
            cim: "Egy Készlet-változás nem küldhető el a többi programnak.",
            reszletek: `${uzenet} Az ugyanerre a tételre vonatkozó későbbi változások addig várnak. Ha az adat nem javítható, a fő iroda indoklással kihagyhatja (Beállítások → Integráció).`,
            valtozasId: v.id,
          });
        }
      }
    }
    await client.query("COMMIT");
    return { keszult, hibas, varakozik };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
