-- Készletfigyelő - a szállítói számla kelte és teljesítési dátuma a beérkezésnél (2026-10-31).
--
-- Nem kötelező. Ha a beérkezéskor megadják, a Könyvelő szállítói számla-piszkozatára is átkerül; ha nem, ott
-- a jóváhagyó írja be a számláról (a program nem találgat). A 2026-10-29-i integrációs migráció után futtatandó.
--
-- Meglévő (éles) projektben ezt a fájlt kell lefuttatni a Supabase SQL Editorban; friss projektben a
-- supabase/schema.sql végén ugyanez a blokk szerepel.

alter table public.movements
  add column if not exists invoice_date date,
  add column if not exists fulfillment_date date;
