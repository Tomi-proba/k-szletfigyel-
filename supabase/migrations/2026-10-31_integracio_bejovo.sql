-- Készletfigyelő - a Könyvelőből érkező tételek (2026-10-31, TERV.md F15.4, I3 4. lépés).
--
-- Mit ad hozzá (minden lépés többször is lefuttatható, meglévő adatot nem töröl; a 2026-10-29-i
-- integrációs migráció után futtatandó):
--   1. A mozgások mezői a Könyvelőből jött jóváhagyandó mozgásokhoz: melyik bizonylatból lett, és a
--      felületen mutatott forrás („Könyvelő, SZSZ-2026-00042”). A fizetési állapotot a Könyvelő követi-e
--      (ott a felület nem engedi kézzel állítani).
--   2. A Könyvelőben lezárt időszakok (a Készlet figyelmeztet, ha lezárt hónapra dátumoznak; nem tilt).
--   3. A mozgás-trigger kiegészítése: a Könyvelőből jött mozgás elutasítása („nem érkezett meg / nem ment
--      ki”) is eljut a Könyvelőbe, hogy ott Teendő legyen belőle.
--
-- Meglévő (éles) projektben ezt a fájlt kell lefuttatni a Supabase SQL Editorban; friss projektben a
-- supabase/schema.sql végén ugyanez a blokk szerepel.

-- --- 1. Mozgások és beszerzési tételek ------------------------------------------------------

alter table public.movements
  add column if not exists integracio_dokumentum_id text,
  add column if not exists integracio_forras text,
  add column if not exists fizetes_konyvelobol boolean not null default false;
alter table public.purchase_lots
  add column if not exists fizetes_konyvelobol boolean not null default false;
create index if not exists movements_integracio_dokumentum_idx on public.movements (company_id, integracio_dokumentum_id) where integracio_dokumentum_id is not null;

-- --- 2. A Könyvelőben lezárt időszakok ---------------------------------------------------

create table if not exists integracio.lezart_idoszakok (
  company_id uuid not null references public.companies (id) on delete cascade,
  fajta text not null check (fajta in ('PERIOD', 'FISCAL_YEAR')),
  kezdet date not null,
  veg date not null,
  lezarva timestamptz not null default now(),
  primary key (company_id, fajta, kezdet)
);

-- Minden céges szerepkör olvashatja (a raktáros is dátumoz mozgást).
create or replace function public.integracio_lezart_idoszakok()
returns jsonb
language sql
stable
security definer
set search_path = public, integracio
as $$
  select coalesce(jsonb_agg(jsonb_build_object('fajta', l.fajta, 'kezdet', l.kezdet, 'veg', l.veg) order by l.kezdet), '[]'::jsonb)
    from integracio.lezart_idoszakok l
   where l.company_id = public.my_company_id() and integracio.osszekapcsolt(l.company_id)
$$;
revoke all on function public.integracio_lezart_idoszakok() from public, anon;
grant execute on function public.integracio_lezart_idoszakok() to authenticated;

-- --- 3. Mozgás-trigger ---------------------------------------------------------------------

create or replace function integracio.mozgas_valtozott()
returns trigger language plpgsql security definer set search_path = integracio, public as $$
declare
  v_most boolean := integracio.hatalyos(new);
  v_elotte boolean := tg_op = 'UPDATE' and integracio.hatalyos(old);
  -- A Könyvelőből jött mozgás elutasítása: „nem érkezett meg / nem ment ki”. A készletre nem hat, de a
  -- Könyvelőnek tudnia kell róla (ott Teendő lesz).
  v_elutasitva boolean := tg_op = 'UPDATE' and new.integracio_esemeny_id is not null
                          and old.approval_status = 'pending' and new.approval_status = 'rejected';
  v_kep jsonb;
  v_eredeti public.movements;
  v_zaras uuid;
  v_hatott boolean := false;
begin
  if not integracio.osszekapcsolt(new.company_id) then
    return null;
  end if;
  v_kep := integracio.mozgas_kep(new.id);

  if new.corrects_movement_id is not null then
    -- Korrekciós tétel (eladás visszavonása vagy „korrekciós tétellel” törölt mozgás). Önmagában nem
    -- beszerzés vagy eladás: az eredeti mozgás visszavonását jelenti. Az eladás visszavonásakor a
    -- „visszavonva” jelzés már elküldi a visszavonást, ezért a hozzá tartozó visszavételezés nem.
    select * into v_eredeti from public.movements where id = new.corrects_movement_id;
    if v_most and not v_elotte then
      if v_eredeti.id is not null and not v_eredeti.cancelled then
        perform integracio.rogzit(new.company_id, 'mozgas_visszavonas', v_eredeti.id::text, integracio.mozgas_kep(v_eredeti.id) || jsonb_build_object('korrekcio', to_jsonb(new)));
      end if;
      v_hatott := true;
    elsif v_elutasitva and v_eredeti.id is not null then
      perform integracio.rogzit(new.company_id, 'mozgas_visszavonas', v_eredeti.id::text, integracio.mozgas_kep(v_eredeti.id) || jsonb_build_object('korrekcio', to_jsonb(new)));
    elsif v_elotte and not v_most then
      -- A korrekció törlése az eredeti mozgást „visszaállítaná”: ezt nem találgatjuk ki, Teendő lesz.
      perform integracio.rogzit(new.company_id, 'mozgas_kezeletlen', new.id::text, v_kep);
      v_hatott := true;
    end if;
  else
    if v_most and not v_elotte then
      perform integracio.rogzit(new.company_id, 'mozgas_veglegesites', new.id::text, v_kep);
      v_hatott := true;
    elsif v_elutasitva then
      perform integracio.rogzit(new.company_id, 'mozgas_veglegesites', new.id::text, v_kep);
    elsif v_elotte and not v_most then
      perform integracio.rogzit(new.company_id, 'mozgas_visszavonas', new.id::text, v_kep);
      v_hatott := true;
    elsif v_most and v_elotte and new.cancelled and not old.cancelled then
      perform integracio.rogzit(new.company_id, 'mozgas_visszavonas', new.id::text, v_kep);
      v_hatott := true;
    end if;
  end if;

  -- Ha a mozgás napjára már elküldött napi zárás van, a zárás nem íródik felül: csak jelezzük.
  if v_hatott then
    select d.id into v_zaras
      from public.daily_closings d
     where d.location_id = new.location_id and d.date = new.date
       and exists (select 1 from integracio.valtozasok v where v.company_id = d.company_id and v.fajta = 'napi_zaras' and v.rekord_id = d.id::text);
    if v_zaras is not null then
      perform integracio.rogzit(
        new.company_id, 'napi_zaras_modosult', v_zaras::text,
        jsonb_build_object('zaras', (select to_jsonb(d) from public.daily_closings d where d.id = v_zaras),
                           'telephely', (select to_jsonb(l) from public.locations l where l.id = new.location_id),
                           'mozgas_id', new.id)
      );
    end if;
  end if;
  return null;
end;
$$;
