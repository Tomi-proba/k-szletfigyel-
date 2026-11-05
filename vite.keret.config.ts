// A Készletkezelő felület-csomagja a közös keretnek (AWEBOLDAL TERV.md F24 KS8): IIFE, a keret közös példányaira
// hivatkozva (window.__keret), azokat nem csomagolja be. Kimenet: dist/modul/modul.js és modul.css. Az önálló
// felület (vite.config.ts: Render és asztali program) fordítása változatlan; a dist/modul az asztali telepítőbe
// nem kerül bele (electron/package.json).
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { kozosAlias } from './vite.config.ts'
import { szukit } from './keret-css.ts'

const kozos: Record<string, string> = {
  react: '__keret.React',
  'react-dom': '__keret.ReactDOM',
  'react/jsx-runtime': '__keret.jsxRuntime',
  'react-router-dom': '__keret.ReactRouter',
  'react-router': '__keret.ReactRouter',
  '@aweboldal/felulet': '__keret.Felulet',
}

/** A kiírt modul.css szűkítése a Készlet dobozára (a Tailwind kimenetén is, ezért a legvégén). */
const cssSzukites: Plugin = {
  name: 'keszlet-css-szukites',
  enforce: 'post',
  writeBundle(o, bundle) {
    for (const f of Object.values(bundle)) {
      if (f.type !== 'asset' || !f.fileName.endsWith('.css')) continue
      const ut = path.join(o.dir ?? 'dist/modul', f.fileName)
      writeFileSync(ut, szukit(readFileSync(ut, 'utf8')))
    }
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cssSzukites],
  resolve: { alias: Object.fromEntries(Object.entries(kozosAlias).filter(([k]) => k !== '@aweboldal/felulet')) },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  publicDir: false,
  build: {
    outDir: 'dist/modul',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: 'src/modul.tsx', formats: ['iife'], name: '__keszletModul', fileName: () => 'modul.js', cssFileName: 'modul' },
    rollupOptions: { external: Object.keys(kozos), output: { globals: kozos } },
  },
})
