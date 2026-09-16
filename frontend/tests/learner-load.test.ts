/* Going back and forth between learner screens must not re-load what did
 * not change.
 *
 *   node --test frontend/tests/
 *
 * Every page remounts on navigation (App.tsx keys the route element by
 * path). These are the places that used to turn that into requests: the
 * coach history effect keyed on the route, the app bar's counts re-fetched
 * on every remount, and two polls that duplicated a push the server already
 * sends.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const companion = read('../src/providers/CompanionProvider.tsx')
const lesson = read('../src/features/learning-lesson/LessonPage.tsx')
const appBar = read('../src/components/LearnerAppBar.tsx')

describe('the coach panel survives navigation', () => {
  it('does not reload its history because the route changed', () => {
    const effect = companion.split('const initialize = async () => {')[1].split('const loadMoreConversations')[0]
    const deps = effect.slice(effect.lastIndexOf('}, ['))
    assert.doesNotMatch(deps, /\bpathname\b/)
    assert.match(deps, /lessonEpoch/)
    assert.match(deps, /conversationMode/)
  })

  it('reconciles support state every ten seconds, not every 2.5', () => {
    assert.match(companion, /setInterval\(tick, 10_000\)/)
    assert.doesNotMatch(companion, /setInterval\(tick, 2500\)/)
  })
})

describe('the lesson page trusts the completion push', () => {
  it('keeps the catalog poll as a thirty-second safety net', () => {
    assert.match(lesson, /const COMPLETION_POLL_MS = 30_000/)
    // the push it relies on is still wired
    assert.match(companion, /trigger\.type === 'completion'/)
    assert.match(lesson, /yuvilab:xapi-completion/)
  })
})

describe('the learner app bar remembers its counts across a remount', () => {
  it('shows the last answer at once and re-asks after a minute or a lane change', () => {
    assert.match(appBar, /const COUNT_FRESH_MS = 60_000/)
    assert.match(appBar, /useState\(\(\) => fresh\('unread', onChat\) \?\? 0\)/)
    assert.match(appBar, /useState\(\(\) => fresh\('tasks', onTasks\) \?\? 0\)/)
    assert.match(appBar, /if \(fresh\('unread', onChat\) === null\) read\(\)/)
    assert.match(appBar, /if \(fresh\('tasks', onTasks\) === null\) read\(\)/)
  })
})
