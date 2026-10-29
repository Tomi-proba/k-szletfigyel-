import { createHash } from "node:crypto";
import { z } from "zod";
import { EVENT_TYPES, type EventTypeDefinition } from "./esemeny.ts";

/**
 * Az eseményformátum lenyomata típusonként és verziónként. Egy már kiadott (típus, verzió) tartalma nem
 * változhat, mert a többi modul (más repóban, más ütemben frissítve) arra épít: változáshoz új verzió kell.
 * A `formatum-lenyomat.json` a kiadott verziók lenyomatát őrzi; a teszt jelzi, ha egy eltér.
 */

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}

export function definitionFingerprint(d: EventTypeDefinition): string {
  const schema = z.toJSONSchema(d.payload, { unrepresentable: "any" });
  return createHash("sha256").update(JSON.stringify(canonical({ type: d.type, version: d.version, consumers: [...d.consumers].sort(), schema }))).digest("hex");
}

export function fingerprints(types: readonly EventTypeDefinition[] = EVENT_TYPES): Record<string, string> {
  return Object.fromEntries(types.map((d) => [`${d.type}@${d.version}`, definitionFingerprint(d)]));
}
