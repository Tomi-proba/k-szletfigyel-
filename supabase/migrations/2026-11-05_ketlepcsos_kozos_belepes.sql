-- Kétlépcsős azonosítás és közös belépés (AWEBOLDAL TERV.md F21) – ELŐKÉSZÍTVE, élesben még NEM futtatva.
-- Futtatás és bekapcsolás sorrendje: AWEBOLDAL ELESITES.md „Közös belépés” fejezet. Csak az üzemeltető
-- jóváhagyásával.
--
-- A fájl lefuttatása önmagában SEMMIT nem szigorít: a kétlépcsős adatbázis-szabály kikapcsolva jön létre.
-- Bekapcsolni a public.ketlepcsos_kotelezove_tetel() függvénnyel lehet (csak az SQL-szerkesztőből, a
-- böngészőből nem), és az MEGTAGADJA a bekapcsolást, amíg van olyan felhasználó, akinek nincs ellenőrzött
-- kétlépcsős tényezője – így senki nem zárhatja ki magát. Addig a program a belépéskor kéri a kódot, és
-- végigvezet a beállításon; a Csapat oldal átállási listája mutatja, ki nem állította még be.

-- ---------- 1. Kapcsoló ----------

create table if not exists public.biztonsagi_beallitas (
  id boolean primary key default true check (id),
  ketlepcsos_kotelezo boolean not null default false,
  bekapcsolva_ekkor timestamptz
);
insert into public.biztonsagi_beallitas (id) values (true) on conflict (id) do nothing;
-- Nincs policy: a böngészőből nem olvasható és nem írható; csak a security definer függvények érik el.
alter table public.biztonsagi_beallitas enable row level security;
revoke all on public.biztonsagi_beallitas from anon, authenticated;

-- Igaz, ha a kérés megfelel a kétlépcsős szabálynak: a szabály ki van kapcsolva, vagy a munkamenet aal2.
create or replace function public.ketlepcsos_rendben()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce((select ketlepcsos_kotelezo from public.biztonsagi_beallitas where id), false)
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- ---------- 2. A jogosultsági segédfüggvények a szabályt is figyelik ----------
-- Minden cégadat-policy ezeken át dönt (company_id = my_company_id() stb.): bekapcsolt szabálynál
-- kétlépcsős azonosítás nélkül null, vagyis semmilyen cégadat nem érhető el.

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and public.ketlepcsos_rendben();
$$;

create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid() and public.ketlepcsos_rendben();
$$;

create or replace function public.my_assigned_location_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select assigned_location_id from public.profiles where id = auth.uid() and public.ketlepcsos_rendben();
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false) and public.ketlepcsos_rendben();
$$;

-- A cég sorát eddig közvetlenül a profiles alapján engedték: mostantól ugyanazon a segédfüggvényen át.
drop policy if exists "Saját cég megtekintése" on public.companies;
create policy "Saját cég megtekintése" on public.companies
  for select using (id = public.my_company_id());
drop policy if exists "Saját cég módosítása" on public.companies;
create policy "Saját cég módosítása" on public.companies
  for update using (id = public.my_company_id());

-- ---------- 3. Átállási lista (Csapat oldal) ----------
-- A fő iroda és a tulajdonos látja a saját cége tagjait, és hogy kinek van ellenőrzött kétlépcsős tényezője.

create or replace function public.ketlepcsos_allapot()
returns table (id uuid, name text, email text, role text, ketlepcsos boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.email, p.role,
         exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')
  from public.profiles p
  where p.company_id = public.my_company_id()
    and public.my_role() in ('fo_iroda', 'tulajdonos')
  order by coalesce(p.name, p.email);
$$;
revoke all on function public.ketlepcsos_allapot() from public, anon;
grant execute on function public.ketlepcsos_allapot() to authenticated;

-- ---------- 4. Bekapcsolás és kikapcsolás (csak az SQL-szerkesztőből) ----------

-- Hány felhasználónak nincs még ellenőrzött kétlépcsős tényezője (az egész projektben).
create or replace function public.ketlepcsos_hianyzik()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.profiles p
  where not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified');
$$;

create or replace function public.ketlepcsos_kotelezove_tetel()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  hianyzik integer := public.ketlepcsos_hianyzik();
begin
  if hianyzik > 0 then
    raise exception 'A kétlépcsős szabály nem kapcsolható be: % felhasználónak még nincs beállítva (lásd a Csapat oldal átállási listáját).', hianyzik
      using errcode = 'KF2FA';
  end if;
  update public.biztonsagi_beallitas set ketlepcsos_kotelezo = true, bekapcsolva_ekkor = now() where id;
  return 'A kétlépcsős szabály bekapcsolva: kétlépcsős azonosítás nélkül semmilyen cégadat nem érhető el.';
end;
$$;

create or replace function public.ketlepcsos_kikapcsolasa()
returns text
language sql
security definer
set search_path = public
as $$
  update public.biztonsagi_beallitas set ketlepcsos_kotelezo = false, bekapcsolva_ekkor = null where id;
  select 'A kétlépcsős adatbázis-szabály kikapcsolva (a program a belépéskor továbbra is kéri a kódot).';
$$;

-- A böngészőből (anon, authenticated) nem hívható: csak az üzemeltető, az SQL-szerkesztőből.
revoke all on function public.ketlepcsos_hianyzik() from public, anon, authenticated;
revoke all on function public.ketlepcsos_kotelezove_tetel() from public, anon, authenticated;
revoke all on function public.ketlepcsos_kikapcsolasa() from public, anon, authenticated;

-- ---------- 5. Tétlenségi idő a raktárosnak ----------
-- Alapból 30 perc; a fő iroda a raktáros szerepkörnél hosszabbra állíthatja (legfeljebb 12 óra), mert ő
-- telefonról, munka közben dolgozik. A kétlépcsős azonosítás ettől mindig kötelező.

alter table public.companies add column if not exists raktaros_tetlenseg_perc integer not null default 30
  check (raktaros_tetlenseg_perc between 30 and 720);

create or replace function public.raktaros_tetlenseg_beallitasa(perc integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.my_role() is distinct from 'fo_iroda' then
    raise exception 'Csak a fő iroda állíthatja.' using errcode = '42501';
  end if;
  if perc < 30 or perc > 720 then
    raise exception 'A tétlenségi idő 30 perc és 12 óra között lehet.' using errcode = '22023';
  end if;
  update public.companies set raktaros_tetlenseg_perc = perc where id = public.my_company_id();
end;
$$;
revoke all on function public.raktaros_tetlenseg_beallitasa(integer) from public, anon;
grant execute on function public.raktaros_tetlenseg_beallitasa(integer) to authenticated;
