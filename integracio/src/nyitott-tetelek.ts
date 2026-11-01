import type pg from "pg";
import { HubError, type HubClient } from "../esemenyek/src/index.ts";

/**
 * A Könyvelő nyitott tételei (TERV.md F19, I6b, KK10): a szolgáltatás cégenként letölti a központból a
 * Könyvelő nyitott szállítói és vevői tételeit, és az adatbázisba teszi (a böngésző a központot nem éri el).
 * - Ha a cégnek nincs Könyvelője, vagy a Könyvelő → Készlet kapcsolat ki van kapcsolva, a sort töröljük: a
 *   Készlet a saját számítását mutatja, mint eddig.
 * - Ha a központ nem érhető el, a legutóbbi lista marad, és az állapot ezt jelzi.
 */
export type NyitottEredmeny = { letoltve: number; nincs: number; hibas: number };

export async function nyitottTetelekKor(pool: pg.Pool, hub: HubClient, most = new Date()): Promise<NyitottEredmeny> {
  const e: NyitottEredmeny = { letoltve: 0, nincs: 0, hibas: 0 };
  const cegek = await pool.query<{ company_id: string }>("SELECT company_id FROM integracio.beallitas WHERE osszekapcsolva IS NOT NULL AND bontva IS NULL");
  for (const { company_id: ceg } of cegek.rows) {
    try {
      const a = await hub.openItems(ceg);
      await pool.query(
        `INSERT INTO integracio.konyvelo_nyitott (company_id, allapot, adat, allapot_napja, kuldve, lekerve) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (company_id) DO UPDATE SET allapot = EXCLUDED.allapot, adat = EXCLUDED.adat, allapot_napja = EXCLUDED.allapot_napja,
           kuldve = EXCLUDED.kuldve, lekerve = EXCLUDED.lekerve`,
        [ceg, a.state === "OK" ? "OK" : "NINCS_ADAT", JSON.stringify({ items: a.items, pendingDrafts: a.pendingDrafts }), a.asOf, a.mirroredAt, most],
      );
      e.letoltve++;
    } catch (err) {
      if (err instanceof HubError && (err.status === 409 || err.status === 404)) {
        // Nincs Könyvelő, vagy a kapcsolat ki van kapcsolva: a Készlet a saját számítását mutatja.
        await pool.query("DELETE FROM integracio.konyvelo_nyitott WHERE company_id = $1", [ceg]);
        e.nincs++;
      } else {
        await pool.query("UPDATE integracio.konyvelo_nyitott SET allapot = 'KOZPONT_NEM_ERHETO_EL' WHERE company_id = $1", [ceg]).catch(() => undefined);
        e.hibas++;
      }
    }
  }
  // Bontott cég listája nem maradhat meg.
  await pool.query("DELETE FROM integracio.konyvelo_nyitott k WHERE NOT integracio.osszekapcsolt(k.company_id)");
  return e;
}
