/* The class book's page selection (#450 v2): ten pages, improvement first,
 * recency breaking ties — a rating of moments, never of students. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PLATE_VARIANTS, bookWeek, coverVariant, platePlan, topMoments,
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

test('the book is a Sunday-to-Friday weekly edition', () => {
  // a Tuesday belongs to the week that started the previous Sunday
  const midWeek = bookWeek(new Date(2026, 7, 25))
  assert.equal(midWeek.key, '2026-08-23')
  assert.equal(midWeek.label, '23/08-28/08')
  // Sunday starts a fresh edition; every day of the week shares its key
  assert.equal(bookWeek(new Date(2026, 7, 23)).key, '2026-08-23')
  assert.equal(bookWeek(new Date(2026, 7, 28)).key, '2026-08-23')
  assert.equal(bookWeek(new Date(2026, 7, 30)).key, '2026-08-30')
})

test('the cover artwork is stable per class and always a real plate', () => {
  assert.equal(coverVariant('ח׳1'), coverVariant('ח׳1'))
  for (const name of ['ח׳1', 'ח׳2', null]) {
    const variant = coverVariant(name)
    assert.ok(variant >= 1 && variant <= 3)
  }
})
