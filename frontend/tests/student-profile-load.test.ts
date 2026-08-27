/* How the student profile arrives, and what it arrives on.
 *
 *   node --test frontend/tests/
 *
 * Two things here are easy to undo by accident and impossible to notice in a
 * diff, because both fail by looking *fine*:
 *
 * The page is six requests, not one. It used to hold everything behind the
 * slowest of them — one `if (isLoading) return` at the top, and a teacher
 * watched a grey card until the last fetch answered. Restoring that gate is a
 * two-line change that reviews cleanly and silently costs the whole stream.
 *
 * And the header no longer sits on a card. A card is the default in this
 * codebase — every panel has one — so the surface tends to grow back.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../src/features/teacher-app/student/', import.meta.url))
const page = readFileSync(`${dir}TeacherStudentPage.tsx`, 'utf8')
const css = readFileSync(`${dir}teacher-student.css`, 'utf8')

/** One CSS rule's declarations, comments stripped. */
function rule(selector: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const match = source.match(
    new RegExp(`(^|})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm'))
  return match ? match[2] : ''
}

describe('the profile streams in', () => {

  it('has exactly one render path, not a loading page and a real one', () => {
    /* The root element is written once. A second `.tch-student` root is the
       signature of a whole-page loading branch — the very thing that made
       the identity, the dials and the topics all wait on each other. */
    const roots = page.match(/className="tch-student"/g) ?? []
    assert.equal(roots.length, 1,
                 `found ${roots.length} page roots; a second one is a whole-page gate`)
  })

  it('never blocks the page on one request finishing', () => {
    const body = page.slice(0, page.indexOf('/* ── the page on its way in'))
    assert.ok(!/if\s*\(\s*isLoading\s*\)/.test(body),
              'the page gates its whole render on a loading flag again')
  })

  it('waits per section, and each wait is shaped', () => {
    for (const placeholder of ['StatusBandSkeleton', 'RecsPanelSkeleton', 'MoreDoorsSkeleton']) {
      assert.ok(page.includes(`function ${placeholder}`), `${placeholder} is gone`)
      assert.ok(page.includes(`<${placeholder}`), `${placeholder} is defined but never rendered`)
    }
  })

  it('prints the headings it already knows instead of greying them', () => {
    /* A placeholder that greys out a caption it could simply print teaches
       the teacher nothing while they wait. These four are true before any
       request answers, so they are rendered as words in the skeletons. */
    const skeletons = page.slice(page.indexOf('/* ── the page on its way in'))
    for (const key of ['tch.student.focusTitle', 'tch.student.concentration',
                       'tch.student.independence', 'tch.student.recommendations']) {
      assert.ok(skeletons.includes(key), `the placeholders no longer print ${key}`)
    }
    /* And the KPI captions, which live in the hero itself. */
    for (const key of ['tch.kpi.learningMinutes', 'tch.kpi.questionsWorked', 'tch.kpi.helpUsed']) {
      assert.ok(page.includes(key), `the KPI strip no longer names ${key}`)
    }
  })

  it('reads the name from the roster rather than waiting for the fetch', () => {
    // The roster resolved every child in this teacher's classes before this
    // page was opened; waiting for `display_name` re-asks a known question.
    assert.ok(/nameOf\(learnerId\)/.test(page), 'the header waits on the detail for the name')
  })
})

describe('the header sits on the page, not on a card', () => {
  const head = rule('.tch-student__head')

  it('carries no surface of its own', () => {
    for (const property of ['background', 'border', 'box-shadow', 'padding']) {
      assert.ok(!new RegExp(`(^|;)\\s*${property}\\s*:`).test(head),
                `.tch-student__head declares ${property} again: ${head.trim()}`)
    }
  })

  it('still owns its own spacing', () => {
    assert.ok(/gap\s*:/.test(head) && /margin-block-end\s*:/.test(head),
              'the header lost the spacing that separated it from the band')
  })

  it('lifts its placeholders off the page tint', () => {
    /* The shared skeleton is drawn from the tints just either side of a
       CARD's white. With no card under the hero it vanished entirely — the
       name and the three figures were loading in invisible ink. */
    assert.ok(css.includes('.tch-student__head .sp-skeleton'),
              'hero placeholders are back to the card-surface gradient')
  })
})
