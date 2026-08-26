/* How long a stretch the dashboard is read over, and how this stretch compares
 * to the one before it.
 *
 * The four periods are TRAILING windows, not calendar-anchored ones: "week"
 * means the last seven days and the seven before those, never "this week so
 * far" against "all of last week". Both halves are therefore always the same
 * length, so a Tuesday is never measured against a finished week and made to
 * look like a collapse.
 *
 * This is NOT part of the scope bar. Scope says WHO a teacher is looking at
 * (class, sub-group, subject) and applies to the whole portal; a period says
 * over how long, and applies to one screen. Putting it in the bar would have
 * made every other teacher screen owe an explanation for ignoring it.
 */

export type PeriodId = 'day' | '3day' | 'week' | 'month'

export const PERIODS: { id: PeriodId; days: number }[] = [
  { id: 'day', days: 1 },
  { id: '3day', days: 3 },
  { id: 'week', days: 7 },
  { id: 'month', days: 30 },
]

/* A week: long enough that a quiet Tuesday does not empty the screen, short
   enough to still be about now. It is also the window every one of these
   numbers used before there was a choice, so a teacher who never touches the
   control sees exactly what they saw yesterday. */
export const DEFAULT_PERIOD: PeriodId = 'week'

export function isPeriodId(value: unknown): value is PeriodId {
  return PERIODS.some((row) => row.id === value)
}

export function periodDays(id: PeriodId): number {
  return PERIODS.find((row) => row.id === id)?.days ?? 7
}

/* The way back, for components handed a window length rather than a choice —
 * the class book takes days because that is what it measures with, but its copy
 * has to name the period ("last week", not "the previous 7 days"). Falls back
 * to the nearest defined period so an unknown length still reads as something. */
export function periodIdForDays(days: number): PeriodId {
  const exact = PERIODS.find((row) => row.days === days)
  if (exact) return exact.id
  return PERIODS.reduce((best, row) => (
    Math.abs(row.days - days) < Math.abs(best.days - days) ? row : best
  ), PERIODS[0]).id
}

export interface Delta {
  /** Whole percent, signed. */
  pct: number
  direction: 'up' | 'down' | 'flat'
}

/* The change from the previous window to this one.
 *
 * `null` means "no comparison to make", and it is deliberately NOT folded into
 * a zero or an arrow. Three different things arrive here as a missing previous
 * value — the window before this one had no data, the metric itself is
 * unavailable (no usable timing evidence), or the class is new — and every one
 * of them is a reason to say nothing rather than to draw a flat line that reads
 * as "unchanged".
 *
 * A previous value of exactly 0 is the sharpest case: any rise off zero is an
 * infinite percentage, so there is no honest number to print. The KPI shows the
 * new value with no arrow instead of "+∞%" or a fabricated "+100%".
 */
export function delta(
  current: number | null | undefined,
  previous: number | null | undefined,
): Delta | null {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null
  if (typeof previous !== 'number' || !Number.isFinite(previous)) return null
  if (previous === 0) return current === 0 ? { pct: 0, direction: 'flat' } : null
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100)
  return { pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' }
}

/* What happened to the topic holding the class back.
 *
 * Four outcomes, and they are not the same sentence: the class is stuck on what
 * it was stuck on before, it has moved to a different topic, it was stuck on
 * something and no longer is, or there is nothing to compare against because
 * the previous window had no evidence. The KPI says which — "what to teach
 * next" is only actionable if the teacher can see whether last week's answer
 * worked.
 */
export type TopicShift =
  | { kind: 'same' }
  | { kind: 'moved'; from: string }
  | { kind: 'cleared'; from: string }
  | { kind: 'unknown' }

export function topicShift(
  current: { objective_id: string; label: string } | null,
  previous: { objective_id: string; label: string } | null,
): TopicShift {
  if (!previous) return { kind: 'unknown' }
  if (!current) return { kind: 'cleared', from: previous.label }
  if (current.objective_id === previous.objective_id) return { kind: 'same' }
  return { kind: 'moved', from: previous.label }
}
