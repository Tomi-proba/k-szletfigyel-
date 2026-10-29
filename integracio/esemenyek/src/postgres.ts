import type pg from "pg";
import { validateEvent, type EventEnvelope, type EventRegistry, type InboundDelivery, type InboundResult } from "./esemeny.ts";

/**
 * A kimenő és bejövő tábla a TypeScript-modulokhoz (Könyvelő, Készlet), PostgreSQL-en (TERV.md F1).
 *
 * - **Kimenő tábla (outbox):** az eseményt a modul UGYANABBAN a tranzakcióban írja be, mint magát a
 *   műveletet (`enqueueEvent`). Ha a művelet visszagörgetődik, esemény sem marad; ha sikerül, az esemény
 *   biztosan megvan. A `relayOutbox` adja át a központnak, és csak a visszaigazolás után jelöli
 *   elküldöttnek; az ismételt átadás nem baj, mert a központ az azonosító szerint egyszer veszi át.
 * - **Bejövő tábla (inbox):** az `applyOnce` az esemény azonosítóját UGYANABBAN a tranzakcióban rögzíti,
 *   mint a hatást. Ha ugyanaz az esemény újra megérkezik, nem hat még egyszer.
 */

export const INTEGRATION_DDL = `
CREATE TABLE IF NOT EXISTS integration_outbox (
  id          uuid PRIMARY KEY,
  envelope    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text
);
CREATE INDEX IF NOT EXISTS integration_outbox_unsent_idx ON integration_outbox (created_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS integration_inbox (
  event_id     uuid PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now(),
  outcome      text NOT NULL,
  result       jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_sequences (
  record_type  text NOT NULL,
  record_id    text NOT NULL,
  last_value   integer NOT NULL,
  PRIMARY KEY (record_type, record_id)
);
`;

/** A következő sorszám egy forrásrekord eseményeihez (a hívó tranzakciójában). */
export async function nextSequence(client: pg.ClientBase, recordType: string, recordId: string): Promise<number> {
  const r = await client.query<{ last_value: number }>(
    `INSERT INTO integration_sequences (record_type, record_id, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (record_type, record_id) DO UPDATE SET last_value = integration_sequences.last_value + 1
     RETURNING last_value`,
    [recordType, recordId],
  );
  return r.rows[0]!.last_value;
}

/**
 * Esemény a kimenő táblába, a HÍVÓ tranzakciójában. Hibás eseményt nem fogad el (a művelet ekkor
 * visszagörgethető, nem marad félkész állapot).
 */
export async function enqueueEvent(client: pg.ClientBase, event: EventEnvelope, registry?: EventRegistry): Promise<void> {
  const v = validateEvent(event, registry);
  if (!v.ok) throw new Error(v.error);
  await client.query("INSERT INTO integration_outbox (id, envelope) VALUES ($1, $2)", [event.id, JSON.stringify(v.event)]);
}

export type RelayResult = { sent: number; failed: number; error: string | null };

/**
 * A kimenő tábla átadása a központnak. Több példány is futhat egyszerre: a sorokat zárolva veszi ki,
 * így egy esemény egy időben csak egy átadásban van. A `publish` a központ visszaigazolása: az ott
 * átvett azonosítók.
 */
export async function relayOutbox(pool: pg.Pool, publish: (events: EventEnvelope[]) => Promise<{ accepted: string[] }>, batch = 100): Promise<RelayResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query<{ id: string; envelope: EventEnvelope }>(
      "SELECT id, envelope FROM integration_outbox WHERE sent_at IS NULL ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED",
      [batch],
    );
    if (!rows.rowCount) {
      await client.query("COMMIT");
      return { sent: 0, failed: 0, error: null };
    }
    let accepted: Set<string>;
    try {
      accepted = new Set((await publish(rows.rows.map((r) => r.envelope))).accepted);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await client.query("UPDATE integration_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = ANY($1::uuid[])", [rows.rows.map((r) => r.id), message]);
      await client.query("COMMIT");
      return { sent: 0, failed: rows.rowCount, error: message };
    }
    const ids = rows.rows.map((r) => r.id).filter((id) => accepted.has(id));
    const rejected = rows.rows.map((r) => r.id).filter((id) => !accepted.has(id));
    if (ids.length) await client.query("UPDATE integration_outbox SET sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ANY($1::uuid[])", [ids]);
    if (rejected.length) {
      await client.query("UPDATE integration_outbox SET attempts = attempts + 1, last_error = 'A központ nem vette át' WHERE id = ANY($1::uuid[])", [rejected]);
    }
    await client.query("COMMIT");
    return { sent: ids.length, failed: rejected.length, error: rejected.length ? "A központ nem vette át az összes eseményt." : null };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Egy beérkezett esemény végrehajtása pontosan egyszer. Az `apply` a hatást a kapott kliensen
 * (ugyanabban a tranzakcióban) végzi; ha hibát dob, semmi nem marad meg, és a központ később újra
 * próbálja. Ha az esemény már hatott, az akkori eredményt adja vissza `DUPLICATE` jelöléssel. A
 * `PARKED` (félretett) eredménynél semmi nem marad meg: a központ később újraküldi, és akkor újra fut.
 */
export async function applyOnce(
  pool: pg.Pool,
  delivery: InboundDelivery,
  apply: (client: pg.PoolClient, delivery: InboundDelivery) => Promise<InboundResult>,
): Promise<InboundResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Ha egy másik átadás épp ugyanezt végzi, ez a beszúrás megvárja, és utána ütközést jelez.
    const inserted = await client.query(
      "INSERT INTO integration_inbox (event_id, outcome, result) VALUES ($1, 'PENDING', '{}') ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
      [delivery.event.id],
    );
    if (!inserted.rowCount) {
      await client.query("ROLLBACK");
      // Ugyanazon a kapcsolaton olvasunk: egy második kapcsolat kérése közben a pool elfogyhatna.
      const prev = await client.query<{ result: InboundResult }>("SELECT result FROM integration_inbox WHERE event_id = $1", [delivery.event.id]);
      return { ...(prev.rows[0]?.result ?? {}), outcome: "DUPLICATE" };
    }
    const result = await apply(client, delivery);
    // A félretett esemény még nem hatott: nem rögzítjük, hogy a központ újraküldésekor újra feldolgozható legyen.
    if (result.outcome === "PARKED") {
      await client.query("ROLLBACK");
      return result;
    }
    await client.query("UPDATE integration_inbox SET outcome = $2, result = $3 WHERE event_id = $1", [delivery.event.id, result.outcome, JSON.stringify(result)]);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
