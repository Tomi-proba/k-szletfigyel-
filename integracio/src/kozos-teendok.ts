import type pg from "pg";
import { TODO_MIRROR_REFRESH_MS, todoMirrorHash, type HubClient, type ModuleTodo } from "../esemenyek/src/index.ts";

/**
 * Közös Teendők (TERV.md F18, I6) a Készlet oldalán:
 * - a Készlet cégenként elküldi a nyitott Teendőinek teljes listáját a központnak (csak változáskor, de
 *   legalább 10 percenként; ha nem sikerül, a következő kör pótolja);
 * - letölti a cég többi programjának Teendőit (csak a címet és a hivatkozást), és az adatbázisba teszi:
 *   a böngésző a központot nem éri el, csak a public.integracio_kozos_teendok() függvényt hívhatja.
 *
 * Nem kerül a listába, ami egy másik program állapotának visszhangja (az egyeztetés eredménye), és a
 * központ elérhetetlensége (ilyenkor a lista sem jutna el).
 */

const VISSZHANG = ["EGYEZTETES", "KOZPONT_NEM_ERHETO_EL"];

export async function teendoTukor(client: pg.ClientBase | pg.Pool, ceg: string): Promise<ModuleTodo[]> {
  const ki: ModuleTodo[] = [];
  const t = await client.query<{ id: string; fajta: string; cim: string; reszletek: string | null; letrehozva: Date }>(
    "SELECT id, fajta, cim, reszletek, letrehozva FROM integracio.teendok WHERE company_id = $1 AND megoldva IS NULL AND NOT (fajta = ANY($2)) ORDER BY letrehozva, id",
    [ceg, VISSZHANG],
  );
  for (const x of t.rows) {
    ki.push({
      key: `integracio:${x.id}`,
      kind: x.fajta,
      title: x.cim,
      detail: x.reszletek,
      link: { module: "keszlet", path: x.fajta === "BEERKEZO" ? "#/jovahagyasra-var" : "#/beallitasok" },
      since: x.letrehozva.toISOString(),
    });
  }
  const m = await client.query<{ integracios: string; iroda: string }>(
    `SELECT count(*) FILTER (WHERE integracio_esemeny_id IS NOT NULL OR return_of_movement_id IS NOT NULL)::text AS integracios,
            count(*) FILTER (WHERE integracio_esemeny_id IS NULL AND return_of_movement_id IS NULL)::text AS iroda
       FROM public.movements WHERE company_id = $1 AND approval_status = 'pending' AND deleted_at IS NULL`,
    [ceg],
  );
  const integracios = Number(m.rows[0]?.integracios ?? 0);
  const iroda = Number(m.rows[0]?.iroda ?? 0);
  if (integracios) ki.push({ key: "beerkezesre-kiadasra-var", kind: "JOVAHAGYANDO", title: `${integracios} tétel vár beérkezésre vagy kiadásra a raktárban`, link: { module: "keszlet", path: "#/jovahagyasra-var" } });
  if (iroda) ki.push({ key: "iroda-jovahagyas", kind: "JOVAHAGYAS", title: `${iroda} mozgás vár a fő iroda jóváhagyására`, link: { module: "keszlet", path: "#/jovahagyasok" } });
  const k = await client.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM public.products WHERE company_id = $1 AND deleted_at IS NULL AND min_stock > 0 AND current_stock < min_stock",
    [ceg],
  );
  const alacsony = Number(k.rows[0]?.n ?? 0);
  if (alacsony) ki.push({ key: "minimum-alatt", kind: "ALACSONY_KESZLET", title: `${alacsony} termék készlete a minimum alatt`, link: { module: "keszlet", path: "#/riasztasok" } });
  return ki;
}

export type KozosEredmeny = { kuldve: number; valtozatlan: number; letoltve: number; hibas: number };

/** Egy kör az összes összekapcsolt cégre: a saját lista küldése (ha kell) és a többieké letöltése. */
export async function kozosTeendokKor(pool: pg.Pool, hub: HubClient, most = new Date()): Promise<KozosEredmeny> {
  const e: KozosEredmeny = { kuldve: 0, valtozatlan: 0, letoltve: 0, hibas: 0 };
  const cegek = await pool.query<{ company_id: string; osszekapcsolva: Date }>(
    "SELECT company_id, osszekapcsolva FROM integracio.beallitas WHERE osszekapcsolva IS NOT NULL AND bontva IS NULL",
  );
  for (const c of cegek.rows) {
    const ceg = c.company_id;
    try {
      const todos = await teendoTukor(pool, ceg);
      const lenyomat = todoMirrorHash(todos);
      const elozo = (await pool.query<{ lenyomat: string; kapcsolat: Date | null; kuldve: Date }>("SELECT lenyomat, kapcsolat, kuldve FROM integracio.teendo_tukor WHERE company_id = $1", [ceg])).rows[0];
      const friss = elozo && elozo.lenyomat === lenyomat && elozo.kapcsolat?.getTime() === c.osszekapcsolva.getTime() && most.getTime() - elozo.kuldve.getTime() < TODO_MIRROR_REFRESH_MS;
      if (friss) e.valtozatlan++;
      else {
        await hub.mirrorTodos(ceg, todos);
        await pool.query(
          `INSERT INTO integracio.teendo_tukor (company_id, lenyomat, kapcsolat, kuldve) VALUES ($1, $2, $3, $4)
           ON CONFLICT (company_id) DO UPDATE SET lenyomat = EXCLUDED.lenyomat, kapcsolat = EXCLUDED.kapcsolat, kuldve = EXCLUDED.kuldve`,
          [ceg, lenyomat, c.osszekapcsolva, most],
        );
        e.kuldve++;
      }
    } catch {
      e.hibas++;
    }
    try {
      const a = await hub.sharedTodos(ceg);
      // Csak a cím és a hivatkozás kerül ide (döntés 2026-11-01); a részletek nem.
      const teendok = a.todos.map((t) => ({ modul: t.module, modulNev: t.moduleLabel, cim: t.title, hivatkozas: t.link, ota: t.since }));
      const modulok = a.modules.filter((m) => m.module !== "keszlet").map((m) => ({ modulNev: m.moduleLabel, kuldve: m.mirroredAt }));
      await pool.query(
        `INSERT INTO integracio.kozos_teendok (company_id, allapot, teendok, modulok, lekerve) VALUES ($1, 'OK', $2, $3, $4)
         ON CONFLICT (company_id) DO UPDATE SET allapot = 'OK', teendok = EXCLUDED.teendok, modulok = EXCLUDED.modulok, lekerve = EXCLUDED.lekerve`,
        [ceg, JSON.stringify(teendok), JSON.stringify(modulok), most],
      );
      e.letoltve++;
    } catch {
      await pool.query("UPDATE integracio.kozos_teendok SET allapot = 'KOZPONT_NEM_ERHETO_EL' WHERE company_id = $1", [ceg]).catch(() => undefined);
      e.hibas++;
    }
  }
  return e;
}
