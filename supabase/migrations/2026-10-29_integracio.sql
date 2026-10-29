-- Készletfigyelő - integráció a többi modullal (2026-10-29, TERV.md F15.2).
--
-- Mit ad hozzá (minden lépés többször is lefuttatható, meglévő adatot nem töröl, és a Készlet
-- működésén SEMMIT nem változtat, amíg a cég nincs összekapcsolva):
--   1. A mozgások új mezői: ok (leltáreltérés, selejt), visszáru-hivatkozás, számlaszám, a szállítási
--      díj számlán léte, és ha a mozgás egy beérkezett eseményből lett, annak azonosítója.
--   2. Az „integracio” séma: a változások sora, kimenő és bejövő tábla, sorszámok, nonce-ok,
--      összekapcsolás, kapcsolódási kódok, Teendők. A böngészőből (anon, authenticated) NEM érhető el;
--      az integrációs szolgáltatás közvetlen adatbázis-kapcsolattal dolgozik vele.
--   3. Triggerek: a mozgás, a napi zárás, a termék, a szállító és a vevő változása UGYANABBAN a
--      tranzakcióban egy pillanatképet ír a változások sorába, de csak összekapcsolt cégnél. A mentés
--      soha nem vár a szolgáltatásra, a központra vagy a Könyvelőre.
--   4. Függvények a felületnek: kapcsolódási kód készítése (fő iroda), az integráció állapota, és egy
--      össze nem állítható változás kihagyása (fő iroda, indoklással, naplózva).
--
-- Meglévő (éles) projektben ezt a fájlt kell lefuttatni a Supabase SQL Editorban; friss projektben a
-- supabase/schema.sql végén ugyanez a blokk szerepel.

-- --- 1. A mozgások új mezői -------------------------------------------------------------

alter table public.movements
  add column if not exists ok text,
  add column if not exists return_of_movement_id uuid,
  add column if not exists invoice_number text,
  add column if not exists shipping_on_invoice boolean,
  add column if not exists integracio_esemeny_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'movements_ok_check') then
    alter table public.movements add constraint movements_ok_check
      check (ok is null or ok in ('normal', 'leltar_hiany', 'leltar_tobblet', 'selejt'));
  end if;
end;
$$;

-- --- 2. Az integracio séma --------------------------------------------------------------

create schema if not exists integracio;
revoke all on schema integracio from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema integracio from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema integracio from authenticated'; end if;
end;
$$;

-- Összekapcsolás cégenként (D13: csak kapcsolódási kóddal jön létre, lásd a szolgáltatást).
create table if not exists integracio.beallitas (
  company_id uuid primary key references public.companies (id) on delete cascade,
  adoszam text not null,
  osszekapcsolva timestamptz,
  bontva timestamptz,
  kod_id uuid,
  modositva timestamptz not null default now()
);

-- Egyszer használható, lejáró kapcsolódási kódok. Csak a kód lenyomata kerül ide, maga a kód soha.
create table if not exists integracio.kapcsolodasi_kodok (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kod_hash text not null unique,
  adoszam text not null,
  letrehozva timestamptz not null default now(),
  lejar timestamptz not null,
  felhasznalva timestamptz,
  visszavonva timestamptz,
  letrehozta uuid
);

-- A változások sora: a trigger a mentés tranzakciójában ide írja, MI történt, és a sor akkori
-- pillanatképét. Ebből az integrációs szolgáltatás állítja össze az eseményt (a Készlet saját
-- számolófüggvényeivel), és teszi a kimenő táblába. Feldolgozás azonosító (id) sorrendben.
create table if not exists integracio.valtozasok (
  id bigserial primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  fajta text not null check (fajta in (
    'mozgas_veglegesites', 'mozgas_visszavonas', 'mozgas_kezeletlen', 'napi_zaras', 'napi_zaras_modosult', 'termek', 'partner'
  )),
  rekord_id text not null,
  pillanatkep jsonb not null,
  -- Ha a változás egy beérkezett esemény hatására történt (visszhang tiltása).
  oka_esemeny uuid,
  -- A változás időpontja Budapesti idő szerinti nappal (a visszavonás dátuma).
  nap date not null default (now() at time zone 'Europe/Budapest')::date,
  letrehozva timestamptz not null default now(),
  feldolgozva timestamptz,
  esemeny_id uuid,
  kihagyva timestamptz,
  kihagyas_indoka text,
  kihagyta uuid,
  probalkozasok integer not null default 0,
  utolso_hiba text,
  elso_hiba timestamptz
);
create index if not exists valtozasok_nyitott_idx on integracio.valtozasok (id) where feldolgozva is null and kihagyva is null;
create index if not exists valtozasok_rekord_idx on integracio.valtozasok (company_id, fajta, rekord_id);

-- Kimenő és bejövő tábla, sorszámok: a közös eseménycsomag (integracio/esemenyek, postgres.ts)
-- INTEGRATION_DDL-jével azonos szerkezet, az integracio sémában.
create table if not exists integracio.integration_outbox (
  id          uuid primary key,
  envelope    jsonb not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    integer not null default 0,
  last_error  text
);
create index if not exists integration_outbox_unsent_idx on integracio.integration_outbox (created_at) where sent_at is null;

create table if not exists integracio.integration_inbox (
  event_id     uuid primary key,
  received_at  timestamptz not null default now(),
  outcome      text not null,
  result       jsonb not null
);

create table if not exists integracio.integration_sequences (
  record_type  text not null,
  record_id    text not null,
  last_value   integer not null,
  primary key (record_type, record_id)
);

-- A központ kéréseinek egyszer használható azonosítói (ismételt kérés elleni védelem).
create table if not exists integracio.nonces (
  nonce text primary key,
  erkezett timestamptz not null default now()
);

-- A Készlet integrációs Teendői (pl. a központ nem érhető el, egy változás nem állítható össze).
create table if not exists integracio.teendok (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kulcs text not null,
  fajta text not null,
  cim text not null,
  reszletek text,
  valtozas_id bigint references integracio.valtozasok (id),
  letrehozva timestamptz not null default now(),
  megoldva timestamptz,
  megoldotta uuid,
  -- Ha a Teendő a központba is bekerült (beérkezett esemény TODO eredménye): annak kulcsa, és mikor
  -- jeleztük a központnak a megoldását.
  hub_kulcs text,
  hub_jelentve timestamptz
);
create unique index if not exists teendok_nyitott_kulcs_idx on integracio.teendok (company_id, kulcs) where megoldva is null;

-- --- 3. Triggerek -----------------------------------------------------------------------

create or replace function integracio.osszekapcsolt(p_ceg uuid)
returns boolean language sql stable security definer set search_path = integracio, public as $$
  select exists (select 1 from integracio.beallitas b where b.company_id = p_ceg and b.osszekapcsolva is not null and b.bontva is null)
$$;

-- Hatályos (véglegesített) mozgás: nem törölt, és nincs jóváhagyásra várva vagy elutasítva.
create or replace function integracio.hatalyos(m public.movements)
returns boolean language sql immutable as $$
  select m.deleted_at is null and (m.approval_status is null or m.approval_status = 'approved')
$$;

create or replace function integracio.rogzit(p_ceg uuid, p_fajta text, p_rekord text, p_kep jsonb, p_oka uuid default null)
returns void language sql security definer set search_path = integracio, public as $$
  insert into integracio.valtozasok (company_id, fajta, rekord_id, pillanatkep, oka_esemeny)
  values (p_ceg, p_fajta, p_rekord, p_kep, coalesce(p_oka, nullif(current_setting('integracio.oka_esemeny', true), '')::uuid))
$$;

-- Egy mozgás pillanatképe a tranzakció VÉGÉN (a késleltetett trigger miatt a mentés minden sora, pl. a
-- beszerzési tétel is megvan már): a mozgás, a beszerzési tétele, a termék, a telephely, a szállító, a
-- vevő, és ha a mozgás visszáru vagy korrekció, az eredeti mozgás és annak tétele.
create or replace function integracio.mozgas_kep(p_id uuid)
returns jsonb language sql stable security definer set search_path = integracio, public as $$
  select jsonb_build_object(
    'mozgas', to_jsonb(m),
    'tetel', (select to_jsonb(l) from public.purchase_lots l where l.movement_id = m.id order by l.deleted_at nulls first, l.created_at limit 1),
    'termek', to_jsonb(p),
    'telephely', to_jsonb(loc),
    'szallito', (select to_jsonb(s) from public.suppliers s where s.id::text = p.supplier_id and s.company_id = m.company_id),
    'vevo', (select to_jsonb(c) from public.customers c where c.id::text = m.customer_id and c.company_id = m.company_id),
    'eredeti', (select to_jsonb(o) from public.movements o where o.id = coalesce(m.return_of_movement_id, m.corrects_movement_id)),
    'eredeti_tetel', (select to_jsonb(l) from public.purchase_lots l where l.movement_id = coalesce(m.return_of_movement_id, m.corrects_movement_id) order by l.deleted_at nulls first, l.created_at limit 1),
    'eredeti_vevo', (
      select to_jsonb(c) from public.movements o join public.customers c on c.id::text = o.customer_id and c.company_id = o.company_id
      where o.id = m.return_of_movement_id
    )
  )
  from public.movements m
  join public.products p on p.id = m.product_id
  left join public.locations loc on loc.id = m.location_id
  where m.id = p_id
$$;

create or replace function integracio.mozgas_valtozott()
returns trigger language plpgsql security definer set search_path = integracio, public as $$
declare
  v_most boolean := integracio.hatalyos(new);
  v_elotte boolean := tg_op = 'UPDATE' and integracio.hatalyos(old);
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
    elsif v_elotte and not v_most then
      -- A korrekció törlése az eredeti mozgást „visszaállítaná”: ezt nem találgatjuk ki, Teendő lesz.
      perform integracio.rogzit(new.company_id, 'mozgas_kezeletlen', new.id::text, v_kep);
      v_hatott := true;
    end if;
  else
    if v_most and not v_elotte then
      perform integracio.rogzit(new.company_id, 'mozgas_veglegesites', new.id::text, v_kep);
      v_hatott := true;
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

drop trigger if exists movements_integracio on public.movements;
create constraint trigger movements_integracio
  after insert or update on public.movements
  deferrable initially deferred
  for each row execute function integracio.mozgas_valtozott();

create or replace function integracio.napi_zaras_elkuldve()
returns trigger language plpgsql security definer set search_path = integracio, public as $$
begin
  if not integracio.osszekapcsolt(new.company_id) then
    return null;
  end if;
  perform integracio.rogzit(new.company_id, 'napi_zaras', new.id::text, jsonb_build_object(
    'zaras', (select to_jsonb(d) from public.daily_closings d where d.id = new.id),
    'telephely', (select to_jsonb(l) from public.locations l where l.id = new.location_id),
    'mozgasok', coalesce((
      select jsonb_agg(integracio.mozgas_kep(m.id) order by array_position(new.movement_ids, m.id::text))
        from public.movements m
       where m.company_id = new.company_id and m.id::text = any (new.movement_ids)
    ), '[]'::jsonb)
  ));
  return null;
end;
$$;

drop trigger if exists daily_closings_integracio on public.daily_closings;
create constraint trigger daily_closings_integracio
  after insert on public.daily_closings
  deferrable initially deferred
  for each row execute function integracio.napi_zaras_elkuldve();

-- Termék: csak a többi modult érintő mezők változása (a készlet és az ár változása nem).
create or replace function integracio.termek_valtozott()
returns trigger language plpgsql security definer set search_path = integracio, public as $$
begin
  if not integracio.osszekapcsolt(new.company_id) then
    return null;
  end if;
  if tg_op = 'UPDATE' and (new.name, new.sku, new.unit, new.default_vat_rate_percent, new.deleted_at is null)
     is not distinct from (old.name, old.sku, old.unit, old.default_vat_rate_percent, old.deleted_at is null) then
    return null;
  end if;
  perform integracio.rogzit(new.company_id, 'termek', new.id::text, (select to_jsonb(p) from public.products p where p.id = new.id));
  return null;
end;
$$;

drop trigger if exists products_integracio on public.products;
create constraint trigger products_integracio
  after insert or update on public.products
  deferrable initially deferred
  for each row execute function integracio.termek_valtozott();

-- Szállító és vevő: csak adószámmal (a többi modul adószám szerint egyeztet), és csak ha a név vagy
-- az adószám változott.
create or replace function integracio.partner_valtozott()
returns trigger language plpgsql security definer set search_path = integracio, public as $$
begin
  if not integracio.osszekapcsolt(new.company_id) or new.tax_number is null or btrim(new.tax_number) = '' or new.deleted_at is not null then
    return null;
  end if;
  if tg_op = 'UPDATE' and (new.name, new.tax_number) is not distinct from (old.name, old.tax_number) then
    return null;
  end if;
  perform integracio.rogzit(new.company_id, 'partner', tg_table_name || ':' || new.id::text, to_jsonb(new) || jsonb_build_object('tabla', tg_table_name));
  return null;
end;
$$;

drop trigger if exists suppliers_integracio on public.suppliers;
create constraint trigger suppliers_integracio
  after insert or update on public.suppliers
  deferrable initially deferred
  for each row execute function integracio.partner_valtozott();
drop trigger if exists customers_integracio on public.customers;
create constraint trigger customers_integracio
  after insert or update on public.customers
  deferrable initially deferred
  for each row execute function integracio.partner_valtozott();

-- --- 4. Függvények a felületnek ---------------------------------------------------------

-- Kapcsolódási kód (D13): csak a fő iroda készítheti, egyszer használható, 24 óráig érvényes. A kód
-- csak most, egyszer látszik; az adatbázisba csak a lenyomata kerül. Az előző, fel nem használt kódok
-- érvényüket vesztik. Az adószám csak kiegészítő ellenőrzés: önmagában soha nem elég.
create or replace function public.integracio_kod_keszites(p_adoszam text)
returns jsonb
language plpgsql
security definer
set search_path = public, integracio, extensions
as $$
declare
  v_ceg uuid := public.my_company_id();
  v_szamjegyek text := regexp_replace(coalesce(p_adoszam, ''), '\D', '', 'g');
  v_abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bajtok bytea := gen_random_bytes(16);
  v_kod text := '';
  v_lejar timestamptz := now() + interval '24 hours';
begin
  if v_ceg is null or public.my_role() is distinct from 'fo_iroda' then
    raise exception using errcode = '42501', message = 'Kapcsolódási kódot csak a fő iroda készíthet.';
  end if;
  if length(v_szamjegyek) <> 11 then
    raise exception using errcode = '22023', message = 'Adja meg a cég teljes adószámát (12345678-1-12).';
  end if;
  for i in 0..15 loop
    v_kod := v_kod || substr(v_abc, (get_byte(v_bajtok, i) % length(v_abc)) + 1, 1);
  end loop;
  update integracio.kapcsolodasi_kodok set visszavonva = now()
   where company_id = v_ceg and felhasznalva is null and visszavonva is null;
  insert into integracio.kapcsolodasi_kodok (company_id, kod_hash, adoszam, lejar, letrehozta)
  values (v_ceg, encode(digest(v_kod, 'sha256'), 'hex'), v_szamjegyek, v_lejar, auth.uid());
  insert into public.audit_log (company_id, entity_type, entity_id, entity_label, action, description, created_by_name, created_by_email)
  select v_ceg, 'integracio', v_ceg::text, 'Integráció', 'create', 'Kapcsolódási kód készült (24 óráig érvényes, egyszer használható)', p.name, p.email
    from public.profiles p where p.id = auth.uid();
  return jsonb_build_object(
    'kod', substr(v_kod, 1, 4) || '-' || substr(v_kod, 5, 4) || '-' || substr(v_kod, 9, 4) || '-' || substr(v_kod, 13, 4),
    'lejar', v_lejar
  );
end;
$$;

-- Az integráció állapota a felületnek (az iroda-szintű szerepköröknek): összekapcsolás, hány esemény
-- vár és mióta, mi nem állítható össze, és a nyitott Teendők.
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
    'teendok', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'kulcs', t.kulcs, 'fajta', t.fajta, 'cim', t.cim, 'reszletek', t.reszletek, 'valtozasId', t.valtozas_id, 'letrehozva', t.letrehozva) order by t.letrehozva)
        from integracio.teendok t where t.company_id = v_ceg and t.megoldva is null
    ), '[]'::jsonb)
  );
end;
$$;

-- Egy össze nem állítható változás kihagyása: csak a fő iroda, indoklással, naplózva. A program ezt
-- soha nem teszi meg magától (a változás addig vár, és a mögötte lévő, ugyanarra a rekordra vonatkozó
-- változások is, hogy a sorrend ne boruljon).
create or replace function public.integracio_kihagyas(p_valtozas_id bigint, p_indok text)
returns void
language plpgsql
security definer
set search_path = public, integracio, extensions
as $$
declare
  v_ceg uuid := public.my_company_id();
  v_sor integracio.valtozasok;
begin
  if v_ceg is null or public.my_role() is distinct from 'fo_iroda' then
    raise exception using errcode = '42501', message = 'Változást kihagyni csak a fő iroda tud.';
  end if;
  if coalesce(btrim(p_indok), '') = '' then
    raise exception using errcode = '22023', message = 'Írja be, miért hagyja ki (a naplóba kerül).';
  end if;
  select * into v_sor from integracio.valtozasok where id = p_valtozas_id and company_id = v_ceg for update;
  if v_sor.id is null or v_sor.feldolgozva is not null or v_sor.kihagyva is not null then
    raise exception using errcode = '22023', message = 'Ez a változás nem vár összeállításra.';
  end if;
  update integracio.valtozasok set kihagyva = now(), kihagyas_indoka = btrim(p_indok), kihagyta = auth.uid() where id = v_sor.id;
  update integracio.teendok set megoldva = now(), megoldotta = auth.uid() where company_id = v_ceg and valtozas_id = v_sor.id and megoldva is null;
  insert into public.audit_log (company_id, entity_type, entity_id, entity_label, action, description, created_by_name, created_by_email)
  select v_ceg, 'integracio', v_sor.id::text, 'Integráció', 'delete', format('Integrációs változás kihagyva (%s): %s', v_sor.fajta, btrim(p_indok)), p.name, p.email
    from public.profiles p where p.id = auth.uid();
end;
$$;

revoke all on function public.integracio_kod_keszites(text) from public, anon;
revoke all on function public.integracio_allapot() from public, anon;
revoke all on function public.integracio_kihagyas(bigint, text) from public, anon;
grant execute on function public.integracio_kod_keszites(text) to authenticated;
grant execute on function public.integracio_allapot() to authenticated;
grant execute on function public.integracio_kihagyas(bigint, text) to authenticated;
