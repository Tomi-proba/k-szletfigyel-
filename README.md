# Készletfigyelő

Készletkezelő webalkalmazás kisebb kereskedéseknek (ajtó-ablak, építőanyag,
vasáru stb.). Segít naponta gyorsan vezetni a készletmozgásokat, kezeli a
beszerzések/eladások ÁFA- és fizetési-határidő nyomon követését, egy
egyszerű pénzügyi naplót és eredménykimutatást, és proaktívan figyelmeztet,
ha rendelni kell, vagy ha egy termék feleslegesen köt le pénzt.

**A teljes működési és technikai dokumentáció — adatmodell, üzleti
szabályok, navigáció, munkafolyamatok, ismert tervezési döntések — a
[`DOCUMENTATION.md`](./DOCUMENTATION.md) fájlban található.**

## Indítás

```bash
npm install
npm run dev       # fejlesztői szerver
npm run build     # production build a dist/ mappába
npm run lint      # oxlint
```

Az alkalmazás egy kliensoldali (SPA) React app. Bejelentkezett (Supabase-es)
módban **minden üzleti adat a szerveren** van, a mentés műveletenként atomi,
és a mentési hibák a felületen is látszanak (lásd DOCUMENTATION.md 20.
fejezet). Bejelentkezés nélkül (helyi mód, és a Windows asztali változat) az
adatok a böngésző `localStorage`-ában maradnak, mint eddig.

Tesztek: `npm test` (az adatbázis-tesztekhez:
`KESZLET_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/keszlet_test npm test`).

## Architektúra röviden

React 19 + TypeScript + Vite, Tailwind CSS v4, react-router-dom (`HashRouter`),
Zustand `persist` middleware-rel (localStorage). Backend nélküli SPA — minden
adat a böngésző `localStorage`-ában él. A teljes fájlonkénti felépítés,
adatmodell, üzleti logika (költségszámítás, ÁFA, riasztások, pénzügyi napló,
soft delete/audit napló) és a bővítési lehetőségek részletes leírása a
[`DOCUMENTATION.md`](./DOCUMENTATION.md)-ban található.
