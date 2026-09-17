/* Every dashboard files one MoE `dashboard/viewed` on leave, with its duration.
 *
 *   node --test frontend/tests/
 *
 * Source-level: the six screens and the one hook they share. What used to
 * happen — a report per data fetch, or an inline performance.now() effect per
 * page — is exactly what must not come back.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.join(here, '../src', rel), 'utf8')

const PAGES: Array<[string, RegExp]> = [
  ['features/student-dashboard/StudentDashboardPage.tsx', /useViewedDuration\(learnerId && isOverview \? dashboardViewedPath\(learnerId\) : null\)/],
  ['features/teacher-app/home/TeacherHomePage.tsx', /useViewedDuration\(groupId \? groupDashboardViewedPath\(groupId\) : null\)/],
  ['features/teacher-app/student/TeacherStudentPage.tsx', /useViewedDuration\(studentDashboardViewedPath\(learnerId\)\)/],
  ['features/teacher-app/learnings/TeacherLearningsPage.tsx', /useViewedDuration\(groupId \? groupDashboardViewedPath\(groupId\) : null\)/],
  ['features/teacher-app/learnings/LearningDetailPage.tsx', /useViewedDuration\(groupDashboardViewedPath\(groupId\)\)/],
  ['features/teacher-app/students/TeacherStudentsPage.tsx', /useViewedDuration\(groupId \? REALTIME_DASHBOARD_VIEWED_PATH : null, groupId \? \{ group_id: groupId \} : \{\}\)/],
]

describe('dashboard viewed durations', () => {
  for (const [file, usage] of PAGES) {
    it(`${file} reports through the shared hook, once, on leave`, () => {
      const source = read(file)
      assert.match(source, usage)
      assert.doesNotMatch(source, /performance\.now\(\)[\s\S]{0,400}dashboard-viewed/i, 'no inline duration effect')
      assert.doesNotMatch(source, /reportRealtimeDashboardViewed|reportGroupDashboardViewed|reportStudentDashboardViewed/)
    })
  }

  it('the hook counts visible time, beacons on pagehide and POSTs on unmount', () => {
    const hook = read('hooks/useViewedDuration.ts')
    assert.match(hook, /document\.addEventListener\('visibilitychange', onVisibility\)/)
    assert.match(hook, /window\.addEventListener\('pagehide', onPageHide\)/)
    assert.match(hook, /if \(viaBeacon\) apiBeacon\(path, payload\(seconds\)\)/)
    assert.match(hook, /void apiPost\(path, payload\(seconds\)\)/)
    assert.match(hook, /if \(reported\) return/)
    assert.match(hook, /duration_seconds: seconds/)
  })

  it('the paths are the on-leave endpoints', () => {
    const teacher = read('services/teacher.ts')
    assert.match(teacher, /\/api\/teacher\/groups\/\$\{encodeURIComponent\(groupId\)\}\/dashboard-viewed/)
    assert.match(teacher, /\/api\/teacher\/students\/\$\{encodeURIComponent\(learnerId\)\}\/dashboard-viewed/)
    assert.match(teacher, /REALTIME_DASHBOARD_VIEWED_PATH = '\/api\/teacher\/live\/viewed'/)
    assert.match(read('services/brain.ts'), /\/api\/brain\/\$\{encodeURIComponent\(learnerId\)\}\/dashboard-viewed/)
  })
})
