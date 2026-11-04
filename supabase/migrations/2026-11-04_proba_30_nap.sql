-- ---------------------------------------------------------------------------
-- 2026-11-04: 30 napos próbaidő és árak egy helyen (AWEBOLDAL TERV.md F20)
-- ---------------------------------------------------------------------------
-- * Az ÚJONNAN regisztráló cégek próbaideje 30 nap (eddig 14). Csak az alapértelmezett érték változik:
--   a MEGLÉVŐ cégek próbaideje, állapota és adatai NEM változnak (egyetlen meglévő sort sem írunk át).
-- * A beégetett 9 990 Ft-os alapár megszűnik: az árak egyetlen forrása a portál árlistája
--   (/api/v1/arak). A plan_price_huf oszlop megmarad (a meglévő értékekkel együtt), csak már nem használjuk,
--   és új cégnél üres marad.
-- Ismételten futtatható. Az élő projekten csak külön jóváhagyás után fut (ELESITES.md).

alter table public.companies alter column trial_ends_at set default (now() + interval '30 days');
alter table public.companies alter column plan_price_huf drop default;
alter table public.companies alter column plan_price_huf drop not null;
