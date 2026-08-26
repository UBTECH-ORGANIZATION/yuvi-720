/* The class book's page selection (#450 v2): ten pages, improvement first,
 * recency breaking ties — a rating of moments, never of students. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PLATE_VARIANTS, bookEdition, coverVariant, momentsInEdition, platePlan, project, topMoments,
} from '../src/features/teacher-app/moments/bookModel.ts'
import type { Moment } from '../src/services/teacher.ts'

const moment = (kind: string, at: string): Moment =>
  ({ kind, at, learner_id: 'x', text_key: 'k', params: {} } as unknown as Moment)

test('improvement outranks a first success, which outranks a feelings page', () => {
  const picked = topMoments([
    moment('feelings_journey', '2026-08-23T10:00:00Z'),
    moment('first_mastery', '2026-08-20T10:00:00Z'),
    moment('recovery', '2026-08-18T10:00:00Z'),
  ])
  assert.deepEqual(picked.map((row) => row.kind),
                   ['recovery', 'first_mastery', 'feelings_journey'])
})

test('the book holds ten pages, never more', () => {
  const many = Array.from({ length: 25 }, (_, index) =>
    moment('breakthrough', `2026-08-${String(1 + (index % 20)).padStart(2, '0')}T10:00:00Z`))
  assert.equal(topMoments(many).length, 10)
})

test('inside a kind, newer comes first', () => {
  const picked = topMoments([
    moment('comeback', '2026-08-20T10:00:00Z'),
    moment('comeback', '2026-08-22T10:00:00Z'),
  ])
  assert.deepEqual(picked.map((row) => row.at),
                   ['2026-08-22T10:00:00Z', '2026-08-20T10:00:00Z'])
})

test('an unknown kind still gets a page rather than crashing the book', () => {
  const picked = topMoments([moment('next_years_kind', '2026-08-23T10:00:00Z')])
  assert.equal(picked.length, 1)
})

test('same-kind pages never share a picture (until the plates run out)', () => {
  const pages = Array.from({ length: PLATE_VARIANTS }, (_, index) =>
    moment('recovery', `2026-08-${String(10 + index)}T10:00:00Z`))
  pages.push(moment('comeback', '2026-08-23T10:00:00Z'))
  const plan = platePlan(pages)
  assert.equal(new Set(plan.slice(0, PLATE_VARIANTS)).size, PLATE_VARIANTS)
  for (const variant of plan) {
    assert.ok(variant >= 1 && variant <= PLATE_VARIANTS)
  }
})

test('the plan is deterministic — the same book always wears the same pictures', () => {
  const pages = [
    moment('recovery', '2026-08-22T10:00:00Z'),
    moment('recovery', '2026-08-21T10:00:00Z'),
  ]
  assert.deepEqual(platePlan(pages), platePlan(pages))
})

test('the book is about the period that FINISHED, not the one in progress', () => {
  // Read on Tue 25/08. The weekly edition is the seven days before the seven
  // running now: 12/08–18/08, not "last calendar week".
  const week = bookEdition(7, new Date(2026, 7, 25))
  assert.equal(week.label, '12/08-18/08')
  assert.equal(week.days, 7)

  // A day's book is yesterday, and one date rather than a range said twice.
  assert.equal(bookEdition(1, new Date(2026, 7, 25)).label, '24/08')

  // Three days: 20/08–22/08 sits immediately before the running 23/08–25/08.
  assert.equal(bookEdition(3, new Date(2026, 7, 25)).label, '20/08-22/08')

  // A month reaches back sixty days and stops thirty short of today.
  assert.equal(bookEdition(30, new Date(2026, 7, 25)).label, '27/06-26/07')
})

test('the edition rolls forward daily, and its key is the day it was made', () => {
  // Trailing windows move every day — that is what the teacher chose over
  // calendar anchoring — so consecutive days are different editions.
  assert.equal(bookEdition(7, new Date(2026, 7, 25)).key, '2026-08-25')
  assert.equal(bookEdition(7, new Date(2026, 7, 26)).key, '2026-08-26')
  assert.notEqual(
    bookEdition(7, new Date(2026, 7, 25)).label,
    bookEdition(7, new Date(2026, 7, 26)).label,
  )
  // The key is the DAY, not the period: switching period must not hand a
  // teacher a second present for a book they already opened this morning.
  const day = new Date(2026, 7, 25)
  assert.equal(bookEdition(1, day).key, bookEdition(30, day).key)
})

test('the pages come from the window the cover names, and nowhere else', () => {
  const week = bookEdition(7, new Date(2026, 7, 25)) // edition of 12/08-18/08
  const pages = momentsInEdition([
    moment('recovery', '2026-08-11T10:00:00Z'),     // the period before — too old
    moment('recovery', '2026-08-12T06:00:00Z'),     // the day it opens on
    moment('comeback', '2026-08-15T12:00:00Z'),     // mid-window
    moment('breakthrough', '2026-08-19T08:00:00Z'), // the current period — not yet its book
  ], week)
  assert.deepEqual(pages.map((row) => row.at), [
    '2026-08-12T06:00:00Z', '2026-08-15T12:00:00Z',
  ])
})

test('the window is half-open, so no moment lands in two consecutive books', () => {
  /* Built from the edition's own edges rather than from fixed UTC strings:
     the window is aligned to the teacher's LOCAL midnight, so a hardcoded
     offset would pass in Israel and fail in CI. */
  const week = bookEdition(7, new Date(2026, 7, 25))
  const atEnd = moment('comeback', new Date(week.end).toISOString())
  const justBefore = moment('comeback', new Date(week.end - 1000).toISOString())
  const atStart = moment('recovery', new Date(week.start).toISOString())

  assert.deepEqual(momentsInEdition([atEnd], week), [], 'the closing edge belongs to the next book')
  assert.equal(momentsInEdition([justBefore], week).length, 1)
  assert.equal(momentsInEdition([atStart], week).length, 1, 'the opening edge is inside')

  // …and the moment on the boundary is the NEXT edition's first page, so it is
  // published exactly once.
  const next = bookEdition(7, new Date(2026, 7, 25 + 7))
  assert.equal(next.start, week.end)
})

test('editions are day-aligned, so a cover date never half-covers a day', () => {
  // Same day, two different clock times: the window must not shift with the
  // hour a teacher happens to open the dashboard.
  const morning = bookEdition(7, new Date(2026, 7, 25, 7, 30))
  const evening = bookEdition(7, new Date(2026, 7, 25, 23, 45))
  assert.equal(morning.start, evening.start)
  assert.equal(morning.end, evening.end)
  assert.equal(new Date(morning.start).getHours(), 0)
})

test('an undated moment is left out rather than assumed recent', () => {
  const week = bookEdition(7, new Date(2026, 7, 25))
  assert.deepEqual(momentsInEdition([moment('recovery', '')], week), [])
})

test('the cover artwork is stable per class and always a real plate', () => {
  assert.equal(coverVariant('ח׳1'), coverVariant('ח׳1'))
  for (const name of ['ח׳1', 'ח׳2', null]) {
    const variant = coverVariant(name)
    assert.ok(variant >= 1 && variant <= 3)
  }
})

/* The floor turner reads intent from speed, not distance alone: a flick
   commits early, a crawl still has to travel. The deceleration constant is
   what separates the two, so it is pinned here rather than tuned by feel. */
test('a flick projects past the page-turn threshold and a crawl does not', () => {
  const THRESHOLD = 40
  // a gentle two-finger crawl: ~4px every 50ms
  assert.ok(Math.abs(project((4 / 50) * 1000)) < THRESHOLD)
  // a deliberate flick: ~30px every 8ms
  assert.ok(Math.abs(project((30 / 8) * 1000)) > THRESHOLD)
})

test('projection carries the sign of the gesture and rests at zero', () => {
  assert.equal(project(0), 0)
  assert.ok(project(-1200) < 0)
  assert.ok(project(1200) > 0)
})
