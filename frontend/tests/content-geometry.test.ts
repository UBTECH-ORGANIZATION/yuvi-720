/* The walker's pure geometry (scripts/lib/content-geometry.mjs): nesting,
 * reading order, and the layout classes the pointer and the tall-frame
 * experiment both depend on. */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyLayout, gridRows, outermost, sameRect, unionBoxes,
} from '../scripts/lib/content-geometry.mjs'

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })
const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })

test('an option row, its label and its text span are one thing', () => {
  const row = box(600, 400, 1200, 456)
  const label = box(610, 405, 1190, 450)
  const span = box(900, 415, 1180, 440)
  const other = box(600, 470, 1200, 526)
  const kept = outermost([span, other, label, row])
  assert.deepEqual(kept, [row, other])
})

test('the union spans every box, skipping gaps', () => {
  assert.deepEqual(unionBoxes([box(10, 10, 20, 20), null, box(5, 30, 15, 40)]), box(5, 10, 20, 40))
  assert.equal(unionBoxes([]), null)
})

test('sameRect tolerates sub-pixel jitter only', () => {
  assert.ok(sameRect(rect(10, 10, 100, 50), rect(11.5, 9, 101, 51)))
  assert.ok(!sameRect(rect(10, 10, 100, 50), rect(14, 10, 100, 50)))
  assert.ok(sameRect(null, null))
  assert.ok(!sameRect(rect(1, 1, 1, 1), null))
})

test('a CET-like screen whose geometry ignores the height is height-independent', () => {
  const rects = { 1: rect(100, 900, 400, 60) }
  const layout = classifyLayout([
    { w: 1024, h: 480, content_w: 1024, content_h: 1210, rects },
    { w: 1024, h: 860, content_w: 1024, content_h: 1210, rects },
    { w: 1440, h: 480, content_w: 1440, content_h: 1003, rects },
    { w: 1440, h: 860, content_w: 1440, content_h: 1003, rects },
  ])
  assert.equal(layout.kind, 'height_independent')
  assert.deepEqual(layout.natural_h, [[1024, 1210], [1440, 1003]])
})

test('a methodica-like screen that scales into the viewport fits it', () => {
  const layout = classifyLayout([
    { w: 1280, h: 480, content_w: 1280, content_h: 480, rects: { 1: rect(400, 200, 300, 100) } },
    { w: 1280, h: 860, content_w: 1280, content_h: 785, rects: { 1: rect(600, 350, 540, 180) } },
  ])
  assert.equal(layout.kind, 'fit_viewport')
  assert.equal(layout.natural_h, null)
})

test('a screen that overflows and reflows with the height is height-dependent', () => {
  const layout = classifyLayout([
    { w: 1280, h: 640, content_w: 1280, content_h: 1500, rects: { 1: rect(0, 900, 10, 10) } },
    { w: 1280, h: 860, content_w: 1280, content_h: 1700, rects: { 1: rect(0, 1100, 10, 10) } },
  ])
  assert.equal(layout.kind, 'height_dependent')
})

test('grid rows keep one height per width for height-independent screens', () => {
  const samples = [
    { w: 1280, h: 480, content_w: 1280, content_h: 1003 },
    { w: 1280, h: 860, content_w: 1280, content_h: 1003 },
    { w: 820, h: 640, content_w: 820, content_h: 1402 },
  ]
  assert.deepEqual(gridRows(samples, 'height_independent'), [[820, 640, 820, 1402], [1280, 860, 1280, 1003]])
  assert.equal(gridRows(samples, 'fit_viewport').length, 3)
})
