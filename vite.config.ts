import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the built output also works loaded straight
  // from a local file:// path (the desktop/Electron build), not just from
  // a web server root.
  base: './',
  plugins: [react(), tailwindcss()],
  // Az integrációs szolgáltatás (integracio/) és az asztali program (electron/) saját csomag, saját tesztekkel.
  test: { exclude: [...configDefaults.exclude, 'integracio/**', 'electron/**'] },
})
