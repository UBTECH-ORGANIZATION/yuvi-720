/* How a learning is named, and which learnings jump the queue.
 *
 * Two decisions that were made inline in the page and were both wrong there:
 *
 *   naming — `learning_analytics._catalog_spine` writes `title: component.title
 *            or component_id`, and the off-catalogue branch writes `title:
 *            component_id` outright. So a component the vendor shipped without
 *            a title renders as `ENG.G7.FAMILY.SPEAK-01` in the biggest text on
 *            the card. That is an internal identifier sitting in the slot
 *            reserved for a human name.
 *
 *   order  — the catalogue is the spine, so every published learning has a row
 *            whether or not anyone opened it. That is right for finding
 *            material and wrong for the question a teacher opens this screen
 *            with, which is "what went badly this week".
 *
 * JSX-free so `node --test` can import it directly (see `actionKey.ts`).
 */

/** The fields naming and ranking actually read — a structural subset of
 *  `LearningRow`, so the page passes its rows straight in. */
export interface NameableLearning {
  component_id: string
  title: string
  objective_title?: string | null
}

export interface RankableLearning {
  started: boolean
  struggling_count: number
  success_rate: number | null
  last_activity_at?: string | null
}

/** Below this, a learning is not "a bit hard" — it is not working.
 *
 *  Deliberately the `rateTone` DANGER boundary and not its warn one: the pinned
 *  group is only useful while it is short, and at the warn threshold two thirds
 *  of a live class's learnings qualify and the pin says nothing. */
export const ATTENTION_MAX_SUCCESS = 0.5

export interface LearningName {
  /** What to show in the title slot. */
  title: string
  /** True when that title is a human name; false when the only name this row
   *  has is its own id and the UI must present it as an identifier. */
  named: boolean
  /** The raw component id, when it is worth showing as small meta beside a
   *  real title. Null when the title already IS the id (never twice). */
  rawId: string | null
}

/**
 * The best name this row has.
 *
 * The objective title is the fallback because it is the one localized string
 * the payload carries for a component the catalogue could not name — the
 * learning belongs to a goal even when nobody titled it.
 *
 * Nothing here invents a name. When there is none, `named` is false and the
 * caller renders the id AS an id: a teacher still has to tell five untitled
 * rows apart, and the id is the only thing that distinguishes them, so hiding
 * it behind "untitled learning" ×5 would be worse than showing it.
 */
export function learningName(row: NameableLearning): LearningName {
  const title = (row.title ?? '').trim()
  if (title && title !== row.component_id) {
    return { title, named: true, rawId: null }
  }
  const objective = (row.objective_title ?? '').trim()
  if (objective) {
    return { title: objective, named: true, rawId: row.component_id }
  }
  return { title: row.component_id, named: false, rawId: null }
}

/**
 * Whether a learning belongs in the pinned group above the unit sections.
 *
 * Started only: an untouched learning cannot have gone badly, and the whole
 * catalogue would otherwise pile in on a `success_rate` of `null`.
 */
export function needsAttention(row: RankableLearning): boolean {
  if (!row.started) return false
  if (row.struggling_count > 0) return true
  return row.success_rate !== null && row.success_rate < ATTENTION_MAX_SUCCESS
}

/**
 * Worst first, inside the pinned group.
 *
 * `struggling_count` outranks the success rate deliberately, and it does put a
 * learning at 33% above one at 0%. The count is a per-learner judgement the
 * backend already threshold-guarded (`STRUGGLE_MIN_ATTEMPTS` attempts before a
 * child counts as struggling); a raw rate is not, so "0%" is as often two
 * attempts by one child on a Friday as it is a class that cannot do this. One
 * named struggler is firmer ground than a low fraction of almost nothing.
 *
 * This ranks MATERIAL, never children — the rows carry counts and no learner
 * ids at all (MoE C5, and the payload behind this screen has no `learner_id`
 * field to rank by even if someone tried).
 */
export function byAttention<T extends RankableLearning>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    b.struggling_count - a.struggling_count
    || (a.success_rate ?? 1) - (b.success_rate ?? 1)
    || (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''))
}
