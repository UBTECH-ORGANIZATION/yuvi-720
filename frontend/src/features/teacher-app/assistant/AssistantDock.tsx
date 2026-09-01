/* The teaching assistant dock — a companion, not a destination.
 *
 * Deliberately mirrors how the kid's Yuvi chat works: same mental model, same
 * brand, present on every teacher screen rather than living behind its own
 * route. A teacher asks a question where they are, about what they are looking
 * at — which is why the current screen travels with the question.
 *
 * Three product rules are visible in the markup:
 *
 *   Every answer carries its trace. `ToolTrace` renders under each reply that
 *   fetched data; the server blocks ungrounded factual claims before they ship,
 *   so a traceless reply is chit-chat and renders with no caution attached.
 *
 *   The assistant never acts. Its tools cannot write; the strongest thing it can
 *   produce is a filled-in form and a button, and the teacher presses it. The
 *   write that follows is the same service call the goals screen makes.
 *
 *   One question at a time. The send button is the gate, not the input: the
 *   teacher can keep typing their next question while this one is answering,
 *   they just cannot start two.
 *
 * Threads live on the server (`/api/teacher/assistant/conversations`), which is
 * why a reload no longer empties the panel. The header names the thread and the
 * class the teacher is currently scoped to, so an answer is never read out of
 * context — the class label tracks the scope picker rather than pinning the
 * thread, because a teacher's train of thought crosses their classes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../../components/primitives/Icon'
import { ThinkingOrbit } from '../../../components/ThinkingOrbit'
import { YuviHeadIcon } from '../../../components/YuviHeadIcon'
import { formatMessageTime } from '../../../hooks/messageTime'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import { narrowsBy } from '../../../components/scope/scopeDimensions'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import { useRoute } from '../../../app/router'
import {
  createAssistantThread, deleteAssistantThread, listAssistantMessages,
  listAssistantThreads, recordActionOutcome, streamAssistant,
  type ActionOutcome, type AssistantAction, type AssistantThread, type AssistantTurn,
  type ScreenContext, type ToolTraceEntry,
} from '../../../services/teacherAssistant'
import { AssistantTaskForm } from './AssistantTaskForm'
import { MessageActions } from './MessageActions'
import { actionIdOf, actionKey } from './actionKey'
import { renderAnswer } from './StudentRef'
import { trimPartialMarkers } from './studentRefs'
import { ToolTrace } from './ToolTrace'
import './assistant-dock.css'

interface DockMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  /** A locale key rendered instead of `text` — a deterministic refusal. */
  textKey?: string | null
  tools?: ToolTraceEntry[]
  grounded?: boolean
  streaming?: boolean
  failed?: boolean
  /** Buttons this answer offered, and what the teacher did with each. Both are
   *  persisted on the message, so a reopened thread shows a completed row
   *  instead of a live button that would assign the same goal twice. */
  actions?: AssistantAction[]
  outcomes?: Record<string, ActionOutcome>
}

/** A stored refusal round-trips as `[tch.assistant.unknown.noData]`. */
const STORED_KEY = /^\[(tch\.[A-Za-z0-9.]+)\]$/

/** Derive what the teacher is looking at from the route. Advisory only. */
/* The subject the SCREEN means, not the subject the bar holds: `narrowsBy`
   is the same table the scope notice reads, so the assistant's belief about
   what the teacher is looking at matches what the page actually narrows. A
   subject set but not applied here would have the assistant answering about
   maths over a screen showing every subject. */
function screenFor(pathname: string, groupId: string | null, scopeSubject: string | null): ScreenContext {
  const subject = narrowsBy(pathname).subject ? scopeSubject : null
  if (pathname.startsWith('/teacher/student/')) {
    return {
      route: pathname,
      screen: 'student_profile',
      learner_id: decodeURIComponent(pathname.split('/teacher/student/')[1] || '') || null,
      group_id: groupId, subject,
    }
  }
  if (pathname.startsWith('/teacher/students')) {
    return { route: pathname, screen: 'roster', group_id: groupId, subject }
  }
  if (pathname.startsWith('/teacher/learnings')) {
    return { route: pathname, screen: 'learnings', group_id: groupId, subject }
  }
  if (pathname.startsWith('/teacher/messages')) {
    return { route: pathname, screen: 'messages', group_id: groupId, subject }
  }
  if (pathname.startsWith('/admin')) {
    return { route: pathname, screen: 'admin_console', group_id: null, subject: null }
  }
  return { route: pathname, screen: 'home', group_id: groupId, subject }
}

export function AssistantDock() {
  const { t, language } = useI18n()
  const route = useRoute()
  const { groupId, group, subject } = useTeacherScope()
  /* Names come from the roster the teacher app loaded — never from the model,
     which is never given them — and cover EVERY class this teacher teaches.
     Scoping them to the selected group turned an already-read "Tal" back into
     `demo-tal` the moment the picker moved, and rendered fresh answers about
     another class as raw ids. */
  const { nameOf } = useTeacherRoster()

  /* Open by default where there is room for it: on a desktop the assistant is
     a workspace column, not a popup — the same standing as the student's chat
     panel. On narrow screens it stays a launcher + overlay drawer. */
  const [isOpen, setIsOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1100px)').matches
  )
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<DockMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [threads, setThreads] = useState<AssistantThread[]>([])
  const [showThreads, setShowThreads] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  /* Thread resolution is a round trip, and a teacher can type into an open dock
     faster than it completes. Until it settles, sending would file the question
     under the wrong thread — so the send button waits, and the input does not. */
  const [isReady, setIsReady] = useState(false)
  /* One open form at a time, across the whole thread. Two half-filled goal
     forms on screen is two chances to assign the wrong one. */
  const [openAction, setOpenAction] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const nextId = useRef(1)

  const refreshThreads = useCallback(async () => {
    try {
      const page = await listAssistantThreads()
      setThreads(page.conversations ?? [])
      return page.conversations ?? []
    } catch {
      return []
    }
  }, [])

  /* Resolve a thread the first time the dock opens. `createAssistantThread`
     hands back the existing empty thread rather than minting a new one on every
     open, so idle opening does not litter the list.

     Guarded by a ref, not by `conversationId` in the dependency list: this body
     sets that state itself, so depending on it would tear down the effect
     mid-flight and the run would never reach its own last line. */
  const bootstrapped = useRef(false)
  useEffect(() => {
    if (!isOpen || bootstrapped.current) return
    bootstrapped.current = true
    void (async () => {
      const all = await refreshThreads()
      const latest = all.find((thread) => thread.message_count > 0)
      try {
        const thread = latest ?? await createAssistantThread()
        setConversationId(thread.id)
        setTitle(thread.title || '')
        if (thread.message_count > 0) await loadThread(thread.id)
      } catch {
        /* No thread means no history — the composer still works. */
      } finally {
        setIsReady(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, refreshThreads])

  async function loadThread(id: string) {
    try {
      const page = await listAssistantMessages(id)
      const restored: DockMessage[] = (page.messages ?? []).map((message) => {
        const stored = STORED_KEY.exec(message.text || '')
        return {
          id: message.id,
          role: message.role,
          text: stored ? '' : message.text,
          textKey: stored ? stored[1] : null,
          at: message.at,
          actions: message.meta?.actions ?? undefined,
          outcomes: message.meta?.outcomes ?? undefined,
        }
      })
      // Never let a late history response overwrite a question the teacher has
      // already typed. Anything with a `local-` id has not been stored yet, so
      // replacing the list would silently delete it mid-answer.
      setMessages((current) =>
        current.some((message) => message.id.startsWith('local-')) ? current : restored
      )
    } catch {
      setMessages((current) => (current.length ? current : []))
    }
  }

  // `useRoute()` returns pathname + search as one string; the screen is keyed
  // off the path alone.
  const screen = useMemo(
    () => screenFor(route.split('?')[0], groupId, subject),
    [route, groupId, subject]
  )

  useEffect(() => {
    if (isOpen && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
    // `openAction` is a dependency because expanding a form grows the panel
    // after the message list has already settled — without it the confirm
    // button opens below the fold and the teacher has to hunt for it.
  }, [messages, isOpen, isBusy, openAction])

  async function selectThread(id: string) {
    if (isBusy) return
    setShowThreads(false)
    setConversationId(id)
    setTitle(threads.find((thread) => thread.id === id)?.title || '')
    setMessages([])
    await loadThread(id)
  }

  async function startThread() {
    if (isBusy) return
    setShowThreads(false)
    setMessages([])
    setTitle('')
    try {
      const thread = await createAssistantThread()
      setConversationId(thread.id)
    } catch {
      setConversationId(null)
    }
  }

  async function removeThread(id: string) {
    if (isBusy) return
    try {
      await deleteAssistantThread(id)
    } catch {
      return
    }
    const remaining = await refreshThreads()
    if (id === conversationId) {
      setMessages([])
      setTitle('')
      setConversationId(remaining[0]?.id ?? null)
      if (remaining[0]) await loadThread(remaining[0].id)
    }
  }

  async function send(text?: string) {
    const question = (text ?? draft).trim()
    if (!question || isBusy) return

    const now = new Date().toISOString()
    const answerId = `local-${nextId.current++}`
    // Only completed exchanges become history; the in-flight one is the prompt.
    const history: AssistantTurn[] = messages
      .filter((message) => message.text && !message.failed)
      .map((message) => ({ role: message.role, content: message.text }))

    setMessages((current) => [
      ...current,
      { id: `local-${nextId.current++}`, role: 'user', text: question, at: now },
      { id: answerId, role: 'assistant', text: '', at: now, streaming: true },
    ])
    setDraft('')
    setIsBusy(true)

    const patch = (change: Partial<DockMessage>) =>
      setMessages((current) =>
        current.map((message) => (message.id === answerId ? { ...message, ...change } : message))
      )

    try {
      await streamAssistant(
        question,
        { language, screen, history, conversationId },
        {
          onText: (chunk) =>
            setMessages((current) => current.map((message) =>
              message.id === answerId ? { ...message, text: message.text + chunk } : message
            )),
          onTrace: (tools) => patch({ tools }),
          onActions: (actions) => patch({ actions }),
          onTitle: (next) => setTitle(next),
          onDone: (answer) => patch({
            text: answer.text ?? '',
            textKey: answer.text_key,
            tools: answer.tools,
            grounded: answer.grounded,
            actions: answer.actions,
          }),
        }
      )
    } catch {
      patch({ failed: true })
    } finally {
      patch({ streaming: false })
      setIsBusy(false)
      void refreshThreads()
    }
  }

  /* Record what the teacher did with an offered action, and show it as done.
     The write itself already happened inside the form through its own endpoint
     — this is the receipt, so a reopened thread does not offer the same button
     again. A failed receipt costs a stale button, never a lost goal. */
  function completeAction(messageId: string, actionId: string, summary: string) {
    setMessages((current) => current.map((message) => (
      message.id === messageId
        ? { ...message, outcomes: { ...(message.outcomes ?? {}), [actionId]: { status: 'done', summary } } }
        : message
    )))
    setOpenAction(null)
    if (conversationId && !messageId.startsWith('local-')) {
      void recordActionOutcome(conversationId, messageId, actionId, 'done', summary)
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        className="tch-dock__launcher"
        data-tour="teacher.assistant"
        onClick={() => setIsOpen(true)}
        aria-label={t('tch.assistant.open')}
      >
        <Icon name="wand" size={20} aria-hidden />
        <span>{t('tch.assistant.title')}</span>
      </button>
    )
  }

  return (
    /* data-tour lives on BOTH states (launcher above, panel here): the tour must
       find its target whichever one is mounted. */
    <aside className="tch-dock" aria-label={t('tch.assistant.title')} data-tour="teacher.assistant">
      <header className="tch-dock__head">
        <span className="tch-dock__title">
          <YuviHeadIcon width={26} height={26} />
          <span className="tch-dock__titleText">
            <strong dir="auto">{title || t('tch.assistant.title')}</strong>
            {/* The class this is being read against. It follows the scope
                picker, so the header is never stale — but it is a label, not a
                lock: the thread itself is not pinned to one class. */}
            <small dir="auto">
              {group?.name
                ? t('tch.assistant.aboutClass').replace('{class}', group.name)
                : t('tch.assistant.subtitle')}
            </small>
          </span>
        </span>
        <span className="tch-dock__spacer" />
        <button
          type="button"
          className={`tch-dock__iconButton${showThreads ? ' is-active' : ''}`}
          onClick={() => { setShowThreads((open) => !open); void refreshThreads() }}
          aria-label={t('tch.assistant.history')}
          aria-expanded={showThreads}
        >
          <Icon name="clock" size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="tch-dock__iconButton"
          onClick={() => void startThread()}
          disabled={isBusy}
          aria-label={t('tch.assistant.newChat')}
        >
          <Icon name="plus" size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="tch-dock__iconButton"
          onClick={() => setIsOpen(false)}
          aria-label={t('tch.assistant.close')}
        >
          <Icon name="close" size={16} aria-hidden />
        </button>
      </header>

      {showThreads ? (
        <div className="tch-dock__threads">
          {threads.length ? (
            <ul>
              {threads.map((thread) => (
                <li key={thread.id} className={thread.id === conversationId ? 'is-active' : ''}>
                  <button type="button" onClick={() => void selectThread(thread.id)} disabled={isBusy}>
                    <span dir="auto">{thread.title || t('tch.assistant.untitled')}</span>
                    <time dateTime={thread.updated_at}>
                      {formatMessageTime(thread.updated_at, language)}
                    </time>
                  </button>
                  <button
                    type="button"
                    className="tch-dock__threadDelete"
                    onClick={() => void removeThread(thread.id)}
                    disabled={isBusy}
                    aria-label={t('tch.assistant.clear')}
                  >
                    <Icon name="trash" size={13} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tch-dock__threadsEmpty">{t('tch.assistant.historyEmpty')}</p>
          )}
        </div>
      ) : null}

      <div className="tch-dock__body" ref={bodyRef} aria-live="polite">
        {!messages.length ? (
          <p className="tch-dock__intro">{t('tch.assistant.intro')}</p>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`tch-dock__row tch-dock__row--${message.role}`}
          >
            {message.role === 'assistant' ? (
              <span className={`tch-dock__avatar${message.streaming && !message.text ? ' is-thinking' : ''}`}>
                <YuviHeadIcon />
              </span>
            ) : null}
            {/* Actions and forms are siblings of the bubble, not children of
                it: `.tch-dock__bubble` is `fit-content`, so a form inside it
                would be squeezed to the width of the sentence above. */}
            <div className="tch-dock__stack">
              <MessageBubble message={message} nameOf={nameOf} t={t} />
              {message.actions?.length && !message.streaming ? (
                <MessageActions
                  actions={message.actions}
                  outcomes={message.outcomes ?? {}}
                  messageId={message.id}
                  openId={openAction}
                  onToggle={(id) => setOpenAction((current) => (current === id ? null : id))}
                  onAsk={(question) => void send(question)}
                  busy={isBusy}
                  nameOf={nameOf}
                />
              ) : null}
              {message.actions?.find(
                (action) => actionKey(message.id, action.id) === openAction) && groupId ? (
                <AssistantTaskForm
                  action={message.actions.find(
                    (action) => actionKey(message.id, action.id) === openAction)!}
                  groupId={groupId}
                  language={language}
                  nameOf={nameOf}
                  onDone={(summary) => completeAction(
                    message.id, actionIdOf(openAction!, message.id), summary)}
                  onCancel={() => setOpenAction(null)}
                />
              ) : null}
              <time className="tch-dock__time" dateTime={message.at}>
                {formatMessageTime(message.at, language)}
              </time>
            </div>
          </div>
        ))}
      </div>

      <form
        className="tch-dock__composer"
        onSubmit={(event) => { event.preventDefault(); void send() }}
      >
        <input
          value={draft}
          dir="auto"
          placeholder={t('tch.assistant.placeholder')}
          aria-label={t('tch.assistant.placeholder')}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="tch-dock__send"
          disabled={!draft.trim() || isBusy || !isReady}
          aria-label={t('tch.assistant.send')}
          title={t('tch.assistant.send')}
        >
          <Icon name="send" size={17} aria-hidden />
        </button>
      </form>
    </aside>
  )
}

function MessageBubble({
  message, nameOf, t,
}: {
  message: DockMessage
  nameOf: (learnerId: string) => string | null
  t: (key: string) => string
}) {
  if (message.role === 'user') {
    return <div className="tch-dock__bubble tch-dock__bubble--user" dir="auto">{message.text}</div>
  }

  if (message.failed) {
    return (
      <div className="tch-dock__bubble tch-dock__bubble--error" dir="auto">
        {t('tch.assistant.errorSend')}
      </div>
    )
  }

  // Nothing written yet: the tool rounds are running and Yuvi is thinking.
  if (message.streaming && !message.text) {
    return (
      <div className="tch-dock__bubble">
        <ThinkingOrbit label={t('tch.assistant.thinking')} />
      </div>
    )
  }

  return (
    <div className="tch-dock__bubble" dir="auto">
      {/* A deterministic refusal renders from its key, so "I don't know" is as
          well-worded as an answer — and localized. */}
      {message.text
        ? renderAnswer(
            // Mid-stream, a half-written `{{student:` is template syntax the
            // teacher should never see. Hold it back until it closes.
            message.streaming ? trimPartialMarkers(message.text) : message.text,
            nameOf,
          )
        : message.textKey
          ? <p className="tch-dock__para">{t(message.textKey)}</p>
          : null}
      {message.tools && !message.streaming ? (
        <ToolTrace tools={message.tools} />
      ) : null}
    </div>
  )
}
