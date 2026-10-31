import { z } from "zod";

/**
 * Közös eseményformátum (TERV.md F2). Minden modul ugyanebben a formában adja fel az eseményeit az
 * integrációs központnak, és ugyanebben kapja a máshonnan érkezőket.
 *
 * - `id`: az esemény egyedi azonosítója. A központ és a fogadó modul is erre ügyel, hogy egy esemény
 *   pontosan egyszer hasson.
 * - `source`: honnan jött. `companyRef` a forrásmodul SAJÁT cégazonosítója; a közös céget a központ az
 *   összekapcsolásból (kapcsolódási kóddal, D13) tudja, nem az adószámból.
 * - `source.sequence`: ugyanarra a forrásrekordra vonatkozó események sorszáma (1, 2, …); a központ
 *   ebben a sorrendben adja át őket.
 * - `causedBy`: ha az esemény egy beérkezett esemény hatására keletkezett, annak azonosítója (visszhang
 *   tiltása: a feladó felé nem megy vissza).
 * - Pénzösszeg mindig fillérben, egész számként; adószám kanonikus alakban (12345678-1-12).
 */

export const MODULES = ["konyvelo", "keszlet", "eafa"] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_LABELS: Record<Module, string> = {
  konyvelo: "Könyvelő",
  keszlet: "Készletfigyelő",
  eafa: "eÁFA",
};

const uuid = z.uuid("Érvénytelen azonosító.");
const isoDateTime = z.iso.datetime({ offset: true, message: "Érvénytelen időpont (ISO 8601)." });
/** Pénzösszeg fillérben. */
export const filler = z.number().int("A pénzösszeg egész fillér legyen.");
export const taxNumber = z.string().regex(/^\d{8}-\d-\d{2}$/, "Az adószám kanonikus alakja: 12345678-1-12.");
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Érvénytelen dátum (ÉÉÉÉ-HH-NN).");

export const sourceSchema = z.object({
  module: z.enum(MODULES),
  companyRef: z.string().min(1).max(100),
  recordType: z.string().min(1).max(60),
  recordId: z.string().min(1).max(100),
  sequence: z.number().int().min(1),
  /** A forrásrekordra mutató hivatkozás a modul felületén (relatív útvonal). */
  url: z.string().max(500).optional(),
  label: z.string().max(300).optional(),
});

export const envelopeSchema = z.object({
  id: uuid,
  type: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/, "Érvénytelen eseménytípus."),
  version: z.number().int().min(1),
  source: sourceSchema,
  occurredAt: isoDateTime,
  causedBy: uuid.optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof envelopeSchema>;
export type EventSource = z.infer<typeof sourceSchema>;

/** Egy eseménytípus: kik a fogadói, és milyen a tartalma. */
export type EventTypeDefinition = {
  type: string;
  version: number;
  description: string;
  /** Mely modulok kapják (a forrásmodul soha). */
  consumers: readonly Module[];
  payload: z.ZodType<Record<string, unknown>>;
};

const partnerRef = z.object({ name: z.string().min(1), taxNumber: taxNumber.optional(), sharedId: uuid.optional() });
const accountingLine = z.object({ accountNumber: z.string().regex(/^\d{1,8}$/), side: z.enum(["D", "C"]), amount: filler.positive() });
const stockLine = z.object({ productId: z.string().min(1), quantity: z.number().positive(), unitPrice: filler, vatRate: z.number().min(0).max(100).nullable() });
const documentRef = z.object({ documentId: z.string(), serialNumber: z.string() });
/**
 * Készlet-tétel kifejezett összegekkel (v2): a fogadó nem számol áfát és nem kerekít, mert abból eltérés
 * lehetne (F5, „soha ne találgasson”). Bruttó = nettó + áfa.
 */
const stockLineV2 = z
  .object({
    productId: z.string().min(1),
    productName: z.string().min(1).max(300),
    quantity: z.number().positive(),
    unit: z.string().max(30).nullable(),
    netAmount: filler,
    vatRate: z.number().min(0).max(100).nullable(),
    vatAmount: filler,
  })
  .refine((l) => l.vatRate !== null || l.vatAmount === 0, { message: "Áfakulcs nélkül az áfa összege 0.", path: ["vatAmount"] });
const totals = z.object({ net: filler, vat: filler, gross: filler }).refine((t) => t.gross === t.net + t.vat, { message: "A bruttó összeg a nettó és az áfa összege.", path: ["gross"] });
const withTotals = <T extends { lines: Array<{ netAmount: number; vatAmount: number }>; totals: { net: number; vat: number } }>(p: T) =>
  p.lines.reduce((s, l) => s + l.netAmount, 0) === p.totals.net && p.lines.reduce((s, l) => s + l.vatAmount, 0) === p.totals.vat;

/**
 * Beszerzési tétel (v3): mint a v2, és hogy az áfája visszaigényelhető-e. Ha nem, az áfa a bekerülési érték
 * része (a Készlet `lotUnitCost` számítása szerint), a Könyvelőben nem az előzetesen felszámított áfára megy.
 */
const purchaseLineV3 = z
  .object({
    productId: z.string().min(1),
    productName: z.string().min(1).max(300),
    quantity: z.number().positive(),
    unit: z.string().max(30).nullable(),
    netAmount: filler,
    vatRate: z.number().min(0).max(100).nullable(),
    vatAmount: filler,
    vatReclaimable: z.boolean(),
  })
  .refine((l) => l.vatRate !== null || l.vatAmount === 0, { message: "Áfakulcs nélkül az áfa összege 0.", path: ["vatAmount"] });

/**
 * A beszerzés szállítási díja (F15.7/2). A bekerülési értékbe mindig beletartozik; hogy a szállító számláján
 * van-e, azt a jóváhagyó mondja meg: igen (true), nem (false), nem tudja (null). A fogadó nem találgat.
 */
const purchaseShipping = z
  .object({
    netAmount: filler.positive(),
    vatRate: z.number().min(0).max(100).nullable(),
    vatAmount: filler,
    vatReclaimable: z.boolean(),
    onSupplierInvoice: z.boolean().nullable(),
  })
  .refine((l) => l.vatRate !== null || l.vatAmount === 0, { message: "Áfakulcs nélkül az áfa összege 0.", path: ["vatAmount"] });

/** Az eredeti pénznem, ha nem forint (tájékoztatásul; az összegek mindig forintban, fillérben). */
const originalCurrency = z.object({ code: z.string().regex(/^[A-Z]{3}$/), rate: z.number().positive() });

/** Kulcsonkénti összesítő sor (napi zárás). */
const rateRow = z
  .object({ vatRate: z.number().min(0).max(100).nullable(), net: filler, vat: filler, gross: filler })
  .refine((r) => r.gross === r.net + r.vat, { message: "A bruttó összeg a nettó és az áfa összege.", path: ["gross"] })
  .refine((r) => r.vatRate !== null || r.vat === 0, { message: "Áfakulcs nélkül az áfa összege 0.", path: ["vat"] });
const uniqueRates = (rows: Array<{ vatRate: number | null }>) => new Set(rows.map((r) => r.vatRate)).size === rows.length;
const sumRows = (rows: Array<{ net: number; vat: number }>) => rows.reduce((s, r) => ({ net: s.net + r.net, vat: s.vat + r.vat }), { net: 0, vat: 0 });

/** Egy Készlet-forrásrekord (pl. a kiegyenlített számla melyik Készlet-beszerzésből vagy -eladásból jött). */
const recordRef = z.object({ module: z.enum(MODULES), recordType: z.string().min(1).max(60), recordId: z.string().min(1).max(100) });

/**
 * Az eseménytípusok egyetlen helye (TERV.md F7). Új kapcsolat itt vehető fel, a meglévő modulok
 * módosítása nélkül; a tartalom változásához új verzió kell.
 */
export const EVENT_TYPES: readonly EventTypeDefinition[] = [
  {
    type: "konyvelo.bizonylat.konyvelve",
    version: 1,
    description: "A Könyvelőben könyveltek egy bizonylatot (KK3, KE1).",
    consumers: ["keszlet", "eafa"],
    payload: z.object({
      documentId: z.string(),
      serialNumber: z.string(),
      docType: z.string(),
      accountingDate: isoDate,
      fulfillmentDate: isoDate.nullable(),
      externalNumber: z.string().nullable(),
      partner: partnerRef.nullable(),
      lines: z.array(accountingLine).min(1),
      stockLines: z.array(stockLine).optional(),
    }),
  },
  {
    type: "konyvelo.bizonylat.konyvelve",
    version: 2,
    description: "A Könyvelőben könyveltek egy bizonylatot; a helyesbítő bizonylat is ez, hivatkozással az eredetire (KK3, KK5, KE1).",
    consumers: ["keszlet", "eafa"],
    payload: z.object({
      documentId: z.string(),
      serialNumber: z.string(),
      docType: z.string(),
      accountingDate: isoDate,
      issueDate: isoDate.nullable(),
      fulfillmentDate: isoDate.nullable(),
      dueDate: isoDate.nullable(),
      externalNumber: z.string().nullable(),
      description: z.string().nullable(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      /** Devizás bizonylatnál a devizaösszeg (a deviza századrészében) és az árfolyam. */
      fxAmount: z.number().int().nullable(),
      fxRate: z.number().positive().nullable(),
      partner: partnerRef.nullable(),
      corrects: documentRef.nullable(),
      reverses: documentRef.nullable(),
      lines: z.array(accountingLine.extend({ partner: partnerRef.nullable().optional() })).min(1),
      /** A rögzítéskor megadott termékek (KK3), kifejezett összegekkel. */
      stockLines: z.array(stockLineV2).optional(),
    }),
  },
  {
    type: "konyvelo.bizonylat.sztornozva",
    version: 1,
    description: "A Könyvelőben sztornóztak egy bizonylatot (KK4, KE1).",
    consumers: ["keszlet", "eafa"],
    payload: z.object({ documentId: z.string(), serialNumber: z.string(), reversalDocumentId: z.string(), reversalSerialNumber: z.string(), accountingDate: isoDate }),
  },
  {
    type: "konyvelo.kiegyenlites.rogzitve",
    version: 1,
    description: "A Könyvelőben kiegyenlítettek egy vevői vagy szállítói számlát (KK6).",
    consumers: ["keszlet"],
    payload: z.object({ documentId: z.string(), settledDocumentId: z.string(), amount: filler.positive(), date: isoDate }),
  },
  {
    type: "konyvelo.kiegyenlites.rogzitve",
    version: 2,
    description: "A Könyvelőben kiegyenlítettek (párosítottak) egy vevői vagy szállítói számlát (KK6).",
    consumers: ["keszlet"],
    payload: z.object({ settlementId: z.string(), documentId: z.string(), settledDocumentId: z.string(), amount: filler.positive(), date: isoDate }),
  },
  {
    type: "konyvelo.kiegyenlites.bontva",
    version: 1,
    description: "A Könyvelőben bontottak egy párosítást (kézzel vagy sztornó miatt) (KK6).",
    consumers: ["keszlet"],
    payload: z.object({ settlementId: z.string(), documentId: z.string(), settledDocumentId: z.string(), amount: filler.positive(), reason: z.enum(["MANUAL", "REVERSAL"]) }),
  },
  {
    type: "konyvelo.idoszak.lezarva",
    version: 1,
    description: "A Könyvelőben lezártak egy havi időszakot vagy üzleti évet (KK9).",
    consumers: ["keszlet"],
    payload: z.object({ kind: z.enum(["PERIOD", "FISCAL_YEAR"]), startDate: isoDate, endDate: isoDate }),
  },
  {
    type: "konyvelo.idoszak.feloldva",
    version: 1,
    description: "A Könyvelőben feloldottak egy havi időszakot vagy üzleti évet (KK9).",
    consumers: ["keszlet"],
    payload: z.object({ kind: z.enum(["PERIOD", "FISCAL_YEAR"]), startDate: isoDate, endDate: isoDate }),
  },
  {
    type: "keszlet.termek.valtozott",
    version: 1,
    description: "A Készletben felvettek vagy módosítottak egy terméket (a Könyvelő termékkérdéséhez, KK3).",
    consumers: ["konyvelo"],
    payload: z.object({
      productId: z.string().min(1),
      name: z.string().min(1).max(300),
      sku: z.string().max(100).nullable(),
      unit: z.string().max(30).nullable(),
      vatRate: z.number().min(0).max(100).nullable(),
      active: z.boolean(),
    }),
  },
  {
    type: "keszlet.beszerzes.veglegesitve",
    version: 1,
    description: "A Készletben véglegesítettek egy beszerzést (KK1).",
    consumers: ["konyvelo"],
    payload: z.object({ purchaseId: z.string(), date: isoDate, supplier: partnerRef.nullable(), invoiceNumber: z.string().nullable(), lines: z.array(stockLine).min(1) }),
  },
  {
    type: "keszlet.eladas.veglegesitve",
    version: 1,
    description: "A Készletben véglegesítettek egy eladást (KK2).",
    consumers: ["konyvelo"],
    payload: z.object({ saleId: z.string(), date: isoDate, customer: partnerRef.nullable(), cash: z.boolean(), costOfGoods: filler.nonnegative(), lines: z.array(stockLine).min(1) }),
  },
  {
    type: "keszlet.beszerzes.veglegesitve",
    version: 2,
    description: "A Készletben véglegesítettek egy beszerzést (KK1), kifejezett nettó, áfa és bruttó összeggel.",
    consumers: ["konyvelo"],
    payload: z
      .object({
        purchaseId: z.string(),
        receivedDate: isoDate,
        invoiceDate: isoDate.nullable(),
        /** A számla szerinti teljesítés dátuma, ha a Készletben megadták (a szállítói számlához kell). */
        fulfillmentDate: isoDate.nullable(),
        invoiceNumber: z.string().max(100).nullable(),
        supplier: partnerRef.nullable(),
        lines: z.array(stockLineV2).min(1),
        totals,
      })
      .refine(withTotals, { message: "Az összesen nem egyezik a tételek összegével.", path: ["totals"] }),
  },
  {
    type: "keszlet.eladas.veglegesitve",
    version: 2,
    description: "A Készletben véglegesítettek egy eladást (KK2); az ELÁBÉ a Készlet költségszámítása szerint.",
    consumers: ["konyvelo"],
    payload: z
      .object({
        saleId: z.string(),
        date: isoDate,
        customer: partnerRef.nullable(),
        cash: z.boolean(),
        /** A vevőszámla száma, ha van (a Könyvelőben rögzített számlával így párosítható). */
        invoiceNumber: z.string().max(100).nullable(),
        /** Az eladott áruk bekerülési értéke (ELÁBÉ), a Készlet FIFO/átlagár számítása szerint. */
        costOfGoods: filler.nonnegative(),
        lines: z.array(stockLineV2).min(1),
        totals,
      })
      .refine(withTotals, { message: "Az összesen nem egyezik a tételek összegével.", path: ["totals"] }),
  },
  {
    type: "keszlet.mozgas.sztornozva",
    version: 2,
    description: "A Készletben visszavontak egy beszerzést vagy eladást (KK4). A forrásrekord ugyanaz, mint a visszavont mozgásé (a sorrend így biztos).",
    consumers: ["konyvelo"],
    payload: z.object({ movementKind: z.enum(["PURCHASE", "SALE"]), movementId: z.string(), date: isoDate, reason: z.string().max(500) }),
  },
  {
    type: "keszlet.mozgas.sztornozva",
    version: 1,
    description: "A Készletben visszavontak egy mozgást (KK4).",
    consumers: ["konyvelo"],
    payload: z.object({ movementId: z.string(), reason: z.string() }),
  },
  {
    type: "keszlet.beszerzes.veglegesitve",
    version: 3,
    description:
      "A Készletben véglegesítettek egy beszerzést (KK1): tételenként, hogy az áfa visszaigényelhető-e, és a szállítási díj külön, azzal, hogy rajta van-e a szállító számláján (F15.3, F15.7/2).",
    consumers: ["konyvelo"],
    payload: z
      .object({
        purchaseId: z.string(),
        receivedDate: isoDate,
        invoiceDate: isoDate.nullable(),
        fulfillmentDate: isoDate.nullable(),
        invoiceNumber: z.string().max(100).nullable(),
        supplier: partnerRef.nullable(),
        /** Ha a beszerzés devizában volt: a pénznem és az árfolyam (az összegek ettől még forintban vannak). */
        originalCurrency: originalCurrency.nullable(),
        lines: z.array(purchaseLineV3).min(1),
        shipping: purchaseShipping.nullable(),
        /**
         * A szállító számlájának összesene: a tételek, és a szállítási díj, ha a számlán van
         * (`onSupplierInvoice === true`). Ha nincs rajta vagy nem tudni, a díj nem része.
         */
        totals,
      })
      .refine(
        (p) => {
          const ship = p.shipping?.onSupplierInvoice === true ? p.shipping : null;
          const net = p.lines.reduce((s, l) => s + l.netAmount, 0) + (ship?.netAmount ?? 0);
          const vat = p.lines.reduce((s, l) => s + l.vatAmount, 0) + (ship?.vatAmount ?? 0);
          return net === p.totals.net && vat === p.totals.vat;
        },
        { message: "Az összesen nem egyezik a tételek (és a számlán lévő szállítási díj) összegével.", path: ["totals"] },
      ),
  },
  {
    type: "keszlet.leltar.elteres",
    version: 1,
    description:
      "A Készletben leltári hiányt, többletet vagy selejtet rögzítettek (KK7). A Könyvelőben mindig jóváhagyandó piszkozat lesz (F15.5).",
    consumers: ["konyvelo"],
    payload: z.object({
      movementId: z.string(),
      date: isoDate,
      kind: z.enum(["SHORTAGE", "SURPLUS", "SCRAP"]),
      productId: z.string().min(1),
      productName: z.string().min(1).max(300),
      quantity: z.number().positive(),
      unit: z.string().max(30).nullable(),
      location: z.object({ id: z.string(), name: z.string().max(200) }).nullable(),
      /**
       * A bekerülési érték: hiánynál és selejtnél a kiadáskori egységköltségen (a mozgáson rögzítve),
       * többletnél a megadott egységáron. Soronként egész fillérre kerekítve.
       */
      value: filler.nonnegative(),
      note: z.string().max(500).nullable(),
    }),
  },
  {
    type: "keszlet.napi_zaras.elkuldve",
    version: 1,
    description:
      "A Készletben elküldtek egy napi zárást (KK8): a nap készpénzes (vevő nélküli) eladásai és visszavételei áfakulcsonként, a mozgások listájával. A Könyvelőben jóváhagyandó pénztárbevételi piszkozat lesz (F15.5).",
    consumers: ["konyvelo"],
    payload: z
      .object({
        closingId: z.string(),
        date: isoDate,
        location: z.object({ id: z.string(), name: z.string().max(200) }),
        /** A készpénzes eladások kulcsonként (minden kulcs legfeljebb egyszer). */
        sales: z.array(rateRow),
        /** A készpénzes (vevő nélküli) visszavételek kulcsonként (F15.8): a pénztárból kifizetett összeg. */
        returns: z.array(rateRow),
        saleIds: z.array(z.string()),
        returnIds: z.array(z.string()),
        /** Eladások mínusz visszavételek. */
        totals,
      })
      .refine((p) => uniqueRates(p.sales) && uniqueRates(p.returns), { message: "Egy áfakulcs csak egyszer szerepelhet.", path: ["sales"] })
      .refine(
        (p) => {
          const s = sumRows(p.sales);
          const r = sumRows(p.returns);
          return p.totals.net === s.net - r.net && p.totals.vat === s.vat - r.vat;
        },
        { message: "Az összesen nem egyezik az eladások és a visszavételek különbségével.", path: ["totals"] },
      ),
  },
  {
    type: "keszlet.napi_zaras.modosult",
    version: 1,
    description:
      "Egy már elküldött napi zárás napjára utólag mozgást rögzítettek vagy javítottak (KK8). A zárás nem íródik felül; a Könyvelőben Teendő lesz. Forrásrekordja ugyanaz, mint a zárásé.",
    consumers: ["konyvelo"],
    payload: z.object({
      closingId: z.string(),
      date: isoDate,
      location: z.object({ id: z.string(), name: z.string().max(200) }),
      movementIds: z.array(z.string()).min(1),
    }),
  },
  {
    type: "keszlet.visszaru.veglegesitve",
    version: 1,
    description:
      "A Készletben jóváhagytak egy részleges vevői visszavételt vagy szállítói visszaküldést (F15.8). Forrásrekordja az eredeti mozgásé, így csak az eredeti esemény után adható át. A Könyvelőben jóváhagyandó helyesbítő piszkozat lesz.",
    consumers: ["konyvelo"],
    payload: z
      .object({
        returnId: z.string(),
        kind: z.enum(["CUSTOMER_RETURN", "SUPPLIER_RETURN"]),
        /** Az eredeti mozgás: vevői visszavételnél eladás, szállítói visszaküldésnél beszerzés. */
        original: z.object({ movementKind: z.enum(["SALE", "PURCHASE"]), movementId: z.string() }),
        date: isoDate,
        partner: partnerRef.nullable(),
        /** Vevő nélküli (készpénzes) eladás visszavétele: a pénztárból fizetik vissza, a napi zárásba kerül. */
        cash: z.boolean(),
        reason: z.string().max(500),
        /** Az eredeti mozgás áraiból, arányosan, soronként fillérre kerekítve. */
        lines: z.array(stockLineV2).min(1),
        totals,
        /** Szállítói visszaküldésnél: visszaigényelhető volt-e az eredeti beszerzés áfája. Vevői visszavételnél null. */
        vatReclaimable: z.boolean().nullable(),
        /** Vevői visszavételnél a készletbe visszakerülő bekerülési érték (az eladáskori egységköltségen). Szállítói visszaküldésnél null. */
        costOfGoods: filler.nonnegative().nullable(),
      })
      .refine(withTotals, { message: "Az összesen nem egyezik a tételek összegével.", path: ["totals"] })
      .refine((p) => (p.kind === "CUSTOMER_RETURN") === (p.original.movementKind === "SALE"), {
        message: "Vevői visszavétel eladáshoz, szállítói visszaküldés beszerzéshez tartozik.",
        path: ["original", "movementKind"],
      })
      .refine((p) => (p.kind === "CUSTOMER_RETURN" ? p.costOfGoods !== null && p.vatReclaimable === null : p.costOfGoods === null && p.vatReclaimable !== null), {
        message: "Vevői visszavételnél a bekerülési érték kell, szállítói visszaküldésnél a visszaigényelhetőség.",
        path: ["costOfGoods"],
      })
      .refine((p) => p.kind === "CUSTOMER_RETURN" || !p.cash, { message: "Szállítói visszaküldés nem lehet készpénzes visszavétel.", path: ["cash"] }),
  },
  {
    type: "keszlet.mozgas.sztornozva",
    version: 3,
    description:
      "A Készletben visszavontak egy beszerzést, eladást, leltáreltérést vagy visszárut (KK4). A forrásrekord ugyanaz, mint a visszavont mozgás eseményéé (a sorrend így biztos).",
    consumers: ["konyvelo"],
    payload: z.object({ movementKind: z.enum(["PURCHASE", "SALE", "INVENTORY", "RETURN"]), movementId: z.string(), date: isoDate, reason: z.string().max(500) }),
  },
  {
    type: "keszlet.mozgas.jovahagyva",
    version: 1,
    description:
      "A Készletben jóváhagytak (vagy „nem érkezett meg / nem ment ki” jelöléssel elutasítottak) egy, a Könyvelő bizonylatából jött mozgást (F15.4). A várt és a tényleges mennyiséggel: az eltérésből a Könyvelőben Teendő lesz, a könyvelés magától nem változik. Forrásrekordja: konyvelo_mozgas (visszárunál és visszavételnél az eredeti mozgásé).",
    consumers: ["konyvelo"],
    payload: z
      .object({
        movementId: z.string(),
        /**
         * RECEIPT: szállítói számla beérkezése; ISSUE: vevőszámla kiadása; CUSTOMER_RETURN / SUPPLIER_RETURN:
         * helyesbítő számla visszárúja; REVERSAL: a Könyvelőben sztornózott számla már jóváhagyott mozgásának
         * visszavétele.
         */
        purpose: z.enum(["RECEIPT", "ISSUE", "CUSTOMER_RETURN", "SUPPLIER_RETURN", "REVERSAL"]),
        /** A Könyvelő bizonylata és eseménye, amelyből a mozgás lett. */
        sourceDocument: z.object({ documentId: z.string(), serialNumber: z.string().nullable(), eventId: uuid }),
        /** Visszárunál és visszavételnél az eredeti mozgás. */
        originalMovementId: z.string().nullable(),
        date: isoDate,
        productId: z.string().min(1),
        productName: z.string().min(1).max(300),
        unit: z.string().max(30).nullable(),
        expectedQuantity: z.number().positive(),
        /** 0: nem érkezett meg / nem ment ki (a raktáros elutasította). */
        actualQuantity: z.number().nonnegative(),
        note: z.string().max(500).nullable(),
        /**
         * Bekerülési érték a Készlet költségszámítása szerint: kiadásnál az ELÁBÉ, vevői visszárunál és a
         * kiadás visszavételénél a készletbe visszakerülő érték; egyébként null.
         */
        costOfGoods: filler.nonnegative().nullable(),
      })
      .refine((p) => (p.purpose === "RECEIPT" || p.purpose === "ISSUE") === (p.originalMovementId === null), {
        message: "Visszárunál és visszavételnél az eredeti mozgás kell, beérkezésnél és kiadásnál nincs.",
        path: ["originalMovementId"],
      }),
  },
  {
    type: "konyvelo.kiegyenlites.rogzitve",
    version: 3,
    description:
      "A Könyvelőben kiegyenlítettek (párosítottak) egy vevői vagy szállítói számlát (KK6), a tétel utána nyitott összegével és a Készlet-forrásával, hogy a fogadó ne számoljon és ne találgasson.",
    consumers: ["keszlet"],
    payload: z.object({
      settlementId: z.string(),
      documentId: z.string(),
      settledDocumentId: z.string(),
      amount: filler.positive(),
      date: isoDate,
      /** A kiegyenlített tétel nyitott összege a párosítás után (0: teljesen kiegyenlítve). */
      itemOpenAfter: filler.nonnegative(),
      /** Ha a kiegyenlített bizonylat egy másik modul rekordjából jött vagy ahhoz kapcsolódik (pl. Készlet-beszerzés). */
      settledSources: z.array(recordRef),
    }),
  },
  {
    type: "konyvelo.kiegyenlites.bontva",
    version: 2,
    description: "A Könyvelőben bontottak egy párosítást (kézzel vagy sztornó miatt) (KK6), a tétel utána nyitott összegével és a Készlet-forrásával.",
    consumers: ["keszlet"],
    payload: z.object({
      settlementId: z.string(),
      documentId: z.string(),
      settledDocumentId: z.string(),
      amount: filler.positive(),
      reason: z.enum(["MANUAL", "REVERSAL"]),
      /** A tétel nyitott összege a bontás után. Sztornónál 0, mert a sztornó zárja a tételt. */
      itemOpenAfter: filler.nonnegative(),
      settledSources: z.array(recordRef),
    }),
  },
  {
    type: "torzs.partner.valtozott",
    version: 1,
    description: "Egy partner adatai megváltoztak (M2).",
    consumers: ["konyvelo", "keszlet", "eafa"],
    payload: z.object({ partner: partnerRef.extend({ address: z.string().nullable().optional() }), anonymized: z.boolean().default(false) }),
  },
];

export type EventRegistry = ReadonlyMap<string, EventTypeDefinition>;

export function registryOf(types: readonly EventTypeDefinition[] = EVENT_TYPES): EventRegistry {
  return new Map(types.map((t) => [`${t.type}@${t.version}`, t]));
}

export type ValidationResult = { ok: true; event: EventEnvelope; definition: EventTypeDefinition } | { ok: false; error: string };

/** Az esemény ellenőrzése: forma, ismert típus és verzió, és a tartalom a típus szerint. */
export function validateEvent(raw: unknown, registry: EventRegistry = registryOf()): ValidationResult {
  const env = envelopeSchema.safeParse(raw);
  if (!env.success) return { ok: false, error: `Hibás esemény: ${env.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const def = registry.get(`${env.data.type}@${env.data.version}`);
  if (!def) return { ok: false, error: `Ismeretlen eseménytípus vagy verzió: ${env.data.type} v${env.data.version}` };
  const payload = def.payload.safeParse(env.data.payload);
  if (!payload.success) {
    return { ok: false, error: `Hibás tartalom (${env.data.type}): ${payload.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  return { ok: true, event: { ...env.data, payload: payload.data }, definition: def };
}

/** Amit a fogadó modul az átadásra válaszol. */
export const inboundResultSchema = z.object({
  /** APPLIED: hatott; DUPLICATE: már korábban hatott (nem hat újra); TODO: nem egyértelmű, Teendő lett; PARKED: félretéve (pl. hiányzik az előzménye). */
  outcome: z.enum(["APPLIED", "DUPLICATE", "TODO", "PARKED"]),
  /** Ami a fogadóban keletkezett (a „honnan jött?” kapcsolathoz). */
  target: z.object({ recordType: z.string(), recordId: z.string(), url: z.string().optional(), label: z.string().optional() }).optional(),
  todo: z.object({ key: z.string().min(1).max(200), title: z.string().min(1).max(300), detail: z.string().max(2000).optional(), url: z.string().max(500).optional() }).optional(),
});
export type InboundResult = z.infer<typeof inboundResultSchema>;

/** Amit a központ a fogadó modulnak küld: az esemény és a fogadó saját cégazonosítója. */
export type InboundDelivery = { event: EventEnvelope; targetCompanyRef: string };
