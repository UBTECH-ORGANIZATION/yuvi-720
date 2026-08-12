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

  /* The chip count is a promise: "press me and you get this many rows". It was
     computed from the unfiltered roster, so with a search or a presence filter
     also on, a chip could read "(2)" and then produce an empty table — the
     teacher pressing it has no way to tell whether that is a bug or the truth.
     Counting the rows every OTHER filter leaves is what makes it a preview. */
  it('counts what pressing the chip would actually show', () => {
    const filters = { ...NO_FILTERS, presence: 'online' as const }
    const counts = countByStatus(filterRows(ROWS, { ...filters, status: 'all' }))

    for (const status of ['attention', 'not_started', 'active'] as const) {
      assert.equal(
        counts[status],
        filterRows(ROWS, { ...filters, status }).length,
        `the ${status} chip promises a row count it does not deliver`
      )
    }
  })

  it('the old behaviour really was wrong, so this test can fail', () => {
    // Guards the guard: if the fixture stops making the two disagree, the test
    // above passes for free and stops meaning anything.
    const filters = { ...NO_FILTERS, presence: 'online' as const }
    assert.notDeepEqual(
      countByStatus(ROWS),
      countByStatus(filterRows(ROWS, { ...filters, status: 'all' }))
    )
  })
})

describe('sub-group scoping', () => {
  const SLICE = ['kid-online', 'kid-tal']

  it('narrows the roster to the named slice', () => {
    const rows = filterRows(ROWS, { ...NO_FILTERS, subgroup: SLICE })
    assert.deepEqual(rows.map((row) => row.learner_id).sort(), [...SLICE].sort())
  })

  it('combines with the other filters rather than replacing them', () => {
    const rows = filterRows(ROWS, { ...NO_FILTERS, subgroup: SLICE, status: 'attention' })
    for (const row of rows) {
      assert.equal(row.status, 'attention')
      assert.ok(SLICE.includes(row.learner_id))
    }
  })

  /* A sub-group is a SCOPE, like the class picker — not a filter. If pressing a
     KPI or "clear filters" dropped it, the teacher would be looking at the whole
     class while the switcher still said "קבוצת חיזוק". */
  it('an empty selection means the whole class, not an empty class', () => {
    assert.equal(filterRows(ROWS, { ...NO_FILTERS, subgroup: null }).length, ROWS.length)
  })

  it('a slice naming nobody present yields nothing, rather than everything', () => {
    assert.equal(filterRows(ROWS, { ...NO_FILTERS, subgroup: ['ghost'] }).length, 0)
  })
})

/* The four numbers above the table describe whoever is selected, not always the
 * whole class. They were counted from every row, so choosing "קשויי הבנה" left
 * "0 דורשים תשומת לב" sitting above a list showing a flagged child — the card
 * contradicting the rows underneath it.
 *
 * The KPIs are computed in the page, but the set they are computed over is
 * this: everything scoped by the sub-group and by nothing else, which is what
 * keeps a KPI a preview of the class rather than of the current search box. */
describe('the set the KPI cards count', () => {
  const SLICE = ['kid-tal', 'kid-ari']
  const inScope = (subgroup: string[] | null) =>
    filterRows(ROWS, { ...NO_FILTERS, subgroup })

  it('is the sub-group when one is selected', () => {
    const rows = inScope(SLICE)
    assert.equal(rows.filter((row) => row.status === 'attention').length, 1)
    assert.equal(rows.filter((row) => row.status === 'not_started').length, 1)
    assert.equal(rows.length, 2)
  })

  it('is the whole class when none is', () => {
    assert.equal(inScope(null).length, ROWS.length)
  })

  it('ignores the search box, so a KPI still previews what pressing it shows', () => {
    const rows = filterRows(ROWS, { ...NO_FILTERS, subgroup: SLICE, query: 'zzz' })
    assert.equal(rows.length, 0)
    // ...while the KPI set, built without the query, still has both.
    assert.equal(inScope(SLICE).length, 2)
  })

  it('counts "engaged this week" the same way the column reports it', () => {
    const engaged = inScope(null)
      .filter((row) => row.daysInactive !== null && row.daysInactive < 7)
    assert.deepEqual(engaged.map((row) => row.learner_id), ['kid-online', 'kid-tal'])
  })
})
