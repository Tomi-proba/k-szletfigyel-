-- Készletfigyelő - egyeztető ellenőrzések (2026-10-31, TERV.md F16, I4 3. lépés).
--
-- Mit ad hozzá (többször is lefuttatható, meglévő adatot nem töröl; a 2026-10-31-i integrációs
-- migrációk után futtatandó):
--   1. Az integrációs központtól kapott legutóbbi egyeztetési eredmény cégenként. Az integrációs
--      szolgáltatás írja; a böngésző csak az állapot-lekérdezésen át olvassa.
--   2. Az állapot-lekérdezés (integracio_allapot) kiegészítése az egyeztetés eredményével.
--
-- Meglévő (éles) projektben ezt a fájlt kell lefuttatni a Supabase SQL Editorban; friss projektben a
-- supabase/schema.sql végén ugyanez a blokk szerepel.

-- --- 1. Az egyeztetés eredménye ------------------------------------------------------------

create table if not exists integracio.egyeztetes (
  company_id uuid primary key references public.companies (id) on delete cascade,
  run_id uuid not null,
  at timestamptz not null,
  as_of date not null,
  idoszak_kezdet date not null,
  idoszak_veg date not null,
  eredmenyek jsonb not null,
  erkezett timestamptz not null default now()
);

-- --- 2. Állapot-lekérdezés -----------------------------------------------------------------

create or replace function public.integracio_allapot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, integracio, extensions
as $$
declare
  v_ceg uuid := public.my_company_id();
begin
  if v_ceg is null or public.my_role() not in ('fo_iroda', 'iroda', 'tulajdonos') then
    raise exception using errcode = '42501', message = 'Az integráció állapotát az iroda láthatja.';
  end if;
  return jsonb_build_object(
    'osszekapcsolva', integracio.osszekapcsolt(v_ceg),
    'beallitas', (select jsonb_build_object('adoszam', b.adoszam, 'osszekapcsolva', b.osszekapcsolva, 'bontva', b.bontva) from integracio.beallitas b where b.company_id = v_ceg),
    'ervenyes_kod_lejar', (select max(k.lejar) from integracio.kapcsolodasi_kodok k where k.company_id = v_ceg and k.felhasznalva is null and k.visszavonva is null and k.lejar > now()),
    'osszeallitasra_var', (select count(*) from integracio.valtozasok v where v.company_id = v_ceg and v.feldolgozva is null and v.kihagyva is null),
    'atadasra_var', (select count(*) from integracio.integration_outbox o where o.sent_at is null and o.envelope -> 'source' ->> 'companyRef' = v_ceg::text),
    'legregebbi_varakozo', (
      select min(t) from (
        select min(v.letrehozva) as t from integracio.valtozasok v where v.company_id = v_ceg and v.feldolgozva is null and v.kihagyva is null
        union all
        select min(o.created_at) from integracio.integration_outbox o where o.sent_at is null and o.envelope -> 'source' ->> 'companyRef' = v_ceg::text
      ) x
    ),
    'utolso_hiba', (
      select o.last_error from integracio.integration_outbox o
       where o.sent_at is null and o.last_error is not null and o.envelope -> 'source' ->> 'companyRef' = v_ceg::text
       order by o.created_at desc limit 1
    ),
    -- Az egyeztetés legutóbbi eredménye (TERV.md F16): a központ küldi éjszakánként és kérésre.
    'egyeztetes', (select jsonb_build_object('runId', e.run_id, 'at', e.at, 'asOf', e.as_of, 'from', e.idoszak_kezdet, 'to', e.idoszak_veg, 'eredmenyek', e.eredmenyek)
                     from integracio.egyeztetes e where e.company_id = v_ceg),
    'teendok', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'kulcs', t.kulcs, 'fajta', t.fajta, 'cim', t.cim, 'reszletek', t.reszletek, 'valtozasId', t.valtozas_id, 'letrehozva', t.letrehozva) order by t.letrehozva)
        from integracio.teendok t where t.company_id = v_ceg and t.megoldva is null
    ), '[]'::jsonb)
  );
end;
$$;
