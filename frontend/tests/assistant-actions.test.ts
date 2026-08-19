/* The chat's action layer, and the two bugs a teacher found in it.
 *
 *   node --test frontend/tests/
 *
 * Both bugs were about what a teacher *sees* rather than what the model
 * computes, which is why they survived a green backend:
 *
 *   1. `[navigate_button: תלמידים לא פעילים]` printed into an answer. No such
 *      syntax exists in this repo — the model drew a button because the prompt
 *      said "the button IS the sentence" while nothing in its transcript proved
 *      a button had rendered. Fixed at the source; stripped here as well, so a
 *      prompt regression is a failing eval and not a teacher's problem.
 *
 *   2. "הצבה ל-1 תלמידים" on the confirm button — `t()` has no plural engine,
 *      by design, so a shared `{count}` key renders broken Hebrew at one.
 *
 * The filter contract at the bottom is the third: `inactive` was a real filter
 * the assistant could offer and the roster silently ignored.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseBlocks } from '../src/components/richText/blocks.ts'
import {
  parseStudentRefs, stripPseudoWidgets,
} from '../src/features/teacher-app/assistant/studentRefs.ts'
import { countKey } from '../src/features/teacher-app/shared/countLabel.ts'
import { actionIdOf, actionKey } from '../src/features/teacher-app/assistant/actionKey.ts'
import {
  DEFAULT_SCENE, PROP_KEYS, SCENE_KEYS, isSceneKey, propFor,
} from '../src/components/yuvi-scenes/scenes.ts'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const locales = {
  he: JSON.parse(read('../../locales/he.json')) as Record<string, string>,
  en: JSON.parse(read('../../locales/en.json')) as Record<string, string>,
  ar: JSON.parse(read('../../locales/ar.json')) as Record<string, string>,
}

/** The text of every paragraph and list item, flattened. */
function plainText(answer: string): string {
  return parseBlocks(stripPseudoWidgets(answer))
    .flatMap((block) =>
      block.kind === 'list' ? block.items
        : block.kind === 'paragraph' ? [block.text] : [])
    .flatMap((text) => parseStudentRefs(text))
    .map((segment) => ('text' in segment ? segment.text : `«${segment.learnerId}»`))
    .join(' ')
}

describe('a model that draws its own buttons', () => {
  it('strips the marker a teacher actually saw', () => {
    const answer = 'אפשר לראות אותם ברשימה. [navigate_button: תלמידים לא פעילים]'
    assert.equal(plainText(answer).includes('navigate_button'), false)
    assert.equal(plainText(answer).includes('['), false)
  })

  it('strips the double-bracket form too', () => {
    assert.equal(
      plainText('הנה מה שמצאתי [[action:open_roster]]').includes('action'), false)
  })

  it('strips a Hebrew-labelled pseudo-widget', () => {
    assert.equal(plainText('בבקשה [כפתור: פתיחת הרשימה]').includes('כפתור'), false)
  })

  it('keeps the rest of the sentence', () => {
    const text = plainText('שני תלמידים לא נכנסו. [navigate_button: רשימה]')
    assert.equal(text.includes('שני תלמידים לא נכנסו.'), true)
  })

  it('leaves ordinary brackets alone', () => {
    // Stripping every bracketed run would eat real prose. The pattern is
    // narrow on purpose — it matches a widget shape, not a punctuation mark.
    const text = plainText('הציון (לפי המדגם [החלקי]) עלה.')
    assert.equal(text.includes('[החלקי]'), true)
  })

  it('does not leave an empty paragraph where a widget stood alone', () => {
    const blocks = parseBlocks(stripPseudoWidgets('שורה ראשונה\n\n[navigate_button: x]\n\nשורה שנייה'))
    assert.equal(blocks.length, 2)
  })

  it('still parses a student reference in the same sentence', () => {
    const text = plainText('{{student:kid-1}} לא נכנס. [navigate_button: רשימה]')
    assert.equal(text.includes('«kid-1»'), true)
    assert.equal(text.includes('navigate_button'), false)
  })
})

describe('counts that read like a language', () => {
  it('picks the singular key at exactly one', () => {
    assert.equal(countKey('tch.assistant.form.assign', 1),
                 'tch.assistant.form.assign.one')
  })

  it('picks the plural everywhere else', () => {
    for (const count of [0, 2, 3, 17]) {
      assert.equal(countKey('tch.assistant.form.assign', count),
                   'tch.assistant.form.assign.many')
    }
  })

  const PAIRED = [
    'tch.assistant.action.draftGoal',
    'tch.assistant.action.approveGoals',
    'tch.assistant.action.ackAlerts',
    'tch.assistant.action.meetStudents',
    'tch.assistant.form.assign',
    'tch.assistant.form.goalDoneSkipped',
    'tch.assistant.form.approvedAll',
    'tch.assistant.form.ackedAll',
    // The hero's own two, which carried the same bug in the same screenshot.
    'tch.brief.action.assign',
    'tch.brief.action.openRoster',
    // And the sub-group dialog's, reached from the hero. (`tch.subgroup.open`
    // and `.kept` went with the buttons that used them: the gaps list builds a
    // task now, and keeping a selection as a named group belongs to the roster
    // screen that can also edit one.)
    'tch.subgroup.assign',
    'tch.subgroup.assigned',
    'tch.subgroup.assignedWithSkips',
    // The gaps list's replacement, carrying the same count into the same shape.
    'tch.gaps.buildTask',
    'tch.tasks.fromGap',
    // And the learnings card's, which was the same bug on the screen this
    // list's own fixes were shipped for: "1 students are struggling".
    'tch.learnings.struggling',
    // And the profile's mastery line, found in the same way: on screen.
    'tch.student.trendMastered',
  ]

  it('has both halves of every pair in all three languages', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const key of PAIRED) {
        for (const half of ['one', 'many']) {
          assert.ok(table[`${key}.${half}`], `${language} is missing ${key}.${half}`)
        }
      }
    }
  })

  it('has retired the shared key, so a call site cannot fall back to it', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const key of PAIRED) {
        assert.equal(table[key], undefined,
                     `${language} still has the un-pluralised ${key}`)
      }
    }
  })

  it('never interpolates a count into a singular', () => {
    // "הצבה ל-1 תלמידים" is the exact string a teacher photographed. A `.one`
    // that still carried {count} would reproduce it.
    for (const [language, table] of Object.entries(locales)) {
      for (const key of PAIRED) {
        assert.equal(table[`${key}.one`].includes('{count}'), false,
                     `${language}: ${key}.one still interpolates a count`)
      }
    }
  })

  it('keeps every other placeholder the plural had', () => {
    // `goalDoneSkipped` carries {skipped} in both halves; dropping it from the
    // singular would render "· דולגו" with no number.
    for (const table of Object.values(locales)) {
      assert.equal(table['tch.assistant.form.goalDoneSkipped.one'].includes('{skipped}'), true)
    }
  })
})

describe('the filters the assistant can offer and the roster must honour', () => {
  const backend = read('../../backend/app/agents/teacher_tools/data_tools.py')
  const page = read('../src/features/teacher-app/students/TeacherStudentsPage.tsx')

  /** The literal set in `data_tools.ROSTER_FILTERS` — the only place the two
   *  languages meet, so it is read from source rather than duplicated. */
  const offered = new Set(
    (backend.match(/ROSTER_FILTERS = \{([^}]*)\}/)?.[1] ?? '')
      .match(/"([a-z_]+)"/g)?.map((quoted) => quoted.replaceAll('"', '')) ?? []
  )

  it('found the backend set at all', () => {
    // A regex that silently matched nothing would make every assertion below
    // vacuously true, which is worse than no test.
    assert.ok(offered.size >= 4, `parsed only ${[...offered]}`)
  })

  it('lands every offered filter somewhere on the roster', () => {
    const chips = new Set(
      (page.match(/STATUS_CHIPS: StatusFilter\[\] = \[([^\]]*)\]/)?.[1] ?? '')
        .match(/'([a-z_]+)'/g)?.map((quoted) => quoted.replaceAll("'", '')) ?? []
    )
    for (const filter of offered) {
      // `inactive` is deliberately not a status chip — inactivity cuts across
      // all three statuses — so it is honoured by the `minDaysInactive`
      // control instead. What matters is that it is honoured by *something*.
      const handled = chips.has(filter)
        || new RegExp(`filter === '${filter}'`).test(page)
      assert.ok(handled, `?filter=${filter} lands on the unfiltered class`)
    }
  })

  it('resolves the linked inactivity window to the same default as the tool', () => {
    // The assistant says "these six have not been here in a week" and the
    // roster then shows a different six. Same number, one meaning.
    const toolDefault = backend.match(/DEFAULT_INACTIVE_DAYS = (\d+)/)?.[1]
    const pageDefault = page.match(/LINKED_INACTIVE_DAYS = (\d+)/)?.[1]
    assert.ok(toolDefault, 'no DEFAULT_INACTIVE_DAYS in data_tools.py')
    assert.equal(pageDefault, toolDefault)
  })
})

describe('every offer the tools can make has a form that renders it', () => {
  const backend = read('../../backend/app/agents/teacher_tools/action_tools.py')
  const data = read('../../backend/app/agents/teacher_tools/data_tools.py')
  const form = read('../src/features/teacher-app/assistant/AssistantTaskForm.tsx')

  /** Every `_offer("kind", …)` the tool layer can emit, from source. An offer
   *  whose kind the dock does not know renders as a chip that opens nothing —
   *  a live-looking button that does nothing when pressed. */
  const kinds = new Set([
    ...backend.matchAll(/_offer\(\s*\n?\s*"([a-z_]+)"/g),
    ...data.matchAll(/"kind":\s*"([a-z_]+)"/g),
  ].map((match) => match[1]))

  it('found the offers at all', () => {
    assert.ok(kinds.has('draft_goal') && kinds.has('draft_task'),
      `parsed only ${[...kinds]}`)
  })

  it('handles each of them, or renders it as its own kind of chip', () => {
    for (const kind of kinds) {
      // `navigate` and `followups` are buttons, not forms — they are handled in
      // MessageActions and never reach the form switch.
      if (kind === 'navigate' || kind === 'followups') continue
      assert.ok(form.includes(`case '${kind}':`),
        `an offer of kind ${kind} opens an empty form`)
    }
  })

  it('labels each of them with a key that exists in all three languages', () => {
    const labels = (backend.match(/"(tch\.assistant\.action\.[A-Za-z]+)"/g) ?? [])
      .map((quoted) => quoted.replaceAll('"', ''))
    assert.ok(labels.length >= 5, `parsed only ${labels}`)
    for (const key of labels) {
      for (const [language, table] of Object.entries(locales)) {
        // A label carrying a `{count}` is looked up through `countKey`, which
        // picks `.one` or `.many` at the call site — `t()` has no plural
        // engine. Either the bare key or both halves must exist.
        const present = table[key] || (table[`${key}.one`] && table[`${key}.many`])
        assert.ok(present, `${key} missing from ${language}`)
      }
    }
  })
})

describe('the hero scenes the model may choose from', () => {
  const backend = read('../../backend/app/services/daily_brief.py')

  /** `daily_brief.SCENES` — read from source, because it is the only place the
   *  two languages meet. A model that picks a mood this catalogue cannot draw
   *  leaves the hero's whole illustration half blank. */
  const offered = (backend.match(/^SCENES = \(([^)]*)\)/m)?.[1] ?? '')
    .match(/"([a-z_]+)"/g)?.map((q) => q.replaceAll('"', '')) ?? []

  it('found the backend set at all', () => {
    assert.ok(offered.length >= 5, `parsed only ${JSON.stringify(offered)}`)
  })

  it('draws every mood the backend can send', () => {
    for (const scene of offered) {
      assert.ok(isSceneKey(scene), `backend offers "${scene}" and the catalogue has no art`)
    }
  })

  it('offers no mood the backend cannot send', () => {
    // The other direction matters too: a key here with no backend entry is art
    // nobody will ever see, and a sign the two drifted.
    for (const key of SCENE_KEYS) {
      assert.ok(offered.includes(key), `catalogue has "${key}" and the backend never sends it`)
    }
  })

  it('falls back to a real scene rather than nothing', () => {
    assert.ok(isSceneKey(DEFAULT_SCENE))
  })

  it('rejects anything that is not a known mood', () => {
    for (const value of ['hopeful', '', null, undefined, 42, 'CELEBRATING']) {
      assert.equal(isSceneKey(value), false, String(value))
    }
  })

  it('has a label for every scene in all three languages', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const key of SCENE_KEYS) {
        assert.ok(table[`tch.brief.scene.${key}`],
                  `${language} is missing tch.brief.scene.${key}`)
      }
    }
  })

  it('maps a subject onto a prop it actually has art for', () => {
    assert.equal(propFor('math'), 'math')
    assert.equal(propFor('Science'), 'science')
    assert.equal(propFor('english'), 'english')
    // The backend emits these too; none of them may fall through to nothing.
    for (const subject of ['biology', 'physics', 'other', '', null, undefined]) {
      assert.ok(PROP_KEYS.includes(propFor(subject)), String(subject))
    }
  })
})

describe('an action belongs to the message that offered it', () => {
  it('two turns offering the same tool do not share an open form', () => {
    // Backend ids are `{tool}:{index}` per TURN, so the first goal offered in
    // turn 1 and the first offered in turn 3 are both "draft_goal:0". Comparing
    // bare ids opened the form on every turn that shared one, and a teacher
    // could confirm in the wrong one and assign a goal they were not looking at.
    assert.notEqual(actionKey('msg-1', 'draft_goal:0'), actionKey('msg-2', 'draft_goal:0'))
  })

  it('is stable for the same action on the same message', () => {
    assert.equal(actionKey('msg-1', 'draft_goal:0'), actionKey('msg-1', 'draft_goal:0'))
  })

  it('separates two different actions within one message', () => {
    assert.notEqual(actionKey('msg-1', 'draft_goal:0'), actionKey('msg-1', 'draft_kudos:1'))
  })

  it('round-trips back to the bare action id the server stores', () => {
    // The outcome is persisted under the bare id, so the key must decompose
    // exactly — every action id already contains a single ':'.
    for (const actionId of ['draft_goal:0', 'draft_kudos:12', 'navigate:3']) {
      assert.equal(actionIdOf(actionKey('msg-1', actionId), 'msg-1'), actionId)
    }
  })

  it('round-trips even when the message id itself contains the separator', () => {
    assert.equal(actionIdOf(actionKey('a::b', 'draft_goal:0'), 'a::b'), 'draft_goal:0')
  })
})
