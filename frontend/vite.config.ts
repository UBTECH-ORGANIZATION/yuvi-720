import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: '../static/react',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8720',
      '/learning/game.html': 'http://127.0.0.1:8720',
      '/locales': 'http://127.0.0.1:8720',
      '/shared': 'http://127.0.0.1:8720'
    }
  }
})