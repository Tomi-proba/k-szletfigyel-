import type pg from "pg";
import { RECONCILE_TODO_STATUSES, reconcileReportSchema, reconcileRequestSchema, type KeszletAnswer, type ReconcileResult } from "../esemenyek/src/index.ts";
import { lotUnitCost } from "../../src/lib/costing.ts";
import { tranzakcio } from "./db.ts";
import { FogadoHiba } from "./kezelok.ts";
import { filler } from "./osszeallito.ts";
import { teendoLezaras, teendoNyitas } from "./teendok.ts";

/**
 * Egyeztető ellenőrzések a Készlet oldalán (TERV.md F16, I4.3).
 *
 * - `egyeztetesValasz`: a központ kérdésére a Készlet saját számai: a készlet értéke a cég módszerével
 *   (FIFO: a beszerzési tételek maradéka a saját egységköltségén; átlagár: készlet × átlagár), az időszak
 *   eladásainak bekerülési értéke (ELÁBÉ), a Könyvelőből jött, még jóváhagyásra váró mozgások, a kért
 *   rekordok állapota és kifizetettsége, a kimenő sor. Ugyanazokkal a számolófüggvényekkel
 *   (src/lib/costing.ts) és kerekítéssel, mint az események.
 * - `eredmenyFogadas`: a központ eredménye; a nem rendben lévő ellenőrzésből Teendő lesz az
 *   Integráció-oldalon, a rendben lévőé lezárul. A program magától soha nem javít semmit.
 */

type Sor = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LELTAR = new Set(["leltar_hiany", "leltar_tobblet", "selejt"]);
const MOZGAS_REKORDOK = new Set(["beszerzes", "eladas", "leltar", "konyvelo_mozgas"]);

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const hatalyos = (m: Sor) => !m.deleted_at && (m.approval_status === null || m.approval_status === undefined || m.approval_status === "approved");
/** A Könyvelő bizonylatából jött (jóváhagyandóként létrehozott) mozgás. */
const konyvelobol = (m: Sor) => Boolean(m.integracio_esemeny_id && m.integracio_dokumentum_id);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Mennyiség × egységár fillérben, a negatív eredményt nem vágva (a hívó dönt). */
const ertek = (q: unknown, egysegar: unknown) => {
  const a = n(egysegar);
  return a === null ? 0 : filler(Number(q) * a);
};

/**
 * A készlet értéke a cég módszerével, fillérben. FIFO-nál a beszerzési tételek maradéka a saját
 * egységköltségén; ha a készlet több, mint a tételek maradéka (pl. a tételkövetés előtti adat), a többlet
 * a termék beszerzési árán (ugyanaz a tartalék, mint a FIFO-felhasználásnál).
 */
export function keszletErtek(method: "FIFO" | "AVERAGE", termekek: Sor[], tetelek: Sor[]): number {
  if (method === "AVERAGE") return termekek.reduce((s, p) => s + ertek(p.current_stock, p.purchase_price), 0);
  const maradek = new Map<string, number>();
  let osszeg = 0;
  for (const l of tetelek) {
    const q = Number(l.remaining_quantity);
    if (!(q > 0)) continue;
    const egyseg = lotUnitCost({
      unitPrice: Number(l.unit_price),
      shippingCost: Number(l.shipping_cost ?? 0),
      quantity: Number(l.quantity),
      exchangeRate: Number(l.exchange_rate ?? 1),
      vatRatePercent: n(l.vat_rate_percent) ?? undefined,
      vatReclaimable: l.vat_reclaimable === null || l.vat_reclaimable === undefined ? undefined : Boolean(l.vat_reclaimable),
    });
    osszeg += filler(q * egyseg);
    maradek.set(String(l.product_id), (maradek.get(String(l.product_id)) ?? 0) + q);
  }
  for (const p of termekek) {
    const tobblet = Number(p.current_stock) - (maradek.get(String(p.id)) ?? 0);
    if (tobblet > 1e-9) osszeg += ertek(tobblet, p.purchase_price);
  }
  return osszeg;
}

/**
 * Az időszak ELÁBÉ-ja, fillérben, ugyanúgy, ahogy az események viszik a Könyvelőbe: az eladások (és a
 * Könyvelőből jött, jóváhagyott kiadások) bekerülési értéke, mínusz a vevői visszavételek és a Könyvelő
 * sztornója miatti visszavételek. A visszavont (visszavonva jelölt vagy korrekciós tétellel törölt)
 * eladás nem számít. A leltáreltérés és a szállítói visszaküldés nem ELÁBÉ.
 */
export function idoszakElabe(mozgasok: Sor[]): number {
  let osszeg = 0;
  for (const m of mozgasok) {
    if (!hatalyos(m)) continue;
    const eredetiTipus = m.o_type as string | null;
    if (m.type === "out" && !m.return_of_movement_id && !m.corrects_movement_id && !LELTAR.has(String(m.ok ?? ""))) {
      if (m.cancelled || m.sajat_korrekcio) continue;
      osszeg += ertek(m.quantity, m.unit_cost);
    } else if (m.type === "in" && m.return_of_movement_id && eredetiTipus === "out") {
      // Vevői visszavétel: a Könyvelőből jöttnél a rögzített egységáron, a Készletben rögzítettnél az eladáskori költségen.
      osszeg -= konyvelobol(m) ? ertek(m.quantity, m.unit_price) : ertek(m.quantity, m.o_unit_cost);
    } else if (m.type === "in" && m.corrects_movement_id && eredetiTipus === "out" && konyvelobol(m) && !m.o_cancelled) {
      // A Könyvelőben sztornózott vevőszámla kiadásának visszavétele (a raktáros hagyta jóvá).
      osszeg -= ertek(m.quantity, m.unit_price);
    }
  }
  return osszeg;
}

/**
 * A Könyvelőből jött, még jóváhagyásra váró mozgások. A készletértékre hatásként csak az számít, amit a
 * Könyvelő a számlával már könyvelt, a Készletben viszont még nincs bent: a beérkezés (+) és a szállítói
 * visszaküldés (−). A kiadás nem: annak az ELÁBÉ-ja a jóváhagyással együtt megy a Könyvelőbe.
 */
export function fuggoMozgasok(mozgasok: Sor[]): { count: number; inventory: number; oldest: string | null } {
  let inventory = 0;
  let oldest: string | null = null;
  for (const m of mozgasok) {
    const t = iso(m.created_at);
    if (t && (!oldest || t < oldest)) oldest = t;
    if (m.type === "in" && !m.return_of_movement_id && !m.corrects_movement_id) inventory += ertek(m.quantity, m.unit_price);
    else if (m.type === "out" && m.return_of_movement_id && m.o_type === "in") inventory -= ertek(m.quantity, m.o_unit_price);
  }
  return { count: mozgasok.length, inventory, oldest };
}

const MOZGAS_OSZLOPOK = `m.id, m.type, m.quantity, m.unit_cost, m.unit_price, m.ok, m.cancelled, m.deleted_at, m.approval_status, m.created_at,
  m.return_of_movement_id, m.corrects_movement_id, m.integracio_esemeny_id, m.integracio_dokumentum_id, m.is_paid, m.fizetes_konyvelobol,
  o.type AS o_type, o.unit_cost AS o_unit_cost, o.unit_price AS o_unit_price, o.cancelled AS o_cancelled,
  EXISTS (SELECT 1 FROM public.movements c WHERE c.corrects_movement_id = m.id AND c.deleted_at IS NULL
           AND (c.approval_status IS NULL OR c.approval_status = 'approved')
           AND NOT (c.integracio_esemeny_id IS NOT NULL AND c.integracio_dokumentum_id IS NOT NULL)) AS sajat_korrekcio`;

export async function egyeztetesValasz(pool: pg.Pool, raw: unknown): Promise<KeszletAnswer> {
  const parsed = reconcileRequestSchema.safeParse(raw);
  if (!parsed.success) throw new FogadoHiba(422, "INVALID_REQUEST", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const req = parsed.data;
  const ceg = req.companyRef;
  if (!UUID.test(ceg)) throw new FogadoHiba(404, "NOT_FOUND", "A cég nem található.");
  const linked = await pool.query("SELECT integracio.osszekapcsolt($1) AS ok", [ceg]);
  if (!linked.rows[0]?.ok) throw new FogadoHiba(409, "NOT_LINKED", "A cég ebben a Készletben nincs összekapcsolva a központtal.");

  const beallitas = await pool.query<{ m: string | null }>("SELECT settings ->> 'costingMethod' AS m FROM public.company_settings WHERE company_id = $1", [ceg]);
  // Az alapértelmezés a Készletben az átlagár (src/types: DEFAULT_SETTINGS).
  const method = beallitas.rows[0]?.m === "fifo" ? "FIFO" : "AVERAGE";
  const termekek = (await pool.query<Sor>("SELECT id, current_stock, purchase_price FROM public.products WHERE company_id = $1 AND deleted_at IS NULL", [ceg])).rows;
  const tetelek =
    method === "FIFO"
      ? (
          await pool.query<Sor>(
            `SELECT l.product_id, l.remaining_quantity, l.unit_price, l.shipping_cost, l.quantity, l.exchange_rate, l.vat_rate_percent, l.vat_reclaimable
               FROM public.purchase_lots l JOIN public.products p ON p.id = l.product_id
              WHERE l.company_id = $1 AND l.deleted_at IS NULL AND p.deleted_at IS NULL AND l.remaining_quantity > 0`,
            [ceg],
          )
        ).rows
      : [];
  const idoszak = (
    await pool.query<Sor>(
      `SELECT ${MOZGAS_OSZLOPOK} FROM public.movements m LEFT JOIN public.movements o ON o.id = coalesce(m.return_of_movement_id, m.corrects_movement_id)
        WHERE m.company_id = $1 AND m.date BETWEEN $2::date AND $3::date`,
      [ceg, req.from, req.to],
    )
  ).rows;
  const fuggok = (
    await pool.query<Sor>(
      `SELECT ${MOZGAS_OSZLOPOK} FROM public.movements m LEFT JOIN public.movements o ON o.id = coalesce(m.return_of_movement_id, m.corrects_movement_id)
        WHERE m.company_id = $1 AND m.approval_status = 'pending' AND m.deleted_at IS NULL
          AND m.integracio_esemeny_id IS NOT NULL AND m.integracio_dokumentum_id IS NOT NULL`,
      [ceg],
    )
  ).rows;

  // A kért rekordok: él-e, és ki van-e fizetve (csak ha a fizetést a Könyvelő követi).
  const mozgasKulcsok = req.keys.filter((k) => MOZGAS_REKORDOK.has(k.recordType) && UUID.test(k.recordId));
  const mozgasok = new Map<string, Sor>();
  if (mozgasKulcsok.length) {
    const r = await pool.query<Sor>(
      `SELECT ${MOZGAS_OSZLOPOK},
              (SELECT jsonb_build_object('is_paid', l.is_paid, 'fizetes_konyvelobol', l.fizetes_konyvelobol) FROM public.purchase_lots l
                WHERE l.movement_id = m.id AND l.deleted_at IS NULL ORDER BY l.created_at LIMIT 1) AS tetel
         FROM public.movements m LEFT JOIN public.movements o ON o.id = coalesce(m.return_of_movement_id, m.corrects_movement_id)
        WHERE m.company_id = $1 AND m.id = ANY($2::uuid[])`,
      [ceg, [...new Set(mozgasKulcsok.map((k) => k.recordId))]],
    );
    for (const m of r.rows) mozgasok.set(String(m.id), m);
  }
  const zarasKulcsok = req.keys.filter((k) => k.recordType === "napi_zaras" && UUID.test(k.recordId)).map((k) => k.recordId);
  const zarasok = new Set(
    zarasKulcsok.length ? (await pool.query<{ id: string }>("SELECT id::text FROM public.daily_closings WHERE company_id = $1 AND id = ANY($2::uuid[])", [ceg, zarasKulcsok])).rows.map((x) => x.id) : [],
  );
  const records = req.keys.map((k) => {
    if (k.recordType === "napi_zaras") return { ...k, effective: UUID.test(k.recordId) ? zarasok.has(k.recordId) : false, paid: null };
    if (!MOZGAS_REKORDOK.has(k.recordType)) return { ...k, effective: null, paid: null };
    const m = UUID.test(k.recordId) ? mozgasok.get(k.recordId) : undefined;
    if (!m) return { ...k, effective: false, paid: null };
    const tetel = m.tetel as { is_paid: boolean | null; fizetes_konyvelobol: boolean } | null;
    const paid = m.type === "out" ? (m.fizetes_konyvelobol ? Boolean(m.is_paid) : null) : tetel?.fizetes_konyvelobol ? Boolean(tetel.is_paid) : null;
    return { ...k, effective: hatalyos(m) && !m.cancelled && !m.sajat_korrekcio, paid };
  });

  const missing = req.events.length
    ? (await pool.query<{ id: string }>("SELECT e.id::text AS id FROM unnest($1::uuid[]) AS e(id) WHERE NOT EXISTS (SELECT 1 FROM integracio.integration_inbox i WHERE i.event_id = e.id)", [req.events])).rows.map((x) => x.id)
    : [];
  // A kimenő sor: az összeállításra váró változások és az átadásra váró események. A nem összeállítható
  // változás (adathiány) „el nem küldhető”: ember kell hozzá (Teendő a Készletben).
  const sor = (
    await pool.query<{ varakozik: string; hibas: string; legregebbi: Date | null }>(
      `SELECT ((SELECT count(*) FROM integracio.valtozasok v WHERE v.company_id = $1 AND v.feldolgozva IS NULL AND v.kihagyva IS NULL)
             + (SELECT count(*) FROM integracio.integration_outbox o WHERE o.sent_at IS NULL AND o.envelope -> 'source' ->> 'companyRef' = $1::text))::text AS varakozik,
              (SELECT count(*) FROM integracio.valtozasok v WHERE v.company_id = $1 AND v.feldolgozva IS NULL AND v.kihagyva IS NULL AND v.elso_hiba IS NOT NULL)::text AS hibas,
              least((SELECT min(v.letrehozva) FROM integracio.valtozasok v WHERE v.company_id = $1 AND v.feldolgozva IS NULL AND v.kihagyva IS NULL),
                    (SELECT min(o.created_at) FROM integracio.integration_outbox o WHERE o.sent_at IS NULL AND o.envelope -> 'source' ->> 'companyRef' = $1::text)) AS legregebbi`,
      [ceg],
    )
  ).rows[0]!;

  return {
    module: "keszlet",
    method,
    stockValue: keszletErtek(method, termekek, tetelek),
    cogs: idoszakElabe(idoszak),
    pending: fuggoMozgasok(fuggok),
    records,
    missingEvents: missing,
    outbox: { waiting: Number(sor.varakozik), failed: Number(sor.hibas), oldest: iso(sor.legregebbi) },
  };
}

/** A Teendő szövege az eredményből (az érintett tételek közül legfeljebb 10). */
function reszletek(r: ReconcileResult): string | null {
  const sorok = [r.detail, ...r.items.slice(0, 10).map((i) => `• ${i.label}`), r.items.length > 10 ? `… és további ${r.items.length - 10} tétel` : null].filter(Boolean);
  return sorok.length ? sorok.join("\n").slice(0, 4000) : null;
}

/**
 * A központ eredménye: eltárolja (régebbi kör nem írja felül az újabbat), és ellenőrzésenként Teendőt
 * nyit vagy zár (`egyeztetes:E1` …). A „nem futott” ellenőrzés a korábbi Teendőt nem zárja le.
 */
export async function eredmenyFogadas(pool: pg.Pool, raw: unknown): Promise<{ stored: boolean }> {
  const parsed = reconcileReportSchema.safeParse(raw);
  if (!parsed.success) throw new FogadoHiba(422, "INVALID_REPORT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const rep = parsed.data;
  const ceg = rep.companyRef;
  if (!UUID.test(ceg)) throw new FogadoHiba(404, "NOT_FOUND", "A cég nem található.");
  return tranzakcio(pool, async (c) => {
    const elozo = (await c.query<{ at: Date; run_id: string }>("SELECT at, run_id FROM integracio.egyeztetes WHERE company_id = $1 FOR UPDATE", [ceg])).rows[0];
    if (elozo && elozo.run_id !== rep.runId && new Date(elozo.at).getTime() > Date.parse(rep.at)) return { stored: false };
    await c.query(
      `INSERT INTO integracio.egyeztetes (company_id, run_id, at, as_of, idoszak_kezdet, idoszak_veg, eredmenyek, erkezett) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (company_id) DO UPDATE SET run_id = $2, at = $3, as_of = $4, idoszak_kezdet = $5, idoszak_veg = $6, eredmenyek = $7, erkezett = now()`,
      [ceg, rep.runId, rep.at, rep.asOf, rep.from, rep.to, JSON.stringify(rep.results)],
    );
    for (const r of rep.results) {
      const kulcs = `egyeztetes:${r.check}`;
      if (r.status === "NEM_FUTOTT") continue;
      if (RECONCILE_TODO_STATUSES.includes(r.status)) await teendoNyitas(c, ceg, { kulcs, fajta: "EGYEZTETES", cim: r.title, reszletek: reszletek(r) });
      else await teendoLezaras(c, ceg, kulcs);
    }
    return { stored: true };
  });
}
