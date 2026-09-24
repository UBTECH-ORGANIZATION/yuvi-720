/* The tall-frame experiment's arithmetic: only height-independent screens,
 * only inside the sampled widths, only when the content does not already fit. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { itemOfKey, mayAutoScroll, scrollTargetFor, tallCanvasHeight } from '../src/services/tallFrame.ts'

const CET = { kind: 'height_independent' as const, natural_h: [[1024, 1210], [1440, 1003]] as [number, number][] }

test('a height-independent screen gets its natural height, interpolated by width', () => {
  assert.equal(tallCanvasHeight(CET, 1024, 700), 1210)
  assert.equal(tallCanvasHeight(CET, 1232, 700), 1107)
})

test('other layouts, unknown widths and content that fits keep the normal frame', () => {
  assert.equal(tallCanvasHeight({ kind: 'fit_viewport', natural_h: null }, 1024, 700), null)
  assert.equal(tallCanvasHeight(CET, 600, 700), null)
  assert.equal(tallCanvasHeight(CET, 1024, 1300), null)
  assert.equal(tallCanvasHeight(null, 1024, 700), null)
  assert.equal(tallCanvasHeight({ kind: 'height_independent', natural_h: [[1280, 1500]] }, 1400, 700), null)
})

test('a mark already in view does not move the page', () => {
  assert.equal(scrollTargetFor({ y: 100, h: 50 }, 0, 700), null)
  assert.equal(scrollTargetFor({ y: 900, h: 60 }, 0, 700), 852)
  assert.equal(scrollTargetFor({ y: 20, h: 60 }, 300, 700), 0)
})

test('the learner\'s own scroll wins for a moment', () => {
  assert.equal(mayAutoScroll(10_000, 10_500), false)
  assert.equal(mayAutoScroll(10_000, 12_000), true)
  assert.equal(itemOfKey('c|i-2|q1'), 'i-2')
  assert.equal(itemOfKey(null), '')
})
