import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const learnerMappingReloadPaths = [
  '/src/features/learner-mapping/',
  '/src/styles/learner-mapping.css'
]

function learnerMappingFullReload() {
  return {
    name: 'learner-mapping-full-reload',
    handleHotUpdate({ file, server }: { file: string; server: { ws: { send: (event: { type: string; path: string }) => void } } }) {
      const normalizedFile = file.replaceAll('\\', '/')
      if (!learnerMappingReloadPaths.some((path) => normalizedFile.includes(path))) return
      server.ws.send({ type: 'full-reload', path: '*' })
      return []
    }
  }
}

export default defineConfig({
  base: '/',
  plugins: [react(), learnerMappingFullReload()],
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