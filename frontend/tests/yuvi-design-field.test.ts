/* The Studio design has one dedicated field and never falls back to the retired
 * profile-avatar field. A grep protects that persistence boundary. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

// `new URL(...).pathname` leaves the drive letter behind a slash and the spaces
// percent-encoded, which no Windows checkout can open.
const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

test('the studio saves the design to its own field', () => {
  const studio = read('features/Yuvi-studio/useStudioDesign.ts')
  assert.match(studio, /updateLearnerState\(\{ yuvi_design: design \}\)/)
  assert.ok(
    !/updateLearnerState\(\{ avatar:/.test(studio),
    'the studio writes the retired `avatar` field again'
  )
})

test('every Yuvi in the app reads the design from that same field', () => {
  const provider = read('features/Yuvi-studio/YuviDesignProvider.tsx')
  assert.match(provider, /normalizeDesign\(state\.yuvi_design\)/)
})

test('legacy Yuvi-Girl designs fall back to the classic variant', () => {
  const design = read('features/Yuvi-studio/YuviDesign.ts')
  assert.match(design, /export type YuviVariant = 'classic'/)
  assert.doesNotMatch(design, /record\.variant === 'girl'/)
})

test('the state DTO carries the Studio design without the retired avatar field', () => {
  const api = read('services/api.ts')
  assert.match(api, /yuvi_design\?: unknown/)
  assert.doesNotMatch(api, /avatar\?: unknown/)
})
