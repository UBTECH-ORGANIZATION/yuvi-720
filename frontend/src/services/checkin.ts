/* The daily check-in's API (#452). The learner is always resolved from the
 * session server-side; "asked today" is server state (creating the day's doc),
 * never localStorage. */

import { apiGet, apiPost } from './api'

export interface CheckinQuestion {
  id: string
  text: string
}

export interface CheckinView {
  checkin_id: string
  date_key: string
  status: string
  questions: CheckinQuestion[]
  valence: string | null
  feeling: string | null
  closing_line: string | null
}

export function getCheckinPending() {
  return apiGet<{ due: boolean }>('/api/me/checkin/pending')
}

export function startCheckin(language: string) {
  return apiPost<CheckinView>('/api/me/checkin/start', { language })
}

export function answerCheckin(checkinId: string, questionId: string, answer: string) {
  return apiPost<CheckinView>(
    `/api/me/checkin/${encodeURIComponent(checkinId)}/answer`,
    { question_id: questionId, answer })
}

export function sendCheckinFeeling(
  checkinId: string, valence: string, feeling: string, language: string,
) {
  return apiPost<CheckinView>(
    `/api/me/checkin/${encodeURIComponent(checkinId)}/feeling`,
    { valence, feeling, language })
}

export function skipCheckin(checkinId: string, steps: string[]) {
  return apiPost<CheckinView>(
    `/api/me/checkin/${encodeURIComponent(checkinId)}/skip`, { steps })
}

export function completeCheckin(checkinId: string) {
  return apiPost<CheckinView>(
    `/api/me/checkin/${encodeURIComponent(checkinId)}/complete`, {})
}
