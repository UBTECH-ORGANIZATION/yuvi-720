/* The "why?" contract: every evidence shape the backend emits renders as
 * sentences — never JSON braces, never machine ids — in every language. */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describeEvidence } from '../src/features/teacher-app/shared/evidenceText.ts'

const messages: Record<string, string> = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../locales/he.json', import.meta.url)), 'utf8')
)

const t = (key: string, params: Record<string, string | number> = {}) => {
  const template = messages[key] || key
  return Object.entries(params).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    template
  )
}

/** Every raw-evidence payload the backend currently produces, verbatim shapes. */
const BACKEND_SHAPES: Record<string, Record<string, unknown>> = {
  struggle: { attempts: 12, successes: 4, failures: 8, score_ewma: 0.32, level: 'basic', needs_review: true },
  inactivity: { days_inactive: 9, threshold: 6, last_event_at: '2026-07-25T10:00:00Z', last_event_id: 'evt-1' },
  low_success: { fail_streak: 5, threshold: 3, objective_id: 'obj-1', evidence_event_ids: ['a', 'b'] },
  slow_progress: { event_id: 'e', question_id: 'q1', elapsed_seconds: 340, timing_quality: 'elapsed_between_events', occurred_at: '2026-08-01T09:00:00Z' },
  rapid_guessing: { rapid_guesses: 4, window: 5 },
  wheel_spinning: { objective_id: 'obj-2', opportunities: 8, spinning: true },
  overdue_goal: { goal_ids: ['g1', 'g2'] },
  wellbeing: { at: '2026-08-01T08:00:00Z', source: 'chat', category: 'distress', open_flags: 2 },
  gap: { struggling_count: 6, mastered_count: 3, with_evidence: 12, group_size: 12, threshold: 0.3, sample_misconceptions: [['sign-flip', 3], ['axis-swap', 1]] },
  awareness: { gap: 1.4, samples: 5 },
  // Every moments-feed kind. This feed is read fastest and was the last place
  // still showing "failures before: 32" to a teacher.
  moment_sustained: { answers: 12, minutes: 11, session_id: 'sess-1' },
  moment_recovery: { failures_before: 32, objective_id: 'obj-3', event_id: 'evt-9' },
  moment_first_mastery: { attempts_before_first_success: 7, objective_id: 'obj-4', event_id: 'evt-2' },
  moment_comeback: { days_away: 11, threshold: 7, last_event_at: '2026-07-20T10:00:00Z', event_id: 'evt-3' },
  moment_breakthrough: { failures: 58, attempts: 97, successes: 79, level: 'intermediate', objective_id: 'obj-5' },
  moment_goal_done: { goal_id: 'g9', source: 'mentoring', approved_by: 'teacher-a' },
  moment_misconception: { tag: 'sign-flip', objective_id: 'obj-6', resolved_at: '2026-08-02T07:00:00Z' },
  moment_wellbeing: { evidence: 'משהו שקשה לי', source: 'coach_chat', category: 'distress', resolved: false },
}

describe('describeEvidence', () => {
  for (const [name, raw] of Object.entries(BACKEND_SHAPES)) {
    it(`renders ${name} evidence as prose`, () => {
      const sentences = describeEvidence(raw, t, 'he')
      assert.ok(sentences.length > 0, 'evidence must never vanish')
      const text = sentences.join(' ')
      assert.ok(!/[{}[\]"]/.test(text), `no JSON syntax in: ${text}`)
      assert.ok(!text.includes('evt-'), 'event ids are hidden')
      assert.ok(!text.includes('sess-'), 'session ids are hidden')
      for (const sentence of sentences) {
        assert.ok(!/^tch\./.test(sentence), `no leaked locale key: ${sentence}`)
      }
    })
  }

  it('turns the inactivity payload into the sentence the teacher reads', () => {
    const sentences = describeEvidence(BACKEND_SHAPES.inactivity, t, 'he')
    assert.match(sentences[0], /9 ימים ללא פעילות/)
    assert.match(sentences[0], /6/)
  })

  it('renders goal ids as a count, never as identifiers', () => {
    const sentences = describeEvidence(BACKEND_SHAPES.overdue_goal, t, 'he')
    assert.equal(sentences.length, 1)
    assert.ok(!sentences[0].includes('g1'))
    assert.match(sentences[0], /2/)
  })

  it('never leaves a moment as a key–value pair', () => {
    /* The regression: a feed row's "why?" opened to `failures before: 32`,
       which is the raw field name in a teacher's face. Every moment shape must
       resolve through a template, so no sentence may read as `label: value`. */
    for (const [name, raw] of Object.entries(BACKEND_SHAPES)) {
      if (!name.startsWith('moment_')) continue
      for (const sentence of describeEvidence(raw, t, 'he')) {
        assert.ok(!/^[\w ]+: /.test(sentence), `${name} fell back to a field label: ${sentence}`)
      }
    }
  })

  it('describes a distress flag as a disclosure, never as a goal', () => {
    /* Both shapes carry `source`, and the goal template used to claim it first —
       which described a child's distress flag as "a goal the learner set". */
    const sentences = describeEvidence(BACKEND_SHAPES.moment_wellbeing, t, 'he').join(' ')
    assert.ok(!sentences.includes('יעד'), sentences)
    assert.ok(sentences.includes('משהו שקשה לי'), sentences)
  })

  it('keeps unknown fields visible as words', () => {
    const sentences = describeEvidence({ mystery_metric: 7 }, t, 'he')
    assert.equal(sentences.length, 1)
    assert.match(sentences[0], /mystery metric: 7/)
  })

  it('returns nothing for empty payloads', () => {
    assert.deepEqual(describeEvidence(null, t, 'he'), [])
    assert.deepEqual(describeEvidence({}, t, 'he'), [])
  })
})
