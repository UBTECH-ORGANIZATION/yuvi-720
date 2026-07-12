/* Coach stream client (F3). SSE from `/api/agent/coach/stream`: the first event
   carries the AI-use `disclosure`, then `text` chunks, then `[DONE]`. Reads/writes
   only through the backend — no `localStorage`. */

import { CURRENT_LEARNER_ID } from './xapi'
import { apiDelete, apiGet, apiPost } from './api'

export interface CoachVisualScene {
  use_visual: true
  title: string
  alt: string
  caption: string
  elements: Array<{ type: string; [key: string]: unknown }>
}

export interface CoachVisual {
  id: string
  type: 'image'
  mime_type: 'image/png' | 'image/svg+xml'
  data_url: string
  title: string
  alt: string
  caption: string
  renderer: 'manim' | 'svg-fallback'
  scene: CoachVisualScene
}

export interface CoachVisualStatus {
  status: 'rendering'
  textBefore: string
  textAfter: string
}

export interface CoachConversation {
  id: string
  title: string
  preview: string
  message_count: number
  created_at: string
  updated_at: string
}

export interface CoachHistoryMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  text_after: string
  at: string
  visual?: CoachVisual
}

export interface CoachConversationPage {
  conversations: CoachConversation[]
  next_cursor: string | null
  has_more: boolean
}

export interface CoachMessagePage {
  messages: CoachHistoryMessage[]
  next_cursor: string | null
  has_more: boolean
}

export interface CoachStreamHandlers {
  onDisclosure?: (text: string) => void
  onText: (chunk: string) => void
  onPhase?: (phase: 'thinking' | 'speaking') => void
  onVisualStatus?: (event: CoachVisualStatus) => void
  onVisual?: (visual: CoachVisual) => void
  signal?: AbortSignal
}

export type CoachScreenId =
  | 'results'
  | 'student_dashboard'
  | 'mentoring'
  | 'learning_portal'
  | 'learning_lesson'
  | 'learning_create'
  | 'unknown'

export interface CoachSurfaceContext {
  screen: CoachScreenId
}

/** Convert the local route into a bounded semantic screen id. Never send the
 * DOM, visible free text, or arbitrary URLs into the learner's AI context. */
export function coachSurfaceForPath(pathname: string): CoachSurfaceContext {
  if (pathname.startsWith('/results')) return { screen: 'results' }
  if (pathname.startsWith('/student-dashboard')) return { screen: 'student_dashboard' }
  if (pathname.startsWith('/mentoring')) return { screen: 'mentoring' }
  if (pathname.startsWith('/learning/lesson')) return { screen: 'learning_lesson' }
  if (pathname.startsWith('/learning/create')) return { screen: 'learning_create' }
  if (pathname.startsWith('/learning')) return { screen: 'learning_portal' }
  return { screen: 'unknown' }
}

async function streamAgent(
  path: string,
  body: Record<string, unknown>,
  handlers: CoachStreamHandlers
): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })
  if (!response.ok || !response.body) throw new Error(`stream ${path} failed`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') return
      try {
        const parsed = JSON.parse(payload) as {
          text?: string
          disclosure?: string
          visual_status?: 'rendering'
          text_before?: string
          text_after?: string
          visual?: CoachVisual
          phase?: 'thinking' | 'speaking'
        }
        if (parsed.disclosure) handlers.onDisclosure?.(parsed.disclosure)
        if (parsed.text) {
          handlers.onPhase?.('speaking')
          handlers.onText(parsed.text)
        }
        if (parsed.phase) handlers.onPhase?.(parsed.phase)
        if (parsed.visual_status === 'rendering') {
          handlers.onVisualStatus?.({
            status: parsed.visual_status,
            textBefore: parsed.text_before || '',
            textAfter: parsed.text_after || '',
          })
        }
        if (parsed.visual) handlers.onVisual?.(parsed.visual)
      } catch {
        continue
      }
    }
  }
}

export function streamCoach(
  message: string,
  language: string,
  handlers: CoachStreamHandlers,
  conversationId: string = 'default',
  learnerId: string = CURRENT_LEARNER_ID,
  surface: CoachSurfaceContext = { screen: 'unknown' }
): Promise<void> {
  return streamAgent(
    '/api/agent/coach/stream',
    { learner_id: learnerId, conversation_id: conversationId, message, language, surface },
    handlers
  )
}

export function streamProactive(
  trigger: string,
  language: string,
  handlers: CoachStreamHandlers,
  conversationId: string = 'default',
  learnerId: string = CURRENT_LEARNER_ID,
  surface: CoachSurfaceContext = { screen: 'unknown' }
): Promise<void> {
  return streamAgent(
    '/api/agent/coach/proactive',
    { learner_id: learnerId, conversation_id: conversationId, trigger, language, surface },
    handlers
  )
}

export function listCoachConversations(
  cursor?: string | null,
  limit: number = 12,
  learnerId: string = CURRENT_LEARNER_ID
): Promise<CoachConversationPage> {
  const params = new URLSearchParams({ learner_id: learnerId, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  return apiGet<CoachConversationPage>(
    `/api/agent/coach/conversations?${params}`,
    { cache: 'no-store' }
  )
}

export function createCoachConversation(
  learnerId: string = CURRENT_LEARNER_ID
): Promise<CoachConversation> {
  return apiPost<CoachConversation>('/api/agent/coach/conversations', { learner_id: learnerId })
}

export function listCoachMessages(
  conversationId: string,
  cursor?: string | null,
  limit: number = 20,
  learnerId: string = CURRENT_LEARNER_ID
): Promise<CoachMessagePage> {
  const params = new URLSearchParams({ learner_id: learnerId, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  return apiGet<CoachMessagePage>(
    `/api/agent/coach/conversations/${encodeURIComponent(conversationId)}/messages?${params}`,
    { cache: 'no-store' }
  )
}

export function deleteCoachConversation(
  conversationId: string,
  learnerId: string = CURRENT_LEARNER_ID
): Promise<{ ok: true }> {
  const params = new URLSearchParams({ learner_id: learnerId })
  return apiDelete<{ ok: true }>(
    `/api/agent/coach/conversations/${encodeURIComponent(conversationId)}?${params}`
  )
}

export interface Trigger {
  type: 'idle' | 'misconception' | 'success' | '_heartbeat'
  objective_id?: string | null
  misconception?: string | null
}

export interface NextRouteDecision {
  subject: string | null
  objective_id: string | null
  component: { id: string } | null
  explanation: string
}

/** Commit the deterministic next route after the learner explicitly starts it. */
export function selectNextRoute(
  language: string,
  learnerId: string = CURRENT_LEARNER_ID
): Promise<NextRouteDecision> {
  return apiPost<NextRouteDecision>('/api/agent/route/next', {
    learner_id: learnerId,
    language,
  })
}

/** Subscribe to proactive triggers via SSE (EventSource). Returns a closer. */
export function subscribeTriggers(
  onTrigger: (t: Trigger) => void,
  learnerId: string = CURRENT_LEARNER_ID
): () => void {
  const source = new EventSource(
    `/api/agent/triggers/subscribe?learner_id=${encodeURIComponent(learnerId)}`
  )
  source.onmessage = (e) => {
    try {
      const t = JSON.parse(e.data) as Trigger
      if (t.type && t.type !== '_heartbeat') onTrigger(t)
    } catch {
      /* ignore malformed */
    }
  }
  return () => source.close()
}

/** Report learner idle (absence isn't an event) so the trigger engine can nudge. */
export function reportIdle(objectiveId?: string, learnerId: string = CURRENT_LEARNER_ID): void {
  void fetch('/api/agent/triggers/idle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ learner_id: learnerId, objective_id: objectiveId }),
  }).catch(() => {})
}
