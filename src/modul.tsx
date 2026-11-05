// A Készletkezelő felület-csomagja a közös keretnek (AWEBOLDAL TERV.md F24 KS8): `/modulok/keszlet/modul.js`. A keret
// közös példányait használja (React, útválasztó, közös komponensek: window.__keret), és a window.__modulok.keszlet alá
// regisztrál. A stílusa (modul.css) a Készlet dobozára szűkítve készül (vite.keret.config.ts).
import type { ModulCsomag } from '@aweboldal/felulet'
import { KeretKepernyok } from './keret/KeretApp'
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
