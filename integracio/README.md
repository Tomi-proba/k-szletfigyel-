# A Készletfigyelő integrációs szolgáltatása

A Készlet és az integrációs központ (Tomi-proba/AWEBOLDAL `apps/kozpont`) közötti kapocs (TERV.md F15.2).
A Készlet nélküle is teljes értékűen működik; csak összekapcsolt cégnél van szerepe.

- `esemenyek/`: a modulok közös eseményformátumának **változatlan másolata**
  (forrás: AWEBOLDAL `packages/esemenyek`, lásd `esemenyek/FORRAS.json`). Ne itt módosítsd: a
  forrásban változtass, majd másold újra az AWEBOLDAL repóból:
  `npm run masol -w @aweboldal/esemenyek -- ../k-szletfigyel-/integracio/esemenyek`.
  A `test/masolat.test.ts` jelzi, ha a másolatot helyben átírták.
- Készül (I3 3–4. lépés): a kimenő események átadása, a beérkezők fogadása, a kapcsolódási kód beváltása.

Tesztek: `cd integracio && npm ci && npm test`.
