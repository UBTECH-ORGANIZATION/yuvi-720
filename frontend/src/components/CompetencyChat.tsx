import { useEffect, useRef, useState } from 'react'
import { CoachMarkdown } from './CoachMarkdown'
import { VisualCTA } from './VisualCTA'
import { YuviHeadIcon } from './YuviHeadIcon'
import { Icon } from './primitives'
import { useI18n } from '../i18n/I18nProvider'
import {
  requestVisualization,
  streamCompetencyChat,
  type CoachVisual,
  type CompetencyChatMessage,
  type VisualMode,
} from '../services/agents'
import './competency-chat.css'

const FENCED_BLOCK = /```[^\n]*\n?[\s\S]*?```/g

interface ChatBubble {
  id: string
  role: 'user' | 'assistant'
  text: string
  visual?: CoachVisual
  isVisualizing?: boolean
  visualFailed?: boolean
  canVisualize?: boolean
}

/** Assistant reply styled like the floating companion chat (robot-head avatar +
 * prose bubble), with an optional rendered visual and the on-demand
 * "show me a video / image" prompt. Fenced diagram blocks are stripped. */
function AssistantChatBubble({
  bubble,
  streaming,
  onExpand,
  onRequestVisual,
}: {
  bubble: ChatBubble
  streaming: boolean
  onExpand: (visual: CoachVisual) => void
  onRequestVisual: (id: string, mode: VisualMode) => void
}) {
  const { t } = useI18n()
  const clean = bubble.text.replace(FENCED_BLOCK, '').trim()
  const canVisualize =
    bubble.id !== 'greeting' && !bubble.visual && !bubble.isVisualizing &&
    (bubble.visualFailed || bubble.canVisualize)
  return (
    <div className="sp-companion__message-row sp-companion__message-row--assistant">
      <span className={`sp-companion__message-avatar${clean === '' ? ' is-thinking' : ''}`}>
        <YuviHeadIcon />
      </span>
      <div className="sp-companion__message-stack">
        <div className="sp-companion__msg sp-companion__msg--assistant" dir="auto">
          {clean === '' ? (
            <span className="cchat__dots" aria-hidden="true">…</span>
          ) : (
            <CoachMarkdown text={bubble.text} />
          )}
          {bubble.isVisualizing && (
            <div className="sp-companion__visual-status" role="status">
              <span className="sp-companion__visual-spinner" aria-hidden="true" />
              {t('companion.visualizing')}
            </div>
          )}
          {bubble.visual && (
            <figure className="sp-companion__visual" data-renderer={bubble.visual.renderer}>
              <button type="button" className="sp-companion__visual-open" onClick={() => onExpand(bubble.visual!)} aria-label={t('companion.visual.open')}>
                {bubble.visual.type === 'video' ? (
                  <video src={bubble.visual.data_url} autoPlay muted loop playsInline aria-label={bubble.visual.alt || bubble.visual.title} />
                ) : (
                  <img src={bubble.visual.data_url} alt={bubble.visual.alt || bubble.visual.title} />
                )}
              </button>
              {bubble.visual.caption && <figcaption dir="auto">{bubble.visual.caption}</figcaption>}
            </figure>
          )}
          {!streaming && canVisualize && (
            <VisualCTA failed={bubble.visualFailed} onRequest={(mode) => onRequestVisual(bubble.id, mode)} />
          )}
        </div>
      </div>
    </div>
  )
}

interface CompetencyChatProps {
  competencyKey: string
  /** First assistant bubble shown before the learner types. */
  greeting: string
  /** Optional privacy/ephemeral note shown above the log. */
  ephemeralNote?: string
  /** Optional one-tap reply chips shown before the learner types anything. */
  suggestions?: string[]
  className?: string
}

/**
 * Ephemeral, topic-scoped Yuvi chat. The transcript lives only here (never
 * written to conversation history), while the server still runs the memory
 * lane, so durable facts the kid shares do update the brain. Each reply can be
 * turned into a visual on demand. Shared by the learning-map dialog and the
 * activeness-map info panel.
 */
export function CompetencyChat({ competencyKey, greeting, ephemeralNote, suggestions, className }: CompetencyChatProps) {
  const { t, language, direction } = useI18n()
  const [bubbles, setBubbles] = useState<ChatBubble[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [chatError, setChatError] = useState(false)
  const [expandedVisual, setExpandedVisual] = useState<CoachVisual | null>(null)
  const conversationId = useRef(Math.random().toString(36).slice(2, 10))
  const bubbleSeq = useRef(0)
  const logRef = useRef<HTMLDivElement>(null)
  const nextId = () => `b-${bubbleSeq.current++}`

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [bubbles])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && expandedVisual) {
        event.stopPropagation()
        setExpandedVisual(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expandedVisual])

  const send = async (explicit?: string) => {
    const text = (explicit ?? draft).trim()
    if (!text || streaming) return
    setDraft('')
    setChatError(false)
    const transcript: CompetencyChatMessage[] = [
      ...bubbles.map((b) => ({ role: b.role, text: b.text })),
      { role: 'user', text },
    ]
    const assistantId = nextId()
    setBubbles((prev) => [
      ...prev,
      { id: nextId(), role: 'user', text },
      { id: assistantId, role: 'assistant', text: '' },
    ])
    setStreaming(true)
    try {
      await streamCompetencyChat(competencyKey, transcript, conversationId.current, language, {
        onText: (chunk) => {
          setBubbles((prev) => prev.map((b) => (b.id === assistantId ? { ...b, text: b.text + chunk } : b)))
        },
        onCanVisualize: (canVisualize) => {
          setBubbles((prev) => prev.map((b) => (b.id === assistantId ? { ...b, canVisualize } : b)))
        },
      })
    } catch {
      setChatError(true)
      setBubbles((prev) => prev.filter((b) => !(b.id === assistantId && b.text === '')))
    } finally {
      setStreaming(false)
    }
  }

  // On-demand visual for one ephemeral reply — read from the current `bubbles`
  // closure (this handler isn't memoized), not a setState side-effect.
  const requestVisual = async (id: string, mode: VisualMode) => {
    const index = bubbles.findIndex((b) => b.id === id)
    if (index === -1) return
    const assistantText = bubbles[index].text.replace(FENCED_BLOCK, '').trim()
    if (!assistantText) return
    let userMessage = ''
    for (let i = index - 1; i >= 0; i -= 1) {
      if (bubbles[i].role === 'user' && bubbles[i].text) { userMessage = bubbles[i].text; break }
    }
    setBubbles((prev) => prev.map((b) => (b.id === id ? { ...b, isVisualizing: true, visualFailed: false } : b)))
    try {
      const rendered = await requestVisualization(userMessage || assistantText, assistantText, mode, language, conversationId.current)
      setBubbles((prev) =>
        prev.map((b) =>
          b.id === id
            ? rendered
              ? { ...b, visual: rendered, isVisualizing: false, visualFailed: false }
              : { ...b, isVisualizing: false, visualFailed: true }
            : b,
        ),
      )
    } catch {
      setBubbles((prev) => prev.map((b) => (b.id === id ? { ...b, isVisualizing: false, visualFailed: true } : b)))
    }
  }

  return (
    <div className={`cchat${className ? ` ${className}` : ''}`}>
      {ephemeralNote && (
        <p className="cchat__ephemeral" dir="auto">
          <Icon name="lock" size={12} />
          {ephemeralNote}
        </p>
      )}

      <div ref={logRef} className="cchat__log" aria-live="polite">
        <AssistantChatBubble
          bubble={{ id: 'greeting', role: 'assistant', text: greeting }}
          streaming={streaming}
          onExpand={setExpandedVisual}
          onRequestVisual={requestVisual}
        />
        {suggestions && suggestions.length > 0 && bubbles.length === 0 && !streaming && (
          <div className="cchat__suggests">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="cchat__suggest"
                dir="auto"
                onClick={() => void send(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {bubbles.map((bubble) =>
          bubble.role === 'assistant' ? (
            <AssistantChatBubble
              key={bubble.id}
              bubble={bubble}
              streaming={streaming}
              onExpand={setExpandedVisual}
              onRequestVisual={requestVisual}
            />
          ) : (
            <div key={bubble.id} className="sp-companion__message-row sp-companion__message-row--user">
              <div className="sp-companion__msg sp-companion__msg--user" dir="auto">{bubble.text}</div>
            </div>
          ),
        )}
        {chatError && <p className="cchat__error" role="alert">{t('sdash.lmap.chat.error')}</p>}
      </div>

      <div className="cchat__composer">
        <input
          type="text"
          value={draft}
          dir={draft.trim() ? 'auto' : direction}
          placeholder={t('sdash.lmap.chat.placeholder')}
          maxLength={1200}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void send()
            }
          }}
        />
        <button
          type="button"
          className="cchat__send"
          onClick={() => void send()}
          disabled={streaming || draft.trim() === ''}
          aria-label={t('sdash.lmap.chat.send')}
        >
          <Icon name="arrow" size={16} />
        </button>
      </div>

      {expandedVisual && (
        <div
          className="sp-companion-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={expandedVisual.title || t('companion.visual.open')}
          onClick={(event) => { event.stopPropagation(); setExpandedVisual(null) }}
        >
          <button
            type="button"
            className="sp-companion-lightbox__close"
            aria-label={t('companion.visual.close')}
            onClick={(event) => { event.stopPropagation(); setExpandedVisual(null) }}
            autoFocus
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
          <figure className="sp-companion-lightbox__content" onClick={(event) => event.stopPropagation()}>
            {expandedVisual.type === 'video' ? (
              <video src={expandedVisual.data_url} autoPlay muted loop playsInline controls aria-label={expandedVisual.alt || expandedVisual.title} />
            ) : (
              <img src={expandedVisual.data_url} alt={expandedVisual.alt || expandedVisual.title} />
            )}
            {expandedVisual.caption && <figcaption dir="auto">{expandedVisual.caption}</figcaption>}
          </figure>
        </div>
      )}
    </div>
  )
}
