/* The model behind the student goals screen: what state a goal is in, and which
 * day it belongs under.
 *
 * Kept apart from the page so the ordering decisions here — where a missed date
 * sits, and where a goal with no date goes — can be asserted directly instead of
 * being whatever a sort comparator happened to do.
 */

import type { GoalProgressStage, MentoringConversation, MentoringGoal } from '../../services/mentoring'

const PROGRESS_STAGES: GoalProgressStage[] = ['chosen', 'started', 'progressed', 'summarized']

export function goalStage(goal: MentoringGoal): GoalProgressStage {
  return goal.progress_stage && PROGRESS_STAGES.includes(goal.progress_stage) ? goal.progress_stage : 'chosen'
}

// Three learner-facing statuses (new / in progress / done), mapped onto the
// stored progress stages.
export type GoalStatus = 'new' | 'in_progress' | 'done'

export const STATUS_TO_STAGE: Record<GoalStatus, GoalProgressStage> =
  { new: 'chosen', in_progress: 'started', done: 'summarized' }

export function goalStatus(goal: MentoringGoal): GoalStatus {
  const stage = goalStage(goal)
  if (stage === 'summarized') return 'done'
  if (stage === 'chosen') return 'new'
  return 'in_progress'
}

export function isOverdue(goal: MentoringGoal): boolean {
  if (!goal.deadline || goalStatus(goal) === 'done') return false
  return goal.deadline < today()
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** One goal, remembering the talk it came out of. */
export interface GoalEntry { goal: MentoringGoal; conversation: MentoringConversation }

/** Every goal due on the same day, under one heading. */
export interface DayGroup {
  key: string
  /** ISO date, or '' for goals nobody put a date on. */
  date: string
  entries: GoalEntry[]
  /** At least one goal here is past its date and still open. */
  late: boolean
  /** A past day with nothing outstanding: history, not a to-do. */
  settled: boolean
}

/** Regroup every goal from every talk by the date it is due.
 *
 * The screen used to be organised by the date the talk happened, which is the
 * one date a goal cannot be acted on. Two goals agreed in different talks but
 * due the same day belong side by side, so the day is the unit here and the
 * talk is demoted to a line on the card.
 */
export function buildDayGroups(rows: MentoringConversation[]): DayGroup[] {
  const now = today()
  const byDay = new Map<string, GoalEntry[]>()
  for (const conversation of rows) {
    for (const goal of conversation.goals || []) {
      const date = goal.deadline || ''
      const bucket = byDay.get(date)
      if (bucket) bucket.push({ goal, conversation })
      else byDay.set(date, [{ goal, conversation }])
    }
  }
  const groups: DayGroup[] = [...byDay.entries()].map(([date, entries]) => ({
    key: date || 'undated',
    date,
    entries,
    late: Boolean(date) && date < now && entries.some((entry) => goalStatus(entry.goal) !== 'done'),
    settled: Boolean(date) && date < now && entries.every((entry) => goalStatus(entry.goal) === 'done'),
  }))
  /* Plain chronological order, on purpose. A missed date keeps its real place
     on the line — which puts it above today, where it is seen first — instead
     of being hoisted into a separate "late" pile that would say the date no
     longer means anything. The heading carries the late marker instead.
     Goals with no date have no place in that order, so they get an explicit
     home at the end rather than falling out of the list. */
  groups.sort((a, b) => {
    if (!a.date) return 1
    if (!b.date) return -1
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  })
  return groups
}
