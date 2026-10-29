import type pg from "pg";
import type { EventEnvelope, HubClient } from "../esemenyek/src/index.ts";
import { tranzakcio } from "./db.ts";
import { teendoLezaras, teendoNyitas } from "./teendok.ts";

/**
 * Az átadó (TERV.md F15.2): a kimenő tábla eseményeit adja át a központnak, és a központba is bejelentett
 * Teendők megoldását jelzi. Több példány is futhat: a sorokat zárolva veszi ki. Az esemény csak a központ
 * visszaigazolása után számít elküldöttnek; az ismételt átadás nem baj, mert a központ az azonosító
 * szerint egyszer veszi át. Ha a központ nem érhető el, az események várnak, és 30 perc után Teendő lesz.
 */

export const KOZPONT_NEM_ERHETO_EL_PERC = 30;
const KOZPONT_TEENDO = "kozpont-nem-erheto-el";

export type AtadasEredmeny = { elkuldve: number; sikertelen: number; hiba: string | null; teendoJelentve: number };

export async function atadas(pool: pg.Pool, hub: HubClient, now = new Date(), batch = 100): Promise<AtadasEredmeny> {
  const kor = await tranzakcio(pool, async (client) => {
    const rows = await client.query<{ id: string; envelope: EventEnvelope }>(
      "SELECT id, envelope FROM integracio.integration_outbox WHERE sent_at IS NULL ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED",
      [batch],
    );
    if (!rows.rowCount) return { elkuldve: 0, sikertelen: 0, hiba: null as string | null };
    try {
      const r = await hub.publish(rows.rows.map((x) => x.envelope));
      const atvett = new Set(r.accepted);
      const elutasitott = new Map(r.rejected.map((x) => [x.id, x.error]));
      for (const row of rows.rows) {
        if (atvett.has(row.id)) {
          await client.query("UPDATE integracio.integration_outbox SET sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1", [row.id]);
        } else {
          await client.query("UPDATE integracio.integration_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1", [row.id, elutasitott.get(row.id) ?? "A központ nem vette át."]);
        }
      }
      const sikertelen = rows.rows.length - atvett.size;
      return { elkuldve: atvett.size, sikertelen, hiba: sikertelen ? "A központ nem vette át az összes eseményt." : null };
    } catch (e) {
      const uzenet = e instanceof Error ? e.message : String(e);
      await client.query("UPDATE integracio.integration_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = ANY($1::uuid[])", [rows.rows.map((r) => r.id), uzenet]);
      return { elkuldve: 0, sikertelen: rows.rows.length, hiba: uzenet };
    }
  });

  // A központba bejelentett Teendők megoldásának jelzése (ha nem sikerül, a következő körben újra).
  let teendoJelentve = 0;
  const megoldott = await pool.query<{ id: string; company_id: string; hub_kulcs: string }>(
    "SELECT id, company_id, hub_kulcs FROM integracio.teendok WHERE megoldva IS NOT NULL AND hub_kulcs IS NOT NULL AND hub_jelentve IS NULL LIMIT 100",
  );
  for (const t of megoldott.rows) {
    try {
      await hub.resolveTodo(t.company_id, t.hub_kulcs);
      await pool.query("UPDATE integracio.teendok SET hub_jelentve = now() WHERE id = $1", [t.id]);
      teendoJelentve++;
    } catch {
      // a központ most nem érhető el; a következő körben újra
    }
  }

  await allapotTeendok(pool, now);
  // A központ kéréseinek nonce-ai csak az aláírás érvényességi idejéig kellenek (5 perc, bőven ráhagyva).
  await pool.query("DELETE FROM integracio.nonces WHERE erkezett < now() - interval '1 hour'");
  return { ...kor, teendoJelentve };
}

/** Cégenként: ha egy esemény 30 perce vár, „A központ nem érhető el” Teendő; ha már semmi nem vár, lezárul. */
export async function allapotTeendok(pool: pg.Pool, now = new Date()): Promise<void> {
  await tranzakcio(pool, async (client) => {
    const varo = await client.query<{ ceg: string; n: number; legregebbi: Date; hiba: string | null }>(`
      SELECT envelope -> 'source' ->> 'companyRef' AS ceg, count(*)::int AS n, min(created_at) AS legregebbi,
             (array_agg(last_error ORDER BY created_at DESC))[1] AS hiba
        FROM integracio.integration_outbox WHERE sent_at IS NULL GROUP BY 1`);
    const vannak = new Set(varo.rows.map((r) => r.ceg));
    for (const r of varo.rows) {
      if (now.getTime() - new Date(r.legregebbi).getTime() < KOZPONT_NEM_ERHETO_EL_PERC * 60_000) continue;
      await teendoNyitas(client, r.ceg, {
        kulcs: KOZPONT_TEENDO,
        fajta: "KOZPONT_NEM_ERHETO_EL",
        cim: `Az integrációs központ ${KOZPONT_NEM_ERHETO_EL_PERC} perce nem veszi át az eseményeket (${r.n} esemény vár).`,
        reszletek: `Az események nem vesztek el, és a Készlet zavartalanul használható: amint a központ elérhető, átadjuk őket. Utolsó hiba: ${r.hiba ?? "ismeretlen"}.`,
      });
    }
    const nyitott = await client.query<{ company_id: string }>("SELECT company_id FROM integracio.teendok WHERE kulcs = $1 AND megoldva IS NULL", [KOZPONT_TEENDO]);
    for (const t of nyitott.rows) if (!vannak.has(t.company_id)) await teendoLezaras(client, t.company_id, KOZPONT_TEENDO);
  });
}
