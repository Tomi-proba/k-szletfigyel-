// A Készletkezelő felület-csomagja a közös keretnek (AWEBOLDAL TERV.md F24 KS8): `/modulok/keszlet/modul.js`. A keret
// közös példányait használja (React, útválasztó, közös komponensek: window.__keret), és a window.__modulok.keszlet alá
// regisztrál. A stílusa (modul.css) a Készlet dobozára szűkítve készül (vite.keret.config.ts).
import type { ModulCsomag } from '@aweboldal/felulet'
import { KeretKepernyok } from './keret/KeretApp'
// A közös gombok, kártyák, címkék (.btn, .chip, .card, .badge, .alert): a keretben is kellenek, a színeik a keret
// tokenjeiből jönnek (világos/sötét). A Tailwind ELŐTT: a keretben a rétegek feloldva, így a sorrend dönt, és a
// segédosztályok (pl. w-full, self-start) így felülírhatják őket, mint az önálló felületen.
import './kozos/kozos.css'
import './index.css'
import './keret/keret.css'

const csomag: ModulCsomag = {
  szerzodes: 1,
  kod: 'keszlet',
  Kepernyok: KeretKepernyok,
  // A Készlet dátumtartománnyal dolgozik: a keret választását változatlanul kapja.
  idoszakFajta: null,
  stilusok: ['modul.css'],
}

window.__modulok = { ...(window.__modulok ?? {}), keszlet: csomag }
