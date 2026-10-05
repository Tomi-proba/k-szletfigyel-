-- Migráció: jelszó módosítása a Beállításoknál (ehhez nem kell séma-
-- változás, a meglévő Supabase Auth beépített jelszó-módosítását használja),
-- és a név módosításának szigorítása - mostantól KIZÁRÓLAG a fő iroda
-- módosíthatja (akár a sajátját, akár egy másik csapattagét).
--
-- Ez a fájl ÖNMAGÁBAN is futtatható, akkor is, ha a 2026-10-05_nev_es_audit_ki.sql
-- migrációt még nem futtattad le - minden benne lévő lépés újra lefuttatva
-- is biztonságos (idempotens).

alter table public.profiles add column if not exists name text;
alter table public.invites add column if not exists name text;
alter table public.audit_log add column if not exists created_by_name text;
alter table public.audit_log add column if not exists created_by_email text;
alter table public.audit_log alter column created_by set default auth.uid();

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

-- Saját név módosítása - csak fő iroda hívhatja sikeresen (bárki más
-- számára a function kivételt dob).
create or replace function public.update_my_name(new_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'fo_iroda' then
    raise exception 'Csak a fő iroda módosíthatja a nevét.';
  end if;
  update public.profiles set name = nullif(trim(new_name), '') where id = auth.uid();
end;
$$;

-- Fő iroda egy másik, saját cégéhez tartozó csapattag nevét módosítja.
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
