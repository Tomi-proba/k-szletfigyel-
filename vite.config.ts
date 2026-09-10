import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the built output also works loaded straight
  // from a local file:// path (the desktop/Electron build), not just from
  // a web server root.
  base: './',
  plugins: [react(), tailwindcss()],
})
