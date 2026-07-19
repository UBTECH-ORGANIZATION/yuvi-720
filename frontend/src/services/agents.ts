/* Coach stream client (F3). SSE from `/api/agent/coach/stream`: the first event
   carries the AI-use `disclosure`, then `text` chunks, then `[DONE]`. Reads/writes
   only through the backend — no `localStorage`. */

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
  activity_unit_id?: string | null
  activity_component_id?: string | null
  activity_status?: 'open' | 'completed' | null
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
  | 'learning_world'
  | 'learning_lesson'
  | 'learning_create'
  | 'unknown'

export interface CoachSurfaceContext {
  screen: CoachScreenId
  unit_id?: string
  component_id?: string
}

/** Convert the local route into a bounded semantic screen id. Never send the
 * DOM, visible free text, or arbitrary URLs into the learner's AI context. */
export function coachSurfaceForPath(pathname: string): CoachSurfaceContext {
  if (pathname.startsWith('/results')) return { screen: 'results' }
  if (pathname.startsWith('/student-dashboard')) return { screen: 'student_dashboard' }
  if (pathname.startsWith('/mentoring')) return { screen: 'mentoring' }
  if (pathname.startsWith('/learning/lesson')) {
    const query = pathname.includes('?') ? pathname.slice(pathname.indexOf('?')) : ''
    const params = new URLSearchParams(query)
    const unitId = params.get('unit')?.trim()
    const componentId = params.get('component')?.trim()
    return {
      screen: 'learning_lesson',
      ...(unitId ? { unit_id: unitId } : {}),
      ...(componentId ? { component_id: componentId } : {}),
    }
  }
  if (pathname.startsWith('/learning/create')) return { screen: 'learning_create' }
  if (pathname === '/learning' || pathname.startsWith('/learning?')) return { screen: 'learning_world' }
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
    credentials: 'include',
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
  surface: CoachSurfaceContext = { screen: 'unknown' }
): Promise<void> {
  return streamAgent(
    '/api/agent/coach/stream',
    { conversation_id: conversationId, message, language, surface },
    handlers
  )
}

export function streamProactive(
  trigger: string,
  language: string,
  handlers: CoachStreamHandlers,
  conversationId: string = 'default',
  surface: CoachSurfaceContext = { screen: 'unknown' }
): Promise<void> {
  return streamAgent(
    '/api/agent/coach/proactive',
    { conversation_id: conversationId, trigger, language, surface },
    handlers
  )
}

export type CoachSupportMode = 'hint' | 'explanation'

export function streamCoachSupport(
  support: CoachSupportMode,
  language: string,
  handlers: CoachStreamHandlers,
  conversationId: string = 'default',
  surface: CoachSurfaceContext = { screen: 'learning_lesson' }
): Promise<void> {
  return streamAgent(
    '/api/agent/coach/support',
    { conversation_id: conversationId, support, language, surface },
    handlers
  )
}

export function listCoachConversations(
  cursor?: string | null,
  limit: number = 12
): Promise<CoachConversationPage> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  return apiGet<CoachConversationPage>(
    `/api/agent/coach/conversations?${params}`,
    { cache: 'no-store' }
  )
}

export function createCoachConversation(
  surface: CoachSurfaceContext = { screen: 'unknown' }
): Promise<CoachConversation> {
  return apiPost<CoachConversation>('/api/agent/coach/conversations', {
    unit_id: surface.unit_id,
    component_id: surface.component_id,
  })
}

export function listCoachMessages(
  conversationId: string,
  cursor?: string | null,
  limit: number = 20
): Promise<CoachMessagePage> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  return apiGet<CoachMessagePage>(
    `/api/agent/coach/conversations/${encodeURIComponent(conversationId)}/messages?${params}`,
    { cache: 'no-store' }
  )
}

export function deleteCoachConversation(
  conversationId: string
): Promise<{ ok: true }> {
  return apiDelete<{ ok: true }>(
    `/api/agent/coach/conversations/${encodeURIComponent(conversationId)}`
  )
}

export interface Trigger {
  type: 'idle' | 'misconception' | 'slow_progress' | 'success' | '_heartbeat'
  objective_id?: string | null
  misconception?: string | null
  elapsed_seconds?: number | null
  timing_quality?: 'elapsed_between_events' | 'unavailable'
}

export interface NextRouteDecision {
  subject: string | null
  objective_id: string | null
  component: { id: string } | null
  explanation: string
}

/** Commit the deterministic next route after the learner explicitly starts it. */
export function selectNextRoute(
  language: string
): Promise<NextRouteDecision> {
  return apiPost<NextRouteDecision>('/api/agent/route/next', {
    language,
  })
}

/** Subscribe to proactive triggers via SSE (EventSource). Returns a closer. */
export function subscribeTriggers(
  onTrigger: (t: Trigger) => void
): () => void {
  // Same-origin through the Vite proxy today, but be explicit: the SSE stream
  // is session-scoped and must carry the auth cookie.
  const source = new EventSource('/api/agent/triggers/subscribe', { withCredentials: true })
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
export function reportIdle(objectiveId?: string): void {
  void fetch('/api/agent/triggers/idle', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective_id: objectiveId }),
  }).catch(() => {})
}
