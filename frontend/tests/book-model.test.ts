/* The class book's page selection (#450 v2): ten pages, improvement first,
 * recency breaking ties — a rating of moments, never of students. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PLATE_VARIANTS, bookWeek, coverVariant, momentsInWeek, platePlan, project, topMoments,
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

test('the book is about the week that FINISHED, not the one in progress', () => {
  // read on a Tuesday, the edition is the week before the one running now
  const midWeek = bookWeek(new Date(2026, 7, 25))
  assert.equal(midWeek.key, '2026-08-16')
  assert.equal(midWeek.label, '16/08-21/08')
  // every day of the current week reads the same finished edition…
  assert.equal(bookWeek(new Date(2026, 7, 23)).key, '2026-08-16')
  assert.equal(bookWeek(new Date(2026, 7, 28)).key, '2026-08-16')
  // …and Sunday closes the week just gone and hands it over as the new book
  assert.equal(bookWeek(new Date(2026, 7, 30)).key, '2026-08-23')
})

test('the pages come from the week the cover names, and nowhere else', () => {
  const week = bookWeek(new Date(2026, 7, 25)) // edition of 16/08-21/08
  const pages = momentsInWeek([
    moment('recovery', '2026-08-14T10:00:00Z'),  // the week before — too old
    moment('recovery', '2026-08-16T06:00:00Z'),  // the Sunday it opens on
    moment('comeback', '2026-08-20T12:00:00Z'),  // mid-week
    moment('comeback', '2026-08-22T09:00:00Z'),  // Saturday still counts
    moment('breakthrough', '2026-08-24T08:00:00Z'), // this week — not yet its book
  ], week)
  assert.deepEqual(pages.map((row) => row.at), [
    '2026-08-16T06:00:00Z', '2026-08-20T12:00:00Z', '2026-08-22T09:00:00Z',
  ])
})

test('an undated moment is left out rather than assumed recent', () => {
  const week = bookWeek(new Date(2026, 7, 25))
  assert.deepEqual(momentsInWeek([moment('recovery', '')], week), [])
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
