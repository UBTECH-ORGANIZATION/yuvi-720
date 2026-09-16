/* Going back and forth between teacher screens must not re-load what did
 * not change — the phase 0 rows of docs/architecture/redis-cache-plan.md.
 *
 *   node --test frontend/tests/
 *
 * Source-level checks, like learner-load.test.ts: the providers are keyed on
 * the user's id (a preference write replaces the user object), the pages
 * that only wanted names read the roster the shell already holds instead of
 * fetching the class snapshot, and the dashboard's chat and calendar
 * sub-routes do not load the overview they never render.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('teacher providers survive a preference write', () => {
  it('the roster is keyed on the user id, not the user object', () => {
    const roster = read('../src/providers/TeacherRosterProvider.tsx')
    assert.match(roster, /const userId = user\?\.user_id/)
    assert.match(roster, /\}, \[userId, isTeacher\]\)/)
    assert.doesNotMatch(roster, /\}, \[user, isTeacher\]\)/)
  })

  it('the bell and its stream are keyed on the id and the hats', () => {
    const bell = read('../src/providers/NotificationsProvider.tsx')
    assert.match(bell, /\}, \[userId, nonce, role\]\)/)
    assert.match(bell, /\}, \[isLearnerAccount, role\]\)/)
    assert.doesNotMatch(bell, /\}, \[user, (nonce|role)/)
  })
})

describe('name-only screens read the roster, not the class snapshot', () => {
  for (const [name, path] of [
    ['goals', '../src/features/teacher-app/goals/TeacherGoalsPage.tsx'],
    ['messages', '../src/features/teacher-app/messages/TeacherMessagesPage.tsx'],
    ['launch dialog', '../src/features/teacher-app/tasks/LaunchDialog.tsx'],
  ] as const) {
    it(`${name}`, () => {
      const source = read(path)
      assert.doesNotMatch(source, /getGroupSnapshot/)
      assert.match(source, /useTeacherRoster\(\)/)
      // the class's slice, never the teacher's whole roster (#18-for-6)
      assert.match(source, /row\.group_id === groupId/)
    })
  }
})

describe('the learner dashboard sub-routes', () => {
  it('skip the overview requests they never render', () => {
    const page = read('../src/features/student-dashboard/StudentDashboardPage.tsx')
    const overview = page.indexOf("const isOverview = !window.location.pathname.endsWith('/calendar')")
    const dashboardEffect = page.indexOf('if (!learnerId || !isOverview) return')
    const catalogEffect = page.indexOf('if (!isOverview) return')
    assert.ok(overview > 0 && overview < dashboardEffect, 'isOverview is defined before the effects')
    assert.ok(catalogEffect > dashboardEffect, 'the catalog effect is gated too')
  })
})
