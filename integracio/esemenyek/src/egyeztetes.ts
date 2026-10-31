import { z } from "zod";
import { filler, isoDate } from "./esemeny.ts";

/**
 * Egyeztető ellenőrzések (TERV.md F16, I4). A központ kérdez, a modulok számolnak, a központ összeveti.
 *
 * Végpontok, amelyeket a Könyvelőnek és a Készletnek meg kell valósítania (a központ hívja, aláírva):
 * - `POST /api/integracio/v1/egyeztetes` – a kért napra és időszakra a modul saját számai
 *   (`ReconcileRequest` → `KonyveloAnswer` vagy `KeszletAnswer`). Csak összegek, darabszámok és
 *   bizonylatszámok mennek át, személyes adat nem;
 * - `POST /api/integracio/v1/egyeztetes/eredmeny` – az összevetés eredménye (`ReconcileReport`); a modul
 *   eltárolja, és a nem rendben lévő ellenőrzésekből Teendőt nyit (a rendben lévőkét lezárja).
 *
 * A központ végpontjai a modulok felé (aláírt kérés, `kliens.ts`):
 * - `POST /api/v1/modul/egyeztetes` – ellenőrzés most (pl. „Ellenőrzés most” gomb a modulban);
 * - `POST /api/v1/modul/egyeztetes/nyito` – a nyitó különbség elfogadása (csak a Könyvelőből, F16.4/3).
 *
 * Az egyeztetés soha nem javít semmit: kimutat és megmagyaráz (eltérés = magyarázott + megmagyarázatlan).
 */

export const RECONCILE_PATH = "/api/integracio/v1/egyeztetes";
export const RECONCILE_RESULT_PATH = "/api/integracio/v1/egyeztetes/eredmeny";

export const RECONCILE_CHECKS = ["E1", "E2", "E3", "E4", "E5", "E6"] as const;
export type ReconcileCheck = (typeof RECONCILE_CHECKS)[number];

export const RECONCILE_CHECK_LABELS: Record<ReconcileCheck, string> = {
  E1: "Készletérték",
  E2: "ELÁBÉ",
  E3: "Párosított tételek összege",
  E4: "Kifizetettség",
  E5: "Átadások teljessége",
  E6: "Kapcsolatok épsége",
};

/**
 * - RENDBEN: nincs eltérés (vagy a tűrésen belül van);
 * - FUGGO: az eltérés átadás alatt lévő tételből jön, magától rendeződik;
 * - REGOTA_FUGG: a számok magyarázhatók, de egy magyarázó tétel régóta (alapból 14 napja) függ;
 * - ELTERES: megmagyarázatlan eltérés;
 * - NYITO_ELFOGADASRA_VAR: az első futás eltérése, a Könyvelőben fogadható el kiinduló különbségnek;
 * - NEM_FUTOTT: egy modul nem válaszolt; ez nem „rendben”.
 */
export const RECONCILE_STATUSES = ["RENDBEN", "FUGGO", "REGOTA_FUGG", "ELTERES", "NYITO_ELFOGADASRA_VAR", "NEM_FUTOTT"] as const;
export type ReconcileStatus = (typeof RECONCILE_STATUSES)[number];

export const RECONCILE_STATUS_LABELS: Record<ReconcileStatus, string> = {
  RENDBEN: "Rendben",
  FUGGO: "Átadás folyamatban",
  REGOTA_FUGG: "Régóta függő tétel",
  ELTERES: "Eltérés",
  NYITO_ELFOGADASRA_VAR: "Nyitó különbség elfogadásra vár",
  NEM_FUTOTT: "Nem futott",
};

/** Ezekből lesz Teendő (a NEM_FUTOTT-ból külön, ellenőrzésenként nem: a korábbi Teendő marad). */
export const RECONCILE_TODO_STATUSES: readonly ReconcileStatus[] = ["REGOTA_FUGG", "ELTERES", "NYITO_ELFOGADASRA_VAR"];

const uuid = z.uuid("Érvénytelen azonosító.");
const isoDateTime = z.iso.datetime({ offset: true, message: "Érvénytelen időpont (ISO 8601)." });
const count = z.number().int().nonnegative();
const recordKey = z.object({ recordType: z.string().min(1).max(60), recordId: z.string().min(1).max(100) });

/** A központ kérdése. `events`: a központ szerint ennek a modulnak átadott események (a bejövő táblában meg kell lenniük). */
export const reconcileRequestSchema = z.object({
  runId: uuid,
  companyRef: z.string().min(1).max(100),
  /** A készletérték és a 261 egyenlege erre a napra (bezárólag). */
  asOf: isoDate,
  /** Az ELÁBÉ-időszak (E2), bezárólag. */
  from: isoDate,
  to: isoDate,
  events: z.array(uuid).max(20_000),
  /** Csak a Készletnek: a Könyvelő által hivatkozott Készlet-rekordok (E4, E6). */
  keys: z.array(recordKey).max(20_000),
});
export type ReconcileRequest = z.infer<typeof reconcileRequestSchema>;

const outboxState = z.object({
  /** Átadásra váró események / változások. */
  waiting: count,
  /** El nem küldhető (pl. hibás) tételek. */
  failed: count,
  oldest: isoDateTime.nullable(),
});

/** A Könyvelő válasza. Minden összeg fillérben; a 261 és a 814 a cég beállított integrációs számlái. */
export const konyveloAnswerSchema = z.object({
  module: z.literal("konyvelo"),
  /** A készletszámla (261) egyenlege `asOf`-ig, csak könyvelt bizonylatokból (tartozik − követel). */
  inventoryBalance: filler,
  /** Az ELÁBÉ-számla (814) forgalma az időszakban, könyvelt bizonylatokból (tartozik − követel). */
  cogsTurnover: filler,
  /** Könyvelt automatikus (integrációs) bizonylatok száma: a 261-et érintők összesen, a 814-et érintők az időszakban (tűrés). */
  postedCount: z.object({ inventory: count, cogs: count }),
  /** A jóváhagyásra váró integrációs piszkozatok hatása: a 261-re (`asOf`-ig) és a 814-re (az időszakban). */
  pending: z.object({ count, inventory: filler, cogs: filler, oldest: isoDateTime.nullable() }),
  /** A Készletből jött tételek: a kért események és az időszakban keletkezettek, valamint minden piszkozat. */
  records: z
    .array(
      z.object({
        eventId: uuid,
        kind: z.string().max(40),
        sourceRecordType: z.string().max(60),
        sourceRecordId: z.string().max(100),
        documentId: z.string().max(100).nullable(),
        serialNumber: z.string().max(100).nullable(),
        status: z.enum(["DRAFT", "POSTED", "REVERSED", "DELETED"]),
        /** A bizonylat tartozik oldalának összege most. */
        amount: filler.nullable(),
        /** Ugyanez a piszkozat létrehozásakor (a Készlet adataiból); ha nem ismert, null. */
        expectedAmount: filler.nullable(),
        createdAt: isoDateTime,
      }),
    )
    .max(40_000),
  /** A Készlet-forrású vevő- és szállítói számlák nyitott összege (E4). */
  paid: z
    .array(
      z.object({
        sourceRecordType: z.string().max(60),
        sourceRecordId: z.string().max(100),
        documentId: z.string().max(100),
        serialNumber: z.string().max(100).nullable(),
        open: filler,
      }),
    )
    .max(40_000),
  /** Nyitott integrációs Teendők (a magyarázathoz). */
  openTodos: z.object({ count, oldest: isoDateTime.nullable() }),
  /** A kért események közül, amelyek nincsenek meg a bejövő táblában. */
  missingEvents: z.array(uuid),
  outbox: outboxState,
});
export type KonyveloAnswer = z.infer<typeof konyveloAnswerSchema>;

/** A Készlet válasza. */
export const keszletAnswerSchema = z.object({
  module: z.literal("keszlet"),
  /** A cég beállított költségszámítási módszere (F16.4/4). */
  method: z.enum(["FIFO", "AVERAGE"]),
  /** A készlet értéke most, a cég módszerével. */
  stockValue: filler,
  /** Az időszak eladásainak bekerülési értéke, mínusz a vevői visszavételeké és a visszavont eladásoké. */
  cogs: filler,
  /**
   * A Könyvelőből jött, jóváhagyásra váró mozgások: hány db és mióta vár. `inventory`: azoké a hatása a
   * készletértékre, amelyeket a Könyvelő a számlával már könyvelt, a Készletben viszont még nincsenek bent
   * (beérkezés +, szállítói visszaküldés −). A kiadás nem számít: az ELÁBÉ-ja a jóváhagyással megy át.
   */
  pending: z.object({ count, inventory: filler, oldest: isoDateTime.nullable() }),
  /** A kért rekordok: él-e (`effective`), és ki van-e fizetve (`paid`); ismeretlen vagy nem követett: null. */
  records: z.array(recordKey.extend({ effective: z.boolean().nullable(), paid: z.boolean().nullable() })).max(40_000),
  missingEvents: z.array(uuid),
  outbox: outboxState,
});
export type KeszletAnswer = z.infer<typeof keszletAnswerSchema>;

export const reconcileItemSchema = z.object({
  label: z.string().max(300),
  recordType: z.string().max(60).nullable(),
  recordId: z.string().max(100).nullable(),
  documentId: z.string().max(100).nullable(),
  serialNumber: z.string().max(100).nullable(),
  amount: filler.nullable(),
  note: z.string().max(500).nullable(),
});
export type ReconcileItem = z.infer<typeof reconcileItemSchema>;

export const reconcileResultSchema = z.object({
  check: z.enum(RECONCILE_CHECKS),
  status: z.enum(RECONCILE_STATUSES),
  title: z.string().max(300),
  detail: z.string().max(4000).nullable(),
  /** Eltérés = magyarázott + megmagyarázatlan (fillérben; ahol nem összeg, ott null). */
  diff: filler.nullable(),
  explained: filler.nullable(),
  unexplained: filler.nullable(),
  tolerance: filler.nullable(),
  /** Csak E1: ennyit fogadhat el a Könyvelő nyitó (kiinduló) különbségnek. */
  baselineProposal: filler.nullable(),
  /** Legfeljebb 50 érintett tétel. */
  items: z.array(reconcileItemSchema).max(50),
});
export type ReconcileResult = z.infer<typeof reconcileResultSchema>;

/** Az eredmény, ahogy a modulok megkapják. `companyRef` a fogadó modul saját cégazonosítója. */
export const reconcileReportSchema = z.object({
  runId: uuid,
  companyRef: z.string().min(1).max(100),
  at: isoDateTime,
  asOf: isoDate,
  from: isoDate,
  to: isoDate,
  results: z.array(reconcileResultSchema).max(RECONCILE_CHECKS.length),
});
export type ReconcileReport = z.infer<typeof reconcileReportSchema>;

/** A nyitó különbség elfogadása (a Könyvelő adminisztrátora vagy vezető könyvelője, indoklással). */
export const baselineAcceptSchema = z.object({
  companyRef: z.string().min(1).max(100),
  runId: uuid,
  /** Pontosan az az összeg, amit az eredmény `baselineProposal`-ként mutatott. */
  amount: filler,
  reason: z.string().trim().min(10, "Az indoklás legalább 10 karakter legyen.").max(1000),
  /** Aki elfogadta (a modul felhasználója, a naplóhoz). */
  acceptedBy: z.string().min(1).max(200),
});
export type BaselineAccept = z.infer<typeof baselineAcceptSchema>;

/** Forintos kiírás fillérből: 254000000 → „2 540 000 Ft”, 120 → „1,20 Ft”. */
export function forint(f: number): string {
  const neg = f < 0;
  const abs = Math.abs(f);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "−" : ""}${grouped}${frac ? `,${String(frac).padStart(2, "0")}` : ""} Ft`;
}
