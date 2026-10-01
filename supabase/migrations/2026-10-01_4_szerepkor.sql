-- ============================================================================
-- Készletfigyelő - migráció a fő iroda / iroda / tulajdonos / raktáros
-- 4-szerepkörös rendszerre (2026-10-01, v2 - javított sorrenddel) - EGY MÁR
-- ÉLŐ, 2-szerepkörös adatbázison futtatandó. Nem töröl üzleti adatot.
-- ============================================================================

-- --- 1) pending_changes tábla létrehozása (ELSŐKÉNT, hogy a lejjebbi
-- policy-törlések már létező táblára hivatkozzanak) ------------------------
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


-- --- 2) RÉGI (2026-10-01 ELŐTTI) POLICY-NEVEK TÖRLÉSE -----------------------
drop policy if exists "Iroda látja a saját cége profiljait" on public.profiles;
drop policy if exists "Iroda minden telephelyet lát" on public.locations;
drop policy if exists "Iroda telephelyet létrehozhat" on public.locations;
drop policy if exists "Iroda telephelyet módosíthat" on public.locations;
drop policy if exists "Iroda minden terméket lát" on public.products;
drop policy if exists "Iroda terméket létrehozhat" on public.products;
drop policy if exists "Iroda terméket módosíthat" on public.products;
drop policy if exists "Iroda minden tételt lát" on public.purchase_lots;
drop policy if exists "Iroda tételt létrehozhat" on public.purchase_lots;
drop policy if exists "Iroda tételt módosíthat" on public.purchase_lots;
drop policy if exists "Iroda minden mozgást lát" on public.movements;
drop policy if exists "Iroda mozgást létrehozhat" on public.movements;
drop policy if exists "Iroda mozgást módosíthat" on public.movements;
drop policy if exists "Iroda minden zárást lát" on public.daily_closings;
drop policy if exists "Iroda zárást létrehozhat" on public.daily_closings;
drop policy if exists "Iroda zárást módosíthat" on public.daily_closings;
drop policy if exists "Iroda olvashatja a céges audit naplót" on public.audit_log;
drop policy if exists "Iroda meghívót hozhat létre a saját cégéhez" on public.invites;
drop policy if exists "Iroda látja a saját cége meghívóit" on public.invites;


-- --- 3) ÚJ (ebben a migrációban létrehozandó) POLICY-NEVEK TÖRLÉSE --------
-- (idempotens - ha ezt a migrációt véletlenül kétszer futtatod, ne hibázzon)
drop policy if exists "Saját cég megtekintése" on public.companies;
drop policy if exists "Saját cég módosítása" on public.companies;
drop policy if exists "Admin minden céget lát" on public.companies;
drop policy if exists "Saját profil megtekintése" on public.profiles;
drop policy if exists "Admin minden profilt lát" on public.profiles;
drop policy if exists "Iroda-szintű szerepkörök minden telephelyet látnak" on public.locations;
drop policy if exists "Fő iroda telephelyet létrehozhat" on public.locations;
drop policy if exists "Fő iroda telephelyet módosíthat" on public.locations;
drop policy if exists "Raktáros csak a saját telephelyét látja" on public.locations;
drop policy if exists "Iroda-szintű szerepkörök minden terméket látnak" on public.products;
drop policy if exists "Fő iroda terméket létrehozhat" on public.products;
drop policy if exists "Fő iroda terméket módosíthat" on public.products;
drop policy if exists "Raktáros csak saját telephelye termékeit látja" on public.products;
drop policy if exists "Raktáros a saját telephelye termékeit frissítheti" on public.products;
drop policy if exists "Iroda-szintű szerepkörök minden tételt látnak" on public.purchase_lots;
drop policy if exists "Fő iroda és iroda tételt létrehozhat" on public.purchase_lots;
drop policy if exists "Fő iroda és iroda tételt módosíthat" on public.purchase_lots;
drop policy if exists "Raktáros a saját telephelye tételeit látja" on public.purchase_lots;
drop policy if exists "Raktáros tételt létrehozhat a saját telephelyén" on public.purchase_lots;
drop policy if exists "Raktáros tételt frissíthet a saját telephelyén" on public.purchase_lots;
drop policy if exists "Iroda-szintű szerepkörök minden mozgást látnak" on public.movements;
drop policy if exists "Fő iroda és iroda mozgást létrehozhat" on public.movements;
drop policy if exists "Fő iroda és iroda mozgást módosíthat" on public.movements;
drop policy if exists "Raktáros csak saját telephelye mozgásait látja" on public.movements;
drop policy if exists "Raktáros mozgást rögzíthet a saját telephelyén" on public.movements;
drop policy if exists "Raktáros a saját telephelye mozgásait módosíthatja" on public.movements;
drop policy if exists "Iroda-szintű szerepkörök minden zárást látnak" on public.daily_closings;
drop policy if exists "Fő iroda és iroda zárást létrehozhat" on public.daily_closings;
drop policy if exists "Fő iroda és iroda zárást módosíthat" on public.daily_closings;
drop policy if exists "Raktáros csak a saját telephelye zárásait látja" on public.daily_closings;
drop policy if exists "Raktáros elküldheti a saját telephelye zárását" on public.daily_closings;
drop policy if exists "Iroda-szintű szerepkörök olvashatják a céges audit naplót" on public.audit_log;
drop policy if exists "Bármelyik céges felhasználó naplózhat" on public.audit_log;
drop policy if exists "Iroda-szintű szerepkörök látják a cég profiljait" on public.profiles;
drop policy if exists "Fő iroda és iroda meghívót hozhat létre a saját cégéhez" on public.invites;
drop policy if exists "Fő iroda és iroda látja a saját cége meghívóit" on public.invites;
drop policy if exists "Iroda-szintű szerepkörök látják a függő módosításokat" on public.pending_changes;
drop policy if exists "Iroda módosítási kérést adhat be" on public.pending_changes;
drop policy if exists "Fő iroda jóváhagyhatja vagy elutasíthatja" on public.pending_changes;


-- --- 4) Szerepkör check constraint bővítése 4 szerepkörre -------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('raktaros', 'iroda', 'fo_iroda', 'tulajdonos'));

alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites add constraint invites_role_check
  check (role in ('raktaros', 'iroda', 'fo_iroda', 'tulajdonos'));


-- --- 5) SECURITY DEFINER segédfüggvények -----------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

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



-- --- 6) Jogosultsági szabályok (policy-k) újra-létrehozása ----------------
create policy "Saját cég megtekintése" on public.companies
  for select using (
    id in (select company_id from public.profiles where profiles.id = auth.uid())
  );

create policy "Saját cég módosítása" on public.companies
  for update using (
    id in (select company_id from public.profiles where profiles.id = auth.uid())
  );

create policy "Admin minden céget lát" on public.companies
  for select using (
    public.is_platform_admin()
  );

create policy "Saját profil megtekintése" on public.profiles
  for select using (id = auth.uid());

create policy "Admin minden profilt lát" on public.profiles
  for select using (
    public.is_platform_admin()
  );

create policy "Iroda-szintű szerepkörök minden telephelyet látnak" on public.locations
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );

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

create policy "Raktáros csak a saját telephelyét látja" on public.locations
  for select using (
    id = public.my_assigned_location_id() and public.my_role() = 'raktaros'
  );

create policy "Iroda-szintű szerepkörök minden terméket látnak" on public.products
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );

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

create policy "Iroda-szintű szerepkörök minden zárást látnak" on public.daily_closings
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );

create policy "Fő iroda és iroda zárást létrehozhat" on public.daily_closings
  for insert with check (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  );

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

create policy "Iroda-szintű szerepkörök olvashatják a céges audit naplót" on public.audit_log
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );

create policy "Bármelyik céges felhasználó naplózhat" on public.audit_log
  for insert with check (
    company_id = public.my_company_id()
  );

create policy "Iroda-szintű szerepkörök látják a cég profiljait" on public.profiles
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );

create policy "Fő iroda és iroda meghívót hozhat létre a saját cégéhez" on public.invites
  for insert with check (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  );

create policy "Fő iroda és iroda látja a saját cége meghívóit" on public.invites
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda')
  );

create policy "Iroda-szintű szerepkörök látják a függő módosításokat" on public.pending_changes
  for select using (
    company_id = public.my_company_id() and public.my_role() in ('fo_iroda', 'iroda', 'tulajdonos')
  );

create policy "Iroda módosítási kérést adhat be" on public.pending_changes
  for insert with check (
    company_id = public.my_company_id() and public.my_role() = 'iroda' and requested_by = auth.uid()
  );

create policy "Fő iroda jóváhagyhatja vagy elutasíthatja" on public.pending_changes
  for update using (
    company_id = public.my_company_id() and public.my_role() = 'fo_iroda'
  )
  with check (
    company_id = public.my_company_id() and public.my_role() = 'fo_iroda'
  );



-- --- 7) handle_new_user() újradefiniálása (regisztráló = fő iroda) --------
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
    values (new.id, new_company_id, new.email, 'fo_iroda');
  end if;

  return new;
end;
$$;

