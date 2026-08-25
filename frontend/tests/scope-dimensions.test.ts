/* What each teacher route actually narrows by.
 *
 *   node --test frontend/tests/
 *
 * The bar shows class and subject on every screen — hiding the segments a
 * screen could not use was worse than the problem it solved, because a control
 * that vanishes is indistinguishable from one that is broken.
 *
 * So this table no longer decides visibility. It decides two other things: what
 * a screen filters, and which set-but-unused dimension it has to ANNOUNCE. That
 * second job is the guard on a failure that shipped once and survived review —
 * `/groups/{id}/snapshot` declared a `subject` parameter, `group_insights` had
 * none, and Home and the roster sent a filter nowhere. Invisible only because
 * the subject was permanently null; with a lit chip above it, it would have
 * been a lie a teacher could read.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { narrowsBy } from '../src/components/scope/scopeDimensions.ts'

const app = readFileSync(
  fileURLToPath(new URL('../src/app/App.tsx', import.meta.url)), 'utf8')

/** `[path, class, subgroup, subject]` — one row per screen `pageForRoute` can
    reach. `false` does not mean "hidden": it means the screen does not narrow
    by it, and must say so when it is set. */
const TABLE: [string, boolean, boolean, boolean][] = [
  ['/teacher',                          true,  true,  false],
  ['/teacher/students',                 true,  true,  false],
  ['/teacher/student/kid-1',            false, false, true],
  ['/teacher/goals',                    true,  true,  false],
  ['/teacher/calendar',                 true,  true,  false],
  ['/teacher/learnings',                true,  false, true ],
  ['/teacher/learnings/g-1/cmp-1',      true,  false, false],
  ['/teacher/messages',                 true,  true,  false],
  ['/teacher/tasks',                    true,  false, true ],
  ['/teacher/tasks/t-1',                true,  true,  false],
  ['/teacher/tasks/t-1/review',         true,  false, false],
  ['/admin',                            false, false, false],
]

describe('every teacher route says what it narrows by', () => {

  for (const [path, klass, subgroup, subject] of TABLE) {
    it(`${path}`, () => {
      assert.deepEqual(narrowsBy(path), { class: klass, subgroup, subject })
    })
  }

  it('covers every teacher prefix App.tsx can route to', () => {
    /* The real coupling: a route added to `pageForRoute` without a line in
       `scopeDimensions` gets the fallthrough, which is a quiet answer rather
       than a wrong one — but it is still an answer nobody chose. */
    const prefixes = [...app.matchAll(/pathname\.startsWith\('(\/(?:teacher|admin)[^']*)'\)/g)]
      .map((match) => match[1])
    assert.ok(prefixes.length >= 10, `only found ${prefixes.length} teacher prefixes`)
    const covered = new Set(TABLE.map(([path]) => path))
    for (const prefix of prefixes) {
      const sample = prefix.endsWith('/') ? `${prefix}sample` : prefix
      assert.ok([...covered].some((path) => path === sample || path.startsWith(prefix)),
                `${prefix} is routable but not in the scope table`)
    }
  })
})

describe('what it does with a route it does not know', () => {

  it('answers like Home, because Home is what renders there', () => {
    /* `pageForRoute` falls through to `<TeacherHomePage />` for anything under
       `/teacher` it does not recognise, so this is the truthful answer rather
       than a cautious one — the bar must describe the screen actually on
       display. The guard against a forgotten route is the coverage test above,
       not this fallthrough. */
    assert.deepEqual(narrowsBy('/teacher/whatever-ships-next'),
                     narrowsBy('/teacher'))
  })

  it('offers nothing outside the teacher portal', () => {
    for (const path of ['/', '/tasks', '/student-dashboard', '/badges', '']) {
      assert.deepEqual(narrowsBy(path), { class: false, subgroup: false, subject: false },
                       path)
    }
  })
})

describe('the path is the only thing it reads', () => {

  it('ignores the query string and the hash', () => {
    /* Scope travels in path segments and is adopted into the provider; the
       query string stays transient screen state. If `?subject=` could change
       which controls appear, a shared link would silently re-scope the whole
       portal of whoever opened it — scope persists to the user document. */
    assert.deepEqual(narrowsBy('/teacher/students?view=cards&filter=attention'),
                     narrowsBy('/teacher/students'))
    assert.deepEqual(narrowsBy('/teacher/students#top'),
                     narrowsBy('/teacher/students'))
  })

  it('reads a trailing slash as the same screen', () => {
    assert.deepEqual(narrowsBy('/teacher/goals/'), narrowsBy('/teacher/goals'))
  })

  it('answers a bare /teacher/student the way App.tsx routes it', () => {
    // With no id, `pageForRoute` falls through to Home. A profile's answer
    // there would hide the class picker on the dashboard.
    assert.deepEqual(narrowsBy('/teacher/student'), narrowsBy('/teacher'))
  })
})

describe('the screens that must announce a filter they ignore', () => {

  it('names them, so a silent drop is a test failure and not a support ticket', () => {
    /* Every `false` here is a promise that the screen prints a line. Home and
       the roster are class-wide whatever the subject says, because "who needs
       attention, in maths" has no defined meaning yet — that is deferred, and
       deferring it honestly costs one sentence on the screen. */
    assert.equal(narrowsBy('/teacher').subject, false)
    assert.equal(narrowsBy('/teacher/students').subject, false)
    /* Home narrows by sub-group since #450: the students band card filters to
       it client-side and says so; the KPIs, live card and gaps stay class-wide
       aggregates. */
    assert.equal(narrowsBy('/teacher').subgroup, true)
    // The learnings fold is class-wide, so a sub-group cannot narrow it exactly.
    assert.equal(narrowsBy('/teacher/learnings').subgroup, false)
    /* A class-wide task still belongs to the sub-group's children — a task-list
       filter would either hide their work or hide nothing. */
    assert.equal(narrowsBy('/teacher/tasks').subgroup, false)
    // One task already has a subject; narrowing its cohort by another is noise.
    assert.equal(narrowsBy('/teacher/tasks/t-1').subject, false)
  })

  it('and the screens that do narrow make no such promise', () => {
    assert.equal(narrowsBy('/teacher/learnings').subject, true)
    assert.equal(narrowsBy('/teacher/tasks').subject, true)
    assert.equal(narrowsBy('/teacher/student/kid-1').subject, true)
  })
})
