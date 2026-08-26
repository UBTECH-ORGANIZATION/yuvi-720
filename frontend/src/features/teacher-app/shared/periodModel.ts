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

/* How a change is measured — and it is not one choice for every KPI.
 *
 * `relative` is the ordinary "up 12%" of a plain quantity: minutes, counts.
 *
 * `points` is for a metric that is ITSELF a percentage. Engagement moving from
 * 24% to 83% is a rise of 59 percentage points; reported relatively it is
 * "+246%", which is arithmetically true and unreadable — engagement cannot
 * more-than-triple when its ceiling is 100, so the number reads as a bug even
 * though it is not. Percentage points are the honest unit for a percentage,
 * and they are labelled as such on screen so the two can never be confused.
 */
export type DeltaUnit = 'relative' | 'points'

export interface Delta {
  /** Signed magnitude, in `unit`. */
  value: number
  unit: DeltaUnit
  direction: 'up' | 'down' | 'flat'
  /** What it was — so the chip can say where the arrow came from. */
  previous: number
}

/* The change from the previous window to this one.
 *
 * `null` means "no comparison to make", and it is deliberately NOT folded into
 * a zero or an arrow. Several different things arrive here as a missing
 * previous value — the window before this one had no data, the metric itself is
 * unavailable (no usable timing evidence), or the class is new — and every one
 * of them is a reason to say nothing rather than to draw a flat line that reads
 * as "unchanged".
 *
 * A previous value of exactly 0 only defeats `relative`, where any rise off
 * zero is an infinite percentage and there is no honest number to print. In
 * `points` it is an ordinary subtraction: a class that went from nobody active
 * to 90% active rose 90 points, which is both true and the single most worth
 * saying. That case is why the unit is per-metric and not a global choice.
 */
export function delta(
  current: number | null | undefined,
  previous: number | null | undefined,
  unit: DeltaUnit = 'relative',
): Delta | null {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null
  if (typeof previous !== 'number' || !Number.isFinite(previous)) return null

  if (unit === 'points') {
    const value = Math.round(current - previous)
    return {
      value, unit, previous,
      direction: value > 0 ? 'up' : value < 0 ? 'down' : 'flat',
    }
  }

  if (previous === 0) {
    return current === 0
      ? { value: 0, unit, previous, direction: 'flat' }
      : null
  }
  const value = Math.round(((current - previous) / Math.abs(previous)) * 100)
  return {
    value, unit, previous,
    direction: value > 0 ? 'up' : value < 0 ? 'down' : 'flat',
  }
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
