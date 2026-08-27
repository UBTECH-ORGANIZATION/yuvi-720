/* The two habit scores (PBI 451): source-shape guardrails.
 *
 * What these assert is not styling — it is the contract Reut set and the
 * privacy wall the feature depends on: the scores stay teacher-only, the
 * client never resurrects its own arithmetic, partial coverage is said out
 * loud, and nothing renders as a radial arc.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  CONCENTRATION_SUBSCORES, INDEPENDENCE_SUBSCORES,
} from '../src/features/teacher-app/student/scoreModel.ts'

const SRC = join(import.meta.dirname, '..', 'src')
const cards = readFileSync(
  join(SRC, 'features', 'teacher-app', 'student', 'ScoreCards.tsx'), 'utf8')
const page = readFileSync(
  join(SRC, 'features', 'teacher-app', 'student', 'TeacherStudentPage.tsx'), 'utf8')

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (/\.(ts|tsx)$/.test(name)) yield path
  }
}

describe('the habit scores', () => {

  it('never reach the student app', () => {
    /* The scores are a teacher-side judgement of a child. The student keeps
       the activeness hexagon; nothing outside the teacher app (and the
       teacher service client) may even import the read. */
    for (const path of walk(SRC)) {
      if (path.includes(join('features', 'teacher-app'))) continue
      if (path.endsWith(join('services', 'teacher.ts'))) continue
      const source = readFileSync(path, 'utf8')
      assert.ok(!source.includes('getStudentScores'),
                `${path} reads the teacher-only scores outside the teacher app`)
    }
  })

  it('are rendered, never recomputed client-side', () => {
    /* The old client-side ratio treated every chat turn as a cost — the exact
       thing this item removes. Its resurrection would silently override the
       server's weighted read. */
    assert.ok(!page.includes('helpedRows'),
              'the client-side help-count independence ratio is back')
    assert.ok(!/active_days\s*\/\s*trends\.days/.test(page),
              'the client-side consistency ratio is back')
  })

  it('say when they score on partial signals', () => {
    /* The banner, the unmeasured footnote and the session-context panel are
       all gone (Gal, 2026-08-27); the one surviving honesty marker is the
       card caption flagging a renormalized score — it must not vanish too. */
    assert.ok(cards.includes('coverage.renormalized'),
              'the card no longer marks a renormalized score')
    assert.ok(cards.includes('tch.score.partial'),
              'the card caption lost its partial-signals marker')
    assert.ok(!cards.includes('tch.score.unmeasured'),
              'the unmeasured footnote came back')
    assert.ok(!cards.includes('tch.score.session'),
              'the session-shape context panel came back')
  })

  it('answer "why is it down" as sentences, not a table', () => {
    /* One component (Gal, 2026-08-27): drags first, strengths after, every
       line a sentence with its own numbers, always on screen. No toggles, no
       weight labels, no per-signal gauges or bars. */
    assert.ok(cards.includes('groupSubscores'), 'the drag/strength grouping is gone')
    assert.ok(cards.includes('describeEvidence'), 'the evidence sentences are gone')
    assert.ok(cards.includes('tch.score.drags') && cards.includes('tch.score.strengths'),
              'the two group headings are gone')
    assert.ok(!cards.includes('EvidenceToggle'),
              'the evidence went back behind a toggle')
    assert.ok(!cards.includes('tch.score.weight'),
              'the weight labels came back')
    const dialog = cards.slice(cards.indexOf('function ScoreDialog'))
    assert.ok(!dialog.includes('ProgressRing'),
              'per-signal gauges crept back into the dialog')
  })

  it('have a label and a description for every sub-score, in every language', () => {
    const locales = join(import.meta.dirname, '..', '..', 'locales')
    for (const lang of ['he', 'en', 'ar']) {
      const data = JSON.parse(readFileSync(join(locales, `${lang}.json`), 'utf8'))
      for (const key of [...INDEPENDENCE_SUBSCORES, ...CONCENTRATION_SUBSCORES]) {
        assert.ok(data[`tch.score.sub.${key}`], `${lang} lacks tch.score.sub.${key}`)
        assert.ok(data[`tch.score.subDesc.${key}`], `${lang} lacks tch.score.subDesc.${key}`)
      }
    }
  })
})
