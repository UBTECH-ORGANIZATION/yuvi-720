import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import katex from 'katex'
import { useI18n } from '../i18n/I18nProvider'
import { useCompanion } from '../providers/CompanionProvider'
import { YubiAvatar3D } from '../features/yubi-studio/YubiAvatar3D'
import { useYubiDesign } from '../features/yubi-studio/YubiDesignProvider'
import { Icon } from './primitives'
import { YuviHeadIcon } from './YuviHeadIcon'
import type { CoachVisual } from '../services/agents'
import { playCoachSpeech, stopCoachSpeech, type SpeechState } from '../services/speech'
import 'katex/dist/katex.min.css'
import './companion.css'

const FENCED_BLOCK = /```[^\n]*\n?[\s\S]*?```/g
const INLINE_FORMAT = /(\\\([^]*?\\\)|\\\[[^]*?\\\]|\$\$[^]*?\$\$|\$[^$\n]+\$|\*\*[^*]+\*\*|`[^`\n]+`)/g
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

function inlineContent(text: string) {
  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE_FORMAT)) {
    const index = match.index
    if (index > cursor) nodes.push(text.slice(cursor, index))
    const token = match[0]
    if (token.startsWith('\\(') || token.startsWith('\\[') || token.startsWith('$')) {
      const displayMode = token.startsWith('\\[') || token.startsWith('$$')
      const delimiterLength = token.startsWith('$$') || token.startsWith('\\') ? 2 : 1
      const formula = token.slice(delimiterLength, -delimiterLength).trim()
      nodes.push(
        <span
          className={`sp-companion__math${displayMode ? ' sp-companion__math--display' : ''}`}
          dir="ltr"
          key={`${index}-${token}`}
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(formula, {
              displayMode,
              output: 'htmlAndMathml',
              strict: 'ignore',
              throwOnError: false,
              trust: false,
            }),
          }}
        />
      )
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`${index}-${token}`}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(
        <bdi className="sp-companion__math" dir="ltr" key={`${index}-${token}`}>
          {token.slice(1, -1)}
        </bdi>
      )
    }
    cursor = index + token.length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function CoachText({ text }: { text: string }) {
  const safeText = text.replace(FENCED_BLOCK, '').trim()
  if (!safeText) return null
  return (
    <div className="sp-companion__prose" dir="auto">
      {inlineContent(safeText)}
    </div>
  )
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

function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="sp-companion__thinking" role="status" aria-label={label}>
      <span className="sp-companion__thinking-orbit" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span>{label}</span>
    </div>
  )
}

/* Floating Learning Coach (F3) — present on every learner screen. Mature, calm,
   emoji-free (720-UIUX). Shows the mandatory AI-use disclosure; messages use
   dir="auto" for mixed-language content. */
export function CompanionChat() {
  const { t, direction, language } = useI18n()
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
    selectConversation,
    startNewConversation,
    deleteConversation,
    loadMoreConversations,
    loadMoreMessages,
    reloadHistory,
  } = useCompanion()
  const { design, loaded } = useYubiDesign()
  const [draft, setDraft] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showLiveYuvi, setShowLiveYuvi] = useState(false)
  const [settleHeaderYuvi, setSettleHeaderYuvi] = useState(false)
  const [expandedVisual, setExpandedVisual] = useState<CoachVisual | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [speech, setSpeech] = useState<{ messageId: string | null; state: SpeechState }>({
    messageId: null,
    state: 'idle',
  })
  const bodyRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const preserveScroll = useRef<{ height: number; top: number } | null>(null)
  const stickToBottom = useRef(true)

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
      else if (historyOpen) setHistoryOpen(false)
      else close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, deletePendingId, expandedVisual, historyOpen, isClosing, isOpen, isOpening])

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

  useEffect(() => () => stopCoachSpeech(), [])

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

  const assistantMessage = (
    text: string,
    key?: string,
    visual?: CoachVisual,
    isVisualizing?: boolean,
    textAfter?: string,
    isComplete = true,
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
              className={`sp-companion__speech${speech.messageId === key ? ' is-active' : ''}`}
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
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M8.5 21h7" />
                </svg>
              )}
            </button>
          )}
          {text ? <CoachText text={text} /> : (key === activeAssistantId
            ? <ThinkingIndicator label={t('companion.thinking')} />
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
                <img src={visual.data_url} alt={visual.alt || visual.title} />
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
          {textAfter && <CoachText text={textAfter} />}
        </div>
      </div>
    </div>
  )

  return (
    <>
    <div
      className={`sp-companion-backdrop${isOpening ? ' is-opening' : ''}${isClosing ? ' is-closing' : ''}`}
      aria-hidden="true"
      onPointerDown={close}
    />
    <div
      className={`sp-companion-slot${isOpening ? ' is-opening' : ''}${isClosing ? ' is-closing' : ''}`}
      style={{ '--sp-companion-width': `${panelWidth}px` } as CSSProperties}
    >
    <section
      id="yubi-companion-panel"
      className={`sp-companion${isOpening ? ' is-opening' : ''}${isClosing ? ' is-closing' : ''}${isResizing ? ' is-resizing' : ''}`}
      role="dialog"
      aria-labelledby="yubi-companion-title"
      dir={direction}
      data-opening={isOpening ? 'true' : 'false'}
      data-closing={isClosing ? 'true' : 'false'}
      style={{ '--sp-companion-width': `${panelWidth}px` } as CSSProperties}
    >
      <div
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
      />
      <header className="sp-companion__head">
        <div
          className="sp-companion__yuvi-stage"
          data-yuvi-activity={speech.state === 'playing' ? 'speaking' : activity}
          aria-hidden="true"
        >
          <span className="sp-companion__yuvi-orbit" />
          {loaded && showLiveYuvi ? (
            <YubiAvatar3D
              initialDesign={design}
              label={t('companion.title')}
              muted
              frontFacing={settleHeaderYuvi}
              thinking={activity === 'thinking'}
              speaking={activity === 'speaking' || speech.state === 'playing'}
            />
          ) : (
            <span className="sp-companion__yuvi-loader" role="presentation" />
          )}
        </div>
        <div className="sp-companion__id">
          <span className="sp-companion__avatar"><YuviHeadIcon /></span>
          <div>
            <p id="yubi-companion-title" className="sp-companion__title">{t('companion.title')}</p>
            <p className="sp-companion__subtitle">{t('companion.subtitle')}</p>
          </div>
        </div>
        <div className="sp-companion__head-actions">
          <button
            type="button"
            className={`sp-companion__head-action${historyOpen ? ' is-active' : ''}`}
            onClick={() => setHistoryOpen((value) => !value)}
            aria-label={t('companion.history.open')}
            data-tooltip={t('companion.history.open')}
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
            className="sp-companion__close"
            onClick={close}
            aria-label={t('companion.close')}
            data-tooltip={t('companion.close')}
          >
            <Icon name="arrow" size={18} />
          </button>
        </div>
      </header>

      <p className="sp-companion__disclosure" dir="auto">
        <Icon name="lock" size={13} strokeWidth={2} aria-hidden="true" />
        {disclosure || t('companion.disclosure')}
      </p>

      {historyOpen ? (
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
      ) : (
        <>
          <div className="sp-companion__thread-bar">
            <span><Icon name="message" size={15} /></span>
            <div>
              <small>{t('companion.history.current')}</small>
              <strong dir="auto">{activeConversation?.title || t('companion.history.untitled')}</strong>
            </div>
            <button type="button" onClick={() => setHistoryOpen(true)}>{t('companion.history.open')}</button>
          </div>
          <div
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
            {hasMoreMessages && !isLoadingMessages && (
              <p className="sp-companion__more-hint">{t('companion.history.scrollForMore')}</p>
            )}
            {!isLoadingMessages && messages.length === 0 && assistantMessage(t('companion.greeting'))}
            {messages.map((m) => (
              m.role === 'assistant'
                ? assistantMessage(m.text, m.id, m.visual, m.isVisualizing, m.textAfter, m.isComplete)
                : (
                  <div
                    key={m.id}
                    className="sp-companion__message-row sp-companion__message-row--user"
                  >
                    <div className="sp-companion__msg sp-companion__msg--user" dir="auto">{m.text}</div>
                  </div>
                )
            ))}
          </div>
        </>
      )}

      {!historyOpen && <form className="sp-companion__composer" onSubmit={submit}>
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
      </form>}
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
          <img src={expandedVisual.data_url} alt={expandedVisual.alt || expandedVisual.title} />
          {expandedVisual.caption && <figcaption dir="auto">{expandedVisual.caption}</figcaption>}
        </figure>
      </div>
    )}
    </>
  )
}
