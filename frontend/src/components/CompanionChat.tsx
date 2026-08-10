import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { useCompanion, type CoachMessage } from '../providers/CompanionProvider'
import { YuviAvatar3D } from '../features/Yuvi-studio/YuviAvatar3D'
import { useYuviDesign } from '../features/Yuvi-studio/YuviDesignProvider'
import { Icon } from './primitives'
import { CoachMarkdown } from './CoachMarkdown'
import { VisualCTA } from './VisualCTA'
import { YuviHeadIcon } from './YuviHeadIcon'
import { ThinkingOrbit } from './ThinkingOrbit'
import { QuestionExplainer } from './QuestionExplainer'
import type { VisualMode } from '../services/agents'
import type { CoachVisual } from '../services/agents'
import { rateCoachConversation, saveHelpedAttribution, coachSurfaceForPath, type HelpMethod } from '../services/agents'
import { playCoachSpeech, stopCoachSpeech, type SpeechState } from '../services/speech'
import { navigate, useRoute } from '../app/router'
import { formatMessageTime } from '../hooks/messageTime'
import { useLessonRoadmap } from '../providers/LessonRoadmapProvider'
import { CompanionTrack3D } from '../features/learning-portal/CompanionTrack3D'
import { VoiceCallPanel } from '../features/voice/VoiceCallPanel'
import 'katex/dist/katex.min.css'
import SceneRenderer from '../features/visuals/SceneRenderer'
import './companion.css'

interface MessageGroup {
  key: string
  /** Screen (item) + sub-question these messages belong to. */
  item: string
  question: string
  messages: CoachMessage[]
}

// Kata's catalog returned the first question of an item as a full object URL
// while its `answered` event carried plain `q1`, so messages stored before that
// was normalized server-side hold `…|<URL>` and would open a second thread for a
// question that already has one. Reading the tail heals those threads.
function questionPart(raw: string): string {
  return raw.includes('/') ? raw.replace(/\/+$/, '').split('/').pop() || raw : raw
}
function keyParts(key: string | null | undefined): { item: string; question: string } {
  const parts = (key || '').split('|')
  return { item: parts[1] || '', question: questionPart(parts[2] || '') }
}

// Group a thread into one section PER QUESTION — by identity, not adjacency.
//
// This used to merge only into the *last* group, so anything interleaved (a
// lesson-level message with no screen, or a reply that landed late) started a
// second section for a question that already had one. One question then read as
// two, and the running "שאלה N" counter drifted from the lesson: a thread about
// question 2 was headed "שאלה 4". Grouping by the screen itself means a question
// has exactly one section no matter what arrives between its messages.
//
// Two concrete sub-questions on one screen (q1 vs q2, סעיף א/ב) stay separate.
// A message tagged `…|item|` with no qN — the shape stored before the server
// resolved the screen's question — belongs to that screen's first sub-question.
// Keyed by the first message id so a section's collapse state survives.
function groupByQuestion(messages: CoachMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  const byItem = new Map<string, MessageGroup[]>()
  for (const m of messages) {
    const { item, question } = keyParts(m.questionKey)
    // Lesson-level messages (no screen) are the Introduction; they all belong
    // together however far apart they arrive.
    if (!item) {
      const intro = groups.find((g) => !g.item)
      if (intro) { intro.messages.push(m); continue }
      const created: MessageGroup = { key: m.id, item, question: '', messages: [m] }
      groups.push(created)
      continue
    }
    const siblings = byItem.get(item) || []
    const target = question
      ? siblings.find((g) => g.question === question || !g.question)
      : siblings[0]
    if (target) {
      target.messages.push(m)
      if (!target.question && question) target.question = question
      continue
    }
    const created: MessageGroup = { key: m.id, item, question, messages: [m] }
    groups.push(created)
    byItem.set(item, [...siblings, created])
  }
  return groups
}

/** 720 `mediaFormat` values the learner WATCHES rather than reads. */
const WATCHABLE = new Set(['video', 'audio', 'animation'])

const FENCED_BLOCK = /```[^\n]*\n?[\s\S]*?```/g
const SUGGESTION_KEYS = [
  'companion.suggestions.explain',
  'companion.suggestions.example',
  'companion.suggestions.practice',
] as const
const MIN_PANEL_WIDTH = 340
const MAX_PANEL_WIDTH = 720
const MIN_PAGE_WIDTH = 360

function maximumPanelWidth() {
  if (typeof window === 'undefined') return MAX_PANEL_WIDTH
  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - MIN_PAGE_WIDTH))
}

function clampPanelWidth(width: number) {
  return Math.max(MIN_PANEL_WIDTH, Math.min(maximumPanelWidth(), Math.round(width)))
}

function conversationPreview(text: string) {
  return text
    .replace(FENCED_BLOCK, '')
    .replace(/\\text\{([^{}]*)\}/g, '$1')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1⁄$2')
    .replace(/\\theta/g, 'θ')
    .replace(/\\(sin|cos|tan|log|sqrt)/g, '$1')
    .replace(/\\(?:left|right)/g, '')
    .replace(/\\[()[\]]/g, '')
    .replace(/\\[A-Za-z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\*\*|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}


/* Floating Learning Coach (F3) — present on every learner screen. Mature, calm,
   emoji-free (720-UIUX). Shows the mandatory AI-use disclosure; messages use
   dir="auto" for mixed-language content. */
export function CompanionChat() {
  const { t, direction, language } = useI18n()
  // "שאלה 2" on its own, or "שאלה 1 · סעיף ב" when the screen holds several
  // parts of one question. The part letters live in the locale because the
  // sequence is language-specific (א/ב/ג vs a/b/c vs أ/ب/ج).
  const questionLabel = useCallback((n: number, part?: number) => {
    const label = t('companion.thread.question', { n })
    if (!part) return label
    const letters = (t('companion.thread.partLetters') || '').split(',').map((s) => s.trim()).filter(Boolean)
    const letter = letters[part - 1] || String(part)
    return `${label} · ${t('companion.thread.part', { part: letter })}`
  }, [t])
  const {
    isOpen,
    isOpening,
    isClosing,
    panelWidth,
    setPanelWidth,
    close,
    messages,
    conversations,
    activeConversationId,
    isStreaming,
    activeAssistantId,
    activity,
    disclosure,
    isLoadingConversations,
    isLoadingMessages,
    hasMoreConversations,
    hasMoreMessages,
    historyError,
    canStartNewConversation,
    send,
    requestSupport,
    supportUsed,
    questionOrdinals,
    questionParts,
    teachingItems,
    itemKinds,
    itemMedia,
    currentQuestionKey,
    pendingAlternative,
    pendingKudos,
    acknowledgeKudos,
    openExplainer,
    closeExplainer,
    explainerOpen,
    requestVisual,
    selectConversation,
    startNewConversation,
    deleteConversation,
    loadMoreConversations,
    loadMoreMessages,
    reloadHistory,
  } = useCompanion()
  const pathname = useRoute()
  // Spoken practice is a mode of the same conversation, not a second companion.
  const [voiceOpen, setVoiceOpen] = useState(false)
  const isTaskMode = pathname.startsWith('/learning/lesson')
  const { snapshot: lessonRoadmap } = useLessonRoadmap()
  const { design, loaded } = useYuviDesign()
  const [draft, setDraft] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fullscreenAnim, setFullscreenAnim] = useState<'in' | 'out' | null>(null)
  const fullscreenAnimTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showLiveYuvi, setShowLiveYuvi] = useState(false)
  const [YuviFallbackReady, setYuviFallbackReady] = useState(false)
  const [settleHeaderYuvi, setSettleHeaderYuvi] = useState(false)
  const [expandedVisual, setExpandedVisual] = useState<CoachVisual | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [taskView, setTaskView] = useState<'chat' | 'roadmap'>('chat')
  const [speech, setSpeech] = useState<{ messageId: string | null; state: SpeechState }>({
    messageId: null,
    state: 'idle',
  })
  // Per-message like/dislike (MoE `conversation/rated`); local echo of what the
  // learner tapped so the choice stays visible. Report-and-forget server-side.
  const [messageRatings, setMessageRatings] = useState<Record<string, 'like' | 'dislike'>>({})
  // "What helped you?" chip selections per success message (green when picked).
  // Multi-select; each toggle re-saves the full set (idempotent upsert server-side).
  const [helpedPicks, setHelpedPicks] = useState<Record<string, HelpMethod[]>>({})
  // Per-question section grouping for the lesson thread (kept above the early
  // return below so hook order stays stable — Rules of Hooks).
  const messageGroups = useMemo(() => groupByQuestion(messages), [messages])
  // "מה עזר לך?" is asked ONCE per question, under the message that congratulated
  // them. A second success on the same question (or a later one, after they had
  // gone on chatting) used to bring the chips back a second time, which reads as
  // the chat forgetting it already asked.
  const chipAnchors = useMemo(() => {
    const firstPerQuestion = new Map<string, string>()
    for (const m of messages) {
      if (m.role !== 'assistant' || !m.attribution) continue
      const key = m.attribution.questionKey || m.questionKey || ''
      if (!firstPerQuestion.has(key)) firstPerQuestion.set(key, m.id)
    }
    return new Set(firstPerQuestion.values())
  }, [messages])
  // Label each section: a group with no screen (item) is the lesson Introduction
  // (welcome); groups tied to a screen are the questions, numbered in order.
  const sections = useMemo(() => {
    let seen = 0
    return messageGroups.map((group) => {
      const isIntro = group.item === ''
      if (!isIntro) seen += 1
      // Not every screen asks something: a component can teach on a screen and
      // move on (`…-01-04-006`). Captioning that "question N" invents a question
      // the learner never saw, so those threads are a learning STEP instead.
      // A screen that ASKS but is a video (`…-01-01-003`) is captioned for the
      // medium too — the question lives inside the clip, and naming the thread
      // "שאלה 3" while the video plays describes something not reached yet.
      const kind = itemKinds[group.item]
      const isTeaching = !isIntro && (kind ? kind !== 'question' : teachingItems.includes(group.item))
      const asksNothing = !isIntro && teachingItems.includes(group.item)
      // The lesson's own numbering wins: "שאלה 3" should mean the third question
      // of the component, which is what the learner sees in the content. Keyed by
      // item+question because one screen can carry several (…-01-05 holds q1–q4);
      // the item-only key covers single-question screens. The encounter counter
      // is a fallback for a component the catalog has no snapshot for — never the
      // primary source, because it drifts the moment a question produces anything
      // but exactly one section.
      const catalogNumber = isIntro ? undefined : (
        questionOrdinals[`${group.item}|${group.question}`] ?? questionOrdinals[group.item]
      )
      // The encounter counter is a fallback for a component the catalog has no
      // snapshot for — NEVER a second opinion next to it. Numbering one thread
      // by the catalog and the next by its position produced two threads both
      // captioned "שאלה 3"; a thread the catalog cannot number is captioned as
      // a step instead of being given a number that belongs to another question.
      const hasCatalog = Object.keys(questionOrdinals).length > 0
      const questionNumber = catalogNumber ?? (hasCatalog ? undefined : seen)
      // Some screens hold several סעיפים of ONE question (`…-01-02-001` holds two,
      // `…-01-05-001` holds four). Each part keeps its own thread — Yuvi opens
      // each one — but the caption must say which סעיף of which question it is,
      // because that is what the player's own nav shows the learner.
      const partIndex = isIntro ? undefined : questionParts[`${group.item}|${group.question}`]
      // A question screen can still be a video screen — the thread shows it.
      const plays = WATCHABLE.has(itemMedia[group.item] || '')
      return { group, isIntro, isTeaching, asksNothing, kind, questionNumber, partIndex, plays }
    })
  }, [messageGroups, questionOrdinals, questionParts, teachingItems, itemKinds, itemMedia])
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, boolean>>({})
  const bodyRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const preserveScroll = useRef<{ height: number; top: number } | null>(null)
  const stickToBottom = useRef(true)

  // Full screen swaps the panel between two very different layouts, so a wipe
  // from the docked edge keeps the change readable instead of snapping.
  const changeFullscreen = (next: boolean) => {
    if (isFullscreen === next) return
    setIsFullscreen(next)
    setFullscreenAnim(next ? 'in' : 'out')
    if (fullscreenAnimTimer.current) window.clearTimeout(fullscreenAnimTimer.current)
    fullscreenAnimTimer.current = window.setTimeout(() => setFullscreenAnim(null), 420)
  }

  // Closing from full screen first shrinks back to the docked panel, so Yuvi's
  // shove-out animation still plays where the learner can see it.
  const requestClose = () => {
    if (!isFullscreen) {
      close()
      return
    }
    changeFullscreen(false)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => close(), 360)
  }

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    if (preserveScroll.current) {
      const anchor = preserveScroll.current
      body.scrollTop = anchor.top + body.scrollHeight - anchor.height
      preserveScroll.current = null
      return
    }
    if (stickToBottom.current || isStreaming) body.scrollTop = body.scrollHeight
  }, [activeConversationId, isStreaming, messages])

  useEffect(() => {
    if (!isOpen) return
    if (!isOpening && !isClosing && !historyOpen) inputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (expandedVisual) setExpandedVisual(null)
      else if (deletePendingId) setDeletePendingId(null)
      else if (isFullscreen) changeFullscreen(false)
      else if (historyOpen) setHistoryOpen(false)
      else if (!isTaskMode) close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, deletePendingId, expandedVisual, historyOpen, isClosing, isFullscreen, isOpen, isOpening, isTaskMode])

  useEffect(() => {
    const onResize = () => setPanelWidth(clampPanelWidth(panelWidth))
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [panelWidth, setPanelWidth])

  useEffect(() => {
    document.body.classList.toggle('is-resizing-companion', isResizing)
    return () => document.body.classList.remove('is-resizing-companion')
  }, [isResizing])

  useEffect(() => {
    if (!isOpen) {
      stopCoachSpeech()
      setSpeech({ messageId: null, state: 'idle' })
      setShowLiveYuvi(false)
      setSettleHeaderYuvi(false)
      setIsFullscreen(false)
      return
    }

    if (isOpening) {
      setShowLiveYuvi(false)
      setSettleHeaderYuvi(true)
      // Pre-mount the header avatar behind the incoming panel before the
      // travelling avatar docks, so Yuvi never vanishes during the handoff.
      const preload = window.setTimeout(() => setShowLiveYuvi(true), 900)
      return () => window.clearTimeout(preload)
    }

    setShowLiveYuvi(true)
    setSettleHeaderYuvi(true)
    const settle = window.setTimeout(() => setSettleHeaderYuvi(false), 320)
    return () => window.clearTimeout(settle)
  }, [isOpen, isOpening])

  useEffect(() => {
    if (!isOpen || loaded) return
    const fallbackTimer = window.setTimeout(() => setYuviFallbackReady(true), 900)
    return () => window.clearTimeout(fallbackTimer)
  }, [isOpen, loaded])

  useEffect(() => () => {
    stopCoachSpeech()
    if (fullscreenAnimTimer.current) window.clearTimeout(fullscreenAnimTimer.current)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
  }, [])

  useEffect(() => {
    if (!isTaskMode) setTaskView('chat')
    else setIsFullscreen(false)
  }, [isTaskMode, pathname])

  // While the chat covers the page, the page behind it must not scroll.
  useEffect(() => {
    if (!isFullscreen) return
    document.body.classList.add('is-companion-fullscreen')
    return () => document.body.classList.remove('is-companion-fullscreen')
  }, [isFullscreen])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.trim() || isStreaming) return
    void send(draft)
    setDraft('')
  }

  const onMessageScroll = () => {
    const body = bodyRef.current
    if (!body) return
    stickToBottom.current = body.scrollHeight - body.scrollTop - body.clientHeight < 72
    if (body.scrollTop > 64 || !hasMoreMessages || isLoadingMessages) return
    preserveScroll.current = { height: body.scrollHeight, top: body.scrollTop }
    void loadMoreMessages()
  }

  const onHistoryScroll = () => {
    const list = historyRef.current
    if (!list || !hasMoreConversations || isLoadingConversations) return
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 90) {
      void loadMoreConversations()
    }
  }

  const openConversation = async (conversationId: string) => {
    if (isStreaming) return
    stickToBottom.current = true
    await selectConversation(conversationId)
    setHistoryOpen(false)
  }

  const createConversation = async () => {
    if (isStreaming) return
    stickToBottom.current = true
    await startNewConversation()
    setHistoryOpen(false)
  }

  const confirmDeleteConversation = async (conversationId: string) => {
    if (isStreaming || deletingId) return
    setDeletingId(conversationId)
    const deleted = await deleteConversation(conversationId)
    setDeletingId(null)
    if (deleted) setDeletePendingId(null)
  }

  const activeConversation = conversations.find((item) => item.id === activeConversationId)
  // Full-screen reading mode: the transcript fills the viewport and the
  // conversation history sits permanently in a side rail.
  const fullscreen = isFullscreen && !isTaskMode
  const newConversationDisabled = isStreaming || !canStartNewConversation
  const newConversationLabel = canStartNewConversation
    ? t('companion.history.new')
    : t('companion.history.newUnavailable')
  const formatDate = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat(language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  if (!isOpen) return null

  const toggleSpeech = (messageId: string, text: string, textAfter?: string) => {
    if (speech.messageId === messageId && speech.state !== 'idle') {
      stopCoachSpeech()
      setSpeech({ messageId: null, state: 'idle' })
      return
    }
    const speakableText = [text, textAfter].filter(Boolean).join('\n\n')
    void playCoachSpeech(
      speakableText,
      language,
      design.variant,
      (state) => setSpeech({ messageId: state === 'idle' ? null : messageId, state }),
      activeConversationId || 'default',
      messageId,
    ).catch(() => setSpeech({ messageId: null, state: 'idle' }))
  }

  const rateMessage = (messageId: string, rating: 'like' | 'dislike') => {
    setMessageRatings((current) => ({ ...current, [messageId]: rating }))
    // The conversation is the MoE rating object; repeated ratings are fine
    // (latest wins). Failure is silent — the local echo still reflects the tap.
    void rateCoachConversation(activeConversationId || 'default', rating).catch(() => {})
  }

  const HELPED_ORDER: HelpMethod[] = ['hint', 'explanation', 'yuvi_chat']

  const toggleHelped = (messageId: string, attribution: NonNullable<CoachMessage['attribution']>, method: HelpMethod) => {
    setHelpedPicks((current) => {
      const picked = current[messageId] ?? []
      const next = picked.includes(method) ? picked.filter((m) => m !== method) : [...picked, method]
      const [component_id, item_id, question_id] = (attribution.questionKey || '').split('|')
      // Latest full set wins server-side; local echo keeps the green state even if it fails.
      void saveHelpedAttribution({ component_id, item_id, question_id, methods: next }).catch(() => {})
      return { ...current, [messageId]: next }
    })
  }

  const helpedChips = (key: string, attribution: NonNullable<CoachMessage['attribution']>) => {
    const methods = HELPED_ORDER.filter((m) => attribution.methods.includes(m))
    if (!methods.length) return null
    const picked = helpedPicks[key] ?? []
    return (
      <div className="sp-companion__helped" role="group" aria-label={t('companion.helped.title')}>
        <p className="sp-companion__helped-title">{t('companion.helped.title')}</p>
        <div className="sp-companion__helped-chips">
          {methods.map((method) => (
            <button
              key={method}
              type="button"
              className={`sp-companion__helped-chip${picked.includes(method) ? ' is-picked' : ''}`}
              onClick={() => toggleHelped(key, attribution, method)}
              aria-pressed={picked.includes(method)}
            >
              <span className="sp-companion__helped-check" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false"><path d="m5 13 4 4L19 7" /></svg>
              </span>
              <span>{t(`companion.helped.${method}`)}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const assistantMessage = (
    text: string,
    key?: string,
    visual?: CoachVisual,
    isVisualizing?: boolean,
    textAfter?: string,
    isComplete = true,
    visualFailed?: boolean,
    canVisualize?: boolean,
    createdAt?: string,
    attribution?: CoachMessage['attribution'],
  ) => (
    <div
      className="sp-companion__message-row sp-companion__message-row--assistant"
      data-message-complete={isComplete ? 'true' : 'false'}
      key={key}
    >
      <span className={`sp-companion__message-avatar${key === activeAssistantId && !text ? ' is-thinking' : ''}`}>
        <YuviHeadIcon />
      </span>
      <div className="sp-companion__message-stack">
        <div className="sp-companion__msg sp-companion__msg--assistant" dir="auto">
          {isComplete && text && key && (
            <button
              type="button"
              className={`sp-companion__speech${speech.messageId === key ? ' is-active' : ''}${speech.messageId === key && speech.state === 'playing' ? ' is-playing' : ''}`}
              onClick={() => toggleSpeech(key, text, textAfter)}
              aria-label={speech.messageId === key && speech.state !== 'idle'
                ? t('companion.speech.stop')
                : t('companion.speech.play')}
              title={speech.messageId === key && speech.state === 'preparing'
                ? t('companion.speech.preparing')
                : speech.messageId === key && speech.state !== 'idle'
                  ? t('companion.speech.stop')
                  : t('companion.speech.play')}
            >
              {speech.messageId === key && speech.state === 'preparing' ? (
                <span className="sp-companion__speech-spinner" aria-hidden="true" />
              ) : speech.messageId === key && speech.state === 'playing' ? (
                // Reading aloud — a red stop square the learner can tap to stop.
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="sp-companion__speech-stop">
                  <rect x="6.5" y="6.5" width="11" height="11" rx="2.6" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M8.5 21h7" />
                </svg>
              )}
            </button>
          )}
          {text ? <CoachMarkdown text={text} /> : (key === activeAssistantId
            ? <ThinkingOrbit label={t('companion.thinking')} />
            : '')}
          {isVisualizing && (
            <div className="sp-companion__visual-status" role="status">
              <span className="sp-companion__visual-spinner" aria-hidden="true" />
              {t('companion.visualizing')}
            </div>
          )}
          {visual && (
            <figure
              className="sp-companion__visual"
              data-renderer={visual.renderer}
              data-visual-scene={JSON.stringify(visual.scene)}
            >
              <button
                type="button"
                className="sp-companion__visual-open"
                onClick={() => setExpandedVisual(visual)}
                aria-label={t('companion.visual.open')}
              >
                <SceneRenderer visual={visual} />
                <span className="sp-companion__visual-zoom" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <circle cx="10.5" cy="10.5" r="5.5" />
                    <path d="m15 15 5 5M10.5 7.8v5.4M7.8 10.5h5.4" />
                  </svg>
                  <span>{t('companion.visual.zoom')}</span>
                </span>
              </button>
              {visual.caption && <figcaption dir="auto">{visual.caption}</figcaption>}
            </figure>
          )}
          {textAfter && <CoachMarkdown text={textAfter} />}
          {isComplete && key && !visual && !isVisualizing && (visualFailed || canVisualize) && (
            <VisualCTA
              failed={visualFailed}
              onRequest={(mode: VisualMode) => void requestVisual(key, mode)}
            />
          )}
        </div>
        {text && (createdAt || (isComplete && key)) && (
          <div className="sp-companion__msg-footer">
            {createdAt && (
              <time className="sp-companion__msg-time" dateTime={createdAt}>
                {formatMessageTime(createdAt, language)}
              </time>
            )}
            {isComplete && key && (
              <span className="sp-companion__rate" role="group" aria-label={t('companion.rate.label')}>
                <button
                  type="button"
                  className={messageRatings[key] === 'like' ? 'is-active' : ''}
                  onClick={() => rateMessage(key, 'like')}
                  aria-label={t('companion.rate.like')}
                  aria-pressed={messageRatings[key] === 'like'}
                  title={t('companion.rate.like')}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M7 10.5v9M7 19.5H4.6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H7m0 9 3.2.9a6 6 0 0 0 1.6.2h4.3a2 2 0 0 0 2-1.6l1.1-5.2a1.6 1.6 0 0 0-1.6-1.9h-4.4l.7-3.4a1.9 1.9 0 0 0-3.4-1.5L7 10.5" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={messageRatings[key] === 'dislike' ? 'is-active' : ''}
                  onClick={() => rateMessage(key, 'dislike')}
                  aria-label={t('companion.rate.dislike')}
                  aria-pressed={messageRatings[key] === 'dislike'}
                  title={t('companion.rate.dislike')}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ transform: 'rotate(180deg)' }}>
                    <path d="M7 10.5v9M7 19.5H4.6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H7m0 9 3.2.9a6 6 0 0 0 1.6.2h4.3a2 2 0 0 0 2-1.6l1.1-5.2a1.6 1.6 0 0 0-1.6-1.9h-4.4l.7-3.4a1.9 1.9 0 0 0-3.4-1.5L7 10.5" />
                  </svg>
                </button>
              </span>
            )}
          </div>
        )}
        {isComplete && key && attribution && chipAnchors.has(key) && helpedChips(key, attribution)}
      </div>
    </div>
  )

  const renderMessage = (m: CoachMessage) => (
    m.role === 'assistant'
      ? assistantMessage(m.text, m.id, m.visual, m.isVisualizing, m.textAfter, m.isComplete, m.visualFailed, m.canVisualize, m.createdAt, m.attribution)
      : (
        <div key={m.id} className="sp-companion__message-row sp-companion__message-row--user">
          <div className="sp-companion__message-stack sp-companion__message-stack--user">
            <div className="sp-companion__msg sp-companion__msg--user" dir="auto">{m.text}</div>
            {m.createdAt && (
              <time className="sp-companion__msg-time" dateTime={m.createdAt}>
                {formatMessageTime(m.createdAt, language)}
              </time>
            )}
          </div>
        </div>
      )
  )

  // Per-question sections for the lesson thread. Default: the section for the
  // question the learner is ON is open; the rest collapse to their header. The
  // learner can toggle any section. (messageGroups/sectionOverrides are declared
  // with the other hooks above the early return — Rules of Hooks.)
  //
  // "Current" is the LIVE screen, not the last section in the list. Paging back
  // in the iframe is a normal thing to do, and it used to leave the marker and
  // the open accordion pinned to the furthest question the learner had reached —
  // so going back showed them the wrong thread, and Yuvi's next message appeared
  // to open a section ahead of where they were looking.
  const liveItem = keyParts(currentQuestionKey).item
  const liveGroup = liveItem ? messageGroups.find((g) => g.item === liveItem) : undefined
  // Marked ONLY when a thread for the live screen exists. On a question Yuvi has
  // not spoken about there is nothing to mark, and pointing at the newest thread
  // instead would tell the learner they are somewhere they are not — the exact
  // mismatch this whole pass is about. Nothing marked is honest; wrong is not.
  const currentGroupKey = liveGroup?.key ?? (liveItem ? '' : messageGroups[messageGroups.length - 1]?.key ?? '')
  // Expansion is a usability default, not a claim about position: keep the most
  // recent thread readable when the live screen has no thread of its own.
  const openGroupKey = currentGroupKey || messageGroups[messageGroups.length - 1]?.key || ''
  // A thread Yuvi is still WRITING in stays open, wherever the learner has since
  // navigated. Answering and moving straight on is normal — but the reaction to
  // that answer belongs to the question it is about, and collapsing the thread
  // mid-sentence left the panel "thinking" with nothing to read, as if the turn
  // had been lost. The learner can still collapse it by hand.
  const streamingKey = messageGroups.find(
    (g) => g.messages.some((m) => m.role === 'assistant' && !m.isComplete),
  )?.key
  const isSectionOpen = (g: MessageGroup) =>
    sectionOverrides[g.key] ?? (g.key === openGroupKey || g.key === streamingKey)
  // A hint or a deeper explanation is help with a QUESTION, so the buttons
  // follow the THREAD on screen: the open section has to be a section about a
  // question. The lesson intro and a pure teaching screen (a video, a reading, a
  // simulation) have nothing to be hinted at, and offering help there produces
  // an answer to a question the learner cannot see.
  //
  // A screen that plays a video AND asks still counts — its section is captioned
  // "סרטון · שאלה N", the question is real, and its hint has to stay.
  const activeSection = sections.find((s) => s.group.key === (currentGroupKey || openGroupKey))
  const openSectionAsks = activeSection
    ? !activeSection.isIntro && !activeSection.asksNothing
      && (activeSection.kind === 'question' || activeSection.questionNumber !== undefined)
    // No thread yet (Yuvi has not opened the screen) — fall back to the lesson's
    // own position rather than hiding help the learner may already need.
    : !(Boolean(liveItem) && teachingItems.includes(liveItem))
  const toggleSection = (key: string, open: boolean) =>
    setSectionOverrides((prev) => ({ ...prev, [key]: open }))

  return (
    <>
    {!isTaskMode && <div
      className={`sp-companion-backdrop${isOpening ? ' is-opening' : ''}${isClosing ? ' is-closing' : ''}`}
      aria-hidden="true"
      onPointerDown={close}
    />}
    <div
      className={`sp-companion-slot${isTaskMode ? ' sp-companion-slot--task' : ''}${fullscreen ? ' is-fullscreen' : ''}${isOpening ? ' is-opening' : ''}${isClosing ? ' is-closing' : ''}`}
      style={{ '--sp-companion-width': `${panelWidth}px` } as CSSProperties}
    >
    <section
      id="Yuvi-companion-panel"
      className={`sp-companion${isTaskMode ? ' sp-companion--task' : ''}${fullscreen ? ' is-fullscreen' : ''}${fullscreenAnim ? ` is-fs-${fullscreenAnim}` : ''}${isOpening ? ' is-opening' : ''}${isClosing ? ' is-closing' : ''}${isResizing ? ' is-resizing' : ''}`}
      role="dialog"
      aria-labelledby="Yuvi-companion-title"
      dir={direction}
      data-opening={isOpening ? 'true' : 'false'}
      data-closing={isClosing ? 'true' : 'false'}
      style={{ '--sp-companion-width': `${panelWidth}px` } as CSSProperties}
    >
      {!isTaskMode && !fullscreen && <div
        className="sp-companion__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('companion.resize')}
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={maximumPanelWidth()}
        aria-valuenow={panelWidth}
        tabIndex={0}
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setIsResizing(true)
        }}
        onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (!isResizing || !event.currentTarget.hasPointerCapture(event.pointerId)) return
          const panelRight = event.currentTarget.parentElement?.getBoundingClientRect().right || window.innerWidth
          setPanelWidth(clampPanelWidth(panelRight - event.clientX))
        }}
        onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          setIsResizing(false)
        }}
        onPointerCancel={() => setIsResizing(false)}
        onKeyDown={(event) => {
          let next = panelWidth
          if (event.key === 'ArrowLeft') next += 16
          else if (event.key === 'ArrowRight') next -= 16
          else if (event.key === 'Home') next = MIN_PANEL_WIDTH
          else if (event.key === 'End') next = maximumPanelWidth()
          else return
          event.preventDefault()
          setPanelWidth(clampPanelWidth(next))
        }}
      />}
      <header className="sp-companion__head">
        {isTaskMode && (
          <div
            className="sp-companion__yuvi-stage"
            data-yuvi-activity={speech.state === 'playing' ? 'speaking' : activity}
            aria-hidden="true"
          >
            <span className="sp-companion__yuvi-orbit" />
            {(loaded || YuviFallbackReady) && showLiveYuvi ? (
              <YuviAvatar3D
                key={loaded ? 'persisted-yuvi' : 'fallback-yuvi'}
                initialDesign={design}
                label={t('companion.title')}
                muted
                frontFacing={settleHeaderYuvi}
                followPointer
                thinking={activity === 'thinking'}
                speaking={activity === 'speaking' || speech.state === 'playing'}
              />
            ) : (
              <span className="sp-companion__yuvi-loader" role="presentation" />
            )}
          </div>
        )}
        <div className="sp-companion__id">
          <span className="sp-companion__avatar"><YuviHeadIcon /></span>
          <div>
            <p id="Yuvi-companion-title" className="sp-companion__title">{t('companion.title')}</p>
            <p className="sp-companion__subtitle">{t('companion.subtitle')}</p>
          </div>
        </div>
        {!isTaskMode && <div className="sp-companion__head-actions">
          <button
            type="button"
            className={`sp-companion__head-action${historyOpen ? ' is-active' : ''}`}
            onClick={() => setHistoryOpen((value) => !value)}
            aria-label={t('companion.history.open')}
            data-tooltip={t('companion.history.open')}
            hidden={fullscreen}
          >
            <Icon name="clock" size={18} />
          </button>
          <button
            type="button"
            className="sp-companion__head-action"
            onClick={() => void createConversation()}
            disabled={newConversationDisabled}
            aria-label={newConversationLabel}
            data-tooltip={newConversationLabel}
          >
            <Icon name="plus" size={18} />
          </button>
          <button
            type="button"
            className={`sp-companion__head-action${fullscreen ? ' is-active' : ''}`}
            onClick={() => changeFullscreen(!fullscreen)}
            aria-pressed={fullscreen}
            aria-label={fullscreen ? t('companion.collapse') : t('companion.expand')}
            data-tooltip={fullscreen ? t('companion.collapse') : t('companion.expand')}
          >
            <Icon name={fullscreen ? 'collapse' : 'expand'} size={18} />
          </button>
          <button
            type="button"
            className="sp-companion__close"
            onClick={requestClose}
            aria-label={t('companion.close')}
            data-tooltip={t('companion.close')}
          >
            <Icon name="close" size={18} />
          </button>
        </div>}
      </header>

      <p className="sp-companion__disclosure" dir="auto">
        <Icon name="lock" size={13} strokeWidth={2} aria-hidden="true" />
        {disclosure || t('companion.disclosure')}
      </p>

      {isTaskMode && (
        <div className="sp-companion__task-tabs" role="tablist" aria-label={t('companion.task.tabs')}>
          <button
            type="button"
            role="tab"
            aria-selected={taskView === 'chat'}
            className={taskView === 'chat' ? 'is-active' : ''}
            onClick={() => setTaskView('chat')}
          >
            <Icon name="message" size={16} />
            <span>{t('companion.task.tabChat')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={taskView === 'roadmap'}
            className={taskView === 'roadmap' ? 'is-active' : ''}
            onClick={() => setTaskView('roadmap')}
          >
            <Icon name="spark" size={16} />
            <span>{t('companion.task.tabRoadmap')}</span>
          </button>
        </div>
      )}

      {(historyOpen || fullscreen) && !isTaskMode && (
        <section className="sp-companion__history" aria-labelledby="companion-history-title">
          <div className="sp-companion__history-heading">
            <div>
              <h2 id="companion-history-title">{t('companion.history.title')}</h2>
              <p>{t('companion.history.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={() => void createConversation()}
              disabled={newConversationDisabled}
              title={newConversationLabel}
            >
              <Icon name="plus" size={17} />
              <span>{t('companion.history.new')}</span>
            </button>
          </div>
          <div className="sp-companion__history-list" ref={historyRef} onScroll={onHistoryScroll}>
            {historyError && !conversations.length && (
              <div className="sp-companion__history-state" role="alert">
                <Icon name="alert" size={23} />
                <p>{t('companion.history.error')}</p>
                <button type="button" onClick={() => void reloadHistory()}>{t('companion.history.retry')}</button>
              </div>
            )}
            {!historyError && !isLoadingConversations && conversations.length === 0 && (
              <div className="sp-companion__history-state">
                <Icon name="message" size={25} />
                <p>{t('companion.history.empty')}</p>
              </div>
            )}
            {conversations.map((conversation) => (
              <article
                className={`sp-companion__conversation${conversation.id === activeConversationId ? ' is-active' : ''}`}
                key={conversation.id}
              >
                {deletePendingId === conversation.id ? (
                  <div
                    className="sp-companion__conversation-confirm"
                    role="alertdialog"
                    aria-label={t('companion.history.delete')}
                  >
                    <Icon name="trash" size={19} />
                    <p>{t('companion.history.deleteConfirm')}</p>
                    <div>
                      <button
                        type="button"
                        onClick={() => setDeletePendingId(null)}
                        disabled={deletingId === conversation.id}
                        autoFocus
                      >
                        {t('companion.history.cancel')}
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => void confirmDeleteConversation(conversation.id)}
                        disabled={deletingId === conversation.id}
                      >
                        {deletingId === conversation.id
                          ? t('companion.history.deleting')
                          : t('companion.history.confirmDelete')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="sp-companion__conversation-open"
                      onClick={() => void openConversation(conversation.id)}
                      disabled={isStreaming}
                      aria-current={conversation.id === activeConversationId ? 'page' : undefined}
                      aria-label={t('companion.history.openConversation', {
                        title: conversation.title || t('companion.history.untitled'),
                      })}
                    >
                      <span className="sp-companion__conversation-icon"><Icon name="message" size={18} /></span>
                      <span className="sp-companion__conversation-copy">
                        <strong dir="auto">{conversation.title || t('companion.history.untitled')}</strong>
                        <small dir="auto">{conversation.preview
                          ? conversationPreview(conversation.preview)
                          : t('companion.history.emptyConversation')}</small>
                        <span>
                          <time dateTime={conversation.updated_at}>{formatDate(conversation.updated_at)}</time>
                          <i aria-hidden="true" />
                          {t('companion.history.messageCount', { count: conversation.message_count })}
                        </span>
                      </span>
                      <Icon name="arrow" size={16} className="sp-companion__conversation-arrow" />
                    </button>
                    <button
                      type="button"
                      className="sp-companion__conversation-delete"
                      onClick={() => setDeletePendingId(conversation.id)}
                      disabled={isStreaming}
                      aria-label={t('companion.history.deleteConversation', {
                        title: conversation.title || t('companion.history.untitled'),
                      })}
                      data-tooltip={t('companion.history.delete')}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </>
                )}
              </article>
            ))}
            {isLoadingConversations && (
              <div className="sp-companion__history-loader" role="status">
                <span aria-hidden="true" />
                {t('companion.history.loading')}
              </div>
            )}
          </div>
        </section>
      )}
      {(!historyOpen || fullscreen) && (
        <>
          {!isTaskMode && !fullscreen && <div className="sp-companion__thread-bar">
            <span><Icon name="message" size={15} /></span>
            <div>
              <small>{t('companion.history.current')}</small>
              <strong dir="auto">{activeConversation?.title || t('companion.history.untitled')}</strong>
            </div>
            <button type="button" onClick={() => setHistoryOpen(true)}>{t('companion.history.open')}</button>
          </div>}
          {isTaskMode && taskView === 'roadmap' && lessonRoadmap ? (
            <div className="sp-companion__roadmap-view" role="tabpanel">
              <CompanionTrack3D
                unit={lessonRoadmap.unit}
                activeComponentId={lessonRoadmap.activeComponentId}
                travellingFromId={lessonRoadmap.travellingFromId}
                onSelect={(component) => {
                  const params = new URLSearchParams({
                    unit: lessonRoadmap.unit.id,
                    component: component.id,
                  })
                  navigate(`/learning/lesson?${params.toString()}`)
                }}
              />
            </div>
          ) : taskView === 'chat' && <div
            className="sp-companion__body"
            ref={bodyRef}
            onScroll={onMessageScroll}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {isLoadingMessages && (
              <div className="sp-companion__messages-loader" role="status">
                <span aria-hidden="true" />
                {t('companion.history.loadingMessages')}
              </div>
            )}
            {/* In a lesson the view is this launch's live turns only — a
                "scroll up for older messages" hint would be noise there. */}
            {!isTaskMode && hasMoreMessages && !isLoadingMessages && (
              <p className="sp-companion__more-hint">{t('companion.history.scrollForMore')}</p>
            )}
            {/* In a lesson, the welcome / per-question intro carries the greeting,
                so the generic greeting only shows in the general companion. */}
            {!isTaskMode && !isLoadingMessages && messages.length === 0 && assistantMessage(t('companion.greeting'))}
            {isTaskMode
              ? sections.map(({ group, isIntro, isTeaching, asksNothing, kind, questionNumber, partIndex, plays }) => {
                  const open = isSectionOpen(group)
                  const isCurrent = group.key === currentGroupKey
                  return (
                    <section
                      key={group.key}
                      className={`sp-companion__qsection${isCurrent ? ' is-current' : ''}${open ? '' : ' is-collapsed'}`}
                      // Which screen this thread belongs to, and the number the
                      // learner sees for it — so a mismatch between the chat and
                      // the content is visible in the DOM instead of guessed at.
                      data-item={group.item || undefined}
                      data-question-number={isIntro || asksNothing ? undefined : questionNumber}
                      data-teaching={isTeaching ? 'true' : undefined}
                      data-kind={kind || undefined}
                    >
                      {sections.length > 1 && (
                        <button
                          type="button"
                          className="sp-companion__qdivider"
                          onClick={() => toggleSection(group.key, !open)}
                          aria-expanded={open}
                        >
                          <span className="sp-companion__qdivider-rule" aria-hidden="true" />
                          <span className="sp-companion__qdivider-chip">
                            <svg
                              className={`sp-companion__qchevron${open ? ' is-open' : ''}`}
                              viewBox="0 0 24 24" aria-hidden="true" focusable="false"
                            >
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                            {plays && !isIntro && (
                              <Icon name="play" size={12} aria-label={t('companion.thread.watch')} />
                            )}
                            {/* Captioned for what the screen IS. A video that also
                                asks keeps its number alongside the medium, so the
                                thread is honest about both. */}
                            <span>{
                              isIntro ? t('companion.thread.intro')
                                : kind === 'watch' || kind === 'read' ? [
                                    t(kind === 'watch' ? 'companion.thread.watch' : 'companion.thread.read'),
                                    questionNumber ? questionLabel(questionNumber, partIndex) : '',
                                  ].filter(Boolean).join(' · ')
                                : asksNothing || !questionNumber ? t('companion.thread.step')
                                : questionLabel(questionNumber, partIndex)
                            }</span>
                            {!open && <span className="sp-companion__qcount">{group.messages.length}</span>}
                          </span>
                          <span className="sp-companion__qdivider-rule" aria-hidden="true" />
                        </button>
                      )}
                      {open && group.messages.map(renderMessage)}
                    </section>
                  )
                })
              : messages.map(renderMessage)}
          </div>}
        </>
      )}

      {/* ── a word from a teacher ──────────────────────────────────────────
          Not a coach turn: a card over the conversation, carrying the
          teacher's own sentence, that stays until the child acknowledges it.
          Praise from a named adult should not scroll away unread. */}
      {pendingKudos && (
        <div className="sp-companion__kudos" role="dialog" aria-modal="true"
             aria-label={t('companion.kudos.title')}>
          <div className="sp-companion__kudos-card">
            <span className="sp-companion__kudos-glow" aria-hidden="true" />
            <YuviHeadIcon width={44} height={44} className="sp-companion__kudos-face" />
            <p className="sp-companion__kudos-eyebrow">
              {pendingKudos.teacher_name
                ? t('companion.kudos.fromNamed', { name: pendingKudos.teacher_name })
                : t('companion.kudos.from')}
            </p>
            <p className="sp-companion__kudos-message" dir="auto">{pendingKudos.message}</p>
            {pendingKudos.created_at && (
              <time className="sp-companion__kudos-time" dateTime={pendingKudos.created_at}>
                {formatMessageTime(pendingKudos.created_at, language)}
              </time>
            )}
            <button
              type="button"
              className="sp-companion__kudos-ok"
              onClick={() => void acknowledgeKudos()}
              autoFocus
            >
              {t('companion.kudos.ok')}
            </button>
          </div>
        </div>
      )}

      {voiceOpen && (
        <div className="sp-companion__voice">
          <VoiceCallPanel surface={coachSurfaceForPath(pathname).screen} onClose={() => setVoiceOpen(false)} />
        </div>
      )}

      {(!historyOpen || fullscreen) && (!isTaskMode || taskView === 'chat') && (
        <div className="sp-companion__composer-shell">
          {isTaskMode ? (
            !isStreaming
              && (pendingAlternative || (openSectionAsks && (!supportUsed.hint || !supportUsed.explanation))) && (
              <div className="sp-companion__support-options" role="group" aria-label={t('companion.task.actions')}>
                {pendingAlternative && (
                  <button
                    type="button"
                    className="sp-companion__support-option sp-companion__support-option--alt"
                    onClick={openExplainer}
                  >
                    <Icon name="spark" size={16} />
                    <span>{t('companion.task.altSwitch')}</span>
                  </button>
                )}
                {openSectionAsks && !supportUsed.hint && (
                  <button
                    type="button"
                    className="sp-companion__support-option"
                    onClick={() => void requestSupport('hint')}
                  >
                    <Icon name="lightbulb" size={16} />
                    <span>{t('companion.task.hintAsk')}</span>
                  </button>
                )}
                {openSectionAsks && !supportUsed.explanation && (
                  <button
                    type="button"
                    className="sp-companion__support-option"
                    onClick={() => void requestSupport('explanation')}
                  >
                    <Icon name="book" size={16} />
                    <span>{t('companion.task.explain')}</span>
                  </button>
                )}
              </div>
            )
          ) : (
            !isStreaming && !draft.trim() && messages.length > 0 && (
              <div className="sp-companion__suggestions" role="group" aria-label={t('companion.suggestions.label')}>
                {SUGGESTION_KEYS.map((key) => (
                  <button
                    type="button"
                    key={key}
                    className="sp-companion__suggestion"
                    onClick={() => void send(t(key))}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            )
          )}
          <form className="sp-companion__composer" onSubmit={submit}>
            <button
              type="button"
              className={`sp-companion__voice-btn${voiceOpen ? ' is-active' : ''}`}
              onClick={() => setVoiceOpen((open) => !open)}
              aria-pressed={voiceOpen}
              aria-label={t('voice.start')}
              title={t('voice.start')}
            >
              <Icon name="mic" size={18} />
            </button>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('companion.placeholder')}
              aria-label={t('companion.placeholder')}
              dir={draft.trim() ? 'auto' : direction}
            />
            <button type="submit" disabled={isStreaming || !draft.trim()} aria-label={t('companion.send')}>
              <Icon name="arrow" size={18} />
            </button>
          </form>
        </div>
      )}
    </section>
    </div>

    {expandedVisual && (
      <div
        className="sp-companion-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={expandedVisual.title || t('companion.visual.open')}
        onClick={() => setExpandedVisual(null)}
      >
        <button
          type="button"
          className="sp-companion-lightbox__close"
          aria-label={t('companion.visual.close')}
          onClick={() => setExpandedVisual(null)}
          autoFocus
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <figure className="sp-companion-lightbox__content" onClick={(event) => event.stopPropagation()}>
          {expandedVisual.type === 'video' ? (
            <video
              src={expandedVisual.data_url}
              autoPlay
              muted
              loop
              playsInline
              controls
              aria-label={expandedVisual.alt || expandedVisual.title}
            />
          ) : expandedVisual.type === 'scene' ? (
            // Enlarging must show the SAME picture, bigger. This used to render
            // `data_url` — the SVG fallback — so the preview and the "large"
            // view were the output of two different renderers.
            <SceneRenderer visual={expandedVisual} />
          ) : (
            <img src={expandedVisual.data_url} alt={expandedVisual.alt || expandedVisual.title} />
          )}
          {expandedVisual.caption && <figcaption dir="auto">{expandedVisual.caption}</figcaption>}
        </figure>
      </div>
    )}

    {explainerOpen && (
      <QuestionExplainer
        componentId={lessonRoadmap?.activeComponentId ?? null}
        language={language}
        onClose={closeExplainer}
      />
    )}
    </>
  )
}
