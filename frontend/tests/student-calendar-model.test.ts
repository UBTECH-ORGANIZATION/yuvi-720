import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CalendarItem } from '../src/services/calendar.ts'
import {
  activeLessonMinutesRemaining, activeLessonProgressPercent, formatCalendarRange, groupItemsByDay, itemLocalDate, shiftDate,
  weekBoundsForDate, weekDays,
} from '../src/features/student-dashboard/calendarModel.ts'

function item(start_at: string, all_day = false): CalendarItem {
  return {
    id: start_at, kind: 'task', title: '', subject: null, teacher_name: null,
    start_at, end_at: null, all_day, status: 'upcoming', proximity: null,
    action_route: null,
  }
}

describe('student calendar model', () => {
  it('builds a Sunday-through-Saturday sequence', () => {
    assert.deepEqual(weekDays('2026-08-16'), [
      '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19',
      '2026-08-20', '2026-08-21', '2026-08-22',
    ])
  })

  it('preserves date-only all-day values', () => {
    assert.equal(itemLocalDate(item('2026-08-17', true)), '2026-08-17')
  })

  it('groups timed UTC values by their Israel-local day', () => {
    const lateUtc = item('2026-08-16T22:30:00Z')
    assert.equal(itemLocalDate(lateUtc), '2026-08-17')
    assert.deepEqual(groupItemsByDay([lateUtc]).get('2026-08-17'), [lateUtc])
  })

  it('moves between weeks without depending on the device timezone', () => {
    assert.equal(shiftDate('2026-08-16', -7), '2026-08-09')
    assert.equal(shiftDate('2026-08-16', 7), '2026-08-23')
  })

  it('finds Sunday-through-Saturday bounds for any date in a week', () => {
    assert.deepEqual(weekBoundsForDate('2026-08-19'), ['2026-08-16', '2026-08-22'])
    assert.deepEqual(weekBoundsForDate('2026-08-23'), ['2026-08-23', '2026-08-29'])
  })

  it('formats a localized range for a non-current week', () => {
    const label = formatCalendarRange('2026-08-23', '2026-08-29', 'en')
    assert.match(label, /Aug/)
    assert.match(label, /23/)
    assert.match(label, /29/)
    assert.match(label, /2026/)
  })

  it('counts down a timed lesson only while it is in progress', () => {
    const lesson = { ...item('2026-08-19T08:00:00Z'), kind: 'lesson' as const, end_at: '2026-08-19T08:15:00Z' }
    assert.equal(activeLessonMinutesRemaining(lesson, Date.parse('2026-08-19T08:03:01Z')), 12)
    assert.equal(activeLessonMinutesRemaining(lesson, Date.parse('2026-08-19T07:59:59Z')), null)
    assert.equal(activeLessonMinutesRemaining(lesson, Date.parse('2026-08-19T08:15:00Z')), null)
  })

  it('calculates elapsed progress only for an active timed lesson', () => {
    const lesson = { ...item('2026-08-19T08:00:00Z'), kind: 'lesson' as const, end_at: '2026-08-19T08:30:00Z' }
    assert.equal(activeLessonProgressPercent(lesson, Date.parse('2026-08-19T08:10:00Z')), 33)
    assert.equal(activeLessonProgressPercent(lesson, Date.parse('2026-08-19T08:00:00Z')), 0)
    assert.equal(activeLessonProgressPercent(lesson, Date.parse('2026-08-19T08:30:00Z')), null)
  })

  it('does not invent a countdown for all-day, incomplete, or invalid lessons', () => {
    const now = Date.parse('2026-08-19T08:03:00Z')
    const lesson = { ...item('2026-08-19T08:00:00Z'), kind: 'lesson' as const, end_at: '2026-08-19T08:15:00Z' }
    assert.equal(activeLessonMinutesRemaining({ ...lesson, all_day: true }, now), null)
    assert.equal(activeLessonMinutesRemaining({ ...lesson, end_at: null }, now), null)
    assert.equal(activeLessonMinutesRemaining({ ...lesson, end_at: 'not-a-date' }, now), null)
  })
})