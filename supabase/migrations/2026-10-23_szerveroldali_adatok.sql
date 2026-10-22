-- Készletfigyelő - minden üzleti adat a szerveren (2026-10-23).
--
-- Mit ad hozzá (minden lépés többször is lefuttatható, meglévő adatot nem töröl):
--   1. Az eddig csak a böngészőben tárolt adatok táblái: beszállítók, vevők, pénzügyi napló,
--      ismétlődő napló-tételek, cégbeállítások (+ napló-kategóriák).
--   2. Verziószám minden szinkronizált táblán: ha egy sort közben egy másik eszköz módosított,
--      a régebbi adat nem írhatja felül csendben (hibakód: KF409, „ütközés”).
--   3. keszlet_mentes(): egy felhasználói művelet összes változása EGY tranzakcióban mentődik
--      (vagy minden, vagy semmi), és ugyanaz a mentési köteg kétszer elküldve is csak egyszer hat.
--
-- Meglévő (éles) projektben ezt a fájlt kell lefuttatni a Supabase SQL Editorban; friss projektben a
-- supabase/schema.sql végén ugyanez a blokk szerepel.

-- --- 1. Verziószám és ütközésvédelem ---------------------------------------------------

create or replace function public.verzio_ellenorzes()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    -- Új sornál a kliens null verziót küld; a meglévő sort ismerő kliens a saját verzióját (ez
    -- az ON CONFLICT ágon az UPDATE-triggerben kerül összevetésre).
    if new.version is null then
      new.version := 1;
    end if;
    return new;
  end if;
  if new.version is distinct from old.version then
    raise exception using
      errcode = 'KF409',
      message = 'utkozes',
      detail = format('%s:%s', tg_table_name, old.id),
      hint = 'A sort közben egy másik eszközön módosították.';
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['locations', 'products', 'purchase_lots', 'movements', 'daily_closings', 'pending_changes'] loop
    execute format('alter table public.%I add column if not exists version integer not null default 1', t);
    execute format('drop trigger if exists %I on public.%I', t || '_verzio', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.verzio_ellenorzes()', t || '_verzio', t);
  end loop;
end;
$$;

-- --- 2. Az eddig csak böngészőben tárolt adatok ------------------------------------------

create table if not exists public.suppliers (
  id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  lead_time_days numeric not null default 0,
  tax_number text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);
create index if not exists suppliers_company_id_idx on public.suppliers (company_id);

create table if not exists public.customers (
  id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  notes text,
  tax_number text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);
create index if not exists customers_company_id_idx on public.customers (company_id);

create table if not exists public.ledger_entries (
  id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  date date not null,
  type text not null check (type in ('income', 'expense')),
  category text not null,
  description text not null default '',
  amount numeric not null,
  currency text not null default 'HUF',
  exchange_rate numeric not null default 1,
  note text,
  vat_rate_percent numeric,
  vat_direction text check (vat_direction in ('payable', 'reclaimable')),
  due_date date,
  is_paid boolean,
  paid_date date,
  corrects_entry_id uuid,
  recurring_entry_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);
create index if not exists ledger_entries_company_id_idx on public.ledger_entries (company_id);

create table if not exists public.recurring_ledger_entries (
  id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  category text not null,
  description text not null default '',
  amount numeric not null,
  currency text not null default 'HUF',
  exchange_rate numeric not null default 1,
  note text,
  day_of_month integer not null check (day_of_month between 1 and 31),
  start_date date not null,
  end_date date,
  active boolean not null default true,
  last_generated_month text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);
create index if not exists recurring_ledger_entries_company_id_idx on public.recurring_ledger_entries (company_id);

-- Egy sor cégenként; az id maga a cég azonosítója (így a mentés ugyanúgy id alapján megy, mint
-- minden más táblánál).
create table if not exists public.company_settings (
  id uuid primary key references public.companies (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  settings jsonb not null,
  ledger_categories text[] not null default '{}',
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (id = company_id)
);

do $$
declare
  t text;
begin
  foreach t in array array['suppliers', 'customers', 'ledger_entries', 'recurring_ledger_entries', 'company_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists %I on public.%I', t || '_verzio', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.verzio_ellenorzes()', t || '_verzio', t);
  end loop;
end;
$$;

-- Jogosultságok: az irodai adatot a fő iroda és az iroda írja, a tulajdonos olvassa. A raktáros a
-- vevőket (eladás előkészítésekor választ), a beszállítókat (rendelési figyelmeztetés) és a
-- beállításokat (költségszámítási módszer) olvashatja; a pénzügyi naplót nem látja.
drop policy if exists "Céges felhasználók látják a beszállítókat" on public.suppliers;
create policy "Céges felhasználók látják a beszállítókat" on public.suppliers
  for select using (company_id = public.my_company_id());
drop policy if exists "Fő iroda és iroda beszállítót rögzíthet" on public.suppliers;
create policy "Fő iroda és iroda beszállítót rögzíthet" on public.suppliers
  for insert with check (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'));
drop policy if exists "Fő iroda és iroda beszállítót módosíthat" on public.suppliers;
create policy "Fő iroda és iroda beszállítót módosíthat" on public.suppliers
  for update using (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'))
  with check (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'));

drop policy if exists "Céges felhasználók látják a vevőket" on public.customers;
create policy "Céges felhasználók látják a vevőket" on public.customers
  for select using (company_id = public.my_company_id());
drop policy if exists "Fő iroda és iroda vevőt rögzíthet" on public.customers;
create policy "Fő iroda és iroda vevőt rögzíthet" on public.customers
  for insert with check (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'));
drop policy if exists "Fő iroda és iroda vevőt módosíthat" on public.customers;
create policy "Fő iroda és iroda vevőt módosíthat" on public.customers
  for update using (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'))
  with check (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'));

drop policy if exists "Iroda-szintű szerepkörök látják a pénzügyi naplót" on public.ledger_entries;
create policy "Iroda-szintű szerepkörök látják a pénzügyi naplót" on public.ledger_entries
  for select using (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos'));
drop policy if exists "Fő iroda és iroda naplózhat" on public.ledger_entries;
create policy "Fő iroda és iroda naplózhat" on public.ledger_entries
  for insert with check (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'));
drop policy if exists "Fő iroda és iroda naplót módosíthat" on public.ledger_entries;
create policy "Fő iroda és iroda naplót módosíthat" on public.ledger_entries
  for update using (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'))
  with check (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'));

drop policy if exists "Iroda-szintű szerepkörök látják az ismétlődő tételeket" on public.recurring_ledger_entries;
create policy "Iroda-szintű szerepkörök látják az ismétlődő tételeket" on public.recurring_ledger_entries
  for select using (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos'));
drop policy if exists "Fő iroda és iroda ismétlődő tételt rögzíthet" on public.recurring_ledger_entries;
create policy "Fő iroda és iroda ismétlődő tételt rögzíthet" on public.recurring_ledger_entries
  for insert with check (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'));
drop policy if exists "Fő iroda és iroda ismétlődő tételt módosíthat" on public.recurring_ledger_entries;
create policy "Fő iroda és iroda ismétlődő tételt módosíthat" on public.recurring_ledger_entries
  for update using (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'))
  with check (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'));

drop policy if exists "Céges felhasználók látják a beállításokat" on public.company_settings;
create policy "Céges felhasználók látják a beállításokat" on public.company_settings
  for select using (company_id = public.my_company_id());
drop policy if exists "Fő iroda és iroda beállítást rögzíthet" on public.company_settings;
create policy "Fő iroda és iroda beállítást rögzíthet" on public.company_settings
  for insert with check (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'));
drop policy if exists "Fő iroda és iroda beállítást módosíthat" on public.company_settings;
create policy "Fő iroda és iroda beállítást módosíthat" on public.company_settings
  for update using (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'))
  with check (company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda'));

-- --- 2b. Napi zárás: a raktáros utólagos mozgása ------------------------------------
-- Ha a raktáros olyan napra rögzít mozgást, amelyre már elküldte a napi zárást, a zárás „utólag
-- módosítva” jelzést kap. Mivel a mentés atomi, enélkül a raktáros mozgása is elutasításra kerülne.
-- A raktáros a zárásnak KIZÁRÓLAG ezt a jelzését állíthatja; a jóváhagyás és minden más mező
-- adatbázis-szinten tiltott marad (lásd napi_zaras_raktaros_vedelem).
drop policy if exists "Raktáros jelölheti a saját zárásának utólagos módosítását" on public.daily_closings;
create policy "Raktáros jelölheti a saját zárásának utólagos módosítását" on public.daily_closings
  for update using (location_id = public.my_assigned_location_id() and public.my_role() = 'raktaros')
  with check (location_id = public.my_assigned_location_id() and public.my_role() = 'raktaros');

create or replace function public.napi_zaras_raktaros_vedelem()
returns trigger language plpgsql as $$
begin
  if public.my_role() = 'raktaros' and (
    (to_jsonb(new) - 'modified_after_submission' - 'last_modified_at' - 'version')
    is distinct from
    (to_jsonb(old) - 'modified_after_submission' - 'last_modified_at' - 'version')
  ) then
    raise exception using
      errcode = '42501',
      message = 'A raktáros a napi zárásnak csak az utólagos módosítás jelzését állíthatja.';
  end if;
  return new;
end;
$$;

drop trigger if exists daily_closings_raktaros_vedelem on public.daily_closings;
create trigger daily_closings_raktaros_vedelem
  before update on public.daily_closings
  for each row execute function public.napi_zaras_raktaros_vedelem();

-- --- 2c. Termékek: készletváltozás az iroda és a raktáros mozgásaiból -----------------
-- Az iroda közvetlenül rögzíthet mozgást (DOCUMENTATION.md 4 szerepkör), ami a termék készletét és
-- beszerzési árát módosítja; a termék-UPDATE jog eddig csak a fő irodáé volt, így az iroda mozgásainál
-- a készlet a szerveren csendben NEM frissült. Mostantól az iroda (a cég bármely termékén) és a
-- raktáros (a saját telephelyén) módosíthatja a terméket, de KIZÁRÓLAG a készlethez tartozó mezőket;
-- a törzsadat (név, eladási ár, telephely …) továbbra is csak a fő irodáé (az iroda kérése jóváhagyással).
drop policy if exists "Iroda a termékek készletét frissítheti" on public.products;
create policy "Iroda a termékek készletét frissítheti" on public.products
  for update using (company_id = public.my_company_id() and public.my_role() = 'iroda')
  with check (company_id = public.my_company_id() and public.my_role() = 'iroda');

create or replace function public.termek_keszletmezo_vedelem()
returns trigger language plpgsql as $$
begin
  if public.my_role() in ('iroda', 'raktaros') and (
    (to_jsonb(new) - 'current_stock' - 'purchase_price' - 'updated_at' - 'version')
    is distinct from
    (to_jsonb(old) - 'current_stock' - 'purchase_price' - 'updated_at' - 'version')
  ) then
    raise exception using
      errcode = '42501',
      message = 'A termék törzsadatát csak a fő iroda módosíthatja; az iroda és a raktáros csak a készletet.';
  end if;
  return new;
end;
$$;

drop trigger if exists products_keszletmezo_vedelem on public.products;
create trigger products_keszletmezo_vedelem
  before update on public.products
  for each row execute function public.termek_keszletmezo_vedelem();

-- --- 3. Atomi, egyszer ható mentés ------------------------------------------------------

-- A már feldolgozott mentési kötegek: ugyanaz a köteg (pl. elveszett válasz utáni újraküldés)
-- másodszor nem hat, csak az első eredményét kapja vissza.
create table if not exists public.mentesi_kotegek (
  id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  letrehozva timestamptz not null default now(),
  letrehozta uuid references public.profiles (id) on delete set null default auth.uid(),
  eredmeny jsonb not null
);
create index if not exists mentesi_kotegek_company_id_idx on public.mentesi_kotegek (company_id, letrehozva);
alter table public.mentesi_kotegek enable row level security;
drop policy if exists "Saját cég mentési kötegei" on public.mentesi_kotegek;
create policy "Saját cég mentési kötegei" on public.mentesi_kotegek
  for select using (company_id = public.my_company_id());
drop policy if exists "Saját cég mentési köteget rögzíthet" on public.mentesi_kotegek;
create policy "Saját cég mentési köteget rögzíthet" on public.mentesi_kotegek
  for insert with check (company_id = public.my_company_id());

-- Egy mentési köteg: [{ "tabla": "...", "sor": { ...oszlop: érték... } }, ...]. A hívó jogaival fut
-- (security invoker), tehát minden sorra ugyanazok az RLS-szabályok érvényesek, mint eddig. Csak a
-- sorban megadott oszlopokat írja, a többi az alapértelmezést kapja (pl. audit_log.created_by).
create or replace function public.keszlet_mentes(p_koteg_id uuid, p_valtozasok jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ceg uuid := public.my_company_id();
  v_meglevo jsonb;
  v_eredmeny jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_tabla text;
  v_sor jsonb;
  v_oszlopok text;
  v_frissites text;
  v_id uuid;
  v_verzio integer;
  v_letezik boolean;
begin
  if v_ceg is null then
    raise exception using errcode = '42501', message = 'Nincs bejelentkezett céges felhasználó.';
  end if;

  select eredmeny into v_meglevo from public.mentesi_kotegek where id = p_koteg_id;
  if found then
    return v_meglevo;
  end if;

  for v_elem in select value from jsonb_array_elements(p_valtozasok) loop
    v_tabla := v_elem ->> 'tabla';
    v_sor := v_elem -> 'sor';
    if v_tabla is null or v_tabla not in (
      'locations', 'products', 'purchase_lots', 'movements', 'daily_closings', 'audit_log', 'pending_changes',
      'suppliers', 'customers', 'ledger_entries', 'recurring_ledger_entries', 'company_settings'
    ) then
      raise exception using errcode = '22023', message = format('Ismeretlen tábla a mentésben: %s', coalesce(v_tabla, '(üres)'));
    end if;
    if (v_sor ->> 'company_id') is distinct from v_ceg::text then
      raise exception using errcode = '42501', message = 'A mentés másik cég adatát tartalmazza.';
    end if;

    select string_agg(format('%I', k), ', '), string_agg(format('%I', k), ', ') filter (where k <> 'id')
      into v_oszlopok, v_frissites
      from jsonb_object_keys(v_sor) as k
      where exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = v_tabla and c.column_name = k
      );

    if v_tabla = 'audit_log' then
      -- Az audit napló csak bővíthető: egy már meglévő bejegyzés sosem íródik felül. Nem „on
      -- conflict do nothing”, mert az olvasási jogot is kérne, a raktáros pedig nem olvashatja a naplót.
      begin
        execute format(
          'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
          v_tabla, v_oszlopok, v_oszlopok, v_tabla
        ) using v_sor;
      exception when unique_violation then
        null;
      end;
      continue;
    end if;

    -- Előbb módosítás (ha a sor létezik és a hívó látja), különben beszúrás. Nem „insert … on
    -- conflict do update”, mert az a módosításnál is a beszúrási jogot kérné, a raktárosnak pedig
    -- a termékekre csak módosítási joga van.
    execute format('select exists (select 1 from public.%I where id = ($1 ->> ''id'')::uuid)', v_tabla) using v_sor into v_letezik;
    if v_letezik then
      execute format(
        'update public.%I as t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where t.id = ($1 ->> ''id'')::uuid returning t.id, t.version',
        v_tabla, v_frissites, v_frissites, v_tabla
      ) using v_sor into v_id, v_verzio;
      if v_id is null then
        raise exception using errcode = '42501', message = format('Nincs jogosultság a módosításhoz (%s).', v_tabla);
      end if;
    else
      execute format(
        'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id, version',
        v_tabla, v_oszlopok, v_oszlopok, v_tabla
      ) using v_sor into v_id, v_verzio;
    end if;
    v_eredmeny := v_eredmeny || jsonb_build_array(jsonb_build_object('tabla', v_tabla, 'id', v_id, 'version', v_verzio));
  end loop;

  insert into public.mentesi_kotegek (id, company_id, eredmeny) values (p_koteg_id, v_ceg, v_eredmeny);
  return v_eredmeny;
end;
$$;

grant execute on function public.keszlet_mentes(uuid, jsonb) to authenticated;
