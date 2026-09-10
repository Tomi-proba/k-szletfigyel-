# Készletfigyelő

Készletkezelő webalkalmazás kisebb kereskedéseknek (ajtó-ablak, építőanyag,
vasáru stb.). Segít naponta gyorsan vezetni a készletmozgásokat, és
proaktívan figyelmeztet, ha rendelni kell, vagy ha egy termék feleslegesen
köt le pénzt.

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

## Architektúra

- **`src/types`** – a doménmodell (Termék, Beszállító, Mozgás, Telephely,
  Beállítások) egyetlen helyen, framework-független TypeScript típusokként.
- **`src/store/useStore.ts`** – Zustand store `persist` middleware-rel
  (localStorage). Ez az egyetlen hely, ahol az adatok módosulnak (CRUD +
  mozgásrögzítés). A store egy repository-szerű felületet ad, így később
  könnyen lecserélhető valódi backendre (REST/GraphQL) anélkül, hogy a UI
  komponenseknek tudniuk kellene róla.
- **`src/lib/alerts.ts`** – a riasztási és javaslati üzleti logika tiszta
  függvényekként (alacsony készlet, rendelési javaslat, lassan fogyó
  termékek, áthelyezési javaslat, haszonkulcs riport). Nincs React- vagy
  store-függősége, így önállóan tesztelhető.
- **`src/hooks/useAlerts.ts`** – a store adatait és az `alerts.ts` logikát
  köti össze, memoizálva.
- **`src/lib/export.ts`** – generikus táblázat-exportáló `.xlsx` (ExcelJS)
  és `.pdf` (jsPDF + autotable) formátumba. A magyar ékezetes karakterek
  (ő, ű) helyes megjelenítéséhez egy beágyazott Noto Sans betűkészletet
  használ, mivel a jsPDF beépített fontjai (WinAnsi kódolás) nem
  tartalmazzák ezeket a glyph-okat.
- **`src/components`** – újrafelhasználható UI elemek és űrlapok.
- **`src/pages`** – az egyes nézetek (Kezdőlap, Készlet, Mozgásnapló,
  Riasztások, Beszállítók, Telephelyek, Riportok, Beállítások).

## Riasztási szabályok

A küszöbértékek (átlagfogyás számítási időszak, biztonsági tartalék napok,
rendelési célidőszak, lassan fogyó termék vizsgálati időszaka és
visszaesési küszöbe) a **Beállítások** oldalon módosíthatók, nincsenek
hardcode-olva (lásd `DEFAULT_SETTINGS` a `src/types/index.ts`-ben és a
`Settings` típust használó `lib/alerts.ts` függvényeket).

## Bővítési pontok

- **Több felhasználó / jogosultságkezelés**: a store CRUD-műveletei már
  most is egy jól elkülönített felületen keresztül érhetők el
  (`useStore`), így egy backend-integráció (pl. auth + API hívások) a
  store implementációjának cseréjével old ható meg a UI komponensek
  módosítása nélkül.
- **Backend csatlakoztatás**: a `persist` middleware-t (localStorage) le
  lehet cserélni egy API-alapú adatréteg re; a `Movement`/`Product`
  típusok és az `alerts.ts` üzleti logika változatlanul maradhat.
- **Vonalkódolvasó**: a `ProductPicker` komponens jelenleg szöveges
  kereséssel dolgozik; egy vonalkódolvasó egyszerűen egy újabb
  `onChange`-hívássá alakítható ide.
