import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5198,
    proxy: {
      // ws so the support chat socket upgrades through the dev server.
      '/api': { target: 'http://localhost:9998', ws: true },
      '/auth': 'http://localhost:9998',
    },
  },
})
