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
    emptyOutDir: true,
    rollupOptions: {
      output: {
        /* Several lazy surfaces share these libraries. Naming them keeps one
           cached copy instead of a duplicate inside every chunk that imports
           them, and keeps a Three.js upgrade from invalidating app code. */
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('node_modules/katex/')) return 'katex'
          return undefined
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // ws so the support chat socket upgrades through the dev server.
      '/api': { target: 'http://127.0.0.1:8720', ws: true },
      '/learning/game.html': 'http://127.0.0.1:8720',
      '/locales': 'http://127.0.0.1:8720',
      '/shared': 'http://127.0.0.1:8720',
      // The 720 campaign landing page is served by FastAPI, not the SPA.
      '/landing': 'http://127.0.0.1:8720',
      '/campaign': 'http://127.0.0.1:8720'
    }
  }
})