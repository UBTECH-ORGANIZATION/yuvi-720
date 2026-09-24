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
const bell = read('../src/components/NotificationBell.tsx')
const teacherBarCss = read('../src/components/teacher-app-bar.css')

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

  it('explains task and notification badges on hover and keyboard focus', () => {
    assert.match(appBar, /<Hint[\s\S]{0,180}sdash\.nav\.openTasks/)
    assert.match(bell, /<Hint[\s\S]{0,180}notif\.unreadCount/)
  })

  it('moves teacher scope controls onto their own compact row', () => {
    assert.match(read('../src/components/AppBar.tsx'), /className="app-bar-leading">\{leading\}/)
    assert.match(teacherBarCss, /\.app-bar\.is-compact \.app-bar-leading[\s\S]{0,180}grid-row: 2/)
    assert.match(teacherBarCss, /\.app-bar\.is-compact \.tch-scope[\s\S]{0,180}inline-size: 100%/)
  })

  it('bounds loaded teacher search controls and overlays in the compact header', () => {
    assert.match(teacherBarCss, /\.app-bar\.is-compact \.tch-search__btn \{[^}]*max-inline-size: 36px/)
    assert.match(teacherBarCss, /\.app-bar\.is-compact \.tch-search__btn > span \{\s*display: none/)
    assert.match(teacherBarCss, /\.app-bar\.is-compact \.notif__panel \{[^}]*inset-block-start: calc\(100% \+ 8px\);[^}]*inset-inline: 16px/)
  })
})
