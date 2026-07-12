/* Teacher view + org clients (F6/F8). Every insight/flag carries raw evidence;
   access is group-scoped server-side. */

import { apiGet, apiPost } from './api'

export interface AttentionFlag { reason: string; evidence: string; kind?: string }
export interface WellbeingFlag { evidence: string; at?: string; source?: string }
export interface StudentInsight {
  learner_id: string
  display_name: string | null
  progress: Record<string, { objectives_total: number; objectives_mastered: number }>
  next: Record<string, string[]>
  struggle_items: { label?: string; objective_id?: string; evidence?: string[] | null }[]
  strengths: string[]
  attention: AttentionFlag | null
  wellbeing_flags: WellbeingFlag[]
  recommendations: string[]
  timeline: { verb?: string; objective_id?: string; success?: boolean | null; at?: string }[]
  reflections_recent: unknown[]
}
export interface GroupInsight {
  group: { id: string; name: string; subject?: string } | null
  students: { learner_id: string; display_name: string | null; attention: AttentionFlag | null; progress: unknown }[]
  trends: { students_total: number; active_last_7d: number; needing_attention: number; objectives_mastered_total: number }
  attention: (AttentionFlag & { learner_id: string; display_name: string | null })[]
}
export interface Group { id: string; name: string; subject?: string; teacher_id?: string }

export function getGroupInsights(groupId: string, language: string, teacherId = 'teacher-demo') {
  return apiPost<GroupInsight>('/api/agent/insights', { teacher_id: teacherId, group_id: groupId, language })
}
export function getStudentInsights(learnerId: string, language: string, teacherId = 'teacher-demo') {
  return apiPost<StudentInsight>('/api/agent/insights', { teacher_id: teacherId, learner_id: learnerId, language })
}
export function listGroups(teacherId = 'teacher-demo') {
  return apiGet<{ groups: Group[] }>(`/api/groups?teacher_id=${encodeURIComponent(teacherId)}`)
}
export function saveDirective(
  learnerId: string,
  text: string,
  opts: { scope?: string; priority?: string; visible_to_learner?: boolean } = {},
  teacherId = 'teacher-demo'
) {
  return apiPost('/api/teacher/directive', { teacher_id: teacherId, learner_id: learnerId, text, ...opts })
}
