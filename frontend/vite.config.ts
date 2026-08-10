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

// The dev backend usually owns 8720, but another project can be sitting on it —
// point the whole proxy elsewhere with `VITE_BACKEND=http://127.0.0.1:8722`.
const backend = process.env.VITE_BACKEND || 'http://127.0.0.1:8720'

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
      // ws so the support chat socket upgrades through the dev server.
      '/api': { target: backend, ws: true },
      '/learning/game.html': backend,
      '/locales': backend,
      '/shared': backend,
      // Our own lomda player and its assets are served by FastAPI, not the SPA.
      '/content': backend,
      // The 720 campaign landing page is served by FastAPI, not the SPA.
      '/landing': backend,
      '/campaign': backend
    }
  }
})