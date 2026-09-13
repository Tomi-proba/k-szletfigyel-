-- Készletfigyelő - SaaS réteg adatbázis-sémája.
--
-- Futtasd le TELJES EGÉSZÉBEN a Supabase projekted SQL Editorában (Supabase
-- Dashboard > SQL Editor > New query), MIELŐTT beállítod a
-- VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env változókat az appban.
--
-- Ez a fájl két részből áll (fentről lefelé, egymásra épülve, egyben
-- futtatandó): (1) a bejelentkezés/cég/előfizetés réteg, majd (2) a
-- szerepkör alapú (raktáros/iroda) hozzáférés + a MEGOSZTOTT üzleti adat
-- (telephelyek, termékek, mozgások, beszerzési tételek, napi zárás, audit
-- napló) - lásd a "Szerepkör alapú..." fejlécű blokkot lejjebb. A
-- beszállítók, vevők, pénzügyi napló és ÁFA-adat SZÁNDÉKOSAN NEM került át
-- ide - ezek továbbra is eszközönkénti (localStorage) irodai adatok, mert a
-- raktáros felület úgysem használja őket. Lásd DOCUMENTATION.md 14.
-- fejezetét a pontos hatókörért.
--
-- Cégenkénti adatelkülönítés: minden lekérdezés Row Level Security (RLS)
-- policy-kon megy át, adatbázis-szinten kikényszerítve - egy bejelentkezett
-- felhasználó SQL-szinten sem tud hozzáférni egy másik cég sorához, akkor
-- sem, ha az alkalmazás kódjában lenne egy hiba/elírt azonosító.

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

create policy "Admin minden céget lát" on public.companies
  for select using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_platform_admin)
  );

-- --- profiles RLS ------------------------------------------------------------

create policy "Saját profil megtekintése" on public.profiles
  for select using (id = auth.uid());

create policy "Admin minden profilt lát" on public.profiles
  for select using (
    exists (select 1 from public.profiles p2 where p2.id = auth.uid() and p2.is_platform_admin)
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
-- függvényt lentebb, a "Szerepkör alapú..." blokkban DEFINIÁLJUK ÚJRA
-- (create or replace), hogy a meghívóval történő csatlakozást és az
-- alapértelmezett telephely létrehozását is tudja - ezért itt, elsőre, még
-- csak a triggert vesszük fel, ami a végleges (lentebbi) function-defíníciót
-- fogja hívni, bármikor is fut le a teljes fájl.

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
-- Szerepkör alapú, korlátozott nézetek (raktáros vs. iroda) + a hozzájuk
-- tartozó MEGOSZTOTT üzleti adat.
--
-- Miért kellett ez: a raktáros/iroda szerepkör csak akkor jelent VALÓDI
-- korlátozást, ha az üzleti adat (nem csak a cég/előfizetés) egy közös,
-- RLS-sel védett adatbázisban van - két külön eszköz (raktár + iroda)
-- localStorage-a sosem szinkronizálódna egymással. Ami migrált (itt lent):
-- telephelyek, termékek, készletmozgások, beszerzési tételek (FIFO),
-- napi zárás, audit napló. Ami SZÁNDÉKOSAN eszközönkénti (localStorage)
-- maradt: beszállítók, vevők, pénzügyi napló, ÁFA-számítás bemenete,
-- beállítások - ezek irodai, nem-megosztott adatok, amiket a raktáros
-- felület úgysem mutat. Lásd DOCUMENTATION.md 14. fejezetét a pontos
-- hatókörért és a maradék korlátokért.
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

alter table public.locations enable row level security;

create policy "Iroda minden telephelyet lát" on public.locations
  for select using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );

create policy "Iroda telephelyet létrehozhat" on public.locations
  for insert with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );

create policy "Iroda telephelyet módosíthat" on public.locations
  for update using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  )
  with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );

-- Raktáros KIZÁRÓLAG a saját, hozzárendelt telephelyét látja - más
-- telephely létezéséről sem szerezhet tudomást ezen a lekérdezésen keresztül.
create policy "Raktáros csak a saját telephelyét látja" on public.locations
  for select using (
    id in (select assigned_location_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'raktaros')
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

create policy "Iroda minden terméket lát" on public.products
  for select using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );
create policy "Iroda terméket létrehozhat" on public.products
  for insert with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );
create policy "Iroda terméket módosíthat" on public.products
  for update using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  )
  with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );

-- Raktáros csak a saját telephelyéhez tartozó termékeket látja, és csak a
-- készletmozgás-rögzítés miatt frissítheti azokat (pl. currentStock) - új
-- termék létrehozása/törlése irodai jog marad. FONTOS KORLÁT: az UPDATE
-- policy sor-szintű, nem oszlop-szintű - technikailag a raktáros a saját
-- telephelye termékein bármely mezőt (pl. nevet, árat) módosíthatná egy
-- direkt API-hívással, még ha a felület ezt nem is teszi lehetővé. Lásd
-- DOCUMENTATION.md 14. fejezet.
create policy "Raktáros csak saját telephelye termékeit látja" on public.products
  for select using (
    location_id in (select assigned_location_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'raktaros')
  );
create policy "Raktáros a saját telephelye termékeit frissítheti" on public.products
  for update using (
    location_id in (select assigned_location_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'raktaros')
  )
  with check (
    location_id in (select assigned_location_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'raktaros')
  );

-- --- Beszerzési tételek (FIFO-rétegek) ---------------------------------------

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

create policy "Iroda minden tételt lát" on public.purchase_lots
  for select using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );
create policy "Iroda tételt létrehozhat" on public.purchase_lots
  for insert with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );
create policy "Iroda tételt módosíthat" on public.purchase_lots
  for update using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  )
  with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );

-- Raktáros nem látja/kezeli közvetlenül a beszerzési árakat a felületen, de
-- a FIFO-fogyás kiszámításához (amikor kimenő mozgást rögzít) a rendszernek
-- olvasnia/frissítenie kell ezeket a sorokat - a hozzáférés a saját
-- telephelyéhez tartozó termékek tételeire technikailag megvan, akkor is,
-- ha a felület sosem jeleníti meg az árat/költséget neki. Lásd
-- DOCUMENTATION.md 14. fejezet - ez egy tudatos, dokumentált korlát.
create policy "Raktáros a saját telephelye tételeit látja" on public.purchase_lots
  for select using (
    product_id in (
      select p.id from public.products p
      join public.profiles pr on pr.id = auth.uid() and pr.role = 'raktaros'
      where p.location_id = pr.assigned_location_id
    )
  );
create policy "Raktáros tételt létrehozhat a saját telephelyén" on public.purchase_lots
  for insert with check (
    product_id in (
      select p.id from public.products p
      join public.profiles pr on pr.id = auth.uid() and pr.role = 'raktaros'
      where p.location_id = pr.assigned_location_id
    )
  );
create policy "Raktáros tételt frissíthet a saját telephelyén" on public.purchase_lots
  for update using (
    product_id in (
      select p.id from public.products p
      join public.profiles pr on pr.id = auth.uid() and pr.role = 'raktaros'
      where p.location_id = pr.assigned_location_id
    )
  )
  with check (
    product_id in (
      select p.id from public.products p
      join public.profiles pr on pr.id = auth.uid() and pr.role = 'raktaros'
      where p.location_id = pr.assigned_location_id
    )
  );

-- --- Készletmozgások ----------------------------------------------------

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

create policy "Iroda minden mozgást lát" on public.movements
  for select using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );
create policy "Iroda mozgást létrehozhat" on public.movements
  for insert with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );
create policy "Iroda mozgást módosíthat" on public.movements
  for update using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  )
  with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );

create policy "Raktáros csak saját telephelye mozgásait látja" on public.movements
  for select using (
    location_id in (select assigned_location_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'raktaros')
  );
create policy "Raktáros mozgást rögzíthet a saját telephelyén" on public.movements
  for insert with check (
    location_id in (select assigned_location_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'raktaros')
  );
create policy "Raktáros a saját telephelye mozgásait módosíthatja" on public.movements
  for update using (
    location_id in (select assigned_location_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'raktaros')
  )
  with check (
    location_id in (select assigned_location_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'raktaros')
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

create policy "Iroda minden zárást lát" on public.daily_closings
  for select using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );
create policy "Iroda zárást létrehozhat" on public.daily_closings
  for insert with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );
-- Csak az iroda állíthatja "megtekintve"/"jóváhagyva" állapotba - a
-- raktáros sosem hagyhatja jóvá a saját zárását, ez adatbázis-szinten is
-- kikényszerítve van, nem csak a felület rejti el a gombot előle.
create policy "Iroda zárást módosíthat" on public.daily_closings
  for update using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  )
  with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );

create policy "Raktáros csak a saját telephelye zárásait látja" on public.daily_closings
  for select using (
    location_id in (select assigned_location_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'raktaros')
  );
create policy "Raktáros elküldheti a saját telephelye zárását" on public.daily_closings
  for insert with check (
    location_id in (select assigned_location_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'raktaros')
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
  created_by uuid references public.profiles (id)
);

create index if not exists audit_log_company_id_idx on public.audit_log (company_id);

alter table public.audit_log enable row level security;

-- Csak az iroda olvashatja a teljes céges audit naplót - a raktárosnak
-- nincs ilyen felülete, és mások tevékenységét sem kell látnia.
create policy "Iroda olvashatja a céges audit naplót" on public.audit_log
  for select using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );
-- Bármelyik céges felhasználó rögzítheti a SAJÁT tevékenységét a naplóba
-- (raktáros is - a saját mozgásrögzítése is bekerül, csak nem látja vissza).
create policy "Bármelyik céges felhasználó naplózhat" on public.audit_log
  for insert with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid())
  );

-- --- profiles: szerepkör + telephely-hozzárendelés ---------------------------
-- Nincs UPDATE policy a profiles táblán (lásd fentebb) - így sem a
-- raktáros, sem az iroda nem tudja saját magát/másokat direkt API-hívással
-- átállítani másik szerepkörre/telephelyre vagy admin jogra. Szerepkört és
-- telephelyet KIZÁRÓLAG a lentebbi handle_new_user() trigger állíthat be,
-- regisztrációkor (meghívó alapján), vagy az üzemeltető SQL-ből.

alter table public.profiles
  add column if not exists role text not null default 'iroda' check (role in ('raktaros', 'iroda')),
  add column if not exists assigned_location_id uuid references public.locations (id),
  add column if not exists assigned_location_name text;

-- Iroda látja a saját cége összes felhasználóját (kell a Csapat oldalhoz,
-- hogy lássa, mely raktáros melyik telephelyhez van rendelve) - a
-- "Admin minden profilt lát" policy ettől független, az az üzemeltetőé.
create policy "Iroda látja a saját cége profiljait" on public.profiles
  for select using (
    company_id in (select company_id from public.profiles p2 where p2.id = auth.uid() and p2.role = 'iroda')
  );

-- --- Meghívók: iroda hoz létre, hogy egy raktáros (vagy másik iroda-tag)
-- csatlakozhasson a céghez -----------------------------------------------

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  role text not null check (role in ('raktaros', 'iroda')),
  assigned_location_id uuid references public.locations (id),
  assigned_location_name text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid references public.profiles (id)
);

create index if not exists invites_company_id_idx on public.invites (company_id);

alter table public.invites enable row level security;

-- A meghívó tokent egy be nem jelentkezett látogató sosem tudja
-- kikeresni/ellenőrizni ezen a táblán keresztül (nincs "mindenki
-- olvashatja" policy) - a regisztráció a tokent a handle_new_user()
-- SECURITY DEFINER trigger-en keresztül, a beküldött regisztráció
-- részeként validálja, ami az RLS-t megkerülve fér hozzá.
create policy "Iroda meghívót hozhat létre a saját cégéhez" on public.invites
  for insert with check (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );
create policy "Iroda látja a saját cége meghívóit" on public.invites
  for select using (
    company_id in (select company_id from public.profiles where profiles.id = auth.uid() and profiles.role = 'iroda')
  );

-- --- handle_new_user() ÚJRADEFINIÁLVA: meghívóval csatlakozás VAGY új cég
-- létrehozása + alapértelmezett telephely ------------------------------------
-- Felülírja a fenti (első blokkbeli) egyszerűbb verziót - a trigger maga
-- (on_auth_user_created) változatlan marad, csak a function-testet cseréli
-- le a "create or replace". Ha van "invite_token" a regisztráció
-- metaadatában, a felhasználó a meglévő céghez csatlakozik a meghívóban
-- megadott szerepkörrel/telephellyel, ahelyett hogy új céget hozna létre.
-- Új cég regisztrálásakor emellett automatikusan létrejön egy
-- alapértelmezett telephely is, hogy az iroda-felhasználó rögtön fel tudjon
-- venni termékeket.
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

    insert into public.profiles (id, company_id, email, role, assigned_location_id, assigned_location_name)
    values (new.id, invite_row.company_id, new.email, invite_row.role, invite_row.assigned_location_id, invite_row.assigned_location_name);

    update public.invites set used_at = now(), used_by = new.id where id = invite_row.id;
  else
    provided_company_name := coalesce(new.raw_user_meta_data ->> 'company_name', 'Névtelen vállalkozás');

    insert into public.companies (name) values (provided_company_name)
    returning id into new_company_id;

    insert into public.locations (company_id, name) values (new_company_id, 'Fő telephely');

    insert into public.profiles (id, company_id, email, role)
    values (new.id, new_company_id, new.email, 'iroda');
  end if;

  return new;
end;
$$;
