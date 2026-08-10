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

export interface MyTeacher {
  teacher_id: string
  display_name: string
  /** Why this teacher can see me — the group is the join (A9). */
  groups: MyTeacherGroup[]
}

export function getMyTeachers() {
  return apiGet<{ teachers: MyTeacher[] }>('/api/me/teachers')
}
