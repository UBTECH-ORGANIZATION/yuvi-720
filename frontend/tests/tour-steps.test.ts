/* The tour's contract, tested without a browser.
 *
 * Three things can silently break a tour, and all three are checkable here:
 *   - a step keyed to a locale key that only exists in Hebrew,
 *   - a step pointing at a `data-tour` attribute nobody ever added,
 *   - `start`/`end` placement that does not actually mirror in he/ar.
 *
 * The step list is deliberately JSX-free so this file can import it directly.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  STUDENT_TOKEN,
  canTakeTeacherTour,
  physicalSide,
  routeForStep,
  teacherTourSteps,
  tourLocaleKeys,
  type TourStep,
} from '../src/components/tour/steps/teacherTour.ts'

const ROOT = new URL('../../', import.meta.url).pathname
const LANGUAGES = ['he', 'en', 'ar'] as const

const messages = Object.fromEntries(
  LANGUAGES.map((language) => [
    language,
    JSON.parse(readFileSync(join(ROOT, 'locales', `${language}.json`), 'utf8')) as
      Record<string, string>,
  ])
)

/** Every `data-tour="..."` value present anywhere in the app source. */
function collectTourTargets(): Set<string> {
  const found = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!/\.tsx?$/.test(entry.name)) continue
      const source = readFileSync(path, 'utf8')
      for (const match of source.matchAll(/data-tour="([^"]+)"/g)) found.add(match[1])
    }
  }
  walk(join(ROOT, 'frontend', 'src'))
  return found
}

test('every step key exists in all three locales', () => {
  for (const key of tourLocaleKeys()) {
    for (const language of LANGUAGES) {
      const value = messages[language][key]
      assert.ok(value, `${key} missing from ${language}.json`)
      assert.ok(value.trim().length > 0, `${key} is empty in ${language}.json`)
    }
  }
})

test('the progress label interpolates the same params in every language', () => {
  for (const language of LANGUAGES) {
    const value = messages[language]['tour.progress']
    assert.match(value, /\{current\}/, `${language} lost {current}`)
    assert.match(value, /\{total\}/, `${language} lost {total}`)
  }
})

test('every targeted element actually exists in the source', () => {
  const targets = collectTourTargets()
  for (const step of teacherTourSteps) {
    if (!step.target) continue
    assert.ok(
      targets.has(step.target),
      `step "${step.id}" points at data-tour="${step.target}", which no component renders`
    )
  }
})

test('step ids are unique — the provider indexes by position, not id', () => {
  const ids = teacherTourSteps.map((step) => step.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('the tour opens on a centred card, so it never depends on a fetch', () => {
  assert.equal(teacherTourSteps[0].target, null)
  assert.equal(teacherTourSteps[0].placement, 'center')
})

test('only an account that can open /teacher is offered the teacher tour', () => {
  assert.equal(canTakeTeacherTour(['teacher']), true)
  assert.equal(canTakeTeacherTour(['teacher', 'admin']), true)
  // App.tsx guards /teacher on the teacher role alone, so an admin-only account
  // gets an error page there — a tour would walk them through screens they
  // cannot open.
  assert.equal(canTakeTeacherTour(['admin']), false)
  assert.equal(canTakeTeacherTour(['learner']), false)
  assert.equal(canTakeTeacherTour([]), false)
  assert.equal(canTakeTeacherTour(undefined), false)
})

test('placement mirrors under RTL', () => {
  assert.equal(physicalSide('start', false), 'left')
  assert.equal(physicalSide('start', true), 'right')
  assert.equal(physicalSide('end', false), 'right')
  assert.equal(physicalSide('end', true), 'left')
  // Vertical placement has no direction and must NOT flip.
  assert.equal(physicalSide('top', true), 'top')
  assert.equal(physicalSide('bottom', true), 'bottom')
  assert.equal(physicalSide('center', true), 'center')
})

test('a student-scoped step resolves to null when there is no student', () => {
  const step = teacherTourSteps.find((s) => s.route?.includes(STUDENT_TOKEN))
  assert.ok(step, 'expected at least one student-scoped step')
  // null is the signal the provider skips on — not a route containing the
  // literal token, which would navigate to `/teacher/student/:studentId`.
  assert.equal(routeForStep(step as TourStep, { studentId: null }), null)
  assert.equal(routeForStep(step as TourStep, {}), null)
})

test('a student-scoped step resolves and url-encodes the id', () => {
  const step = teacherTourSteps.find((s) => s.route?.includes(STUDENT_TOKEN)) as TourStep
  assert.equal(routeForStep(step, { studentId: 'demo-shir' }), '/teacher/student/demo-shir')
  assert.equal(
    routeForStep(step, { studentId: 'a/b' }), '/teacher/student/a%2Fb',
    'an id with a slash must not invent a route segment'
  )
})

test('a step with no route stays where it is', () => {
  const step = teacherTourSteps.find((s) => !s.route)
  assert.ok(step, 'expected at least one route-less step (the app-bar steps)')
  assert.equal(routeForStep(step as TourStep, { studentId: 'x' }), undefined)
})

test('every route the tour navigates to is a real teacher route', () => {
  for (const step of teacherTourSteps) {
    if (!step.route) continue
    const resolved = step.route.replace(STUDENT_TOKEN, 'someone')
    assert.match(
      resolved, /^\/teacher(\/students|\/student\/[^/]+)?$/,
      `step "${step.id}" navigates to ${resolved}, which App.tsx does not route`
    )
  }
})
