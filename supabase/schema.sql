-- Készletfigyelő - SaaS réteg adatbázis-sémája.
--
-- Futtasd le TELJES EGÉSZÉBEN a Supabase projekted SQL Editorában (Supabase
-- Dashboard > SQL Editor > New query), MIELŐTT beállítod a
-- VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env változókat az appban.
--
-- Ez KIZÁRÓLAG a bejelentkezés/cég/előfizetés réteget hozza létre. A
-- meglévő üzleti adat (termékek, mozgások, pénzügyi napló stb.) egyelőre
-- nem ebben az adatbázisban van - lásd DOCUMENTATION.md "Előfizetéses
-- réteg (SaaS)" fejezetét arról, hogy ez miért egy külön, későbbi lépés.
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
-- lásd src/hooks/useAuth.ts signUp függvényét.

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
