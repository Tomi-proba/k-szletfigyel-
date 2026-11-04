-- A Supabase-környezet minimális utánzata az adatbázis-tesztekhez (helyi PostgreSQL 16).
-- Csak azt adja, amire a supabase/schema.sql épít: auth.users, auth.uid(), a két API-szerepkör
-- (anon, authenticated) és a pgcrypto (gen_random_bytes). Éles projektben ezt a Supabase adja.
create extension if not exists pgcrypto;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb
);

-- A Supabase a bejelentkezett felhasználót a JWT „sub” mezőjéből adja; a tesztek ugyanígy, a
-- request.jwt.claim.sub beállítással jelölik.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- A JWT többi mezője (pl. „aal”: kétlépcsős azonosítás után aal2), a Supabase auth.jwt() függvényének mintájára.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- A kétlépcsős tényezők (Supabase MFA): az átállási lista és a bekapcsolási feltétel ebből dolgozik.
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  factor_type text not null default 'totp',
  status text not null default 'unverified'
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end;
$$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
