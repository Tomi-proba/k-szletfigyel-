import { createHash } from "node:crypto";
import { z } from "zod";
import { MODULE_LABELS, MODULES, type Module } from "./esemeny.ts";

/**
 * Közös Teendők és hivatkozások (TERV.md F18, I6).
 *
 * - **Programfüggetlen hivatkozás** (`ModuleLink`): melyik program, és azon belül melyik útvonal (a program
 *   saját felületének relatív címe, pl. `/konyveles/<id>` vagy `#/mozgasok`). Ma a program webcímére fordul
 *   le (`resolveModuleLink`), a közös felületen (TERV.md C pont) majd a keret belső útvonalára.
 * - **Teendő-tükör:** minden program cégenként elküldi a nyitott Teendőinek *teljes* listáját a központnak
 *   (`PUT /api/v1/modul/teendok`). Ez állapot, nem esemény: az újabb lista felülírja az előzőt, ezért ha
 *   egy küldés elmarad, a következő pótolja, és semmi nem duplázódik. A program csak akkor küld, ha a lista
 *   lenyomata változott, vagy ha az utolsó küldés óta letelt a frissítési idő.
 * - **A többi program Teendői** (`GET /api/v1/modul/teendok?companyRef=…`): a központ a kérdező program
 *   saját Teendőit kihagyja. Csak az összekapcsolt cég Teendői kérhetők le: adószámmal soha (D13).
 */

export const MODULE_TODOS_PATH = "api/v1/modul/teendok";
/** Ennyi idő után akkor is újraküldi a program a listát, ha nem változott (a központ így önmagát gyógyítja). */
export const TODO_MIRROR_REFRESH_MS = 10 * 60_000;
export const TODO_MIRROR_MAX = 500;

export const moduleLinkSchema = z.object({
  module: z.enum(MODULES),
  /** A program felületén belüli relatív útvonal: `/…` vagy `#/…`; teljes webcím nem lehet. */
  path: z
    .string()
    .min(1)
    .max(500)
    .regex(/^(\/|#\/)/, "A hivatkozás a program felületén belüli útvonal legyen (/… vagy #/…).")
    .refine((p) => !p.startsWith("//"), "A hivatkozás nem mutathat más webhelyre."),
});
export type ModuleLink = z.infer<typeof moduleLinkSchema>;

export const moduleTodoSchema = z.object({
  /** A programon belül egyedi, állandó kulcs (ugyanaz a Teendő mindig ugyanazzal a kulccsal). */
  key: z.string().min(1).max(200),
  kind: z.string().min(1).max(60),
  title: z.string().min(1).max(300),
  detail: z.string().max(2000).nullable().optional(),
  link: moduleLinkSchema.nullable().optional(),
  /** Mióta nyitott (ISO időpont), ha a program tudja. */
  since: z.string().datetime({ offset: true }).nullable().optional(),
});
export type ModuleTodo = z.infer<typeof moduleTodoSchema>;

export const todoMirrorSchema = z.object({
  companyRef: z.string().min(1).max(100),
  todos: z.array(moduleTodoSchema).max(TODO_MIRROR_MAX),
});
export type TodoMirror = z.infer<typeof todoMirrorSchema>;

/** A központ válasza: a cég többi programjának (és a központnak) nyitott Teendői. */
export const sharedTodoSchema = z.object({
  /** Melyik program Teendője; a központ saját Teendője (pl. átadási hiba): `kozpont`. */
  module: z.enum([...MODULES, "kozpont"]),
  moduleLabel: z.string(),
  key: z.string(),
  kind: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  link: moduleLinkSchema.nullable(),
  since: z.string().nullable(),
});
export type SharedTodo = z.infer<typeof sharedTodoSchema>;

export const sharedTodosAnswerSchema = z.object({
  todos: z.array(sharedTodoSchema),
  /** A cég összekapcsolt programjai és a legutóbbi Teendő-listájuk ideje (null: még nem küldött). */
  modules: z.array(z.object({ module: z.enum(MODULES), moduleLabel: z.string(), mirroredAt: z.string().nullable() })),
});
export type SharedTodosAnswer = z.infer<typeof sharedTodosAnswerSchema>;

export const HUB_LABEL = "Integrációs központ";
export const moduleLabel = (m: Module | "kozpont") => (m === "kozpont" ? HUB_LABEL : MODULE_LABELS[m]);

/**
 * A lista lenyomata (a sorrendtől független): a program ebből látja, hogy változott-e az utolsó küldés óta.
 * Ugyanezt számolja a Java oldal is (eÁFA), ezért a kanonikus alak rögzített: kulcs szerint rendezve,
 * mezőnként `key|kind|title|detail|module|path|since`, sorvége `\n`; a hiányzó mező üres.
 */
export function todoMirrorHash(todos: readonly ModuleTodo[]): string {
  const lines = [...todos]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((t) => [t.key, t.kind, t.title, t.detail ?? "", t.link?.module ?? "", t.link?.path ?? "", t.since ?? ""].map((x) => x.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", "\\n")).join("|"));
  return createHash("sha256").update(lines.map((l) => `${l}\n`).join(""), "utf8").digest("hex");
}

/**
 * A hivatkozás webcíme: a program alapcíme + az útvonal. Ha a program címe nincs beállítva, null (a
 * felület ekkor csak a szöveget mutatja). A hivatkozás ugyanabban a fülben nyílik (TERV.md C5).
 */
export function resolveModuleLink(link: ModuleLink | null | undefined, bases: Partial<Record<Module, string | null | undefined>>): string | null {
  if (!link) return null;
  const parsed = moduleLinkSchema.safeParse(link);
  if (!parsed.success) return null;
  const base = bases[link.module]?.trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}${link.path.startsWith("#") ? "/" : ""}${link.path}`;
}
