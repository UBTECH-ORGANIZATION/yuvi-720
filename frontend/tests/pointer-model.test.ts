/* The pointer model's trust ladder: precise rect only when the capture says
 * no-internal-scroll AND the runtime box is big enough AND there is an iframe;
 * everything less trustworthy is a whole-frame glow; no iframe (tab playback)
 * or no pointer draws nothing. Wrong geometry is worse than none. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { presentPointer, pointerMatchesKey } from '../src/services/pointer.ts'
import type { CoachPointerFrame } from '../src/services/agents.ts'

const POINTER: CoachPointerFrame = {
  region: 'question',
  rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 },
  no_scroll: true,
  capture_viewport: { w: 1280, h: 860 },
  question_key: 'comp-1|comp-1-001|q1',
}

test('a trusted pointer renders its rect', () => {
  const out = presentPointer(POINTER, 'frame', 900, 600)
  assert.equal(out.mode, 'rect')
  assert.deepEqual(out.mode === 'rect' && out.rect, POINTER.rect)
})

test('a scrolling capture degrades to the glow', () => {
  const out = presentPointer({ ...POINTER, no_scroll: false }, 'frame', 900, 600)
  assert.equal(out.mode, 'glow')
})

test('a below-the-fold target on a scrolly screen becomes the edge chevron', () => {
  const scrolly = {
    ...POINTER,
    no_scroll: false,
    capture_viewport: { w: 1280, h: 860, scroll_w: 1280, scroll_h: 2000 },
    rect: { x: 0.3, y: 0.7, w: 0.4, h: 0.1 },
  }
  const out = presentPointer(scrolly, 'frame', 900, 600)
  assert.equal(out.mode, 'edge')
  assert.equal(out.mode === 'edge' && out.x, 0.5)
  // A target within the first viewport of the same screen: position unknown
  // (the learner may have scrolled) — glow, not a wrong rect.
  const topTarget = { ...scrolly, rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 } }
  assert.equal(presentPointer(topTarget, 'frame', 900, 600).mode, 'glow')
})

test('a rect-less pointer is the glow by design', () => {
  const out = presentPointer(
    { ...POINTER, region: null, rect: null }, 'frame', 900, 600)
  assert.equal(out.mode, 'glow')
})

test('a too-small box degrades to the glow', () => {
  assert.equal(presentPointer(POINTER, 'frame', 380, 600).mode, 'glow')
  assert.equal(presentPointer(POINTER, 'frame', 900, 300).mode, 'glow')
})

test('an aspect too far from the capture degrades to the glow', () => {
  // capture 1280×860 ≈ 1.49 — a phone-shaped 560×620 box (≈0.9) reflows the
  // content; fractions no longer land on the same things.
  const out = presentPointer(POINTER, 'frame', 560, 620)
  assert.equal(out.mode, 'glow')
  // A mild drift (desktop lesson area) still renders precisely.
  assert.equal(presentPointer(POINTER, 'frame', 970, 560).mode, 'rect')
})

test('tab playback and no pointer render nothing', () => {
  assert.equal(presentPointer(POINTER, 'tab', 900, 600).mode, 'none')
  assert.equal(presentPointer(null, 'frame', 900, 600).mode, 'none')
})

test('fractions are clamped and degenerate rects glow', () => {
  const wild = { ...POINTER, rect: { x: -0.5, y: 0.2, w: 2, h: 0.1 } }
  const out = presentPointer(wild, 'frame', 900, 600)
  assert.equal(out.mode, 'rect')
  assert.deepEqual(out.mode === 'rect' && out.rect, { x: 0, y: 0.2, w: 1, h: 0.1 })
  const flat = { ...POINTER, rect: { x: 0.1, y: 0.2, w: 0, h: 0.1 } }
  assert.equal(presentPointer(flat, 'frame', 900, 600).mode, 'glow')
})

test('screen identity is component+item — the push key can be partial', () => {
  assert.ok(pointerMatchesKey('c|i|q1', 'c|i|q2'))
  assert.ok(pointerMatchesKey('c|i|', 'c|i|q1'))
  assert.ok(!pointerMatchesKey('c|i|q1', 'c|other|q1'))
  assert.ok(!pointerMatchesKey('c|i|q1', 'other|i|q1'))
  assert.ok(pointerMatchesKey('c|i|q1', null))
})

test('an empty segment is a wildcard, not a contradiction', () => {
  // The assumed-first-screen pointer vs a player that never reported an item:
  // the current key is `component||` and must not veto the overlay.
  assert.ok(pointerMatchesKey('c|i-00001|', 'c||'))
  assert.ok(pointerMatchesKey('c||', 'c|i|q1'))
  assert.ok(!pointerMatchesKey('c|i|', 'other||'))
})
