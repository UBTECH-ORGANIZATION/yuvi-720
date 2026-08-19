/* Which scope controls each teacher route is allowed to show.
 *
 *   node --test frontend/tests/
 *
 * This is the guard on a failure that already shipped once and survived review:
 * `/groups/{id}/snapshot` declared a `subject` parameter, `group_insights` had
 * none, and Home and the roster both sent a filter that went nowhere. It was
 * invisible only because the scope subject was permanently null.
 *
 * So the table is asserted route by route rather than spot-checked. A control
 * the bar shows is a promise that the screen behind it narrows.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { dimensionsFor } from '../src/components/scope/scopeDimensions.ts'

const app = readFileSync(
  fileURLToPath(new URL('../src/app/App.tsx', import.meta.url)), 'utf8')

/** `[path, class, subgroup, subject]` — one row per screen `pageForRoute` can
    reach, written the way the plan's adoption table reads. */
const TABLE: [string, boolean, boolean, boolean][] = [
  ['/teacher',                          true,  true,  false],
  ['/teacher/students',                 true,  true,  false],
  ['/teacher/student/kid-1',            false, false, true],
  ['/teacher/goals',                    true,  true,  false],
  ['/teacher/calendar',                 true,  true,  false],
  ['/teacher/learnings',                true,  true,  false],
  ['/teacher/learnings/g-1/cmp-1',      true,  true,  false],
  ['/teacher/messages',                 true,  true,  false],
  ['/teacher/tasks',                    true,  true,  false],
  ['/teacher/tasks/t-1',                true,  true,  false],
  ['/teacher/tasks/t-1/review',         true,  false, false],
  ['/admin',                            false, false, false],
]

describe('every teacher route says what it narrows by', () => {

  for (const [path, klass, subgroup, subject] of TABLE) {
    it(`${path}`, () => {
      assert.deepEqual(dimensionsFor(path), { class: klass, subgroup, subject })
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
    assert.deepEqual(dimensionsFor('/teacher/whatever-ships-next'),
                     dimensionsFor('/teacher'))
  })

  it('offers nothing outside the teacher portal', () => {
    for (const path of ['/', '/tasks', '/student-dashboard', '/badges', '']) {
      assert.deepEqual(dimensionsFor(path), { class: false, subgroup: false, subject: false },
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
    assert.deepEqual(dimensionsFor('/teacher/students?view=cards&filter=attention'),
                     dimensionsFor('/teacher/students'))
    assert.deepEqual(dimensionsFor('/teacher/students#top'),
                     dimensionsFor('/teacher/students'))
  })

  it('reads a trailing slash as the same screen', () => {
    assert.deepEqual(dimensionsFor('/teacher/goals/'), dimensionsFor('/teacher/goals'))
  })

  it('answers a bare /teacher/student the way App.tsx routes it', () => {
    // With no id, `pageForRoute` falls through to Home. A profile's answer
    // there would hide the class picker on the dashboard.
    assert.deepEqual(dimensionsFor('/teacher/student'), dimensionsFor('/teacher'))
  })
})

describe('the two subjects that are switched off on purpose', () => {

  it('leaves learnings and the task list to their own chips, for now', () => {
    /* Both screens still carry their own subject filter. Two controls for one
       filter is worse than one control in the wrong place, so the bar stays
       quiet until those chips are deleted — and this test is what fails when
       they are, so the flip cannot be forgotten. */
    assert.equal(dimensionsFor('/teacher/learnings').subject, false)
    assert.equal(dimensionsFor('/teacher/tasks').subject, false)
  })
})
