import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { WORLD_HOLOGRAM_FRAME, WORLD_HOLOGRAM_FRAMES, WORLD_HOLOGRAM_IDS } from '../src/features/Yuvi-studio/worldHologramStrips.ts'

/* The Room panel's world picker shows pre-rendered sprite strips
   (`worldHologramStrips.ts`), baked by `scripts/render-world-holograms.mjs`
   on a developer machine. This is the reminder to run it: a world without a
   strip, or a strip baked for another frame geometry than the code steps
   through, fails here and names the script. */

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')
const OUT = join(SRC, 'assets/world-holograms')
const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) as {
  frames: number; width: number; height: number; worlds: string[]
}

const webpSize = (file: string) => {
  const bytes = readFileSync(file)
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF', `${file} is not RIFF`)
  assert.equal(bytes.subarray(8, 12).toString('latin1'), 'WEBP', `${file} is not WebP`)
  // VP8X (extended) header: canvas size minus one, 24 bits each.
  assert.equal(bytes.subarray(12, 16).toString('latin1'), 'VP8X', `${file}: expected an extended WebP (alpha)`)
  const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
  const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
  return { width, height }
}

test('every world has a baked strip of the frame geometry the picker steps through', () => {
  assert.deepEqual([...manifest.worlds].sort(), [...WORLD_HOLOGRAM_IDS].sort())
  assert.equal(manifest.frames, WORLD_HOLOGRAM_FRAMES, 'manifest frames ≠ WORLD_HOLOGRAM_FRAMES — run: node scripts/render-world-holograms.mjs')
  assert.equal(manifest.width, WORLD_HOLOGRAM_FRAME.width)
  assert.equal(manifest.height, WORLD_HOLOGRAM_FRAME.height)
  for (const id of WORLD_HOLOGRAM_IDS) {
    const file = join(OUT, `${id}.webp`)
    assert.ok(statSync(file).size > 0, `no strip for ${id} — run: node scripts/render-world-holograms.mjs`)
    assert.deepEqual(webpSize(file), { width: WORLD_HOLOGRAM_FRAME.width, height: WORLD_HOLOGRAM_FRAME.height * WORLD_HOLOGRAM_FRAMES }, `${id}.webp`)
  }
  for (const still of ['pad', 'lock']) {
    assert.deepEqual(webpSize(join(OUT, `${still}.webp`)), { width: WORLD_HOLOGRAM_FRAME.width, height: WORLD_HOLOGRAM_FRAME.height }, `${still}.webp`)
  }
})

test('no strip ships for a world that left the picker', () => {
  const files = readdirSync(OUT).filter((name) => name.endsWith('.webp')).map((name) => name.slice(0, -'.webp'.length))
  const known = new Set([...WORLD_HOLOGRAM_IDS, 'pad', 'lock'])
  assert.deepEqual(files.filter((name) => !known.has(name)), [])
})

test('the four strips together weigh about what a screen of catalogue cards does', () => {
  const bytes = readdirSync(OUT).filter((name) => name.endsWith('.webp')).reduce((sum, name) => sum + statSync(join(OUT, name)).size, 0)
  assert.ok(bytes <= 520 * 1024, `world holograms weigh ${(bytes / 1024).toFixed(0)} KB; lower --quality or the frame count`)
})

test('the picker opens no WebGL context; the three.js builders serve the bake script only', () => {
  const picker = readFileSync(join(SRC, 'features/Yuvi-studio/HolographicWorldSelector.tsx'), 'utf8')
  assert.doesNotMatch(picker, /from 'three'|new THREE\.|requestAnimationFrame\(|<canvas/)
  const strips = readFileSync(join(SRC, 'features/Yuvi-studio/worldHologramStrips.ts'), 'utf8')
  assert.doesNotMatch(strips, /from 'three'/)
  // Nothing under src imports the builders: they would drag their geometry
  // into the studio chunk for a picture that is already a file.
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [])
  const importers = walk(SRC).filter((file) => /from '\.\.?\/(?:[\w-]+\/)*worldHolograms'/.test(readFileSync(file, 'utf8')))
  assert.deepEqual(importers, [])
  const page = readFileSync(join(ROOT, 'scripts/world-holograms/page.ts'), 'utf8')
  assert.match(page, /worldHolograms'/)
  assert.match(page, /poseWorldFrame\(world, frame, WORLD_HOLOGRAM_FRAMES\)/)
})
