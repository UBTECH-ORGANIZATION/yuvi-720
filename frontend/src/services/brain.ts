import { apiGet, apiPost } from './api'

/* Typed client for the Learner Brain (architecture §4.2, backend `app/brain`).
   Reads are brain projections — never invented on the client. Learner surfaces
   render verbal, non-numeric values; the numeric fields here are internal-only
   (routing/analytics) and must not be shown to learners. */

export interface BrainIdentity {
  display_name: string | null
  grade: string | null
  locale: 'he' | 'ar' | 'en'
}

export interface BrainProfile {
  activeness: Record<string, number>
  mapping_scores: unknown | null
  learning_style: string | null
  interests: string[]
  preferences: string[]
  environment: string | null
  source: string | null
  updated_at: string | null
}

export interface StrengthEntry { label: string; evidence_ref?: string; since?: string }
export interface ChallengeEntry {
  objective_id?: string
  label: string
  evidence_ref?: string
  status?: string
}
export interface MasteryEntry {
  level?: string
  achieved?: boolean
  last_score?: number
  attempts?: number
  misconceptions?: string[]
}
export interface ProgressEntry { objectives_total: number; objectives_mastered: number }
export interface GoalEntry {
  id?: string
  text: string
  deadline?: string
  source?: string
  status?: string
  visible_to_learner?: boolean
}
export interface CurrentState {
  unit_id: string | null
  component_id: string | null
  item_id: string | null
  resume_token: unknown | null
  pace: 'on_track' | 'ahead' | 'behind' | null
}

export interface Brain {
  learner_id: string
  identity: BrainIdentity
  profile: BrainProfile
  strengths: StrengthEntry[]
  challenges: ChallengeEntry[]
  mastery: Record<string, MasteryEntry>
  progress: Record<string, ProgressEntry>
  next_recommendations: unknown | null
  goals: GoalEntry[]
  teacher_directives: unknown[]
  reflections_recent: unknown[]
  current_state: CurrentState
  agent_notes: unknown[]
  strategies: unknown[]
  enrollments: string[]
  version: number
  created_at: string
  updated_at: string
}

/** Non-identifying Coach Context bundle — proves the PII boundary (§4.4). */
export interface CoachBundle {
  profile: { interests: string[]; learning_style: string | null; preferences: string[] }
  goals: { text: string; deadline?: string; status?: string }[]
  surface: { screen: import('./agents').CoachScreenId; visible_areas: string[] }
  current: {
    objective_id: string | null
    objective_title: string
    task_status: 'resume_available' | 'no_open_task'
    pace: string
    informationToBot: string | null
    recent_events: unknown[]
  }
  locale: 'he' | 'ar' | 'en'
}

export function getBrain(learnerId: string, signal?: AbortSignal) {
  return apiGet<Brain>(`/api/brain/${encodeURIComponent(learnerId)}`, signal ? { signal } : undefined)
}

/** F4 dashboard DTO projected from the brain (real numbers; UI verbalizes them). */
export interface DashboardSubject {
  key: 'math' | 'science'
  name: string
  icon: string
  iconBg: string
  progress: number
  level: string
  levelClass: string
  gradient: string
  description: string
  curriculum: {
    objectiveId: string
    topic: string
    status: string
    statusClass: 'curr-done' | 'curr-current' | 'curr-upcoming'
  }[]
}

export interface DashboardHero {
  mode: 'resume' | 'next' | 'complete'
  subjectKey: 'math' | 'science' | null
  subjectName: string | null
  objectiveId: string | null
  objectiveTitle: string | null
  componentId: string | null
  canResume: boolean
  reason: string
  pace: string | null
  illustration: {
    assetId: string
    url: string
    staticUrl: string
    alt: string
    tip: string
    width: number
    height: number
    aiGenerated: boolean
    animationPreset: string
  } | null
  stats: {
    timeSpentMinutes: number | null
    overallProgress: number
    completedUnits: number
    timingAvailable: boolean
  }
}

export interface DashboardDTO {
  contractVersion: 2
  brainVersion: number
  hasProfile: boolean
  hasLearningEvidence: boolean
  name: string
  avatar: string
  hero: DashboardHero
  subjects: DashboardSubject[]
  difficulties: { subject: string; text: string; status: string; statusClass: string }[]
  goals: {
    id?: string
    text: string
    meta: string
    source: string
    status?: string
    steps?: { done: number; total: number } | null
    done: boolean
    deadline?: string | null
  }[]
  mapping: {
    interests: string[]; learningStyle: string; preferences: string[]
    environment: string; strengths: string[]
  }
  competencies: {
    key: string
    icon: string
    label: string
    value: number
    descriptor: string
    tone: 'strong' | 'steady' | 'support'
    /** State-aware "how to improve" cause tags from live signals (behavioural,
     * no numbers). Empty when there's no activity evidence yet. */
    improve?: string[]
  }[]
  reflectionPreview: { answer: string; promptId?: string; at?: string } | null
  updatedAt: string | null
}

export function getDashboard(learnerId: string, lang: string, signal?: AbortSignal) {
  return apiGet<DashboardDTO>(
    `/api/brain/${encodeURIComponent(learnerId)}/dashboard?lang=${lang}`,
    signal ? { signal } : undefined
  )
}

export function getCoachBundle(learnerId: string, signal?: AbortSignal) {
  return apiGet<CoachBundle>(
    `/api/brain/${encodeURIComponent(learnerId)}/context/coach`,
    signal ? { signal } : undefined
  )
}

/** Create a learner self-goal derived from an activeness domain (mirrors to F4 goals). */
export function createActivenessGoal(
  learnerId: string,
  payload: { domain: string; text: string },
) {
  return apiPost<{ id: string; text: string; domain: string }>(
    `/api/brain/${encodeURIComponent(learnerId)}/activeness-goal`,
    payload,
  )
}
