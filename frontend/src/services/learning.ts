import { apiGet, apiPost } from './api'
import type { Language } from '../i18n/I18nProvider'

export type LearningSubject = 'math' | 'science' | 'english' | 'other'
/** `skipped` is an optional stage this learner has outgrown, or one cut short by
 *  a passed assessment (720 §3.3). It is never `locked` — the content is real and
 *  approved, so it stays launchable as an extra. */
export type LearningProgressState = 'completed' | 'current' | 'available' | 'locked' | 'skipped'

/** Why the path put this node where it did. The learner sees a sentence built
 *  from the code and never the evidence behind it (§2 — levels stay internal). */
export type LearningPathReason =
  | 'provider_order'
  | 'xapi_completed'
  | 'xapi_failed'
  | 'equivalent_chosen'
  | 'equivalent_alternative'
  | 'optional_skipped'
  | 'optional_kept'
  | 'recovery_after_fail'
  | 'review_revisit'
  | 'assessment_gated'
  | 'unit_completed_by_assessment'
  | 'awaiting_prior_completion'
  | 'linear_fallback'

export interface LearningComponentDTO {
  id: string
  unit_id: string
  title: string
  purpose: string | null
  is_assessment: boolean
  is_required: boolean
  relative_difficulty: number | null
  order: number | null
  languages: Language[]
  estimated_minutes: number | null
  recommended_after_fail: string[]
  information_to_bot: string | null
  question_ids: string[]
  /** Stable identity that survives a REPEAT visit (`{component_id}#{visit}`).
   *  A repair round puts the same component on the path twice, so `id` is no
   *  longer unique within a unit — keys, lookups and the active comparison all
   *  belong on this. */
  path_node_id: string
  component_id: string
  visit: number
  /** False for an optional stage that was skipped, a non-chosen equivalent, or a
   *  stage cut short by a passed assessment. Off-path nodes are extras: still
   *  openable, never counted, never drawn on the route. */
  on_path: boolean
  /** Position among the on-path nodes, or null off-path. Server-owned — the
   *  client must never derive an ordinal from array position again. */
  path_index: number | null
  stage_index: number | null
  outcome: 'passed' | 'failed' | null
  progress_state: LearningProgressState
  progress_reason: { code: LearningPathReason }
  progress_evidence: {
    kind: 'xapi_completed' | 'brain_current_state' | 'provider_order' | 'provider_alternative' | 'provider_recovery' | 'awaiting_prior_completion'
    event_id?: string
  }
}

export interface LearningUnitDTO {
  id: string
  title: string
  sub_topic: string
  objective_id: string | null
  subject: LearningSubject
  languages: Language[]
  components: LearningComponentDTO[]
  /** Who authored this unit: the ministry's provider, or our own catalog
   *  (English, which we author ourselves). */
  source: 'kata' | 'content_provider' | 'yuvilab'
  current_component_id: string | null
  next_component_id: string | null
  next_path_node_id: string | null
  /** Walked so far / on this learner's path. Both are for the teacher view and
   *  the demo — the learner is shown `progress_ratio` as a bar and never a
   *  denominator, because an adaptive path's total moves. */
  steps_completed: number
  steps_total: number
  progress_ratio: number
  unit_state: 'not_started' | 'in_progress' | 'completed'
  /** False whenever an optional stage, a repair branch or a review could still
   *  change what comes after the current step — which is when the roadmap draws
   *  the trail fading into fog instead of inventing stations it cannot promise. */
  tail_certain: boolean
  path_strategy: 'adaptive' | 'linear_fallback'
  /** The ministry's own names for where this unit sits, from the goal registry
   *  (נושא → תת נושא). The client used to map the dotted key through a
   *  hand-written table that could only cover keys someone had already seen. */
  sub_topic_title?: string
  topic_title?: string
  /** The goal's pedagogical description. Never displayed — it is the vocabulary
   *  the card picks an illustration from, so the picture matches the lesson. */
  goal_description?: string
  /** A sub-topic summary (§3.4): a review resource tied to no learning goal. */
  is_summary?: boolean
  illustration?: LessonIllustrationDTO | null
}

export interface LessonIllustrationDTO {
  assetId: string
  url: string
  staticUrl: string
  alt: string
  tip: string
  width: number
  height: number
  aiGenerated: boolean
  animationPreset: string
}

export interface LearningCatalogDTO {
  source: 'kata' | 'content_provider'
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
  /** False when the provider's player is known not to survive being framed —
   *  the lesson then offers it in its own tab. Absent on older payloads, which
   *  means "frame it", the behaviour every provider had until now. */
  embeddable?: boolean
  launch: string
  session_id: string
  timing_url: string
  resume_token: unknown
  source: 'kata' | 'content_provider'
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

export function getLearningCatalog(signal?: AbortSignal, lang?: Language) {
  // The learner is resolved server-side from the session cookie — never sent
  // by the client. `lang` only localizes the per-unit lesson illustrations.
  const suffix = lang ? `?lang=${encodeURIComponent(lang)}` : ''
  return apiGet<LearningCatalogDTO>(`/api/learning/catalog${suffix}`, signal ? { signal } : undefined)
}

export function createLearningSession(
  componentId: string,
  unitId: string | null,
  language: Language,
  restart = false,
) {
  return apiPost<LearningSessionDTO>('/api/learning/sessions', {
    component_id: componentId,
    unit_id: unitId,
    language,
    restart,
  })
}

/** The learner overruling their route (720 §1 פעלנות).
 *
 *  The provider reports the same intent as a `selected` / `practiceDecision`
 *  when the choice is offered inside the content; this is the platform's own
 *  affordance ("אני רוצה עוד תרגול" in the completion dialog). Both land in the
 *  same evidence, so the next re-plan already knows what they asked for. */
export function reportPathChoice(componentId: string | null, choice: 'more_practice') {
  if (!componentId) return Promise.resolve(null)
  return apiPost<{ ok: boolean }>('/api/learning/path-choice', {
    component_id: componentId,
    choice,
  }).catch(() => null)
}

export function getLearningTiming(session: LearningSessionDTO, signal?: AbortSignal) {
  return apiGet<LearningTimingDTO>(session.timing_url, {
    signal,
    headers: { Authorization: `Basic ${session.launch}` },
  })
}
