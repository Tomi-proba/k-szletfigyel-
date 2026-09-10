# Készletfigyelő — működési és technikai dokumentáció

Ez a dokumentum az alkalmazás teljes működését írja le: mire való, hogyan van felépítve, milyen üzleti szabályok vezérlik, és hol található a kódban minden fontosabb logika. Célja, hogy bárki — beleértve a jövőbeli fejlesztőt vagy Claude-munkamenetet is — gyorsan tájékozódni tudjon anélkül, hogy a teljes kódbázist végig kellene olvasnia.

> A dokumentum a kódot magát tekinti igazságforrásnak. Ahol releváns, konkrét fájl- és függvényneveket ad meg, hogy a leírás és a valós implementáció ne váljon szét idővel.

---

## 1. Mi ez az alkalmazás?

A **Készletfigyelő** egy magyar nyelvű, kisvállalkozásoknak (elsősorban egy építőanyag/vasáru-kereskedésnek) szánt készletnyilvántartó és egyszerű vállalkozásirányítási (mini-ERP) alkalmazás. Fő funkciói:

- termékek és készletszintek nyilvántartása, telephelyenként
- beszerzések (bejövő mozgások) és eladások (kimenő mozgások) rögzítése, valós FIFO/súlyozott átlagár költségszámítással
- vevői és beszállítói törzsadatok, vevői tartozások és beszállítói fizetési kötelezettségek nyomon követése
- automatikus és kézi ÁFA-nyilvántartás, kombinált ÁFA-egyenleggel
- egy általános pénzügyi napló (bérleti díj, bérköltség stb.) és egy abból + a készletmozgásokból összeálló egyszerű eredménykimutatás
- riasztási rendszer (alacsony készlet, lassan fogyó termék, rendelési javaslat, áthelyezési javaslat, kifizetetlen eladás, lejáró/lejárt fizetési kötelezettség, nyitott eladás)
- teljes körű, soft-delete alapú auditálhatóság — semmi nem törlődik ténylegesen, minden változás naplózva van
- Excel/PDF export minden fontosabb listánál és riportnál

Az alkalmazás **kliensoldali, backend nélküli** SPA: minden adat a böngésző `localStorage`-ában tárolódik. Nincs szerver, nincs adatbázis, nincs bejelentkezés/jogosultságkezelés — egyetlen felhasználó, egyetlen böngésző-profil használja.

---

## 2. Technológiai stack

| Réteg | Választás |
|---|---|
| UI keretrendszer | React 19 + TypeScript |
| Build/dev szerver | Vite 8 |
| Stílus | Tailwind CSS v4 (`@tailwindcss/vite` plugin) |
| Routing | react-router-dom v7, **`HashRouter`** (lásd 11.1 — ennek van egy fontos következménye) |
| Állapotkezelés | Zustand v5, `persist` middleware-rel (localStorage) |
| Dátumkezelés | `date-fns` (+ magyar locale a formázáshoz) |
| Excel export | `exceljs` |
| PDF export | `jspdf` + `jspdf-autotable`, beágyazott Noto Sans betűtípussal (a magyar ő/ű karakterek miatt) |
| Ikonok | `lucide-react` |
| Azonosítók | `uuid` (v4) |
| Linter | `oxlint` |
| Asztali (Windows) build | Electron + `electron-builder`, GitHub Actions workflow-ból |
| Webes hosting | Vercel (a `claude/inventory-management-app-yjc3v5` branch automatikus deploy-ja) |

Fejlesztői parancsok (`package.json`):

```bash
npm run dev      # Vite dev szerver
npm run build    # tsc -b && vite build (típusellenőrzés + produkciós build)
npm run lint     # oxlint
npm run preview  # a build kimenet helyi kiszolgálása
```

---

## 3. Projektstruktúra

```
src/
  types/index.ts        — az összes domain-típus (Product, Movement, PurchaseLot, LedgerEntry, ...)
  store/
    useStore.ts          — a teljes Zustand store: állapot + minden mutáló akció
    seed.ts               — a demó/kezdő adatok generálása
    id.ts                 — createId() (uuid v4)
  lib/                    — tiszta, store-független üzleti logika (lásd 7. fejezet)
    costing.ts             — FIFO / súlyozott átlagár, egységköltség-számítás
    vat.ts                  — automatikus ÁFA (beszerzésből/eladásból)
    ledger.ts                — pénzügyi napló számítások, eredménykimutatás
    alerts.ts                 — riasztások, insightok, haszonkulcs riport, vevői tartozás
    payables.ts                — kimenő fizetési kötelezettségek
    shipping.ts                 — szállítási költség kimutatás
    audit.ts                     — mező-szintű diffelés az audit naplóhoz
    export.ts                     — generikus Excel/PDF export
    dates.ts                       — dátum-segédfüggvények
    format.ts                       — pénznem/szám/dátum formázás
  hooks/
    useAlerts.ts            — az összes riasztás/insight egy helyen újraszámolva
    useHydrated.ts           — várakozás a localStorage-ból történő betöltésre
    usePersistedDateRange.ts  — localStorage-ban megmaradó dátumtartomány-szűrő
  components/               — újrahasznált UI-elemek és űrlapok (lásd 8. fejezet)
  pages/                     — egy-egy route-hoz tartozó oldal-komponensek
  App.tsx                     — route-tábla
electron/                     — Windows desktop csomagoló (Electron + electron-builder)
.github/workflows/
  build-windows.yml           — Windows telepítő buildelése GitHub Actions-ben
```

---

## 4. Adatmodell (`src/types/index.ts`)

Minden entitás, ami törölhető, kiterjeszti a `SoftDeletable` interfészt (`deletedAt?: string`) — lásd 6. fejezet.

### 4.1 `Location` (telephely)
`{ id, name }` — minden termék pontosan egy telephelyhez tartozik.

### 4.2 `Supplier` (beszállító)
`{ id, name, phone?, email?, leadTimeDays }` — a `leadTimeDays` (átlagos szállítási idő) a rendelési riasztások bemenete.

### 4.3 `Customer` (vevő)
`{ id, name, phone?, email?, notes? }` — csak a "nem sima" (nevesített) eladásoknál kell kiválasztani; egy sima eladásnál nincs vevő rögzítve, és az mindig "fizetve"-nek számít.

### 4.4 `Product` (termék)
Legfontosabb mezők: `sku?`, `category`, `unit`, `currentStock`, `minStock`, `purchasePrice` (súlyozott átlagköltség, HUF), `salePrice`, `supplierId?`, `locationId`, `defaultVatRatePercent?`.

A `purchasePrice` **súlyozott átlagár mindig frissül** minden bejövő mozgásnál (lásd 7.1), függetlenül attól, hogy a beállított költségszámítási mód `average` vagy `fifo` — ez a mező a "jelenlegi becsült egységköltség" gyors megjelenítésére szolgál mindenhol, ahol nincs FIFO-specifikus adat kéznél (pl. régi, ár nélkül rögzített mozgásoknál a haszonkulcs riportban).

### 4.5 `PurchaseLot` (beszerzési tétel / FIFO-réteg)
Minden bejövő mozgás **automatikusan** létrehoz egy `PurchaseLot`-ot — ez a valódi, tételes költség-nyilvántartás, függetlenül a beállított költségszámítási módtól (lásd 7.1). Kulcsmezők:

- `quantity` / `remainingQuantity` — az eredeti és a még el nem fogyott mennyiség (FIFO-fogyasztás csökkenti)
- `unitPrice`, `shippingCost`, `currency`, `exchangeRate` — az áru ára és a szállítási költség **külön** tárolva, a megadott pénznemben
- `dueDate?`, `isPaid?`, `paidDate?` — opcionális beszállítói fizetési határidő-követés
- `vatRatePercent?`, `vatReclaimable?` — a tételre alkalmazott ÁFA kulcs és visszaigényelhetőség

### 4.6 `Movement` (készletmozgás — bejövő/kimenő)
A rendszer gerince. `type: 'in' | 'out'`. Bejövő mozgásnál egy `PurchaseLot` is létrejön hozzá; kimenő mozgásnál a mozgás pillanatában érvényes `unitCost` és `saleUnitPrice` **rögzül a mozgáson** (snapshot), hogy a múltbeli riportok később se változzanak meg egy utólagos ár- vagy módszerváltás miatt.

Eladás-specifikus mezők: `customerId?`, `isPaid?`, `vatRatePercent?`, `saleStatus?` (`pending`/`shipping`/`delivered`), `saleStatusChangedAt?`, `cancelled?`, `cancelledAt?`, `cancelReason?`, `correctsMovementId?` — lásd 9.3 (eladás visszavonása).

### 4.7 `LedgerEntry` (pénzügyi napló tétel)
Készlettől és vevőktől független bevétel/kiadás (bérleti díj, bérköltség, osztalék, kézi ÁFA-tételek stb.). `type: 'income' | 'expense'`, `category` (szabad szöveg, de az `'ÁFA'` kategória extra mezőket kap: `vatRatePercent`, `vatDirection: 'payable' | 'reclaimable'`), opcionális `dueDate`/`isPaid`/`paidDate` fizetési-kötelezettség követéshez, és `correctsEntryId?` korrekciós tételekhez.

### 4.8 `Settings`
Globális beállítások: költségszámítási mód (`costingMethod`), riasztási időablakok és küszöbök, `paymentReminderDaysBefore: number[]` (pl. `[7,3,1]`), `defaultVatRatePercentForNewProducts`.

### 4.9 `AuditLogEntry`
Lásd 6. fejezet.

---

## 5. Állapotkezelés és perzisztencia

### 5.1 A fő store
Egyetlen Zustand store (`src/store/useStore.ts`), `persist` middleware-rel a `keszletfigyelo-storage` localStorage-kulcs alatt. A store tartalmazza az **összes** entitás-listát (`locations`, `suppliers`, `customers`, `products`, `movements`, `lots`, `ledgerEntries`, `ledgerCategories`, `auditLog`) és a `settings`-et, plusz minden mutáló akciót (CRUD + speciális műveletek: `recordMovement`, `cancelSale`, `setSaleStatus`, `updateLotVat`, `updateMovementVat`, `setMovementPaid`/`setLotPaid`/`setLedgerEntryPaid`, `resetToDemoData`, `clearAllData`).

Első betöltéskor, ha nincs még mentett állapot, a `buildSeedData()` (`src/store/seed.ts`) tölti fel demó adatokkal.

### 5.2 Egyéb, kisebb, localStorage-alapú UI-állapotok
Ezek **nem** a fő Zustand store-ban élnek (nem kell szinkronban lenniük a domain-adatokkal), hanem saját, névtér-elkülönített kulcsok alatt:

| Kulcs | Mit tárol |
|---|---|
| `keszletfigyelo-nav-expanded-groups` | melyik navigációs csoportok vannak lenyitva (`Layout.tsx`) |
| `keszletfigyelo-penzugyi-naplo-daterange` | a Pénzügyi napló utoljára beállított dátumtartománya |
| `keszletfigyelo-afa-daterange` | az ÁFA oldal utoljára beállított dátumtartománya |

Ez utóbbi kettő a `usePersistedDateRange` hook-on keresztül működik (`src/hooks/usePersistedDateRange.ts`) — **minden oldal saját, egymástól független kulcs alatt** emlékszik a tartományára, hogy oldalak közti navigáláskor ne ugorjon vissza az alapértelmezettre.

### 5.3 `useHydrated`
Mivel a Zustand `persist` middleware aszinkron tölti be a localStorage-tartalmat, az `App.tsx` egy rövid "Betöltés…" képernyőt mutat, amíg a `useHydrated()` hook `true`-t nem jelez — így a UI soha nem villan fel a seed-adattal, mielőtt a valódi (mentett) adat betöltődne.

---

## 6. Soft delete és audit napló — a rendszer legfontosabb elve

**Semmi nem törlődik fizikailag.** Minden törölhető entitás `SoftDeletable`-t implementál (`deletedAt?: string`). "Törléskor" a rekord csak megjelöltté válik, minden lista alapból kiszűri, de minden lista-oldalon van egy "Törölt elemek megjelenítése" jelölőnégyzet, ami visszahozza (áthúzva/halványítva), plusz egy "Visszaállítás" gomb.

### 6.1 Készletmozgások és pénzügyi napló tételek — korrekciós tétel vagy soft delete
`Movement` és `LedgerEntry` törlésekor a felhasználó két mód közül választhat (`DeleteChoiceDialog` komponens, `DeleteMovementMode`/`DeleteLedgerEntryMode`: `'correction' | 'soft-delete'`):

- **Korrekciós tétel (ajánlott)**: az eredeti rekord **változatlanul, aktívan** megmarad; egy új, ellentétes hatású rekord jön létre, ami `correctsMovementId`/`correctsEntryId` mezővel hivatkozik az eredetire. Ez a könyvelésben megszokott "sztornó" mintát követi — teljes nyomon követhetőség, és a hatás nettósítva nullázódik.
- **Egyszerű törlés**: a rekord `deletedAt`-et kap, az eredeti értékekkel együtt megmarad, csak kiesik az aktív számításokból.

### 6.2 Egységes audit napló
Egyetlen, append-only `AuditLogEntry[]` tömb (`state.auditLog`) fedi le a teljes rendszert. Minden mutáló store-akció a végén hozzáfűz egy bejegyzést (`auditEntry()` helper). A mező-szintű "mi változott" részletet a `diffFields()` (`src/lib/audit.ts`) generálja: entitástípusonként előre definiált, emberi nyelvre lefordított mezőlista alapján hasonlítja össze a régi és új állapotot, és csak a ténylegesen változott mezőket sorolja fel (`AuditFieldChange[]`).

Ez az egyetlen napló hajtja:
- a önálló **Audit napló** oldalt (`/audit-naplo`, `pages/AuditLog.tsx`) — szűrhető entitástípus, dátum és művelet szerint, exportálható
- minden entitás saját **"Előzmények"** panelét (`HistoryPanel` komponens, `entityType` + `entityId` szerint szűrve ugyanabból a naplóból)

### 6.3 Aktív-e egy rekord a számításokhoz?
A riportok/riasztások/összesítők **alapból csak az aktív** (nem törölt, és mozgás esetén nem visszavont) rekordokat veszik figyelembe. Ezt egy apró, mindenhol újrahasznált szűrő biztosítja:

```ts
function isActiveMovement(m: Movement): boolean {
  return !m.deletedAt && !m.cancelled
}
```

---

## 7. Üzleti logika (`src/lib/`)

Minden `lib/` modul **tiszta függvényekből** áll — nincs bennük React- vagy store-függés, csak sima adatstruktúrákon dolgoznak. Ez teszi lehetővé, hogy a store, a különböző oldalak és a riportok ugyanazt a logikát hívják meg, sosem duplikálva a számítást.

### 7.1 Költségszámítás — FIFO vs súlyozott átlagár (`lib/costing.ts`)

A `Settings.costingMethod` (`'average' | 'fifo'`) dönti el, **melyik szám kerül rá** egy kimenő mozgásra költségként — de a `PurchaseLot`-ok **mindig, mindkét módban FIFO sorrendben fogynak** (`consumeFifo`), hogy a tételes nyilvántartás konzisztens maradjon akkor is, ha a felhasználó később módot vált:

- **`average`**: minden bejövő tétel egyetlen, gördülő súlyozott átlagköltségbe olvad (`weightedAverageAfterReceipt`) — ez kerül a `Product.purchasePrice`-ba és minden kimenő mozgás `unitCost`-jába.
- **`fifo`**: minden kimenő mozgás a ténylegesen elfogyasztott FIFO-tétel(ek) saját árát kapja költségként (`consumeFifo().unitCost`).

Kulcs-függvények:

| Függvény | Mit ad vissza |
|---|---|
| `lotNetHuf` | áru + szállítás, ÁFA nélkül, HUF-ban |
| `lotGoodsValueHuf` | csak az áru értéke |
| `lotShippingHuf` | csak a szállítási költség |
| `lotVatAmountHuf` | a tétel ÁFA-tartalma |
| `lotGrossHuf` | nettó + ÁFA = a beszállítónak ténylegesen fizetendő teljes összeg |
| **`lotUnitCost`** | **a valódi egységi költségbázis**, ami a FIFO/átlagár-számításba és a haszonkulcs-riportba megy: áru egységára + szállítás/mennyiség (mindkettő HUF-ra váltva) **+ a nem visszaigényelhető ÁFA egy egységre eső része** (mivel az egy valós, meg nem térülő kiadás) |
| `computeInventoryPurchaseCost(lots, from, to)` | egy időszakban **beszerzett** (nem eladott!) készlet teljes költségbázisa — ez teszi a beszerzést azonnali kiadássá a P&L-ben (lásd 7.5) |

### 7.2 ÁFA rendszer (`lib/vat.ts`) — automatikus vs kézi, egy helyen dokumentálva

Ez az egyik legösszetettebb, ezért itt kicsit részletesebben:

**Hol állítod be a kulcsot?**
- `Settings.defaultVatRatePercentForNewProducts` — csak javaslat új termék felvitelekor.
- `Product.defaultVatRatePercent` — termékenkénti alapértelmezett kulcs, ami minden beszerzés/eladás rögzítésekor előre kitöltődik.
- `PurchaseLot.vatRatePercent` / `Movement.vatRatePercent` — a **ténylegesen alkalmazott** kulcs, tételenként felülírható és eltárolva, hogy utólag is visszakereshető legyen, melyik ügyletnél mi volt a kulcs.

**Visszaigényelhetőség** csak beszerzésnél értelmezett (`PurchaseLot.vatReclaimable`, alapból `true`):
- **Visszaigényelhető**: az ÁFA-összeg a visszaigényelhető egyenlegbe kerül, **nem** része az egységköltségnek.
- **Nem visszaigényelhető**: külön, csak tájékoztató kategóriába kerül, és — mivel valódi, meg nem térülő kiadás — **beépül a termék egységköltségébe** (`lotUnitCost`, lásd fent).

Eladás ÁFA-ja mindig **befizetendő** (nincs "visszaigényelhető" eladási oldalon).

**Automatikus vs kézi tételek — miért nem keverednek soha:**
Az automatikus ÁFA (minden VAT-kulccsal rögzített beszerzés/eladás) **soha nem** kerül perzisztált `LedgerEntry` sorként a naplóba — mindig élőben, a `lots`/`movements` adatból számolódik újra (`computeAutoVatTotals`, `listAutoVatRows`). Ez zárja ki eleve a duplikáció lehetőségét egy kézzel felvitt ÁFA-tétellel szemben. A kombinált egyenleget a `computeCombinedVatSummary` állítja össze, forrás szerint (kézi / automatikus-beszerzés / automatikus-eladás) mindig külön-külön is látható bontásban.

Egy **visszavont (sztornózott) eladás** automatikus ÁFA-tétele nem tűnik el — látható marad "Stornózva" jelöléssel (auditálhatóság miatt), de **nulla hatással van az egyenlegre**.

**Hol jelenik meg mindez a UI-ban?** Kizárólag a dedikált **ÁFA oldalon** (`/afa`, `pages/Vat.tsx`): kombinált egyenleg-kártya, forrás szerinti bontó táblázat, automatikus tételek listája, és a kézzel felvitt ÁFA-kategóriájú napló-tételek teljes kezelése (létrehozás/szerkesztés/törlés/visszaállítás). A termékenkénti kulcs-beállítás továbbra is a termék adatlapján van — ez tudatos döntés, hogy egy beállításnak egy helye legyen (lásd 11.2).

### 7.3 Riasztások és insightok (`lib/alerts.ts`)

| Számítás | Logika röviden |
|---|---|
| `computeProductInsight` | átlagos napi fogyás (`avgConsumptionWindowDays` ablakban) → napok a kifutásig → `needsReorder`/`reorderUrgent` a beszállítói szállítási idő + biztonsági tartalék alapján → javasolt rendelési mennyiség a `reorderTargetDays` célra |
| `computeSlowMoving` | az utolsó `slowMovingWindowDays` fogyását hasonlítja az azt megelőző, ugyanolyan hosszú időszakhoz; ha a visszaesés a küszöb felett van, "lassan fogyó" |
| `computeTransferSuggestions` | ugyanazon termék (SKU/név alapján azonosítva) más telephelyen lévő felesleges készletét ajánlja fel áthelyezésre az alacsony készletű helyre, rendelés helyett |
| `computeMarginReport` | termékenkénti eladott mennyiség/árbevétel/költség/árrés egy időszakra — a haszonkulcs riport alapja |
| `computeUnpaidSales` / `computeCustomerBalances` | vevőnkénti kifizetetlen eladások és összesített tartozás |
| `computeOpenSales` | "kiadásra vár"/"kiszállítás alatt" státuszú, még nem kézbesített eladások |

Mindezt egyetlen helyen, egyszerre számolja újra a `useAlerts()` hook (`src/hooks/useAlerts.ts`) — ez adja a Riasztások oldal, a Kezdőlap összefoglaló kártyái és a Riportok oldal "Vevői tartozás" szekciójának adatait is, mindig ugyanabból a logikából.

### 7.4 Fizetési kötelezettségek (`lib/payables.ts`)

A **kimenő** (a vállalkozás által fizetendő) kötelezettségeket fogja össze két forrásból: lejárt/esedékes `PurchaseLot` beszállítói számlák (`lotGrossHuf` — a teljes, ÁFA-val növelt összeg) és `dueDate`-tel ellátott `LedgerEntry` kiadás-tételek. `isAlertWorthy` akkor igaz, ha lejárt VAGY a `Settings.paymentReminderDaysBefore` legnagyobb értékén belül esedékes.

### 7.5 Pénzügyi napló / eredménykimutatás (`lib/ledger.ts`)

A `computeFinancialSummary` állítja össze a P&L-t egy adott időszakra, **négy forrásból**:
1. kézzel felvitt napló-tételek kategóriánként (`computeCategoryTotals`)
2. a készletből eladott áru árbevétele (`inventoryRevenue`, a `computeMarginReport`-ból)
3. az **abban az időszakban beszerzett** (nem eladott!) készlet költsége (`inventoryCost`, `computeInventoryPurchaseCost`) — a beszerzés a beszerzés pillanatában lesz kiadás, nem akkor, amikor a termék végül elkel
4. **automatikus ÁFA** (`autoVatIncome`/`autoVatExpense`): a beszerzésből eredő visszaigényelhető ÁFA bevételként, az eladásból eredő befizetendő ÁFA kiadásként — ugyanolyan elszámolás-alapon (accrual), mint a beszerzés maga. A **nem visszaigényelhető** beszerzési ÁFA itt szándékosan **nem** jelenik meg még egyszer, mert az már be van építve az `inventoryCost`-ba a `lotUnitCost` egységköltségen keresztül — ha itt is hozzáadnánk, az duplán számolná.

```
totalIncome  = ledgerIncomeTotal  + inventoryRevenue + autoVatIncome
totalExpense = ledgerExpenseTotal + inventoryCost     + autoVatExpense
netResult    = totalIncome - totalExpense
```

A Pénzügyi napló oldal mindkét kártyán és a kategóriánkénti összesítő táblázatban is kiírja külön-külön ezt a bontást, hogy minden forint forrása visszakövethető legyen.

### 7.6 Szállítási költség kimutatás (`lib/shipping.ts`)

Beszállítónkénti és/vagy időszakonkénti (nap/hét/hónap/év) bontásban külön mutatja az áru értékét és a szállítási/fuvar költséget — ugyanabból a `PurchaseLot.shippingCost` mezőből, amit a `lotUnitCost` az egységköltségbe is beleolvaszt, de itt szándékosan elkülönítve marad, hogy kimutatható legyen, mennyit tesz ki a szállítás a beszerzés egészéhez képest.

### 7.7 Export (`lib/export.ts`)

Generikus `exportToExcel`/`exportToPdf` — az oldalak egy `ExportColumn<T>[]` definíciót és sima objektum-sorokat adnak át, a modul maga nem tud semmit az üzleti logikáról. Az ExcelJS/jsPDF könyvtárak és a beágyazott magyar betűtípus csak exportáláskor töltődnek be dinamikus importtal (`import()`), hogy ne terheljék az alkalmazás kezdeti betöltési méretét.

---

## 8. Navigáció és oldalak

### 8.1 Navigációs elv

A bal oldali menü (`components/Layout.tsx`) **8, lenyitható/összecsukható csoportba** van rendezve (állapotuk localStorage-ban megmarad, az aktuális oldal csoportja mindig automatikusan nyitva van). Vezérelv: **minden funkciónak pontosan egy elérési pontja van a menüben** — nincs két menüpont, ami ugyanarra az oldal+szűrő kombinációra mutat. Ahol egy funkció logikailag több területhez is kapcsolódna (pl. az ÁFA-kulcs a Készlethez és a Pénzügyhez is köthető lenne), a **beállítás** egy helyen marad (a termék adatlapján), és csak a hozzá tartozó **kimutatás** kap saját menüpontot (ÁFA oldal), nem a beállítás duplikálódik.

| Csoport | Menüpontok |
|---|---|
| **Áttekintés** | Kezdőlap, Riasztások |
| **Készlet** | Termékek, Mozgásnapló |
| **Vevők** | Vevők |
| **Beszállítók** | Beszállítók |
| **Pénzügy** | Pénzügyi napló, ÁFA, Fizetési kötelezettségek |
| **Riportok** | Riportok |
| **Előzmények** | Audit napló |
| **Beállítások** | Beállítások, Telephelyek |

A "Fizetési kötelezettségek" menüpont a `/riasztasok?szuro=fizetesi` mélylinkre mutat (a Riasztások oldal saját szűrőjére) — ez **nem** duplikáció, hanem egy másik oldal saját szűrőjéhez vezető, kontextuálisan releváns parancsikon; az `isItemActive`/`activeGroupKey` logika a Layout.tsx-ben gondoskodik róla, hogy az aktív-jelölés a teljes útvonal+querystring alapján, ne csak az útvonal alapján történjen.

### 8.2 Route-tábla (`App.tsx`)

| Útvonal | Oldal | Mit csinál |
|---|---|---|
| `/` | `Dashboard.tsx` | Gyors mozgásrögzítő űrlap + riasztás-összefoglaló kártyák + legsürgősebb rendelések |
| `/keszlet` | `Products.tsx` | Termékek CRUD, szűrés, soft-delete UI, export |
| `/mozgasnaplo` | `Movements.tsx` | Az összes bejövő/kimenő mozgás, szűrhető dátum/termék/típus/**vevő**/**eladási státusz** szerint, exporttal; itt kezelhető az eladás-visszavonás és a per-tétel ÁFA szerkesztés is |
| `/riasztasok` | `Alerts.tsx` | Minden riasztás-típus egy helyen, szűrő-chipekkel (`?szuro=` querystring) |
| `/beszallitok` | `Suppliers.tsx` | Beszállítók CRUD |
| `/vevok` | `Customers.tsx` | Vevők CRUD + kifizetetlen egyenlegük |
| `/telephelyek` | `Locations.tsx` | Telephelyek CRUD |
| `/riportok` | `Reports.tsx` | Haszonkulcs kimutatás + Szállítási költség kimutatás (egy oldalon, saját gyorsnavigációval) |
| `/penzugyi-naplo` | `Ledger.tsx` | Az általános pénzügyi napló: bevétel/kiadás tételek, eredménykimutatás-kártyák, kategóriánkénti összesítés |
| `/afa` | `Vat.tsx` | A dedikált ÁFA oldal — lásd 7.2 |
| `/audit-naplo` | `AuditLog.tsx` | A teljes rendszer audit naplója, szűrhető és exportálható |
| `/beallitasok` | `Settings.tsx` | Globális beállítások + "veszélyzóna" (demó adat visszaállítás / összes adat törlése) |

### 8.3 Fontosabb újrahasznált komponensek

| Komponens | Szerepe |
|---|---|
| `MovementForm.tsx` | A mozgásrögzítő űrlap — mind a Kezdőlapon (beágyazva), mind egy lebegő gombbal minden más oldalon (modalban) elérhető |
| `ProductForm.tsx` | Termék létrehozás/szerkesztés, benne az ÁFA-kulcs beállítással |
| `LedgerEntryForm.tsx` | Napló-tétel létrehozás/szerkesztés — `initialCategory` prop-pal előre kitölthető (pl. az ÁFA oldal "Új ÁFA tétel" gombja `'ÁFA'`-ra állítja) |
| `DeleteChoiceDialog.tsx` | Korrekciós tétel vs egyszerű törlés választó (lásd 6.1) |
| `HistoryPanel.tsx` | Egy adott entitás audit-előzményei (lásd 6.2) |
| `ProductPicker.tsx` | Kereshető termékválasztó (csak aktív termékeket listáz) |
| `ui.tsx` | Megosztott alap-UI elemek: `Button`, `Card`, `Input`, `Select`, `Checkbox`, `Field`, `FieldGroup`, `PageHeader`, `EmptyState` stb. |

---

## 9. Fő munkafolyamatok

### 9.1 Beszerzés rögzítése (bejövő mozgás)
`MovementForm` → `recordMovement({ type: 'in', ... })` a store-ban. Ez: (1) létrehoz egy `PurchaseLot`-ot a megadott áron/pénznemben/ÁFA-adatokkal, (2) frissíti a termék `currentStock`-ját és `purchasePrice` (súlyozott átlag) mezőjét, (3) **azonnal** kiadásnak számít a Pénzügyi naplóban (lásd 7.5), (4) ha van `dueDate`, megjelenik a fizetési kötelezettségek között, (5) audit-bejegyzést kap.

### 9.2 Eladás rögzítése (kimenő mozgás)
Ugyanaz az űrlap, `type: 'out'`. Ha a készlet a rögzítés után negatívba menne, a rendszer megerősítést kér (`ConfirmDialog`), mielőtt engedélyezné (`allowNegativeStock: true`). Opcionálisan vevőhöz köthető (fizetési státusszal), és mindig kap egy `saleStatus: 'pending'` kezdőállapotot, ami a Mozgásnaplóban egy legördülőből léptethető tovább.

### 9.3 Eladás visszavonása (stornó)
`cancelSale(movementId, reason)`: ha a státusz még nem `'delivered'`, azonnal engedélyezett; ha már kézbesítve volt, extra megerősítés kell. A visszavonás **nem törli** az eredeti mozgást — csak `cancelled: true`-ra állítja —, hanem egy új, **korrekciós 'in' mozgást** hoz létre ugyanazzal a `recordMovement` mechanizmussal (`correctsMovementId` hivatkozással), `unitPrice`-ként az eredeti `unitCost`-ot használva. Ez FIFO módban egy új réteget hoz létre, átlagár módban visszaolvad az átlagba — mindkettő a meglévő, jól tesztelt logikán megy át, nem kell külön "visszavonás" költségszámítást írni. Ha az eladás ki volt fizetve, a UI figyelmeztet, hogy visszatérítés szükséges lehet, de ezt nem automatizálja.

### 9.4 Tétel törlése — korrekció vs soft delete
Lásd 6.1.

### 9.5 ÁFA kezelése egy tranzakción
Lásd 7.2 — a kulcs a termékről öröklődik alapból, de minden tranzakción felülírható és külön eltárolva marad.

### 9.6 Fizetési kötelezettség nyomon követése
Beszerzésnél a `MovementForm`-on (`dueDate` + `invoicePaid`), napló-tételnél a `LedgerEntryForm`-on (`dueDate` + `isPaid`) kapcsolható be. A Riasztások oldal "Fizetési kötelezettség" szűrője, illetve a Kezdőlap összegző kártyája mutatja a lejárt/közelgő tételeket, `Settings.paymentReminderDaysBefore` szerint.

---

## 10. Fejlesztés, build, deployment

### 10.1 Helyi fejlesztés
```bash
npm install
npm run dev       # http://localhost:5173
```

### 10.2 Ellenőrzés commit előtt
```bash
npx tsc -b        # típusellenőrzés
npm run build     # típusellenőrzés + produkciós build
npm run lint      # oxlint
```

### 10.3 Webes deployment
A `claude/inventory-management-app-yjc3v5` branch-re történő push automatikusan új Vercel deploy-t indít (statikus SPA build, `npm run build` kimenete).

### 10.4 Windows asztali alkalmazás
A `.github/workflows/build-windows.yml` GitHub Actions workflow (Windows runner-en) minden, a fenti branch-re történő, `src/**`/`electron/**`/`package.json`/`vite.config.ts` érintő push-ra lefut: lebuildeli a webes alkalmazást, becsomagolja az `electron/` mappában lévő Electron shell-be (`electron/main.js`), és `electron-builder`-rel `.exe` telepítőt készít, amit GitHub Actions artifact-ként tölt fel.

> **Megjegyzés a fejlesztési folyamatról**: a felhasználó explicit kérésére a Windows build futtatása/figyelése átmenetileg szüneteltetve volt a fejlesztés alatt (hogy ne fusson feleslegesen minden apró változtatásnál), amíg az alkalmazás el nem készül.

---

## 11. Ismert tervezési döntések és korlátok

### 11.1 `HashRouter` és az in-app "ugrás a szekcióhoz" linkek
Az alkalmazás `HashRouter`-t használ (`#/utvonal` formátum), mert statikus fájl-hosting alól (Vercel + Electron `file://`) egyszerűbb így routolni szerver-oldali konfiguráció nélkül. **Fontos következmény**: egy sima `<a href="#szekcio-id">` horgony-link felülírná magát az útvonalat, mert a hash MAGA az útvonal-állapot. Ezért minden oldalon-belüli "ugrás a szekcióhoz" navigáció (pl. a Riportok oldal gyorsnavigációja) `element.scrollIntoView()`-t használ egy `onClick` handlerben, sosem `href="#..."`-t.

### 11.2 Nincs valódi backend / többfelhasználós támogatás
Minden adat egyetlen böngésző `localStorage`-ában él. Nincs szinkronizáció eszközök között, nincs több egyidejű felhasználó, nincs jogosultságkezelés. A `Settings` oldal "Veszélyzóna" szekciója (`resetToDemoData`/`clearAllData`) éles használatban félrekattintással adatvesztést okozhat — mindkettő megerősítő dialógust kér, de nincs "undo".

### 11.3 A "duplikáció" elleni tudatos döntések
A fejlesztés során több kör is zajlott a menü- és funkció-duplikációk felszámolására (lásd az audit naplóban/git történetben): önálló "Beszerzési tételek" és "Eladások" menüpontok megszűntek a Mozgásnapló szűrőinek javára; a "Szállítási költség kimutatás" egyetlen helyre került; a "Bevétel kereső" és "Vevői tartozás" riportok eltávolításra kerültek a Riportok oldalról (a felhasználó kifejezett kérésére); az ÁFA minden nézete egyetlen dedikált oldalra lett összevonva. **Ha valaki új menüpontot vagy riportot ad hozzá, érdemes előbb megnézni, nincs-e már ugyanaz a funkció máshol elérhető formában.**

### 11.4 Régi adatok / visszafelé kompatibilitás
Néhány mező (pl. `Movement.unitCost`, `saleUnitPrice`, `saleStatus`) az alkalmazás egy későbbi fejlesztési fázisában jelent meg — a kód mindenhol explicit `?? fallback` mintával kezeli azt az esetet, amikor egy régebbi (a mező bevezetése előtt rögzített) rekordon ezek hiányoznak, hogy a riportok ne omoljanak össze rajtuk.

---

## 12. Hol keressem, ha...

| Kérdés | Fájl |
|---|---|
| "Hogyan számolódik egy termék aktuális egységköltsége?" | `lib/costing.ts` |
| "Miért nem ugyanaz a bevétel a Pénzügyi naplóban és a Riportokban?" | `lib/ledger.ts` (`computeFinancialSummary`) — más az, amit mérnek: az egyik a teljes P&L-t, a másik csak a termékeladást nézi. Lásd 7.5. |
| "Hogyan kezeli a rendszer az ÁFA-t?" | `lib/vat.ts`, `pages/Vat.tsx`, 7.2. fejezet |
| "Hol dől el, mi számít riasztásnak?" | `lib/alerts.ts`, `Settings` mezői |
| "Hogyan törlődik/marad meg egy rekord?" | `SoftDeletable` a `types/index.ts`-ben, minden `deleteX`/`restoreX` akció a `store/useStore.ts`-ben, 6. fejezet |
| "Hol vannak a menüpontok definiálva?" | `components/Layout.tsx`, `NAV_GROUPS` |
| "Hogyan működik az export?" | `lib/export.ts` |
| "Milyen demó adat töltődik be alapból?" | `store/seed.ts` |
