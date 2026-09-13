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
- riasztási rendszer (alacsony készlet, lassan fogyó termék, rendelési javaslat, áthelyezési javaslat, kifizetetlen eladás, lejáró/lejárt fizetési kötelezettség, nyitott eladás, hiányzó napi zárás)
- napi zárás telephelyenként, iroda felé küldött jelentéssel és jóváhagyási munkafolyamattal (több telephelyes/raktáras működéshez)
- teljes körű, soft-delete alapú auditálhatóság — semmi nem törlődik ténylegesen, minden változás naplózva van
- Excel/PDF export minden fontosabb listánál és riportnál

Az alkalmazás alapból **kliensoldali, backend nélküli** SPA: minden üzleti adat (termékek, mozgások, pénzügyi napló stb.) a böngésző `localStorage`-ában tárolódik, egyetlen felhasználó/böngésző-profil használja — ez a mai éles (Vercel) deploy és a Windows asztali build viselkedése, változatlanul.

Emellett opcionálisan bekapcsolható egy **különálló, additív SaaS/előfizetéses réteg** (cégenkénti regisztráció, bejelentkezés, próbaidőszak/előfizetés-kezelés, admin áttekintés — lásd **12. fejezet**), amely csak a *webes* verzióra vonatkozik, és amíg nincs Supabase-hez kötve, teljesen inaktív: az alkalmazás pontosan úgy működik, mint korábban.

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
| SaaS réteg (opcionális, csak web) | Supabase (Postgres + Auth + Row Level Security), `@supabase/supabase-js` — lásd 12. fejezet |

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
    auth/                      — Register/Login/ForgotPassword/ResetPassword (SaaS réteg, 12. fejezet)
  App.tsx                     — route-tábla
  lib/supabase.ts            — Supabase kliens + `isSupabaseConfigured` (12. fejezet)
  lib/subscription.ts        — előfizetés-állapotgép tiszta logikája (12.4)
  lib/remoteSync.ts           — megosztott üzleti adat (locations/products/movements/lots/dailyClosings/auditLog) Supabase-mapperei + szinkron (14.4)
  hooks/useAuth.tsx           — Auth/cég/előfizetés/szerepkör React context (12. és 14. fejezet)
  components/RoleGate.tsx      — route-szintű raktáros/iroda hozzáférés-kikényszerítés (14.5)
  pages/Team.tsx                — meghívó-kezelés iroda-jogosultsághoz (14.6)
  types/auth.ts                — Company/Profile/Invite típusok + sor-mapperek
  vite-env.d.ts                 — a `VITE_SUPABASE_*` env változók típusai
electron/                     — Windows desktop csomagoló (Electron + electron-builder)
.github/workflows/
  build-windows.yml           — Windows telepítő buildelése GitHub Actions-ben
supabase/
  schema.sql                  — a SaaS réteg adatbázis-sémája + RLS szabályok (12.2)
  functions/create-checkout-session/ — előkészített, de NEM bekötött Stripe Edge Function váz (12.5)
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
Globális beállítások: költségszámítási mód (`costingMethod`), riasztási időablakok és küszöbök, `paymentReminderDaysBefore: number[]` (pl. `[7,3,1]`), `defaultVatRatePercentForNewProducts`, `missingClosingGraceDays` (lásd 4.10).

### 4.9 `AuditLogEntry`
Lásd 6. fejezet.

### 4.10 `DailyClosing` (napi zárás)
Egy telephely egy napjának lezárt, iroda felé elküldött mozgás-összesítője. `status: 'submitted' | 'viewed' | 'approved'`, `inCount`/`outCount` (hány bejövő/kimenő mozgás), `productBreakdown: DailyClosingProductRow[]` (termékenkénti be/ki mennyiség, névvel és mértékegységgel a küldés pillanatában lefényképezve), `movementIds` (visszakövethetőség a Mozgásnaplóhoz), és `modifiedAfterSubmission?`/`lastModifiedAt?` — ha egy már elküldött zárás által lefedett mozgást utólag korrigálnak, vagy egy már lezárt napra új mozgás kerül, ez a két mező jelzi (a zárás saját, elküldött számai **soha nem íródnak felül** - lásd 7.8 és 9.7).

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

Ha egy `Movement`-hez tartozó telephely+nap kombinációra már el lett küldve egy **napi zárás** (lásd 4.10 és 7.8), a `deleteMovement` store-akció **kényszerítve korrekciós módra vált**, függetlenül attól, mit kért a hívó fél — a `DeleteChoiceDialog` UI-ja ilyenkor eleve el sem rejti az "Egyszerű törlés" gombot (`correctionOnlyReason` prop), hogy a felhasználó ne találkozzon egy olyan gombbal, ami a háttérben másképp viselkedne, mint amit a felirata sugall.

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

### 7.8 Napi zárás (`lib/dailyClosing.ts`)

Két tiszta függvény:

- **`buildDailyClosingSummary(movements, products, locationId, date)`** — összegyűjti egy telephely egy napjának összes aktív mozgását, és termékenkénti be/ki bontássá alakítja. Ezt hívja meg mind a küldés előtti előnézet (`pages/DailyClosing.tsx`), mind a tényleges `submitDailyClosing` store-akció — így a kettő garantáltan sosem tér el egymástól.
- **`computeMissingClosings(locations, movements, closings, graceDays, today)`** — minden `(telephely, nap)` párt megkeres, ahol volt aktív mozgás, de nincs hozzá elküldött zárás, a `Settings.missingClosingGraceDays` türelmi idő figyelembevételével. Egy 30 napos "lookback" ablakra korlátozva fut (`MISSING_CLOSING_LOOKBACK_DAYS`), hogy egy telephely régi, nyomon követés előtti napjai ne spammeljék örökké a riasztást. **Egy olyan nap, amin egyáltalán nem volt mozgás, nem számít "hiányzónak"** - ez tudatos értelmezés, lásd 11.5.

Ezt a `hooks/useAlerts.ts` hívja meg (`missingClosings` mezőként), így ugyanaz a riasztás jelenik meg a Riasztások oldalon és a Beérkezett napi jelentések oldalon is — nincs külön, párhuzamos értesítési csatorna (lásd 9.7).

**Hogyan marad a zárás "soha nem törlődik/módosul utólag" elvű?** A `submitDailyClosing` store-akció (`store/useStore.ts`) a `buildDailyClosingSummary` eredményét egyszer, a küldés pillanatában lefényképezi a `DailyClosing` rekordba - ez utána **soha nem számolódik újra és nem íródik felül**. Ha egy already-closed napra eső mozgást utólag korrigálnak (lásd 9.4), vagy egy már lezárt napra új mozgás kerül, a `flagClosingModified` helper (`useStore.ts`) csak egy `modifiedAfterSubmission: true` + `lastModifiedAt` jelzést tesz rá - a zárás eredeti száma változatlan marad, csak egy figyelmeztető jelzés utal rá, hogy érdemes újranézni. Ez pontosan ugyanaz a minta, mint a korrekciós tételeké (6.1): a történelem nem íródik felül, csak kiegészül.

---

## 8. Navigáció és oldalak

### 8.1 Navigációs elv

A bal oldali menü (`components/Layout.tsx`) **8, lenyitható/összecsukható csoportba** van rendezve (állapotuk localStorage-ban megmarad, az aktuális oldal csoportja mindig automatikusan nyitva van). Vezérelv: **minden funkciónak pontosan egy elérési pontja van a menüben** — nincs két menüpont, ami ugyanarra az oldal+szűrő kombinációra mutat. Ahol egy funkció logikailag több területhez is kapcsolódna (pl. az ÁFA-kulcs a Készlethez és a Pénzügyhez is köthető lenne), a **beállítás** egy helyen marad (a termék adatlapján), és csak a hozzá tartozó **kimutatás** kap saját menüpontot (ÁFA oldal), nem a beállítás duplikálódik.

| Csoport | Menüpontok |
|---|---|
| **Áttekintés** | Kezdőlap, Riasztások, Beérkezett napi jelentések |
| **Készlet** | Termékek, Mozgásnapló, Napi zárás |
| **Vevők** | Vevők |
| **Beszállítók** | Beszállítók |
| **Pénzügy** | Pénzügyi napló, ÁFA, Fizetési kötelezettségek |
| **Riportok** | Riportok |
| **Előzmények** | Audit napló |
| **Beállítások** | Beállítások, Telephelyek |
| **Fiók** *(csak ha a Supabase be van állítva és be van jelentkezve)* | Előfizetés, Admin *(Admin csak platform-adminnak)* |

A "Fiók" csoport a `Layout.tsx` `buildNavGroups()` függvényével jön létre dinamikusan — amíg a SaaS réteg nincs bekonfigurálva (`isSupabaseConfigured === false`), ez a csoport egyáltalán nem jelenik meg, és a menü byte-azonos a korábbi állapottal. Lásd 12. fejezet.

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
| `/napi-zaras` | `DailyClosing.tsx` | Telephely + nap választása, aznapi mozgás-előnézet, zárás elküldése, korábbi zárások telephelyenkénti előzménye — lásd 9.7 |
| `/napi-jelentesek` | `DailyReports.tsx` | Iroda-nézet: minden telephely zárása telephelyenként csoportosítva, megtekintés/jóváhagyás, hiányzó zárások listája — lásd 9.7 |
| `/audit-naplo` | `AuditLog.tsx` | A teljes rendszer audit naplója, szűrhető és exportálható |
| `/beallitasok` | `Settings.tsx` | Globális beállítások + "veszélyzóna" (demó adat visszaállítás / összes adat törlése) |
| `/elofizetes` | `Subscription.tsx` | A cég előfizetési állapota, próbaidő/köv. fizetés, demó aktiválás/lemondás — lásd 12.4 |
| `/admin` | `Admin.tsx` | Platform-admin nézet: minden regisztrált cég + becsült havi bevétel — lásd 12.6 |
| `/csapat` | `Team.tsx` | Iroda-only: raktáros/iroda meghívók létrehozása, felhasználók listája — lásd 14.6 |

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

### 9.7 Napi zárás küldése és jóváhagyása (több telephelyes működés)

1. **Küldés (raktár oldal, `/napi-zaras`)**: a felhasználó kiválaszt egy telephelyet és egy napot. Ha arra a kombinációra még nincs zárás, a rendszer élőben megmutatja az előnézetet (`buildDailyClosingSummary`: hány bejövő/kimenő tétel, termékenkénti bontás). A "Napi zárás elküldése" gomb `submitDailyClosing(locationId, date)`-et hív, ami lefényképezi az összegzést egy `DailyClosing` rekordba, `status: 'submitted'`-del. Nulla mozgású napra vagy már lezárt napra a küldés elutasított (`SubmitDailyClosingResult`).
2. **Zárolás**: mostantól az adott telephely+nap mozgásai csak korrekciós tétellel javíthatók (lásd 6.1 és 9.4) — a Mozgásnaplóban egy "zárva" jelvény is jelzi ezt a dátum mellett.
3. **Fogadás (iroda oldal, `/napi-jelentesek`)**: minden telephely minden zárása itt látszik, telephelyenként csoportosítva, állapot szerint (Beküldve → Megtekintve → Jóváhagyva). A "Megtekintés" gomb megnyitja a tételes bontást **és** automatikusan `markDailyClosingViewed`-et hív (ha még `'submitted'` volt). A "Jóváhagyás" gomb `approveDailyClosing`-ot hív, `approvedAt` időbélyeggel.
4. **Hiányzó zárás riasztása**: a `computeMissingClosings` (7.8) eredménye a `useAlerts()`-en keresztül **ugyanabban a riasztás-objektumban** utazik, mint minden más riasztás — ezért jelenik meg azonos elven a Riasztások oldalon (`?szuro=hianyzo-zaras` chip), a Kezdőlap összegző kártyáján, **és** a Beérkezett napi jelentések oldal saját "Hiányzó napi zárások" kártyáján is, mindhárom helyen ugyanabból az egy számításból, sosem külön csatornán. Mindegyik hely "Zárás pótlása" linket ad a `/napi-zaras?telephely=X&datum=Y` mélylinkre.
5. **Utólagos módosítás jelzése**: ha egy már zárt napra eső mozgást korrigálnak (vagy egy új mozgás kerül rá), a zárás `modifiedAfterSubmission` jelzést kap (7.8) - ez látszik mind a `/napi-zaras` oldal saját nézetén (figyelmeztető sáv), mind a `/napi-jelentesek` táblázat "Utólag módosult" jelvényén, mind az audit naplóban.
6. **Történeti visszakeresés**: a `/napi-zaras` oldal alján minden korábbi zárás listázva van telephelyenként, dátum-tartomány szerint szűrve (`usePersistedDateRange`), exportálható Excel/PDF-be - egy zárás sosem tűnik el, csak a fenti módosítás-jelzést kaphatja meg.
7. **Élő, még nem véglegesített nézet az irodának**: mivel egy telephely naponta csak egyszer küld zárást, a `/napi-jelentesek` oldal tetején egy "Folyamatban - mai nap" kártya megmutatja MINDEN olyan telephely mai napi be/ki-számát, amelyik még nem küldött zárást aznapra - ugyanazzal a `buildDailyClosingSummary`-vel számolva, amit a raktár oldali előnézet is használ, tehát a két nézet sosem térhet el egymástól. Ez a szakasz csak a MÁR JÓVÁHAGYOTT mozgásokat számolja (lásd 15.4) - egy még jóváhagyásra váró (`approvalStatus: 'pending'`) rendelés/kiszállítás tudatosan nem jelenik meg itt, mert ezek még nem történtek meg ténylegesen; ha ezt is látni kell, arra a Kezdőlap/Riasztások "Jóváhagyásra váró tételek" kártyája szolgál (15.7).

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

### 11.2 Nincs valódi backend / többfelhasználós támogatás az üzleti adatokra
Minden **üzleti** adat (termékek, mozgások, pénzügyi napló, audit napló stb.) továbbra is egyetlen böngésző `localStorage`-ában él. Nincs szinkronizáció eszközök között, nincs több egyidejű felhasználó ezekre az adatokra, nincs szerver-oldali jogosultságkezelés rajtuk. A `Settings` oldal "Veszélyzóna" szekciója (`resetToDemoData`/`clearAllData`) éles használatban félrekattintással adatvesztést okozhat — mindkettő megerősítő dialógust kér, de nincs "undo".

**Ez a korlát külön áll a 12. fejezetben leírt SaaS rétegtől**: az utóbbi valódi, szerver-oldali (Supabase Auth + RLS) bejelentkezést és cég-elkülönítést ad a *fiók/előfizetés* adatokra, de az üzleti adatokat (termékek, mozgások stb.) egyelőre **nem** migrálja szerverre — lásd 12.7, ahol ez explicit ki van mondva.

### 11.3 A "duplikáció" elleni tudatos döntések
A fejlesztés során több kör is zajlott a menü- és funkció-duplikációk felszámolására (lásd az audit naplóban/git történetben): önálló "Beszerzési tételek" és "Eladások" menüpontok megszűntek a Mozgásnapló szűrőinek javára; a "Szállítási költség kimutatás" egyetlen helyre került; a "Bevétel kereső" és "Vevői tartozás" riportok eltávolításra kerültek a Riportok oldalról (a felhasználó kifejezett kérésére); az ÁFA minden nézete egyetlen dedikált oldalra lett összevonva. **Ha valaki új menüpontot vagy riportot ad hozzá, érdemes előbb megnézni, nincs-e már ugyanaz a funkció máshol elérhető formában.**

### 11.4 Régi adatok / visszafelé kompatibilitás
Néhány mező (pl. `Movement.unitCost`, `saleUnitPrice`, `saleStatus`) az alkalmazás egy későbbi fejlesztési fázisában jelent meg — a kód mindenhol explicit `?? fallback` mintával kezeli azt az esetet, amikor egy régebbi (a mező bevezetése előtt rögzített) rekordon ezek hiányoznak, hogy a riportok ne omoljanak össze rajtuk.

### 11.5 "Hiányzó napi zárás" csak ott jelez, ahol volt mozgás
A `computeMissingClosings` (7.8) tudatosan **nem** kéri számon minden naptári napra a zárást minden telephelyen — csak azokra a napokra, amiken **ténylegesen volt legalább egy aktív mozgás** az adott telephelyen. Ellenkező esetben egy ritkán mozgó telephely vagy egy régen (a funkció bevezetése előtt) létrehozott telephely minden múltbeli napja hamis riasztásként jelenne meg. Ha ez a viselkedés nem felel meg (pl. minden naptári napot zárni kell, mozgás nélkül is), a `computeMissingClosings` `daysWithActivity` szűrését kell módosítani.

---

## 12. Előfizetéses réteg (SaaS)

> **Ez a fejezet a B) réteget írja le: cégenkénti regisztráció/bejelentkezés, próbaidőszak/előfizetés-kezelés, admin áttekintés.** Kizárólag a webes verzióra vonatkozik — a Windows/Electron build változatlanul offline, egy-bérlős, bejelentkezés nélküli marad (ez szándékos döntés volt, lásd a fejlesztés során hozott döntést a 12.1-ben).

### 12.1 Áttekintés és a `isSupabaseConfigured` kapcsoló

A teljes réteg (regisztráció, bejelentkezés, előfizetés-oldal, admin nézet) **teljesen additív és alapból inaktív**. A `src/lib/supabase.ts` exportálja az `isSupabaseConfigured` boolean-t, ami csak akkor `true`, ha a `VITE_SUPABASE_URL` és `VITE_SUPABASE_ANON_KEY` build-időben be van állítva (lásd `.env.example`). Amíg ezek nincsenek beállítva:

- a `src/components/AuthGate.tsx` egyszerűen átengedi a gyerek-komponenseket (`return <>{children}</>`) — nincs bejelentkezés-kényszer,
- a `Layout.tsx`-ben a "Fiók" navigációs csoport (Előfizetés, Admin) egyáltalán nem jelenik meg,
- a `/elofizetes` és `/admin` route-ok technikailag léteznek, de gyakorlatilag elérhetetlenek (nincs rájuk mutató link, és tartalmuk `useAuth()`-ból üres/`null` állapotot kapna).

Ez azt jelenti, hogy a jelenlegi, konfigurálatlan éles (Vercel) deploy-t ennek a rétegnek a hozzáadása **nem érinti** — az alkalmazás pontosan úgy viselkedik, mint korábban, amíg valaki explicit nem hoz létre egy Supabase projektet és nem állítja be az env változókat.

A desktop (Electron/Windows) build a felhasználó kifejezett döntése alapján **nem** kapja meg ezt a réteget — csak a webes verzió lett többbérlőssé téve.

### 12.2 Adatbázis-séma és RLS (`supabase/schema.sql`)

Két tábla, mindkettő Row Level Security-vel védve:

- **`public.companies`** — egy regisztrált vállalkozás: név, `subscription_status` (`trial`/`active`/`expired`/`cancelled`), `trial_ends_at` (alapból `now() + 14 nap`), `plan`/`plan_price_huf`, `current_period_end`, `payment_failed_at`, `cancelled_at`, és előkészített (de üres) `stripe_customer_id`/`stripe_subscription_id` mezők.
- **`public.profiles`** — egy `auth.users` felhasználót köt egy céghez, `is_platform_admin` flaggel.

RLS policy-k biztosítják, hogy egy lekérdezés SQL-szinten se tudjon átlógni egy másik cég sorára:

| Policy | Tábla | Mit enged |
|---|---|---|
| "Saját cég megtekintése" / "Saját cég módosítása" | `companies` | csak a saját `profiles.company_id`-hoz tartozó sort |
| "Admin minden céget lát" | `companies` | `is_platform_admin = true` esetén az összeset |
| "Saját profil megtekintése" | `profiles` | csak `id = auth.uid()` |
| "Admin minden profilt lát" | `profiles` | `is_platform_admin = true` esetén az összeset |

Két trigger egészíti ki:

- **`handle_new_user`** (`security definer`, `auth.users`-re csatolva) — regisztrációkor automatikusan létrehoz egy `companies` sort (a névvel, amit a `signUp` hívás `company_name` metaadatként küld) és egy hozzá kapcsolt `profiles` sort. Emiatt a regisztráció egyetlen lépésben létrehozza a teljes, elkülönített céges adatteret.
- **`prevent_self_admin_promotion`** — hard-blokkolja, hogy bárki saját magát `is_platform_admin = true`-ra állítsa, akár egy direkt `update` hívással is. Az első admin fiókot **kizárólag** a Supabase SQL Editorban lehet kijelölni (lásd a séma fájl végén lévő utasítást) — az alkalmazás felületén sehol nincs erre gomb.

A sémát a Supabase Dashboard SQL Editorában kell lefuttatni, mielőtt az env változókat beállítod.

### 12.3 Auth flow és a `HashRouter` ütközés elkerülése

Az app `HashRouter`-t használ (`#/utvonal`), a Supabase alap (implicit) auth flow-ja viszont `#access_token=...`-t fűzne a redirect URL-hez — ez összeomlasztaná a route-állapotot. Emiatt:

- a Supabase kliens `flowType: 'pkce'`-vel jön létre (`lib/supabase.ts`) — ez `?code=...` query paramot használ, ami a `#` ELŐTT van, tehát nem ütközik a hash-routing-gal,
- a jelszó-visszaállítás `redirectTo` URL-je explicit nem tartalmaz hash-t (`hooks/useAuth.tsx` `requestPasswordReset`),
- az `AuthGate.tsx` modul-betöltéskor (React state-en kívül) detektálja a `?code=` jelenlétét (`hasPasswordRecoveryCode`), és ha van, a `ResetPassword` képernyőt mutatja, függetlenül attól, hogy épp melyik route hash aktív.

### 12.4 Előfizetés-állapotgép (`src/lib/subscription.ts`)

```
trial ──(trial_ends_at lejár)──► olvasásra korlátozva
  │
  ▼ (demoActivateSubscription / valós fizetés)
active ──(payment_failed_at + 5 nap türelmi idő eltelik)──► olvasásra korlátozva
  │
  ▼ (lemondás / lejárat)
expired / cancelled ──► mindig olvasásra korlátozva
```

A `computeIsReadOnly(company, now)` tiszta függvény adja meg, hogy a cég jelenleg csak-olvasható állapotban van-e — ezt használja a `useAuth()` hook `isReadOnly` mezője, amit a `Layout.tsx` egy piros figyelmeztető sávval jelez az oldal tetején, és amivel elrejti a gyors mozgásrögzítő lebegő gombot. **Fontos**: ez a "csak olvasható" gating jelenleg **reprezentatív, nem kimerítő** — a leggyakoribb belépési pont (a lebegő gomb) le van tiltva, de az egyes oldalak (Termékek, Mozgásnapló stb.) saját CRUD-gombjai nincsenek egyenként végigauditálva/letiltva ebben a körben. Ha ez kritikus, a következő lépés egy `useAuth().isReadOnly`-ra épülő, oldal-szintű `disabled` propagálás minden létrehozó/szerkesztő gombra.

A `PAYMENT_FAILED_GRACE_DAYS` konstans (5 nap) szabályozza a türelmi időt sikertelen fizetés után.

### 12.5 Fizetés: Stripe, de egyelőre KIZÁRÓLAG demó módban

A felhasználó kifejezett kérésére a fizetési integráció **nincs éles Stripe-hoz kötve**. Ami készen van:

- `src/pages/Subscription.tsx` — "Előfizetés indítása (demó)" / "Előfizetés lemondása" gombok, amik a `useAuth()` `demoActivateSubscription`/`demoCancelSubscription` függvényeit hívják. Ezek **közvetlenül a `companies` táblát írják át** a Supabase kliensen keresztül — nincs bankkártya-terhelés, nincs Stripe API-hívás. Az oldalon egy jól látható kék infó-doboz explicit közli, hogy ez demó mód.
- `supabase/functions/create-checkout-session/index.ts` — egy **nem működő, nem deploy-olt** Deno Edge Function váz, ami megmutatja, hova kerülne egy valós Stripe Checkout Session létrehozása (`@ts-nocheck`-kel jelölve, szándékosan kimaradva a `tsconfig.app.json` buildjéből, hogy semmilyen módon ne befolyásolja a mostani buildet).

**Ha valaha éles fizetést kell bekötni**, ehhez kellene: egy valós Stripe fiók + termék/ár létrehozása, a fenti Edge Function kitöltése és deploy-olása, egy Stripe webhook végpont a `payment_failed`/`invoice.paid` eseményekhez (ami a `companies.payment_failed_at`/`current_period_end`/`stripe_*` mezőket írná service role kulccsal), és a `Subscription.tsx` gombjainak átkötése a demó-függvényekről a valós Checkout Session indítására.

### 12.6 Admin (üzemeltetői) nézet

A `src/pages/Admin.tsx` (`/admin`) csak `profile.isPlatformAdmin === true` esetén mutat tartalmat — de a **valódi** határ az adatbázisban van: egy nem-admin felhasználó `companies` lekérdezése RLS miatt eleve csak a saját cégét adná vissza, akkor is, ha valahogy elérné ezt az oldalt. A nézet listázza az összes regisztrált céget, állapotukat, próbaidő/köv. fizetés dátumát, és egy becsült havi bevételt (`active` állapotú cégek `plan_price_huf` összege — mivel a fizetés demó módban fut, ez egy demonstrációs összeg, nem tényleges bevétel).

Az első admin fiók bootstrap-olása kizárólag SQL-lel történik — lásd 12.2.

### 12.7 Mi az, ami VALÓDI, tesztelt biztonsági határ — és mi nem

Ez a szakasz szándékosan explicit, mert a felhasználói kérés kifejezetten "kritikus biztonsági pontként" nevezte meg az adatelkülönítést:

**Valódi, adatbázis-szinten kikényszerített határ** (Supabase Auth + RLS, lásd 12.2): a `companies` és `profiles` táblák — vagyis *ki melyik céghez tartozik*, a cég neve, előfizetési állapota, próbaideje. Ezt egy rosszul írt frontend-hiba, elírt azonosító vagy hiányzó jogosultság-ellenőrzés sem tudja megkerülni, mert a Postgres maga tagadja meg a hozzáférést.

**NEM (még) szerver-oldali, tehát NEM ugyanolyan erősségű határ**: minden **üzleti adat** — termékek, mozgások, vevők, beszállítók, pénzügyi napló, napi zárások, audit napló. Ezek ma is a böngésző `localStorage`-ában élnek, cégenkénti elkülönítés nélkül a szerveren, mert ez az adatréteg még nem lett migrálva Supabase-re (ez egy jelentős, önálló migrációs munka lenne: minden `store/useStore.ts` akciót Supabase lekérdezésekre kellene cserélni, RLS policy-kat írni minden táblához, és megoldani az offline/desktop build kompatibilitását). **Amíg ez nincs megcsinálva, több regisztrált cég egy közös géppel/böngészővel technikailag ugyanazt a `localStorage`-ot látná az üzleti adatokra** — ez a jelenlegi állapot explicit korlátja, nem egy elfelejtett részlet.

Ha a több-cégnyi üzleti adat is szerver-oldali, RLS-szel garantált elkülönítést igényel, az egy külön, ennél lényegesen nagyobb következő lépés.

---

## 14. Szerepkör alapú hozzáférés és megosztott üzleti adat (raktáros/iroda)

> Ez a fejezet a 12. fejezetre épül, és lezárja annak 12.7-es pontjában jelzett hiányt: a **raktáros/iroda szerepkör-szétválasztás** miatt a `locations`/`products`/`movements`/`purchase_lots`/`daily_closings`/`audit_log` adat immár **valóban megosztott, Supabase-en, RLS-sel védett** adat — nem csak a cég/előfizetés rétegé.

### 14.1 Miért kellett ehhez üzleti adatot migrálni

A raktáros/iroda felhasználók a valóságban külön eszközön dolgoznak (külön telephely). Amíg a termékek/mozgások/telephelyek/napi zárás csak `localStorage`-ban élt (12.7), egy "a raktáros csak a saját telephelyét lássa" korlátozás csak kozmetikai lett volna: a raktáros és az iroda gépe két teljesen külön adatot látott volna. Ezért ez a funkció explicit kiterjesztette a Supabase-re migrált táblák körét.

### 14.2 Mi migrált, és mi maradt szándékosan eszközönkénti

| Migrált (Supabase, RLS-sel, cégen és telephelyen belül szűrve) | Eszközönkénti maradt (localStorage, csak irodai gépen) |
|---|---|
| `locations`, `products`, `purchase_lots`, `movements`, `daily_closings`, `audit_log` | `suppliers`, `customers`, `ledgerEntries`/`ledgerCategories`, `settings` |

A jobb oldali lista azért maradhatott eszközönkénti: egyik sem szükséges a raktáros korlátozott nézetéhez (mindegyik kifejezetten irodai/pénzügyi adat, amit a raktáros nem is lát), és a teljes migráció (12.7-ben már jelzett, nagyobb munka) továbbra sem ennek a körnek a feladata volt. **Következmény, amit tudni kell**: ha az iroda egy ÚJ eszközről jelentkezik be, ez a 4 adatkör üresen indul azon az eszközön (nincs "szerver-oldali" forrásuk) - csak a régi (első) irodai eszközön marad meg a korábbi állapotuk.

### 14.3 Adatbázis-séma és RLS (`supabase/schema.sql`, "Szerepkör alapú..." blokk)

A `profiles` tábla két új mezőt kap: `role` (`'raktaros'` / `'iroda'`, alapból `'iroda'`) és `assigned_location_id`/`assigned_location_name` (csak raktárosnál). Nincs UPDATE policy a `profiles` táblán semelyik mezőre - így sem a raktáros, sem az iroda nem tudja saját magát/másokat direkt API-hívással átállítani másik szerepkörre vagy telephelyre; ezt kizárólag a regisztrációkori `handle_new_user()` trigger állíthatja be (14.6), vagy az üzemeltető SQL-ből.

A 6 migrált tábla mindegyikén RLS szabja meg, mit lát/írhat egy `iroda` (a teljes cég) kontra egy `raktaros` (csak `location_id = assigned_location_id` sorok) felhasználó - lásd a séma fájl kommentjeit minden táblánál. Kiemelt pontok:

- **`daily_closings` UPDATE**: kizárólag iroda jogosultsággal lehetséges - egy raktáros adatbázis-szinten sem hagyhatja jóvá a saját zárását.
- **`purchase_lots`**: a raktáros technikailag olvashatja/írhatja a saját telephelye tételeit (a FIFO-fogyás kiszámításához szükséges), annak ellenére, hogy a felület sosem mutatja neki az árat/költséget - lásd 14.7.
- **`products` UPDATE**: sor-szintű, nem oszlop-szintű - lásd 14.7 a pontos korlátról.

### 14.4 A szinkron-mechanizmus (`src/lib/remoteSync.ts`, `store/useStore.ts`)

A `useStore.ts` **egyetlen sora sem változott az üzleti logikában** (FIFO, súlyozott átlagár, audit diffelés, korrekciós tételek stb.) - ez tudatos döntés volt a hibalehetőség minimalizálására. Ehelyett egy vékony szinkron-réteg került rá:

- `dataMode: 'local' | 'remote'` és `remoteCompanyId` új mező az állapotban.
- A store belső `set` függvénye egy `rawSet`-et burkoló wrapperré vált: minden állapotváltás után, ha `dataMode === 'remote'`, a 6 megosztott tömböt **referencia szerint** összeveti a módosítás előtti állapottal (minden mutáló akció úgyis csak az érintett elem(ek) referenciáját cseréli le - `.map(x => x.id === id ? {...x, ...} : x)` minta), és a ténylegesen megváltozott/új sorokat a háttérben felírja Supabase-be (`pushBusinessDiffs`). Egyetlen akciót sem kellett emiatt egyenként átírni.
- Bejelentkezéskor (`hooks/useAuth.tsx`) a `hydrateFromRemote(companyId, slices)` letölti a 6 tábla RLS által már eleve leszűrt tartalmát, és ez tölti fel a store-t - ez a hívás direktben `useStore.setState`-et használ, megkerülve a fenti szinkron-wrappert, hogy a letöltött adat ne íródjon rögtön vissza.
- Kijelentkezéskor / munkamenet nélkül `resetToLocalMode()` visszaáll `'local'` módra, és `useStore.persist.rehydrate()`-tel visszatölti ennek a böngészőnek a saját (nem cégekhez kötött) `localStorage` állapotát.
- A `persist` middleware `partialize`-a mindig `dataMode: 'local'`-t ír `localStorage`-ba (egy oldalújratöltés sosem "emlékszik" magától remote módra - azt mindig az aktuális Supabase-munkamenet dönti el újra), és amíg ténylegesen remote módban van, a 6 megosztott tömböt üresen írja ki, hogy egy másik cégbe való bejelentkezés se örököljön semmit a böngésző helyi gyorsítótárából.

**"Local-first, best-effort" szinkron**: egy mutáció azonnal érvényesül a memóriában (a felhasználó nem vár a hálózatra), a Supabase-írás a háttérben, hibát csak a konzolra logolva fut - hálózati hiba esetén a HELYI állapot NEM gördül vissza. Ez elfogadható kompromisszum egy raktári/irodai eszköznél, de érdemes tudni: átmeneti internet-kiesés esetén egy művelet "helyileg sikeresnek tűnhet", miközben a szerver-oldali írás elakadt, amíg a kapcsolat helyre nem áll (a következő sikeres írás/frissítés természetesen pótolja, mivel a diffelés mindig az AKTUÁLIS állapotot nézi).

### 14.5 Raktáros nézet - mit mutat, mit rejt

| Oldal | Raktárosnak |
|---|---|
| Kezdőlap | Csak a saját telephely készlet-jellegű kártyái (alacsony készlet, rendelendő, lassan fogyó, hiányzó zárás) - kifizetetlen eladás/fizetési kötelezettség/nyitott eladás rejtve |
| Termékek | Csak a saját telephely termékei (RLS miatt eleve csak ezek érkeznek meg), beszerzési ár rejtve, létrehozás/szerkesztés/törlés rejtve |
| Mozgásnapló | Csak a saját telephely mozgásai, ár/ÁFA/vevő oszlopok és az ÁFA-szerkesztés gomb rejtve, export is ezek nélkül |
| Napi zárás | Csak a saját telephely (a telephely-választó eleve egy opciót tartalmaz) |
| Riasztások | `useAlerts()` a vevő/fizetés-jellegű riasztásokat (kifizetetlen eladás, fizetési kötelezettség, nyitott eladás, áthelyezési javaslat) `raktaros` szerepkörnél ki sem számolja - lásd 14.7, miért ez fontosabb, mint pusztán elrejteni a kártyát |
| Beszállítók, Vevők, Telephelyek, Riportok, Pénzügyi napló, ÁFA, Beérkezett napi jelentések, Audit napló, Beállítások, Előfizetés, Csapat | Route-szinten letiltva (`RoleGate`, `App.tsx`) - közvetlen URL-beírással sem érhető el |

A nav (`Layout.tsx` `RAKTAROS_NAV_GROUPS`) ennek megfelelően csak 5 menüpontot mutat.

### 14.6 Csapat / meghívó rendszer

Mivel a Supabase önkiszolgáló regisztrációja (`signUp`) csak új céget tud létrehozni, egy raktáros-fiók hozzáadásához az iroda a `/csapat` oldalon (`pages/Team.tsx`) hoz létre egy **meghívót** (`invites` tábla: cél cég, szerepkör, telephely, 7 napos lejárat, token). A generált linket (`?meghivo=TOKEN`) manuálisan kell eljuttatni a raktároshoz (pl. üzenetben) - nincs automatikus emailküldés. A meghívott a `?meghivo=` paraméterrel megnyitott regisztrációs oldalon (`AuthGate.tsx` érzékeli, `pages/auth/Register.tsx` "Csatlakozás meghívóval" módban nyílik meg) csak email+jelszó megadásával csatlakozik - a `handle_new_user()` trigger (SECURITY DEFINER, tehát RLS-t megkerülve fér hozzá a tokenhez) ellenőrzi a meghívó érvényességét, majd a MEGLÉVŐ céghez, a meghívóban megadott szerepkörrel/telephellyel hozza létre a profilt, ahelyett hogy új céget hozna létre.

### 14.7 Tudatos korlátok, amiket explicit ki kell mondani

- **`purchase_lots` technikailag elérhető a raktárosnak**: a felület sosem mutatja neki a beszerzési árat/egységköltséget, de az adatbázis-hozzáférés megvan (szükséges a FIFO-számításhoz, amikor ő rögzít egy kimenő mozgást). Ez NEM ugyanolyan erősségű korlát, mint a telephely-elkülönítés - egy technikailag hozzáértő raktáros a böngésző fejlesztői eszközeivel közvetlenül lekérdezhetné a saját telephelye beszerzési árait a Supabase kliensen keresztül.
- **`products`/`movements`/`purchase_lots` UPDATE policy-k sor-szintűek, nem oszlop-szintűek**: a raktáros a saját telephelyén technikailag bármely mezőt módosíthatná egy direkt API-hívással (pl. egy termék nevét vagy eladási árát), nem csak azt, amit a felülete ténylegesen felkínál neki.
- **A "local-first, best-effort" szinkron** (14.4) nem garantálja tranzakciós erősséggel, hogy a memóriabeli és a Supabase-beli állapot mindig azonos - csak azt, hogy előbb-utóbb konvergálnak, amint a hálózat rendben van.
- **A régi (migráció előtti) audit-bejegyzések nem kerültek át** Supabase-be - egy meglévő, korábban létrehozott cég `audit_log`-ja üresen indul, csak az ezután történő események kerülnek bele.
- **A "Veszélyzóna" (demó adat visszaállítása / összes adat törlése)** a `Settings` oldalon `dataMode === 'remote'` esetén le van tiltva - egy éles, megosztott céges adatot egyetlen böngészőből visszaállítani/törölni túl kockázatos, ezért ez csak a helyi (nem cégekhez kötött) módban érhető el.
- **A jóváhagyási munkafolyamat (15. fejezet) RLS-szabályai nem tesznek különbséget mozgás-irány/jóváhagyási-lépés szerint** - a `movements` tábla UPDATE policy-i telephely/cég-szinten engednek írást, nem "csak raktáros hagyhat jóvá beérkezést"/"csak iroda hagyhat jóvá kiszállítást" szinten. Vagyis egy technikailag hozzáértő raktáros direkt API-hívással elméletileg jóváhagyhatná a saját kiszállítását is, holott a felület ezt sosem ajánlja fel neki. Ugyanaz a korlát-osztály, mint a fenti oszlop-szintű pont.

---

## 15. Kétlépcsős jóváhagyási munkafolyamat (beszerzés/eladás, iroda ↔ raktár)

> Ez a fejezet a 14. fejezetre épül (raktáros/iroda szerepkör, megosztott Supabase-adat) - additív hozzá: a mozgás-rögzítés normál útja mostantól két lépésben történik, iroda és raktár között megosztva, ahelyett hogy bárki azonnal, egy lépésben rögzítené a végleges mozgást.

### 15.1 A két irány

**Bejövő (beszerzés) - iroda indítja, raktár hagyja jóvá:** az iroda a Mozgásnapló "Rendelés leadása" gombjával (`components/PurchaseOrderForm.tsx`) felvesz egy FÜGGŐBEN LÉVŐ 'in' mozgást (termék, mennyiség, várható ár/szállítás/ÁFA, dátum) - ez **nem** növeli a készletet, és nem jön létre hozzá `PurchaseLot`. A raktáros (a Mozgásnaplóban a "Beérkezésre vár" jelzésű sor jóváhagyás-gombjával, `components/ApprovePurchaseOrderModal.tsx`) hagyja jóvá a TÉNYLEGES beérkezéskor, a ténylegesen átvett mennyiséggel (ha eltér a rendelttől) - **csak ekkor** jön létre a valódi `PurchaseLot`, és nő a készlet/frissül a beszerzési ár (FIFO/átlagár, a beállított módszer szerint, változatlan logikával - lásd 7.1).

**Kimenő (eladás) - raktár indítja, iroda hagyja jóvá:** a raktáros a Mozgásnapló "Kiszállítás előkészítése" gombjával (`components/SalePrepForm.tsx`) felvesz egy FÜGGŐBEN LÉVŐ 'out' mozgást - szándékosan **csak** terméket/mennyiséget/vevőt kérdez, árat/ÁFA-t nem, mert ez nem az ő adata (14.5). Ez **nem** csökkenti a készletet. Az iroda (`components/ApproveSaleModal.tsx`) hagyja jóvá - ekkor állítja be az ÁFA kulcsot és a fizetési állapotot, ekkor snapshotolódik az eladási ár, ekkor csökken ténylegesen a készlet FIFO-fogyással, és ekkor generálódik az automatikus ÁFA-tétel (lib/vat.ts változatlan logikájával). Az iroda **elutasíthatja** is, indoklással (`rejectSalePrep`) - a raktáros ekkor a "Javítás és újraküldés" gombbal (`components/ResubmitSaleModal.tsx`, `resubmitPendingMovement` store-akció) módosíthatja és újraküldheti, ami visszaállítja "jóváhagyásra vár" állapotba.

### 15.2 Adatmodell (`Movement.approvalStatus`, lásd `types/index.ts`)

`approvalStatus?: 'pending' | 'approved' | 'rejected'` - **`undefined` = már véglegesített**, azonos jelentéssel mint `'approved'`. Ez a kulcs a visszamenőleges kompatibilitáshoz: minden, e funkció előtt rögzített mozgás, és minden, a `recordMovement`-en (közvetlen/azonnali rögzítés - lásd 15.5) keresztül létrehozott mozgás automatikusan "már véglegesített"-nek számít, változtatás nélkül.

Kiegészítő mezők, csak a pending/jóváhagyott 'in' mozgásokon értelmesek: `orderedQuantity` (az eredetileg rendelt mennyiség, megmarad a jóváhagyás utáni esetleges eltérés nyomon követhetőségéhez - a `quantity` mező jóváhagyás UTÁN a TÉNYLEGESEN beérkezett mennyiséget tartalmazza), `discrepancyNote` (eltérés/probléma szövege, mindkét irányon használható), `approvedAt`/`rejectedAt`/`rejectReason`.

**Egyszerűsítés, amit tudni kell**: a felhasználói specifikáció három állapotot nevezett meg mindkét irányra (pl. bejövőre "Rendelve → Beérkezésre vár → Jóváhagyva"), de mivel nem volt leírva külön, kézi átmenet az első két állapot között, ez az implementáció **kettőre** vonja össze őket (`pending`, a felületen a kontextusnak megfelelő címkével jelenítve meg: "Rendelve"/"Beérkezésre vár" ugyanaz az egy adatpont, csak más-más oldalról nézve).

### 15.3 A `useStore.ts` mutáló logikája **változatlan** maradt

A meglévő `recordMovement`/`deleteMovement`/`cancelSale` teljes FIFO/átlagár/korrekciós/audit logikája egyetlen sorban sem változott. A jóváhagyási munkafolyamat egy KIEGÉSZÍTŐ akció-készlet:

| Akció | Mit csinál |
|---|---|
| `createPendingPurchaseOrder` | Létrehoz egy `approvalStatus: 'pending'` 'in' mozgást - nincs készlet-/lot-hatás |
| `approvePurchaseOrder(id, actualQuantity?, discrepancyNote?)` | Létrehozza a valódi `PurchaseLot`-ot a TÉNYLEGES mennyiséggel, frissíti a készletet/beszerzési árat (ugyanazzal a FIFO/átlagár logikával, mint `recordMovement`), és - ha a mozgás dátuma egy már lezárt napra esik - `flagClosingModified`-del jelzi az érintett napi zárást (lásd 9.7) |
| `createPendingSalePrep` | Létrehoz egy `approvalStatus: 'pending'` 'out' mozgást - nincs készlethatás |
| `approveSalePrep(id, { vatRatePercent?, isPaid? }, opts?)` | FIFO-fogyás a JÓVÁHAGYÁS pillanatában érvényes tételekből (nem az előkészítéskori állapotból!) - emiatt a jóváhagyás `insufficient-stock`-kal elutasulhat, ha a készlet közben elfogyott; sikeres jóváhagyáskor csökken a készlet, snapshotolódik az eladási ár/egységköltség, beállítódik az ÁFA |
| `rejectSalePrep(id, reason)` | `approvalStatus: 'rejected'`, semmilyen készlethatás |
| `resubmitPendingMovement(id, { quantity?, customerId?, note? })` | Egy `pending` vagy `rejected` tétel mennyiségét/vevőjét/megjegyzését módosítja, és visszaállítja `pending`-re |

`deleteMovement` és `cancelSale` ennek megfelelően ágaznak: egy `pending`/`rejected` mozgás (sosem érintette a készletet) egyszerű `deleteMovement`-tel törölhető, a zárt-napos korrekciós szabály és a `cancelSale` stornó-folyamat rá nem vonatkozik (`cancelSale` explicit `not-approved` hibával utasítja el, ha megpróbálják rajta meghívni); egy már jóváhagyott (vagy a funkció előtti, `approvalStatus` nélküli) mozgásra változatlanul a teljes, korábban leírt logika vonatkozik (6.1, 9.4).

### 15.4 Miért nem számít bele semmilyen riasztásba/ÁFA-ba/zárásba egy függő tétel

A `lib/alerts.ts`, `lib/dailyClosing.ts` és `lib/vat.ts` "aktív mozgás" szűrői (`isActiveMovement` és a VAT-sor szűrők) kiegészültek: egy `pending` vagy `rejected` mozgás ugyanúgy kizáródik, mint egy soft-deletelt vagy stornózott. Emiatt egy függő tétel nem jelenik meg a készletszint-számításban, a haszonkulcs-riportban, az ÁFA-egyenlegben, vagy egy napi zárás összegzésében - pontosan addig, amíg jóvá nem hagyják.

### 15.5 Mi maradt: a közvetlen/azonnali rögzítés

A meglévő `MovementForm`/gyors-mozgásrögzítés (Kezdőlap, lebegő gomb) **változatlanul elérhető marad** mindkét szerepkörnek - ez a jóváhagyási munkafolyamatot **kiegészíti**, nem váltja ki (a felhasználói kérés explicit ezt kérte). Ezt a formot érdemes olyan esetekre fenntartani, ahol a kétlépcsős egyeztetés felesleges lenne (pl. leltári korrekció, egyszemélyes/kis vállalkozás, ahol ugyanaz az ember tölti be mindkét szerepet). **Ez egy tudatos értelmezési döntés** - ha a szándék az volt, hogy az azonnali rögzítés teljesen megszűnjön és minden bejövő/kimenő tétel kötelezően a jóváhagyási úton menjen, ezt jelezni kell, és a `MovementForm`-ot route-/szerepkör-szinten le kell tiltani.

### 15.6 Szándékosan NEM implementált: foglalt készlet

A specifikáció explicit kérte, hogy egy jóváhagyásra váró kimenő tétel **ne** zárjon el mennyiséget más elől (`currentStock` csak jóváhagyáskor változik). Ez azt jelenti, hogy két egyidejűleg előkészített kiszállítás elméletileg ugyanarra a korlátozott készletre hivatkozhat, és csak a MÁSODIK jóváhagyása bukik el `insufficient-stock`-kal (ezt a 15.3 táblázat jelzi). A kódstruktúra ezt tudatosan nem zárja ki egy jövőbeli bővítéstől: egy `reservedQuantity` nézet a `pending` 'out' mozgások mennyiségeinek összegéből egyszerűen levezethető lenne, a jelenlegi logika átírása nélkül.

### 15.7 Dashboard/Riasztások integráció

`useAlerts.ts` három új, **nem** irodai-only mezőt ad (`pendingPurchaseApprovals`, `pendingSaleApprovals`, `rejectedSales`) - ezek szándékosan NEM szűrődnek `isWarehouseUser` szerint, mert pont a raktárosnak szólnak elsősorban. A Kezdőlapon (`pages/Dashboard.tsx`) egy "Jóváhagyásra váró tételek" kártya jelenik meg, szerepkör szerint más tartalommal: raktáros a beérkezésre váró rendeléseit és az elutasított (javításra váró) kiszállításait látja, iroda a rá váró kiszállítás-jóváhagyásokat.

---

## 16. Csak iroda hozhat létre új terméktörzsadatot

A raktáros mozgást (akár a 15. fejezet jóváhagyási workflow-ján, akár a közvetlen `MovementForm`-on keresztül) kizárólag már létező, iroda által felvitt termékhez rögzíthet - új termék "menet közbeni" létrehozására sehol nincs felület. Három, egymástól független szinten van kikényszerítve:

1. **Felület**: `pages/Products.tsx` az "Új termék" gombot (és vele a létrehozó `ProductForm` modal teljes elérési útját) `!isWarehouseUser` mögé rejti - raktáros szerepkörben a `creating` állapot sehonnan nem állítható be.
2. **Nincs inline létrehozás a mozgásrögzítő űrlapokon**: `components/ProductPicker.tsx` (amit `MovementForm`/`PurchaseOrderForm`/`SalePrepForm` egyaránt használ termékválasztásra) kizárólag a már meglévő `products` tömbből keres/választ - nincs "új termék" opciója. Az `addProduct` store-akciót az egész kódbázisban egyedül a `ProductForm` hívja, ami viszont csak az 1. ponton leírt, elrejtett úton érhető el.
3. **Adatréteg** (a valódi, megkerülhetetlen határ): a `products` táblán a Supabase RLS-ben (`supabase/schema.sql`) **nincs INSERT policy raktáros szerepkörre** - csak `"Iroda terméket létrehozhat"` létezik, `role = 'iroda'`-ra szűkítve. Egy raktáros felhasználó tehát adatbázis-szinten sem tudna terméket beszúrni, akkor sem, ha valahogy megkerülné a felületet. Emellett a `store/useStore.ts` `addProduct` akciója is védve van egy kliens-oldali `remoteRole` ellenőrzéssel (`state.dataMode === 'remote' && state.remoteRole === 'raktaros'` esetén no-op) - ez nem önmagában a biztonsági határ (azt az RLS adja), hanem azért kell, hogy a helyi (optimista) állapot sose térjen el attól, amit a szerver úgyis elutasítana.

`remoteRole` (`store/useStore.ts` `AppState`) a `hooks/useAuth.tsx`-ből, a `hydrateFromRemote(companyId, slices, role)` hívással kerül be a store-ba bejelentkezéskor - `null` marad a helyi (nem Supabase-hez kötött) módban, ahol egyáltalán nincs szerepkör-fogalom.

---

## 17. TEMP: `?demo_szerepkor=` - ideiglenes szerepkör-szimuláció Supabase nélkül

> **Ez egy átmeneti, kifejezetten a fejlesztés/tesztelés megkönnyítésére szánt réteg, NEM biztonsági funkció.** Törölhető, amint valódi Supabase-projekt van bekötve, és onnantól nincs is hatása.

Amíg nincs élesben Supabase-projekt (12. fejezet), a raktáros/iroda szerepkör-szétválasztás és a 15. fejezetbeli jóváhagyási workflow kipróbálásához nem kell bejelentkezés - egy query parammal szimulálható:

- `https://<a-deploy-url>/?demo_szerepkor=iroda#/` - teljes hozzáférésű nézet.
- `https://<a-deploy-url>/?demo_szerepkor=raktaros#/` - korlátozott, raktáros nézet, jól látható "DEMO MÓD" sávval a tetején.

**Fontos, hogy a paramétert a `#` ELÉ kell írni**, ugyanúgy, mint a jelszó-visszaállítás `?code=` vagy a meghívó `?meghivo=` paraméterét (11.1, 12.3) - a `HashRouter` mindent a `#` UTÁN route-ként értelmez.

Működés (`hooks/useAuth.tsx` `readDemoRole`): a paraméter csak akkor olvasódik ki, ha `isSupabaseConfigured` `false` - tehát valódi Supabase-bejelentkezés mellett ennek a paraméternek soha nincs hatása, nem gyengítheti a valódi RLS-alapú védelmet. `RoleGate` és minden `isWarehouseUser`-t használó oldal az így kapott `effectiveRole`-t nézi, pontosan úgy, mintha valódi `profile.role` lenne.

**Két fül, közös adat**: mivel demo módban nincs Supabase, mindkét "szerepkör" ugyanazt a böngésző `localStorage`-át olvassa - ha a KÉT URL-t ugyanabban a böngészőben, két külön fülön nyitod meg, mindkettő ugyanazt az üzleti adatot látja (csak más-más szűréssel/jogosultsággal). Egy `App.tsx`-beli `storage` esemény-figyelő gondoskodik róla, hogy amit az egyik fülön csinálsz (pl. rendelés leadása), a másik fülön (frissítés/navigálás után) megjelenjen - ez a fül-közti szinkron nem csak a demóhoz hasznos, a valódi, egy-eszközös, több-fülös használatot is javítja.

---

## 18. Hol keressem, ha...

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
| "Hogyan működik a napi zárás?" | `lib/dailyClosing.ts`, `pages/DailyClosing.tsx`, `pages/DailyReports.tsx`, 7.8. és 9.7. fejezet |
| "Miért nem tudom simán törölni ezt a mozgást?" | Valószínűleg az adott telephely+nap kombinációra már el lett küldve egy napi zárás - lásd 6.1 |
| "Hogyan kapcsoljam be a bejelentkezést/előfizetést?" | `.env.example` + `supabase/schema.sql` + 12. fejezet |
| "Miért nem lát senki bejelentkezés-kérést, pedig telepítettem a SaaS kódot?" | `lib/supabase.ts` `isSupabaseConfigured` — nincs beállítva a két `VITE_SUPABASE_*` env változó, lásd 12.1 |
| "Hogyan lesz valakiből admin?" | Kézzel, a Supabase SQL Editorban - lásd 12.2 vége és 12.6 |
| "Hol az igazi (nem demó) fizetési integráció?" | Nincs még - `supabase/functions/create-checkout-session/index.ts` egy nem bekötött váz, lásd 12.5 |
| "Hogyan hívok meg egy raktárost?" | `pages/Team.tsx` (`/csapat`, iroda-only) - lásd 14.6 |
| "Miért lát a raktáros mindent/semmit sem?" | `hooks/useAuth.tsx` `isWarehouseUser` + `components/RoleGate.tsx` + `lib/remoteSync.ts` RLS-szűrés - lásd 14. fejezet |
| "Hogyan kerül az üzleti adat Supabase-be?" | `lib/remoteSync.ts` (mapperek + fetch/upsert), `store/useStore.ts` `hydrateFromRemote`/a `set` wrapper - lásd 14.4 |
| "Hogyan működik a beszerzés/eladás jóváhagyása?" | `Movement.approvalStatus` (`types/index.ts`), a jóváhagyási store-akciók (`store/useStore.ts`), `components/PurchaseOrderForm.tsx`/`ApprovePurchaseOrderModal.tsx`/`SalePrepForm.tsx`/`ApproveSaleModal.tsx`/`ResubmitSaleModal.tsx` - lásd 15. fejezet |
| "Miért nem jelenik meg egy függő tétel a riasztásokban/ÁFA-ban/zárásban?" | `isActiveMovement` (`lib/alerts.ts`, `lib/dailyClosing.ts`) és a VAT-sor szűrők kizárják a `pending`/`rejected` mozgásokat - lásd 15.4 |
| "Ki hozhat létre új terméket?" | Csak iroda - `pages/Products.tsx` (felület), `store/useStore.ts` `addProduct` (`remoteRole` guard), Supabase RLS (nincs raktáros INSERT policy a `products` táblán) - lásd 16. fejezet |
