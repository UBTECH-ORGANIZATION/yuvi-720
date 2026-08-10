/* Teacher view + org clients (F6/F8). Every insight/flag carries raw evidence;
   access is group-scoped server-side. */

import { apiDelete, apiGet, apiPost } from './api'

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
export interface WellbeingFlag { evidence: string; at?: string; source?: string }
export interface StudentInsight {
  learner_id: string
  display_name: string | null
  progress: Record<string, { objectives_total: number; objectives_mastered: number }>
  next: Record<string, string[]>
  struggle_items: StruggleItem[]
  strengths: string[]
  attention: AttentionFlag | null
  wellbeing_flags: WellbeingFlag[]
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

export interface GroupInsight {
  group: { id: string; name: string; subject?: string } | null
  students: {
    learner_id: string; display_name: string | null; attention: AttentionFlag | null
    progress: unknown; status: StudentStatus; activity: StudentActivity
  }[]
  trends: {
    students_total: number; active_last_7d: number; needing_attention: number
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

/** Full student view. Extends the legacy shape rather than replacing it. */
export interface StudentDetail extends StudentInsight {
  objectives_progress: Record<string, SubjectProgress>
  subject_filter: string | null
  strengths_detail: StrengthDetail[]
  /** Every criterion that fired, not just the highest-priority one. */
  attention_all: AttentionFlag[]
  self_awareness: { reading: string; gap: number; samples: unknown[] } | null
}

export interface Engagement {
  group_id: string
  window_days: number
  students_total: number
  active_students: number
  active_pct: number
  /** null when no trustworthy timing evidence exists — never a fake zero. */
  avg_active_minutes: number | null
  timing_available: boolean
  avg_days_active: number
  per_day_active: { date: string; active: number }[]
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
  /** The actionable sub-group. Never render this as a ranking. */
  learner_ids: string[]
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

export function getGroupSnapshot(groupId: string, language: string, subject?: string) {
  const params = new URLSearchParams({ language })
  if (subject) params.set('subject', subject)
  return apiGet<GroupInsight>(`/api/teacher/groups/${groupId}/snapshot?${params}`)
}

export function getGroupEngagement(groupId: string, days = 7) {
  return apiGet<Engagement>(`/api/teacher/groups/${groupId}/engagement?days=${days}`)
}

export function getGroupGaps(groupId: string, language: string, subject?: string) {
  const params = new URLSearchParams({ language })
  if (subject) params.set('subject', subject)
  return apiGet<{ gaps: LearningGap[]; recommendations: GroupRecommendation[] }>(
    `/api/teacher/groups/${groupId}/gaps?${params}`
  )
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

export function getStudentReflections(learnerId: string) {
  return apiGet<{ reflections: unknown[]; self_awareness: StudentDetail['self_awareness'] }>(
    `/api/teacher/students/${learnerId}/reflections`
  )
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
}

export interface GoalConversation {
  id: string
  author?: string
  date?: string
  goals: StudentGoal[]
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

export function suggestStudentGoals(learnerId: string, language: string, subject?: string) {
  return apiPost<{ goals: GoalDraft[] }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/goals/suggest`,
    { language, subject }
  )
}

export function assignStudentGoal(
  learnerId: string,
  goal: { title: string; next_steps?: string; deadline?: string },
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

export function getGroupMoments(groupId: string, language: string, days = 14) {
  return apiGet<{ moments: Moment[] }>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/moments?language=${language}&days=${days}`
  )
}

export function getStudentMoments(learnerId: string, language: string, days = 14) {
  return apiGet<{ moments: Moment[] }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/moments?language=${language}&days=${days}`
  )
}

export function sendKudos(
  learnerId: string, message: string, language: string, moment?: Record<string, unknown>
) {
  return apiPost<{ kudos_id: string; message: string }>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/kudos`,
    { message, language, moment: moment ?? null }
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

/* ── the daily brief ──────────────────────────────────────────────────────── */

/** A move the teacher can make. `learner_ids` is assembled server-side from
 *  mastery evidence — the model writes the prose and never picks the children. */
export interface BriefAction {
  kind: 'assign_subgroup' | 'open_roster'
  objective_id?: string
  label?: string
  filter?: string
  learner_ids: string[]
  because: { signal: string; value: unknown; raw: Record<string, unknown> }
}

export interface BriefStat {
  key: 'active_in_window' | 'needing_attention' | 'not_started'
  value: number | null
  total?: number | null
}

export interface DailyBrief {
  /** Start of the window this brief covers — the previous brief, or last login. */
  since: string | null
  generated_at: string | null
  window_days: number
  headline: DigestBullet | null
  bullets: DigestBullet[]
  stats: BriefStat[]
  actions: BriefAction[]
  source: 'ai' | 'fallback' | 'empty'
  cached: boolean
  reason?: string
}

export function getDailyBrief(groupId: string, language: string, refresh = false) {
  const params = new URLSearchParams({ group_id: groupId, language })
  if (refresh) params.set('refresh', 'true')
  return apiGet<DailyBrief>(`/api/teacher/brief?${params}`)
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

export interface MeetingPrepRow {
  text?: string
  text_key?: string
  params?: Record<string, unknown>
  because: { signal: string; value: unknown; raw: unknown }
}

export interface MeetingPrep {
  questions: MeetingPrepRow[]
  insights: MeetingPrepRow[]
  goal_ideas: MeetingPrepRow[]
  unavailable?: boolean
  because?: { signal: string; value: unknown; raw: unknown }
}

export function getMeetingPrep(learnerId: string, language: string) {
  return apiGet<MeetingPrep>(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/meeting-prep?language=${language}`
  )
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
  attempts: number
  correct: number
  success_rate: number | null
  avg_seconds: number | null
  learners: number
  hints_used?: number
  chat_turns?: number
}

/** One screen of a learning — including the ones that only teach. */
export interface LearningScreen {
  item_id: string
  title: string
  kind: 'question' | 'watch' | 'read' | 'step' | string
  question_count: number
  attempts: number
  correct: number
  success_rate: number | null
  learners: number
  avg_seconds: number | null
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
  screens: LearningScreen[]
}

export function getGroupLearnings(groupId: string, language: string, subject?: string) {
  const params = new URLSearchParams({ language })
  if (subject) params.set('subject', subject)
  return apiGet<LearningsView>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/learnings?${params}`
  )
}

export function getLearningDetail(groupId: string, componentId: string, language: string) {
  return apiGet<LearningDetail>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/learnings/${
      encodeURIComponent(componentId)}?language=${language}`
  )
}

/** Every learner's goal conversations in one read — the class Goals screen. */
export function getGroupGoals(groupId: string) {
  return apiGet<{ learners: { learner_id: string; conversations: GoalConversation[] }[] }>(
    `/api/teacher/groups/${encodeURIComponent(groupId)}/goals`
  )
}
