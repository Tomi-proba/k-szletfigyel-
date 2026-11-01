/**
 * A Készlet integrációs szolgáltatása (TERV.md F15.2). Indítás:
 *   cd integracio && npm ci && npm start
 *
 * Beállítás környezeti változókkal (kódmódosítás nélkül cserélhető, ELESITES.md):
 *   KESZLET_DATABASE_URL  a Készlet adatbázisa (Supabase: a közvetlen, 5432-es kapcsolat, a postgres felhasználóval)
 *   KOZPONT_URL           az integrációs központ címe (pl. https://kozpont.example.hu)
 *   KOZPONT_TITOK         a központ és a Készlet közös titka (legalább 32 karakter; a központban KOZPONT_KESZLET_TITOK)
 *   PORT, HOST            ahol a központ eléri (alapértelmezés: 3300, 127.0.0.1)
 *
 * Központ nélkül is elindul (a végpontok ilyenkor „nincs beállítva” választ adnak); a Készlet maga soha
 * nem függ ettől a szolgáltatástól.
 */
import { createServer } from "node:http";
import { createHubClient, MIN_SECRET_LENGTH } from "../esemenyek/src/index.ts";
import { atadas } from "./atado.ts";
import { ujPool } from "./db.ts";
import { fogado } from "./fogado.ts";
import { kozosTeendokKor } from "./kozos-teendok.ts";
import { nyitottTetelekKor } from "./nyitott-tetelek.ts";
import { osszeallitas } from "./osszeallito.ts";

const env = process.env;
if (!env.KESZLET_DATABASE_URL) {
  console.error("Hiányzik: KESZLET_DATABASE_URL (a Készlet adatbázisa).");
  process.exit(1);
}
const titok = env.KOZPONT_TITOK ?? null;
if (titok && titok.length < MIN_SECRET_LENGTH) {
  console.error(`A KOZPONT_TITOK legalább ${MIN_SECRET_LENGTH} karakter legyen.`);
  process.exit(1);
}
if (Boolean(env.KOZPONT_URL) !== Boolean(titok)) {
  console.error("A KOZPONT_URL és a KOZPONT_TITOK csak együtt adható meg.");
  process.exit(1);
}

const pool = ujPool(env.KESZLET_DATABASE_URL);
const hub = env.KOZPONT_URL && titok ? createHubClient({ url: env.KOZPONT_URL, module: "keszlet", secret: titok }) : null;
const log = (msg: string, err?: unknown) => console.warn(`${new Date().toISOString()} ${msg}`, err ?? "");

const server = createServer(fogado({ pool, titok, log }));
const port = Number(env.PORT ?? 3300);
const host = env.HOST ?? "127.0.0.1";
server.listen(port, host, () => console.log(`Készlet integrációs szolgáltatás: http://${host}:${port}${hub ? "" : " (központ nincs beállítva)"}`));

let fut = false;
let utolsoKozos = 0;
const kozosKozott = Number(env.INTEGRACIO_TEENDO_KOR_MS ?? 30_000);
const kor = async () => {
  if (fut) return;
  fut = true;
  try {
    const o = await osszeallitas(pool);
    if (o.hibas) log(`Integráció: ${o.hibas} változás nem állítható össze (lásd a Teendőket); ${o.varakozik} vár mögöttük.`);
    if (hub) {
      const a = await atadas(pool, hub);
      if (a.hiba) log(`Integráció: az átadás nem sikerült (${a.hiba}); a következő körben újra.`);
      // Közös Teendők (F18): ritkábban, mint az átadás.
      if (Date.now() - utolsoKozos >= kozosKozott) {
        utolsoKozos = Date.now();
        const k = await kozosTeendokKor(pool, hub);
        if (k.hibas) log(`Integráció: a közös Teendők frissítése ${k.hibas} esetben nem sikerült; a következő körben újra.`);
        // A Könyvelő nyitott tételei (F19), ugyanebben a ritmusban.
        const n = await nyitottTetelekKor(pool, hub);
        if (n.hibas) log(`Integráció: a Könyvelő nyitott tételeinek letöltése ${n.hibas} esetben nem sikerült; a legutóbbi lista marad.`);
      }
    }
  } catch (e) {
    log("Integráció: hiba a körben; a következő körben újra.", e);
  } finally {
    fut = false;
  }
};
const idozito = setInterval(() => void kor(), Number(env.INTEGRACIO_KOR_MS ?? 5000));
void kor();

const leallas = () => {
  clearInterval(idozito);
  server.close(() => void pool.end().then(() => process.exit(0)));
};
process.on("SIGTERM", leallas);
process.on("SIGINT", leallas);
