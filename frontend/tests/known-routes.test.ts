/* Every address the app renders is an address the app admits exists.
 *
 *   node --test frontend/tests/
 *
 * `App.tsx` holds two descriptions of the same thing: `pageForRoute` decides
 * which screen an address opens, and `KNOWN_ROUTES` decides whether the address
 * is real at all. When they disagree the failure is silent and in one of two
 * shapes, both of which had already happened:
 *
 *   - Renders but is not "known" → the unknown-route effect redirects it away
 *     before it can appear. `/report` — the public report page, deliberately
 *     outside the auth guard so somebody locked out can still reach it — was
 *     unreachable for exactly this reason.
 *   - "Known" but only as a prefix over a lane with a catch-all → every typo
 *     under it silently renders the catch-all. `/teacher` was listed as a bare
 *     prefix, so `/teacher/nonsense` rendered the teacher home page under an
 *     address bar that said otherwise.
 *
 * So this reads the prefixes out of `pageForRoute` and requires the table to
 * account for each one. It is a source-level check on purpose: importing
 * `App.tsx` would pull in the entire app.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const APP = readFileSync(
  fileURLToPath(new URL('../src/app/App.tsx', import.meta.url)), 'utf8')

/** The body of `pageForRoute`, so the route tables above it are not scanned. */
function pageForRouteBody(): string {
  const start = APP.indexOf('function pageForRoute(')
  assert.ok(start > 0, 'pageForRoute has been renamed')
  const end = APP.indexOf('\n}', start)
  return APP.slice(start, end)
}

/** Every `pathname.startsWith('...')` the renderer tests, in source order. */
function renderedPrefixes(): string[] {
  const body = pageForRouteBody()
  const found = [...body.matchAll(/pathname\.startsWith\('([^']+)'\)/g)]
    .map((match) => match[1].replace(/\/+$/, ''))
  return [...new Set(found)]
}

/** The declared table, plus the one route that is exact rather than a prefix. */
function knownRoutes(): string[] {
  const block = APP.match(/const KNOWN_ROUTES = \[([\s\S]*?)\]/)
  assert.ok(block, 'KNOWN_ROUTES has been renamed or reshaped')
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

/** Mirrors `isKnownRoute`: a `/` boundary, never a bare string prefix — and
 *  `/teacher` exactly, because everything under it is a screen of its own. */
function isKnown(path: string): boolean {
  if (path === '/teacher') return true
  return knownRoutes().some(
    (route) => path === route || path.startsWith(`${route}/`))
}

describe('the route table and the renderer describe the same app', () => {
  it('admits every address pageForRoute can open', () => {
    for (const prefix of renderedPrefixes()) {
      assert.ok(isKnown(prefix), `${prefix} renders a page but is not a known route`)
    }
  })

  it('keeps the public report page reachable', () => {
    // Outside the auth guard by design, and it was being redirected to the
    // landing page by the unknown-route effect — a locked-out user's one door.
    assert.ok(isKnown('/report'))
    assert.ok(isKnown('/report/some-token'))
  })

  it('does not let a mistyped teacher URL count as a real screen', () => {
    assert.ok(isKnown('/teacher'), 'the teacher home is a screen')
    assert.ok(isKnown('/teacher/students'))
    assert.ok(isKnown('/teacher/student/gal'))
    assert.ok(isKnown('/teacher/goals'))
    assert.equal(isKnown('/teacher/nonsense'), false)
    assert.equal(isKnown('/teacher/goalsss'), false)
  })

  it('matches on segment boundaries, not on string prefixes', () => {
    assert.equal(isKnown('/tasksomething'), false)
    assert.equal(isKnown('/badgesx'), false)
    assert.ok(isKnown('/tasks/abc'))
  })

  it('lists the teacher lane screen by screen', () => {
    // The bare `/teacher` prefix is what made the catch-all swallow typos; if
    // it comes back into the table, every assertion above stops meaning
    // anything while still passing.
    assert.equal(knownRoutes().includes('/teacher'), false)
    for (const screen of ['/teacher/students', '/teacher/goals', '/teacher/tasks',
                          '/teacher/calendar', '/teacher/learnings',
                          '/teacher/messages', '/teacher/student']) {
      assert.ok(knownRoutes().includes(screen), `${screen} is missing from KNOWN_ROUTES`)
    }
  })
})
