
-- Készletfigyelő - a Könyvelő nyitott tételei (2026-11-01, TERV.md F19, I6b, KK10).
--
-- Mit ad hozzá (többször is lefuttatható, meglévő adatot nem töröl; a 2026-11-01-i közös Teendők migráció
-- után futtatandó):
--   - integracio.konyvelo_nyitott: a Könyvelő nyitott szállítói és vevői tételei, ahogy az integrációs
--     szolgáltatás legutóbb letöltötte (és a Készletből jött, még könyvelésre váró tételek);
--   - public.integracio_konyvelo_nyitott(): a felület ezt hívja. Aki ma a fizetési kötelezettségeket és a
--     kintlévőséget látja (iroda, fő iroda, tulajdonos), az látja; a raktáros nem.
-- Ha nincs Könyvelő (vagy a Könyvelő → Készlet kapcsolat ki van kapcsolva), a sor nincs meg, és a Készlet a
-- saját számítását mutatja, mint eddig.
--
-- Meglévő (éles) projektben ezt a fájlt kell lefuttatni a Supabase SQL Editorban; friss projektben a
-- supabase/schema.sql végén ugyanez a blokk szerepel.

create table if not exists integracio.konyvelo_nyitott (
  company_id uuid primary key references public.companies (id) on delete cascade,
  -- OK: a legutóbbi letöltés sikerült; KOZPONT_NEM_ERHETO_EL: nem (a lista a régebbi); NINCS_ADAT: a Könyvelő
  -- még nem küldött listát
  allapot text not null check (allapot in ('OK', 'KOZPONT_NEM_ERHETO_EL', 'NINCS_ADAT')),
  adat jsonb not null default '{"items": [], "pendingDrafts": []}'::jsonb,
  allapot_napja date,
  -- mikor kapta a központ a Könyvelőtől
  kuldve timestamptz,
  -- mikor töltötte le a szolgáltatás (sikeresen)
  lekerve timestamptz not null
);

create or replace function public.integracio_konyvelo_nyitott()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, integracio, extensions
as $$
declare
  v_ceg uuid := public.my_company_id();
  v_sor integracio.konyvelo_nyitott%rowtype;
begin
  if v_ceg is null or public.my_role() not in ('fo_iroda', 'iroda', 'tulajdonos') then
    return jsonb_build_object('allapot', 'NINCS_JOGOSULTSAG');
  end if;
  select * into v_sor from integracio.konyvelo_nyitott k where k.company_id = v_ceg;
  if not found or not integracio.osszekapcsolt(v_ceg) then
    return jsonb_build_object('allapot', 'NINCS_KONYVELO');
  end if;
  return jsonb_build_object('allapot', v_sor.allapot, 'asOf', v_sor.allapot_napja, 'kuldve', v_sor.kuldve, 'lekerve', v_sor.lekerve,
                            'items', v_sor.adat -> 'items', 'pendingDrafts', v_sor.adat -> 'pendingDrafts');
end;
$$;

revoke all on function public.integracio_konyvelo_nyitott() from public, anon;
grant execute on function public.integracio_konyvelo_nyitott() to authenticated;
