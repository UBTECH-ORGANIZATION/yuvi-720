/* The pointer model's trust ladder: a pixel rect interpolated from the two
 * capture widths nearest the live box; a below-the-fold target on a screen
 * whose content overflows the live box becomes the edge chevron; everything
 * less trustworthy is a whole-frame glow; no iframe (tab playback) or no
 * pointer draws nothing. Wrong geometry is worse than none. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { presentPointer, pointerMatchesKey } from '../src/services/pointer.ts'
import type { CoachPointerFrame } from '../src/services/agents.ts'

// A target that scales-and-centers the way the CET player does: at 1024 the
// rect sits at x=100, at 1280 at x=150 (content scaled + margins grown), and
// the geometry is height-INDEPENDENT — both height samples per width are
// identical, so the height axis interpolates to a no-op.
const cet = (w: number, h: number, rect: { x: number; y: number; w: number; h: number },
  content_h: number) => ({ w, h, content_w: w, content_h, rect })
const POINTER: CoachPointerFrame = {
  region: 'question',
  breakpoints: [
    cet(1024, 640, { x: 100, y: 120, w: 400, h: 90 }, 700),
    cet(1024, 860, { x: 100, y: 120, w: 400, h: 90 }, 700),
    cet(1280, 640, { x: 150, y: 150, w: 500, h: 112 }, 840),
    cet(1280, 860, { x: 150, y: 150, w: 500, h: 112 }, 840),
  ],
  question_key: 'comp-1|comp-1-001|q1',
}

test('a live width AT a sampled breakpoint renders its exact pixels', () => {
  const out = presentPointer(POINTER, 'frame', 1024, 760)
  assert.equal(out.mode, 'rect')
  assert.deepEqual(out.mode === 'rect' && out.rect, { x: 100, y: 120, w: 400, h: 90 })
})

test('a width between breakpoints interpolates linearly', () => {
  const out = presentPointer(POINTER, 'frame', 1152, 900)
  assert.equal(out.mode, 'rect')
  assert.deepEqual(out.mode === 'rect' && out.rect, { x: 125, y: 135, w: 450, h: 101 })
})

test('a width just past the sampled range extrapolates', () => {
  // 1408 = 1280 + one 128 half-step: the centered layout keeps shifting
  // linearly, and 10% past the range is within honesty.
  const out = presentPointer(POINTER, 'frame', 1408, 1000)
  assert.equal(out.mode, 'rect')
  assert.deepEqual(out.mode === 'rect' && out.rect, { x: 175, y: 165, w: 550, h: 123 })
})

test('a width far outside the sampled range degrades to the glow', () => {
  assert.equal(presentPointer(POINTER, 'frame', 2000, 900).mode, 'glow')
  assert.equal(presentPointer(POINTER, 'frame', 640, 640).mode, 'glow')
})

test('content overflowing the live box hides the rect honestly', () => {
  // content_h at 1280 is 840; a 500px-tall box scrolls internally. The
  // target's top (150) is above the fold — the learner may have scrolled it
  // away, so the whole-frame glow is as precise as truth allows.
  assert.equal(presentPointer(POINTER, 'frame', 1280, 500).mode, 'glow')
})

test('a below-the-fold target becomes the edge chevron near its column', () => {
  const low: CoachPointerFrame = {
    ...POINTER,
    breakpoints: [
      cet(1280, 640, { x: 540, y: 1200, w: 200, h: 80 }, 1600),
      cet(1280, 860, { x: 540, y: 1200, w: 200, h: 80 }, 1600),
    ],
  }
  const out = presentPointer(low, 'frame', 1280, 700)
  assert.equal(out.mode, 'edge')
  assert.equal(out.mode === 'edge' && out.x, 0.5)
})

test('a viewport-fitting screen reads geometry from the box HEIGHT', () => {
  // The methodica law: content is always exactly viewport-tall, and the
  // target scales with the height. At box height 750 the y interpolates
  // between the 640 and 860 samples — and contentH == boxH, so the rect
  // renders even in a short box instead of degrading to glow.
  const fit: CoachPointerFrame = {
    ...POINTER,
    breakpoints: [
      { w: 1280, h: 640, content_w: 1280, content_h: 640,
        rect: { x: 40, y: 220, w: 260, h: 260 } },
      { w: 1280, h: 860, content_w: 1280, content_h: 860,
        rect: { x: 49, y: 334, w: 362, h: 362 } },
    ],
  }
  const out = presentPointer(fit, 'frame', 1280, 750)
  assert.equal(out.mode, 'rect')
  assert.deepEqual(out.mode === 'rect' && out.rect, { x: 44.5, y: 277, w: 311, h: 311 })
  // Far outside the sampled heights, a height-responsive screen glows.
  assert.equal(presentPointer(fit, 'frame', 1280, 1200).mode, 'glow')
})

test('a lone grid point serves only very near its width', () => {
  const lone: CoachPointerFrame = {
    ...POINTER, breakpoints: [POINTER.breakpoints[3]],
  }
  assert.equal(presentPointer(lone, 'frame', 1280, 900).mode, 'rect')
  const scaled = presentPointer(lone, 'frame', 1330, 900)
  assert.equal(scaled.mode, 'rect') // ~4% off, uniformly scaled
  assert.equal(presentPointer(lone, 'frame', 1500, 900).mode, 'glow')
})

test('a region-less pointer is the glow by design', () => {
  const out = presentPointer(
    { ...POINTER, region: null, breakpoints: [] }, 'frame', 1024, 760)
  assert.equal(out.mode, 'glow')
})

test('a too-small box degrades to the glow', () => {
  assert.equal(presentPointer(POINTER, 'frame', 380, 600).mode, 'glow')
  assert.equal(presentPointer(POINTER, 'frame', 1024, 300).mode, 'glow')
})

test('tab playback and no pointer render nothing', () => {
  assert.equal(presentPointer(POINTER, 'tab', 1024, 760).mode, 'none')
  assert.equal(presentPointer(null, 'frame', 1024, 760).mode, 'none')
})

test('degenerate breakpoints glow instead of guessing', () => {
  const flat: CoachPointerFrame = {
    ...POINTER,
    breakpoints: [cet(1280, 860, { x: 100, y: 100, w: 0, h: 50 }, 840)],
  }
  assert.equal(presentPointer(flat, 'frame', 1280, 900).mode, 'glow')
})

test('screen identity is component+item — the push key can be partial', () => {
  assert.ok(pointerMatchesKey('c|i|q1', 'c|i|q2'))
  assert.ok(pointerMatchesKey('c|i|', 'c|i|q1'))
  assert.ok(!pointerMatchesKey('c|i|q1', 'c|other|q1'))
  assert.ok(!pointerMatchesKey('c|i|q1', 'other|i|q1'))
  assert.ok(pointerMatchesKey('c|i|q1', null))
})

test('an empty segment is a wildcard, not a contradiction', () => {
  // The assumed-screen pointer vs a player that never reported an item:
  // the current key is `component||` and must not veto the overlay.
  assert.ok(pointerMatchesKey('c|i-00001|', 'c||'))
  assert.ok(pointerMatchesKey('c||', 'c|i|q1'))
  assert.ok(!pointerMatchesKey('c|i|', 'other||'))
})
