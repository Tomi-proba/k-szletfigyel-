-- Készletfigyelő - SaaS réteg adatbázis-sémája.
--
-- Futtasd le TELJES EGÉSZÉBEN egy ÚJ (még üres) Supabase projekt SQL
-- Editorában (Supabase Dashboard > SQL Editor > New query), MIELŐTT
-- beállítod a VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env változókat az
-- appban. HA MÁR FUT élesben egy korábbi verzió ezzel a sémával, NE ezt a
-- fájlt futtasd le újra rajta - helyette a 2026-10-01-i migrációs
-- SQL-blokkot kell lefuttatni (ezt a beszélgetésben/chat-ben kaptad meg),
-- ami ugyanide juttatja el a már létező adatbázist anélkül, hogy bármit
-- töröl belőle.
--
-- Ez a fájl részekből áll (fentről lefelé, egymásra épülve, egyben
-- futtatandó): (1) a bejelentkezés/cég/előfizetés réteg, (2) a szerepkör
-- alapú hozzáférés + a MEGOSZTOTT üzleti adat (telephelyek, termékek,
-- mozgások, beszerzési tételek, napi zárás, audit napló), (3) a
-- jóváhagyási (pending_changes) réteg. A beszállítók, vevők, pénzügyi
-- napló és ÁFA-adat egyelőre SZÁNDÉKOSAN NEM került át ide - ezek
-- továbbra is eszközönkénti (localStorage) irodai adatok; ez egy külön,
-- következő lépésben migrálható át, ha szükséges.
--
-- Cégenkénti adatelkülönítés: minden lekérdezés Row Level Security (RLS)
-- policy-kon megy át, adatbázis-szinten kikényszerítve - egy bejelentkezett
-- felhasználó SQL-szinten sem tud hozzáférni egy másik cég sorához, akkor
-- sem, ha az alkalmazás kódjában lenne egy hiba/elírt azonosító.
--
-- --- NÉGY SZEREPKÖR (2026-10-01-től) -----------------------------------
-- - 'fo_iroda' (fő iroda): teljes írási jog a megosztott üzleti adatra
--   (telephelyek, termékek). Ő hagyja jóvá az 'iroda' szerepkör törzsadat-
--   módosítási kéréseit (lásd pending_changes lentebb), és a raktáros
--   beérkezés/kiszállítás-kéréseit is (movements.approval_status) - ezt
--   mostantól 'iroda' is jóváhagyhatja, nem csak 'fo_iroda'.
-- - 'iroda': UGYANAZT LÁTJA, amit a fő iroda (teljes, cégen belüli
--   rálátás minden telephelyre, minden adatra) - de a telephely/termék
--   törzsadat-módosításai nem azonnal hatnak, hanem egy pending_changes
--   sorként várnak a fő iroda jóváhagyására. Mozgást (be/ki) viszont
--   közvetlenül rögzíthet, és raktáros-kérést jóváhagyhat, pont úgy, mint
--   a fő iroda.
-- - 'tulajdonos': ugyanaz a teljes rálátás, mint a fő irodának, de
--   KIZÁRÓLAG olvasó jogú - sem közvetlen módosítást, sem jóváhagyási
--   kérést nem adhat be, SEMMILYEN táblán. Ez adatbázis-szinten (RLS) van
--   kikényszerítve, nem csak a felületen.
-- - 'raktaros': egyetlen hozzárendelt telephelyre korlátozva - változatlan
--   a korábbi viselkedéshez képest.
create extension if not exists "pgcrypto";

-- Egy regisztrált vállalkozás előfizetési állapota.
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial', 'active', 'expired', 'cancelled')),
  -- Alapértelmezett próbaidőszak: 14 nap. Ha máshogy szeretnéd (pl. 30 nap),
  -- itt és a handle_new_user() függvényben is módosítsd az intervallumot.
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  plan text not null default 'havi_elofizetes',
  plan_price_huf integer not null default 9990,
  current_period_end timestamptz,
  -- Sikertelen fizetés esetén ide kerül az időbélyeg - ebből számolódik a
  -- 3-5 napos türelmi idő, mielőtt a hozzáférés korlátozódna.
  payment_failed_at timestamptz,
  cancelled_at timestamptz,
  -- Éles Stripe integrációhoz - egyelőre üresen marad, a jelenlegi
  -- "Előfizetés" oldal még demó módban működik valós terhelés nélkül.
  -- Lásd supabase/functions/create-checkout-session/index.ts.
  stripe_customer_id text,
  stripe_subscription_id text
);

-- Egy Supabase Auth felhasználó (auth.users) és a hozzá tartozó cég közti kapocs.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  -- A felhasználó valódi neve - regisztrációkor/csapattag-létrehozáskor
  -- kötelező megadni (lásd handle_new_user() lent), hogy az audit napló
  -- ("Ki módosította?") ne csak email címet tudjon mutatni. Nullable marad
  -- a séma szintjén, mert a mezőt bevezető migráció előtt létrejött
  -- profiloknak nincs neve - ezeknél a felület az email címet mutatja
  -- helyette, amíg a felhasználó meg nem adja (lásd pages/Settings.tsx).
  name text,
  -- Ez teszi valakit üzemeltetői (platform admin) jogúvá - lásd lent, hogyan
  -- állítsd be az elsőt. Egy felhasználó SOHA nem tudja saját magát
  -- előléptetni (lásd prevent_self_admin_promotion trigger).
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists profiles_company_id_idx on public.profiles (company_id);

alter table public.companies enable row level security;
alter table public.profiles enable row level security;

-- --- companies RLS ----------------------------------------------------------

create policy "Saját cég megtekintése" on public.companies
  for select using (
    id in (select company_id from public.profiles where profiles.id = auth.uid())
  );

-- A demó előfizetés-váltó gombok (Subscription.tsx) ezen keresztül írják a
-- companies sort. Éles Stripe webhook a service role kulccsal futna (ami
-- megkerüli az RLS-t), tehát ez a policy nem jelent biztonsági rést egy
-- valódi fizetési integrációnál sem.
create policy "Saját cég módosítása" on public.companies
  for update using (
    id in (select company_id from public.profiles where profiles.id = auth.uid())
  );

-- SECURITY DEFINER, hogy a "platform admin vagyok-e" ellenőrzés megkerülje
-- a hívó RLS-ét - enélkül egy, a profiles táblán ÖNMAGÁRA hivatkozó policy
-- "infinite recursion detected in policy for relation profiles" hibával
-- (PostgREST felől 500-as HTTP válasz) állna le MINDEN profiles-
-- lekérdezésnél, a bejelentkezés utáni saját profil betöltését is
-- beleértve - ez élesben pontosan ezt a hibát okozta.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

create policy "Admin minden céget lát" on public.companies
  for select using (
    public.is_platform_admin()
  );

-- --- profiles RLS (alap) ------------------------------------------------------

create policy "Saját profil megtekintése" on public.profiles
  for select using (id = auth.uid());

create policy "Admin minden profilt lát" on public.profiles
  for select using (
    public.is_platform_admin()
  );

-- --- Biztonsági trigger: önmagunkat sosem léptethetjük admin-ná -------------

create or replace function public.prevent_self_admin_promotion()
returns trigger language plpgsql as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin and auth.uid() = old.id then
    new.is_platform_admin := old.is_platform_admin;
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_self_admin_promotion
  before update on public.profiles
  for each row execute function public.prevent_self_admin_promotion();

-- --- Regisztráció: automatikus cég + profil létrehozás ----------------------
-- A cégnevet a signUp hívás options.data.company_name mezőjéből olvassa -
-- lásd src/hooks/useAuth.ts signUp függvényét. A teljes handle_new_user()
-- függvényt lentebb DEFINIÁLJUK ÚJRA (create or replace), hogy a
-- meghívóval történő csatlakozást és az alapértelmezett telephely
-- létrehozását is tudja - ezért itt, elsőre, még csak a triggert vesszük
-- fel, ami a végleges (lentebbi) function-defíníciót fogja hívni,
-- bármikor is fut le a teljes fájl.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_company_id uuid;
  provided_company_name text;
begin
  provided_company_name := coalesce(new.raw_user_meta_data ->> 'company_name', 'Névtelen vállalkozás');

  insert into public.companies (name) values (provided_company_name)
  returning id into new_company_id;

  insert into public.profiles (id, company_id, email)
  values (new.id, new_company_id, new.email);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --- Az első üzemeltetői (admin) fiók beállítása ----------------------------
-- Regisztrálj egy fiókot a normál regisztrációs űrlapon, majd futtasd le
-- (a saját email címeddel):
--
--   update public.profiles set is_platform_admin = true where email = 'te@peldacegem.hu';
--
-- Ezt a lépést KIZÁRÓLAG a Supabase SQL Editorban lehet elvégezni, az
-- alkalmazás felületéről soha - ez szándékos, biztonsági okból.

-- ============================================================================
-- Szerepkör alapú, korlátozott nézetek + a hozzájuk tartozó MEGOSZTOTT
-- üzleti adat.
-- ============================================================================

-- --- Telephelyek -------------------------------------------------------------

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists locations_company_id_idx on public.locations (company_id);

-- A profiles tábla szerepkör/telephely-mezői ITT, a locations tábla
-- létrehozása UTÁN kerülnek fel (az assigned_location_id erre hivatkozik
-- idegen kulcsként), de MÉG A locations-RLS-SZABÁLYOK ELŐTT.
alter table public.profiles
  add column if not exists role text not null default 'iroda' check (role in ('raktaros', 'iroda', 'fo_iroda', 'tulajdonos')),
  add column if not exists assigned_location_id uuid references public.locations (id),
  add column if not exists assigned_location_name text;

-- Ha ezt egy már élő, korábbi (2 szerepkörös) sémán futtatod, a fenti
-- "add column if not exists" nem bővíti a már létező check constraint-et -
-- azt a 2026-10-01-i migrációs blokk külön, explicit DROP+ADD CONSTRAINT-
-- tel kezeli. Friss (üres) projektben ez a sor nem releváns.

-- --- SECURITY DEFINER segédfüggvények -----------------------------------
-- Minden, a profiles táblára vonatkozó jogosultság-ellenőrzést EZEKEN
-- keresztül végzünk, SOHA közvetlen "select ... from public.profiles"
-- albekérdezéssel egy másik policy-n belül - az ugyanis (ha a policy maga
-- is a profiles táblán van, vagy ha a hívó RLS-e közben újra kiértékelődne)
-- "infinite recursion detected in policy for relation profiles" hibát
-- (PostgREST felől 500-as HTTP válasz) okozhat, ahogy élesben ki is
-- derült. A SECURITY DEFINER függvény a belső profiles-lekérdezést a
-- hívó RLS-ét megkerülve futtatja, így sosem rekurzál, bárhonnan hívod.
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_assigned_location_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select assigned_location_id from public.profiles where id = auth.uid();
$$;

alter table public.locations enable row level security;

-- Mindhárom iroda-szintű szerepkör (fő iroda, iroda, tulajdonos) teljes
-- rálátással bír minden telephelyre - a különbség csak az ÍRÁSI jogban van
-- (lásd lentebb: telephely LÉTREHOZÁSA/MÓDOSÍTÁSA kizárólag fő iroda).
create policy "Iroda-szintű szerepkörök minden telephelyet látnak" on public.locations
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );

-- Telephely létrehozása/módosítása/törlése KIZÁRÓLAG fő iroda jog -
-- 'iroda' innentől a store/useStore.ts requestChange()-én keresztül a
-- pending_changes táblába ír, amit a fő iroda hagy jóvá (lásd lejjebb).
create policy "Fő iroda telephelyet létrehozhat" on public.locations
  for insert with check (
    company_id = public.my_company_id() and public.my_role() = 'fo_iroda'
  );
create policy "Fő iroda telephelyet módosíthat" on public.locations
  for update using (
    company_id = public.my_company_id() and public.my_role() = 'fo_iroda'
  )
  with check (
    company_id = public.my_company_id() and public.my_role() = 'fo_iroda'
  );

-- Raktáros KIZÁRÓLAG a saját, hozzárendelt telephelyét látja - más
-- telephely létezéséről sem szerezhet tudomást ezen a lekérdezésen keresztül.
create policy "Raktáros csak a saját telephelyét látja" on public.locations
  for select using (
    id = public.my_assigned_location_id() and public.my_role() = 'raktaros'
  );

-- --- Termékek ------------------------------------------------------------

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  location_id uuid not null references public.locations (id),
  name text not null,
  sku text,
  category text not null default '',
  unit text not null default 'db',
  current_stock numeric not null default 0,
  min_stock numeric not null default 0,
  purchase_price numeric not null default 0,
  sale_price numeric not null default 0,
  supplier_id text,
  default_vat_rate_percent numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists products_company_id_idx on public.products (company_id);
create index if not exists products_location_id_idx on public.products (location_id);

alter table public.products enable row level security;

create policy "Iroda-szintű szerepkörök minden terméket látnak" on public.products
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );

-- Termék létrehozása/módosítása KIZÁRÓLAG fő iroda jog - 'iroda' innentől
-- pending_changes-en keresztül kér módosítást, lásd a locations szekció
-- megjegyzését fentebb ugyanerről a mintáról.
create policy "Fő iroda terméket létrehozhat" on public.products
  for insert with check (
    company_id = public.my_company_id() and public.my_role() = 'fo_iroda'
  );
create policy "Fő iroda terméket módosíthat" on public.products
  for update using (
    company_id = public.my_company_id() and public.my_role() = 'fo_iroda'
  )
  with check (
    company_id = public.my_company_id() and public.my_role() = 'fo_iroda'
  );

-- Raktáros csak a saját telephelyéhez tartozó termékeket látja, és csak a
-- készletmozgás-rögzítés miatt frissítheti azokat (pl. currentStock) - új
-- termék létrehozása/törlése fő iroda jog marad. FONTOS KORLÁT: az UPDATE
-- policy sor-szintű, nem oszlop-szintű - technikailag a raktáros a saját
-- telephelye termékein bármely mezőt (pl. nevet, árat) módosíthatná egy
-- direkt API-hívással, még ha a felület ezt nem is teszi lehetővé. Lásd
-- DOCUMENTATION.md 14. fejezet.
create policy "Raktáros csak saját telephelye termékeit látja" on public.products
  for select using (
    location_id = public.my_assigned_location_id() and public.my_role() = 'raktaros'
  );
create policy "Raktáros a saját telephelye termékeit frissítheti" on public.products
  for update using (
    location_id = public.my_assigned_location_id() and public.my_role() = 'raktaros'
  )
  with check (
    location_id = public.my_assigned_location_id() and public.my_role() = 'raktaros'
  );

-- --- Beszerzési tételek (FIFO-rétegek) ---------------------------------------
-- NEM része a jóváhagyási (pending_changes) körnek - ez mindig a
-- mozgásrögzítés (lásd lentebb) automatikus melléktermékeként jön létre,
-- fő iroda ÉS iroda is közvetlenül kezelheti, változatlanul a korábbi
-- viselkedéshez képest.

create table if not exists public.purchase_lots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid not null references public.products (id),
  movement_id uuid,
  date date not null,
  quantity numeric not null,
  remaining_quantity numeric not null,
  unit_price numeric not null default 0,
  shipping_cost numeric not null default 0,
  currency text not null default 'HUF',
  exchange_rate numeric not null default 1,
  created_at timestamptz not null default now(),
  due_date date,
  is_paid boolean,
  paid_date date,
  vat_rate_percent numeric,
  vat_reclaimable boolean,
  deleted_at timestamptz
);

create index if not exists purchase_lots_company_id_idx on public.purchase_lots (company_id);
create index if not exists purchase_lots_product_id_idx on public.purchase_lots (product_id);

alter table public.purchase_lots enable row level security;

create policy "Iroda-szintű szerepkörök minden tételt látnak" on public.purchase_lots
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );
create policy "Fő iroda és iroda tételt létrehozhat" on public.purchase_lots
  for insert with check (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  );
create policy "Fő iroda és iroda tételt módosíthat" on public.purchase_lots
  for update using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  )
  with check (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  );

-- Raktáros nem látja/kezeli közvetlenül a beszerzési árakat a felületen, de
-- a FIFO-fogyás kiszámításához (amikor kimenő mozgást rögzít) a rendszernek
-- olvasnia/frissítenie kell ezeket a sorokat - a hozzáférés a saját
-- telephelyéhez tartozó termékek tételeire technikailag megvan, akkor is,
-- ha a felület sosem jeleníti meg az árat/költséget neki. Lásd
-- DOCUMENTATION.md 14. fejezet - ez egy tudatos, dokumentált korlát.
create policy "Raktáros a saját telephelye tételeit látja" on public.purchase_lots
  for select using (
    public.my_role() = 'raktaros'
    and product_id in (select id from public.products where location_id = public.my_assigned_location_id())
  );
create policy "Raktáros tételt létrehozhat a saját telephelyén" on public.purchase_lots
  for insert with check (
    public.my_role() = 'raktaros'
    and product_id in (select id from public.products where location_id = public.my_assigned_location_id())
  );
create policy "Raktáros tételt frissíthet a saját telephelyén" on public.purchase_lots
  for update using (
    public.my_role() = 'raktaros'
    and product_id in (select id from public.products where location_id = public.my_assigned_location_id())
  )
  with check (
    public.my_role() = 'raktaros'
    and product_id in (select id from public.products where location_id = public.my_assigned_location_id())
  );

-- --- Készletmozgások ----------------------------------------------------
-- NEM része a pending_changes jóváhagyási körnek - ennek MÁR megvan a
-- saját, dedikált kétlépcsős jóváhagyása (approval_status oszlop lent,
-- lásd DOCUMENTATION.md 15. fejezet) a raktáros által kezdeményezett
-- beérkezés/kiszállítás kérésekhez. 2026-10-01-től ezt a kérést fő iroda
-- ÉS iroda is jóváhagyhatja/elutasíthatja (korábban csak "iroda" - most
-- mindkét iroda-szintű szerepkör).

create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid not null references public.products (id),
  location_id uuid not null references public.locations (id),
  date date not null,
  type text not null check (type in ('in', 'out')),
  quantity numeric not null,
  note text,
  created_at timestamptz not null default now(),
  unit_price numeric,
  shipping_cost numeric,
  currency text,
  exchange_rate numeric,
  unit_cost numeric,
  sale_unit_price numeric,
  customer_id text,
  is_paid boolean,
  vat_rate_percent numeric,
  sale_status text,
  sale_status_changed_at timestamptz,
  cancelled boolean not null default false,
  cancelled_at timestamptz,
  cancel_reason text,
  corrects_movement_id uuid,
  deleted_at timestamptz,
  -- Kétlépcsős jóváhagyási munkafolyamat (iroda <-> raktár) - lásd
  -- DOCUMENTATION.md 15. fejezet. NULL = már véglegesített (ugyanaz, mint
  -- 'approved') - minden, e funkció előtt rögzített mozgás így marad
  -- értelmezhető változtatás nélkül.
  approval_status text check (approval_status in ('pending', 'approved', 'rejected')),
  ordered_quantity numeric,
  discrepancy_note text,
  approved_at timestamptz,
  rejected_at timestamptz,
  reject_reason text
);

create index if not exists movements_company_id_idx on public.movements (company_id);
create index if not exists movements_location_id_idx on public.movements (location_id);

alter table public.movements enable row level security;

create policy "Iroda-szintű szerepkörök minden mozgást látnak" on public.movements
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );
create policy "Fő iroda és iroda mozgást létrehozhat" on public.movements
  for insert with check (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  );
create policy "Fő iroda és iroda mozgást módosíthat" on public.movements
  for update using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  )
  with check (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  );

create policy "Raktáros csak saját telephelye mozgásait látja" on public.movements
  for select using (
    location_id = public.my_assigned_location_id() and public.my_role() = 'raktaros'
  );
create policy "Raktáros mozgást rögzíthet a saját telephelyén" on public.movements
  for insert with check (
    location_id = public.my_assigned_location_id() and public.my_role() = 'raktaros'
  );
create policy "Raktáros a saját telephelye mozgásait módosíthatja" on public.movements
  for update using (
    location_id = public.my_assigned_location_id() and public.my_role() = 'raktaros'
  )
  with check (
    location_id = public.my_assigned_location_id() and public.my_role() = 'raktaros'
  );

-- --- Napi zárás ----------------------------------------------------------

create table if not exists public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  location_id uuid not null references public.locations (id),
  date date not null,
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted', 'viewed', 'approved')),
  viewed_at timestamptz,
  approved_at timestamptz,
  in_count integer not null default 0,
  out_count integer not null default 0,
  product_breakdown jsonb not null default '[]'::jsonb,
  movement_ids text[] not null default '{}',
  modified_after_submission boolean not null default false,
  last_modified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (location_id, date)
);

create index if not exists daily_closings_company_id_idx on public.daily_closings (company_id);

alter table public.daily_closings enable row level security;

create policy "Iroda-szintű szerepkörök minden zárást látnak" on public.daily_closings
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );
create policy "Fő iroda és iroda zárást létrehozhat" on public.daily_closings
  for insert with check (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  );
-- Csak fő iroda vagy iroda állíthatja "megtekintve"/"jóváhagyva" állapotba
-- - a raktáros sosem hagyhatja jóvá a saját zárását, ez adatbázis-szinten
-- is kikényszerítve van, nem csak a felület rejti el a gombot előle.
create policy "Fő iroda és iroda zárást módosíthat" on public.daily_closings
  for update using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  )
  with check (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  );

create policy "Raktáros csak a saját telephelye zárásait látja" on public.daily_closings
  for select using (
    location_id = public.my_assigned_location_id() and public.my_role() = 'raktaros'
  );
create policy "Raktáros elküldheti a saját telephelye zárását" on public.daily_closings
  for insert with check (
    location_id = public.my_assigned_location_id() and public.my_role() = 'raktaros'
  );

-- --- Audit napló -----------------------------------------------------------

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  event_timestamp timestamptz not null default now(),
  entity_type text not null,
  entity_id text not null,
  entity_label text not null,
  action text not null,
  description text not null,
  changes jsonb,
  -- "on delete set null": ha a felhasználót törlik (pl. Auth > Users-ből),
  -- az általa korábban rögzített audit-bejegyzések NE vesszenek el vele
  -- együtt - csak a "ki csinálta" mező üresedik ki.
  -- auth.uid() alapértelmezés: a kliensnek nem kell külön megadnia, ki
  -- rögzítette - mindig a ténylegesen beküldő (RLS-ellenőrzött) felhasználó.
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  -- Denormalizált név/email a bejegyzés RÖGZÍTÉSÉNEK pillanatában - ugyanaz
  -- a minta, mint a pending_changes.requested_by_email: a felületnek nem
  -- kell külön lekérdezést/JOIN-t futtatnia a "ki módosította?" megjelenítéséhez,
  -- és a cég-profilok közti listázási jogosultságtól is független (olvasóként
  -- nem kell profiles SELECT jog ehhez). Soha nem frissül utólag, akkor sem,
  -- ha a felhasználó később átnevezi magát - a napló pontosan azt mutatja,
  -- ki és milyen néven volt bejelentkezve a művelet pillanatában.
  created_by_name text,
  created_by_email text
);

create index if not exists audit_log_company_id_idx on public.audit_log (company_id);

alter table public.audit_log enable row level security;

-- Minden iroda-szintű szerepkör (fő iroda, iroda, tulajdonos) olvashatja a
-- teljes céges audit naplót - a raktárosnak nincs ilyen felülete, és mások
-- tevékenységét sem kell látnia.
create policy "Iroda-szintű szerepkörök olvashatják a céges audit naplót" on public.audit_log
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );
-- Bármelyik céges felhasználó rögzítheti a SAJÁT tevékenységét a naplóba
-- (raktáros is - a saját mozgásrögzítése is bekerül, csak nem látja vissza).
create policy "Bármelyik céges felhasználó naplózhat" on public.audit_log
  for insert with check (
    company_id = public.my_company_id()
  );

-- --- profiles: iroda-szintű szerepkörök látják a cég felhasználóit --------
-- Nincs UPDATE policy a profiles táblán - így senki nem tudja saját
-- magát/másokat direkt API-hívással átállítani másik szerepkörre/
-- telephelyre vagy admin jogra. Szerepkört és telephelyet KIZÁRÓLAG a
-- lentebbi handle_new_user() trigger állíthat be, regisztrációkor
-- (meghívó alapján), vagy az üzemeltető SQL-ből.
create policy "Iroda-szintű szerepkörök látják a cég profiljait" on public.profiles
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );

-- --- Meghívók: fő iroda vagy iroda hoz létre, hogy valaki csatlakozhasson
-- a céghez ------------------------------------------------------------------
-- 2026-10-01-től ez a mechanizmus elsősorban a create-team-member Edge
-- Function belső "motorja" (lásd supabase/functions/create-team-member) -
-- az a szerver oldali funkció azonnal létrehozza a bejelentkezést, nem
-- kell a meghívottnak linkre kattintania/regisztrálnia. A tábla maga
-- (token, lejárat) változatlan maradt, csak belső, nem felhasználó-
-- szembeni mechanizmus lett.

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  -- A meghívott neve - a create-team-member Edge Function kéri be, és a
  -- handle_new_user() trigger ezt másolja át a profiles.name mezőbe, mert
  -- az azonnal (regisztráció nélkül) létrejövő fiókhoz nincs olyan
  -- lépés, ahol a meghívott saját maga megadhatná.
  name text,
  role text not null check (role in ('raktaros', 'iroda', 'fo_iroda', 'tulajdonos')),
  assigned_location_id uuid references public.locations (id),
  assigned_location_name text,
  -- "on delete set null": lásd az audit_log.created_by melletti
  -- megjegyzést - a felhasználó törlése ne akadjon el amiatt, mert
  -- korábban ő hozott létre meghívót, vagy ő fogadott el egyet.
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid references public.profiles (id) on delete set null
);

create index if not exists invites_company_id_idx on public.invites (company_id);

alter table public.invites enable row level security;

-- A meghívó tokent egy be nem jelentkezett látogató sosem tudja
-- kikeresni/ellenőrizni ezen a táblán keresztül (nincs "mindenki
-- olvashatja" policy) - a regisztráció/a create-team-member funkció a
-- tokent a handle_new_user() SECURITY DEFINER trigger-en keresztül
-- validálja, ami az RLS-t megkerülve fér hozzá.
create policy "Fő iroda és iroda meghívót hozhat létre a saját cégéhez" on public.invites
  for insert with check (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  );
create policy "Fő iroda és iroda látja a saját cége meghívóit" on public.invites
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  );

-- ============================================================================
-- Jóváhagyási (pending_changes) réteg - 'iroda' törzsadat-módosításai
-- (telephely, termék) ide kerülnek, amíg fő iroda jóvá nem hagyja őket.
--
-- Hogyan működik: amikor 'iroda' szerkeszt/létrehoz/töröl egy telephelyet
-- vagy terméket, a kliens (store/useStore.ts requestChange) NEM írja
-- közvetlenül a locations/products táblát (nincs is rá RLS-joga - lásd
-- fentebb), hanem egy sort szúr be ide a tervezett változással (payload).
-- A fő iroda a Jóváhagyások oldalon látja ezeket; jóváhagyáskor a kliens
-- (approvePendingChange) KÉT dolgot tesz EGY MŰVELETSOROZATBAN, mindkettőt
-- a fő iroda saját, közvetlen írási jogával: (1) ténylegesen alkalmazza a
-- payload-ot a valódi locations/products táblán, (2) ezt a sort
-- 'approved'-ra állítja. Elutasításkor csak ez a sor változik
-- 'rejected'-re, a valódi adat érintetlen marad.
-- ============================================================================

create table if not exists public.pending_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  entity_type text not null check (entity_type in ('location', 'product')),
  -- NULL létrehozás (create) esetén - akkor még nincs valódi entity_id.
  entity_id uuid,
  action text not null check (action in ('create', 'update', 'delete', 'restore')),
  -- A tervezett új állapot (create/update esetén a mezők, delete/restore
  -- esetén lehet null - elég az entity_id + action).
  payload jsonb,
  -- Ember-olvasható összefoglaló (pl. "Csavar 4x40mm" termék módosítása) -
  -- a Jóváhagyások oldal ebből épít listát, nem kell újra lekérdeznie a
  -- (esetleg épp törlésre váró) entitást.
  summary text not null,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_by_email text,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_by_email text,
  reviewed_at timestamptz,
  reject_reason text
);

create index if not exists pending_changes_company_id_idx on public.pending_changes (company_id);

alter table public.pending_changes enable row level security;

create policy "Iroda-szintű szerepkörök látják a függő módosításokat" on public.pending_changes
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );
-- Kizárólag 'iroda' adhat be módosítási kérést - a fő iroda közvetlenül ír
-- (nincs szüksége erre a táblára), a tulajdonos és a raktáros soha nem ír
-- semmit, még kérést sem.
create policy "Iroda módosítási kérést adhat be" on public.pending_changes
  for insert with check (
    company_id = public.my_company_id() and public.my_role() = 'iroda' and requested_by = auth.uid()
  );
-- Csak a fő iroda hagyhatja jóvá/utasíthatja el.
create policy "Fő iroda jóváhagyhatja vagy elutasíthatja" on public.pending_changes
  for update using (
    company_id = public.my_company_id() and public.my_role() = 'fo_iroda'
  )
  with check (
    company_id = public.my_company_id() and public.my_role() = 'fo_iroda'
  );

-- --- handle_new_user() ÚJRADEFINIÁLVA: meghívóval csatlakozás VAGY új cég
-- létrehozása + alapértelmezett telephely ------------------------------------
-- Felülírja a fenti (első blokkbeli) egyszerűbb verziót - a trigger maga
-- (on_auth_user_created) változatlan marad, csak a function-testet cseréli
-- le a "create or replace". Ha van "invite_token" a regisztráció
-- metaadatában, a felhasználó a meglévő céghez csatlakozik a meghívóban
-- megadott szerepkörrel/telephellyel, ahelyett hogy új céget hozna létre.
-- Új cég regisztrálásakor emellett automatikusan létrejön egy
-- alapértelmezett telephely is, és a regisztráló mindig 'fo_iroda'
-- szerepkört kap (ő az első, "vállalkozás tulajdonosa" fiók - innentől ő
-- hívhat meg mindenki mást, és ő hagyja jóvá az iroda-szintű módosításokat).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_company_id uuid;
  provided_company_name text;
  invite_token text;
  invite_row public.invites%rowtype;
begin
  invite_token := new.raw_user_meta_data ->> 'invite_token';

  if invite_token is not null then
    select * into invite_row from public.invites
      where token = invite_token and used_at is null and expires_at > now()
      limit 1;

    if invite_row.id is null then
      raise exception 'Érvénytelen vagy lejárt meghívó.';
    end if;

    insert into public.profiles (id, company_id, email, name, role, assigned_location_id, assigned_location_name)
    values (new.id, invite_row.company_id, new.email, invite_row.name, invite_row.role, invite_row.assigned_location_id, invite_row.assigned_location_name);

    update public.invites set used_at = now(), used_by = new.id where id = invite_row.id;
  else
    provided_company_name := coalesce(new.raw_user_meta_data ->> 'company_name', 'Névtelen vállalkozás');

    insert into public.companies (name) values (provided_company_name)
    returning id into new_company_id;

    insert into public.locations (company_id, name) values (new_company_id, 'Fő telephely');

    insert into public.profiles (id, company_id, email, name, role)
    values (new.id, new_company_id, new.email, new.raw_user_meta_data ->> 'name', 'fo_iroda');
  end if;

  return new;
end;
$$;

-- --- Név módosítása - KIZÁRÓLAG fő iroda jogosultság ------------------------
-- Szándékosan NINCS általános UPDATE policy a profiles táblán (lásd fentebb
-- a tábla melletti megjegyzést) - ez a két security definer function az
-- EGYETLEN mód, hogy valaki a name mezőt módosítsa, és mindkettő
-- kikényszeríti, hogy a HÍVÓ fő iroda szerepkörű legyen - ez nem csak UI-
-- kényelem (a gomb elrejtése pages/Settings.tsx-en/pages/Team.tsx-en), a
-- valódi határ itt, a függvényben van: egy iroda/raktáros/tulajdonos
-- szerepkörű felhasználó akkor sem tudná ezt meghívni, ha valahogy
-- megkerülné a felületet.
create or replace function public.update_my_name(new_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'fo_iroda' then
    raise exception 'Csak a fő iroda módosíthatja a nevét.';
  end if;
  update public.profiles set name = nullif(trim(new_name), '') where id = auth.uid();
end;
$$;

-- Fő iroda egy MÁSIK, saját cégéhez tartozó csapattag nevét módosítja (lásd
-- pages/Team.tsx) - pl. ha valaki elgépelte a nevét létrehozáskor, vagy egy
-- a name mező bevezetése előtt létrejött fiókot utólag kell elnevezni.
create or replace function public.update_member_name(member_id uuid, new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  caller_role text;
  caller_company_id uuid;
  target_company_id uuid;
begin
  select role, company_id into caller_role, caller_company_id from public.profiles where id = auth.uid();
  if caller_role is distinct from 'fo_iroda' then
    raise exception 'Csak a fő iroda módosíthatja mások nevét.';
  end if;

  select company_id into target_company_id from public.profiles where id = member_id;
  if target_company_id is null or target_company_id is distinct from caller_company_id then
    raise exception 'Ez a felhasználó nem a saját cégedhez tartozik.';
  end if;

  update public.profiles set name = nullif(trim(new_name), '') where id = member_id;
end;
$$;
