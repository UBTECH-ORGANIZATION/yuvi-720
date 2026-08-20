/* The screened teacher↔learner channel, both lanes.
 *
 * One module for both sides because the two lanes are the same conversation
 * read from opposite ends, and the interesting logic — telling a MODERATION
 * refusal apart from a validation error or a dropped connection — is identical
 * and must not be written twice.
 *
 * `apiPost` throws a bare `Error` carrying only a status, which is not enough
 * here: a 422 from this endpoint means either "your message was refused" (detail
 * is a string, and a locale key) or "the request body was malformed" (FastAPI's
 * own detail, an array of field errors). Those two need different words in front
 * of the user, and a network failure needs a third — the reference
 * implementation showed the same toast for all three, so a flaky connection was
 * indistinguishable from being told off.
 */

export interface DirectMessage {
  id: string
  sender: 'teacher' | 'learner'
  text: string
  created_at: string
  read_at: string | null
}

/** A message a person was not allowed to send. `key` is a locale key, so the
 *  gentle wording is rendered in the reader's own language. */
export class MessageRefused extends Error {
  readonly key: string
  constructor(key: string) {
    super(key)
    this.name = 'MessageRefused'
    this.key = key
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function send(path: string, text: string, language: string): Promise<DirectMessage> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ text, language }),
  })

  if (response.ok) return response.json() as Promise<DirectMessage>

  if (response.status === 422) {
    // A string detail is the moderation refusal; an array is FastAPI telling us
    // the body was wrong, which is our bug and not the user's.
    const body = await response.json().catch(() => null)
    const detail = (body as { detail?: unknown } | null)?.detail
    if (typeof detail === 'string') throw new MessageRefused(detail)
  }
  const failure = new Error(`POST ${path} failed with ${response.status}`) as
    Error & { status: number }
  failure.status = response.status
  throw failure
}

/* ── the teacher's lane ────────────────────────────────────────────────────── */

export async function listMessages(learnerId: string): Promise<DirectMessage[]> {
  const response = await fetch(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/messages`,
    { credentials: 'include' })
  if (!response.ok) throw new Error(`messages ${response.status}`)
  return (await response.json()).messages ?? []
}

export function sendMessage(learnerId: string, text: string, language: string) {
  return send(
    `/api/teacher/students/${encodeURIComponent(learnerId)}/messages`, text, language)
}

export function markMessagesRead(learnerId: string) {
  return fetch(`/api/teacher/students/${encodeURIComponent(learnerId)}/messages/read`,
    { method: 'PATCH', credentials: 'include' })
}

/* ── the learner's lane ────────────────────────────────────────────────────── */

/** Per-thread unread counts plus the total, for badges. Cheap by contract:
 *  both endpoints read the conversation counters, never the threads. */
export interface UnreadMap {
  unread: Record<string, number>
  total: number
}

export async function getTeacherUnread(): Promise<UnreadMap> {
  const response = await fetch('/api/teacher/messages-unread', { credentials: 'include' })
  if (!response.ok) throw new Error(`unread ${response.status}`)
  return response.json()
}

export async function getMyUnread(): Promise<UnreadMap> {
  const response = await fetch('/api/me/messages-unread', { credentials: 'include' })
  if (!response.ok) throw new Error(`unread ${response.status}`)
  return response.json()
}

export async function listMyMessages(teacherId: string): Promise<DirectMessage[]> {
  const response = await fetch(`/api/me/messages/${encodeURIComponent(teacherId)}`,
    { credentials: 'include' })
  if (!response.ok) throw new Error(`messages ${response.status}`)
  return (await response.json()).messages ?? []
}

export function sendMyMessage(teacherId: string, text: string, language: string) {
  return send(`/api/me/messages/${encodeURIComponent(teacherId)}`, text, language)
}

export function markMyMessagesRead(teacherId: string) {
  return fetch(`/api/me/messages/${encodeURIComponent(teacherId)}/read`,
    { method: 'PATCH', credentials: 'include' })
}

/* ── addressing a whole sub-group ──────────────────────────────────────────── */

/** One thing a teacher said to a named group. It arrives in each member's own
 *  thread — see `direct_messages.send_to_subgroup` — so this is a record of the
 *  send, not a room. */
export interface SubgroupBroadcast {
  broadcast_id: string
  text: string
  created_at: string
  recipients: string[]
  /** How many of the copies are still unread. */
  unread: number
}

export async function listSubgroupBroadcasts(
  subgroupId: string,
): Promise<SubgroupBroadcast[]> {
  const response = await fetch(
    `/api/teacher/subgroups/${encodeURIComponent(subgroupId)}/messages`,
    { credentials: 'include' })
  if (!response.ok) throw new Error(`subgroup messages ${response.status}`)
  return (await response.json()).broadcasts ?? []
}

/** Reuses the same refusal handling as a 1:1 send: a moderation 422 carries a
 *  locale key as a string `detail`, and everything else is a plain failure. */
export async function sendSubgroupMessage(
  subgroupId: string, text: string, language: string,
): Promise<{ broadcast_id: string; sent: string[]; skipped: string[] }> {
  return send(
    `/api/teacher/subgroups/${encodeURIComponent(subgroupId)}/messages`, text, language,
  ) as unknown as Promise<{ broadcast_id: string; sent: string[]; skipped: string[] }>
}
