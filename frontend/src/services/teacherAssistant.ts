/* The teaching assistant client.
 *
 * `tools` comes back on every answer and is not decoration: an answer with an
 * empty trace is an answer with nothing behind it, and the UI says so. That is
 * the fifth layer of the grounding contract (see agents/teacher_assistant.py).
 */

import { streamAgent } from './agents'
import { apiDelete, apiGet, apiPost } from './api'
import type { MentoringGoalDraft } from './teacher'

export type ToolStatus = 'ok' | 'empty' | 'error'

export interface ToolTraceEntry {
  name: string
  status: ToolStatus
  reason?: string | null
}

/* Actions the answer offered.
 *
 * These come from the TOOL layer, never from the model's prose — so every
 * `learner_id` in one has already passed the server-side scope check, and every
 * label is a locale key rather than a sentence the model wrote. The teacher
 * presses the button; the browser then calls the same endpoint the goals screen
 * calls. Nothing here has written anything. */
export type ActionKind =
  | 'navigate' | 'draft_goal' | 'draft_note' | 'draft_kudos' | 'draft_task'
  | 'draft_calendar_event' | 'edit_calendar_event'
  | 'draft_mentoring' | 'meet_students'
  | 'approve_goals' | 'ack_alerts' | 'followups'

export interface PendingGoal {
  learner_id: string
  goal_id: string
  conversation_id: string
  title: string
  reward_value?: number | null
}

/** A student `suggest_students_to_meet` put on the list, and why.
 *
 *  `because` is a list of codes, never sentences: the ranking is arithmetic
 *  the server can show its working for, and the reasons render in the
 *  teacher's own language rather than in whichever one the model was in. */
export interface MeetCandidate {
  learner_id: string
  last_met: string | null
  days_since_meeting: number | null
  open_goals_overdue: number
  open_goals_needing_help: number
  because: string[]
}

export interface OpenAlert {
  alert_id: string
  learner_id?: string | null
  kind?: string | null
  severity?: string | null
}

export interface AssistantAction {
  id: string
  kind: ActionKind
  /** A locale key. Empty for `followups`, whose chips are their own labels. */
  label_key: string
  params?: Record<string, string | number>
  icon?: string
  /* navigate */
  route?: string
  /* draft_goal */
  learner_ids?: string[]
  title?: string
  next_steps?: string
  deadline?: string
  /** Required fields the model could not fill — the form flags these. */
  missing?: string[]
  /* draft_note / draft_kudos */
  learner_id?: string
  text?: string
  note_kind?: string
  message?: string
  /* draft_task — `title` above is shared with draft_goal */
  topic?: string
  subject?: string
  components?: string[]
  difficulty?: string
  /** The catalogue lesson the task is built on, as an id. Ids rather than the
   *  lesson text, for the same reason `TaskSpecInput.source` holds ids. */
  source_component_id?: string
  /* draft_calendar_event / edit_calendar_event — `title` is shared again.
     `event_kind` rather than `kind`, which is the ACTION's own discriminator;
     one field named `kind` meaning two things is how a form ends up reading
     the wrong one. */
  group_id?: string
  event_id?: string
  description?: string
  event_kind?: string
  all_day?: boolean
  start_at?: string
  end_at?: string
  targets?: { kind: string; id: string }[]
  /* draft_mentoring — `notes` is the write-up, not `text`.
     `goal_drafts` rather than `goals`, which below means finished goals waiting
     for approval: one field name for two shapes is how a form reads the wrong
     one. `step` is which step of the composer to open on. */
  notes?: string
  teacher_only_note?: string
  meeting_stage?: string
  goal_drafts?: MentoringGoalDraft[]
  step?: number
  /* meet_students */
  students?: MeetCandidate[]
  /* approve_goals / ack_alerts / followups */
  goals?: PendingGoal[]
  alerts?: OpenAlert[]
  questions?: string[]
}

/** What the teacher did with an action, once they have done it. */
export interface ActionOutcome {
  status: 'done' | 'dismissed' | 'failed'
  summary?: string
  at?: string
}

export interface AssistantAnswer {
  /** The model's text, or null when a deterministic refusal applies. */
  text: string | null
  /** A locale key to render instead of `text`. Never a pre-rendered sentence. */
  text_key: string | null
  tools: ToolTraceEntry[]
  /** False when nothing was fetched — the UI must flag it. */
  grounded: boolean
  actions?: AssistantAction[]
}

export interface AssistantTurn {
  role: 'user' | 'assistant'
  content: string
}

/** What the teacher is looking at. Advisory only — never used for authorization. */
export interface ScreenContext {
  route: string
  screen: string
  group_id?: string | null
  learner_id?: string | null
  subject?: string | null
  /** The headline figures the page is showing, as the page holds them
   *  (rates as fractions, counts as counts). The server treats them as
   *  grounded — they are the teacher's own screen — so "what is this 69%"
   *  gets an answer instead of "I cannot see your screen" (#535). */
  visible?: Record<string, unknown> | null
}

export interface AssistantThread {
  id: string
  title: string
  preview: string
  message_count: number
  created_at: string
  updated_at: string
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  /** Actions this answer offered, and what became of them. Persisted, so a
   *  reopened thread shows a completed row rather than a live button that
   *  would happily assign the same goal a second time. */
  meta?: {
    actions?: AssistantAction[]
    outcomes?: Record<string, ActionOutcome>
  } | null
}

interface AskOptions {
  language: string
  screen?: ScreenContext
  history?: AssistantTurn[]
  conversationId?: string | null
}

function askBody(message: string, options: AskOptions) {
  return {
    message,
    language: options.language,
    screen: options.screen ?? null,
    history: options.history ?? [],
    conversation_id: options.conversationId ?? null,
  }
}

/** One-shot ask. Kept as the fallback for callers that cannot stream. */
export function askAssistant(message: string, options: AskOptions) {
  return apiPost<AssistantAnswer>('/api/teacher/assistant', askBody(message, options))
}

export interface AssistantStreamHandlers {
  onText: (chunk: string) => void
  /** Tools that have run so far — arrives per round, before the answer exists. */
  onTrace?: (tools: ToolTraceEntry[]) => void
  /** The thread's model-written name, once, on its first turn. */
  onTitle?: (title: string) => void
  /** Buttons the answer is offering — arrives with the trace, before the text. */
  onActions?: (actions: AssistantAction[]) => void
  /** The same payload `askAssistant` resolves to, as the final frame. */
  onDone?: (answer: AssistantAnswer) => void
  signal?: AbortSignal
}

/** Ask, and render the answer as it is written.
 *
 * A grounded reply runs several tool rounds first, so a blocking call left the
 * teacher watching a spinner for the entire thing. The agent still decides what
 * may be said early: nothing is streamed until at least one tool has answered.
 */
export function streamAssistant(
  message: string, options: AskOptions, handlers: AssistantStreamHandlers,
): Promise<void> {
  return streamAgent(
    '/api/teacher/assistant/stream',
    askBody(message, options),
    {
      onText: handlers.onText,
      onEvent: (payload) => {
        if (Array.isArray(payload.trace)) handlers.onTrace?.(payload.trace as ToolTraceEntry[])
        if (Array.isArray(payload.actions)) handlers.onActions?.(payload.actions as AssistantAction[])
        if (typeof payload.title === 'string') handlers.onTitle?.(payload.title)
        // The final payload arrives nested, never spread: its `text` is the
        // whole reply, and the shared reader treats a top-level `text` as one
        // more fragment to append.
        if (payload.answer) handlers.onDone?.(payload.answer as AssistantAnswer)
      },
      signal: handlers.signal,
    },
    // The tool rounds are silent by design, so a healthy stream can go a while
    // without a frame. This only catches a server that has stopped entirely.
    120_000,
  )
}

/* ── threads ───────────────────────────────────────────────────────────── */

export function listAssistantThreads(limit = 20) {
  return apiGet<{ conversations: AssistantThread[]; next_cursor?: string | null }>(
    `/api/teacher/assistant/conversations?limit=${limit}`
  )
}

export function createAssistantThread() {
  return apiPost<AssistantThread>('/api/teacher/assistant/conversations', {})
}

export function listAssistantMessages(conversationId: string, limit = 30) {
  return apiGet<{ messages: AssistantMessage[]; next_cursor?: string | null }>(
    `/api/teacher/assistant/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`
  )
}

/** Record what the teacher did with an offered action.
 *
 * Best-effort by design: the real write has already happened through its own
 * endpoint by the time this is called. Losing the receipt costs a stale-looking
 * button on the next reload, not a lost goal — so a failure here is swallowed
 * rather than surfaced as an error on a successful assignment. */
export function recordActionOutcome(
  conversationId: string, messageId: string,
  actionId: string, status: ActionOutcome['status'], summary?: string,
) {
  return apiPost<{ ok: boolean }>(
    `/api/teacher/assistant/conversations/${encodeURIComponent(conversationId)}`
    + `/messages/${encodeURIComponent(messageId)}/outcome`,
    { action_id: actionId, status, summary: summary ?? null },
  ).catch(() => ({ ok: false }))
}

export function deleteAssistantThread(conversationId: string) {
  return apiDelete<{ ok: boolean }>(
    `/api/teacher/assistant/conversations/${encodeURIComponent(conversationId)}`
  )
}
