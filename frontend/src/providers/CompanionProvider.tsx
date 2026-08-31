import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  acknowledgeKudos,
  createCoachConversation,
  AgentStreamError,
  coachSurfaceForPath,
  deleteCoachConversation,
  getCoachSupportState,
  getPendingKudos,
  listCoachConversations,
  listCoachMessages,
  reportCoachSurface,
  streamCoach,
  streamCoachSupport,
  streamProactive,
  subscribeTriggers,
  requestVisualization,
  saveHelpedAttribution,
  type CoachConversation,
  type CoachActionOffer,
  type CoachHistoryMessage,
  type CoachPointerFrame,
  type CoachToolTraceStep,
  type CoachVisual,
  type CoachSupportMode,
  type HelpMethod,
  type LessonItemKind,
  type PendingKudos,
  type TriggerAlternative,
  type VisualMode,
} from '../services/agents'
import { useI18n } from '../i18n/I18nProvider'
import { useRoute } from '../app/router'
import { pointerMatchesKey } from '../services/pointer'
import { useAuth } from './AuthProvider'
import { useRewards } from './RewardsProvider'

/* CompanionProvider — owns Yuvi's live state and paginated server history (F3).
   The prompt window and full transcript remain in Mongo/Cosmos; no localStorage. */

export interface CoachMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  textAfter?: string
  visual?: CoachVisual
  isVisualizing?: boolean
  /** Set when an on-demand visual request returned nothing renderable. */
  visualFailed?: boolean
  /** LLM decided this reply is explanatory → offer the on-demand visual buttons. */
  canVisualize?: boolean
  /** Server-validated navigation offers attached to this assistant reply. */
  actions?: CoachActionOffer[]
  /** In-memory development trace, available only for the active streamed reply. */
  toolTrace?: CoachToolTraceStep[]
  isComplete: boolean
  createdAt?: string
  /** The question (component|item|question) this message belongs to, so the
   *  panel can scope the thread per question. Null = untagged (always shown). */
  questionKey?: string | null
  /** Server-classified intent of the learner request that produced this turn. */
  queryIntent?: string | null
  /** Epoch ms at creation / completion — drive the visibility grace window so a
   *  reaction stays readable for a few seconds even after Kata auto-advances the
   *  screen out from under it (replaces the old `sticky` flag). */
  createdAtMs?: number
  completedAtMs?: number
  /** Success nudges only: the help methods the learner actually used on this
   *  question, offered as "what helped you?" chips. Absent = no reflection UI. */
  attribution?: { methods: HelpMethod[]; questionKey: string | null }
}

interface LessonLaunch {
  sessionId: string
  unitId: string
  componentId: string
}

/** A single queued turn of Yuvi's voice. The worker plays these one at a time. */
export type ChatActionKind = 'user-message' | 'support' | 'intro' | 'nudge' | 'welcome'
export interface ChatAction {
  kind: ChatActionKind
  /** nudge only — the trigger type (`mistake` | `idle` | `success` | …). */
  trigger?: string
  /** user-message only. */
  text?: string
  /** support only. */
  support?: CoachSupportMode
  /** The screen the learner was on when this was enqueued (staleness anchor). */
  targetQuestionKey: string | null
  enqueuedAt: number
  activitySeq: number
  /** How many screens the learner had visited when this was enqueued. An answer
   *  reaction survives ONE advance (Kata moves the screen for them); two screens
   *  on, it is a comment about a question they have left behind. */
  screenSeq: number
  /** Delivery attempts so far — a learner-initiated turn retries, chatter doesn't. */
  attempts?: number
  /** Set by the worker for this run: aborts the stream if the screen moves on. */
  signal?: AbortSignal
}

/** Kinds the LEARNER asked for. These are never dropped for staleness and are
 * retried on a transport failure: the child is waiting for an answer. Proactive
 * chatter (intro/nudge/welcome) is the opposite — worthless once the moment it
 * was written for has passed. */
const LEARNER_INITIATED: ReadonlySet<ChatActionKind> = new Set(['user-message', 'support'])

/** Nudges about the learner's PRESENT moment on a screen. Once they navigate,
 * the moment is gone and the message would arrive as a comment on a question
 * they are no longer looking at. */
const MOMENT_TRIGGERS = new Set(['idle', 'slow_progress', 'wheel_spinning'])

/** True when this turn stops being true the instant the learner changes screen.
 *
 * Answer-evidence nudges (success / mistake / misconception) deliberately do NOT
 * qualify: Kata auto-advances right after an answer, so they are ALWAYS about the
 * previous screen. Dropping those would delete the praise a learner just earned —
 * the grace window exists precisely to keep them readable across that advance. */
function diesWithScreen(action: ChatAction): boolean {
  if (LEARNER_INITIATED.has(action.kind)) return false
  if (action.kind === 'nudge') return MOMENT_TRIGGERS.has(action.trigger || '')
  return action.kind === 'intro' || action.kind === 'welcome'
}
/** One retry, after a short pause. Enough to ride out a dropped connection or a
 * backend restart without turning a real outage into an infinite loop. */
const RETRY_LIMIT = 1
const RETRY_DELAY_MS = 900

const TOOL_TRACE_STATUSES = new Set<CoachToolTraceStep['status']>([
  'ok', 'skipped', 'blocked', 'error',
])
const TOOL_TRACE_SOURCES = new Set<CoachToolTraceStep['source']>(['system', 'agent'])

function parseToolTrace(value: unknown): CoachToolTraceStep[] | null {
  if (!Array.isArray(value) || value.length > 24) return null
  const steps: CoachToolTraceStep[] = []
  for (const step of value) {
    if (!step || typeof step !== 'object') return null
    const { name, status, source } = step as Record<string, unknown>
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_:.]{0,79}$/.test(name)) return null
    if (typeof status !== 'string' || !TOOL_TRACE_STATUSES.has(status as CoachToolTraceStep['status'])) return null
    if (source !== undefined && (typeof source !== 'string' || !TOOL_TRACE_SOURCES.has(source as CoachToolTraceStep['source']))) return null
    steps.push({
      name,
      status: status as CoachToolTraceStep['status'],
      source: source as CoachToolTraceStep['source'] ?? 'system',
    })
  }
  return steps
}

/** Hard ceiling on ONE turn before the worker takes the queue back. Above any
 * real turn including an inline visual render, so it only ever fires on a turn
 * that is not coming back. */
const ACTION_DEADLINE_MS = 150_000

/** Run a learner-initiated stream, retrying once if it fails before producing a
 * single token. A child who asked a question should not be answered with "…"
 * because one request lost its connection. A stream that already started
 * printing is never restarted — that would replay half an answer. */
async function streamWithRetry(run: () => Promise<void>, hasOutput: () => boolean) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await run()
      return
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      if (aborted || hasOutput() || attempt >= RETRY_LIMIT) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}

export type CompanionActivity = 'idle' | 'thinking' | 'speaking'

interface VideoSupportUsed {
  summary: boolean
  visual: boolean
}

interface CompanionContextValue {
  isOpen: boolean
  isOpening: boolean
  isClosing: boolean
  panelWidth: number
  setPanelWidth: (width: number) => void
  open: () => void
  finishOpening: () => void
  close: () => void
  toggle: () => void
  messages: CoachMessage[]
  conversations: CoachConversation[]
  activeConversationId: string | null
  isStreaming: boolean
  activeAssistantId: string | null
  activity: CompanionActivity
  unreadCount: number
  preview: string | null
  disclosure: string | null
  isLoadingConversations: boolean
  isLoadingMessages: boolean
  hasMoreConversations: boolean
  hasMoreMessages: boolean
  historyError: boolean
  canStartNewConversation: boolean
  send: (text: string) => Promise<void>
  requestSupport: (support: CoachSupportMode) => Promise<void>
  /** Support used on the active question. Hints remain available through the
   *  server-approved ladder; explanation is one-shot. */
  supportUsed: {
    hint: boolean
    contentHint: boolean
    hintLevel: number
    maxHintLevel: number
    explanation: boolean
    videoSummary: boolean
    videoVisual: boolean
  }
  /** Screen id → the question number the learner sees for it, from the catalog.
   *  The chat titles each question thread from this, so the heading matches the
   *  lesson instead of counting sections on screen. */
  questionOrdinals: Record<string, number>
  /** `item|question` → its 1-based סעיף index, for the screens that hold more
   *  than one question. Empty for single-question screens: naming a part the
   *  learner cannot see on screen would invent structure. */
  questionParts: Record<string, number>
  /** Screens that teach without asking — their threads are captioned as a
   *  learning step rather than given a question number they do not have. */
  teachingItems: string[]
  /** Screen id → what that screen IS (`question` / `watch` / `read` / `step`).
   *  Drives both the thread caption and which kind of turn Yuvi opens on
   *  arrival — a video screen gets a watch invitation, not a question intro. */
  itemKinds: Record<string, LessonItemKind>
  /** Screen id → its `mediaFormat`. A screen can ASK and still carry a video
   *  (`…-01-01-003` is a video playlist ending in a question), and the thread
   *  says so instead of looking like a plain question. */
  itemMedia: Record<string, string>
  /** Screen id → its position in the lesson's own spine. The chat orders its
   *  sections by THIS, so paging back to question 1 after question 2 files the
   *  thread where the lesson puts it — not at the bottom, where visit order
   *  would drop it. Empty when the catalog has no snapshot; encounter order
   *  then stands. */
  itemOrder: Record<string, number>
  /** The question the learner is on RIGHT NOW (`component|item|question`), which
   *  moves backwards too when they page back in the iframe. The chat marks and
   *  opens the matching thread from this rather than assuming it is the last. */
  currentQuestionKey: string | null
  /** True when the learner is on a real question screen (not the iframe's
   *  intro/cover). Used to suppress the generic greeting there — the
   *  per-question intro carries the welcome instead. */
  onQuestionFrame: boolean
  /** A מילה טובה from a teacher, waiting to be read. Shown as a card inside the
   *  chat — the teacher's own words, not Yuvi's paraphrase — and it stays until
   *  the child acknowledges it. */
  pendingKudos: PendingKudos | null
  acknowledgeKudos: () => Promise<void>
  /** 720 misconception response: a different-representation component the learner
   *  can switch to, offered after a repeated misconception (null when none). */
  pendingAlternative: TriggerAlternative | null
  openExplainer: () => void
  closeExplainer: () => void
  explainerOpen: boolean
  dismissAlternative: () => void
  requestVisual: (messageId: string, mode: VisualMode) => Promise<void>
  selectConversation: (conversationId: string) => Promise<void>
  startNewConversation: () => Promise<void>
  deleteConversation: (conversationId: string) => Promise<boolean>
  loadMoreConversations: () => Promise<void>
  loadMoreMessages: () => Promise<void>
  reloadHistory: () => Promise<void>
}

const CompanionContext = createContext<CompanionContextValue | null>(null)
// CSS completes the flight/pull/dock sequence in 1.45s. Keep the travelling
// Yuvi mounted for one final painted frame before handing off to the header.
const COMPANION_OPENING_MS = 1500
// The return flight and panel exit run together for 1.45s. Keep both surfaces
// mounted through the final frame so Yuvi reaches the restored orbit cleanly.
const COMPANION_CLOSING_MS = 1500

function historyMessage(message: CoachHistoryMessage): CoachMessage {
  return {
    // Persisted turns retain their original client-generated `live-` ids.
    // Prefix them on reload so the lesson panel never mistakes old transcript
    // rows for messages streamed during the current launch.
    id: `history-${message.id}`,
    role: message.role,
    text: message.text,
    textAfter: message.text_after || undefined,
    visual: message.visual,
    actions: message.meta?.actions,
    isComplete: true,
    createdAt: message.at,
    questionKey: message.question_key ?? null,
    queryIntent: message.query_intent ?? null,
  }
}

function mergeUnique<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !seen.has(item.id))]
}

// A question key is `component|item|question`. One SCREEN (item) can host several
// sub-questions (…/q1, …/q2 — e.g. סעיף א/ב) that differ only by the question
// field, so intro de-dup is question-aware, not just per screen.
// Yuvi's "look here" directive travels to the lesson page over the yuvilab
// event channel (the two live under different ancestors — see LessonPage's
// listener). Null = clear whatever is showing. A pointer for a screen the
// learner already left is dropped here, before it can ever render.
function broadcastPointer(detail: CoachPointerFrame | null, currentKey?: string | null) {
  if (detail && !pointerMatchesKey(detail.question_key, currentKey ?? null)) return
  window.dispatchEvent(new CustomEvent('yuvilab:coach-point', { detail }))
}

function introParts(key: string | null | undefined): { item: string; question: string } {
  const parts = (key || '').split('|')
  // A question id stored as a full object URL (Kata mixed both id spaces in one
  // catalog array) names the same question as its bare tail — treat them as one,
  // or the same screen gets introduced twice.
  const raw = parts[2] || ''
  const question = raw.includes('/') ? raw.replace(/\/+$/, '').split('/').pop() || raw : raw
  return { item: parts[1] || '', question }
}
// Kata reuses one catalog item for every clip in an embedded playlist. The
// backend generation advances on provider clip-boundary events, so support used
// for clip 1 does not consume the one-time affordances for clip 2.
function videoItemKey(item: string, generation: number): string {
  return `${item}#${generation}`
}
function itemHasAnyQuestionIntro(introducedQuestions: Set<string>, item: string): boolean {
  const prefix = `${item}|`
  for (const k of introducedQuestions) if (k.startsWith(prefix)) return true
  return false
}
// Whether a screen/question deserves a fresh intro. The arrival (question='')
// intro grounds on the screen's FIRST question, so the first specific question to
// land afterwards is already 'covered'; a SUBSEQUENT sub-question (q2) is 'new'.
function introDisposition(
  item: string,
  question: string,
  introducedItems: Set<string>,
  introducedQuestions: Set<string>,
): 'new' | 'covered' | 'done' {
  if (!question) return introducedItems.has(item) ? 'done' : 'new'
  if (introducedQuestions.has(`${item}|${question}`)) return 'done'
  if (introducedItems.has(item) && !itemHasAnyQuestionIntro(introducedQuestions, item)) return 'covered'
  return 'new'
}

export function CompanionProvider({ children }: { children: ReactNode }) {
  const { language } = useI18n()
  const { user } = useAuth()
  const { refresh: refreshRewards } = useRewards()
  const pathname = useRoute()
  const surface = useMemo(() => coachSurfaceForPath(pathname), [pathname])
  // Tell presence where this client is, for the teacher's live view. Keyed on
  // the SCREEN, not the pathname: moving between questions inside one lesson
  // is not a move the live view renders, so it must not cost a report. The
  // 500ms debounce collapses redirect chains into one send. Gated on HOLDING
  // the learner role — not on lacking the teacher one: gal and moti wear both
  // hats, and the teacher-negative gate left their learner tabs reading
  // "location unknown" on the live board. An account with no learner role has
  // no presence row for a report to land on anyway.
  // Teacher routes are outside `coachSurfaceForPath` (the coach never
  // describes them), but presence still deserves better than "unknown" when a
  // dual-role account stands on the teaching side.
  const surfaceScreen = pathname.startsWith('/teacher') ? 'teacher_app' : surface.screen
  const isLearner = Boolean(user?.roles.includes('learner'))
  useEffect(() => {
    if (!isLearner) return
    const handle = window.setTimeout(
      () => reportCoachSurface(surfaceScreen === 'teacher_app'
        ? { screen: 'teacher_app' }
        : coachSurfaceForPath(pathname)), 500)
    return () => window.clearTimeout(handle)
    // `pathname` is read, not depended on: the freshest ids ride along when the
    // screen changes, but a same-screen navigation does not re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLearner, surfaceScreen])
  // Being on a lesson ROUTE is not enough to run the lesson machinery: a tab
  // whose session has expired still matches the route, and every lesson-scoped
  // effect here calls a learner-only endpoint. A stale tab left open therefore
  // sat on the login screen polling `support/state` every 2.5s forever, taking
  // a 401 each time — for as long as the tab existed.
  const activityScoped = Boolean(user)
    && surface.screen === 'learning_lesson'
    && Boolean(surface.unit_id && surface.component_id)
  const [lessonLaunch, setLessonLaunch] = useState<LessonLaunch | null>(null)
  // Updated synchronously in the launch event so an older async turn can be
  // rejected before React has had a chance to render the new state.
  const lessonLaunchRef = useRef<LessonLaunch | null>(null)
  const lessonLaunchReady = activityScoped
    && lessonLaunch?.unitId === surface.unit_id
    && lessonLaunch?.componentId === surface.component_id
  const conversationMode = activityScoped ? 'lesson_coach' : 'general_companion'
  const [isOpen, setIsOpen] = useState(false)
  const [isOpening, setIsOpening] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  /* Teacher praise waiting to be read. Held here rather than in the chat panel
     because it must survive the panel being closed and re-opened — the child
     has not seen it until they say they have. */
  const [pendingKudos, setPendingKudos] = useState<PendingKudos | null>(null)
  const loadKudosRef = useRef<((options?: { open?: boolean }) => void) | null>(null)
  const [panelWidth, setPanelWidth] = useState(430)
  const [messages, setMessages] = useState<CoachMessage[]>([])
  // Latest messages for handlers that must read them without being re-created.
  const messagesRef = useRef<CoachMessage[]>([])
  const [conversations, setConversations] = useState<CoachConversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [conversationCursor, setConversationCursor] = useState<string | null>(null)
  const [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [hasMoreConversations, setHasMoreConversations] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [isLoadingConversations, setIsLoadingConversations] = useState(true)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null)
  const [activity, setActivity] = useState<CompanionActivity>('idle')
  const [unreadCount, setUnreadCount] = useState(0)
  const [disclosure, setDisclosure] = useState<string | null>(null)
  const [supportUsed, setSupportUsed] = useState({
    hint: false, contentHint: false, hintLevel: 0, maxHintLevel: 1, explanation: false,
  })
  // Video support is a one-time affordance for each catalog item during this
  // browser visit. A component may contain several videos, so component id is
  // too broad a key; `question_key` supplies the current item id.
  const [videoSupportByItem, setVideoSupportByItem] = useState<Record<string, VideoSupportUsed>>({})
  const [questionOrdinals, setQuestionOrdinals] = useState<Record<string, number>>({})
  const [questionParts, setQuestionParts] = useState<Record<string, number>>({})
  const [teachingItems, setTeachingItems] = useState<string[]>([])
  const [itemKinds, setItemKinds] = useState<Record<string, LessonItemKind>>({})
  const [itemMedia, setItemMedia] = useState<Record<string, string>>({})
  const [itemOrder, setItemOrder] = useState<Record<string, number>>({})
  // The worker reads the kinds at dequeue (a screen can change while an intro
  // waits its turn), so they live in a ref as well as in state.
  const itemKindsRef = useRef<Record<string, LessonItemKind>>({})
  useEffect(() => { itemKindsRef.current = itemKinds }, [itemKinds])
  // Read the freshest support flags inside the serial worker (no stale closure).
  const supportUsedRef = useRef(supportUsed)
  useEffect(() => { supportUsedRef.current = supportUsed }, [supportUsed])
  const [currentQuestionKey, setCurrentQuestionKey] = useState<string | null>(null)
  const itemGenerationRef = useRef(0)
  const [itemGeneration, setItemGeneration] = useState(0)
  const [explainerOpen, setExplainerOpen] = useState(false)
  const [pendingAlternative, setPendingAlternative] = useState<TriggerAlternative | null>(null)
  // Bumped when the lesson page creates a provider session. Every provider
  // launch gets its own clean Coach thread, keyed by the immutable session id.
  const [lessonEpoch, setLessonEpoch] = useState(0)
  const [supportStateEpoch, setSupportStateEpoch] = useState(-1)
  useEffect(() => {
    const onLessonSession = (event: Event) => {
      const detail = (event as CustomEvent<Partial<LessonLaunch>>).detail
      if (!detail?.sessionId || !detail.unitId || !detail.componentId) return
      const nextLaunch = {
        sessionId: detail.sessionId,
        unitId: detail.unitId,
        componentId: detail.componentId,
      }
      // A queued or in-flight turn can belong to the previous launch. Abort it
      // before clearing the panel so it cannot write an old answer afterwards.
      inFlightRef.current?.controller.abort()
      queueRef.current = []
      activeConversationIdRef.current = null
      setActiveConversationId(null)
      setMessages([])
      setMessageCursor(null)
      setHasMoreMessages(false)
      currentQuestionKeyRef.current = null
      setCurrentQuestionKey(null)
      lessonLaunchRef.current = nextLaunch
      setLessonLaunch(nextLaunch)
      setSupportStateEpoch(-1)
      setLessonEpoch((epoch) => epoch + 1)
    }
    window.addEventListener('yuvilab:lesson-session-created', onLessonSession)
    return () => window.removeEventListener('yuvilab:lesson-session-created', onLessonSession)
  }, [])
  const counter = useRef(0)
  const messageRequest = useRef(0)
  const conversationLoading = useRef(false)
  const messageLoading = useRef(false)
  /** How many message reads are in flight. Drives the "loading older messages"
   *  spinner, so an invalidated read still takes its own spinner down. */
  const messageReads = useRef(0)
  const liveTurnInProgress = useRef(false)
  // The question the learner is currently on (server `question_key`). Messages
  // are scoped to it: the panel shows the current question's thread (+ untagged
  // messages), live turns are tagged with it, and moving between questions
  // filters rather than deletes — so coming back restores that question's
  // thread. The ref mirrors the state for tagging inside async callbacks.
  const currentQuestionKeyRef = useRef<string | null>(null)
  // Mirrors activeConversationId so a serial queue turn reuses the id the
  // previous turn created without waiting for a re-render.
  const activeConversationIdRef = useRef<string | null>(null)
  // Current lesson thread id. Prior launch threads stay audit-only and are
  // superseded server-side when the next launch is created.
  const lessonConversationIdRef = useRef<string | null>(null)
  // Items (question SCREENS) whose arrival intro has played this launch, and the
  // specific sub-questions (`item|question`) intro'd within them — so each
  // sub-question on a multi-question screen (q1→q2) gets one starting message and
  // none of them re-intro on a poll re-tick.
  const introducedItemsRef = useRef<Set<string>>(new Set())
  const introducedQuestionsRef = useRef<Set<string>>(new Set())
  const isOpenRef = useRef(false)
  const isClosingRef = useRef(false)
  const openingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Chat-action queue (the orchestrator) ────────────────────────────────────
  // ONE serial worker owns Yuvi's voice: every intro / nudge / hint / user turn
  // is enqueued and streamed one-at-a-time, in order. This replaces the old web
  // of per-path `isStreaming` guards + a one-slot pending-trigger that silently
  // dropped a nudge arriving mid-stream (the "chat disconnected after idle" bug).
  // Nothing received is dropped except by the explicit staleness rules in
  // `shouldPlay`; because display is now guaranteed, the server's one-shot
  // dedupes (e.g. `_last_mistake_key`) are finally safe.
  const queueRef = useRef<ChatAction[]>([])
  const workerRunningRef = useRef(false)
  // The turn currently streaming, so a screen change can cut a proactive one
  // short. Without this, a slow intro kept streaming after the learner had moved
  // on two screens and landed as if it described the question in front of them
  // (observed: question 2's orientation delivered 34s later, on question 4).
  const inFlightRef = useRef<{ action: ChatAction; controller: AbortController } | null>(null)
  // Bumped on any evidence the learner is engaged (navigation, answer-evidence
  // nudge, send, support) — a queued `idle` nudge is dropped if this moved since
  // it was enqueued, so idle never fires onto an already-active learner.
  const activitySeqRef = useRef(0)
  // Counts SCREEN changes only (not every sign of life), so a queued turn knows
  // how far the learner has moved since the moment it was written for.
  const screenSeqRef = useRef(0)
  // Per-nudge-type last-played clock (spam guard, evaluated at play time).
  const lastNudgePlayedAtRef = useRef<Record<string, number>>({})
  // Bumped on each `screen_change` push; the poll snapshots it before its fetch
  // and applies its (possibly stale) key only if no push landed meanwhile.
  const pushSeqRef = useRef(0)
  // "Latest closure" refs so the []-dep worker/subscription always call the
  // freshest implementations (fresh activeConversationId / language / surface)
  // without re-subscribing the SSE or re-creating the worker.
  const playActionRef = useRef<((action: ChatAction) => Promise<void>) | undefined>(undefined)
  const shouldPlayRef = useRef<((action: ChatAction) => boolean) | undefined>(undefined)
  const applyQuestionKeyRef = useRef<((key: string | null, source: 'push' | 'poll') => void) | undefined>(undefined)
  const syncSupportStateRef = useRef<(() => Promise<void>) | undefined>(undefined)

  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { activeConversationIdRef.current = activeConversationId }, [activeConversationId])
  useEffect(() => {
    if (activityScoped && activeConversationId && activeConversationId !== 'default') {
      lessonConversationIdRef.current = activeConversationId
    }
  }, [activityScoped, activeConversationId])
  // A relaunch is a fresh start — re-arm the per-question intro, and drop any
  // queued non-user actions from the previous screen/launch.
  useEffect(() => {
    introducedItemsRef.current = new Set()
    introducedQuestionsRef.current = new Set()
    queueRef.current = queueRef.current.filter(
      (a) => a.kind === 'user-message' || a.kind === 'support'
    )
  }, [lessonEpoch])

  const welcomedEpochRef = useRef(-1)
  /** Threads whose greeting is STILL ON SCREEN, so a re-launch of the same
   *  lesson does not greet twice into the same visible panel.
   *
   *  Deliberately not a clock. A welcome is not "once per sitting" measured in
   *  minutes — it is once per VISIBLE THREAD, because on a lesson the panel
   *  renders only this launch's live turns (`visibleMessages`) and the stored
   *  history is filtered out. So whenever those live turns are gone, there is
   *  nothing on screen at all, and suppressing the greeting leaves the learner
   *  looking at an empty panel with no sign the companion is there.
   *
   *  A reload destroys this ref along with the messages it describes, which is
   *  exactly right: both vanish together, so a reload always greets. Cleared
   *  alongside the messages on an activity change for the same reason. */
  const welcomedThreadsRef = useRef<Set<string>>(new Set())

  // Moving to ANOTHER activity is a different conversation, so the panel empties
  // at the moment of the move. The thread swap already happens server-side, but
  // it is an async resolve — and it is skipped outright while a turn is
  // streaming — so the finished activity's messages stayed on screen through the
  // transition and the next lesson's opening line landed underneath them, as if
  // it were more of the same conversation.
  const lastLessonActivityRef = useRef<string | null>(null)
  useEffect(() => {
    const activity = activityScoped
      ? `${surface.unit_id || ''}|${surface.component_id || ''}`
      : null
    if (lastLessonActivityRef.current === activity) return
    const previous = lastLessonActivityRef.current
    lastLessonActivityRef.current = activity
    if (previous === null) return   // first activity of the session: nothing to clear
    lessonConversationIdRef.current = null
    // Anything still streaming belongs to the activity being left.
    inFlightRef.current?.controller.abort()
    queueRef.current = []
    liveTurnInProgress.current = false
    activeConversationIdRef.current = null
    setActiveConversationId(null)
    setMessages([])
    setMessageCursor(null)
    setHasMoreMessages(false)
    setCurrentQuestionKey(null)
    currentQuestionKeyRef.current = null
    introducedItemsRef.current = new Set()
    introducedQuestionsRef.current = new Set()
    // The greetings these recorded have just been cleared off the screen, so
    // the next launch of this activity must be free to greet again.
    welcomedThreadsRef.current = new Set()
    welcomedEpochRef.current = -1
    setPendingAlternative(null)
    setSupportUsed({ hint: false, contentHint: false, hintLevel: 0, maxHintLevel: 3, explanation: false })
  }, [activityScoped, surface.component_id, surface.unit_id])

  const nextId = () => `live-${Date.now()}-${counter.current++}`

  const createCurrentConversation = useCallback(async (): Promise<CoachConversation> => {
    if (activityScoped && !lessonLaunchReady) {
      throw new Error('Lesson launch is not ready')
    }
    return createCoachConversation(surface, lessonLaunchReady ? lessonLaunch?.sessionId : undefined)
  }, [activityScoped, lessonLaunch?.sessionId, lessonLaunchReady, surface])

  // Drain the queue serially: exactly one stream at a time, staleness re-checked
  // at DEQUEUE (a nudge queued behind a long intro may no longer be worth
  // playing). `workerRunningRef` makes it re-entrant/StrictMode safe.
  const runWorker = useCallback(async () => {
    if (workerRunningRef.current) return
    workerRunningRef.current = true
    try {
      while (queueRef.current.length > 0) {
        const action = queueRef.current.shift()!
        if (!shouldPlayRef.current?.(action)) continue
        const controller = new AbortController()
        inFlightRef.current = { action, controller }
        // Nothing may hold the queue forever. One worker owns Yuvi's voice, so a
        // turn that never finishes strands every intro, reaction and answer
        // behind it — the chat then looks like it has lost track of where the
        // learner is, while the events kept arriving perfectly.
        const deadline = setTimeout(() => controller.abort(), ACTION_DEADLINE_MS)
        try {
          await playActionRef.current?.({ ...action, signal: controller.signal })
        } catch {
          // One failing turn must never strand the ones behind it. Before this,
          // a throw escaped the loop and everything already queued sat unplayed
          // until the next event happened to restart the worker. Transport
          // retries live inside the learner-initiated players, where the
          // optimistic bubbles are, so re-queueing here would double them.
        } finally {
          clearTimeout(deadline)
          inFlightRef.current = null
        }
      }
    } finally {
      workerRunningRef.current = false
      // A late enqueue that arrived between the last shift() and the flag drop
      // would otherwise sit there until the next event. Re-check before parking.
      if (queueRef.current.length > 0) void runWorkerRef.current?.()
    }
  }, [])
  const runWorkerRef = useRef<(() => Promise<void>) | undefined>(undefined)
  useEffect(() => { runWorkerRef.current = runWorker }, [runWorker])

  // Enqueue + kick the worker. Coalescing keeps the queue honest under bursts:
  // a newer intro replaces a queued one (latest screen wins); a duplicate nudge
  // type is dropped; user turns jump ahead of pending proactive chatter.
  const enqueueChatAction = useCallback(
    (action: Omit<ChatAction, 'enqueuedAt' | 'activitySeq' | 'screenSeq'>, opts?: { front?: boolean }) => {
      const item: ChatAction = {
        ...action,
        enqueuedAt: Date.now(),
        activitySeq: activitySeqRef.current,
        screenSeq: screenSeqRef.current,
      }
      const q = queueRef.current
      if (item.kind === 'intro') {
        queueRef.current = [...q.filter((a) => a.kind !== 'intro'), item]
      } else if (item.kind === 'nudge') {
        if (q.some((a) => a.kind === 'nudge' && a.trigger === item.trigger)) return
        q.push(item)
      } else if (opts?.front) {
        let i = 0
        while (i < q.length && (q[i].kind === 'user-message' || q[i].kind === 'support')) i += 1
        q.splice(i, 0, item)
      } else {
        q.push(item)
      }
      void runWorker()
    },
    [runWorker]
  )

  // Fire the lesson welcome once per launch, when the learner opens a lesson on
  // the cover frame (no question yet). If they resume straight onto a question,
  // the per-question intro greets instead, so we skip the welcome.
  //
  // Wait for the launch to EXIST (`lessonEpoch > 0`, i.e. the lesson page has
  // created its provider session). The route alone used to be enough, which put
  // the welcome on epoch 0 — before the session. The epoch then bumped underneath
  // the streaming turn, which both re-ran the conversation effect (replacing
  // `messages`, so the half-written welcome vanished) and re-armed this effect,
  // firing a SECOND welcome. Measured entering a lesson from the dashboard: two
  // `POST /coach/proactive` ~3s apart and an empty panel in between — which is
  // why a reload "fixed" it (one mount, one epoch, nothing to race).
  useEffect(() => {
    if (!activityScoped || !surface.component_id || lessonEpoch === 0) return
    if (supportStateEpoch !== lessonEpoch) return
    if (welcomedEpochRef.current === lessonEpoch) return
    if (introParts(currentQuestionKeyRef.current).question) return
    welcomedEpochRef.current = lessonEpoch
    enqueueChatAction({ kind: 'welcome', targetQuestionKey: currentQuestionKeyRef.current })
  }, [activityScoped, surface.component_id, lessonEpoch, supportStateEpoch, currentQuestionKey, enqueueChatAction])

  const finishOpening = useCallback(() => {
    if (openingTimer.current) clearTimeout(openingTimer.current)
    openingTimer.current = null
    setIsOpening(false)
  }, [])

  const open = useCallback(() => {
    setUnreadCount(0)
    if (isOpenRef.current) return
    isOpenRef.current = true
    if (openingTimer.current) clearTimeout(openingTimer.current)
    if (closingTimer.current) clearTimeout(closingTimer.current)
    closingTimer.current = null
    isClosingRef.current = false
    setIsClosing(false)
    const shouldAnimate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setIsOpening(shouldAnimate)
    setIsOpen(true)
    if (shouldAnimate) {
      openingTimer.current = setTimeout(finishOpening, COMPANION_OPENING_MS)
    }
  }, [finishOpening])

  const close = useCallback(() => {
    if (!isOpenRef.current || isClosingRef.current) return
    if (openingTimer.current) clearTimeout(openingTimer.current)
    openingTimer.current = null
    setIsOpening(false)
    const shouldAnimate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!shouldAnimate) {
      isOpenRef.current = false
      setIsOpen(false)
      return
    }
    isClosingRef.current = true
    setIsClosing(true)
    closingTimer.current = setTimeout(() => {
      closingTimer.current = null
      isClosingRef.current = false
      isOpenRef.current = false
      setIsClosing(false)
      setIsOpen(false)
    }, COMPANION_CLOSING_MS)
  }, [])

  const toggle = useCallback(() => {
    if (isOpenRef.current) close()
    else open()
  }, [close, open])

  useEffect(() => () => {
    if (openingTimer.current) clearTimeout(openingTimer.current)
    if (closingTimer.current) clearTimeout(closingTimer.current)
  }, [])

  // The chat auto-opens (docked) on the lesson. When the learner LEAVES the
  // lesson, close it — the task-docked chat must not linger as a floating panel
  // on other screens. Only on the transition off the lesson, so a chat the
  // learner opened themselves on a normal screen is left untouched. Immediate
  // (no travelling animation) since they've already navigated away.
  const wasOnLessonRef = useRef(false)
  useEffect(() => {
    const onLesson = pathname.startsWith('/learning/lesson')
    if (onLesson) {
      open()
    } else if (wasOnLessonRef.current) {
      lessonConversationIdRef.current = null
      if (openingTimer.current) clearTimeout(openingTimer.current)
      if (closingTimer.current) clearTimeout(closingTimer.current)
      openingTimer.current = null
      closingTimer.current = null
      isClosingRef.current = false
      isOpenRef.current = false
      setIsOpening(false)
      setIsClosing(false)
      setIsOpen(false)
    }
    wasOnLessonRef.current = onLesson
  }, [open, pathname])

  const selectConversation = useCallback(async (conversationId: string) => {
    const request = ++messageRequest.current
    setActiveConversationId(conversationId)
    setMessages([])
    setMessageCursor(null)
    setHasMoreMessages(false)
    // The spinner belongs to the READS IN FLIGHT, not to whichever request wins.
    // It used to be cleared only by the request that still owned
    // `messageRequest`, so a read that was invalidated mid-flight — the
    // conversation effect re-running on a launch change bumps that counter in
    // its cleanup — left "טוען הודעות קודמות…" on screen with nobody
    // responsible for taking it down. That became reachable far more often once
    // proactive turns started holding `liveTurnInProgress`, because the re-run
    // then skips `selectConversation` altogether and no successor ever clears it.
    messageReads.current += 1
    setIsLoadingMessages(true)
    setHistoryError(false)
    messageLoading.current = true
    try {
      const page = await listCoachMessages(conversationId, undefined, 20, conversationMode)
      if (messageRequest.current !== request) return
      setMessages(page.messages.map(historyMessage))
      setMessageCursor(page.next_cursor)
      setHasMoreMessages(page.has_more)
    } catch {
      if (messageRequest.current === request) setHistoryError(true)
    } finally {
      messageReads.current = Math.max(0, messageReads.current - 1)
      if (messageReads.current === 0) {
        messageLoading.current = false
        setIsLoadingMessages(false)
      }
    }
  }, [conversationMode])

  const reloadHistory = useCallback(async () => {
    if (conversationLoading.current) return
    conversationLoading.current = true
    setIsLoadingConversations(true)
    setHistoryError(false)
    try {
      const page = await listCoachConversations(undefined, 12, conversationMode)
      setConversations(page.conversations)
      setConversationCursor(page.next_cursor)
      setHasMoreConversations(page.has_more)
    } catch {
      setHistoryError(true)
    } finally {
      conversationLoading.current = false
      setIsLoadingConversations(false)
    }
  }, [conversationMode])

  useEffect(() => {
    if (activityScoped && !lessonLaunchReady) return
    let active = true
    conversationLoading.current = true
    setIsLoadingConversations(true)
    const initialize = async () => {
      const activityConversation = activityScoped
        ? await createCurrentConversation()
        : null
      const page = await listCoachConversations(undefined, 12, conversationMode)
      return { activityConversation, page }
    }
    initialize()
      .then(async ({ activityConversation, page }) => {
        if (!active) return
        const nextConversations = activityConversation
          && !page.conversations.some((item) => item.id === activityConversation.id)
          ? [activityConversation, ...page.conversations]
          : page.conversations
        setConversations(nextConversations)
        setConversationCursor(page.next_cursor)
        setHasMoreConversations(page.has_more)
        const target = activityConversation || page.conversations[0]
        if (target && !liveTurnInProgress.current) {
          await selectConversation(target.id)
        } else if (!liveTurnInProgress.current) {
          setActiveConversationId('default')
        }
      })
      .catch(() => {
        if (active) {
          if (!liveTurnInProgress.current) setActiveConversationId('default')
          setHistoryError(true)
        }
      })
      .finally(() => {
        conversationLoading.current = false
        if (active) setIsLoadingConversations(false)
      })
    return () => {
      active = false
      messageRequest.current += 1
    }
  }, [activityScoped, conversationMode, createCurrentConversation, lessonEpoch, lessonLaunchReady, pathname, selectConversation])

  const loadMoreConversations = useCallback(async () => {
    if (!hasMoreConversations || !conversationCursor || conversationLoading.current) return
    conversationLoading.current = true
    setIsLoadingConversations(true)
    try {
      const page = await listCoachConversations(conversationCursor, 12, conversationMode)
      setConversations((current) => mergeUnique(current, page.conversations))
      setConversationCursor(page.next_cursor)
      setHasMoreConversations(page.has_more)
    } catch {
      setHistoryError(true)
    } finally {
      conversationLoading.current = false
      setIsLoadingConversations(false)
    }
  }, [conversationCursor, conversationMode, hasMoreConversations])

  const loadMoreMessages = useCallback(async () => {
    if (!activeConversationId || !hasMoreMessages || !messageCursor || messageLoading.current) return
    messageLoading.current = true
    messageReads.current += 1
    setIsLoadingMessages(true)
    try {
      const page = await listCoachMessages(activeConversationId, messageCursor, 20, conversationMode)
      setMessages((current) => {
        const existing = new Set(current.map((message) => message.id))
        return [
          ...page.messages.map(historyMessage).filter((message) => !existing.has(message.id)),
          ...current,
        ]
      })
      setMessageCursor(page.next_cursor)
      setHasMoreMessages(page.has_more)
    } catch {
      setHistoryError(true)
    } finally {
      messageReads.current = Math.max(0, messageReads.current - 1)
      if (messageReads.current === 0) {
        messageLoading.current = false
        setIsLoadingMessages(false)
      }
    }
  }, [activeConversationId, conversationMode, hasMoreMessages, messageCursor])

  const startNewConversation = useCallback(async () => {
    if (isStreaming) return
    if (activityScoped && !lessonLaunchReady) return
    setHistoryError(false)
    try {
      if (activityScoped) {
        const conversation = await createCurrentConversation()
        setConversations((current) => [
          conversation,
          ...current.filter((item) => item.id !== conversation.id),
        ])
        await selectConversation(conversation.id)
        return
      }
      const existingEmpty = conversations.find(
        (item) => item.message_count === 0 && item.id !== activeConversationId
      )
      if (existingEmpty) {
        await selectConversation(existingEmpty.id)
        return
      }
      const conversation = await createCurrentConversation()
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)])
      await selectConversation(conversation.id)
    } catch {
      setHistoryError(true)
    }
  }, [activityScoped, conversations, createCurrentConversation, isStreaming, lessonLaunchReady, selectConversation])

  const deleteConversation = useCallback(async (conversationId: string) => {
    if (isStreaming) return false
    setHistoryError(false)
    try {
      await deleteCoachConversation(conversationId, conversationMode)
      const remaining = conversations.filter((item) => item.id !== conversationId)
      setConversations(remaining)
      if (activeConversationId === conversationId) {
        messageRequest.current += 1
        setMessages([])
        setMessageCursor(null)
        setHasMoreMessages(false)
        if (remaining[0]) {
          await selectConversation(remaining[0].id)
        } else {
          const conversation = await createCurrentConversation()
          setConversations([conversation])
          await selectConversation(conversation.id)
        }
      }
      return true
    } catch {
      setHistoryError(true)
      return false
    }
  }, [activeConversationId, conversationMode, conversations, createCurrentConversation, isStreaming, selectConversation])

  // Ensure a conversation exists (mirrored in a ref so serial queue turns reuse
  // the id the previous turn created, without waiting for a re-render).
  const ensureConversationId = useCallback(async (): Promise<string | null> => {
    if (activeConversationIdRef.current) return activeConversationIdRef.current
    if (activityScoped && !lessonLaunchReady) return null
    const expectedLaunchId = activityScoped ? lessonLaunchRef.current?.sessionId : null
    try {
      const conversation = await createCurrentConversation()
      // The request started for an earlier lesson launch. Its response and any
      // later stream must never become the active conversation for this page.
      if (activityScoped && lessonLaunchRef.current?.sessionId !== expectedLaunchId) return null
      activeConversationIdRef.current = conversation.id
      setActiveConversationId(conversation.id)
      // A lesson thread is scoped to the lesson and is not offered in the chat
      // history — the server leaves it out of the list, so adding it here would
      // only make it flicker into the sidebar until the next reload.
      if (!activityScoped) {
        setConversations((current) => [conversation, ...current.filter((c) => c.id !== conversation.id)])
      }
      return conversation.id
    } catch {
      return null
    }
  }, [activityScoped, createCurrentConversation, lessonLaunchReady])

  // Mark the streamed assistant row complete and stamp it for the grace window.
  const completeAssistant = useCallback((assistantId: string) => {
    const at = Date.now()
    setMessages((prev) => prev.map((m) => (
      m.id === assistantId ? { ...m, isComplete: true, completedAtMs: at } : m
    )))
  }, [])

  // ── Play functions: the four kinds of Yuvi turn. Called ONLY by the worker
  // (serialized), so none of them needs a concurrency guard — they just stream.

  const playUserMessage = useCallback(async (action: ChatAction) => {
    const trimmed = (action.text || '').trim()
    if (!trimmed) return
    liveTurnInProgress.current = true
    const conversationId = await ensureConversationId()
    if (!conversationId) {
      setHistoryError(true)
      liveTurnInProgress.current = false
      return
    }
    // A learner may send while the selected thread is still loading. Invalidate
    // that older read before adding the live turn so its eventual response can't
    // replace the optimistic user/assistant rows.
    messageRequest.current += 1
    messageLoading.current = false
    setIsLoadingMessages(false)

    const assistantId = nextId()
    const nowIso = new Date().toISOString()
    const nowMs = Date.now()
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', text: trimmed, isComplete: true, createdAt: nowIso, createdAtMs: nowMs, questionKey: currentQuestionKeyRef.current },
      { id: assistantId, role: 'assistant', text: '', isComplete: false, createdAt: nowIso, createdAtMs: nowMs, questionKey: currentQuestionKeyRef.current },
    ])
    setIsStreaming(true)
    setActiveAssistantId(assistantId)
    setActivity('thinking')
    let received = false
    try {
      await streamWithRetry(() => streamCoach(trimmed, language, {
        onDisclosure: (value) => setDisclosure(value),
        onPhase: setActivity,
        onText: (chunk) => {
          received = true
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId ? { ...m, text: m.text + chunk } : m
          )))
        },
        onVisualStatus: ({ status, textBefore, textAfter }) =>
          setMessages((prev) => prev.map((m) => {
            if (m.id !== assistantId) return m
            if (status === 'planning') return { ...m, isVisualizing: true }
            if (status === 'none') return { ...m, isVisualizing: false }
            return { ...m, text: textBefore ?? m.text, textAfter, isVisualizing: true }
          })),
        onVisual: (visual) =>
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId ? { ...m, visual, isVisualizing: false } : m
          ))),
        onCanVisualize: (canVisualize) =>
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId ? { ...m, canVisualize } : m
          ))),
        onEvent: (event) => {
          if (event.pointer && typeof event.pointer === 'object') {
            broadcastPointer(event.pointer as CoachPointerFrame, currentQuestionKeyRef.current)
          }
          const actions = event.actions
          const toolTrace = parseToolTrace(event.tool_trace) ?? []
          const hasToolTrace = Object.prototype.hasOwnProperty.call(event, 'tool_trace')
          const queryIntent = typeof event.query_intent === 'string' ? event.query_intent : undefined
          if (!Array.isArray(actions) && !hasToolTrace && !queryIntent) return
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId
              ? {
                ...m,
                ...(Array.isArray(actions) ? { actions: actions as CoachActionOffer[] } : {}),
                ...(hasToolTrace ? { toolTrace } : {}),
                ...(queryIntent ? { queryIntent } : {}),
              }
              : m
          )))
        },
      }, conversationId, surface), () => received)
    } catch {
      setMessages((prev) => prev.map((m) => (
        m.id === assistantId && !m.text
          ? { ...m, text: '…', isVisualizing: false }
          : m.id === assistantId ? { ...m, isVisualizing: false } : m
      )))
    } finally {
      completeAssistant(assistantId)
      setIsStreaming(false)
      setActiveAssistantId(null)
      setActivity('idle')
      await reloadHistory()
      liveTurnInProgress.current = false
      window.dispatchEvent(new CustomEvent('yuvilab:brain-updated'))
    }
  }, [completeAssistant, ensureConversationId, language, reloadHistory, surface])

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    activitySeqRef.current += 1   // an explicit turn is engagement
    enqueueChatAction({ kind: 'user-message', text: trimmed, targetQuestionKey: currentQuestionKeyRef.current }, { front: true })
  }, [enqueueChatAction])

  // Per-question intro: when the learner ARRIVES at a new question screen, Yuvi
  // opens with a short, question-grounded orientation ending in an offer to help
  // — instead of the generic greeting. Staleness (still on this screen, not yet
  // introduced) is checked by `shouldPlay` at dequeue; here we commit the dedup
  // and stream. The backend stays silent when there is no question (the iframe's
  // intro/cover frame), so an empty reply is dropped and the dedup released.
  const playIntro = useCallback(async (action: ChatAction) => {
    const questionKey = action.targetQuestionKey || ''
    const { item, question } = introParts(questionKey)
    if (!item) return
    const qkey = question ? `${item}|${question}` : ''
    // Commit the dedup — shouldPlay already gated. A screen (arrival) intro marks
    // the item; a sub-question intro marks the specific question.
    introducedItemsRef.current.add(item)
    if (qkey) introducedQuestionsRef.current.add(qkey)
    const rollback = () => {
      if (qkey) introducedQuestionsRef.current.delete(qkey)
      else introducedItemsRef.current.delete(item)
    }
    // Same reason as `playWelcome`: a history reload landing mid-stream would
    // replace `messages` and erase the bubble being written.
    liveTurnInProgress.current = true
    const conversationId = await ensureConversationId()
    if (!conversationId) { rollback(); liveTurnInProgress.current = false; return }
    const assistantId = nextId()
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', text: '', isComplete: false, createdAt: new Date().toISOString(), createdAtMs: Date.now(), questionKey },
    ])
    setIsStreaming(true)
    setActiveAssistantId(assistantId)
    setActivity('thinking')
    try {
      // What Yuvi opens with follows what the SCREEN is. A video, a reading or a
      // simulation gets a step intro — including one that also asks (the video
      // playlist `…-01-01-003`), because the learner arrives there to watch and
      // the question only appears inside the clip. Introducing that question on
      // arrival describes something they have not reached yet.
      const kind = itemKindsRef.current[item]
      const trigger = kind && kind !== 'question' ? 'lesson_step_intro' : 'question_intro'
      await streamProactive(trigger, language, {
        signal: action.signal,
        onDisclosure: (value) => setDisclosure(value),
        onPhase: setActivity,
        onText: (chunk) =>
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId ? { ...m, text: m.text + chunk } : m
          ))),
        onEvent: (event) => {
          if (!Object.prototype.hasOwnProperty.call(event, 'tool_trace')) return
          const toolTrace = parseToolTrace(event.tool_trace) ?? []
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId ? { ...m, toolTrace } : m
          )))
        },
      }, conversationId, surface, questionKey)
    } catch {
      /* An intro must never disrupt the learner. */
    } finally {
      // Drop the bubble when it has nothing to say (no question resolved yet) OR
      // when the learner has since left the screen it describes — a late intro
      // for a question they already finished reads as the chat going backwards.
      const stale = introParts(currentQuestionKeyRef.current).item !== item
      if (stale) console.warn(`[companion] dropped stale intro for ${item} (now ${currentQuestionKeyRef.current})`)
      let dropped = false
      setMessages((prev) => {
        const message = prev.find((m) => m.id === assistantId)
        if (message && (stale || !message.text.trim())) {
          dropped = true
          return prev.filter((m) => m.id !== assistantId)
        }
        return prev.map((m) => (m.id === assistantId ? { ...m, isComplete: true, completedAtMs: Date.now() } : m))
      })
      if (dropped) rollback()
      setIsStreaming(false)
      setActiveAssistantId(null)
      setActivity('idle')
      await reloadHistory()
      liveTurnInProgress.current = false
    }
  }, [ensureConversationId, language, reloadHistory, surface])

  // One-time lesson welcome: when the learner opens a lesson (cover frame, before
  // any question) Yuvi greets them with what THIS lesson is about + an offer to
  // help — grounded in `current_objective` — replacing the generic greeting. A
  // silent/empty reply is dropped like an intro.
  const playWelcome = useCallback(async (action: ChatAction) => {
    // DECIDE first, claim the turn second. `liveTurnInProgress` tells the
    // conversation effect "don't replace `messages`, a bubble is being written"
    // — and holding it across the arrival check below meant the effect skipped
    // `selectConversation` while we were still deciding, so on the skip path the
    // thread was never selected and the panel opened completely empty: no
    // greeting AND no history.
    //
    // Is this an ARRIVAL or a continuation? The guard above this is per LAUNCH,
    // and a launch happens on every mount of the lesson page — re-entering the
    // activity, a reload, a back-navigation — while the thread stays open across
    // all of them, so greetings stacked up four-deep inside one conversation.
    //
    // The question is only ever "is my greeting still on screen", and
    // `welcomedThreadsRef` answers that exactly: it lives and dies with the
    // rendered live turns. A clock cannot answer it — it used to suppress the
    // greeting for minutes after a reload, and because a lesson panel shows only
    // this launch's live turns, that left the learner with a completely empty
    // panel and no sign the companion was there at all.
    let conversation: CoachConversation | null = null
    const expectedLaunchId = activityScoped ? lessonLaunchRef.current?.sessionId : null
    try {
      conversation = await createCurrentConversation()
    } catch {
      return
    }
    if (activityScoped && lessonLaunchRef.current?.sessionId !== expectedLaunchId) return
    // Greeted in THIS tab already (an epoch bump, a bounce to the roadmap and
    // back) — the panel still shows that greeting, so a second one is a repeat.
    if (welcomedThreadsRef.current.has(conversation.id)) {
      // Not speaking — but this thread still has to be the one on screen. The
      // init effect may have run while we were asking and left the panel empty.
      if (activeConversationIdRef.current !== conversation.id) {
        activeConversationIdRef.current = conversation.id
        await selectConversation(conversation.id)
      }
      return
    }
    welcomedThreadsRef.current.add(conversation.id)
    activeConversationIdRef.current = conversation.id
    setActiveConversationId(conversation.id)
    const conversationId = conversation.id
    liveTurnInProgress.current = true   // from here on a bubble is being written
    // Untagged (no screen) so the welcome always forms its own "Introduction"
    // section, never merged into the first question's section.
    const questionKey = null
    const assistantId = nextId()
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', text: '', isComplete: false, createdAt: new Date().toISOString(), createdAtMs: Date.now(), questionKey },
    ])
    setIsStreaming(true)
    setActiveAssistantId(assistantId)
    setActivity('thinking')
    try {
      await streamProactive('lesson_welcome', language, {
        signal: action.signal,
        onDisclosure: (value) => setDisclosure(value),
        onPhase: setActivity,
        onText: (chunk) =>
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId ? { ...m, text: m.text + chunk } : m
          ))),
        onEvent: (event) => {
          if (!Object.prototype.hasOwnProperty.call(event, 'tool_trace')) return
          const toolTrace = parseToolTrace(event.tool_trace) ?? []
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId ? { ...m, toolTrace } : m
          )))
        },
      }, conversationId, surface)
    } catch {
      /* A welcome must never disrupt the learner. */
    } finally {
      setMessages((prev) => {
        const message = prev.find((m) => m.id === assistantId)
        if (message && !message.text.trim()) return prev.filter((m) => m.id !== assistantId)
        return prev.map((m) => (m.id === assistantId ? { ...m, isComplete: true, completedAtMs: Date.now() } : m))
      })
      setIsStreaming(false)
      setActiveAssistantId(null)
      setActivity('idle')
      await reloadHistory()
      liveTurnInProgress.current = false
    }
  }, [ensureConversationId, language, reloadHistory, selectConversation, surface])

  // Enqueue an intro for a freshly-arrived screen. Guards: real item present and
  // not already introduced this launch (the worker re-checks at dequeue too, so
  // a screen that changes again before the intro plays is handled there).
  const maybeEnqueueIntro = useCallback((questionKey: string | null) => {
    const { item, question } = introParts(questionKey)
    if (!item) return
    const disposition = introDisposition(
      item, question, introducedItemsRef.current, introducedQuestionsRef.current
    )
    if (disposition === 'covered') {
      // The screen intro already grounds on this first question — record it so a
      // later sub-question (q2) is recognised as new, but stay silent here.
      introducedQuestionsRef.current.add(`${item}|${question}`)
      return
    }
    if (disposition === 'done') return
    enqueueChatAction({ kind: 'intro', targetQuestionKey: questionKey })
  }, [enqueueChatAction])

  // Adopt a new current screen key (from the instant `screen_change` push, or
  // the reconciling poll). Re-arms support optimistically on a push, marks
  // engagement, and schedules the screen's intro.
  const applyQuestionKey = useCallback((key: string | null, source: 'push' | 'poll') => {
    if (key === currentQuestionKeyRef.current) return
    const movedScreen = introParts(key).item !== introParts(currentQuestionKeyRef.current).item
    currentQuestionKeyRef.current = key
    setCurrentQuestionKey(key)
    // The learner left the screen a proactive turn was being written for. Cut it
    // off now rather than letting it finish and land as if it were about the
    // question they are looking at. A turn they ASKED for is left alone — they
    // are waiting for that answer, wherever they have navigated to since.
    if (movedScreen) screenSeqRef.current += 1
    // The pointer describes a screen; the screen just changed. Clear it.
    if (movedScreen) broadcastPointer(null)
    const inFlight = inFlightRef.current
    if (movedScreen && inFlight && diesWithScreen(inFlight.action)) {
      inFlight.controller.abort()
    }
    // An answer reaction is allowed to outlive ONE advance — Kata moves the
    // screen for the learner the moment they answer, so it is always written
    // about the screen behind. Two screens on it is no longer a reaction, it is
    // an interruption about a question they have left, and it holds the single
    // worker while the turn for where they ARE waits behind it.
    if (
      movedScreen && inFlight && !LEARNER_INITIATED.has(inFlight.action.kind)
      && screenSeqRef.current - inFlight.action.screenSeq >= 2
    ) {
      inFlight.controller.abort()
    }
    if (source === 'push') {
      pushSeqRef.current += 1
      setSupportUsed({ hint: false, contentHint: false, hintLevel: 0, maxHintLevel: 1, explanation: false })   // poll is authoritative
    }
    activitySeqRef.current += 1
    maybeEnqueueIntro(key)
  }, [maybeEnqueueIntro])
  useEffect(() => { applyQuestionKeyRef.current = applyQuestionKey }, [applyQuestionKey])

  // One-shot support state: poll while a lesson is open. The `screen_change` SSE
  // push is the PRIMARY "which question" signal now (instant); this poll is the
  // reconciler — it heals a missed push and carries the authoritative hint/
  // explanation re-arm flags. A poll response that started before a push landed
  // must not regress the key (pushSeq snapshot guard).
  const syncSupportState = useCallback(async (signal?: AbortSignal) => {
    try {
      const seenPush = pushSeqRef.current
      const state = await getCoachSupportState(surface.component_id, signal)
      setSupportUsed((current) => ({
        hint: state.hint_level > 0,
        contentHint: state.content_hint_used,
        hintLevel: state.hint_level,
        maxHintLevel: state.max_hint_level,
        explanation: state.explanation_used,
      }))
      // The learner's own question numbering, straight from the catalog, so a
      // chat thread can be titled "שאלה 3" because it IS question 3 of the
      // lesson — not because it happens to be the third section on screen.
      if (state.question_ordinals) setQuestionOrdinals(state.question_ordinals)
      if (state.question_parts) setQuestionParts(state.question_parts)
      if (state.teaching_items) setTeachingItems(state.teaching_items)
      itemGenerationRef.current = state.item_generation ?? 0
      setItemGeneration(itemGenerationRef.current)
      if (state.items) {
        const kinds: Record<string, LessonItemKind> = {}
        const media: Record<string, string> = {}
        const order: Record<string, number> = {}
        state.items.forEach((row, index) => {
          if (!row.id) return
          kinds[row.id] = row.kind
          order[row.id] = index
          if (row.media_format) media[row.id] = row.media_format
        })
        itemKindsRef.current = kinds   // the worker may dequeue before the re-render
        setItemKinds(kinds)
        setItemMedia(media)
        setItemOrder(order)
      }
      if (pushSeqRef.current === seenPush) {
        applyQuestionKey(state.question_key || null, 'poll')
      }
      setSupportStateEpoch(lessonEpoch)
    } catch {
      /* transient — next tick retries */
    }
  }, [applyQuestionKey, lessonEpoch, surface.component_id])
  useEffect(() => { syncSupportStateRef.current = () => syncSupportState() }, [syncSupportState])

  useEffect(() => {
    if (!activityScoped) {
      setSupportUsed({ hint: false, contentHint: false, hintLevel: 0, maxHintLevel: 3, explanation: false })
      currentQuestionKeyRef.current = null
      setCurrentQuestionKey(null)
      return
    }
    const controller = new AbortController()
    void syncSupportState(controller.signal)
    // A hidden tab has no buttons to re-arm and no learner to follow, so polling
    // it is pure cost — and with several lessons open in background tabs it was
    // several requests a second against a learner nobody is watching. Sync once
    // on return so the state is right the moment the tab is looked at again.
    const tick = () => {
      if (document.hidden) return
      void syncSupportState(controller.signal)
    }
    const timer = window.setInterval(tick, 2500)
    const onVisible = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [activityScoped, lessonEpoch, syncSupportState])

  const playSupport = useCallback(async (action: ChatAction) => {
    const support = action.support
    if (!support) return
    liveTurnInProgress.current = true
    const conversationId = await ensureConversationId()
    if (!conversationId) {
      setHistoryError(true)
      liveTurnInProgress.current = false
      setSupportUsed((current) => support === 'hint'
        ? {
          ...current,
          hintLevel: Math.max(0, current.hintLevel - 1),
          hint: current.hintLevel > 1,
        }
        : support === 'explanation' ? { ...current, explanation: false }
          : current)
      if (support === 'video_summary' || support === 'video_visual') {
        const item = introParts(action.targetQuestionKey).item
        if (item) {
          const key = videoItemKey(item, itemGenerationRef.current)
          setVideoSupportByItem((current) => ({
            ...current,
            [key]: {
              ...current[key],
              ...(support === 'video_summary' ? { summary: false } : { visual: false }),
            },
          }))
        }
      }
      return
    }
    messageRequest.current += 1
    const assistantId = nextId()
    setMessages((current) => [
      ...current,
      { id: assistantId, role: 'assistant', text: '', isComplete: false, createdAt: new Date().toISOString(), createdAtMs: Date.now(), questionKey: currentQuestionKeyRef.current },
    ])
    setIsStreaming(true)
    setActiveAssistantId(assistantId)
    setActivity('thinking')
    let received = false
    try {
      await streamWithRetry(() => streamCoachSupport(support, language, {
        onDisclosure: setDisclosure,
        onPhase: setActivity,
        onText: (chunk) => {
          received = true
          setMessages((current) => current.map((m) => (
            m.id === assistantId ? { ...m, text: m.text + chunk } : m
          )))
        },
        onVisualStatus: ({ status, textBefore, textAfter }) =>
          setMessages((current) => current.map((m) => {
            if (m.id !== assistantId) return m
            if (status === 'planning') return { ...m, isVisualizing: true }
            if (status === 'none') return { ...m, isVisualizing: false }
            return { ...m, text: textBefore ?? m.text, textAfter, isVisualizing: true }
          })),
        onVisual: (visual) => {
          received = true
          setMessages((current) => current.map((m) => (
            m.id === assistantId ? { ...m, visual, isVisualizing: false } : m
          )))
        },
        onCanVisualize: (canVisualize) =>
          setMessages((current) => current.map((m) => (
            m.id === assistantId ? { ...m, canVisualize } : m
          ))),
        onEvent: (event) => {
          if (event.pointer && typeof event.pointer === 'object') {
            broadcastPointer(event.pointer as CoachPointerFrame, currentQuestionKeyRef.current)
          }
          if (!Object.prototype.hasOwnProperty.call(event, 'tool_trace')) return
          const toolTrace = parseToolTrace(event.tool_trace) ?? []
          setMessages((current) => current.map((m) => (
            m.id === assistantId ? { ...m, toolTrace } : m
          )))
        },
      }, conversationId, surface), () => received)
    } catch (error) {
      if (error instanceof AgentStreamError && error.status === 409) {
        setMessages((current) => current.filter((message) => message.id !== assistantId))
        await syncSupportState()
        return
      }
      setMessages((current) => current.map((m) => (
        m.id === assistantId && !m.text
          ? { ...m, text: '…', isVisualizing: false }
          : m.id === assistantId ? { ...m, isVisualizing: false } : m
      )))
    } finally {
      completeAssistant(assistantId)
      setIsStreaming(false)
      setActiveAssistantId(null)
      setActivity('idle')
      await reloadHistory()
      liveTurnInProgress.current = false
    }
  }, [completeAssistant, ensureConversationId, language, reloadHistory, surface, syncSupportState])

  const requestSupport = useCallback(async (support: CoachSupportMode) => {
    const videoItem = introParts(currentQuestionKeyRef.current).item
    const videoKey = videoItem ? videoItemKey(videoItem, itemGenerationRef.current) : null
    const videoSupport = videoKey ? videoSupportByItem[videoKey] : undefined
    if (support === 'hint'
      ? supportUsed.hintLevel >= supportUsed.maxHintLevel
      : support === 'explanation' ? supportUsed.explanation
        : support === 'video_summary' ? videoSupport?.summary : videoSupport?.visual) return
    // Optimistic button feedback + dup-guard at enqueue (server also 409s a dup).
    setSupportUsed((current) => support === 'hint'
      ? {
        ...current,
        hint: true,
        hintLevel: Math.min(current.maxHintLevel, current.hintLevel + 1),
      }
      : support === 'explanation' ? { ...current, explanation: true }
        : current)
    if ((support === 'video_summary' || support === 'video_visual') && videoKey) {
      setVideoSupportByItem((current) => ({
        ...current,
        [videoKey]: {
          ...current[videoKey],
          ...(support === 'video_summary' ? { summary: true } : { visual: true }),
        },
      }))
    }
    activitySeqRef.current += 1
    enqueueChatAction({ kind: 'support', support, targetQuestionKey: currentQuestionKeyRef.current }, { front: true })
  }, [enqueueChatAction, supportUsed, videoSupportByItem])

  // On-demand visual: the learner tapped "show me a video / image" under a
  // text-only reply. We plan + render from that message's text plus its
  // prompting user turn, then retain it on that assistant message.
  const requestVisual = useCallback(async (messageId: string, mode: VisualMode) => {
    if (activityScoped) return
    const current = messagesRef.current
    const index = current.findIndex((message) => message.id === messageId)
    if (index === -1) return
    const assistantText = [current[index].text, current[index].textAfter].filter(Boolean).join('\n\n')
    if (!assistantText) return
    let userMessage = ''
    for (let i = index - 1; i >= 0; i -= 1) {
      if (current[i].role === 'user' && current[i].text) { userMessage = current[i].text; break }
    }
    // This request renders an attachment on an existing reply; it is not a new
    // Yuvi chat turn, so leave the global avatar idle and show only the
    // message-level visual preparation status.
    setActivity('idle')
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? { ...message, isVisualizing: true, visualFailed: false } : message
      )
    )
    try {
      const visual = await requestVisualization(
        userMessage || assistantText,
        assistantText,
        mode,
        language,
        activeConversationId || 'default',
        messageId,
      )
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId
            ? visual
              ? { ...message, visual, isVisualizing: false, visualFailed: false }
              : { ...message, isVisualizing: false, visualFailed: true }
            : message
        )
      )
    } catch {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, isVisualizing: false, visualFailed: true } : message
        )
      )
    }
  }, [activeConversationId, activityScoped, language])

  // Proactive nudges stream into the active thread without taking control of
  // the screen. Only the learner-visible assistant message enters history.
  const playNudge = useCallback(async (action: ChatAction) => {
    const trigger = action.trigger
    if (!trigger) return
    lastNudgePlayedAtRef.current[trigger] = Date.now()
    if (!isOpenRef.current) setUnreadCount((count) => count + 1)
    // Same reason as `playWelcome`: a history reload landing mid-stream would
    // replace `messages` and erase the bubble being written.
    liveTurnInProgress.current = true
    const conversationId = await ensureConversationId()
    if (!conversationId) { liveTurnInProgress.current = false; return }
    const assistantId = nextId()
    setMessages((prev) => [...prev, {
      id: assistantId, role: 'assistant', text: '', isComplete: false,
      createdAt: new Date().toISOString(), createdAtMs: Date.now(),
      questionKey: currentQuestionKeyRef.current,
    }])
    setIsStreaming(true)
    setActiveAssistantId(assistantId)
    setActivity('thinking')
    try {
      await streamProactive(trigger, language, {
        signal: action.signal,
        onDisclosure: (value) => setDisclosure(value),
        onPhase: setActivity,
        onText: (chunk) =>
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId ? { ...m, text: m.text + chunk } : m
          ))),
        onEvent: (event) => {
          if (!Object.prototype.hasOwnProperty.call(event, 'tool_trace')) return
          const toolTrace = parseToolTrace(event.tool_trace) ?? []
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId ? { ...m, toolTrace } : m
          )))
        },
      }, conversationId, surface, action.targetQuestionKey)
    } catch {
      /* Proactivity must never disrupt the learner. */
    } finally {
      // A present-moment nudge (idle / spinning) is gone once they navigate.
      // Answer-evidence nudges are NOT: Kata advances the screen right after an
      // answer, so success/mistake are always about the screen just left, and the
      // grace window keeps them readable there.
      const anchor = introParts(action.targetQuestionKey).item
      if (diesWithScreen(action) && anchor && introParts(currentQuestionKeyRef.current).item !== anchor) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantId))
        setIsStreaming(false)
        setActiveAssistantId(null)
        setActivity('idle')
        return
      }
      completeAssistant(assistantId)
      // On a success nudge, offer "what helped you?" chips for the help the
      // learner actually used on THIS question (hint / explanation / chatted).
      // Computed here from the live thread so message + chips always agree.
      if (trigger === 'success') {
        setMessages((prev) => {
          const target = prev.find((m) => m.id === assistantId)
          const qk = target?.questionKey ?? null
          const methods: HelpMethod[] = []
          if (supportUsedRef.current.hint) methods.push('hint')
          if (supportUsedRef.current.explanation) methods.push('explanation')
          if (prev.some((m) => m.role === 'user' && m.questionKey === qk)) methods.push('yuvi_chat')
          if (!methods.length) return prev
          return prev.map((m) => (
            m.id === assistantId ? { ...m, attribution: { methods, questionKey: qk } } : m
          ))
        })
      }
      setIsStreaming(false)
      setActiveAssistantId(null)
      setActivity('idle')
      await reloadHistory()
      liveTurnInProgress.current = false
      window.dispatchEvent(new CustomEvent('yuvilab:brain-updated'))
    }
  }, [completeAssistant, ensureConversationId, language, reloadHistory, surface])

  // Dequeue-time staleness policy. Evaluated by the worker just before playing —
  // a nudge queued behind a long intro may no longer be worth showing.
  const shouldPlay = useCallback((action: ChatAction): boolean => {
    const now = Date.now()
    if (action.kind === 'user-message' || action.kind === 'support') return true
    // Welcome is enqueued once per launch at lesson entry; play it only while the
    // learner is still at the start (no question intro'd yet) so a late welcome
    // can't land after they're already deep in the lesson.
    if (action.kind === 'welcome') {
      return introducedItemsRef.current.size === 0 && introducedQuestionsRef.current.size === 0
    }
    if (action.kind === 'intro') {
      const { item, question } = introParts(action.targetQuestionKey)
      if (!item) return false
      const cur = introParts(currentQuestionKeyRef.current)
      if (cur.item !== item) return false                       // moved to another screen
      if (question && cur.question && cur.question !== question) return false  // moved to another sub-question
      // Coverage resolved at DEQUEUE (the arrival intro may have played after
      // this one was queued): a first sub-question covered by the screen intro
      // is marked and skipped; only a genuinely new one plays.
      const disposition = introDisposition(
        item, question, introducedItemsRef.current, introducedQuestionsRef.current
      )
      if (disposition === 'covered') {
        introducedQuestionsRef.current.add(`${item}|${question}`)
        return false
      }
      return disposition === 'new'
    }
    // nudge
    const trig = action.trigger || ''
    if (trig === 'idle') {
      // Only if the learner is STILL idle: no engagement evidence since enqueue.
      return now - action.enqueuedAt <= 30000 && action.activitySeq === activitySeqRef.current
    }
    if (now - action.enqueuedAt > 45000) return false          // a stale reaction reads as random
    // …and distance in SCREENS, not just seconds. A learner who answers and
    // clicks straight on can be two questions ahead within those 45s; the
    // reaction then lands under a question they finished long ago and pushes the
    // turn for where they actually are further back in the queue.
    if (screenSeqRef.current - action.screenSeq >= 2) return false
    if (now - (lastNudgePlayedAtRef.current[trig] ?? 0) < 15000) return false   // per-type spam guard
    return true
  }, [])

  const playAction = useCallback(async (action: ChatAction) => {
    switch (action.kind) {
      case 'user-message': return playUserMessage(action)
      case 'support': return playSupport(action)
      case 'intro': return playIntro(action)
      case 'welcome': return playWelcome(action)
      case 'nudge': return playNudge(action)
    }
  }, [playUserMessage, playSupport, playIntro, playWelcome, playNudge])

  // Publish the freshest closures to the worker / SSE handler (both []-dep).
  playActionRef.current = playAction
  shouldPlayRef.current = shouldPlay

  const NUDGE_TYPES = useMemo(() => new Set([
    'misconception', 'mistake', 'slow_progress', 'idle', 'success', 'rapid_guessing', 'wheel_spinning',
    // `kudos` is deliberately NOT here. Teacher praise is not a tutoring nudge:
    // it is a named adult saying something to a child, and Yuvi paraphrasing it
    // into a new conversation both changed the words and let them scroll away.
    // It comes back as a card instead — see `pendingKudos` below.
  ]), [])

  // Trigger SSE — []-dep so it is NOT torn down and rebuilt on every nudge (a
  // rebuild could drop a trigger landing in the reconnect gap). Reads only refs.
  // Only a learner has a trigger stream. A teacher- or admin-only account gets
  // 403 from this endpoint, and EventSource retries a failed connection forever
  // — one wasted connection slot and a request every three seconds, for the life
  // of the tab. The provider is mounted app-wide, so the guard belongs here.
  const canReceiveTriggers = Boolean(user?.roles?.includes('learner'))

  useEffect(() => {
    if (!canReceiveTriggers) return
    const close = subscribeTriggers(
      (trigger) => {
        // Component-level completion is a STATE signal, not a coach nudge: hand
        // it to the lesson page to finalize instantly (720 §"Completed").
        if (trigger.type === 'completion') {
          window.dispatchEvent(new CustomEvent('yuvilab:xapi-completion', {
            detail: { componentId: trigger.component_id, unitId: trigger.unit_id },
          }))
          activitySeqRef.current += 1
          return
        }
        // The learner moved to a new screen — re-key instantly (schedules intro).
        if (trigger.type === 'screen_change') {
          applyQuestionKeyRef.current?.(trigger.question_key ?? null, 'push')
          return
        }
        // A teacher just sent praise while the child is in the app: fetch the
        // words and put the card up. The trigger carries no text — a client
        // that could supply it could forge a message from a teacher.
        if (trigger.type === 'kudos') {
          loadKudosRef.current?.({ open: true })
          return
        }
        if (NUDGE_TYPES.has(trigger.type)) {
          if (trigger.type !== 'idle') activitySeqRef.current += 1   // answer-evidence = engagement
          // A repeated misconception carries an alternative representation to
          // offer (720: serve it in a different form, not just talk).
          if (
            (trigger.type === 'misconception' || trigger.type === 'wheel_spinning')
            && trigger.alternative?.component_id
          ) {
            setPendingAlternative(trigger.alternative)
          }
          enqueueChatAction({ kind: 'nudge', trigger: trigger.type, targetQuestionKey: currentQuestionKeyRef.current })
        }
      },
      // On (re)connect, re-sync support state — triggers published during a
      // reconnect gap are not replayed by the server.
      () => { void syncSupportStateRef.current?.() },
    )
    return close
  }, [NUDGE_TYPES, enqueueChatAction, canReceiveTriggers])

  /* ── teacher praise ───────────────────────────────────────────────────────
     Three ways in, one card: on load (it may have arrived while they were
     away), on the live trigger, and from the bell — whose deep link carries
     `?kudos=`, which opens the panel and shows whatever is waiting. */
  const loadKudos = useCallback((options: { open?: boolean } = {}) => {
    if (!user?.roles?.includes('learner')) return
    getPendingKudos()
      .then((result) => {
        if (!result.kudos) return
        setPendingKudos(result.kudos)
        /* The gift was banked before this card existed, but nothing pushes a
           wallet change — so a child sitting in the app would read "20
           ניצוצות" on the card while the counter above it still showed the old
           number. Refresh as the card arrives, not only when it is dismissed. */
        if (result.kudos.sparks > 0) refreshRewards()
        if (options.open) open()
      })
      .catch(() => { /* praise is not worth an error state */ })
  }, [user, open, refreshRewards])
  loadKudosRef.current = loadKudos

  useEffect(() => { loadKudos() }, [loadKudos])

  useEffect(() => {
    if (!pathname.includes('kudos=')) return
    loadKudos({ open: true })
  }, [pathname, loadKudos])

  const ackKudos = useCallback(async () => {
    const current = pendingKudos
    setPendingKudos(null)          // optimistic: the child pressed OK
    if (!current) return
    /* A teacher's gift (#467) was banked before the card ever appeared, but
       nothing pushes a wallet change — there is no realtime topic for the
       balance, only this kudos nudge. Without a refresh here the counter in the
       top bar still shows the old number while the card says sparks arrived. */
    if (current.sparks > 0) refreshRewards()
    await acknowledgeKudos(current.id).catch(() => { /* server retries on reload */ })
    // Praise queues oldest-first, so a child who was away for a week reads one
    // card at a time rather than being handed a stack.
    loadKudos()
  }, [pendingKudos, loadKudos, refreshRewards])

  // The offer is scoped to the question it was raised on — drop it when the
  // learner moves to a new screen or component (including after accepting it),
  // so a stale "want to see it another way?" never trails into the next question.
  useEffect(() => { setPendingAlternative(null) }, [surface.component_id, currentQuestionKey])

  // "Learn it another way" now opens a generated, per-question explainer (slides
  // + Manim) instead of navigating to another Kata activity. The deck is cached
  // per question across all learners, so it is generated once and reused.
  const openExplainer = useCallback(() => {
    setPendingAlternative(null)
    setExplainerOpen(true)
  }, [])
  const closeExplainer = useCallback(() => setExplainerOpen(false), [])

  const dismissAlternative = useCallback(() => setPendingAlternative(null), [])

  // The explainer is scoped to the current question — close it when the learner
  // moves to a different question or component.
  useEffect(() => { setExplainerOpen(false) }, [surface.component_id, currentQuestionKey])

  // Lesson thread: ONE continuous view of THIS launch's live turns (`live-` ids;
  // a relaunch starts clean, history panel keeps the rest). The view no longer
  // clears on navigation — the panel groups these into collapsible per-question
  // sections (each tagged with its `questionKey`), so the learner keeps full
  // context with dividers marking where each question began.
  const visibleMessages = useMemo(() => {
    if (!activityScoped) return messages
    return messages.filter((m) => m.id.startsWith('live-'))
  }, [messages, activityScoped])

  // On a real question screen (item part of the key present), the per-question
  // intro replaces the generic greeting; on the cover frame it stays.
  const onQuestionFrame = activityScoped && Boolean(currentQuestionKey && currentQuestionKey.split('|')[1])
  const currentVideoItem = introParts(currentQuestionKey).item
  const currentVideoSupport = currentVideoItem
    ? videoSupportByItem[videoItemKey(currentVideoItem, itemGeneration)]
    : undefined
  const displayedSupportUsed = {
    ...supportUsed,
    videoSummary: currentVideoSupport?.summary ?? false,
    videoVisual: currentVideoSupport?.visual ?? false,
  }

  return (
    <CompanionContext.Provider
      value={{
        isOpen,
        isOpening,
        isClosing,
        panelWidth,
        setPanelWidth,
        open,
        finishOpening,
        close,
        toggle,
        messages: visibleMessages,
        conversations,
        activeConversationId,
        isStreaming,
        activeAssistantId,
        activity,
        unreadCount,
        preview: [...messages].reverse().find((message) => message.role === 'assistant' && message.text)?.text || null,
        disclosure,
        isLoadingConversations,
        isLoadingMessages,
        hasMoreConversations,
        hasMoreMessages,
        historyError,
        canStartNewConversation: !activityScoped
          && !isLoadingConversations,
        send,
        requestSupport,
        supportUsed: displayedSupportUsed,
        questionOrdinals,
        questionParts,
        teachingItems,
        itemKinds,
        itemMedia,
        itemOrder,
        currentQuestionKey,
        onQuestionFrame,
        pendingAlternative,
        pendingKudos,
        acknowledgeKudos: ackKudos,
        openExplainer,
        closeExplainer,
        explainerOpen,
        dismissAlternative,
        requestVisual,
        selectConversation,
        startNewConversation,
        deleteConversation,
        loadMoreConversations,
        loadMoreMessages,
        reloadHistory,
      }}
    >
      {children}
    </CompanionContext.Provider>
  )
}

export function useCompanion() {
  const value = useContext(CompanionContext)
  if (!value) throw new Error('useCompanion must be used inside CompanionProvider')
  return value
}
