-- Készletfigyelő - az eÁFA-ban beküldött áfabevallások időszakai (2026-10-31, TERV.md F17.2, I5 4. lépés).
--
-- Mit ad hozzá (többször is lefuttatható, meglévő adatot nem töröl; a 2026-10-31-i integrációs migrációk
-- után futtatandó): a Könyvelőben lezárt időszakok mellé az eÁFA-ban beküldött áfaidőszakok is bekerülnek
-- (fajta: AFA_BEKULDVE). A Készlet ugyanúgy figyelmeztet, ha erre az időszakra rögzítenek, de nem tilt: a
-- könyvelőnél önellenőrzés lehet szükséges.
--
-- Meglévő (éles) projektben ezt a fájlt kell lefuttatni a Supabase SQL Editorban; friss projektben a
-- supabase/schema.sql végén ugyanez a blokk szerepel.

alter table integracio.lezart_idoszakok drop constraint if exists lezart_idoszakok_fajta_check;
alter table integracio.lezart_idoszakok add constraint lezart_idoszakok_fajta_check
  check (fajta in ('PERIOD', 'FISCAL_YEAR', 'AFA_BEKULDVE'));
