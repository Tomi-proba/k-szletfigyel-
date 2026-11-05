import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/** A keret közös csomagjai a kozos-keret/ másolatból (AWEBOLDAL TERV.md F24 KS1); a keret-csomagban külső. */
export const kozosAlias = {
  '@aweboldal/felulet/felulet.css': fileURLToPath(new URL('./kozos-keret/felulet/src/felulet.css', import.meta.url)),
  '@aweboldal/felulet': fileURLToPath(new URL('./kozos-keret/felulet/src/index.ts', import.meta.url)),
  '@aweboldal/modulok': fileURLToPath(new URL('./kozos-keret/modulok/src/index.ts', import.meta.url)),
  '@aweboldal/arak': fileURLToPath(new URL('./kozos-keret/arak/src/index.ts', import.meta.url)),
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the built output also works loaded straight
  // from a local file:// path (the desktop/Electron build), not just from
  // a web server root.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: kozosAlias },
  // Az integrációs szolgáltatás (integracio/) és az asztali program (electron/) saját csomag, saját tesztekkel.
  test: { exclude: [...configDefaults.exclude, 'integracio/**', 'electron/**'] },
})
