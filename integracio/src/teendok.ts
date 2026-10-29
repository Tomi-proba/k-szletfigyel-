import type pg from "pg";

/** A Készlet integrációs Teendői (integracio.teendok). Egy kulcshoz egyszerre egy nyitott Teendő tartozik. */
export type UjTeendo = { kulcs: string; fajta: string; cim: string; reszletek?: string | null; valtozasId?: number | null; hubKulcs?: string | null };

export async function teendoNyitas(client: pg.ClientBase, companyId: string, t: UjTeendo): Promise<void> {
  await client.query(
    `INSERT INTO integracio.teendok (company_id, kulcs, fajta, cim, reszletek, valtozas_id, hub_kulcs)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (company_id, kulcs) WHERE megoldva IS NULL DO UPDATE SET cim = EXCLUDED.cim, reszletek = EXCLUDED.reszletek`,
    [companyId, t.kulcs, t.fajta, t.cim.slice(0, 300), t.reszletek ?? null, t.valtozasId ?? null, t.hubKulcs ?? null],
  );
}

export async function teendoLezaras(client: pg.ClientBase, companyId: string, kulcs: string): Promise<void> {
  await client.query("UPDATE integracio.teendok SET megoldva = now() WHERE company_id = $1 AND kulcs = $2 AND megoldva IS NULL", [companyId, kulcs]);
}
