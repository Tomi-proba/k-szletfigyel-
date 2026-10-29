import { signedHeaders, verifySignature, type SignatureCheck } from "./alairas.ts";
import { inboundResultSchema, type EventEnvelope, type InboundDelivery, type InboundResult, type Module } from "./esemeny.ts";

/**
 * A modulok oldala: kliens a központ felé, és a központtól érkező kérések ellenőrzése.
 *
 * Végpontok, amelyeket egy modulnak meg kell valósítania (a központ hívja, aláírva):
 * - `POST /api/integracio/v1/bejovo` – egy esemény átadása (`InboundDelivery`), válasz: `InboundResult`;
 * - `POST /api/integracio/v1/kapcsolodas` – kapcsolódási kód beváltása (`{ code, taxNumber }`), válasz:
 *   `{ companyRef, companyName, taxNumber }`; ismeretlen, lejárt vagy más céghez tartozó kódra 422;
 * - `DELETE /api/integracio/v1/kapcsolodas/:companyRef` – az összekapcsolás bontása.
 */

export const INBOUND_PATH = "/api/integracio/v1/bejovo";
export const LINK_PATH = "/api/integracio/v1/kapcsolodas";

export class HubError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type HubClient = {
  /** Események átadása; a visszaadott azonosítókat a központ biztosan átvette. */
  publish(events: EventEnvelope[]): Promise<{ accepted: string[]; rejected: Array<{ id: string; error: string }> }>;
  /** Egy Teendő megoldottnak jelölése (amit ez a modul nyitott); `companyRef` a modul saját cégazonosítója. */
  resolveTodo(companyRef: string, key: string): Promise<void>;
  /** „Honnan jött?”: a rekordhoz tartozó kapcsolatok mindkét irányban. */
  links(companyRef: string, recordType: string, recordId: string): Promise<Array<{ direction: "from" | "to"; module: Module; recordType: string; recordId: string; url: string | null; label: string | null }>>;
};

export function createHubClient(config: { url: string; module: Module; secret: string; timeoutMs?: number }): HubClient {
  const base = new URL(config.url.endsWith("/") ? config.url : config.url + "/");
  async function call<T>(method: "GET" | "POST", relative: string, payload?: unknown): Promise<T> {
    const url = new URL(relative, base);
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const headers: Record<string, string> = { Accept: "application/json", ...signedHeaders(config.secret, config.module, method, url.pathname + url.search, body) };
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: payload === undefined ? undefined : body, signal: AbortSignal.timeout(config.timeoutMs ?? 30_000) });
    } catch {
      throw new HubError(503, "HUB_UNREACHABLE", "Az integrációs központ most nem érhető el.");
    }
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const e = (data ?? {}) as { code?: string; message?: string };
      throw new HubError(res.status, e.code ?? "HUB_ERROR", e.message ?? `Az integrációs központ hibát adott (${res.status}).`);
    }
    return data as T;
  }
  return {
    publish: (events) => call("POST", "api/v1/modul/esemenyek", { events }),
    resolveTodo: async (companyRef, key) => {
      await call("POST", `api/v1/modul/teendok/${encodeURIComponent(key)}/megoldva`, { companyRef });
    },
    links: (companyRef, recordType, recordId) =>
      call("GET", `api/v1/modul/kapcsolatok?companyRef=${encodeURIComponent(companyRef)}&recordType=${encodeURIComponent(recordType)}&recordId=${encodeURIComponent(recordId)}`),
  };
}

/** A központtól érkező kérés ellenőrzése a modulban (a központ „kozpont” néven ír alá). */
export function verifyHubRequest(headers: Record<string, string | string[] | undefined>, method: string, path: string, body: string, secret: string, now = Date.now()): SignatureCheck {
  return verifySignature(headers, method, path, body, (sender) => (sender === "kozpont" ? secret : null), now);
}

/** A fogadó válaszának ellenőrzése a központban. */
export function parseInboundResult(raw: unknown): InboundResult | null {
  const r = inboundResultSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export type { InboundDelivery };
