import { createHash } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type pg from "pg";
import { applyOnce } from "../esemenyek/src/postgres.ts";
import { INBOUND_PATH, LINK_PATH, registryOf, validateEvent, verifyHubRequest, type InboundResult } from "../esemenyek/src/index.ts";
import { tranzakcio } from "./db.ts";
import { FogadoHiba, KEZELOK, kezelo, type Kezelok } from "./kezelok.ts";
import { adoszam } from "./osszeallito.ts";

/**
 * A központ felőli, aláírt végpontok (TERV.md F15.2):
 * - `POST /api/integracio/v1/kapcsolodas`: kapcsolódási kód beváltása (D13). Csak a Készletben, a fő
 *   iroda által készített, egyszer használható, lejáró kóddal; az adószám csak kiegészítő ellenőrzés.
 * - `DELETE /api/integracio/v1/kapcsolodas/:companyRef`: az összekapcsolás bontása.
 * - `POST /api/integracio/v1/bejovo`: egy esemény átadása, pontosan egyszer (applyOnce).
 * - `GET /egeszseg`: aláírás nélkül, csak azt mondja meg, fut-e és eléri-e az adatbázist.
 *
 * Minden aláírt kérés HMAC-cal, időbélyeggel és egyszer használható nonce-szal védett.
 */

const registry = registryOf();
const MAX_TORZS = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const kodAlak = (kod: string) => kod.toUpperCase().replace(/[^A-Z0-9]/g, "");
const szamjegyek = (t: string) => t.replace(/\D/g, "");

function torzs(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let hossz = 0;
    req.on("data", (c: Buffer) => {
      hossz += c.length;
      if (hossz > MAX_TORZS) {
        reject(new FogadoHiba(413, "TOO_LARGE", "A kérés túl nagy."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function valasz(res: ServerResponse, status: number, data: unknown) {
  if (status === 204) return res.writeHead(204).end();
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(data));
}

function json(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object") return v as Record<string, unknown>;
  } catch {
    // alább
  }
  throw new FogadoHiba(400, "BAD_REQUEST", "A kérés törzse nem érvényes JSON.");
}

export type FogadoBeallitas = { pool: pg.Pool; titok: string | null; kezelok?: Kezelok; log?: (msg: string, err?: unknown) => void };

export function fogado(o: FogadoBeallitas): RequestListener {
  // A tesztek egy-egy kezelőt felülírhatnak; a többi a valódi.
  const kezel = kezelo({ ...KEZELOK, ...o.kezelok });
  return (req, res) => {
    void (async () => {
      const url = req.url ?? "/";
      if (req.method === "GET" && url === "/egeszseg") {
        await o.pool.query("SELECT 1");
        return valasz(res, 200, { ok: true });
      }
      const raw = await torzs(req);
      if (!o.titok) throw new FogadoHiba(404, "NOT_CONFIGURED", "Az integráció nincs beállítva ebben a Készletben (KOZPONT_URL, KOZPONT_TITOK).");
      const check = verifyHubRequest(req.headers, req.method ?? "", url, raw, o.titok);
      if (!check.ok) throw new FogadoHiba(401, check.code, check.message);
      const friss = await o.pool.query("INSERT INTO integracio.nonces (nonce) VALUES ($1) ON CONFLICT DO NOTHING RETURNING nonce", [check.nonce]);
      if (!friss.rowCount) throw new FogadoHiba(401, "REPLAYED", "Ezt a kérést már egyszer fogadtuk (ismételt nonce).");

      if (req.method === "POST" && url === LINK_PATH) return valasz(res, 200, await kapcsolodas(o.pool, json(raw)));
      if (req.method === "DELETE" && url.startsWith(`${LINK_PATH}/`)) {
        await bontas(o.pool, decodeURIComponent(url.slice(LINK_PATH.length + 1)));
        return valasz(res, 204, null);
      }
      if (req.method === "POST" && url === INBOUND_PATH) return valasz(res, 200, await bejovo(o.pool, json(raw), kezel));
      throw new FogadoHiba(404, "NOT_FOUND", "Nincs ilyen végpont.");
    })().catch((e: unknown) => {
      if (e instanceof FogadoHiba) return valasz(res, e.status, { code: e.code, message: e.message });
      o.log?.("Integráció: hiba a kérés feldolgozásában.", e);
      return valasz(res, 500, { code: "INTERNAL", message: "A Készlet belső hibát jelzett; a központ később újrapróbálja." });
    });
  };
}

/** Kapcsolódási kód beváltása (D13). Sikeres összekapcsoláskor a termékek és a partnerek is kimennek. */
export async function kapcsolodas(pool: pg.Pool, body: Record<string, unknown>) {
  const kod = kodAlak(String(body.code ?? ""));
  const ado = szamjegyek(String(body.taxNumber ?? ""));
  const ervenytelen = () => new FogadoHiba(422, "INVALID_CODE", "A kapcsolódási kód érvénytelen, lejárt vagy már felhasználták, vagy nem ehhez a céghez tartozik.");
  if (kod.length !== 16) throw ervenytelen();
  return tranzakcio(pool, async (c) => {
    const r = await c.query<{ id: string; company_id: string; adoszam: string; name: string }>(
      `SELECT k.id, k.company_id, k.adoszam, co.name FROM integracio.kapcsolodasi_kodok k JOIN public.companies co ON co.id = k.company_id
        WHERE k.kod_hash = $1 AND k.felhasznalva IS NULL AND k.visszavonva IS NULL AND k.lejar > now() FOR UPDATE OF k`,
      [sha(kod)],
    );
    const sor = r.rows[0];
    // A kód mellé a teljes adószám is egyezzen, de az adószám önmagában soha nem elég.
    if (!sor || sor.adoszam !== ado) throw ervenytelen();
    await c.query("UPDATE integracio.kapcsolodasi_kodok SET felhasznalva = now() WHERE id = $1", [sor.id]);
    const elotte = await c.query("SELECT 1 FROM integracio.beallitas WHERE company_id = $1 AND osszekapcsolva IS NOT NULL AND bontva IS NULL", [sor.company_id]);
    await c.query(
      `INSERT INTO integracio.beallitas (company_id, adoszam, osszekapcsolva, bontva, kod_id, modositva) VALUES ($1, $2, now(), NULL, $3, now())
       ON CONFLICT (company_id) DO UPDATE SET adoszam = EXCLUDED.adoszam, osszekapcsolva = now(), bontva = NULL, kod_id = EXCLUDED.kod_id, modositva = now()`,
      [sor.company_id, sor.adoszam, sor.id],
    );
    if (!elotte.rowCount) {
      // A termékjegyzék és az adószámos partnerek kezdő átadása (a Könyvelő termékkérdéséhez és partneregyeztetéséhez).
      await c.query(
        `INSERT INTO integracio.valtozasok (company_id, fajta, rekord_id, pillanatkep)
         SELECT company_id, 'termek', id::text, to_jsonb(p) FROM public.products p WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at, id`,
        [sor.company_id],
      );
      for (const t of ["suppliers", "customers"]) {
        await c.query(
          `INSERT INTO integracio.valtozasok (company_id, fajta, rekord_id, pillanatkep)
           SELECT company_id, 'partner', '${t}:' || id::text, to_jsonb(x) || jsonb_build_object('tabla', '${t}')
             FROM public.${t} x WHERE company_id = $1 AND deleted_at IS NULL AND nullif(btrim(tax_number), '') IS NOT NULL ORDER BY created_at, id`,
          [sor.company_id],
        );
      }
    }
    await c.query(
      `INSERT INTO public.audit_log (company_id, entity_type, entity_id, entity_label, action, description, created_by, created_by_name)
       VALUES ($1::uuid, 'integracio', $1::text, 'Integráció', 'create', 'A cég összekapcsolva a többi programmal (kapcsolódási kóddal, az integrációs központon át)', NULL, 'Integrációs központ')`,
      [sor.company_id],
    );
    return { companyRef: sor.company_id, companyName: sor.name, taxNumber: adoszam(sor.adoszam) };
  });
}

export async function bontas(pool: pg.Pool, companyRef: string): Promise<void> {
  if (!UUID.test(companyRef)) throw new FogadoHiba(404, "NOT_FOUND", "A cég nem található.");
  await tranzakcio(pool, async (c) => {
    const r = await c.query("UPDATE integracio.beallitas SET bontva = now(), modositva = now() WHERE company_id = $1 AND osszekapcsolva IS NOT NULL AND bontva IS NULL RETURNING company_id", [companyRef]);
    if (r.rowCount) {
      await c.query(
        `INSERT INTO public.audit_log (company_id, entity_type, entity_id, entity_label, action, description, created_by, created_by_name)
         VALUES ($1::uuid, 'integracio', $1::text, 'Integráció', 'delete', 'Az összekapcsolás bontva (az integrációs központ felől)', NULL, 'Integrációs központ')`,
        [companyRef],
      );
    }
  });
}

export async function bejovo(pool: pg.Pool, body: Record<string, unknown>, kezel: ReturnType<typeof kezelo>): Promise<InboundResult> {
  const v = validateEvent(body.event, registry);
  if (!v.ok) throw new FogadoHiba(422, "INVALID_EVENT", v.error);
  if (v.event.source.module === "keszlet") throw new FogadoHiba(422, "INVALID_EVENT", "A Készlet a saját eseményét nem fogadja.");
  const ceg = String(body.targetCompanyRef ?? "");
  if (!UUID.test(ceg)) throw new FogadoHiba(404, "NOT_FOUND", "A cég nem található.");
  const linked = await pool.query("SELECT integracio.osszekapcsolt($1) AS ok", [ceg]);
  if (!linked.rows[0]?.ok) throw new FogadoHiba(409, "NOT_LINKED", "A cég ebben a Készletben nincs összekapcsolva a központtal.");
  return applyOnce(pool, { event: v.event, targetCompanyRef: ceg }, async (client, d) => {
    // Amit a kezelő a Készlet tábláiban változtat, a trigger ehhez az eseményhez köti (visszhang tiltása).
    await client.query("SELECT set_config('integracio.oka_esemeny', $1, true)", [d.event.id]);
    return kezel(client, d);
  });
}
