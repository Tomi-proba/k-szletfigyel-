# A Készletfigyelő integrációs szolgáltatása

A Készlet és az integrációs központ (Tomi-proba/AWEBOLDAL `apps/kozpont`) közötti kapocs (TERV.md F15.2,
DOCUMENTATION.md 23.). A Készlet nélküle is teljes értékűen működik; csak összekapcsolt cégnél van szerepe.

## Részei
- `src/osszeallito.ts`: a változások sorából (`integracio.valtozasok`, a mentés tranzakciójában írja a
  trigger) eseményt készít a Készlet saját számolófüggvényeivel, és a kimenő táblába teszi. Nem találgat:
  ami nem állítható össze, az vár, és Teendő lesz.
- `src/atado.ts`: átadás a központnak; csak a visszaigazolás után számít elküldöttnek. Ha a központ 30
  percig nem veszi át, Teendő lesz.
- `src/fogado.ts`: aláírt végpontok a központnak (kapcsolódás kóddal, bontás, beérkező esemény pontosan
  egyszer), és `GET /egeszseg`.
- `src/kezelok.ts`: a beérkező események kezelői (az I3 4. lépésében készülnek).
- `esemenyek/`: a modulok közös eseményformátumának **változatlan másolata** (forrás: AWEBOLDAL
  `packages/esemenyek`, lásd `esemenyek/FORRAS.json`). Ne itt módosítsd: a forrásban változtass, majd másold
  újra az AWEBOLDAL repóból: `npm run masol -w @aweboldal/esemenyek -- ../k-szletfigyel-/integracio/esemenyek`.
  A `test/masolat.test.ts` jelzi, ha a másolatot helyben átírták.

## Indítás
```
cd integracio
npm ci
KESZLET_DATABASE_URL=… KOZPONT_URL=… KOZPONT_TITOK=… npm start
```
- `KESZLET_DATABASE_URL`: a Készlet adatbázisa. Supabase-nél a **közvetlen** (5432-es, munkamenet-módú)
  kapcsolat a `postgres` felhasználóval, nem a tranzakció-módú pooler.
- `KOZPONT_URL`, `KOZPONT_TITOK`: a központ címe és a közös titok (legalább 32 karakter; a központban
  `KOZPONT_KESZLET_TITOK`). Nélkülük a szolgáltatás elindul, de nem kapcsolódik.
- `PORT`, `HOST`: ahol a központ eléri (alapértelmezés: `3300`, `127.0.0.1`). A központban
  `KOZPONT_KESZLET_URL` erre a címre mutasson.
- Node 22.12 vagy újabb.

## Tesztek
```
KESZLET_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/keszlet_test npm test
```
Valódi PostgreSQL-en, a valódi `supabase/schema.sql`-lel, a Supabase minimális utánzatával. Adatbázis nélkül az
adatbázis-tesztek kimaradnak.
