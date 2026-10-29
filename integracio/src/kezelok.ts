import type pg from "pg";
import type { InboundDelivery, InboundResult } from "../esemenyek/src/index.ts";

/**
 * A beérkező események kezelői (TERV.md F15.3–F15.4). A kezelő a kapott kliensen, a bejövő tábla
 * bejegyzésével EGY tranzakcióban dolgozik (applyOnce), így minden esemény pontosan egyszer hat.
 *
 * A tényleges kezelők az I3 4. lépésében készülnek. Addig a tervezett típusok PARKED választ kapnak:
 * semmi nem rögzül, a központ később újraküldi őket. Ismeretlen típusra vagy verzióra végleges
 * elutasítás (422) a válasz: a központ ezt „Átadási hiba” Teendőként mutatja, és az esemény a Készlet
 * frissítése után a központból újraküldhető. Így egyik eset sem veszhet el csendben.
 */

export type Kezelo = (client: pg.PoolClient, d: InboundDelivery) => Promise<InboundResult>;
export type Kezelok = Record<string, Kezelo>;

export class FogadoHiba extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A Készlet által fogadott (típus@verzió) párok (F15.3). */
export const TERVEZETT = new Set([
  "konyvelo.bizonylat.konyvelve@2",
  "konyvelo.bizonylat.sztornozva@1",
  "konyvelo.kiegyenlites.rogzitve@3",
  "konyvelo.kiegyenlites.bontva@2",
  "konyvelo.idoszak.lezarva@1",
  "konyvelo.idoszak.feloldva@1",
  "torzs.partner.valtozott@1",
]);

export function kezelo(kezelok: Kezelok): Kezelo {
  return async (client, d) => {
    const kulcs = `${d.event.type}@${d.event.version}`;
    const k = kezelok[kulcs];
    if (k) return k(client, d);
    if (TERVEZETT.has(kulcs)) return { outcome: "PARKED" };
    throw new FogadoHiba(422, "UNSUPPORTED_EVENT", `A Készlet ezt az eseményt nem dolgozza fel: ${d.event.type} v${d.event.version}. A Készlet frissítése után a központból újraküldhető.`);
  };
}
