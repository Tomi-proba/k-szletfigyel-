import pg from "pg";

/**
 * Adatbázis-kapcsolat a Készlet adatbázisához (Supabase vagy bármely PostgreSQL). A szolgáltatás az
 * „integracio” sémában dolgozik, a közös eseménycsomag táblanevei (integration_outbox, …) ezért a
 * keresési útvonalon érhetők el. Supabase-nél a KÖZVETLEN (munkamenet-módú, 5432-es) kapcsolat kell,
 * nem a tranzakció-módú pooler, mert a keresési útvonal a kapcsolathoz tartozik (ELESITES.md).
 */
export function ujPool(connectionString: string, max = 5): pg.Pool {
  const pool = new pg.Pool({ connectionString, max });
  pool.on("connect", (client) => {
    void client.query("SET search_path TO integracio, public");
  });
  return pool;
}

export async function tranzakcio<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
