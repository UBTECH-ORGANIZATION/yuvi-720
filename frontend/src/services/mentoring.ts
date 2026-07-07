/* Mentoring (F5) + feedback (F7) clients. Required mentoring fields: date,
   teacher, learner, meeting stage, notes, next steps, deadline. */

import { apiGet, apiPost } from './api'
import { CURRENT_LEARNER_ID } from './xapi'

export interface MentoringConversation {
  id?: string
  learner_id?: string
  date: string
  teacher_name: string
  learner_name: string
  meeting_stage: string
  notes: string
  next_steps: string
  deadline: string
  author?: 'teacher' | 'learner'
  visibility?: 'shared' | 'teacher_only'
  teacher_only_note?: string
}

export function createMentoring(conv: MentoringConversation, learnerId = CURRENT_LEARNER_ID) {
  return apiPost<MentoringConversation>('/api/mentoring', { ...conv, learner_id: learnerId })
}
export function listMentoring(role: 'teacher' | 'learner', learnerId = CURRENT_LEARNER_ID) {
  return apiGet<{ conversations: MentoringConversation[] }>(
    `/api/mentoring?learner_id=${encodeURIComponent(learnerId)}&role=${role}`
  )
}

export interface FeedbackInput {
  kind?: 'issue' | 'suggestion' | 'content_fit'
  message: string
  context?: Record<string, unknown>
}
export function postFeedback(input: FeedbackInput, learnerId = CURRENT_LEARNER_ID) {
  return apiPost<{ ok: boolean; id: string }>('/api/feedback', {
    ...input,
    learner_id: learnerId,
    context: { route: location.pathname, ...(input.context || {}) },
  })
}
