import { createHash } from "node:crypto";
import { z } from "zod";
import { isoDate } from "./esemeny.ts";
import { moduleLinkSchema } from "./teendok.ts";

/**
 * Nyitott tételek a Könyvelőből a Készletbe (TERV.md F19, I6b, KK10): ha a cégnek van Könyvelője, a Készlet
 * fizetési kötelezettségei (szállítói oldal) és kintlévőségei (vevői oldal) a Könyvelő nyitott tételeiből
 * jönnek, hogy mindkét oldalon egy igazság legyen.
 *
 * Ez állapot-tükör, mint a Teendőké (teendok.ts): a Könyvelő cégenként elküldi a teljes listát
 * (`PUT /api/v1/modul/tukor/nyitott-tetelek`), az újabb felülírja az előzőt. Csak változáskor küld, de
 * legalább 10 percenként. A Készlet (`GET …?companyRef=`) csak a saját, összekapcsolt cégére kérheti le (D13),
 * és csak bekapcsolt Könyvelő → Készlet modulpárral.
 */

export const OPEN_ITEMS_PATH = "api/v1/modul/tukor/nyitott-tetelek";
export const OPEN_ITEMS_MAX = 5000;
/** Ennél régebbi lista mellett a Készlet figyelmeztet (a lista ilyenkor is látszik). */
export const OPEN_ITEMS_STALE_MS = 24 * 60 * 60_000;

/** Melyik Készlet-mozgásból lett a bizonylat (a Készlet esemény-forrása: beszerzés vagy eladás). */
export const stockSourceSchema = z.object({
  recordType: z.string().min(1).max(60),
  recordId: z.string().min(1).max(100),
});

export const openItemSchema = z.object({
  /** PAYABLE: szállítói (fizetendő), RECEIVABLE: vevői (kintlévőség). */
  kind: z.enum(["PAYABLE", "RECEIVABLE"]),
  documentId: z.string().min(1).max(100),
  serialNumber: z.string().max(100).nullable(),
  externalNumber: z.string().max(100).nullable(),
  partnerName: z.string().max(300).nullable(),
  description: z.string().max(500).nullable(),
  issueDate: isoDate.nullable(),
  /** A bizonylaton megadott fizetési határidő; ha nincs megadva, null (a program nem talál ki határidőt). */
  dueDate: isoDate.nullable(),
  /** Nyitott összeg forintban (fillér), mindig pozitív. */
  open: z.number().int().positive(),
  link: moduleLinkSchema.nullable(),
  /** A Készletből jött bizonylatnál a Készlet-forrás(ok). */
  stockSources: z.array(stockSourceSchema).max(100),
});
export type OpenItem = z.infer<typeof openItemSchema>;

/**
 * Könyvelésre vár: a Könyvelő tud a Készlet tételéről, de a nyitott tétel még nincs könyvelve.
 * - Beszerzés (PAYABLE): a Készletből készült szállítói számla még piszkozat (`documentId`: a piszkozat).
 * - Eladás (RECEIVABLE): a Könyvelő számla nélkül nem könyvel árbevételt; amíg a vevőszámlát nem rögzítették
 *   (és nem párosult), a tétel itt van (`documentId`: null).
 */
export const pendingDraftSchema = z.object({
  kind: z.enum(["PAYABLE", "RECEIVABLE"]),
  documentId: z.string().min(1).max(100).nullable(),
  link: moduleLinkSchema.nullable(),
  stockSources: z.array(stockSourceSchema).min(1).max(100),
});
export type PendingDraft = z.infer<typeof pendingDraftSchema>;

export const openItemsMirrorSchema = z.object({
  companyRef: z.string().min(1).max(100),
  /** A lista állapotának napja (a Könyvelő szerint). */
  asOf: isoDate,
  items: z.array(openItemSchema).max(OPEN_ITEMS_MAX),
  pendingDrafts: z.array(pendingDraftSchema).max(OPEN_ITEMS_MAX),
});
export type OpenItemsMirror = z.infer<typeof openItemsMirrorSchema>;

export const openItemsAnswerSchema = z.object({
  /** OK: van lista; NONE: a Könyvelő még nem küldött. */
  state: z.enum(["OK", "NONE"]),
  asOf: isoDate.nullable(),
  /** Mikor kapta a központ a listát (ISO). */
  mirroredAt: z.string().nullable(),
  items: z.array(openItemSchema),
  pendingDrafts: z.array(pendingDraftSchema),
});
export type OpenItemsAnswer = z.infer<typeof openItemsAnswerSchema>;

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}

/** A lista lenyomata (a változás felismeréséhez; a sorrend számít, a küldő rendezve küldi). */
export function openItemsHash(m: Pick<OpenItemsMirror, "items" | "pendingDrafts">): string {
  return createHash("sha256").update(JSON.stringify(canonical({ items: m.items, pendingDrafts: m.pendingDrafts })), "utf8").digest("hex");
}
