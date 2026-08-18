import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CalendarItem } from '../src/services/calendar.ts'
import {
  formatCalendarRange, groupItemsByDay, itemLocalDate, shiftDate,
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
})