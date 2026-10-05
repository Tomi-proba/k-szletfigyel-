-- Migráció: felhasználói NÉV mező + "ki módosította?" az audit naplóban.
-- Csak hozzáadó (additív) változtatásokat tartalmaz - semmilyen meglévő
-- sor/oszlop nem törlődik, nem íródik felül. A teljes, naprakész sémát
-- lásd supabase/schema.sql-ben, ez csak a MÁR ÉLES adatbázisra alkalmazandó
-- különbség.

alter table public.profiles add column if not exists name text;
alter table public.invites add column if not exists name text;
alter table public.audit_log add column if not exists created_by_name text;
alter table public.audit_log add column if not exists created_by_email text;
alter table public.audit_log alter column created_by set default auth.uid();

-- handle_new_user() újradefiniálva - mostantól a nevet is átmásolja a
-- meghívóból (csapattag-létrehozásnál), illetve a regisztrációs metaadatból
-- (saját regisztrációnál). A trigger maga (on_auth_user_created) változatlan.
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

-- Saját név utólagos beállítása/javítása - lásd schema.sql a részletes
-- indoklásért (miért security definer function, nem sima UPDATE policy).
create or replace function public.update_my_name(new_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set name = nullif(trim(new_name), '') where id = auth.uid();
end;
$$;
