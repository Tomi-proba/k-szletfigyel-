
-- Készletfigyelő - közös Teendők és hivatkozások (2026-11-01, TERV.md F18, I6 3. lépés).
--
-- Mit ad hozzá (többször is lefuttatható, meglévő adatot nem töröl; a 2026-10-31-i migrációk után
-- futtatandó):
--   - integracio.teendo_tukor: a központnak legutóbb elküldött Teendő-lista lenyomata (az integrációs
--     szolgáltatás csak változáskor, de legalább 10 percenként küldi újra);
--   - integracio.kozos_teendok: a cég többi programjának Teendői, ahogy a szolgáltatás legutóbb letöltötte
--     (csak a cím és a hivatkozás; a részletek nem);
--   - public.integracio_kozos_teendok(): a felület ezt hívja. A közös belépésig csak a fő iroda és a
--     tulajdonos látja (döntés 2026-11-01);
--   - movements.integracio_forras_utvonal: a Könyvelőből jött mozgás forrásbizonylatának útvonala a
--     Könyvelő felületén („honnan jött?” hivatkozás, ugyanabban a fülben nyílik).
--
-- Meglévő (éles) projektben ezt a fájlt kell lefuttatni a Supabase SQL Editorban; friss projektben a
-- supabase/schema.sql végén ugyanez a blokk szerepel.

create table if not exists integracio.teendo_tukor (
  company_id uuid primary key references public.companies (id) on delete cascade,
  lenyomat text not null,
  -- az összekapcsolás ideje a küldéskor: új összekapcsolás után a lista mindenképp újra megy
  kapcsolat timestamptz,
  kuldve timestamptz not null
);

create table if not exists integracio.kozos_teendok (
  company_id uuid primary key references public.companies (id) on delete cascade,
  -- OK: a legutóbbi letöltés sikerült; KOZPONT_NEM_ERHETO_EL: a legutóbbi nem (a lista a régebbi)
  allapot text not null check (allapot in ('OK', 'KOZPONT_NEM_ERHETO_EL')),
  teendok jsonb not null default '[]'::jsonb,
  modulok jsonb not null default '[]'::jsonb,
  lekerve timestamptz not null
);

alter table public.movements add column if not exists integracio_forras_utvonal text;

create or replace function public.integracio_kozos_teendok()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, integracio, extensions
as $$
declare
  v_ceg uuid := public.my_company_id();
  v_sor integracio.kozos_teendok%rowtype;
begin
  if v_ceg is null or public.my_role() not in ('fo_iroda', 'tulajdonos') then
    return jsonb_build_object('allapot', 'NINCS_JOGOSULTSAG', 'teendok', '[]'::jsonb, 'modulok', '[]'::jsonb);
  end if;
  if not integracio.osszekapcsolt(v_ceg) then
    return jsonb_build_object('allapot', 'NINCS_OSSZEKAPCSOLVA', 'teendok', '[]'::jsonb, 'modulok', '[]'::jsonb);
  end if;
  select * into v_sor from integracio.kozos_teendok k where k.company_id = v_ceg;
  if not found then
    return jsonb_build_object('allapot', 'MEG_NINCS_ADAT', 'teendok', '[]'::jsonb, 'modulok', '[]'::jsonb);
  end if;
  return jsonb_build_object('allapot', v_sor.allapot, 'teendok', v_sor.teendok, 'modulok', v_sor.modulok, 'lekerve', v_sor.lekerve);
end;
$$;

revoke all on function public.integracio_kozos_teendok() from public, anon;
grant execute on function public.integracio_kozos_teendok() to authenticated;
