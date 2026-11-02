-- ---------------------------------------------------------------------------
-- 2026-11-02: Raktári bejelentés → fő irodai elfogadás (DOCUMENTATION.md 31. fejezet)
-- ---------------------------------------------------------------------------
-- Amit a raktáros rögzít, az bejelentés: jóváhagyásra váró mozgás, ami a készletet nem változtatja.
-- Érvényessé (vagy elutasítottá) csak a fő iroda teheti. Az irodától vagy a Könyvelőből érkező várakozó
-- tételnél a raktáros csak visszaigazolja, mi történt ténylegesen (raktar_* oszlopok).
--
-- Az adatbázis a valódi határ: a felület csak kényelem.
-- * A raktáros csak jóváhagyásra váró mozgást szúrhat be, és csak a még el nem fogadott (vagy elutasított)
--   mozgást módosíthatja; érvényeset nem (nem törölheti, nem vonhatja vissza).
-- * Jóváhagyásra váró mozgást elfogadni vagy elutasítani csak a fő iroda tud.
-- * A raktáros nem írhatja közvetlenül a termék készletét és a beszerzési tételeket (ezek csak a fő iroda
--   elfogadásakor változnak). Olvasni továbbra is olvashatja a saját telephelyéét.
-- A szerveroldali szolgáltatások (integrációs szolgáltatás, üzemeltető) nem bejelentkezett felhasználóként
-- futnak (auth.uid() üres): rájuk a szabály nem vonatkozik.
-- Ismételten futtatható.

alter table public.movements
  add column if not exists raktar_visszaigazolva timestamptz,
  add column if not exists raktar_mennyiseg numeric,
  add column if not exists raktar_megjegyzes text;

create or replace function public.mozgas_jovahagyas_vedelem()
returns trigger language plpgsql set search_path = public as $$
declare
  v_szerep text;
begin
  if auth.uid() is null then
    return new;
  end if;
  v_szerep := public.my_role();
  if v_szerep = 'raktaros' then
    if tg_op = 'INSERT' and new.approval_status is distinct from 'pending' then
      raise exception using
        errcode = '42501',
        message = 'A raktáros csak jóváhagyásra váró bejelentést rögzíthet; érvényessé a fő iroda teszi.';
    end if;
    if tg_op = 'UPDATE' and (
      old.approval_status is null
      or old.approval_status not in ('pending', 'rejected')
      or (new.approval_status is distinct from 'pending' and new.approval_status is distinct from old.approval_status)
    ) then
      raise exception using
        errcode = '42501',
        message = 'A raktáros érvényes mozgást nem módosíthat, és bejelentést nem fogadhat el.';
    end if;
  end if;
  if tg_op = 'UPDATE' and v_szerep is distinct from 'fo_iroda'
     and old.approval_status = 'pending' and new.approval_status in ('approved', 'rejected') then
    raise exception using
      errcode = '42501',
      message = 'Jóváhagyásra váró tételt csak a fő iroda fogadhat el vagy utasíthat el.';
  end if;
  return new;
end;
$$;

drop trigger if exists movements_jovahagyas_vedelem on public.movements;
create trigger movements_jovahagyas_vedelem
  before insert or update on public.movements
  for each row execute function public.mozgas_jovahagyas_vedelem();

drop policy if exists "Raktáros a saját telephelye termékeit frissítheti" on public.products;
drop policy if exists "Raktáros tételt létrehozhat a saját telephelyén" on public.purchase_lots;
drop policy if exists "Raktáros tételt frissíthet a saját telephelyén" on public.purchase_lots;
