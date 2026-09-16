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
    rolldownOptions: {
      output: {
        /* Several lazy surfaces share these libraries. Naming them keeps one
           cached copy instead of a duplicate inside every chunk that imports
           them, and keeps a Three.js (or React) upgrade from invalidating app
           code. `codeSplitting.groups` is rolldown's replacement for
           `manualChunks`; a library only lands in its group when something
           actually imports it, so a chunk never ships empty. */
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'katex', test: /node_modules[\\/]katex[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/ },
          ],
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