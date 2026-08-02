/* The client's half of the learning-path contract — pure, no JSX, no React.
 *
 * The server decides the route (`services/learning_path.py`); this module is the
 * small set of reads every surface performs on that decision. It lives on its own
 * because three components were doing the same derivations by hand — the roadmap
 * and the 3D track each computed the horizon, the dashboard card and the lesson
 * page each looked up "the next station" — and because none of it was testable
 * inside a .tsx file.
 *
 * The rules encoded here, once:
 *   - an ordinal is never derived from array position (`path_index` is server-owned)
 *   - a station is identified by `path_node_id`, never `id` (a repair round repeats one)
 *   - only `on_path` nodes are the route; everything else is an extra
 *   - the learner is shown a ratio, never a denominator (720 §3.4)
 */

import type { LearningComponentDTO, LearningUnitDTO } from '../../services/learning'

/** This learner's route, in walking order. */
export function onPathNodes(unit: LearningUnitDTO): LearningComponentDTO[] {
  return unit.components
    .filter((component) => component.on_path && component.path_index !== null)
    .sort((first, second) => (first.path_index ?? 0) - (second.path_index ?? 0))
}

/** The station the learner is on, or null when the unit is finished. */
export function currentNode(unit: LearningUnitDTO): LearningComponentDTO | null {
  return unit.components.find((component) => component.progress_state === 'current')
    ?? unit.components.find((component) => component.path_node_id === unit.next_path_node_id)
    ?? null
}

/** How far the route may honestly be drawn: everything settled, the current
 *  station, and one ahead. Beyond that the tail genuinely depends on how the
 *  next step goes, so drawing stations there would be a promise we might take
 *  back — and a promise that would have to renumber when it changed. */
export function horizon(unit: LearningUnitDTO): {
  nodes: LearningComponentDTO[]
  hasHorizon: boolean
} {
  const route = onPathNodes(unit)
  if (unit.tail_certain) return { nodes: route, hasHorizon: false }
  const currentIndex = route.findIndex((component) => component.outcome === null)
  const end = currentIndex < 0 ? route.length : currentIndex + 2
  return { nodes: route.slice(0, end), hasHorizon: end < route.length }
}

/** An optional stage this learner's route dropped — a real, approved extra they
 *  can still choose to take (720 §1 פעלנות). */
export function optionalExtra(unit: LearningUnitDTO): LearningComponentDTO | null {
  return unit.components.find(
    (component) => component.progress_state === 'skipped'
      && component.progress_reason?.code === 'optional_skipped',
  ) ?? null
}

/** The nearest earlier station the learner actually settled.
 *
 *  720 F1 "אפשרות לחזור לתכנים קודמים". Walking `path_index` over settled nodes
 *  is what stops this offering a component they never took, or an extra their
 *  route skipped — both of which the old `order`-based walk would hand back. */
export function previousStation(
  unit: LearningUnitDTO,
  componentId: string,
): LearningComponentDTO | null {
  const route = onPathNodes(unit)
  const index = route.findIndex((component) => component.component_id === componentId)
  if (index <= 0) return null
  for (let i = index - 1; i >= 0; i -= 1) {
    if (route[i].outcome !== null) return route[i]
  }
  return null
}

/** The three stations a card may show: what the learner already did, where they
 *  stand, and the one step ahead.
 *
 *  `next` stops at the horizon by construction — exactly one station past the
 *  current one — so peeking ahead can never promise a station the route may
 *  still take back. It is genuinely not launchable yet (the session gate refuses
 *  anything past the current step), which is why the card draws it locked. */
export function stationPeek(unit: LearningUnitDTO): {
  previous: LearningComponentDTO | null
  current: LearningComponentDTO | null
  next: LearningComponentDTO | null
} {
  const route = onPathNodes(unit)
  const current = currentNode(unit)
  const found = current
    ? route.findIndex((component) => component.path_node_id === current.path_node_id)
    : -1
  // A finished unit (or a current node that is off the route) has no "ahead":
  // everything settled sits behind the learner.
  const index = found < 0 ? route.length : found

  let previous: LearningComponentDTO | null = null
  for (let i = index - 1; i >= 0; i -= 1) {
    if (route[i].outcome !== null) { previous = route[i]; break }
  }

  return {
    previous,
    current,
    next: index + 1 < route.length ? route[index + 1] : null,
  }
}

export type LessonCardStatus = 'active' | 'inProgress' | 'completed' | 'notStarted'

export interface LessonCardView {
  status: LessonCardStatus
  target: LearningComponentDTO | null
  /** 0…1 for THIS learner's path. Rendered as a trail, never as a number. */
  progress: number
  /** Minutes still ahead ON THE ROUTE — an extra they will never be routed
   *  through is not time they owe. */
  minutesLeft: number | null
}

export function lessonCardView(unit: LearningUnitDTO): LessonCardView {
  const route = onPathNodes(unit)
  const current = unit.components.find((component) => component.progress_state === 'current') ?? null

  let status: LessonCardStatus
  if (current) status = 'active'
  else if (unit.unit_state === 'completed') status = 'completed'
  else if ((unit.steps_completed ?? 0) > 0) status = 'inProgress'
  else status = 'notStarted'

  const minutesLeft = route
    .filter((component) => component.outcome === null)
    .reduce<number | null>((sum, component) => {
      if (component.estimated_minutes == null) return sum
      return (sum ?? 0) + component.estimated_minutes
    }, null)

  return {
    status,
    target: current ?? currentNode(unit) ?? route[0] ?? unit.components[0] ?? null,
    progress: unit.progress_ratio ?? 0,
    minutesLeft,
  }
}

/** The i18n key for "what now", from the NEXT station's reason.
 *
 *  Codes only — the evidence behind them (band, EWMA, the failing event) never
 *  leaves the teacher's `?explain=1` view, and no mastery level is ever named. */
export function whatNowKey(next: LearningComponentDTO | null): string {
  if (!next) return 'learning.path.next.unit_completed_by_assessment'
  return `learning.path.next.${next.progress_reason?.code || 'provider_order'}`
}

/** A bar that never retracts.
 *
 *  Inserting a repair round takes 3/5 → 3/6, so the honest ratio drops and a
 *  naive bar visibly goes backwards — worse than a moving number. Growth belongs
 *  on the track ahead of the learner, never on the part they have walked. */
export function monotoneRatio(seen: number, ratio: number): number {
  return Math.max(0, Math.min(1, Math.max(seen || 0, ratio || 0)))
}

/** The glyph a station wears. Not an ordinal: with a repeatable station and a
 *  skippable stage, array position stopped meaning "step number". */
export function stationGlyph(component: LearningComponentDTO): string {
  if (component.progress_state === 'completed') return '✓'
  if (component.outcome === 'failed') return '↻'
  if (component.progress_state === 'current') return '★'
  return '·'
}
