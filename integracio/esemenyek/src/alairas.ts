import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Kiszolgálók közötti aláírt kérések (ugyanaz a séma, mint az eÁFA NAV-átjárójánál):
 *
 *   aláírandó = METÓDUS \n ÚTVONAL(?lekérdezés) \n IDŐBÉLYEG \n NONCE \n hex(SHA-256(törzs))
 *   X-Signature = hex(HMAC-SHA256(titok, aláírandó))
 *
 * Fejlécek: X-Module (ki küldi), X-Timestamp (Unix-másodperc), X-Nonce, X-Signature.
 */

export const MAX_SKEW_SECONDS = 300;
export const MIN_SECRET_LENGTH = 32;

export function signRequest(secret: string, method: string, path: string, timestamp: string, nonce: string, body: string): string {
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  return createHmac("sha256", secret).update(`${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`, "utf8").digest("hex");
}

export function signedHeaders(secret: string, sender: string, method: string, path: string, body: string, now = Date.now()): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000));
  const nonce = randomUUID().replace(/-/g, "");
  return {
    "X-Module": sender,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Signature": signRequest(secret, method, path, timestamp, nonce, body),
  };
}

export type SignatureCheck = { ok: true; sender: string; nonce: string } | { ok: false; code: "UNAUTHENTICATED" | "STALE_REQUEST"; message: string };

/** Az aláírás ellenőrzése. A nonce egyszeriségét a hívó tartja nyilván (adatbázisban). */
export function verifySignature(
  headers: Record<string, string | string[] | undefined>,
  method: string,
  path: string,
  body: string,
  secretOf: (sender: string) => string | null,
  now = Date.now(),
): SignatureCheck {
  // A fejlécnevek kis- és nagybetűtől függetlenek (a Node kisbetűsít, más környezet nem feltétlenül).
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const h = (n: string) => {
    const v = lower.get(n.toLowerCase());
    return Array.isArray(v) ? v[0] : v;
  };
  const sender = h("X-Module");
  const timestamp = h("X-Timestamp");
  const nonce = h("X-Nonce");
  const signature = h("X-Signature");
  if (!sender || !timestamp || !nonce || !signature || !/^\d{1,12}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) {
    return { ok: false, code: "UNAUTHENTICATED", message: "Hiányzó vagy hibás aláírás." };
  }
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return { ok: false, code: "STALE_REQUEST", message: "A kérés időbélyege túl régi vagy a jövőben van." };
  }
  const secret = secretOf(sender);
  if (!secret) return { ok: false, code: "UNAUTHENTICATED", message: "Hiányzó vagy hibás aláírás." };
  const expected = Buffer.from(signRequest(secret, method, path, timestamp, nonce, body));
  const given = Buffer.from(signature.toLowerCase());
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, code: "UNAUTHENTICATED", message: "Hiányzó vagy hibás aláírás." };
  }
  return { ok: true, sender, nonce };
}
