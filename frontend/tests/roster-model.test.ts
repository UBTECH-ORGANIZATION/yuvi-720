/* Roster filtering and sorting.
 *
 *   node --test frontend/tests/
 *
 * A teacher asking "who has not been here in a week" and getting the wrong
 * twelve children is a worse failure than any styling bug, and it is silent —
 * the list looks perfectly plausible either way. So the rules live in a pure
 * module and they are tested here.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  NO_FILTERS, countByStatus, filterRows, sortRows, statusOf, toRosterRows,
} from '../src/features/teacher-app/students/rosterModel.ts'

const OPTIONS = {
  isOnline: (id: string) => id === 'kid-online',
  formatDate: (iso: string) => iso.slice(0, 10),
  neverLabel: 'never',
}

function build(students: unknown[]) {
  return toRosterRows(students as never[], OPTIONS)
}

const ROWS = build([
  { learner_id: 'kid-online', display_name: 'Bat', status: 'active',
    activity: { last_event_at: '2026-08-09T07:00:00Z', days_inactive: 0 } },
  { learner_id: 'kid-tal', display_name: 'Tal', status: 'attention',
    attention: { kind: 'wellbeing', reason: 'r', evidence: 'said something' },
    activity: { last_event_at: '2026-08-03T07:00:00Z', days_inactive: 6 } },
  { learner_id: 'kid-ari', display_name: 'Ari', status: 'not_started',
    activity: { last_event_at: null, days_inactive: null } },
  { learner_id: 'kid-dana', display_name: 'Dana', status: 'active',
    activity: { last_event_at: '2026-07-25T07:00:00Z', days_inactive: 15 } },
])

describe('deriving a status', () => {
  it('trusts the engine when it says so', () => {
    assert.equal(statusOf({ status: 'not_started' }), 'not_started')
  })

  it('downgrades an unknown status to flagged, never to progressing', () => {
    // A child who never logged in must not be reported to their teacher as
    // active because an older payload lacked the field.
    assert.equal(statusOf({ attention: { kind: 'inactive' } }), 'attention')
  })

  it('falls back to active only when there is no flag at all', () => {
    assert.equal(statusOf({}), 'active')
  })
})

describe('shaping a row', () => {
  it('renders an unnamed learner as their id rather than as blank', () => {
    const [row] = build([{ learner_id: 'kid-7f3a', display_name: null }])
    assert.equal(row.name, 'kid-7f3a')
  })

  it('labels a learner with no activity instead of leaving an empty cell', () => {
    const ari = ROWS.find((row) => row.learner_id === 'kid-ari')!
    assert.equal(ari.lastActivityLabel, 'never')
  })
})

describe('filtering', () => {
  it('returns everyone with no filters', () => {
    assert.equal(filterRows(ROWS, NO_FILTERS).length, 4)
  })

  it('narrows to one status', () => {
    const rows = filterRows(ROWS, { ...NO_FILTERS, status: 'attention' })
    assert.deepEqual(rows.map((row) => row.name), ['Tal'])
  })

  it('narrows by presence', () => {
    const rows = filterRows(ROWS, { ...NO_FILTERS, presence: 'online' })
    assert.deepEqual(rows.map((row) => row.name), ['Bat'])
  })

  it('includes a learner who never started in "inactive 7+ days"', () => {
    // The failure this guards: `days_inactive` is null for a child who has never
    // logged in, and a naive numeric filter drops exactly the person the teacher
    // is hunting for.
    const rows = filterRows(ROWS, { ...NO_FILTERS, minDaysInactive: 7 })
    assert.deepEqual(rows.map((row) => row.name).sort(), ['Ari', 'Dana'])
  })

  it('excludes someone active more recently than the threshold', () => {
    const rows = filterRows(ROWS, { ...NO_FILTERS, minDaysInactive: 7 })
    assert.ok(!rows.some((row) => row.name === 'Tal'))
  })

  it('combines a filter with the search box', () => {
    const rows = filterRows(ROWS, { ...NO_FILTERS, status: 'active', query: 'da' })
    assert.deepEqual(rows.map((row) => row.name), ['Dana'])
  })

  it('searches case-insensitively', () => {
    assert.equal(filterRows(ROWS, { ...NO_FILTERS, query: 'TAL' }).length, 1)
  })
})

describe('sorting', () => {
  it('defaults to alphabetical, which is what keeps it off a leaderboard', () => {
    const rows = sortRows(ROWS, 'name', 'asc')
    assert.deepEqual(rows.map((row) => row.name), ['Ari', 'Bat', 'Dana', 'Tal'])
  })

  it('reverses', () => {
    const rows = sortRows(ROWS, 'name', 'desc')
    assert.deepEqual(rows.map((row) => row.name), ['Tal', 'Dana', 'Bat', 'Ari'])
  })

  it('puts flagged students first when sorting by status', () => {
    const rows = sortRows(ROWS, 'status', 'asc')
    assert.equal(rows[0].name, 'Tal')
  })

  it('sorts days inactive with "no data" at the end in both directions', () => {
    // Absence is not a low score: a child with no number must not lead the
    // ascending list as though they were the most recently active.
    const asc = sortRows(ROWS, 'daysInactive', 'asc')
    const desc = sortRows(ROWS, 'daysInactive', 'desc')
    assert.equal(asc.at(-1)!.name, 'Ari')
    assert.equal(desc.at(-1)!.name, 'Ari')
  })

  it('breaks ties alphabetically so rows never shuffle between renders', () => {
    const tied = build([
      { learner_id: 'b', display_name: 'Bat', status: 'active',
        activity: { days_inactive: 3, last_event_at: '2026-08-06T00:00:00Z' } },
      { learner_id: 'a', display_name: 'Ari', status: 'active',
        activity: { days_inactive: 3, last_event_at: '2026-08-06T00:00:00Z' } },
    ])
    assert.deepEqual(
      sortRows(tied, 'daysInactive', 'asc').map((row) => row.name), ['Ari', 'Bat']
    )
  })

  it('does not mutate the input', () => {
    const before = ROWS.map((row) => row.name)
    sortRows(ROWS, 'status', 'desc')
    assert.deepEqual(ROWS.map((row) => row.name), before)
  })
})

describe('counting for the filter chips', () => {
  it('counts every status', () => {
    assert.deepEqual(countByStatus(ROWS), { attention: 1, not_started: 1, active: 2 })
  })
})
