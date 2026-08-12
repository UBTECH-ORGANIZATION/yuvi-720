/* The "why?" contract: every evidence shape the backend emits renders as
 * sentences — never JSON braces, never machine ids — in every language. */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describeEvidence, describeSignal } from '../src/features/teacher-app/shared/evidenceText.ts'

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

/* ── why a recommendation was made ──────────────────────────────────────────
 *
 * The screenshot this suite exists to prevent, verbatim from a teacher's
 * screen under "למה?":
 *
 *     subject: science · objectives total: 1 · objectives mastered: 1 ·
 *     objectives in progress: 0 · objectives needs review: 1 · percent: 100
 *
 * Six lines of payload where one sentence belongs. A recommendation is the one
 * evidence surface that already knows which sentence it wants — it carries its
 * own `signal` — so it never had to be shape-matched at all.
 */

/** Every `because` a recommendation can arrive with, exactly as `insights.py`
 *  builds them. Keep in step with the call sites in `student_insights`. */
const RECOMMENDATION_BECAUSE: Record<string, { value: unknown; raw: Record<string, unknown> }> = {
  days_inactive: {
    value: 9,
    raw: { days_inactive: 9, threshold: 6, last_activity_at: '2026-07-25T10:00:00Z', last_activity_source: 'task' },
  },
  trailing_fail_streak: {
    value: 4,
    raw: { fail_streak: 4, threshold: 3, objective_id: 'MOE.SCI.G7.MASS', objective_title: 'מסה ונפח של גופים' },
  },
  distress_with_failure: { value: 3, raw: { fail_streak: 3, open_flags: 1 } },
  prolonged_interaction: { value: 340, raw: { elapsed_seconds: 340, event_id: 'evt-1', question_id: 'q1' } },
  subject_mastery_percent: {
    value: 100,
    raw: {
      subject: 'science', percent: 100, objectives_total: 1, objectives_mastered: 1,
      objectives_in_progress: 0, objectives_needs_review: 1, not_started: 0,
    },
  },
  existing_strength: { value: 3, raw: { labels: ['רצון להצליח', 'תחושת שייכות בכיתה', 'שליטה בטכנולוגיה'] } },
  default: { value: null, raw: {} },
}

describe('describeSignal', () => {
  for (const [signal, { value, raw }] of Object.entries(RECOMMENDATION_BECAUSE)) {
    it(`says ${signal} in one sentence`, () => {
      const sentences = describeSignal(signal, value, raw, t, 'he')
      assert.equal(sentences.length, 1, `one reason, got: ${sentences.join(' | ')}`)
      const text = sentences[0]
      assert.ok(text.length > 12, `too thin to be a reason: ${text}`)
      assert.ok(!/[{}[\]]/.test(text), `no payload syntax in: ${text}`)
      assert.ok(!/^tch\.|\stch\./.test(text), `no leaked locale key: ${text}`)
      // The failure mode itself: a `field: value` column posing as a reason.
      assert.ok(!/\b(objectives|score ewma|open flags|fail streak)\b/.test(text),
                `raw field name reached the screen: ${text}`)
    })
  }

  it('never leaves an unresolved parameter on screen', () => {
    for (const language of ['he', 'en', 'ar'] as const) {
      const table: Record<string, string> = JSON.parse(
        readFileSync(fileURLToPath(new URL(`../../locales/${language}.json`, import.meta.url)), 'utf8'))
      const translate = (key: string, params: Record<string, string | number> = {}) =>
        Object.entries(params).reduce(
          (text, [name, v]) => text.split(`{${name}}`).join(String(v)), table[key] ?? key)
      for (const [signal, { value, raw }] of Object.entries(RECOMMENDATION_BECAUSE)) {
        const text = describeSignal(signal, value, raw, translate, language).join(' ')
        assert.ok(!/\{[a-z]+\}/.test(text), `${language}/${signal} left a param: ${text}`)
        assert.ok(!text.includes(`tch.`), `${language}/${signal} leaked a key: ${text}`)
      }
    }
  })

  it('names the objective the failures were in, when the catalogue knows it', () => {
    const { value, raw } = RECOMMENDATION_BECAUSE.trailing_fail_streak
    const text = describeSignal('trailing_fail_streak', value, raw, t, 'he').join(' ')
    assert.ok(text.includes('מסה ונפח של גופים'), text)
    // The id behind it stays behind it.
    assert.ok(!text.includes('MOE.'), text)
  })

  it('still reads when the catalogue cannot name the objective', () => {
    const text = describeSignal(
      'trailing_fail_streak', 4, { fail_streak: 4, threshold: 3, objective_id: 'X' }, t, 'he').join(' ')
    assert.ok(text.includes('4'), text)
    assert.ok(!text.includes('""'), `empty quotes where a name should be: ${text}`)
    assert.ok(!text.includes('X'), text)
  })

  it('says a subject by name, not by its vendor id', () => {
    const { value, raw } = RECOMMENDATION_BECAUSE.subject_mastery_percent
    const text = describeSignal('subject_mastery_percent', value, raw, t, 'he').join(' ')
    assert.ok(text.includes('מדעים'), text)
    assert.ok(!text.includes('science'), text)
  })

  it('degrades a signal nobody has written a sentence for, rather than going silent', () => {
    // A new backend signal must still produce a readable "why?", because the
    // alternative is a disclosure that opens onto nothing.
    const sentences = describeSignal('brand_new_signal', 5, { attempts: 9, successes: 2 }, t, 'he')
    assert.ok(sentences.length >= 1, 'a why must never be empty')
    assert.ok(!sentences.join(' ').includes('{'), sentences.join(' '))
  })

  it('is honest that a default recommendation is not a finding', () => {
    const text = describeSignal('default', null, {}, t, 'he').join(' ')
    assert.ok(text.length > 12, text)
    assert.ok(!/^default$/.test(text), text)
  })
})
