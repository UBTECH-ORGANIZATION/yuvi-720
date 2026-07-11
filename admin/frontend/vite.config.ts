import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5198,
    proxy: {
      '/api': 'http://localhost:9998',
      '/auth': 'http://localhost:9998',
    },
  },
})
