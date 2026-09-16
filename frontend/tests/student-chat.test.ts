/* The child's chat with their teachers, reshaped as a messenger.
 *
 *   node --test frontend/tests/
 *
 * Source-level checks, like learner-load.test.ts: no hero and no card around
 * the chat; my lines on the right and the teacher's on the left, physically,
 * in every language; the three loads leave together and what was on screen
 * last time is shown at once; summaries join their teacher by id before name;
 * a line said to a sub-group says so.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const pane = read('../src/features/student-dashboard/StudentConnectionsPane.tsx')
const css = read('../src/features/student-dashboard/student-connections.css')
const locales = ['he', 'en', 'ar'].map((code) => [code, JSON.parse(read(`../../locales/${code}.json`))] as const)

describe('the page is the chat', () => {
  it('has no hero and no card frame', () => {
    assert.doesNotMatch(pane, /sdash\.chat\.title|sdash\.chat\.subtitle|sd-connections__heading/)
    assert.doesNotMatch(css, /\.sd-chat-window\b/)
    // the page is a column of FIXED height, so the thread scrolls inside
    // itself and the composer never leaves the screen
    assert.match(css, /\.sd-connections-page \{[^}]*flex-direction: column/)
    assert.match(css, /\.sd-connections-page \{[^}]*block-size: 100dvh/)
    assert.doesNotMatch(css, /\.sd-connections-page \{[^}]*min-block-size: 100dvh/)
    assert.match(css, /\.sd-chat \{[^}]*flex: 1/)
  })

  it('keeps the rail on the reading-start side and the thread scrolling inside itself', () => {
    assert.match(css, /\.sd-chat \{[^}]*grid-template-columns: minmax\(240px, 320px\) minmax\(0, 1fr\)/)
    assert.match(css, /\.sd-chat__body \{[^}]*overflow-y: auto/)
  })
})

describe('bubbles', () => {
  it('put my lines on the right and the teacher\'s on the left, physically', () => {
    const me = css.match(/\.sd-msg--me \{[^}]*\}/)?.[0] ?? ''
    const them = css.match(/\.sd-msg--them \{[^}]*\}/)?.[0] ?? ''
    assert.match(me, /margin-left: auto/)
    assert.match(me, /margin-right: 0/)
    assert.match(them, /margin-right: auto/)
    assert.match(them, /margin-left: 0/)
    // and never re-mirrored per language
    assert.doesNotMatch(css, /\[dir='rtl'\] \.sd-msg/)
  })

  it('separate days and stamp each line with its time', () => {
    assert.match(pane, /className="sd-day" role="separator"/)
    assert.match(pane, /<time dateTime=\{message\.created_at\}>/)
  })

  it('say when a line was said to a whole sub-group', () => {
    assert.match(pane, /message\.subgroup_name \?/)
    assert.match(pane, /t\('sdash\.chat\.toSubgroup', \{ name: message\.subgroup_name \}\)/)
  })
})

describe('loading', () => {
  it('sends the three requests before waiting on any of them', () => {
    const effect = pane.slice(pane.indexOf('const rosterRequest = getMyTeachers()'))
    const firstThen = effect.indexOf('.then(')
    assert.ok(effect.indexOf('const rowsRequest = listMentoring()') < firstThen)
    assert.ok(effect.indexOf('const unreadRequest = getMyUnread()') < firstThen)
  })

  it('shows skeletons in place, never an empty page and never a spinner', () => {
    assert.match(pane, /function RailSkeleton\(\)/)
    assert.match(pane, /function ThreadSkeleton\(\)/)
    assert.match(pane, /role="status" aria-busy="true"/)
    assert.doesNotMatch(pane, /LoadingState/)
  })

  it('remembers what was on screen across remounts', () => {
    assert.match(pane, /const remembered: Remembered = \{/)
    assert.match(pane, /useState<MyTeacher\[\] \| null>\(\(\) => memory\.roster\)/)
    assert.match(pane, /memory\.messages\[teacherId\] \?\? null/)
  })
})

describe('the rail', () => {
  it('joins a summary to its teacher by id before name', () => {
    const join = pane.slice(pane.indexOf('const home ='), pane.indexOf('if (home)'))
    assert.ok(join.indexOf('row.teacher_id') < join.indexOf('row.teacher_name'))
  })

  it('gives old summaries to the one teacher when there is exactly one', () => {
    assert.match(pane, /if \(orphans\.length && teachers\.length === 1\)/)
  })

  it('splits teachers from groups with a tab strip that marks unread on the other tab', () => {
    assert.match(pane, /t\('sdash\.chat\.section\.teachers'\)/)
    assert.match(pane, /t\('sdash\.chat\.section\.groups'\)/)
    assert.match(pane, /className="sd-chat__tabs" role="tablist"/)
    assert.match(pane, /entry\.unread \? <span className="sd-chat__tabDot"/)
    // a group's badge is its own count; a teacher's is the rest of their thread
    assert.match(pane, /unread\.groups\[chat\.subgroupId\]/)
    assert.match(pane, /\(unread\.teachers\[chat\.teacherId\] \?\? 0\) - inGroups/)
    // and reading one chat receipts only what it shows
    assert.match(pane, /markMyMessagesRead\(teacherId, chat\.kind === 'group' && chat\.subgroupId \? \{ subgroup: chat\.subgroupId \} : 'private'\)/)
    assert.match(pane, /if \(chat\.kind === 'group'\) return chat\.members\.join\(', '\)/)
    // a teacher's card and header carry the name alone
    assert.match(pane, /return null\n  \}\n\n  \/\* Two tabs/)
  })

  it('opens at the newest line, before paint', () => {
    assert.match(pane, /useLayoutEffect\(\(\) => \{\n    if \(!bodyRef\.current\) return/)
    assert.match(css, /scrollbar-gutter: stable/)
  })

  it('makes a group chat for every sub-group I am in, with no box of its own', () => {
    assert.match(pane, /for \(const subgroup of teacher\.subgroups \?\? \[\]\)/)
    assert.match(pane, /kind: 'group'/)
    assert.match(pane, /message\.subgroup_id === chat\.subgroupId/)
    assert.match(pane, /t\('sdash\.chat\.groupReply', \{ teacher: chat\.teacherName \}\)/)
  })

  it('has every new string in all three languages', () => {
    for (const key of ['history', 'toSubgroup', 'summary', 'today', 'yesterday', 'noTeachers', 'kind.groupFallback', 'groupNote', 'groupReply', 'section.teachers', 'section.groups', 'groupEmpty', 'groupEmptyBody', 'tabUnread']) {
      for (const [code, strings] of locales) {
        assert.ok(typeof strings[`sdash.chat.${key}`] === 'string', `${code}: sdash.chat.${key}`)
      }
    }
  })
})
