/* The client half of the PII boundary.
 *
 *   node --test frontend/tests/
 *
 * The backend guarantees the model is never sent a student's name
 * (`backend/tests/test_teacher_tools_auth.py`). That guarantee is only useful
 * if the teacher still sees names — which happens here, by substituting
 * `{{student:<id>}}` against the roster already in the browser.
 *
 * The failure this guards against: a teacher reading "how is kid-7f3a doing?"
 * and having no idea which child that is.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseBlocks } from '../src/components/richText/blocks.ts'
import {
  isSafeAssistantRoute, labelFor, parseStudentRefs, trimPartialMarkers,
} from '../src/features/teacher-app/assistant/studentRefs.ts'

describe('finding student references in assistant text', () => {
  it('splits a marker out of the surrounding sentence', () => {
    const segments = parseStudentRefs('היום {{student:kid-1}} התקדם יפה.')
    assert.deepEqual(segments, [
      { kind: 'text', text: 'היום ' },
      { kind: 'student', learnerId: 'kid-1' },
      { kind: 'text', text: ' התקדם יפה.' },
    ])
  })

  it('handles several students in one answer', () => {
    const segments = parseStudentRefs('{{student:a}} ו-{{student:b}}')
    assert.deepEqual(
      segments.filter((s) => s.kind === 'student').map((s) => s.learnerId),
      ['a', 'b']
    )
  })

  it('leaves text with no markers untouched', () => {
    const segments = parseStudentRefs('אין נתונים על הקבוצה הזו.')
    assert.deepEqual(segments, [{ kind: 'text', text: 'אין נתונים על הקבוצה הזו.' }])
  })

  it('is not confused by a second call', () => {
    // The marker regex is /g and module-level: forgetting to reset lastIndex
    // makes every second render silently drop the first reference.
    const first = parseStudentRefs('{{student:kid-1}}')
    const second = parseStudentRefs('{{student:kid-1}}')
    assert.deepEqual(first, second)
  })

  it('treats an empty marker as literal text, not a reference to nobody', () => {
    const segments = parseStudentRefs('{{student:}}')
    assert.deepEqual(segments, [{ kind: 'text', text: '{{student:}}' }])
  })

  it('trims whitespace the model may have added inside the marker', () => {
    const segments = parseStudentRefs('{{student: kid-1 }}')
    assert.deepEqual(segments, [{ kind: 'student', learnerId: 'kid-1' }])
  })
})

describe('what the teacher actually reads', () => {
  it('shows the real name when the roster has it', () => {
    assert.equal(labelFor('kid-1', 'רון'), 'רון')
  })

  it('falls back to the id rather than leaking template syntax', () => {
    // Roster not loaded, or the model invented an id. Either way the teacher
    // sees something inert — never `{{student:...}}`.
    assert.equal(labelFor('kid-7f3a', null), 'kid-7f3a')
    assert.equal(labelFor('kid-7f3a', undefined), 'kid-7f3a')
    assert.equal(labelFor('kid-7f3a', '   '), 'kid-7f3a')
  })
})

describe('emphasis the model writes without being asked', () => {
  it('turns **bold** into a bold segment rather than literal asterisks', () => {
    // Chat models reach for markdown reflexively. Left alone, a teacher reads
    // "**5 כישלונות רצופים**" with the asterisks still in it.
    const segments = parseStudentRefs('ראיה: **5 כישלונות רצופים**')
    assert.deepEqual(segments, [
      { kind: 'text', text: 'ראיה: ' },
      { kind: 'bold', text: '5 כישלונות רצופים' },
    ])
  })

  it('handles bold and a student reference in the same line', () => {
    const segments = parseStudentRefs('{{student:kid-1}} — **12 כישלונות**')
    assert.deepEqual(segments.map((s) => s.kind), ['student', 'text', 'bold'])
  })

  it('leaves a lone asterisk alone', () => {
    // Not a markdown renderer: anything that is not clearly emphasis stays
    // literal, which is the safe direction.
    const segments = parseStudentRefs('3 * 4 = 12')
    assert.deepEqual(segments, [{ kind: 'text', text: '3 * 4 = 12' }])
  })

  it('does not span a line break', () => {
    const segments = parseStudentRefs('**a\nb**')
    assert.deepEqual(segments, [{ kind: 'text', text: '**a\nb**' }])
  })
})

describe('the shape of an answer', () => {
  it('keeps a paragraph whole', () => {
    const blocks = parseBlocks('טל לא נכנס כבר שישה ימים.\nכדאי לפנות אליו.')
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].kind, 'paragraph')
  })

  it('splits paragraphs on a blank line', () => {
    const blocks = parseBlocks('שורה ראשונה.\n\nשורה שנייה.')
    assert.deepEqual(blocks.map((b) => b.kind), ['paragraph', 'paragraph'])
  })

  it('turns a run of dashes into one list, not four paragraphs', () => {
    // The whole point: pre-wrap made a list look like a wall of hyphens.
    const blocks = parseBlocks('שלושה דברים:\n- אחד\n- שניים\n- שלושה')
    assert.deepEqual(blocks.map((b) => b.kind), ['paragraph', 'list'])
    assert.equal(blocks[1].kind === 'list' && blocks[1].items.length, 3)
  })

  it('parses student references inside a bullet', () => {
    const blocks = parseBlocks('- {{student:kid-1}} צריך תשומת לב')
    assert.equal(blocks[0].kind, 'list')
    assert.equal(
      blocks[0].kind === 'list' && parseStudentRefs(blocks[0].items[0])[0].kind, 'student'
    )
  })

  it('keeps a student reference inside a table cell', () => {
    // The teacher surface gained tables; the chips have to survive them.
    const blocks = parseBlocks(
      '| תלמיד | כניסה |\n| --- | --- |\n| {{student:kid-1}} | לפני שבוע |'
    )
    assert.equal(blocks[0].kind, 'table')
    assert.equal(
      blocks[0].kind === 'table' && parseStudentRefs(blocks[0].rows[0][0])[0].kind, 'student'
    )
  })

  it('returns nothing for an empty answer', () => {
    assert.deepEqual(parseBlocks(''), [])
  })
})

describe('text arriving one chunk at a time', () => {
  it('hides a marker the stream has not closed yet', () => {
    // Streaming renders every keystroke. Without this the teacher watches
    // `{{student:demo-t` type itself out before snapping to a name.
    assert.equal(trimPartialMarkers('היום {{student:demo-t'), 'היום ')
  })

  it('leaves a closed marker alone', () => {
    const text = 'היום {{student:kid-1}} התקדם'
    assert.equal(trimPartialMarkers(text), text)
  })

  it('holds back an unclosed bold rather than showing the asterisks', () => {
    assert.equal(trimPartialMarkers('הצעד הבא הוא **מערכת'), 'הצעד הבא הוא ')
  })

  it('keeps a closed bold', () => {
    const text = 'הצעד הבא הוא **מערכת צירים**'
    assert.equal(trimPartialMarkers(text), text)
  })

  it('does not eat a finished answer', () => {
    const text = 'טל לא נכנס כבר שישה ימים.'
    assert.equal(trimPartialMarkers(text), text)
  })

  it('holds back a table until its separator row has arrived', () => {
    // Otherwise the teacher watches a row of broken pipes assemble itself.
    assert.equal(trimPartialMarkers('הנה ההשוואה:\n| תלמיד | כנ'), 'הנה ההשוואה:')
  })

  it('shows a table as soon as it is a table', () => {
    const text = '| תלמיד | כניסה |\n| --- | --- |\n| א | ב |\n'
    assert.equal(trimPartialMarkers(text), text)
  })
})

describe('routes a chat action may navigate to', () => {
  it('accepts the teacher lane', () => {
    assert.ok(isSafeAssistantRoute('/teacher/students?filter=attention'))
    assert.ok(isSafeAssistantRoute('/teacher'))
    assert.ok(isSafeAssistantRoute('/admin'))
  })

  it('rejects a protocol-relative URL, which a naive slash check lets through', () => {
    // `//evil.example/x` starts with "/" and is an absolute cross-origin URL.
    assert.equal(isSafeAssistantRoute('//evil.example/teacher'), false)
  })

  it('rejects anything outside the teacher lane', () => {
    assert.equal(isSafeAssistantRoute('https://evil.example'), false)
    assert.equal(isSafeAssistantRoute('/student-dashboard'), false)
    assert.equal(isSafeAssistantRoute('/teacherX'), false)
    assert.equal(isSafeAssistantRoute(undefined), false)
    assert.equal(isSafeAssistantRoute(''), false)
  })
})
