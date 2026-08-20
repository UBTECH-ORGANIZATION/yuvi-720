/* The live view's honesty rules, pinned (#249, B4).
 *
 *   node --test frontend/tests/
 *
 * Rows, counts and the spread strip all read from liveModel, so these tests
 * are what keeps the three from ever disagreeing on screen — and what keeps a
 * client-reported surface from faking lesson state.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHAT_RECENT_SECONDS,
  QUIET_AFTER_SECONDS,
  inBucket,
  liveCounts,
  signalOf,
  spreadByObjective,
  triageOrder,
  whereOf,
  type LiveCounts,
} from '../src/features/teacher-app/live/liveModel.ts'
import type { Presence } from '../src/services/teacher.ts'

const NOW = Date.parse('2026-08-20T10:00:00Z')
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

const presence = (overrides: Partial<Presence>): Presence => ({
  learner_id: 'kid', status: 'online', connections: 1,
  component_id: null, unit_id: null, objective_id: null, session_id: null,
  subject: null, unit_title: null, objective_title: null,
  last_seen_at: ago(10), lesson_entered_at: null, struggling: null,
  help_requested_at: null, surface: null, surface_screen: null, surface_title: null, surface_subject: null, surface_at: null, chat_at: null,
  ...overrides,
})

describe('whereOf', () => {
  it('lets only xAPI status say "lesson" — a reported surface cannot', () => {
    assert.equal(whereOf(presence({ status: 'in_lesson' }), NOW), 'lesson')
    // The client claims the lesson screen; without the status it is not one.
    assert.equal(whereOf(presence({ surface: 'lesson' }), NOW), 'unknown')
  })

  it('offline trumps every claim the frames still carry', () => {
    assert.equal(
      whereOf(presence({ status: 'offline', surface: 'studio', chat_at: ago(5) }), NOW),
      'offline')
  })

  it('derives chat from recency so it decays on its own', () => {
    assert.equal(whereOf(presence({ chat_at: ago(60) }), NOW), 'chat')
    assert.equal(
      whereOf(presence({ chat_at: ago(CHAT_RECENT_SECONDS + 30), surface: 'browsing' }), NOW),
      'browsing')
  })

  it('reads the reported studio and browsing surfaces', () => {
    assert.equal(whereOf(presence({ surface: 'studio' }), NOW), 'studio')
    assert.equal(whereOf(presence({ surface: 'browsing' }), NOW), 'browsing')
    assert.equal(whereOf(presence({}), NOW), 'unknown')
  })
})

describe('signalOf', () => {
  it('a raised hand outranks a struggle', () => {
    const signal = signalOf(
      presence({
        help_requested_at: ago(30),
        struggling: { kind: 'misconception', since: ago(90), evidence: {} },
      }), NOW)
    assert.equal(signal?.kind, 'hand')
  })

  it('a struggle carries its evidence, never a bare badge', () => {
    const struggle = { kind: 'wheel_spinning', since: ago(120), evidence: { opportunities: 12 } }
    const signal = signalOf(presence({ struggling: struggle }), NOW)
    assert.equal(signal?.kind, 'struggling')
    assert.deepEqual(signal?.kind === 'struggling' && signal.struggle, struggle)
  })

  it('connected-but-silent becomes quiet after the threshold, with a since', () => {
    assert.equal(signalOf(presence({ last_seen_at: ago(60) }), NOW), null)
    const signal = signalOf(
      presence({ last_seen_at: ago(QUIET_AFTER_SECONDS + 60) }), NOW)
    assert.equal(signal?.kind, 'quiet')
    assert.ok(signal?.kind === 'quiet' && signal.since)
  })

  it('an offline child is never "quiet" — absence is not silence', () => {
    assert.equal(
      signalOf(presence({ status: 'offline', last_seen_at: ago(3600) }), NOW), null)
  })
})

describe('triageOrder', () => {
  const rows = [
    { learner_id: 'offline-kid', name: 'אורי' },
    { learner_id: 'lesson-kid', name: 'בני' },
    { learner_id: 'hand-kid', name: 'גילי' },
    { learner_id: 'struggling-kid', name: 'דנה' },
    { learner_id: 'studio-kid', name: 'הילה' },
    { learner_id: 'unknown-kid', name: 'אביב' },
  ]
  const frames: Record<string, Presence> = {
    'offline-kid': presence({ status: 'offline' }),
    'lesson-kid': presence({ status: 'in_lesson' }),
    'hand-kid': presence({ help_requested_at: ago(20) }),
    'struggling-kid': presence({
      struggling: { kind: 'idle', since: ago(200), evidence: {} } }),
    'studio-kid': presence({ surface: 'studio' }),
    'unknown-kid': presence({}),
  }

  it('bands hand → struggling → lesson → elsewhere → offline, name-ordered inside', () => {
    const ordered = triageOrder(rows, (id) => frames[id], NOW).map((row) => row.learner_id)
    assert.deepEqual(ordered, [
      'hand-kid', 'struggling-kid', 'lesson-kid',
      // elsewhere band: אביב before הילה alphabetically.
      'unknown-kid', 'studio-kid',
      'offline-kid',
    ])
  })

  it('a learner with no frame at all sorts as offline, not on top', () => {
    const ordered = triageOrder(
      [{ learner_id: 'ghost', name: 'אאא' }, rows[2]], (id) => frames[id], NOW)
    assert.equal(ordered[0].learner_id, 'hand-kid')
  })

  it('does not mutate the caller’s row order', () => {
    const copy = [...rows]
    triageOrder(rows, (id) => frames[id], NOW)
    assert.deepEqual(rows, copy)
  })
})

describe('liveCounts', () => {
  it('locations partition the class; hand and struggling sit on top', () => {
    const counts = liveCounts([
      presence({ status: 'in_lesson', help_requested_at: ago(9) }),
      presence({ status: 'in_lesson' }),
      presence({ chat_at: ago(30) }),           // chat rides with lesson
      presence({ surface: 'browsing' }),
      presence({ struggling: { kind: 'idle', since: ago(60), evidence: {} } }),
      presence({ status: 'offline' }),
    ], NOW)
    assert.deepEqual(counts, { hand: 1, struggling: 1, lesson: 3, elsewhere: 2, offline: 1 })
    assert.equal(counts.lesson + counts.elsewhere + counts.offline, 6)
  })

  it('a child SITTING on a lesson page counts under the lesson KPI', () => {
    /* `whereOf` still refuses to call it "lesson" (the label reads בדף שיעור),
       but the class partition counts it there: a KPI reading 0 beside a row
       that says lesson-page reads as the screen disagreeing with itself. */
    const onLessonPage = presence({ surface: 'browsing', surface_screen: 'learning_lesson' })
    assert.equal(whereOf(onLessonPage, NOW), 'browsing')
    const counts = liveCounts([onLessonPage, presence({ surface: 'browsing' })], NOW)
    assert.deepEqual(counts, { hand: 0, struggling: 0, lesson: 1, elsewhere: 1, offline: 0 })
    assert.equal(inBucket(onLessonPage, 'lesson', NOW), true)
    assert.equal(inBucket(onLessonPage, 'elsewhere', NOW), false)
  })
})

describe('inBucket', () => {
  it('agrees with liveCounts for every child and every bucket', () => {
    /* The card and the list it filters must never disagree; this proves the
       two computations are one, over every location and signal variant. */
    const frames = [
      presence({ status: 'in_lesson', help_requested_at: ago(9) }),
      presence({ status: 'in_lesson' }),
      presence({ chat_at: ago(30) }),
      presence({ surface: 'studio' }),
      presence({ surface: 'browsing' }),
      presence({ surface: 'browsing', surface_screen: 'learning_lesson' }),
      presence({}),
      presence({ struggling: { kind: 'idle', since: ago(60), evidence: {} } }),
      presence({ status: 'offline' }),
    ]
    const counts = liveCounts(frames, NOW)
    for (const bucket of Object.keys(counts) as (keyof LiveCounts)[]) {
      const matched = frames.filter((frame) => inBucket(frame, bucket, NOW)).length
      assert.equal(matched, counts[bucket], `bucket ${bucket}`)
    }
  })
})

describe('spreadByObjective', () => {
  it('clusters only real lesson state, biggest first, labelled when known', () => {
    const spread = spreadByObjective([
      presence({ status: 'in_lesson', objective_id: 'OBJ.1', objective_title: 'שברים' }),
      presence({ status: 'in_lesson', objective_id: 'OBJ.1' }),
      presence({ status: 'in_lesson', objective_id: 'OBJ.2', objective_title: 'צירים' }),
      // Remembered objective on an offline child — history, not spread.
      presence({ status: 'offline', objective_id: 'OBJ.3' }),
      presence({ status: 'in_lesson' }),        // no objective: not a cluster
    ], NOW)
    assert.deepEqual(spread, [
      { objective_id: 'OBJ.1', title: 'שברים', count: 2 },
      { objective_id: 'OBJ.2', title: 'צירים', count: 1 },
    ])
  })
})
