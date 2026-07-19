/* Mentoring (F5) + feedback (F7) clients. Required mentoring fields: date,
   teacher, learner, meeting stage, notes, next steps, deadline. */

import { apiGet, apiPost } from './api'

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

export function createMentoring(conv: MentoringConversation) {
  return apiPost<MentoringConversation>('/api/mentoring', conv)
}
export function listMentoring(role: 'teacher' | 'learner') {
  return apiGet<{ conversations: MentoringConversation[] }>(
    `/api/mentoring?role=${role}`
  )
}

export interface FeedbackInput {
  kind?: 'issue' | 'suggestion' | 'content_fit'
  message: string
  context?: Record<string, unknown>
}
export function postFeedback(input: FeedbackInput) {
  return apiPost<{ ok: boolean; id: string }>('/api/feedback', {
    ...input,
    context: { route: location.pathname, ...(input.context || {}) },
  })
}
