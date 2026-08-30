/* The studio on a school tablet.
 *
 * Every verb in the room was a mouse verb. The prop menu was `contextmenu`
 * only — which iOS Safari does not fire on a canvas at all — so "move this
 * sofa" simply did not exist on touch. Zoom was the wheel, panning was a
 * right-drag, walking was the arrow keys. And with no `touch-action` the
 * browser treated a drag as a scroll and cancelled the gesture mid-way,
 * without anyone listening for `pointercancel` to clean up after it.
 *
 * Worst of it landed on the walkthrough: step one asks the child to tap a lit
 * patch of floor, and the tap test allowed six pixels of travel — less than a
 * finger wobbles. A learner could be stuck on the first instruction.
 *
 * WebGL and pointer gestures cannot run here, so this pins the shape of the
 * fix; the gestures themselves are checked by hand on a touch device.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

const avatar = read('frontend/src/features/Yuvi-studio/YuviAvatar3D.tsx')
const studio = read('frontend/src/features/Yuvi-studio/StudioContent.tsx')
const css = read('frontend/src/styles/Yuvi-studio.css')
const he = JSON.parse(read('locales/he.json')) as Record<string, string>

test('only the studio takes the browser gestures away', () => {
  // The same component draws the floating companion inside scrollable pages.
  // A blanket `touch-action: none` would trap the page under a small robot.
  assert.match(avatar, /if \(orbit\) \{[\s\S]{0,300}touchAction = 'none'/)
})

test('press and hold is the finger right-click', () => {
  assert.match(avatar, /holdTimer = window\.setTimeout/)
  // Both routes must open the same menu, or the two drift apart.
  assert.match(avatar, /openMenuAt\(pressX, pressY\)/)
  assert.match(avatar, /openMenuAt\(event\.clientX, event\.clientY\)/)
  // A hold that became a drag is not a hold.
  assert.match(avatar, /if \(holdTimer && Math\.hypot[\s\S]{0,80}cancelHold\(\)/)
})

test('two fingers zoom and pan', () => {
  assert.match(avatar, /livePointers\.size === 2/)
  assert.match(avatar, /userZoom = THREE\.MathUtils\.clamp\(userZoom \* \(pinchDistance/)
  assert.match(avatar, /userPanX = THREE\.MathUtils\.clamp\(userPanX - \(centre\.x/)
})

test('a cancelled gesture does not strand the drag', () => {
  assert.match(avatar, /addEventListener\('pointercancel', onPointerCancel\)/)
  assert.match(avatar, /removeEventListener\('pointercancel', onPointerCancel\)/)
})

test('the tap test allows for a finger, not a mouse', () => {
  assert.match(avatar, /TAP_SLOP_TOUCH = 1\d/)
  assert.match(avatar, /travelled > tapSlop/)
})

test('a gesture that became something else does not also walk Yuvi', () => {
  // Pinching or holding used to end in a `pointerup` that read as a tap.
  assert.match(avatar, /if \(consumed \|\| !wasOrbit/)
})

test('the hints stop describing a mouse nobody has', () => {
  assert.match(studio, /const hint = \(key: string\) => t\(isTouch \? `\$\{key\}\.touch` : key\)/)
  for (const key of [
    'YuviStudio.hint', 'YuviStudio.roam.hint',
    'YuviStudio.room.menuHint', 'YuviStudio.tut.turn.tip',
  ]) {
    assert.ok(he[`${key}.touch`], `${key}.touch is missing from the source locale`)
    assert.ok(!/ימנית|בחצים|לגלגל/.test(he[`${key}.touch`]), `${key}.touch still names a mouse`)
  }
})

test('first person is not offered where it cannot be driven', () => {
  // In first person the floor tap is deliberately dead and the arrow keys are
  // the only way to move, so on a tablet the button is a room with no exit.
  assert.match(studio, /mode === 'roam' && !tutorial && !isTouch/)
})

test('the prop menu rows are finger-sized on touch', () => {
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.ys-propmenu__item \{ min-block-size: 44px; \}/)
})
