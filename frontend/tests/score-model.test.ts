import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CONCENTRATION_SUBSCORES, INDEPENDENCE_SUBSCORES, deltaFromTrend, scoreTone,
} from '../src/features/teacher-app/student/scoreModel.ts'

test('the server trend renders as-is — the client never invents a comparison', () => {
  assert.deepEqual(
    deltaFromTrend({ direction: 'up', deltaPoints: 12.4 }),
    { value: 12, unit: 'points', direction: 'up', previous: 0 })
  // No honest comparison → no chip, never a flat arrow that reads "unchanged".
  assert.equal(deltaFromTrend({ direction: null, deltaPoints: null }), null)
  assert.equal(deltaFromTrend({ direction: 'up', deltaPoints: null }), null)
  assert.equal(deltaFromTrend(null), null)
  assert.equal(deltaFromTrend(undefined), null)
})

test('a flat trend still shows — flat is a finding, absent is not', () => {
  assert.deepEqual(
    deltaFromTrend({ direction: 'flat', deltaPoints: 0.5 }),
    { value: 1, unit: 'points', direction: 'flat', previous: 0 })
})

test('tones follow the thresholds the old dials used', () => {
  assert.equal(scoreTone(85), 'success')
  assert.equal(scoreTone(70), 'success')
  assert.equal(scoreTone(69), 'warn')
  assert.equal(scoreTone(40), 'warn')
  assert.equal(scoreTone(39), 'danger')
  assert.equal(scoreTone(null), 'primary')
})

test('the sub-score key lists match the server contract', () => {
  assert.equal(INDEPENDENCE_SUBSCORES.length, 6)
  assert.equal(CONCENTRATION_SUBSCORES.length, 5)
  assert.ok(INDEPENDENCE_SUBSCORES.includes('tried_before_asking'))
  assert.ok(CONCENTRATION_SUBSCORES.includes('on_task_share'))
})

