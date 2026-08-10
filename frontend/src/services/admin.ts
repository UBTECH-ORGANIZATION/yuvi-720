/* Admin control plane client (F8, plan A9b).
 *
 * Separate from `teacher.ts` on purpose: this is the *control plane* (who
 * exists, who is connected to whom), not a dashboard. The admin dashboard is
 * the ordinary teacher app with the group switcher unlocked — one
 * implementation, no drift.
 *
 * Guardrail refusals come back as 409 with a machine-readable `{error: code}`,
 * and the UI has to be able to tell "you may not do that" from "that failed".
 * `apiPost` throws before reading the body, so this module does its own POST and
 * surfaces the code as `AdminRefusal.code`.
 */

import { apiGet } from './api'
import { AdminRefusal, isOverridable } from './adminGuardrails'

export { AdminRefusal, isOverridable }

async function adminPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    // 400 (malformed) and 409 (state refuses) both carry a code; anything else
    // is a genuine transport/server failure and keeps its status as the code.
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new AdminRefusal(payload?.error ?? `http_${response.status}`, response.status)
  }
  return response.json() as Promise<T>
}

/* ── DTOs ─────────────────────────────────────────────────────────────────── */

export interface AuditEntry {
  _id: string
  actor_id: string
  action: string
  target_type: string
  target_id: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  reason: string | null
  at: string
}

export interface AdminOverview {
  counts: {
    schools: number
    groups: number
    teachers: number
    students: number
    active_links: number
    enrollments: number
  }
  /** Learners in no active group — invisible to every teacher until fixed. */
  unassigned_learners: { learner_id: string; display_name: string | null }[]
  teacherless_groups: { id: string; name: string | null }[]
  recent_changes: AuditEntry[]
}

export interface Person {
  user_id: string
  username: string | null
  display_name: string | null
  roles: string[]
  /** Teachers only: the groups they are linked to. */
  groups: { id: string; link_role: string | null }[]
  /** Learners only: the group ids they are enrolled in. */
  enrolled_in?: string[]
}

export interface TeacherConnections {
  teacher_id: string
  is_admin: boolean
  groups: OrgGroup[]
  reachable_learners: string[]
  reachable_count: number
}

/** Every teacher who can read this learner, and the group that grants it. */
export interface LearnerConnections {
  learner_id: string
  granted_via: {
    teacher_id: string
    group_id: string
    group_name: string | null
    link_role: string | null
  }[]
}

export interface OrgSchool {
  _id: string
  name: string
  moe_code?: string | null
  city?: string | null
}

export interface OrgGroup {
  _id: string
  id?: string
  school_id: string
  name: string
  subject?: string | null
  grade?: string | null
  year?: string | null
  active?: boolean
}

export interface TeacherLink {
  _id: string
  teacher_id: string
  group_id: string
  school_id?: string | null
  link_role?: string | null
  active?: boolean
}

export interface Enrollment {
  _id: string
  learner_id: string
  group_id: string
  school_id?: string | null
  active?: boolean
}

export interface OrgSnapshot {
  schools: OrgSchool[]
  groups: OrgGroup[]
  teacher_links: TeacherLink[]
  enrollments: Enrollment[]
}

export interface AdminGrant {
  _id: string
  scope: string
  school_ids: string[]
  granted_by?: string
  granted_at?: string
  active?: boolean
}

export interface ImportDiffEntry {
  kind: string
  id: string
  incoming: Record<string, unknown>
  existing?: Record<string, unknown>
}

export interface ImportResult {
  committed: boolean
  diff: { added: ImportDiffEntry[]; updated: ImportDiffEntry[]; unchanged: ImportDiffEntry[] }
}

export interface CreatedUser {
  user: Person
  /** Shown exactly once — the backend never returns it again. */
  temp_password: string
}

/* ── reads ────────────────────────────────────────────────────────────────── */

export function getOverview(): Promise<AdminOverview> {
  return apiGet('/api/admin/overview')
}

export function listPeople(role?: string, query?: string): Promise<{ people: Person[] }> {
  const params = new URLSearchParams()
  if (role) params.set('role', role)
  if (query) params.set('q', query)
  const suffix = params.toString()
  return apiGet(`/api/admin/people${suffix ? `?${suffix}` : ''}`)
}

export function getTeacherConnections(teacherId: string): Promise<TeacherConnections> {
  return apiGet(`/api/admin/teachers/${encodeURIComponent(teacherId)}/connections`)
}

export function getLearnerConnections(learnerId: string): Promise<LearnerConnections> {
  return apiGet(`/api/admin/learners/${encodeURIComponent(learnerId)}/connections`)
}

export function getOrg(): Promise<OrgSnapshot> {
  return apiGet('/api/admin/org')
}

export function listAdmins(): Promise<{ admins: AdminGrant[] }> {
  return apiGet('/api/admin/admins')
}

export function listAudit(filters: { actor_id?: string; target_id?: string; limit?: number } = {}):
Promise<{ entries: AuditEntry[] }> {
  const params = new URLSearchParams()
  if (filters.actor_id) params.set('actor_id', filters.actor_id)
  if (filters.target_id) params.set('target_id', filters.target_id)
  if (filters.limit) params.set('limit', String(filters.limit))
  const suffix = params.toString()
  return apiGet(`/api/admin/audit${suffix ? `?${suffix}` : ''}`)
}

/* ── mutations ────────────────────────────────────────────────────────────── */

export function saveSchool(payload: { id: string; name?: string; city?: string }): Promise<OrgSchool> {
  return adminPost('/api/admin/org/schools', payload)
}

export function saveGroup(payload: {
  id: string; school_id: string; name?: string; subject?: string; grade?: string
}): Promise<OrgGroup> {
  return adminPost('/api/admin/org/groups', payload)
}

/** Archive, never delete: the LRS statements pointing at this group must stay
 *  resolvable. */
export function archiveGroup(groupId: string): Promise<OrgGroup> {
  return adminPost(`/api/admin/org/groups/${encodeURIComponent(groupId)}/archive`, {})
}

export function linkTeacher(teacherId: string, groupId: string, linkRole = 'teacher'): Promise<TeacherLink> {
  return adminPost('/api/admin/org/teacher-links', {
    teacher_id: teacherId, group_id: groupId, link_role: linkRole,
  })
}

/** Throws `AdminRefusal('would_leave_group_unstaffed')` unless `confirm` — the
 *  learners in that group would otherwise become invisible to every teacher at
 *  once, silently. */
export function unlinkTeacher(teacherId: string, groupId: string, confirm = false): Promise<unknown> {
  return adminPost('/api/admin/org/teacher-links/remove', {
    teacher_id: teacherId, group_id: groupId, confirm_unstaffed: confirm,
  })
}

export function enrollLearners(groupId: string, learnerIds: string[]):
Promise<{ enrolled: string[]; skipped: { learner_id: string; reason: string }[] }> {
  return adminPost('/api/admin/org/enrollments', { group_id: groupId, learner_ids: learnerIds })
}

export function unenrollLearner(learnerId: string, groupId: string): Promise<unknown> {
  return adminPost('/api/admin/org/enrollments/remove', {
    learner_id: learnerId, group_id: groupId,
  })
}

export function grantAdmin(userId: string, scope = 'system'): Promise<AdminGrant> {
  return adminPost('/api/admin/admins', { user_id: userId, scope })
}

export function revokeAdmin(userId: string): Promise<unknown> {
  return adminPost('/api/admin/admins/revoke', { user_id: userId })
}

export function createUser(payload: {
  username: string; display_name?: string; roles: string[]; user_id?: string; language?: string
}): Promise<CreatedUser> {
  return adminPost('/api/admin/users', payload)
}

/** Preview by default — a roster import should never be the first time an admin
 *  learns what it was going to do. */
export function importRoster(roster: unknown, commit = false): Promise<ImportResult> {
  return adminPost('/api/admin/org/import', { roster, commit })
}
