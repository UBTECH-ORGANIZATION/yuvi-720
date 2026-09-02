/* A borrowed item comes off when the shop closes.
 *
 * Tapping a locked item puts it straight on Yuvi and opens a context bar with
 * its price, Buy and Cancel. Nothing used to take it off again: step off the
 * station and the context bar went with the panel, leaving Yuvi wearing
 * something he does not own, with no way to buy it and no way to cancel it —
 * over a footer reporting "all saved", which was true and useless, because the
 * design really had not changed.
 *
 * The studio component is `@ts-nocheck` and needs WebGL, so this pins the shape
 * of the fix; the behaviour itself is checked by hand.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const studio = readFileSync(join(SRC, 'features/Yuvi-studio/StudioContent.tsx'), 'utf8')

test('leaving the avatar station takes the previewed item off', () => {
  // Tied to the panel being open, not to the events that close it — otherwise
  // the next way out of a station is the next way to leak a hat.
  assert.match(studio, /if \(mode !== 'avatar'\) clearPreview\(\)/)
  assert.match(studio, /clearPreview\(\)\s*\n\s*\}, \[mode\]\)/)
})

test('the preview still puts the real item back, not a default', () => {
  // `clearPreview` restores whatever the learner owns in that slot. Swapping it
  // for a bare `setPreview(null)` would leave the borrowed item on the model.
  assert.match(studio, /equip\(worn\.slot, design\.equipped\[worn\.slot\] \?\? null, true\)/)
})

test('trying on is still a thing you can do', () => {
  // The fix must not become "locked items are no longer previewable".
  assert.match(studio, /setPreview\(asset\)/)
  assert.match(studio, /YuviStudio\.preview\.buy/)
  assert.match(studio, /YuviStudio\.preview\.cancel/)
})
