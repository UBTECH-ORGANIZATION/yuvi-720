import { apiGet, apiPost } from './api'
import type { Language } from '../i18n/I18nProvider'

export type LearningSubject = 'math' | 'science' | 'other'
export type LearningProgressState = 'completed' | 'current' | 'available' | 'locked'

export interface LearningComponentDTO {
  id: string
  unit_id: string
  title: string
  purpose: string | null
  is_assessment: boolean
  is_required: boolean
  relative_difficulty: number | null
  mastery_level: string | null
  order: number | null
  languages: Language[]
  estimated_minutes: number | null
  recommended_after_fail: string[]
  information_to_bot: string | null
  question_ids: string[]
  progress_state: LearningProgressState
  progress_evidence: {
    kind: 'xapi_completed' | 'brain_current_state' | 'provider_order' | 'provider_alternative' | 'provider_recovery' | 'awaiting_prior_completion'
    event_id?: string
  }
}

export interface LearningUnitDTO {
  id: string
  title: string
  sub_topic: string
  objective_id: string
  subject: LearningSubject
  languages: Language[]
  components: LearningComponentDTO[]
  source: 'content_provider'
  current_component_id: string | null
  next_component_id: string | null
}

export interface LearningCatalogDTO {
  source: 'content_provider'
  provider_status: 'online'
  units: LearningUnitDTO[]
}

export interface LearningSessionDTO {
  unit: {
    id: string
    title: string
    sub_topic: string
    objective_id: string
    subject: LearningSubject
  }
  component: LearningComponentDTO
  roadmap: LearningUnitDTO
  content_language: Language | null
  requested_language: Language
  language_supported: boolean
  player_url: string
  launch: string
  session_id: string
  timing_url: string
  resume_token: unknown
  source: 'content_provider'
}

export interface QuestionTimingDTO {
  question_id: string | null
  object_id: string | null
  attempts: number
  elapsed_seconds: number | null
  measured_attempts: number
  timing_quality: 'elapsed_between_events' | 'unavailable'
  last_success: boolean | null
}

export interface LearningTimingDTO {
  session_id: string
  unit_id: string | null
  component_id: string | null
  objective_id: string | null
  status: 'completed' | 'started' | 'no_evidence'
  started_at: string | null
  completed_at: string | null
  total_elapsed_seconds: number | null
  total_timing_quality: 'elapsed_between_events' | 'unavailable'
  questions: QuestionTimingDTO[]
  evidence_count: number
  active_time_available: false
}

export function getLearningCatalog(signal?: AbortSignal) {
  return apiGet<LearningCatalogDTO>('/api/learning/catalog', signal ? { signal } : undefined)
}

export function createLearningSession(
  componentId: string,
  unitId: string | null,
  language: Language,
) {
  return apiPost<LearningSessionDTO>('/api/learning/sessions', {
    component_id: componentId,
    unit_id: unitId,
    language,
  })
}

export function getLearningTiming(session: LearningSessionDTO, signal?: AbortSignal) {
  return apiGet<LearningTimingDTO>(session.timing_url, {
    signal,
    headers: { Authorization: `Basic ${session.launch}` },
  })
}
