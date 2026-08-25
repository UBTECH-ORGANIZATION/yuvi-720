/* Coach stream client (F3). SSE from `/api/agent/coach/stream`: the first event
   carries the AI-use `disclosure`, then `text` chunks, then `[DONE]`. Reads/writes
   only through the backend — no `localStorage`. */

import { apiDelete, apiGet, apiPost } from './api'
import { subscribe as subscribeStream } from './realtime'

/** Solved label positions, in renderer CANVAS units (x -7.1..7.1, y -4..4).
 *  Produced by the backend's visual_layout solver and shared by every
 *  renderer, so a still and its animated twin place labels identically.
 *  Keys are slots: 'label', 'position', 'labels:0', 'side_labels:2', ... */
export type CoachVisualLayout = Record<string, [number, number]>

export interface CoachVisualElement {
  type: string
  layout?: CoachVisualLayout
  /** Molecule elements only. All four are produced by RDKit on the backend —
   *  the planner emits nothing but a SMILES string, so none of these are the
   *  model's assertions. `highlight` is atom indices, already resolved from a
   *  substructure pattern. */
  smiles?: string
  formula?: string
  mass?: number
  highlight?: number[]
  [key: string]: unknown
}

export interface CoachVisualScene {
  use_visual: true
  /** Discriminates the element vocabulary. Absent on scenes stored before
   *  the field existed — treat a missing value as 'geometry'. */
  render?: 'geometry' | 'molecule'
  animated?: boolean
  title: string
  alt: string
  caption: string
  elements: CoachVisualElement[]
  /** The renderer transform, solved once on the backend and published so every
   *  renderer draws shapes in the same space its labels were solved in.
   *  `space: 'data'` means element coords are axis data coords (the frontend
   *  uses the axes' own viewbox); `'canvas'` means they need this fit applied. */
  canvas?: {
    scale_x: number
    scale_y: number
    offset_x: number
    offset_y: number
    space: 'data' | 'canvas'
  }
  /** The region the scene actually occupies, `[x0, y0, x1, y1]` in canvas
   *  units, solved by the backend (it is the only place that knows every label
   *  box). A renderer crops to this so a small preview spends its pixels on the
   *  drawing rather than on the empty parts of a 14.2x8 frame. */
  content?: [number, number, number, number]
  /** Planner-chosen drag handles. Purely additive: a renderer that ignores
   *  this still draws a correct static picture. A handle references a `point`
   *  element, or a `polygon` vertex by index — never geometry of its own. */
  interactive?: {
    handles: Array<{ element: number; vertex?: number }>
  }
  layout_version?: number
}

export interface CoachVisual {
  id: string
  /** 'scene' renders in the browser from `scene`; 'image'/'video' are
   *  server-rendered and only exist for the Manim video path and for
   *  conversation history stored before client rendering existed. */
  type: 'image' | 'video' | 'scene'
  mime_type: 'image/png' | 'image/svg+xml' | 'video/mp4'
  /** Always present. For type 'scene' this is the deterministic SVG fallback,
   *  used when the client renderer cannot draw the scene. */
  data_url: string
  title: string
  alt: string
  caption: string
  renderer: 'manim' | 'svg-fallback' | 'mafs' | 'molecule' | 'svg-diagram'
  scene: CoachVisualScene
}

export interface CoachVisualStatus {
  /** planning: a visual was chosen and is being planned (show the loader
   *  before the message looks finished); rendering: scene is being drawn;
   *  none: no visual after all — clear the loader. */
  status: 'planning' | 'rendering' | 'none'
  textBefore?: string
  textAfter?: string
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
  /** The question this message belongs to (component|item|question); lets the
   *  companion scope the visible thread per question and restore it on resume. */
  question_key?: string | null
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
  /** LLM decided whether to offer the on-demand "video / image" buttons. */
  onCanVisualize?: (canVisualize: boolean) => void
  /** Every parsed frame, verbatim. For streams whose payload is not the coach's
   *  — the teacher assistant sends a tool trace and a thread title down the same
   *  pipe, and re-implementing SSE parsing to read two extra fields would be
   *  two watchdogs and two buffer loops to keep in sync instead of one. */
  onEvent?: (payload: Record<string, unknown>) => void
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
  /** Presence-only: a dual-role account standing on the teaching side.
   *  Never produced by `coachSurfaceForPath` — the coach context does not
   *  describe teacher screens. */
  | 'teacher_app'
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

/** The child asks for a person (#249 raise-hand). Recipients are resolved
 *  server-side from the roster — the client cannot address a teacher of its
 *  own choosing. `notified: 0` is an answer, not an error: a learner in no
 *  staffed group, and the UI must say "we could not reach a teacher" rather
 *  than promise help that is not coming. */
export function postCoachHandoff(payload: {
  reason: string
  objective_id?: string
  component_id?: string
}) {
  return apiPost<{ notified: number }>('/api/agent/coach/handoff', payload)
}

/** The child takes their hand down (#450). Self-scoped server-side; resolves
 *  only `coach_handoff` alerts — a safety escalation survives this by design. */
export function cancelCoachHandoff() {
  return apiPost<{ resolved: number }>('/api/agent/coach/handoff/cancel', {})
}

/** Server truth for the raised-hand glow — a reload must not lower it. */
export function getCoachHandoffState() {
  return apiGet<{ raised: boolean; since: string | null }>('/api/agent/coach/handoff/state')
}

/** Tell presence where this client is, for the teacher's live view.
 *  Fire-and-forget: a lost report costs one stale row until the next
 *  navigation, and the server dedupes repeats, so there is nothing to retry. */
export function reportCoachSurface(surface: CoachSurfaceContext): void {
  void apiPost('/api/agent/presence/surface', { ...surface }).catch(() => undefined)
}

export async function streamAgent(
  path: string,
  body: Record<string, unknown>,
  handlers: CoachStreamHandlers,
  // Safety net for a stalled stream: if the server sends NOTHING for this long
  // (e.g. it hangs after the last token, before `[DONE]`), cancel the reader so
  // the caller's `finally` runs and the panel never freezes. Off by default —
  // only text-only streams (proactive/intro) opt in; the main coach stream can
  // render a visual inline with a legitimately long silent gap.
  inactivityMs?: number
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

  let watchdog: ReturnType<typeof setTimeout> | undefined
  const armWatchdog = () => {
    if (!inactivityMs) return
    if (watchdog) clearTimeout(watchdog)
    // cancel() makes the pending read() resolve done → loop breaks cleanly.
    watchdog = setTimeout(() => { void reader.cancel() }, inactivityMs)
  }

  try {
    armWatchdog()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      armWatchdog()
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
            visual_status?: 'planning' | 'rendering' | 'none'
            text_before?: string
            text_after?: string
            visual?: CoachVisual
            can_visualize?: boolean
            phase?: 'thinking' | 'speaking'
          }
          handlers.onEvent?.(parsed as Record<string, unknown>)
          if (parsed.disclosure) handlers.onDisclosure?.(parsed.disclosure)
          if (parsed.text) {
            handlers.onPhase?.('speaking')
            handlers.onText(parsed.text)
          }
          if (parsed.phase) handlers.onPhase?.(parsed.phase)
          if (parsed.visual_status) {
            handlers.onVisualStatus?.({
              status: parsed.visual_status,
              textBefore: parsed.text_before,
              textAfter: parsed.text_after,
            })
          }
          if (parsed.visual) handlers.onVisual?.(parsed.visual)
          if (typeof parsed.can_visualize === 'boolean') handlers.onCanVisualize?.(parsed.can_visualize)
        } catch {
          continue
        }
      }
    }
  } finally {
    if (watchdog) clearTimeout(watchdog)
  }
}

export interface CompetencyChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export type VisualMode = 'image' | 'video'

/** On-demand visual: the learner asked to see a text-only reply as an image or
 * a short animation. Returns the rendered visual, or null when none could be
 * built. Rendering can take ~15–90s (planner + manim + encode). */
export async function requestVisualization(
  userMessage: string,
  assistantText: string,
  mode: VisualMode,
  language: string,
  conversationId: string = 'default'
): Promise<CoachVisual | null> {
  const result = await apiPost<{ visual: CoachVisual | null }>('/api/agent/visualize', {
    user_message: userMessage,
    assistant_text: assistantText,
    mode,
    language,
    conversation_id: conversationId,
  })
  return result.visual ?? null
}

/** Why did one activeness domain move since the learner last opened the map?
 * Returns a short verbal, non-numeric blurb (or null when none could be built). */
export async function explainActivenessChange(
  competency: string,
  direction: 'up' | 'down',
  language: string,
): Promise<string | null> {
  const result = await apiPost<{ text: string | null }>('/api/agent/activeness/change-explain', {
    competency,
    direction,
    language,
  })
  return result.text ?? null
}

/** Ephemeral learning-map topic chat: the transcript lives only in the client
 * (never saved to conversation history); memory capture still runs server-side. */
export function streamCompetencyChat(
  competency: string,
  messages: CompetencyChatMessage[],
  conversationId: string,
  language: string,
  handlers: CoachStreamHandlers
): Promise<void> {
  return streamAgent('/api/agent/competency-chat', {
    competency,
    messages,
    conversation_id: conversationId,
    language,
  }, handlers)
}

/** Silence that means a learner-facing stream has died rather than paused. The
 * inline visual render is the long legitimate gap (planner + manim + encode), so
 * this sits well beyond it: crossing it means nothing is coming. */
const STREAM_STALL_MS = 120_000

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
    handlers,
    STREAM_STALL_MS,
  )
}

export function streamProactive(
  trigger: string,
  language: string,
  handlers: CoachStreamHandlers,
  conversationId: string = 'default',
  surface: CoachSurfaceContext = { screen: 'unknown' },
  /** The question this nudge is ABOUT. Kata advances the screen the moment an
   *  answer lands, so without this the server composes the praise from the NEXT
   *  question's content — describing something the learner has not seen yet. */
  questionKey?: string | null,
): Promise<void> {
  return streamAgent(
    '/api/agent/coach/proactive',
    { conversation_id: conversationId, trigger, language, surface, question_key: questionKey || null },
    handlers,
    // Proactive nudges and question intros are a few short sentences of text —
    // no inline visual render, so tokens arrive within ~1s of each other. If the
    // server goes silent for 20s the stream has stalled (e.g. it hung persisting
    // the turn before `[DONE]` — a transient DB blip blocks on the driver's ~30s
    // server-selection timeout); cancel so the panel's `isStreaming` gate is
    // released instead of freezing the whole chat behind it.
    20000
  )
}

export type CoachSupportMode = 'hint' | 'explanation'

/** One-shot hint/explanation availability for the question the learner is on.
 * `question_key` changes when the learner progresses, re-arming the buttons. */
export interface CoachSupportState {
  question_key: string
  hint_used: boolean
  explanation_used: boolean
  /** `item|question` (and bare `item`) → its 1-based question number in this
   * component, from the catalog. Lets the chat title a thread with the number
   * the learner sees. Absent when the catalog has no snapshot. */
  question_ordinals?: Record<string, number>
  /** `item|question` → its 1-based סעיף index, only for shared screens. */
  question_parts?: Record<string, number>
  /** Screens that teach without asking anything — captioned as a step, never
   * as "question N". */
  teaching_items?: string[]
  /** Every screen of the component with its kind, in learner order. A component
   * is a sequence of פריטים and only some of them ask something — this is how
   * the chat knows a screen is a video or a reading rather than a question. */
  items?: LessonItemProfile[]
  question_total?: number
}

/** `question` asks something; `watch` is video/audio/animation; `read` is
 * text/image/presentation; `step` is anything else that teaches (simulation…). */
export type LessonItemKind = 'question' | 'watch' | 'read' | 'step'

export interface LessonItemProfile {
  id: string
  kind: LessonItemKind
  media_format?: string
  content_type?: string
  question_count?: number
}

export function getCoachSupportState(
  componentId?: string | null,
  signal?: AbortSignal
): Promise<CoachSupportState> {
  const params = new URLSearchParams()
  if (componentId) params.set('component_id', componentId)
  const query = params.toString()
  return apiGet<CoachSupportState>(
    `/api/agent/coach/support/state${query ? `?${query}` : ''}`,
    { cache: 'no-store', signal }
  )
}

/** Learner rates the coach conversation (MoE `conversation/rated`). */
export function rateCoachConversation(
  conversationId: string,
  rating: 'like' | 'dislike'
): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/api/agent/coach/rate', {
    conversation_id: conversationId,
    rating,
  })
}

/** The help affordances a learner can self-attribute after solving a question. */
export type HelpMethod = 'hint' | 'explanation' | 'yuvi_chat'

/** Persist the learner's answer to "what helped you understand this?" for a
 *  solved question. Latest set wins server-side; safe to call on every toggle. */
export function saveHelpedAttribution(payload: {
  component_id?: string | null
  item_id?: string | null
  question_id?: string | null
  methods: HelpMethod[]
}): Promise<{ methods: HelpMethod[] }> {
  return apiPost<{ methods: HelpMethod[] }>('/api/agent/coach/helped', payload)
}

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
    handlers,
    // ONE worker owns Yuvi's voice, so a stream that never ends never ends the
    // queue either: every intro, nudge and reaction behind it is stranded, and
    // the panel looks like it has forgotten where the learner is. A hint or
    // explanation can legitimately pause while a visual renders, so this is
    // generous — it is a deadlock breaker, not a latency budget.
    STREAM_STALL_MS,
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

export interface TriggerAlternative {
  component_id: string
  unit_id?: string | null
  title?: string | null
  media_format?: string | null
}

export interface Trigger {
  type:
    | 'idle' | 'misconception' | 'mistake' | 'slow_progress' | 'success'
    | 'rapid_guessing' | 'wheel_spinning' | 'completion' | 'screen_change'
    // A teacher sent praise. The frame says only that one exists — the words
    // are fetched from the store, so nothing on the wire can forge them.
    | 'kudos'
    | '_heartbeat'
  /** 720 misconception response: a same-objective component in a different
   *  representation the learner can switch to (video instead of text, …). */
  alternative?: TriggerAlternative
  objective_id?: string | null
  /** `completion` only: the component that just finished (720 §"Completed") —
   *  a UI state signal to finalize the lesson without polling the catalog. */
  component_id?: string | null
  unit_id?: string | null
  /** `screen_change` only: the question key (`component|item`) the learner is now
   *  on. Pushed the instant an ingested xAPI event advances current_state, so the
   *  companion re-keys immediately instead of waiting for its support-state poll. */
  question_key?: string | null
  misconception?: string | null
  elapsed_seconds?: number | null
  timing_quality?: 'elapsed_between_events' | 'unavailable'
}

export interface NextRouteDecision {
  subject: string | null
  objective_id: string | null
  component: { id: string; unit_id?: string | null } | null
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

/** One slide of a generated per-question explainer ("learn it another way"). */
export interface ExplainerSlide {
  title: string
  body: string
  visual?: CoachVisual
}

export interface ExplainerDeck {
  question_key: string
  locale: string
  slides: ExplainerSlide[]
  created_at: string
}

export interface ExplainerResponse {
  status: 'ready' | 'generating' | 'unavailable'
  deck?: ExplainerDeck
}

/** Fetch (or start generating) the current question's explainer. Cached across
 *  all learners by question, so poll this until `status === 'ready'`. */
export function getQuestionExplainer(
  componentId: string | null,
  language: string,
  first = false,
): Promise<ExplainerResponse> {
  return apiPost<ExplainerResponse>('/api/agent/coach/explainer', {
    component_id: componentId,
    language,
    first,
  })
}

/** Subscribe to proactive triggers via SSE (EventSource). Returns a closer.
 *  `onOpen` fires on the initial connect AND on every native auto-reconnect —
 *  the caller re-syncs support state on it, since triggers published during a
 *  reconnect gap are not replayed by the server. */
export function subscribeTriggers(
  onTrigger: (t: Trigger) => void,
  onOpen?: () => void
): () => void {
  // Rides the shared multiplexer so the learner page spends one connection, not
  // one per feature. Behaviour is unchanged: heartbeats and malformed frames are
  // filtered inside `realtime.subscribe`.
  const unsubscribe = subscribeStream(
    'learner-triggers',
    () => '/api/agent/triggers/subscribe',
    (frame) => onTrigger(frame as unknown as Trigger)
  )
  // `onOpen` used to fire on the EventSource's own open event. With a shared
  // connection a late subscriber would never see one, so it fires on the next
  // tick instead — the callers use it to mark "the push channel is live", which
  // is true either way.
  if (onOpen) queueMicrotask(onOpen)
  return unsubscribe
}

/* ── Post-lesson personalized reflection (F4) ─────────────────────────────── */

export interface ReflectionQuestion {
  number: number
  kind: 'rating' | 'open'
  text: string
  min?: number
  max?: number
}

export interface ReflectionStart {
  reflection_id: string
  questions: ReflectionQuestion[]
}

export function startReflection(
  componentId: string | null,
  sessionId: string | null,
  language: string
): Promise<ReflectionStart> {
  return apiPost<ReflectionStart>('/api/agent/reflection/start', {
    component_id: componentId,
    session_id: sessionId,
    language,
  })
}

export function answerReflection(
  reflectionId: string,
  questionNumber: number,
  payload: { answer?: string; rating?: number }
): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/api/agent/reflection/${reflectionId}/answer`, {
    question_number: questionNumber,
    ...payload,
  })
}

export function skipReflection(
  reflectionId: string,
  questionNumber: number
): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/api/agent/reflection/${reflectionId}/skip`, {
    question_number: questionNumber,
  })
}

export function completeReflection(reflectionId: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/api/agent/reflection/${reflectionId}/complete`, {})
}


/* ── teacher praise (A11 #4) ───────────────────────────────────────────────
 * A מילה טובה is a card in the chat, not a coach turn: it carries the
 * teacher's own sentence, and it stays until the child acknowledges it. The
 * client can read its own kudos and mark it read; it can never write one.
 */
export interface PendingKudos {
  id: string
  message: string
  created_at: string | null
  teacher_name: string | null
}

export function getPendingKudos() {
  return apiGet<{ kudos: PendingKudos | null }>('/api/me/kudos/pending')
}

export function acknowledgeKudos(kudosId: string) {
  return apiPost<{ acknowledged: boolean; id: string }>(
    `/api/me/kudos/${encodeURIComponent(kudosId)}/ack`, {})
}
