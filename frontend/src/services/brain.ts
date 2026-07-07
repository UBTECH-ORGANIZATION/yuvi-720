import { apiGet } from './api'

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
  goals: { text: string; deadline?: string }[]
  current: { objective_id: string | null; informationToBot: string | null; recent_events: unknown[] }
  locale: 'he' | 'ar' | 'en'
}

export function getBrain(learnerId: string, signal?: AbortSignal) {
  return apiGet<Brain>(`/api/brain/${encodeURIComponent(learnerId)}`, signal ? { signal } : undefined)
}

/** F4 dashboard DTO projected from the brain (real numbers; UI verbalizes them). */
export interface DashboardSubject {
  name: string
  icon: string
  iconBg: string
  progress: number
  level: string
  levelClass: string
  gradient: string
  description: string
  curriculum: { topic: string; status: string; statusClass: string }[]
}
export interface DashboardDTO {
  name: string
  avatar: string
  subjects: DashboardSubject[]
  difficulties: { subject: string; text: string; status: string; statusClass: string }[]
  goals: { text: string; meta: string; source: string; done: boolean }[]
  mapping: {
    interests: string[]; learningStyle: string; preferences: string[]
    environment: string; strengths: string[]
  }
  competencies: { icon: string; label: string; value: number; descriptor: string }[]
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
