/* Pure model for the two habit scores (PBI 451): the client RENDERS what the
 * server computed — it never recomputes a score or a trend from raw rows (the
 * old client-side independence ratio is exactly what this replaces). */

import type { Delta } from '../shared/periodModel'
import type { ScoreTrend, SubScore } from '../../../services/teacher'

export type ScoreKind = 'independence' | 'concentration'

/* Server order is contract order; these lists exist so tests can assert the
 * locale files carry a label for every sub-score, not to filter the payload. */
export const INDEPENDENCE_SUBSCORES = [
  'tried_before_asking',
  'question_quality',
  'unassisted_success',
  'persistence_vs_giving_up',
  'recovery',
  'support_depth',
] as const

export const CONCENTRATION_SUBSCORES = [
  'on_task_share',
  'idle_share',
  'rapid_guess_rate',
  'sustained_effort',
  'off_topic_chat',
] as const

export const SUBSCORE_KEYS = [...INDEPENDENCE_SUBSCORES, ...CONCENTRATION_SUBSCORES]

/* The server's trend → the StatDelta chip's Delta. `null` stays null: no
 * honest comparison, no arrow — never a flat line that reads as "unchanged". */
export function deltaFromTrend(trend: ScoreTrend | null | undefined): Delta | null {
  if (!trend || trend.direction === null) return null
  if (typeof trend.deltaPoints !== 'number' || !Number.isFinite(trend.deltaPoints)) return null
  return {
    value: Math.round(trend.deltaPoints),
    unit: 'points',
    direction: trend.direction,
    previous: 0,
  }
}

/* Same thresholds the status band's dials used: ≥70 healthy, ≥40 watch. */
export function scoreTone(value: number | null): 'primary' | 'success' | 'warn' | 'danger' {
  if (value === null) return 'primary'
  if (value >= 70) return 'success'
  if (value >= 40) return 'warn'
  return 'danger'
}

/* The dialog's one question is "why is it down?" — so the signals are grouped
 * by what they DO to the score, not listed as a table. Drags first, ordered
 * by the points they actually cost (weight × shortfall); strengths after.
 * Signals without evidence simply don't appear (Gal, 2026-08-27). */
export interface GroupedSubscores {
  drags: SubScore[]
  strengths: SubScore[]
}

export function groupSubscores(subscores: SubScore[]): GroupedSubscores {
  const measured = subscores.filter((sub) => sub.value !== null)
  const drags = measured
    .filter((sub) => (sub.value as number) < 70)
    .sort((a, b) =>
      b.weight * (100 - (b.value as number)) - a.weight * (100 - (a.value as number)))
  const strengths = measured
    .filter((sub) => (sub.value as number) >= 70)
    .sort((a, b) => (b.value as number) - (a.value as number))
  return { drags, strengths }
}
