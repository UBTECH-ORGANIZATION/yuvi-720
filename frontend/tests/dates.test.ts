/* Numeric dates are one format, in every language.
 *
 * `toLocaleDateString()` with no locale follows the browser: a Hebrew screen on
 * a US-configured machine showed `8/12/2026` for the 12th of August.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const { formatDay, formatDayTime, formatShortDay } = await import('../src/i18n/dates.ts')

const strip = (text: string) => text.replace(/[⁦⁩]/g, '')
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('dd/mm/yyyy, padded, everywhere', () => {
  it('writes the day first and pads both', () => {
    assert.equal(strip(formatDay(new Date(2026, 7, 12))), '12/08/2026')
    assert.equal(strip(formatDay(new Date(2026, 0, 3))), '03/01/2026')
  })

  it('carries the time in 24 hours', () => {
    assert.equal(strip(formatDayTime(new Date(2026, 7, 12, 14, 2))), '12/08/2026, 14:02')
  })

  it('isolates itself, so a Hebrew sentence cannot reorder its parts', () => {
    assert.match(formatDay(new Date(2026, 7, 12)), /^⁦.*⁩$/)
  })

  it('returns nothing for nothing, rather than "Invalid Date"', () => {
    for (const value of [null, undefined, '', 'not a date']) {
      assert.equal(formatDay(value as string), '')
      assert.equal(formatDayTime(value as string), '')
    }
  })

  it('keeps the wordy form localized — a month name is a word', () => {
    assert.match(formatShortDay(new Date(2026, 7, 12), 'he'), /12/)
    assert.match(formatShortDay(new Date(2026, 7, 12), 'en'), /Aug/)
  })
})

describe('nothing renders a date through the browser locale', () => {
  it('has no bare toLocaleDateString left in the app', () => {
    // The bug is invisible on a machine set to a European locale, which is
    // every machine this was written on — so it is pinned in source.
    const files = [
      '../src/features/teacher-app/tasks/TaskTrackingPage.tsx',
      '../src/features/teacher-app/goals/GoalDialog.tsx',
      '../src/components/NotificationBell.tsx',
      '../src/features/admin/AdminAuditTab.tsx',
      '../src/features/student-tasks/MyTasksPage.tsx',
    ]
    for (const file of files) {
      assert.equal(/toLocaleDateString\(\)|toLocaleString\(\)/.test(read(file)), false, file)
    }
  })
})
