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
  teacherTour,
  teacherTourSteps,
  type TourStep,
} from '../src/components/tour/steps/teacherTour.ts'
import {
  LEARNER_TOUR_ID, canTakeLearnerTour, learnerTour, learnerTourSteps,
} from '../src/components/tour/steps/learnerTour.ts'
import {
  LESSON_ROUTE, LESSON_TOUR_ID, canTakeLessonTour, lessonTour, lessonTourSteps,
} from '../src/components/tour/steps/lessonTour.ts'
import { needsStudentParam, tourLocaleKeys } from '../src/components/tour/steps/types.ts'

/* Both step lists go through the same contract. Adding a tour here is what
   makes it impossible to ship one that only its author ever ran. */
const TOURS = [
  { name: 'teacher', steps: teacherTourSteps },
  { name: 'learner', steps: learnerTourSteps },
  { name: 'lesson', steps: lessonTourSteps },
]

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
  for (const tour of TOURS) {
    for (const key of tourLocaleKeys(tour.steps)) {
      for (const language of LANGUAGES) {
        const value = messages[language][key]
        assert.ok(value, `${key} missing from ${language}.json`)
        assert.ok(value.trim().length > 0, `${key} is empty in ${language}.json`)
      }
    }
  }
})

test('the welcome greeting keeps its name slot in every language', () => {
  // A locale that drops `{name}` greets a child as nobody; one that renames it
  // prints the braces at them.
  for (const key of ['tour.learner.welcome.title', 'tour.lesson.welcome.title']) {
    for (const language of LANGUAGES) {
      assert.match(
        messages[language][key], /\{name\}/,
        `${language} lost {name} from ${key}`
      )
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
  for (const tour of TOURS) {
    for (const step of tour.steps) {
      if (!step.target) continue
      assert.ok(
        targets.has(step.target),
        `${tour.name} step "${step.id}" points at data-tour="${step.target}", `
          + 'which no component renders'
      )
    }
  }
})

/** Which source directory owns each route's screen. */
const ROUTE_OWNERS: Record<string, string> = {
  '/teacher': 'features/teacher-app/home/',
  '/teacher/students': 'features/teacher-app/students/',
  '/teacher/learnings': 'features/teacher-app/learnings/',
  '/teacher/goals': 'features/teacher-app/goals/',
  '/teacher/messages': 'features/teacher-app/messages/',
  [`/teacher/student/${STUDENT_TOKEN}`]: 'features/teacher-app/student/',
  '/student-dashboard': 'features/student-dashboard/',
  '/badges': 'features/badges/',
  [LESSON_ROUTE]: 'features/learning-lesson/',
}

/** Mounted by a shell, so present on every route inside it. */
const ALWAYS_MOUNTED = ['components/', 'features/teacher-app/assistant/']

/** target → the source files that render it. */
function targetSources(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const relative = prefix + entry.name
      if (entry.isDirectory()) { walk(path, relative + '/'); continue }
      if (!/\.tsx?$/.test(entry.name)) continue
      for (const match of readFileSync(path, 'utf8').matchAll(/data-tour="([^"]+)"/g)) {
        found.set(match[1], [...(found.get(match[1]) ?? []), relative])
      }
    }
  }
  walk(join(ROOT, 'frontend', 'src'), '')
  return found
}

// The step's own `route` is optional — a step without one stays wherever the
// previous step left the tour.
function effectiveRoute(steps: TourStep[], index: number): string | null {
  for (let at = index; at >= 0; at -= 1) {
    const route = steps[at].route
    if (route) return route
  }
  return null
}

test('every target is rendered by the screen its step navigates to', () => {
  // The existence check above passes as long as *some* component renders the
  // attribute — which is how `teacher.liveNow` sat dead for a whole round,
  // pointing at /teacher while the strip it targets lived on the roster. A tour
  // step whose target never mounts is skipped in silence: no error, no warning.
  const sources = targetSources()
  for (const tour of TOURS) {
    for (const [index, step] of tour.steps.entries()) {
      if (!step.target) continue
      const route = effectiveRoute(tour.steps, index)
      // Owners are keyed by pathname; a step's route may carry a query (e.g.
      // `?view=table` opens the roster in manage mode) that the same screen owns.
      const owner = route ? ROUTE_OWNERS[route.split('?')[0]] : null
      assert.ok(owner,
        `${tour.name} step "${step.id}" declares route ${route}, which owns no screen`)

      const files = sources.get(step.target) ?? []
      const reachable = files.filter(
        (file) => file.startsWith(owner as string)
          || ALWAYS_MOUNTED.some((shared) => file.startsWith(shared))
      )
      assert.ok(
        reachable.length,
        `${tour.name} step "${step.id}" targets data-tour="${step.target}" on ${route}, `
          + `but only ${JSON.stringify(files)} renders it — it will be skipped silently`
      )
    }
  }
})

test('step ids are unique — the provider indexes by position, not id', () => {
  for (const tour of TOURS) {
    const ids = tour.steps.map((step) => step.id)
    assert.equal(new Set(ids).size, ids.length, `${tour.name} has a duplicate step id`)
  }
})

test('every tour opens on a centred card, so it never depends on a fetch', () => {
  for (const tour of TOURS) {
    assert.equal(tour.steps[0].target, null, `${tour.name} opens on a target`)
    assert.equal(tour.steps[0].placement, 'center', `${tour.name} does not open centred`)
  }
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
    const resolved = step.route.split('?')[0].replace(STUDENT_TOKEN, 'someone')
    assert.match(
      resolved, /^\/teacher(\/students|\/student\/[^/]+)?$/,
      `step "${step.id}" navigates to ${resolved}, which App.tsx does not route`
    )
  }
})

/* ── the learner tour ──────────────────────────────────────────────────────*/

test('only a learner is offered the learner tour', () => {
  assert.equal(canTakeLearnerTour(['learner']), true)
  assert.equal(canTakeLearnerTour(['teacher', 'learner']), true)
  // App.tsx bounces a non-learner off /student-dashboard, so a tour there would
  // narrate screens they are being redirected away from.
  assert.equal(canTakeLearnerTour(['teacher']), false)
  assert.equal(canTakeLearnerTour(['admin']), false)
  assert.equal(canTakeLearnerTour([]), false)
  assert.equal(canTakeLearnerTour(undefined), false)
})

test('the learner tour needs no student lookup', () => {
  /* The provider resolves that param off the TEACHER roster. If a learner step
     ever asked for it, a child's browser would call two endpoints their account
     is forbidden from, and the tour would stall waiting on the 403. */
  assert.equal(needsStudentParam(learnerTourSteps), false)
})

test('the learner tour never navigates into the studio', () => {
  // It is a lazy Three.js route behind a transition overlay that takes over the
  // URL — the tour would hand its own navigation to something else mid-flight.
  for (const step of learnerTourSteps) {
    assert.ok(
      !step.route?.startsWith('/yuvi-studio'),
      `step "${step.id}" walks into the studio; it may only spotlight the button`
    )
  }
  assert.ok(learnerTourSteps.some((step) => step.target === 'learner.studio'),
    'the studio is meant to be spotlit, and no step points at its button')
})

test('every route the learner tour navigates to is a real learner route', () => {
  for (const step of learnerTourSteps) {
    if (!step.route) continue
    assert.match(
      step.route.split('?')[0], /^\/(student-dashboard|badges)$/,
      `step "${step.id}" navigates to ${step.route}, which App.tsx does not route`
    )
  }
})

test('the learner tour flies, and its slug is versioned', () => {
  assert.equal(learnerTour.guide, 'flying')
  // Completion is permanent with no un-complete API, so re-offering a
  // redesigned tour means a new name, not a data migration.
  assert.match(LEARNER_TOUR_ID, /\.v\d+$/)
})

test('a child cannot walk out of their first run, but a teacher can', () => {
  assert.equal(learnerTour.dismissible, false)
  assert.equal(lessonTour.dismissible, false)
  assert.equal(teacherTour.dismissible, true)
})

test('only a learner is offered the lesson tour', () => {
  assert.equal(canTakeLessonTour(['learner']), true)
  assert.equal(canTakeLessonTour(['teacher']), false)
  assert.equal(canTakeLessonTour(['admin']), false)
  assert.equal(canTakeLessonTour(undefined), false)
})

test('the lesson tour flies, is versioned, and needs no student lookup', () => {
  assert.equal(lessonTour.guide, 'flying')
  assert.match(LESSON_TOUR_ID, /\.v\d+$/)
  assert.equal(needsStudentParam(lessonTourSteps), false)
})

test('the lesson tour never leaves the lesson', () => {
  /* Every step narrates something on the lesson screen. A step that navigated
     away would abandon the lesson the child had just opened — and the tour is
     not dismissible, so they could not get back to it themselves. */
  for (const step of lessonTourSteps) {
    assert.equal(step.route, LESSON_ROUTE,
      `lesson step "${step.id}" routes to ${step.route}`)
    assert.equal(step.awaitRoute, undefined,
      `lesson step "${step.id}" waits for a route change`)
  }
})

test('a step that hands over the click waits for a route the app really has', () => {
  /* `awaitRoute` suspends the step's own route enforcement. Pointed at a route
     nothing renders, the tour would sit on that step forever with no skip
     button to escape it. */
  for (const step of learnerTourSteps) {
    if (!step.awaitRoute) continue
    assert.match(step.awaitRoute, /^\/(student-dashboard|badges)$/,
      `step "${step.id}" waits for ${step.awaitRoute}, which App.tsx does not route`)
    assert.ok(step.interactive,
      `step "${step.id}" waits for a click it does not let through`)
    assert.notEqual(step.awaitRoute, step.route,
      `step "${step.id}" waits for the route it is already on`)
  }
})

test('a step that waits for a panel waits for something the app renders', () => {
  /* `awaitTarget` is the panel equivalent of `awaitRoute`, and carries the same
     risk: pointed at an attribute nothing renders, a non-dismissible tour would
     sit there forever. It must also let the click through, or the step asks for
     a press the scrim is swallowing. */
  const targets = collectTourTargets()
  for (const tour of TOURS) {
    for (const step of tour.steps) {
      if (!step.awaitTarget) continue
      assert.ok(targets.has(step.awaitTarget),
        `${tour.name} step "${step.id}" waits for data-tour="${step.awaitTarget}", `
          + 'which no component renders')
      assert.ok(step.interactive,
        `${tour.name} step "${step.id}" waits for a click it does not let through`)
      assert.notEqual(step.awaitTarget, step.target,
        `${tour.name} step "${step.id}" waits for the target it already spotlights`)
    }
  }
})
