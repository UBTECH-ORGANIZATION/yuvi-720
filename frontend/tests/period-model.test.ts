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

test('a relative delta is a signed whole percent of the previous value', () => {
  assert.deepEqual(delta(60, 50), { value: 20, unit: 'relative', direction: 'up', previous: 50 })
  assert.deepEqual(delta(40, 50), { value: -20, unit: 'relative', direction: 'down', previous: 50 })
  assert.deepEqual(delta(50, 50), { value: 0, unit: 'relative', direction: 'flat', previous: 50 })
})

test('a percentage is compared in POINTS, not relatively', () => {
  /* The bug this pins: engagement rising from 24% to 83% was reported as
     "+246%" — arithmetically true, and unreadable on a metric whose ceiling is
     100. It cannot more-than-triple, so the number reads as broken. */
  assert.deepEqual(delta(83, 24, 'points'),
    { value: 59, unit: 'points', direction: 'up', previous: 24 })
  assert.equal(delta(83, 24).value, 246, 'the relative reading is still what it was')

  assert.deepEqual(delta(40, 55, 'points'),
    { value: -15, unit: 'points', direction: 'down', previous: 55 })
  assert.equal(delta(50, 50, 'points').direction, 'flat')
})

test('points survive a zero baseline, where a relative change cannot', () => {
  /* A class that went from nobody active to 90% active rose ninety points —
     true, finite, and the single most worth saying. Relatively it is an
     infinite rise with no honest number, which is why the unit is chosen per
     metric rather than globally. */
  assert.deepEqual(delta(90, 0, 'points'),
    { value: 90, unit: 'points', direction: 'up', previous: 0 })
  assert.equal(delta(90, 0), null)
})

test('the delta carries what it moved from, so the chip can say so', () => {
  // A change with no baseline beside it invites "from what?" — the chip needs
  // both halves of the sentence.
  assert.equal(delta(83, 24, 'points').previous, 24)
  assert.equal(delta(14.1, 14.4).previous, 14.4)
})

test('a missing baseline is silence in either unit', () => {
  for (const unit of ['relative', 'points']) {
    assert.equal(delta(60, null, unit), null, `${unit}: the previous window had no data`)
    assert.equal(delta(null, 50, unit), null, `${unit}: this window has no data`)
    assert.equal(delta(12, undefined, unit), null, `${unit}: no comparison requested`)
    assert.equal(delta(NaN, 50, unit), null)
    assert.equal(delta(60, NaN, unit), null)
  }
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
