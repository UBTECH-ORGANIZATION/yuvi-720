/* Teacher view + org clients (F6/F8). Every insight/flag carries raw evidence;
   access is group-scoped server-side. */

import { apiDelete, apiGet, apiPatch, apiPost } from './api'
import type { AvatarChoice } from '../features/badges/types'

export interface AttentionFlag {
  reason: string
  evidence: string
  kind?: string
  /** The raw datum that produced the flag — F6 requires it be showable. */
  raw_evidence?: Record<string, unknown>
}

/** One of the five pedagogical categories the MoE spec names. */
export type RecommendationCategory =
  | 'reinforce' | 'extra_practice' | 'deepen' | 'enrich' | 'refer_intervention'

export interface TeacherRecommendation {
  category: RecommendationCategory
  category_label: string
  text: string
  because: { signal: string; value: unknown; raw: Record<string, unknown> }
}
/** The thin projection the student-detail payload carries — the open flags, for
 *  the "needs attention" strip. The full record, with its state and its
 *  history, is `WellbeingFlag` below and comes from its own endpoint. */
export interface WellbeingSnippet { evidence: string; at?: string; source?: string }
export interface CheckinDay {
  date: string
  valence: string | null
  feeling: string | null
  skipped: boolean
}

export interface StudentInsight {
  learner_id: string
  display_name: string | null
  /** Today's check-in feeling (#452) — null once the school day turns. */
  today_feeling?: CheckinDay | null
  /** The last 14 check-in days, newest first. */
  checkin_history?: CheckinDay[]
  checkin_skip_streak?: number
  progress: Record<string, { objectives_total: number; objectives_mastered: number }>
  next: Record<string, string[]>
  struggle_items: StruggleItem[]
  strengths: string[]
  attention: AttentionFlag | null
  wellbeing_flags: WellbeingSnippet[]
  /**
   * Pedagogical recommendations, tagged with one of the five MoE categories
   * (reinforce · extra_practice · deepen · enrich · refer_intervention). Each
   * carries `because` — the signal and raw datum that produced it, so the UI
   * can always show a teacher why they are being told this.
   */
  recommendations: TeacherRecommendation[]
  timeline: { verb?: string; objective_id?: string; success?: boolean | null; at?: string }[]
  reflections_recent: unknown[]
}
/** How the roster is allowed to describe a learner. Derived server-side from
 *  the same evidence that raises attention flags — `not_started` means no
 *  learning event has ever been recorded, which is NOT the same as "fine". */
export type StudentStatus = 'attention' | 'not_started' | 'active'

export interface StudentActivity {
  started: boolean
  last_event_at: string | null
  days_inactive: number | null
}

/** The deterministic dashboard band (#450): red/orange/green with its whys.
 *  `changed_at`/`previous` power the "new" chip — null until a real
 *  transition, so a first sighting is never marked as movement. */
export interface StudentBand {
  band: 'red' | 'orange' | 'green'
  reasons: { signal: string; evidence: Record<string, unknown> }[]
  changed_at?: string | null
  previous?: string | null
}

export interface GroupInsight {
  group: { id: string; name: string; subject?: string } | null
  students: {
    learner_id: string; display_name: string | null; attention: AttentionFlag | null
    progress: unknown; status: StudentStatus; activity: StudentActivity
    band: StudentBand
    today_feeling: { valence: string; feeling: string; date: string } | null
  }[]
  trends: {
    students_total: number; active_last_7d: number; needing_attention: number
    needing_attention_red: number
    not_started: number; objectives_mastered_total: number
  }
  attention: (AttentionFlag & { learner_id: string; display_name: string | null })[]
}
export interface Group {
  id: string; name: string; subject?: string; grade?: string; teacher_id?: string
}

/* ── Phase 2 engine DTOs ──────────────────────────────────────────────────── */

/** Progress against the objectives a subject actually has, not only those seen. */
export interface SubjectProgress {
  objectives_total: number
  objectives_mastered: number
  objectives_in_progress: number
  objectives_needs_review: number
  not_started: number
  percent: number
}

export interface StruggleItem {
  label?: string
  objective_id?: string
  subject?: string | null
  /** `evidence` — the child answered questions and got them wrong.
   *  `questionnaire` — a trait they described about themselves at onboarding.
   *  Tagged server-side (`insights.py`) by whether an objective is behind it.
   *  Both are real signal; only the first is a difficulty the system detected. */
  source?: 'evidence' | 'questionnaire'
  evidence?: { tag?: string; count?: number; resolved?: boolean }[] | null
  raw_evidence?: {
    attempts?: number; successes?: number; failures?: number
    score_ewma?: number; level?: string; needs_review?: boolean
  }
}

export interface StrengthDetail {
  kind: 'success_area' | 'consistent_improvement' | 'profile_strength'
  label?: string | null
  objective_id?: string
  subject?: string
  source?: string
  evidence?: Record<string, unknown>
}

/** The four labeled blocks `student_description` is built from (brain A-5). */
export type PortraitBlock =
  'how_to_reach' | 'what_frustrates' | 'learning_preferences' | 'motivational_patterns'

/** How the system sees this learner, in sentences it has already written.
 *
 *  Not generated for the teacher: `student_description` is maintained lazily
 *  off the learner's own coach bundle, so this is a read of existing state and
 *  costs no model call on this screen. `null` when nothing has been observed. */
export interface StudentPortrait {
  blocks: { key: PortraitBlock; lines: string[] }[]
  /** Distinct evidence keys behind the sentences — provenance, not a score. */
  evidence_count: number
  updated_at: string | null
}

/** Where the planner is pointing this child right now — the same `next_focus`
 *  the platform itself follows, so the teacher's card and the child's app can
 *  never disagree about what comes next. */
export interface PlannerFocus {
  subject: string | null
  objective_id: string | null
  /** Localized objective title, or null where the catalogue is silent. */
  objective_title: string | null
  mode: 'review' | 'new' | 'complete'
}

/** Full student view. Extends the legacy shape rather than replacing it. */
export interface StudentDetail extends StudentInsight {
  objectives_progress: Record<string, SubjectProgress>
  subject_filter: string | null
  portrait: StudentPortrait | null
  strengths_detail: StrengthDetail[]
  /** Every criterion that fired, not just the highest-priority one. */
  attention_all: AttentionFlag[]
  self_awareness: { reading: string; gap: number; samples: AwarenessSample[] } | null
  /** Optional so a not-yet-redeployed backend degrades to no focus card. */
  focus?: PlannerFocus | null
}

/** The group-level shape of one window. Shared by the current window and the
 *  one before it, so a delta compares like with like. */
export interface EngagementWindow {
  students_total: number
  active_students: number
  active_pct: number
  /** null when no trustworthy timing evidence exists — never a fake zero. */
  avg_active_minutes: number | null
  timing_available: boolean
  avg_days_active: number
}

export interface Engagement extends EngagementWindow {
  group_id: string
  window_days: number
  /** `partial` marks today — a bucket the window only half covers, because it
   *  is still being lived through. Real data, but not part of a SHAPE: a series
   *  ending on a half-finished day always dips at the right. */
  per_day_active: { date: string; active: number; partial?: boolean }[]
  /** Minutes per learner who studied that day — the headline average, one day
   *  at a time. All zeros when no usable timing evidence exists. */
  per_day_minutes?: { date: string; minutes: number; partial?: boolean }[]
  /** The same window length immediately before this one — the baseline the
   *  dashboard's up/down arrows are measured against. Absent when the caller
   *  did not ask for a comparison. */
  previous?: EngagementWindow
}

export interface LearningGap {
  objective_id: string
  subject: string
  label: string
  struggling_count: number
  mastered_count: number
  with_evidence: number
  group_size: number
  struggle_share: number
  mastery_share: number
  kind: 'gap' | 'strength'
  /** The struggling sub-group — the one a gap row is about. Never render this
   *  as a ranking; it is a set of people, in roster order and unscored. */
  learner_ids: string[]
  /** The mastered sub-group — the one a strength row is about, and the other
   *  half of a "split the class" move. Same rule. */
  mastered_ids: string[]
  evidence: { sample_misconceptions: [string, number][]; threshold: number }
}

export interface GroupRecommendation {
  action: 'revisit' | 'change_pace' | 'adapt_method' | 'split_groups' | 'extend'
  text: string
  objective_id: string
  subject: string
  label: string
  because: { signal: string; value: unknown; raw: Record<string, unknown> }
}

export interface QuestionRow {
  question_key: string
  component_id?: string
  item_id?: string
  question_id?: string
  objective_id?: string
  subject?: string
  attempts: number
  correct: number
  time_seconds: number
  hints_used: number
  content_hints_used: number
  explanations_used: number
  different_way_used: number
  chat_turns: number
  helped_reported: string[]
  first_at?: string
  last_at?: string

  /* ── what this row IS, resolved from the catalogue server-side ───────────
     Attached by `learning_analytics.label_learner_rows`. All authored content,
     none of it inferred: where the catalogue is silent the field is null and
     the client says so rather than printing the provider id. */

  /** The lesson this belongs to. Empty when the vendor never titled it. */
  learning_title?: string
  unit_title?: string | null
  objective_title?: string | null
  /** The question number the LEARNER sees on screen — not the provider's id.
   *  `q1` appears once per screen, so the raw id names three different
   *  questions in one lesson. */
  ordinal?: number | string | null
  /** 1-based סעיף, only where a screen really holds several parts. */
  part?: number | null
  /** The screen's own heading. */
  screen_title?: string | null
  kind?: string | null
  /** The content's own description of what this item is for
   *  (`informationToBot`) — the most direct answer to "what were they working
   *  on", written by whoever wrote the lesson. */
  teaches?: string | null
}

export type InsightKind = 'strength' | 'weakness' | 'challenge' | 'note'
/** `coach` additionally steers what Yuvi says to the child — never the default. */
export type InsightVisibility = 'private' | 'shared' | 'coach'

export interface TeacherInsight {
  _id: string
  learner_id: string
  teacher_id: string
  kind: InsightKind
  text: string
  subject?: string | null
  visibility: InsightVisibility
  created_at: string
}

/* ── roster ───────────────────────────────────────────────────────────────── */

export interface RosterEntry {
  learner_id: string
  /** Null for a learner who never finished mapping — render the id, not a guess. */
  display_name: string | null
  /** The learner's own avatar choice, or null when they have not made one.
   *  Same shape as `learner_state.avatar`; `StudentAvatar` resolves it. */
  avatar?: AvatarChoice | null
  group_id: string
}

/** Names for every learner this teacher teaches, across every class.
 *
 * Deliberately not per-group: the assistant is scoped to the union of a
 * teacher's groups, so a per-group map turned a named student back into a raw
 * id whenever the class picker moved. */
export function getTeacherRoster() {
  return apiGet<{ students: RosterEntry[]; groups: { id: string; name: string }[] }>(
    '/api/teacher/roster'
  )
}

/* ── group ────────────────────────────────────────────────────────────────── */

/* Class-wide, and deliberately not narrowable by subject: `group_insights`
   never had a subject parameter, so the one this function used to send was
   accepted by the route and dropped. Attention, status and trends would each
   need their own per-subject meaning before this could honestly take one. */
/* `days` is the dashboard's period. It is not a filter on this endpoint — it
   re-judges every band, because how long a child has been quiet only means
   something relative to the stretch being read. */
export function getGroupSnapshot(groupId: string, language: string, days?: number) {
  const params = new URLSearchParams({ language })
  if (days) params.set('days', String(days))
  return apiGet<GroupInsight>(`/api/teacher/groups/${groupId}/snapshot?${params}`)
}

/* The subjects this class can be narrowed to — per class, from what it has
   material or history in, so the scope bar never offers one that empties a
   screen. */
export function getGroupSubjects(groupId: string, language: string) {
  return apiGet<{ subjects: string[] }>(
    `/api/teacher/groups/${groupId}/subjects?${new URLSearchParams({ language })}`)
}

export function getGroupEngagement(groupId: string, days = 7, subject?: string | null) {
  const params = new URLSearchParams({ days: String(days) })
  if (subject) params.set('subject', subject)
  return apiGet<Engagement>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/engagement?${params}`)
}

/** The five valence families the daily check-in offers, ordered from best to
 *  hardest. Mirrored from `checkin_flow.VALENCE_FEELINGS` — the server owns
 *  the vocabulary; this copy exists so the bar can render in a fixed order
 *  rather than in whatever order a JSON object arrives in. */
export const VALENCES = ['great', 'good', 'okay', 'uneasy', 'upset'] as const
export type Valence = typeof VALENCES[number]

export interface MoodWindow {
  students_total: number
  /** Distinct children who answered — NOT the number of answers. */
  answered_students: number
  answers: number
  skipped: number
  by_valence: Record<Valence, number>
  /** Share of ANSWERS that read positive, never a share of the class. */
  positive_pct: number
  /** False below the evidence gate: show the shape, do not lead with a share. */
  enough: boolean
}

export interface ClassMood extends MoodWindow {
  window_days: number
  previous?: MoodWindow
}

/* How the class has been feeling. Aggregate only — no learner id is returned,
   deliberately: the class view never names who is having a bad week (C5). */
export function getGroupMood(groupId: string, days: number) {
  return apiGet<ClassMood>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/mood?days=${days}`)
}

/* With `days`, the gaps narrow to what the class actually worked on in that
   trailing window, and `previous_gaps` carries the window before it — which is
   what lets the dashboard say not just what the class is stuck on, but whether
   that changed. */
export function getGroupGaps(
  groupId: string, language: string, subject?: string, days?: number,
) {
  const params = new URLSearchParams({ language })
  if (subject) params.set('subject', subject)
  if (days) params.set('days', String(days))
  return apiGet<{
    gaps: LearningGap[]
    previous_gaps?: LearningGap[]
    window_days?: number | null
    recommendations: GroupRecommendation[]
  }>(`/api/teacher/groups/${groupId}/gaps?${params}`)
}

/* ── student ──────────────────────────────────────────────────────────────── */

export function getStudentDetail(learnerId: string, language: string, subject?: string) {
  const params = new URLSearchParams({ language })
  if (subject) params.set('subject', subject)
  return apiGet<StudentDetail>(`/api/teacher/students/${learnerId}?${params}`)
}

export function getStudentActivity(learnerId: string, subject?: string) {
  const params = new URLSearchParams()
  if (subject) params.set('subject', subject)
  return apiGet<{ questions: QuestionRow[] }>(
    `/api/teacher/students/${learnerId}/activity?${params}`
  )
}

export function getStudentBadges(learnerId: string, lang: string) {
  return apiGet<{ badges: TeacherBadge[] }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/badges?lang=${lang}`
  )
}

/* ── topic digest: the hardest-topics card, in readable sentences ─────────── */

/** One topic's digest. `key` matches the topic key the profile computes
 *  client-side (`obj:…` / `unit:…` / `lesson:…`), which is how the two join. */
export interface TopicDigestItem {
  key: string
  /** 2–3 short sentences, restating only the authored `teaches` texts and the
   *  counters — the server enforces that nothing here is invented. */
  sentences: string[]
  /** Which of the topic's own numbers are worth surfacing beside the words. */
  surface: ('rate' | 'attempts' | 'questions' | 'zero_correct')[]
}

export interface TopicDigest {
  topics: TopicDigestItem[]
  cached: boolean
  generated_at: string | null
  /** True when the child's progress moved since this was written. */
  stale: boolean
  has_evidence: boolean
  unavailable?: boolean
}

/** Cached-only read — never triggers a model call. */
export function getTopicDigest(learnerId: string, language: string, subject?: string) {
  const params = new URLSearchParams({ language })
  if (subject) params.set('subject', subject)
  return apiGet<TopicDigest>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/topics/digest?${params}`
  )
}

/** May generate (one mini-model call), then caches until progress changes. */
export function generateTopicDigest(learnerId: string, language: string, subject?: string) {
  return apiPost<TopicDigest>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/topics/digest`,
    { language, subject: subject ?? null }
  )
}

/** One stop on the planner's predicted road — what it will serve after each
 *  completion, computed by the same ranking the live focus uses. */
export interface RoadmapStep {
  subject: string | null
  objective_id: string | null
  objective_title: string | null
  /** The sub-material (unit) the objective lives in — shown under the title,
   *  and what tells two same-named objectives apart. */
  unit_title?: string | null
  mode: 'review' | 'new' | 'complete'
}

export function getFocusRoadmap(learnerId: string, language: string) {
  const params = new URLSearchParams({ language })
  return apiGet<{ steps: RoadmapStep[] }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/focus/roadmap?${params}`
  )
}

/** One catalogue objective with where this child stands on it — the list
 *  behind a status dial's "1 of 3". */
export interface ObjectiveBreakdownRow {
  objective_id: string
  title: string | null
  order: number | null
  status: 'mastered' | 'in_progress' | 'not_started'
  needs_review: boolean
  attempts: number
  successes: number
  /** 100 when mastery marked it achieved; otherwise the mastery score. */
  percent: number
  /** What the child actually did there — from the per-question rows. */
  questions: number
  minutes: number
  help_used: number
  last_at: string | null
}

export function getStudentObjectives(learnerId: string, subject: string, language: string) {
  const params = new URLSearchParams({ subject, language })
  return apiGet<{ subject: string; objectives: ObjectiveBreakdownRow[] }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/objectives?${params}`
  )
}

export interface AwarenessSample {
  /** The learner's own 1–5 answer. */
  self_rating: number
  /** The server's 0–1 success rate for the same session. */
  system_estimate: number
  at?: string | null
}

/* ── trends: the series behind the profile's charts ───────────────────────── */

export interface TrendDay {
  date: string
  attempts: number
  correct: number
  minutes: number
  /** Null on a day with no attempts — never a zero, which would draw a crash. */
  success_rate: number | null
}

export interface SubjectTrend {
  subject: string
  attempts: number
  success_rate: number | null
  series: { date: string; attempts: number; success_rate: number | null }[]
}

export interface LearnerTrends {
  learner_id: string
  days: number
  from: string
  to: string
  per_day: TrendDay[]
  per_subject: SubjectTrend[]
  active_days: number
  streak: number
  totals: {
    attempts: number; correct: number; minutes: number; success_rate: number | null
  }
  mastered_steps: { at: string; objective_id: string; level: string }[]
}

export function getStudentTrends(learnerId: string, days = 30) {
  return apiGet<LearnerTrends>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/trends?days=${days}`)
}

/* ── habit scores: independence & concentration (PBI 451) ─────────────────── */

export interface ScoreTrend {
  direction: 'up' | 'down' | 'flat' | null
  deltaPoints: number | null
}

export interface SubScore {
  key: string
  /** 0..1 — shown in the UI: the weighted mean is visible, never a black box. */
  weight: number
  /** 0..100, or null when this signal is not measured (yet). */
  value: number | null
  /** Raw numbers behind the value — a claim never travels without its datum. */
  evidence: Record<string, unknown>
}

export interface ScoreBlock {
  /** 0..100, or null below the evidence threshold — never a thin guess. */
  value: number | null
  confidence: number
  evidenceOk: boolean
  trend: ScoreTrend
  subscores: SubScore[]
  /** Signals that could not be measured; the weights renormalize over the rest. */
  coverage: { missing: string[]; renormalized: boolean }
}

export interface ConcentrationScore extends ScoreBlock {
  /** The normaliser the five signals are read against — never a weighted tile. */
  sessionShape: { connectedMinutes: number | null; questionsAnswered: number }
}

export interface StudentScores {
  independence: ScoreBlock
  concentration: ConcentrationScore
  windowDays: number
  windowTruncated: boolean
}

export function getStudentScores(learnerId: string) {
  return apiGet<StudentScores>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/scores`)
}

/* ── teacher-authored insights (MUST S3) ──────────────────────────────────── */

export function listTeacherInsights(learnerId: string) {
  return apiGet<{ insights: TeacherInsight[] }>(`/api/teacher/students/${learnerId}/insights`)
}

export function createTeacherInsight(
  learnerId: string,
  body: { kind: InsightKind; text: string; subject?: string; visibility: InsightVisibility }
) {
  return apiPost<TeacherInsight>(`/api/teacher/students/${learnerId}/insights`, body)
}

export function deleteTeacherInsight(learnerId: string, insightId: string) {
  return apiDelete(`/api/teacher/students/${learnerId}/insights/${insightId}`)
}

export function getGroupInsights(groupId: string, language: string) {
  return apiPost<GroupInsight>('/api/agent/insights', { group_id: groupId, language })
}
export function getStudentInsights(learnerId: string, language: string) {
  return apiPost<StudentInsight>('/api/agent/insights', { learner_id: learnerId, language })
}
export function listGroups() {
  return apiGet<{ groups: Group[] }>('/api/groups')
}
export function saveDirective(
  learnerId: string,
  text: string,
  opts: { scope?: string; priority?: string; visible_to_learner?: boolean } = {}
) {
  return apiPost('/api/teacher/directive', { learner_id: learnerId, text, ...opts })
}

/* ── Phase 4: the live lane ───────────────────────────────────────────────── */

export type PresenceStatus = 'offline' | 'online' | 'in_lesson'

export interface Presence {
  learner_id: string
  status: PresenceStatus
  connections: number
  component_id: string | null
  unit_id: string | null
  objective_id: string | null
  /** Catalog labels for the ids above, resolved server-side at event time —
   *  what the tile shows instead of a bare "in a lesson". */
  subject?: string | null
  unit_title?: string | null
  objective_title?: string | null
  session_id: string | null
  /** Always render this next to the dot. A bare green dot claims more than we
   *  know — a dropped socket is not a child leaving. */
  last_seen_at: string | null
  lesson_entered_at: string | null
  struggling: { kind: string; since: string; evidence: Record<string, unknown> } | null
  help_requested_at: string | null
  /** Where the learner's own client says it is. Advisory: it never drives
   *  `status`, so a claim of the lesson screen cannot fake lesson state. */
  surface: 'lesson' | 'studio' | 'browsing' | 'unknown' | null
  /** The exact screen behind `surface`, when the client named one the server
   *  recognises — what lets the live view say which browsing screen. */
  surface_screen: string | null
  /** The catalog's name for the learning the client reports being on (lesson
   *  screen only) — resolved server-side, never client text. */
  surface_title: string | null
  /** That learning's subject KEY (e.g. "math"), same lifecycle as the title. */
  surface_subject: string | null
  /** When they ARRIVED at `surface` — stamped on change only, so "how long
   *  in the studio" reads from it directly. */
  surface_at: string | null
  /** Last chat turn with Yuvi. "In a chat" is derived from its recency, never
   *  reported, so it decays on its own. */
  chat_at: string | null
}

export type AlertKind =
  | 'help_requested' | 'safety_flag' | 'struggling' | 'inactive'
  | 'low_success_streak' | 'goal_submitted' | 'goal_help_requested' | 'coach_handoff'

export type AlertSeverity = 'info' | 'attention' | 'urgent'

export interface TeacherAlert {
  _id: string
  seq: number
  teacher_id: string
  learner_id: string
  group_id: string | null
  kind: AlertKind
  severity: AlertSeverity
  /** A key plus params, never rendered text — the teacher may switch language. */
  title_key: string
  params: Record<string, unknown>
  /** Mandatory server-side: an alert a teacher cannot interrogate is worse than
   *  no alert at all. */
  evidence: { label_key: string; value: unknown; raw: Record<string, unknown> }
  status: 'open' | 'acknowledged' | 'resolved'
  occurrences: number
  acknowledged_by: string | null
  created_at: string
  updated_at: string
}

export interface LiveSnapshot {
  type: 'snapshot'
  group_id: string | null
  alerts: TeacherAlert[]
  presence: Presence[]
  /** Replay cursor: hand this back as `?since=` on reconnect. */
  cursor: number
}

export function getLive(groupId?: string) {
  const query = groupId ? `?group_id=${encodeURIComponent(groupId)}` : ''
  return apiGet<LiveSnapshot>(`/api/teacher/live${query}`)
}

export function acknowledgeAlert(alertId: string) {
  return apiPost<TeacherAlert>(`/api/teacher/alerts/${encodeURIComponent(alertId)}/ack`, {})
}

export function resolveAlert(alertId: string) {
  return apiPost<TeacherAlert>(`/api/teacher/alerts/${encodeURIComponent(alertId)}/resolve`, {})
}

/* ── Phase 5: goals ───────────────────────────────────────────────────────── */

/** The observable platform action a Yuvi-suggested goal asks for. */
export interface GoalAction {
  kind: 'use_hint' | 'ask_yuvi' | 'retry_after_wrong' | 'practice' | 'complete_task' | 'active_days'
  target: number
}

/** What actually happened: the count the backend measured for a GoalAction. */
export interface GoalProgress extends GoalAction {
  count: number
  met: boolean
}

export interface GoalDraft {
  title: string
  next_steps: string
  rationale: string
  deadline: string
  ai: boolean
  /** Never optional: a teacher acting on a suggestion must see what produced it. */
  because: { signal: string; value: unknown; raw: Record<string, unknown> }
  /** Set when there is no evidence to ground a suggestion on. */
  unavailable?: boolean
  /** Countable platform action — carried onto the goal when assigned. */
  action?: GoalAction | null
}

export interface StudentGoal {
  id: string
  title: string
  next_steps: string
  deadline: string
  progress_stage: string
  status: string
  reward_value: number | null
  approved_by: string | null
  approved_at: string | null
  teacher_note?: string
  from_yuvi?: boolean
  needs_help?: boolean
  action?: GoalAction | null
  /** Present only on goals with an action: what the system counted. */
  progress?: GoalProgress | null
}

/** A documented conversation and the goals that came out of it.
 *
 *  `list_conversations` has always returned the whole record; only the goals
 *  were ever declared here, because only the goals were ever rendered. The
 *  conversation history reads the rest of what was already on the wire. */
export interface GoalConversation {
  id: string
  author?: string
  date?: string
  goals: StudentGoal[]
  /** What was discussed. Present on records written through the composer. */
  notes?: string
  meeting_stage?: string
  /** Withheld from the learner — `list_conversations` strips it for them. */
  teacher_only_note?: string
  teacher_name?: string
  /** Which teacher documented it. Absent on records written before it was stored. */
  teacher_id?: string | null
  visibility?: 'shared' | 'teacher_only'
}

export interface ApprovalResult {
  already_approved: boolean
  granted: number
  /** The learner had already banked these sparks by summarizing it themselves. */
  already_earned?: boolean
  /** The daily cap paid nothing. Different from "worth nothing". */
  capped: boolean
  goal: { id: string; title?: string }
}

export function getStudentGoals(learnerId: string) {
  return apiGet<{ conversations: GoalConversation[] }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/goals`
  )
}

/** Suggestions and what is true about them.
 *
 *  They are generated once and kept: `cached` says these were not paid for
 *  again, and `stale` says the observations behind them have moved since — the
 *  only condition under which asking for new ones is offered.
 */
export interface GoalSuggestions {
  goals: GoalDraft[]
  cached: boolean
  generated_at: string | null
  stale: boolean
  has_evidence: boolean
}

/** What is already stored. Never generates, so a tab opening costs nothing. */
export function getGoalSuggestions(learnerId: string, language: string, subject?: string) {
  const query = new URLSearchParams({ language })
  if (subject) query.set('subject', subject)
  return apiGet<GoalSuggestions>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/goals/suggest?${query}`
  )
}

export function suggestStudentGoals(learnerId: string, language: string, subject?: string) {
  return apiPost<GoalSuggestions>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/goals/suggest`,
    { language, subject }
  )
}

export function assignStudentGoal(
  learnerId: string,
  goal: { title: string; next_steps?: string; deadline?: string; action?: GoalAction | null },
  language: string
) {
  return apiPost<GoalConversation>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/goals`, { goal, language }
  )
}

export function approveStudentGoal(
  learnerId: string, goalId: string, conversationId: string, teacherNote = ''
) {
  return apiPost<ApprovalResult>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/goals/${encodeURIComponent(goalId)}/approve`,
    { conversation_id: conversationId, teacher_note: teacherNote }
  )
}

export function assignGroupGoal(
  groupId: string, learnerIds: string[],
  goal: { title: string; next_steps?: string; deadline?: string }, language: string
) {
  return apiPost<{ assigned: string[]; skipped: { learner_id: string; reason: string }[] }>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/goals/assign`,
    { learner_ids: learnerIds, goal, language }
  )
}

/* ── Phase 7: moments, kudos, digest, badges, meeting prep ─────────────────── */

/** One narrated change. Displayed chronologically, never as a ranking of
 *  students (MoE C5) — `weight` only decides which moments make the cut. */
export interface Moment {
  kind:
    | 'recovery' | 'sustained_effort' | 'first_mastery' | 'comeback'
    | 'misconception_resolved' | 'breakthrough' | 'wellbeing_shared' | 'goal_done'
  at: string
  learner_id?: string
  objective_id: string | null
  label: string
  text_key: string
  params: Record<string, unknown>
  evidence: { raw: Record<string, unknown> }
  /** 0–100, how much a teacher would want to be told this. */
  weight: number
  /** Rendered as a headline row rather than a list line. */
  headline: boolean
}

/* `offsetDays` slides the window back without changing its length — how the
   class book asks for the edition BEFORE the one the dashboard is reading. */
export function getGroupMoments(
  groupId: string, language: string, days = 14, offsetDays = 0,
  subject?: string | null,
) {
  const params = new URLSearchParams({ language, days: String(days) })
  if (offsetDays) params.set('offset_days', String(offsetDays))
  if (subject) params.set('subject', subject)
  return apiGet<{ moments: Moment[] }>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/moments?${params}`
  )
}

/** What a teacher may attach to a good word (#467). The server owns this set
 *  too — this copy exists so the composer can render the buttons. */
export const KUDOS_SPARK_AMOUNTS = [10, 20, 40] as const

export function sendKudos(
  learnerId: string, message: string, language: string,
  moment?: Record<string, unknown>,
  opts?: {
    sparks?: number
    /** Stable per composer, NOT per attempt: a double-clicked send writes two
     *  kudos rows, and this is what stops the second one paying again. */
    draftId?: string
  },
) {
  return apiPost<{ kudos_id: string; message: string; sparks: number }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/kudos`,
    {
      message, language, moment: moment ?? null,
      sparks: opts?.sparks ?? 0,
      draft_id: opts?.draftId ?? null,
    }
  )
}

export interface KudosRecord {
  id: string
  message: string
  created_at: string | null
  delivered_at: string | null
}

/** The teacher's own praise record for one learner (messages screen). */
export function getStudentKudos(learnerId: string) {
  return apiGet<{ kudos: KudosRecord[] }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/kudos`
  )
}

export interface DigestBullet {
  /** Either free text from the model, or a locale key when computed. */
  text?: string
  text_key?: string
  params?: Record<string, unknown>
  because: { signal: string; value: unknown; raw: Record<string, unknown> }
}

export interface Digest {
  week: string
  bullets: DigestBullet[]
  generated_at: string | null
  source: 'ai' | 'fallback' | 'cache' | 'empty'
  cached: boolean
  reason?: string
}

export function getGroupDigest(groupId: string, language: string, refresh = false) {
  return apiGet<Digest>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/digest?language=${language}&refresh=${refresh}`
  )
}

export interface TeacherBadge {
  subject: string
  glyph: string
  tier: string
  state: 'earned' | 'inprogress' | 'locked'
  progress: number
  title: string
  meta: string
  certifies: string[]
  earned: boolean
  category: string
  howToEarn?: string
}


/* ── learnings analytics ──────────────────────────────────────────────────── */

export interface HardQuestion {
  question_id: string
  item_id?: string | null
  /** The question number the learner sees on screen, when the catalog knows it. */
  ordinal: number | null
  /** 1-based סעיף when several questions share one screen. */
  part?: number | null
  /** The content's own heading for the screen this question sits on. */
  screen_title?: string
  kind?: string
  /** Generated 2–4 word topic (#455) — null means "looked at, could not be
   *  named honestly"; the label falls back on the screen title, never a bare
   *  number. Absent on payloads that never carry topics. */
  topic?: string | null
  /** The authored question text, teacher clients only — the tooltip body. */
  question_text?: string | null
  attempts: number
  correct: number
  success_rate: number | null
  avg_seconds: number | null
  learners: number
  hints_used?: number
  chat_turns?: number
}

/** A hard question opened up with WHO (#455): learners who attempted it and
 *  never answered it correctly. Roster order, unscored and unnumbered — a
 *  selection, never a ranking (the learning_gaps.learner_ids shape). */
export interface DifficultyRow extends HardQuestion {
  learner_ids: string[]
  evidence: Record<string, unknown>
}

/** One Kata component, aggregated across the whole group. Counts only — the
 *  payload never carries a learner id (MoE C5). Rows exist for material nobody
 *  has opened yet, flagged with `started: false`. */
export interface LearningRow {
  component_id: string
  title: string
  unit_id: string | null
  unit_title: string | null
  objective_id: string | null
  objective_title: string | null
  subject: string | null
  estimated_minutes: number | null
  is_assessment: boolean
  order: number | null
  screens_total: number
  questions_total: number
  learners_engaged: number
  group_size: number
  attempts: number
  correct: number
  success_rate: number | null
  total_minutes: number | null
  avg_minutes_per_learner: number | null
  timing_available: boolean
  hints_used: number
  explanations_used: number
  chat_turns: number
  struggling_count: number
  last_activity_at: string | null
  hard_questions: HardQuestion[]
  /** False when no learner in the class has touched this learning. */
  started: boolean
  evidence: Record<string, unknown>
}

export interface LearningsView {
  group_id: string
  subject: string | null
  /** Every subject the catalogue publishes — the filter's own source. */
  subjects: string[]
  learnings: LearningRow[]
  totals: {
    learnings: number
    catalog_total: number
    attempts: number
    correct: number
    success_rate: number | null
    total_minutes: number | null
    timing_available: boolean
    active_learners: number
    group_size: number
  }
  recommendations: GroupRecommendation[]
}

export interface LearningDetail {
  group_id: string
  learning: LearningRow
  questions: HardQuestion[]
  difficulties: DifficultyRow[]
  /** True when some question has no stored topic decision yet — the page
   *  fires one `generateQuestionTopics` and patches the rows from its map. */
  topics_pending: boolean
}

export function getGroupLearnings(groupId: string, language: string, subject?: string) {
  const params = new URLSearchParams({ language })
  if (subject) params.set('subject', subject)
  return apiGet<LearningsView>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/learnings?${params}`
  )
}

/** One smart-search hit: a REAL catalog learning (the server drops anything
 *  the model made up) plus the model's one-line reason it fits the ask. */
export interface FoundLearning {
  /** A learning GOAL — pinning it lets the planner allocate the fitting
   *  lomda inside it as the child progresses. */
  objective_id: string
  title: string
  /** Where the goal lives — the search is catalog-wide, every subject. */
  subject: string | null
  reason: string
}

/** The pin dialog's smart search. `similar_topic` is only ever set when
 *  `options` is empty — a navigation hint ("I do have something about X"),
 *  never a fourth result. */
export function findLearnings(
  groupId: string,
  body: { query: string; subject?: string; language?: string },
) {
  return apiPost<{ options: FoundLearning[]; similar_topic: string | null }>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/learnings/find`, body
  )
}

export function getLearningDetail(groupId: string, componentId: string, language: string) {
  return apiGet<LearningDetail>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/learnings/${
      encodeURIComponent(componentId)}?language=${language}`
  )
}

/** Generate-and-store topic names for this lomda's questions (#455). The GET
 *  above never generates; this is fired once when `topics_pending` arrives
 *  true, and the rows are patched from the returned map (`item|question`-keyed
 *  under the component). Anti-reroll server-side: decided questions are never
 *  re-asked. */
export function generateQuestionTopics(groupId: string, componentId: string, language: string) {
  return apiPost<{ topics: Record<string, string | null>; generated: number; cached: boolean }>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/learnings/${
      encodeURIComponent(componentId)}/topics`,
    { language }
  )
}

/** A content-only launch URL so the teacher can open the lomda themselves —
 *  no learner, no chat, no tracking (the server hands the content an xAPI sink
 *  that rejects everything). Group-free on purpose: previewing is looking at
 *  the catalog, not at learners. */
export interface LearningPreview {
  player_url: string
  embeddable: boolean
  title: string
}

export function previewLearning(componentId: string) {
  return apiPost<LearningPreview>(
    `/api/teacher/learnings/${encodeURIComponent(componentId)}/preview`, {}
  )
}

/* Pin-next (#249 shipped the component slice; #244 completed it). The target
 * is a catalog component picked from `getGroupLearnings` above, or a task the
 * learner was actually assigned — either way the server resolves everything
 * else (unit, objective, the task's title) from the id, so only the id and an
 * optional end date cross the wire. */
export interface PinnedNext {
  /** Absent on pins written before #244 — read that as 'component'.
   *  'objective' = a learning GOAL: the planner allocates within it. */
  kind?: 'component' | 'task' | 'objective'
  component_id?: string
  unit_id?: string | null
  objective_id?: string | null
  /** Objective pins: where the goal lives, for the class map's row label. */
  subject?: string | null
  /** Task pins: the opening the child's own route accepts, and the task. */
  launch_id?: string
  task_id?: string
  /** The task's title, frozen at pin time — the catalog has never seen it. */
  title?: string
  pinned_by: string
  pinned_at: string
  /** Absent = the pin holds until done or unpinned. Past = it stopped
   *  steering already; `pin_state` says which reading is true. */
  expires_at?: string
}

/** How the previous pin ended — what lets a teacher tell "done ✓" apart from
 *  "never pinned". */
export interface PinnedLast extends PinnedNext {
  outcome: 'completed' | 'expired' | 'unpinned'
  ended_at: string
}

/** An open task opening the pin panel may offer — already assigned, not yet
 *  handed in, so pinning it can never point at a paper the child cannot open. */
export interface PinnableTask {
  launch_id: string
  task_id: string
  title: string | null
  due_at: string | null
  status: string
}

/** Where the planner is pointing one learner right now — the profile's
 *  "מיקוד", read class-wide for the live view's rows and subject gauges. */
export interface LearnerFocus {
  learner_id: string
  subject: string | null
  subject_name: string
  objective_id: string | null
  objective_title: string | null
  /** True when the focus IS a teacher-set pin (the route honours it). */
  pinned: boolean
  /** Today's check-in feeling (#452), read-side expired at the Israeli
   *  midnight — null once the day turns or when the child never answered. */
  feeling: { valence: string; feeling: string } | null
}

export function getGroupFocus(groupId: string, language: string) {
  return apiGet<{ learners: LearnerFocus[] }>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/focus?language=${language}`
  )
}

/** The planner's own answer for one learner, incl. the exact next component —
 *  what makes the focus panel's "fits now" a fact rather than a guess. */
export interface PinFocus {
  subject: string | null
  subject_name: string
  objective_id: string | null
  objective_title: string | null
  next_component_id: string | null
}

export function getPinnedNext(learnerId: string, language: string) {
  return apiGet<{
    pinned: PinnedNext | null
    /** Display name for the standing pin, resolved server-side — the task's
     *  frozen title or the pinned learning's localized one. */
    pinned_title: string | null
    /** Null when nothing is pinned. 'expired' and 'spent' (the pinned
     *  component was already completed) keep a dead record readable rather
     *  than pretending it never was — either way it steers nobody. */
    pin_state: 'active' | 'expired' | 'spent' | null
    last: PinnedLast | null
    last_title: string | null
    tasks: PinnableTask[]
    focus: PinFocus
  }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/pin-next?language=${language}`
  )
}

/** Exactly one of `component_id` / `launch_id`; `expires_at` optional — a bare
 *  date means "through that day" in the classroom's timezone. */
export interface PinRequest {
  /** Exactly one target. `objective_id` pins a learning GOAL (the dialog's
   *  only learnings currency now); `component_id` survives for older
   *  surfaces; `launch_id` pins an assigned task. */
  objective_id?: string
  component_id?: string
  launch_id?: string
  expires_at?: string
}

export function pinNext(learnerId: string, body: PinRequest) {
  return apiPost<{ pinned: PinnedNext }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/pin-next`, body
  )
}

/** One pin, many children. Targets resolve server-side against the LIVE
 *  roster; a child a task-pin cannot reach comes back in `skipped`, named. */
export function bulkPinNext(
  groupId: string,
  body: {
    targets: { kind: 'learner' | 'subgroup' | 'group'; id: string }[]
    pin: PinRequest
    expires_at?: string
  }
) {
  return apiPost<{ pinned: string[]; skipped: { learner_id: string; reason: string }[] }>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/pin-next`, body
  )
}

export function unpinNext(learnerId: string) {
  return apiDelete<{ pinned: null }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/pin-next`
  )
}

/** Every learner's goal conversations in one read — the class Goals screen. */
export function getGroupGoals(groupId: string) {
  return apiGet<{ learners: { learner_id: string; conversations: GoalConversation[] }[] }>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/goals`
  )
}

/* ── sub-groups ─────────────────────────────────────────────────────────────
   A named slice of one class. Not a group: membership is a list resolved
   against the live roster on every read, so a learner who leaves the class
   leaves every sub-group without a migration. */

export interface Subgroup {
  id: string
  group_id: string
  name: string
  learner_ids: string[]
  size: number
  /** Members who are no longer enrolled in the parent class. Shown, not hidden:
   *  a selection of six rendering five needs a reason. */
  dropped: string[]
  created_by?: string
  created_at?: string
}

export interface SubgroupWrite extends Subgroup {
  /** Ids refused because they are not in the parent class. */
  skipped?: { learner_id: string; reason: string }[]
}

export function listSubgroups(groupId: string) {
  return apiGet<{ subgroups: Subgroup[] }>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/subgroups`
  )
}

export function createSubgroup(groupId: string, name: string, learnerIds: string[]) {
  return apiPost<SubgroupWrite>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/subgroups`,
    { name, learner_ids: learnerIds }
  )
}

export function updateSubgroup(
  subgroupId: string, changes: { name?: string; learner_ids?: string[] }
) {
  return apiPatch<SubgroupWrite>(
    `/api/teacher/subgroups/${encodeURIComponent(subgroupId)}`, changes
  )
}

export function deleteSubgroup(subgroupId: string) {
  return apiDelete<{ id: string; archived: boolean }>(
    `/api/teacher/subgroups/${encodeURIComponent(subgroupId)}`
  )
}

/* ── what Yuvi makes of one student ────────────────────────────────────────── */

/** A read of one child in words: what is hard, what has got better, how engaged
 *  they are, and one thing worth doing next.
 *
 *  Cached server-side for a day — see `learner_read.py`. `generated_at` is shown
 *  because a teacher acting on this is entitled to know how old it is, and
 *  `stale` means a refresh was attempted and failed. */
export interface LearnerRead {
  /** Free prose, no figures — the overall analysis paragraph. Opens the goal
   *  dialog's context reading; the recommendations panel no longer prints it. */
  overview?: string
  /** Per-subject sections — a short performance summary in prose, then the
   *  points, each point carrying its numbers. */
  subjects?: { subject: string; summary?: string; points: string[] }[]
  suggestion?: string
  /** The real material the suggestion points at, validated server-side —
   *  what the build-task seed opens on. Null when the model named nothing. */
  suggestion_anchor?: {
    key: string
    title: string
    subject?: string | null
    objective_id?: string | null
  } | null
  generated_at?: string
  cached?: boolean
  stale?: boolean
  /** No read could be produced at all — render the blank state, not an error. */
  unavailable?: boolean
}

export function getLearnerRead(learnerId: string, language: string, refresh = false) {
  const params = new URLSearchParams({ language })
  if (refresh) params.set('refresh', 'true')
  return apiGet<LearnerRead>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/read?${params}`)
}

/* ── a disclosure, and what was done about it ──────────────────────────────── */

/** A child said something that needs an adult.
 *
 *  Durable, never deleted, and carrying the state a human changes: who claimed
 *  it, what they did, who closed it and why. `legacy` marks a row projected out
 *  of the old brain array — readable, but nothing can act on it, because there
 *  is no record to write the action into. */
export interface WellbeingFlag {
  _id: string
  learner_id: string
  category: string
  /** The child's own words. */
  evidence: string
  /** What the child was told back, so an adult knows what they already heard. */
  reply: string
  source: 'coach_chat' | 'competency_chat' | 'direct_message' | 'mapping_reflection' | string
  /** False when what they wrote never reached anyone — a blocked message. */
  delivered: boolean
  at: string
  status: 'open' | 'acknowledged' | 'closed'
  /** Every teacher who was rung about it. */
  notified: string[]
  acknowledged_by: string | null
  acknowledged_at: string | null
  closed_by: string | null
  closed_at: string | null
  close_reason: string | null
  close_note: string | null
  actions: { id: string; kind: string; text: string; by: string; at: string }[]
  legacy?: boolean
}

export interface WellbeingResponse {
  flags: WellbeingFlag[]
  close_reasons: string[]
  action_kinds: string[]
}

export function listWellbeingFlags(learnerId: string, signal?: AbortSignal) {
  return apiGet<WellbeingResponse>(
    `/api/teacher/student/${encodeURIComponent(learnerId)}/wellbeing`, { signal })
}

const flagUrl = (flagId: string, verb: string) =>
  `/api/teacher/wellbeing/${encodeURIComponent(flagId)}/${verb}`

export function acknowledgeWellbeingFlag(flagId: string) {
  return apiPost<{ flag: WellbeingFlag }>(flagUrl(flagId, 'acknowledge'), {})
}

export function logWellbeingAction(flagId: string, kind: string, text: string) {
  return apiPost<{ flag: WellbeingFlag }>(flagUrl(flagId, 'log'), { kind, text })
}

export function closeWellbeingFlag(flagId: string, reason: string, note: string) {
  return apiPost<{ flag: WellbeingFlag }>(flagUrl(flagId, 'close'), { reason, note })
}

export function reopenWellbeingFlag(flagId: string) {
  return apiPost<{ flag: WellbeingFlag }>(flagUrl(flagId, 'reopen'), {})
}

/** Words to start from. Advisory: the teacher edits them, and nothing is sent
 *  or written by asking. `generated` is false when the model was unreachable
 *  and the written fallbacks are what came back — the UI says which. */
export interface WellbeingSuggestion {
  intent: string
  options: string[]
  generated: boolean
  protocol_key: string
}

export function suggestWellbeing(flagId: string, intent: 'message' | 'handle' | 'close') {
  return apiPost<WellbeingSuggestion>(flagUrl(flagId, 'suggest'), { intent })
}

/* ── the class calendar (#241) ─────────────────────────────────────────────
 *
 * One list, four owners. Task launches, goal deadlines and mentoring meetings
 * are read where they live; only `event` rows belong to the calendar itself.
 * `day` is computed server-side in the school's timezone, so the client never
 * re-derives which column something falls in — that is the bug this avoids. */

export type CalendarSource = 'event' | 'task' | 'goal' | 'meeting'
export type CalendarEventKind = 'lesson' | 'reminder' | 'test' | 'event'

export interface CalendarItem {
  id: string
  source: CalendarSource
  /** The event kind for `event` rows; equal to `source` for the rest. */
  kind: string
  title: string
  /** `YYYY-MM-DD` in school time — the day column. Never recompute it. */
  day: string
  /** Full timestamp for timed items, null when all-day. */
  at: string | null
  all_day: boolean
  learner_id: string | null
  learner_ids: string[]
  targets: { kind: string; id: string }[]
  subject: string | null
  href: string | null
  meta: Record<string, unknown>
}

export interface CalendarRange {
  from: string
  to: string
  /** The school's IANA zone — times are rendered in it, not the browser's. */
  timezone: string
  items: CalendarItem[]
}

export interface CalendarEventDraft {
  title: string
  description?: string
  kind: CalendarEventKind
  all_day: boolean
  /** `YYYY-MM-DD` when all-day, an ISO timestamp when timed. */
  start_at: string
  end_at?: string | null
  targets: { kind: string; id: string }[]
}

export function getGroupCalendar(
  groupId: string, from: string, to: string,
  scope?: { subgroup?: string | null; learner?: string | null }
) {
  const query = new URLSearchParams({ from, to })
  if (scope?.learner) query.set('learner', scope.learner)
  else if (scope?.subgroup) query.set('subgroup', scope.subgroup)
  return apiGet<CalendarRange>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/calendar?${query}`
  )
}

export function createCalendarEvent(groupId: string, event: CalendarEventDraft) {
  return apiPost<{ event: Record<string, unknown>; reaches: number }>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/calendar/events`, event
  )
}

/** Change an event already on the calendar.
 *
 *  The server rebuilds the whole event from `stored + patch` and runs it
 *  through exactly the validation a creation gets, so a partial body is safe
 *  and the all-day day-shape rule cannot be edited around. */
export function updateCalendarEvent(eventId: string, patch: Partial<CalendarEventDraft>) {
  return apiPatch<{ event: Record<string, unknown> }>(
    `/api/teacher/calendar/events/${encodeURIComponent(eventId)}`, patch
  )
}

export function deleteCalendarEvent(eventId: string) {
  return apiDelete<{ deleted: boolean }>(
    `/api/teacher/calendar/events/${encodeURIComponent(eventId)}`
  )
}

/* ── mentoring: the talk a goal came out of ───────────────────────────────── */

/** One row of the meeting-prep sheet.
 *
 *  Two shapes, and consumers must handle both: the model path writes `text`,
 *  while the deterministic fallback returns a locale `text_key` plus `params`
 *  so it can speak all three languages without a model. */
export interface MeetingPrepRow {
  text?: string
  text_key?: string
  params?: Record<string, string | number>
  because?: GoalDraft['because']
}

export interface MeetingPrep {
  questions: MeetingPrepRow[]
  insights: MeetingPrepRow[]
  goal_ideas: MeetingPrepRow[]
}

/** What is worth raising with this student — offered before the conversation. */
export function getMeetingPrep(learnerId: string, language: string) {
  return apiGet<MeetingPrep>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/meeting-prep`
    + `?language=${encodeURIComponent(language)}`
  )
}

/** One turn of Yuvi's guided write-up — the teacher's voice, not the child's. */
export function assistTeacherMentoring(
  learnerId: string,
  body: { language: string; qa: { q: string; a: string }[]; notes: string; more?: boolean },
) {
  return apiPost<{
    draft: string
    question: string
    options: string[]
    phase: 'asking' | 'ready'
    ai: boolean
  }>(`/api/teacher/students/${encodeURIComponent(learnerId)}/mentoring/assist`, body)
}

/** Goals that follow from the write-up, as opposed to from observed evidence. */
export function mentoringGoalIdeas(
  learnerId: string, body: { language: string; notes: string; count?: number },
) {
  return apiPost<{ goals: GoalDraft[] }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/mentoring/goal-ideas`, body
  )
}

export interface DocumentedConversation {
  id: string
  learner_id: string
  date: string
  notes: string
  goals: StudentGoal[]
}

/** Write the conversation and every goal agreed in it, as one record.
 *
 *  `draft_id` is the idempotency key: pricing runs a model call per goal, so
 *  the button stays live for seconds and a second click must not produce a
 *  second conversation. */
export function documentMentoring(
  learnerId: string,
  body: {
    notes: string
    goals: { title: string; next_steps: string; deadline: string; action: GoalAction | null }[]
    meeting_stage?: string
    teacher_only_note?: string
    visibility?: 'shared' | 'teacher_only'
    draft_id: string
    language: string
  },
) {
  return apiPost<DocumentedConversation>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/mentoring`, body
  )
}

/** Remove a write-up this teacher filed.
 *
 *  Only their own: the server refuses a colleague's record and a child's own
 *  reflection alike. Soft — the row is kept and never listed again. */
export function deleteMentoringConversation(learnerId: string, conversationId: string) {
  return apiDelete<{ deleted: boolean }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}`
    + `/mentoring/${encodeURIComponent(conversationId)}`
  )
}

/* ── teacher UI state ─────────────────────────────────────────────────────── */

/** One goal being drafted inside a mentoring write-up.
 *
 *  `action` is carried through every edit on purpose: a suggestion that came
 *  with a countable action must not quietly become an untracked goal because
 *  the teacher reworded its title. */
export interface MentoringGoalDraft {
  title: string
  next_steps: string
  deadline: string
  action: GoalAction | null
  /** Where the goal came from. `assistant` is the teaching assistant's draft —
   *  it carries an `action` like the generated ones, so it is not `manual`. */
  origin: 'conversation' | 'evidence' | 'manual' | 'assistant'
  because?: GoalDraft['because']
}

/** The teacher's in-progress mentoring write-up.
 *
 *  Server-side rather than in the browser: this is a record of a conversation
 *  with a child, so it should survive the device it was typed on. `qa` is here
 *  and not only in component state — the learner composer loses its guided
 *  writing thread on reload and re-asks question one. */
export interface TeacherMentoringDraft {
  open: boolean
  /** Idempotency key, so a resubmitted form finds its own conversation. */
  draft_id: string
  learner_id: string
  step: number
  notes: string
  teacher_only_note: string
  meeting_stage: string
  goals: MentoringGoalDraft[]
  qa: { q: string; a: string }[]
}

export interface TeacherState {
  teacher_id: string
  mentoring_draft: TeacherMentoringDraft | null
}

export function getTeacherState() {
  return apiGet<TeacherState>('/api/teacher/state')
}

/** Omitting `mentoring_draft` leaves it alone; sending `null` clears it. */
export function updateTeacherState(patch: Partial<Pick<TeacherState, 'mentoring_draft'>>) {
  return apiPatch<TeacherState>('/api/teacher/state', patch)
}

/* ── the nav badge ────────────────────────────────────────────────────────── */

/** How many finished goals are waiting for this teacher's sign-off, across
 *  every class they teach. Its own endpoint because the app bar asks for it on
 *  every screen — see the route's docstring. */
export function getPendingGoalCount() {
  return apiGet<{ count: number }>('/api/teacher/goals/pending-count')
}
