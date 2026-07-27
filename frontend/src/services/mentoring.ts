/* Mentoring (F5) + feedback (F7) clients. Required mentoring fields: date,
   teacher, learner, meeting stage, notes, next steps, deadline. */

import { apiDelete, apiGet, apiPost } from './api'
import type { RewardGrant } from './rewards'

export type GoalProgressStage = 'chosen' | 'started' | 'progressed' | 'summarized'

/** One goal agreed in a mentoring conversation, with its own attributes. */
export interface MentoringGoal {
  id?: string
  title: string
  next_steps?: string
  deadline?: string
  progress_stage?: GoalProgressStage
  status?: string
  from_yuvi?: boolean
  needs_help?: boolean
  help_requested_at?: string | null
}

/** A documented conversation (the object of record) plus the goals set in it. */
export interface MentoringConversation {
  id?: string
  learner_id?: string
  date: string
  teacher_name: string
  learner_name: string
  meeting_stage: string
  notes: string
  goals?: MentoringGoal[]
  author?: 'teacher' | 'learner'
  visibility?: 'shared' | 'teacher_only'
  teacher_only_note?: string
  created_at?: string
  /** Sparks granted by the action that returned this record (progress/help). */
  reward?: RewardGrant
}

export function createMentoring(conv: MentoringConversation) {
  return apiPost<MentoringConversation>('/api/mentoring', conv)
}
export function listMentoring(role: 'teacher' | 'learner') {
  return apiGet<{ conversations: MentoringConversation[] }>(
    `/api/mentoring?role=${role}`
  )
}

export function updateGoalProgress(
  conversationId: string,
  goalId: string,
  progress_stage: GoalProgressStage,
) {
  return apiPost<MentoringConversation>(
    `/api/mentoring/${conversationId}/goals/${goalId}/progress`,
    { progress_stage },
  )
}

export function deleteGoal(conversationId: string, goalId: string) {
  return apiDelete<{ ok: true; id: string }>(`/api/mentoring/${conversationId}/goals/${goalId}`)
}

/** Flag a goal as "struggling" so the teacher can be alerted later (stored in DB). */
export function requestGoalHelp(conversationId: string, goalId: string) {
  return apiPost<MentoringConversation>(`/api/mentoring/${conversationId}/goals/${goalId}/help`, {})
}

export function deleteConversation(conversationId: string) {
  return apiDelete<{ ok: true; id: string }>(`/api/mentoring/${conversationId}`)
}

export interface YuviQA { q: string; a: string }

/** One turn of Yuvi's guided writing helper: rebuilds the draft (the saved
    documentation) and offers the next question with quick-choice options. */
export function assistMentoring(input: {
  language: string
  qa: YuviQA[]
  notes?: string
  feeling?: string
  more?: boolean
}) {
  return apiPost<{ draft: string; question: string; options: string[]; phase: 'asking' | 'ready'; ai?: boolean }>(
    '/api/mentoring/assist',
    input,
  )
}

export interface GoalRecommendation {
  id: string
  title: string
  next_steps: string
  deadline: string
  rationale: string
  ai?: boolean
}

/** Yuvi suggests ONE goal (within a one-week window) from the documented talk.
    The suggestion is persisted server-side whether or not the learner takes it. */
export function recommendGoal(input: { language: string; notes: string; feeling?: string }) {
  return apiPost<GoalRecommendation>('/api/mentoring/recommend-goal', input)
}

/** Record that the learner accepted or dismissed Yuvi's goal (kept either way). */
export function setRecommendationStatus(recId: string, status: 'accepted' | 'dismissed') {
  return apiPost<{ ok: boolean; id: string; status: string }>(
    `/api/mentoring/recommend-goal/${recId}/status`,
    { status },
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
