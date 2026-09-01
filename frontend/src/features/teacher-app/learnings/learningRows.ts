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

/* ── grouping by objective ─────────────────────────────────────────────────
 *
 * The first glance is objectives, not lomdot: forty learning cards is a wall,
 * a dozen objective cards is a map. Clicking one opens the lomdot inside it.
 */

/** The fields grouping reads — a structural subset of `LearningRow`. */
export interface GroupableLearning extends RankableLearning {
  objective_id: string | null
  objective_title: string | null
  subject: string | null
  attempts: number
  correct: number
}

/** The bucket for rows that serve no catalogued objective. Not an id, so it
 *  can never collide with one (same trick as the page's NO_UNIT). */
export const NO_OBJECTIVE = '\u0000no-objective'

/** One bucket per objective ID; a title without an id still gets its own
 *  bucket rather than being lumped with the truly objective-less rows. */
export function objectiveKeyOf(row: GroupableLearning): string {
  if (row.objective_id) return row.objective_id
  if (row.objective_title) return `\u0000t:${row.objective_title}`
  return NO_OBJECTIVE
}

export interface ObjectiveGroup<T extends GroupableLearning> {
  key: string
  objectiveId: string | null
  title: string | null
  subject: string | null
  rows: T[]
  /** How many of the rows the class has opened at all. */
  started: number
  attempts: number
  correct: number
  /** Folded over raw attempts, never averaged over rates: two attempts on one
   *  lomda must not weigh like two hundred on another. Null before any. */
  successRate: number | null
  /** How many rows would sit in the pinned "went badly" group — the card's
   *  flag, so trouble stays visible from the objectives view too. */
  attention: number
  lastAt: string | null
}

/**
 * The best name a group has when its objective was never titled.
 *
 * "ללא יעד" ×3 under one subject tells the teacher nothing — the cards are
 * only distinguishable by what is INSIDE them, so that is where the name
 * comes from: a single lomda lends its own name, several lomdot sharing one
 * unit lend the unit's. Only a mixed bag with no shared unit stays nameless.
 */
export function objectiveGroupName<
  T extends GroupableLearning & NameableLearning & { unit_title?: string | null },
>(group: ObjectiveGroup<T>): string | null {
  if (group.title) return group.title
  if (group.rows.length === 1) {
    const name = learningName(group.rows[0])
    if (name.named) return name.title
    // An unnamed lomda still falls through to its unit below.
  }
  const units = new Set(group.rows.map((row) => row.unit_title ?? ''))
  if (units.size === 1) {
    const only = [...units][0]
    return only || null
  }
  return null
}

/**
 * Bucket rows by objective. Objectives with trouble surface first, then the
 * most recently worked — the same "live material on top" rule the unit
 * sections use, with the same MoE C5 shape: these rank MATERIAL, and the rows
 * carry no learner ids at all.
 */
export function groupByObjective<T extends GroupableLearning>(
  rows: T[],
): ObjectiveGroup<T>[] {
  const buckets = new Map<string, ObjectiveGroup<T>>()
  for (const row of rows) {
    const key = objectiveKeyOf(row)
    const group = buckets.get(key) ?? {
      key,
      objectiveId: row.objective_id ?? null,
      title: row.objective_title ?? null,
      subject: row.subject ?? null,
      rows: [] as T[],
      started: 0, attempts: 0, correct: 0,
      successRate: null, attention: 0, lastAt: null,
    }
    group.rows.push(row)
    if (row.started) group.started += 1
    group.attempts += row.attempts
    group.correct += row.correct
    if (needsAttention(row)) group.attention += 1
    if (row.last_activity_at && (group.lastAt ?? '') < row.last_activity_at) {
      group.lastAt = row.last_activity_at
    }
    buckets.set(key, group)
  }
  return [...buckets.values()]
    .map((group) => ({
      ...group,
      successRate: group.attempts ? group.correct / group.attempts : null,
    }))
    .sort((a, b) =>
      Number(b.attention > 0) - Number(a.attention > 0)
      || (b.lastAt ?? '').localeCompare(a.lastAt ?? '')
      || (a.title ?? '').localeCompare(b.title ?? ''))
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
