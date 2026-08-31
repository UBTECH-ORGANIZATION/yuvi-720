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
  /** The mastery scale (`basic`/`intermediate`/`advanced`), median across the
   *  subject's worked objectives, or `starting` before any attempt. Localized
   *  client-side via `sdash.subjects.level.<key>`. */
  levelKey: 'starting' | 'basic' | 'intermediate' | 'advanced'
  gradient: string
  description: string
  curriculum: {
    objectiveId: string
    topic: string
    status: string
    statusClass: 'curr-done' | 'curr-current' | 'curr-upcoming'
    /** 0…100 against mastery — 100 only once mastery says achieved. Drawn as a
     *  bar and never shown to the learner as a number (§3.4). */
    percent: number
    needsReview: boolean
  }[]
}

export interface DashboardHero {
  /** `pinned` = the teacher chose this exact step (#249); it outranks resume. */
  mode: 'resume' | 'next' | 'complete' | 'pinned'
  /** Which kind of thing the pin points at (#244). A task pin has no catalog
   *  coordinates: the start button must navigate to `/tasks/{launchId}` and
   *  never ask the route agent, which speaks only components. */
  /** 'objective' = a pinned learning GOAL: `componentId` is the planner's
   *  current allocation inside it, so routing works exactly as 'component'. */
  pinnedKind?: 'component' | 'task' | 'objective'
  taskId?: string | null
  launchId?: string | null
  /** The lesson a pin displaced, so "continue where you stopped" stays one
   *  press away while the pin holds the hero. Null in every other mode. */
  resume?: { componentId: string; unitId: string | null; objectiveTitle: string | null } | null
  subjectKey: 'math' | 'science' | null
  subjectName: string | null
  objectiveId: string | null
  objectiveTitle: string | null
  componentId: string | null
  /** The unit the hero's step belongs to — so the lesson can be opened without
   *  guessing it back out of the component id. */
  unitId: string | null
  pathNodeId: string | null
  /** 0…1 through this learner's own path. Rendered as a trail, never a number. */
  progressRatio: number | null
  /** The goal's own words, from the ministry registry — what the hero picks its
   *  interactive scene from, so the visual is about the lesson. */
  subTopicTitle: string
  topicTitle: string
  goalDescription: string
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
    /** Sparks this goal is worth, priced by Yuvi when the goal was set. */
    rewardValue?: number | null
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
    /** Where this domain stood about a week ago, from the same engine that
     * produces `drivers`. The web prefers this over its own stored snapshot so
     * an arrow always has a reason behind it. */
    priorValue?: number | null
    /** What actually moved this domain, strongest first, each with the direction
     * it pushed. Unlike `improve` this includes what went well, so a domain that
     * rose has a real behaviour to name. `lesson` is present only where the
     * signal is lesson-shaped. */
    drivers?: {
        tag: string
        dir: 'up' | 'down'
        lesson?: string
        /** This week's counts behind the cause, each paired with `<field>_prior`
         *  from a week earlier. Lets the card pick wording that matches what
         *  actually happened rather than one sentence per cause. */
        facts?: Record<string, number>
    }[]
    /** True only when there's enough real activity to explain *why* this domain
     * sits where it does. The activeness map gates its change arrow on this, so
     * it never shows a movement it can't ground in evidence. */
    evidenceBacked?: boolean
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

/** Learner updates a goal's progress from the "My goals" card (reports MoE
 *  student-goal updated/completed). */
export function updateGoalStatus(
  learnerId: string,
  goalId: string,
  status: 'in_progress' | 'done',
) {
  return apiPost<GoalEntry>(
    `/api/brain/${encodeURIComponent(learnerId)}/goals/${encodeURIComponent(goalId)}/status`,
    { status },
  )
}
