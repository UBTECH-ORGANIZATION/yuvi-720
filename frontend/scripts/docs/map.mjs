/* The docs map, resolved from disk, with the paths every docs script needs.
   One loader so `capture.mjs`, `build-pdf.mjs` and `plan.mjs` can never drift
   on where the guide lives or what order its chapters are in. */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const REPO_ROOT = resolve(here, '../../..')
export const GUIDE_DIR = resolve(REPO_ROOT, 'docs/guide')
export const CHAPTERS_DIR = resolve(GUIDE_DIR, 'chapters')
export const SHOTS_DIR = resolve(GUIDE_DIR, 'screenshots')
export const MAP_PATH = resolve(GUIDE_DIR, 'docs-map.json')

export function loadMap() {
  const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'))
  map.chapters.sort((a, b) => a.order - b.order)
  return map
}

/** Chapters named on the command line, or all of them. Unknown ids are fatal —
    a typo in a workflow input must not silently capture nothing. */
export function selectChapters(map, ids) {
  if (!ids || ids.length === 0) return map.chapters
  const known = new Map(map.chapters.map((c) => [c.id, c]))
  const missing = ids.filter((id) => !known.has(id))
  if (missing.length) {
    throw new Error(`Unknown chapter id(s): ${missing.join(', ')}. Known: ${[...known.keys()].join(', ')}`)
  }
  return map.chapters.filter((c) => ids.includes(c.id)).sort((a, b) => a.order - b.order)
}

/** `--flag=value` / `--flag` parsing, the same shape the other scripts here use. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {}
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const [key, ...rest] = arg.slice(2).split('=')
    out[key] = rest.length ? rest.join('=') : true
  }
  return out
}

export function csv(value) {
  if (!value || value === true) return []
  return String(value).split(',').map((s) => s.trim()).filter(Boolean)
}
