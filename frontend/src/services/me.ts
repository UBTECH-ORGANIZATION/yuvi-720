/* The learner's own org position.
 *
 * "Who are my teachers" is a roster question, not a conversation-history
 * question — see routes/me.py for why that distinction mattered.
 */

import { apiGet } from './api'

export interface MyTeacherGroup {
  group_id: string
  name: string | null
  subject: string | null
}

export interface MyTeacherSubgroup {
  subgroup_id: string
  name: string | null
  group_id: string
  /** Who is in it, me included — a group chat is named by its members. */
  members?: { learner_id: string; display_name: string | null }[]
}

export interface MyTeacher {
  teacher_id: string
  display_name: string
  /** Why this teacher can see me — the group is the join (A9). */
  groups: MyTeacherGroup[]
  /** The named slices of those groups that include me — a teacher may write
   *  to one of these as a whole. Absent on older servers. */
  subgroups?: MyTeacherSubgroup[]
}

export function getMyTeachers() {
  return apiGet<{ teachers: MyTeacher[] }>('/api/me/teachers')
}
