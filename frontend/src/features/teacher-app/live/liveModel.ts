/* The live view's one source of truth (#249, B4).
 *
 * Rows, KPI counts and the spread strip all answer "where is this child and
 * who needs me" — and if each computed it separately they would eventually
 * disagree on screen, in front of a class. So the answers live here, as pure
 * functions over the presence frame, with `now` passed in: nothing in this
 * file reads a clock, which is what makes every rule below testable.
 *
 * The honesty rules, inherited from presence itself:
 * - `status` is xAPI-authoritative; a client-reported surface can place a
 *   child in the studio but can never claim "in a lesson".
 * - "chat" is derived from `chat_at` recency, never reported, so it decays.
 * - offline trumps every claim — a report from a connection that has since
 *   dropped is a memory, not a location.
 */

import type { Presence } from '../../../services/teacher'

/** A chat turn this recent means "talking with Yuvi right now". */
export const CHAT_RECENT_SECONDS = 120
/** Connected but silent for this long is a signal, not a nothing. */
export const QUIET_AFTER_SECONDS = 300

export type Where = 'offline' | 'lesson' | 'chat' | 'studio' | 'browsing' | 'unknown'

const secondsSince = (stamp: string | null | undefined, now: number): number => {
  if (!stamp) return Infinity
  const at = Date.parse(stamp)
  return Number.isNaN(at) ? Infinity : (now - at) / 1000
}

/** Where one child is. Precedence: offline > lesson (status) > chat
 *  (`chat_at` ≤ {@link CHAT_RECENT_SECONDS}) > studio/browsing (reported) >
 *  unknown. A reported "lesson" surface deliberately does NOT reach `lesson` —
 *  only the xAPI-fed status may say that. */
export function whereOf(presence: Presence, now: number): Where {
  if (presence.status === 'offline') return 'offline'
  if (presence.status === 'in_lesson') return 'lesson'
  if (secondsSince(presence.chat_at, now) <= CHAT_RECENT_SECONDS) return 'chat'
  if (presence.surface === 'studio') return 'studio'
  if (presence.surface === 'browsing') return 'browsing'
  return 'unknown'
}

export type Signal =
  | { kind: 'hand'; since: string }
  | { kind: 'struggling'; struggle: NonNullable<Presence['struggling']> }
  | { kind: 'quiet'; since: string }
  | null

/** The one thing worth saying about this child, most urgent first: a raised
 *  hand, then a detector-backed struggle (always with its evidence — never a
 *  bare badge), then connected-but-silent. Every variant carries a timestamp
 *  because the UI must always render an ago-label next to it. */
export function signalOf(presence: Presence, now: number): Signal {
  if (presence.help_requested_at) {
    return { kind: 'hand', since: presence.help_requested_at }
  }
  if (presence.struggling) {
    return { kind: 'struggling', struggle: presence.struggling }
  }
  if (
    presence.status !== 'offline'
    && presence.last_seen_at
    && secondsSince(presence.last_seen_at, now) >= QUIET_AFTER_SECONDS
  ) {
    return { kind: 'quiet', since: presence.last_seen_at }
  }
  return null
}

/** Whether this child counts as "in the lesson" for the class partition:
 *  the proven state (xAPI status), a chat with Yuvi, or SITTING ON a lesson
 *  page (reported surface). The reported case never reaches `whereOf`'s
 *  'lesson' — the row's label still says "בדף שיעור" until activity proves
 *  more — but a teacher asking "how many are in the lesson?" means all
 *  three, and a KPI reading 0 beside a row that says lesson-page reads as
 *  a bug, not as epistemics. */
export function countsAsLesson(presence: Presence, now: number): boolean {
  const where = whereOf(presence, now)
  if (where === 'lesson' || where === 'chat') return true
  return where === 'browsing' && presence.surface_screen === 'learning_lesson'
}

/** Triage band, lower = more urgent. Chat and the lesson page ride with the
 *  lesson band (they are working); studio/browsing/unknown share the
 *  "elsewhere" band — an unknown surface is not more or less urgent than a
 *  known browsing one. */
function bandOf(presence: Presence, now: number): number {
  const signal = signalOf(presence, now)
  if (signal?.kind === 'hand') return 0
  if (signal?.kind === 'struggling') return 1
  if (countsAsLesson(presence, now)) return 2
  if (whereOf(presence, now) === 'offline') return 4
  return 3
}

const BLANK: Presence = {
  learner_id: '', status: 'offline', connections: 0,
  component_id: null, unit_id: null, objective_id: null, session_id: null,
  last_seen_at: null, lesson_entered_at: null, struggling: null,
  help_requested_at: null, surface: null, surface_screen: null, surface_title: null, surface_subject: null, surface_at: null, chat_at: null,
}

/** Attention order: hand → struggling → in a lesson → elsewhere → offline,
 *  alphabetical inside each band. NEVER numbered on screen — a ranking of
 *  children is a league table the moment it grows digits.
 *
 *  Deliberately separate from the roster's `sortRows`, whose alphabetical
 *  default is contract- and test-pinned: manage-mode sorting answers "find a
 *  child", this answers "who needs me first" — different questions. */
export function triageOrder<Row extends { learner_id: string; name: string }>(
  rows: Row[],
  presenceOf: (learnerId: string) => Presence | undefined,
  now: number,
): Row[] {
  return [...rows].sort((a, b) => {
    const bandA = bandOf(presenceOf(a.learner_id) ?? BLANK, now)
    const bandB = bandOf(presenceOf(b.learner_id) ?? BLANK, now)
    if (bandA !== bandB) return bandA - bandB
    return a.name.localeCompare(b.name)
  })
}

export interface LiveCounts {
  hand: number
  struggling: number
  lesson: number
  elsewhere: number
  offline: number
}

/** The five KPI cards. `hand` and `struggling` intentionally overlap the
 *  location counts (a child with a hand up is also somewhere): the location
 *  triplet partitions the class, the two signal counts sit on top of it. */
export function liveCounts(presences: Presence[], now: number): LiveCounts {
  const counts: LiveCounts = { hand: 0, struggling: 0, lesson: 0, elsewhere: 0, offline: 0 }
  for (const presence of presences) {
    const signal = signalOf(presence, now)
    if (signal?.kind === 'hand') counts.hand += 1
    if (presence.struggling) counts.struggling += 1
    if (countsAsLesson(presence, now)) counts.lesson += 1
    else if (whereOf(presence, now) === 'offline') counts.offline += 1
    else counts.elsewhere += 1
  }
  return counts
}

/** Whether one child belongs to one KPI bucket — the SAME arithmetic as
 *  {@link liveCounts}, so pressing a card can never produce a list whose
 *  length disagrees with the number that was on it. */
export function inBucket(presence: Presence, bucket: keyof LiveCounts, now: number): boolean {
  if (bucket === 'hand') return signalOf(presence, now)?.kind === 'hand'
  if (bucket === 'struggling') return presence.struggling !== null
  if (bucket === 'lesson') return countsAsLesson(presence, now)
  const where = whereOf(presence, now)
  if (bucket === 'offline') return where === 'offline'
  return where !== 'offline' && !countsAsLesson(presence, now)
}

export interface ObjectiveSpread {
  objective_id: string
  title: string
  count: number
}

/** Who is on what, for the spread strip: learners currently IN a lesson,
 *  grouped by objective, biggest cluster first. Only real lesson state counts
 *  — a remembered objective on an offline child is history, not spread. */
export function spreadByObjective(presences: Presence[], now: number): ObjectiveSpread[] {
  const clusters = new Map<string, ObjectiveSpread>()
  for (const presence of presences) {
    if (whereOf(presence, now) !== 'lesson' || !presence.objective_id) continue
    const existing = clusters.get(presence.objective_id)
    if (existing) {
      existing.count += 1
      if (!existing.title && presence.objective_title) existing.title = presence.objective_title
    } else {
      clusters.set(presence.objective_id, {
        objective_id: presence.objective_id,
        title: presence.objective_title || '',
        count: 1,
      })
    }
  }
  return [...clusters.values()].sort(
    (a, b) => b.count - a.count || a.objective_id.localeCompare(b.objective_id))
}
