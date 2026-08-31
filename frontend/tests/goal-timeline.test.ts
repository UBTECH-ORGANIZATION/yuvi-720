/* Where a goal lands on the day timeline.
 *
 * These are the decisions the spec asked to be made deliberately rather than
 * left to a sort comparator: a missed date sits above today, and a goal with no
 * date has a home at the end instead of dropping out of the list. Both are
 * invisible until they are wrong, so they are asserted rather than eyeballed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDayGroups } from '../src/features/mentoring/goalTimeline.ts'
import type { MentoringConversation } from '../src/services/mentoring.ts'

function iso(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function talk(id: string, date: string, goals: Array<Record<string, unknown>>): MentoringConversation {
  return { id, date, notes: '', goals } as unknown as MentoringConversation
}

test('goals sharing an end date sit under one day, whatever talk they came from', () => {
  const due = iso(3)
  const groups = buildDayGroups([
    talk('c1', iso(-9), [{ id: 'a', title: 'A', deadline: due }]),
    talk('c2', iso(-2), [{ id: 'b', title: 'B', deadline: due }]),
  ])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].entries.map((entry) => entry.goal.id), ['a', 'b'])
  // The card still knows which talk it came from — the date is demoted, not lost.
  assert.deepEqual(groups[0].entries.map((entry) => entry.conversation.id), ['c1', 'c2'])
})

test('a missed date sits above today and its day is marked late', () => {
  const groups = buildDayGroups([
    talk('c1', iso(-20), [
      { id: 'late', title: 'Late', deadline: iso(-4) },
      { id: 'now', title: 'Now', deadline: iso(0) },
      { id: 'soon', title: 'Soon', deadline: iso(5) },
    ]),
  ])
  assert.deepEqual(groups.map((group) => group.entries[0].goal.id), ['late', 'now', 'soon'])
  assert.deepEqual(groups.map((group) => group.late), [true, false, false])
})

test('a past day everyone finished is settled, so it can be folded away', () => {
  const groups = buildDayGroups([
    talk('c1', iso(-20), [
      { id: 'done', title: 'Done', deadline: iso(-6), progress_stage: 'summarized' },
      { id: 'open', title: 'Open', deadline: iso(-5) },
    ]),
  ])
  assert.deepEqual(groups.map((group) => [group.settled, group.late]), [[true, false], [false, true]])
})

test('a goal with no date gets the end of the list, never nowhere', () => {
  const groups = buildDayGroups([
    talk('c1', iso(-3), [
      { id: 'undated', title: 'Undated', deadline: '' },
      { id: 'dated', title: 'Dated', deadline: iso(2) },
    ]),
  ])
  assert.deepEqual(groups.map((group) => group.key), [iso(2), 'undated'])
  // An undated goal can never be late: there is no date for it to have missed.
  assert.equal(groups[1].late, false)
  assert.equal(groups[1].settled, false)
})
