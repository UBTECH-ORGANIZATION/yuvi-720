/* What state a goal is in, and how it is named — one definition, shared.
 *
 * Lifted out of `TeacherGoalsPage` when the conversation history needed the
 * same three helpers: the page imports the history and the history imports
 * these, which as one module is an import cycle. They belong on their own
 * anyway — a goal's state is not a property of the screen that renders it.
 */

import type { StudentGoal } from '../../../services/teacher'

/** The one definition of what state a goal is in.
 *
 *  It was written twice — once for the sort and the counts, once inline in the
 *  pill — so the board could rank a goal as "needs help" and label it "active".
 */
export type GoalState = 'approved' | 'done' | 'help' | 'active'

export function stateOf(goal: StudentGoal): GoalState {
  if (goal.approved_by) return 'approved'
  /* Done two ways: the child said so (`summarized`), or the platform counted
     it — an action-tracked goal whose target was reached is finished work
     even if the child never pressed anything. Both wait for the teacher. */
  if (goal.progress_stage === 'summarized' || goal.progress?.met) return 'done'
  if (goal.needs_help) return 'help'
  return 'active'
}

export const STATE_TONE: Record<GoalState, 'strong' | 'steady' | 'support' | 'neutral'> = {
  approved: 'strong', done: 'steady', help: 'support', active: 'neutral',
}

/** A goal whose title is a bare identifier is labelled, never printed raw.
 *
 *  Seed and imported goals arrive titled "בדיקת לולאת יעדים 1785912066705".
 *  Rendering that verbatim puts a database key in front of a teacher as if it
 *  were the name of something a child is working on.
 */
export function goalTitle(
  goal: StudentGoal, t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const title = (goal.title ?? '').trim()
  if (!title) return t('tch.goalsPage.untitled')
  // A long run of digits is an id, not a name a person typed.
  const cleaned = title.replace(/\s*\b\d{10,}\b\s*/g, ' ').trim()
  return cleaned || t('tch.goalsPage.untitled')
}
