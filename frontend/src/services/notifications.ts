/* Notification client. One set of endpoints, both roles.
 *
 * Rows carry `title_key` + `params` and are rendered here, never on the server:
 * a user can switch language at any moment and a stored sentence would be
 * frozen in a language they no longer read.
 */

import { apiGet, apiPost } from './api'

export type NotificationKind =
  | 'goal_assigned' | 'goal_approved' | 'teacher_note' | 'kudos' | 'alert'

export interface NotificationAction {
  label_key: string
  /** Deep link to the object itself, e.g. `/mentoring?conversation=c1&goal=g1`. */
  route: string
}

export interface AppNotification {
  _id: string
  recipient_id: string
  recipient_role: string
  actor_id: string | null
  kind: NotificationKind
  title_key: string
  body_key: string | null
  params: Record<string, unknown>
  actions: NotificationAction[]
  read_at: string | null
  /** Soft delete. The row still exists and can be revealed again. */
  dismissed_at: string | null
  created_at: string
}

/** Which inbox to read. One person can be both a learner and a teacher, and
 *  the portal they are standing in decides whose mail they are looking at —
 *  the server re-checks that they actually hold the role they ask for. */
export type NotificationRole = 'learner' | 'teacher'

function scoped(path: string, role?: NotificationRole, extra = '') {
  const params = new URLSearchParams(extra)
  if (role) params.set('role', role)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export function listNotifications(includeDismissed = false, role?: NotificationRole) {
  return apiGet<{ notifications: AppNotification[]; unread: number }>(
    scoped('/api/notifications', role, includeDismissed ? 'include_dismissed=true' : '')
  )
}

export function markNotificationsRead(ids: string[], role?: NotificationRole) {
  return apiPost<{ updated: number; unread: number }>(
    scoped('/api/notifications/read', role), { ids })
}

export function markAllNotificationsRead(role?: NotificationRole) {
  return apiPost<{ updated: number; unread: number }>(
    scoped('/api/notifications/read-all', role), {})
}

/** Soft delete — stamps `dismissed_at`, never removes the document. */
export function dismissNotifications(ids: string[], role?: NotificationRole) {
  return apiPost<{ updated: number; unread: number }>(
    scoped('/api/notifications/dismiss', role), { ids })
}

export function dismissAllNotifications(role?: NotificationRole) {
  return apiPost<{ updated: number; unread: number }>(
    scoped('/api/notifications/dismiss-all', role), {})
}
