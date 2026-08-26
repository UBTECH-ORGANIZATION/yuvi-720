import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_PERIOD, PERIODS, delta, isPeriodId, periodDays, periodIdForDays,
  topicShift,
} from '../src/features/teacher-app/shared/periodModel.ts'

test('the four periods are ordered short to long and the default is the old behaviour', () => {
  assert.deepEqual(PERIODS.map((row) => row.id), ['day', '3day', 'week', 'month'])
  const days = PERIODS.map((row) => row.days)
  assert.deepEqual(days, [...days].sort((a, b) => a - b))
  // A teacher who never touches the control must see what they saw before it
  // existed — every one of these numbers was a 7-day window.
  assert.equal(periodDays(DEFAULT_PERIOD), 7)
})

test('a stored period is validated rather than trusted', () => {
  assert.ok(isPeriodId('month'))
  for (const bad of ['year', '', null, undefined, 7, {}]) {
    assert.equal(isPeriodId(bad), false)
  }
})

test('days map back to a period so the book can name the stretch it covers', () => {
  for (const row of PERIODS) assert.equal(periodIdForDays(row.days), row.id)
  // An unrecognised length still reads as something rather than crashing the copy.
  assert.equal(periodIdForDays(8), 'week')
  assert.equal(periodIdForDays(1000), 'month')
})

test('a delta is a signed whole percent with its direction', () => {
  assert.deepEqual(delta(60, 50), { pct: 20, direction: 'up' })
  assert.deepEqual(delta(40, 50), { pct: -20, direction: 'down' })
  assert.deepEqual(delta(50, 50), { pct: 0, direction: 'flat' })
})

test('a missing baseline is silence, never a zero', () => {
  /* Each of these is a real state on the dashboard, and every one of them
     would read as "nothing changed" if it were rendered as a flat 0%. */
  assert.equal(delta(60, null), null, 'the previous window had no data')
  assert.equal(delta(null, 50), null, 'this window has no data')
  assert.equal(delta(12, undefined), null, 'no comparison was requested')
  assert.equal(delta(NaN, 50), null)
  assert.equal(delta(60, NaN), null)
})

test('a rise off exactly zero has no honest percentage', () => {
  // Any increase from 0 is an infinite rise. The KPI shows the new value with
  // no arrow rather than "+∞%" or a fabricated "+100%".
  assert.equal(delta(30, 0), null)
  // Zero to zero, though, genuinely did not change.
  assert.deepEqual(delta(0, 0), { pct: 0, direction: 'flat' })
  // And a fall TO zero is a real, finite, and rather important -100%.
  assert.deepEqual(delta(0, 40), { pct: -100, direction: 'down' })
})

test('the blocking topic reports which of four things happened', () => {
  const fractions = { objective_id: 'obj.fractions', label: 'שברים' }
  const percents = { objective_id: 'obj.percents', label: 'אחוזים' }

  assert.deepEqual(topicShift(fractions, fractions), { kind: 'same' })
  assert.deepEqual(topicShift(percents, fractions), { kind: 'moved', from: 'שברים' })
  // The good news the card would otherwise swallow: the topic simply vanishes.
  assert.deepEqual(topicShift(null, fractions), { kind: 'cleared', from: 'שברים' })
  // No previous evidence is not "unchanged" — there is nothing to compare to.
  assert.deepEqual(topicShift(fractions, null), { kind: 'unknown' })
  assert.deepEqual(topicShift(null, null), { kind: 'unknown' })
})

test('the topic is matched by objective, not by its printed label', () => {
  // Two objectives can share a title across subjects; the id is the identity.
  const a = { objective_id: 'MOE.MATH.G7.FRACTIONS', label: 'שברים' }
  const b = { objective_id: 'MOE.MATH.G8.FRACTIONS', label: 'שברים' }
  assert.deepEqual(topicShift(a, b), { kind: 'moved', from: 'שברים' })
})
