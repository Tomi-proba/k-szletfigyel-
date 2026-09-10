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

Az alkalmazás egy kliensoldali (SPA) React app, backend nélkül. Az adatok a
böngésző `localStorage`-ában perzisztálódnak, tehát munkamenet lezárása után
is megmaradnak (amíg ugyanazt a böngészőt/gépet használod).

## Architektúra röviden

React 19 + TypeScript + Vite, Tailwind CSS v4, react-router-dom (`HashRouter`),
Zustand `persist` middleware-rel (localStorage). Backend nélküli SPA — minden
adat a böngésző `localStorage`-ában él. A teljes fájlonkénti felépítés,
adatmodell, üzleti logika (költségszámítás, ÁFA, riasztások, pénzügyi napló,
soft delete/audit napló) és a bővítési lehetőségek részletes leírása a
[`DOCUMENTATION.md`](./DOCUMENTATION.md)-ban található.
