/* The goal composer's suggestions: asked for once, explained in words.
 *
 *   node --test frontend/tests/
 *
 * Both halves of what a teacher saw on this panel:
 *
 *   a button that produced three different answers to the same question every
 *   time it was pressed, each one paid for;
 *
 *   and a "why?" that opened onto the request body — `blocks [object Object]`,
 *   `{'label': …, 'status': 'working'}`, `events since generation 4` — because
 *   the backend shipped the evidence object it had handed the model.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const goals = read('../src/features/teacher-app/student/TeacherGoals.tsx')
const evidence = read('../src/features/teacher-app/shared/evidenceText.ts')
const service = read('../src/services/teacher.ts')
const locales = {
  he: JSON.parse(read('../../locales/he.json')) as Record<string, string>,
  en: JSON.parse(read('../../locales/en.json')) as Record<string, string>,
  ar: JSON.parse(read('../../locales/ar.json')) as Record<string, string>,
}

describe('suggestions are asked for once', () => {
  it('reads what is already there when the tab opens', () => {
    // A GET that never generates: being on the page is not a request for a
    // model call, and a teacher who was here yesterday should see the same
    // three immediately.
    assert.match(service, /export function getGoalSuggestions/)
    assert.match(goals, /getGoalSuggestions\(learnerId, language, subject\)/)
  })

  it('offers the button only when there is nothing, or the data has moved', () => {
    assert.match(goals, /!drafts\?\.length \|\| stale \?/)
  })

  it('says when they were made and that they will not drift', () => {
    assert.match(goals, /tch\.goals\.suggest\.made/)
    for (const [language, table] of Object.entries(locales)) {
      for (const key of ['tch.goals.suggest.made', 'tch.goals.suggest.moved',
                         'tch.goals.suggest.again']) {
        assert.ok(table[key], `${language}: ${key}`)
      }
      assert.match(table['tch.goals.suggest.made'], /\{date\}/, language)
    }
  })

  it('keeps showing the stale ones rather than emptying the panel', () => {
    // `stale` adds a button. It must not gate the list, or new evidence would
    // silently remove three grounded suggestions a teacher was reading.
    const list = goals.split('{drafts?.length ? (')[1] ?? ''
    assert.equal(/stale/.test(list.slice(0, 400)), false)
  })
})

describe('the "why?" is a sentence, not the payload', () => {
  it('renders the grounding through the signal, like a recommendation does', () => {
    assert.match(goals, /describeSignal\(draft\.because\.signal/)
    // The shape-driven renderer is what printed `label: value` for every key
    // the templates did not recognize.
    assert.equal(/RawEvidence/.test(goals), false)
  })

  it('has a sentence for each signal a goal draft can carry', () => {
    for (const signal of ['struggle_items', 'challenges', 'student_description']) {
      assert.match(evidence, new RegExp(`\\n  ${signal}: \\(raw`), signal)
    }
  })

  it('translates all of them', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const key of ['tch.why.goalGaps', 'tch.why.goalChallenges',
                         'tch.why.goalDescription', 'tch.why.noEvidence']) {
        assert.ok(table[key], `${language}: ${key}`)
      }
      assert.match(table['tch.why.goalDescription'], /\{observation\}/, language)
    }
  })
})
