/* Browser-check config (pairs with scripts/*-check.mjs runs that need an
 * isolated stack): same app on :5199 against a private backend on :8721, so
 * the shared dev servers on 5173/8720 stay untouched. */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = 'http://127.0.0.1:8721'

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5199,
    strictPort: true,
    proxy: {
      '/api': { target: API, ws: true },
      '/learning/game.html': API,
      '/locales': API,
      '/shared': API,
      '/landing': API,
      '/campaign': API
    }
  }
})
