/* The studio design and the profile picture are two fields, and stay two.
 *
 * They were one (`learner_state.avatar`), and the server fills an unset `avatar`
 * with the learner's best earned coin — so every saved robot was overwritten on
 * the next read, and every save wiped whichever coin the learner had chosen as
 * their picture. Nothing in a type checker catches that: both sides typed the
 * field `unknown`. A grep does.
 */

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
    'the studio writes `avatar` again — that field is the profile picture, and the server derives a coin over it'
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

test('the state DTO carries both fields, so neither can be typed away', () => {
  const api = read('services/api.ts')
  assert.match(api, /avatar\?: unknown/)
  assert.match(api, /yuvi_design\?: unknown/)
})

test('the profile picture is a badge or a letter, and nothing else', () => {
  // The `{kind:'yuvi'}` variant was never written and never rendered; keeping it
  // invites somebody to store a robot in the picture field a second time.
  const types = read('features/badges/types.ts')
  assert.ok(!types.includes("kind: 'yuvi'"), "AvatarChoice must not offer a 'yuvi' variant")

  const profile = read('features/badges/ProfileAvatar.tsx')
  assert.ok(!profile.includes("kind === 'yuvi'"), 'ProfileAvatar must not coerce a design into a choice')
})
