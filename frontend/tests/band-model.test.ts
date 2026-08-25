/* The band card's pure derivations (#450): one flat list ordered red→orange→
 * green, recent movers first inside a band, filters compose, and nothing ever
 * ranks. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyFilters, isFreshChange, moveDirection, sortForCard, type BandedStudent,
} from '../src/features/teacher-app/home/bandModel.ts'

const NOW = Date.parse('2026-08-23T12:00:00Z')

function student(
  id: string, band: 'red' | 'orange' | 'green',
  extra: Partial<BandedStudent['band']> = {},
): BandedStudent {
  return {
    learner_id: id,
    display_name: id,
    band: { band, reasons: [], changed_at: null, previous: null, ...extra },
  }
}

test('one flat list, red → orange → green', () => {
  const rows = sortForCard([
    student('g', 'green'), student('r', 'red'), student('o', 'orange'),
  ], NOW)
  assert.deepEqual(rows.map((row) => row.band.band), ['red', 'orange', 'green'])
})

test('recently moved students float to the top of their band, both halves alphabetical', () => {
  const fresh = { changed_at: '2026-08-23T10:00:00Z', previous: 'orange' }
  const rows = sortForCard([
    student('דנה', 'red'),
    student('יובל', 'red', fresh),
    student('אורי', 'red'),
    student('בועז', 'red', fresh),
    // a fresh green must NOT jump the reds — movement floats inside a band only
    student('גיל', 'green', fresh),
  ], NOW)
  assert.deepEqual(
    rows.map((row) => row.learner_id),
    ['בועז', 'יובל', 'אורי', 'דנה', 'גיל'])
})

test('a first sighting is never "new"', () => {
  assert.equal(isFreshChange(
    { band: 'red', reasons: [], changed_at: '2026-08-23T10:00:00Z', previous: null },
    NOW), false)
  assert.equal(isFreshChange(
    { band: 'red', reasons: [], changed_at: '2026-08-23T10:00:00Z', previous: 'orange' },
    NOW), true)
  // a change older than the freshness window has settled
  assert.equal(isFreshChange(
    { band: 'red', reasons: [], changed_at: '2026-08-18T10:00:00Z', previous: 'orange' },
    NOW), false)
})

test('a fresh move carries its direction — toward green is up', () => {
  const fresh = { changed_at: '2026-08-23T10:00:00Z' }
  assert.equal(moveDirection(
    { band: 'green', reasons: [], previous: 'orange', ...fresh }, NOW), 'up')
  assert.equal(moveDirection(
    { band: 'red', reasons: [], previous: 'orange', ...fresh }, NOW), 'down')
  // a settled change is just the current band — no arrow
  assert.equal(moveDirection(
    { band: 'red', reasons: [], previous: 'orange', changed_at: '2026-08-01T10:00:00Z' },
    NOW), null)
  // a first sighting has no direction to speak of
  assert.equal(moveDirection(
    { band: 'red', reasons: [], previous: null, ...fresh }, NOW), null)
})

test('the movers filter keeps only fresh changes', () => {
  const rows = [
    student('a', 'red', { changed_at: '2026-08-23T10:00:00Z', previous: 'orange' }),
    student('b', 'green'),
  ]
  assert.deepEqual(
    applyFilters(rows, { freshOnly: true }, NOW).map((row) => row.learner_id), ['a'])
})

test('band and sub-group filters compose', () => {
  const rows = [
    student('a', 'red'), student('b', 'green'), student('c', 'red'),
  ]
  assert.deepEqual(
    applyFilters(rows, { band: 'red' }).map((row) => row.learner_id), ['a', 'c'])
  assert.deepEqual(
    applyFilters(rows, { band: 'red', subgroupLearnerIds: ['c', 'b'] })
      .map((row) => row.learner_id),
    ['c'])
  // an empty sub-group list means "whole class", not "nobody"
  assert.equal(applyFilters(rows, { subgroupLearnerIds: [] }).length, 3)
})
