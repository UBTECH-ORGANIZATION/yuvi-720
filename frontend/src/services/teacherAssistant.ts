/* The teaching assistant client.
 *
 * `tools` comes back on every answer and is not decoration: an answer with an
 * empty trace is an answer with nothing behind it, and the UI says so. That is
 * the fifth layer of the grounding contract (see agents/teacher_assistant.py).
 */

import { streamAgent } from './agents'
import { apiDelete, apiGet, apiPost } from './api'

export type ToolStatus = 'ok' | 'empty' | 'error'

export interface ToolTraceEntry {
  name: string
  status: ToolStatus
  reason?: string | null
}

export interface AssistantAnswer {
  /** The model's text, or null when a deterministic refusal applies. */
  text: string | null
  /** A locale key to render instead of `text`. Never a pre-rendered sentence. */
  text_key: string | null
  tools: ToolTraceEntry[]
  /** False when nothing was fetched — the UI must flag it. */
  grounded: boolean
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

export function deleteAssistantThread(conversationId: string) {
  return apiDelete<{ ok: boolean }>(
    `/api/teacher/assistant/conversations/${encodeURIComponent(conversationId)}`
  )
}
