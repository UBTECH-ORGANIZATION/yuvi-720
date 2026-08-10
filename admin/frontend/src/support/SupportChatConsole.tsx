import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ApiError,
  getSupportConversations,
  getSupportMessages,
  replyToConversation,
  updateConversationStatus,
} from '../api'
import { useI18n } from '../i18n/I18nProvider'
import type { ConversationStatus, SupportConversation, SupportMessage } from '../types'
import { useSupportSocket } from './useSupportSocket'

/* Live updates arrive over a WebSocket that carries pointers only, so every
   event just refetches the thread. */
const STATUSES: ConversationStatus[] = ['open', 'pending', 'closed']

export function SupportChatConsole({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { t, language } = useI18n()
  const [conversations, setConversations] = useState<SupportConversation[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const handle = useCallback(
    (reason: unknown) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      if (reason instanceof ApiError && reason.status === 401) {
        onUnauthorized()
        return
      }
      setError(true)
    },
    [onUnauthorized],
  )

  const loadConversations = useCallback(async () => {
    try {
      const result = await getSupportConversations()
      setConversations(result)
      setActiveId((current) => current ?? result[0]?.conversation_id ?? null)
    } catch (reason) {
      handle(reason)
    }
  }, [handle])

  const loadMessages = useCallback(
    async (conversationId: string) => {
      try {
        setMessages(await getSupportMessages(conversationId))
      } catch (reason) {
        handle(reason)
      }
    },
    [handle],
  )

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    void loadMessages(activeId)
  }, [activeId, loadMessages])

  const refresh = useCallback(() => {
    void loadConversations()
    if (activeId) void loadMessages(activeId)
  }, [activeId, loadConversations, loadMessages])

  useSupportSocket('/api/support/ws', refresh)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages])

  const active = conversations?.find((item) => item.conversation_id === activeId) ?? null

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeId || !draft.trim() || sending) return
    setSending(true)
    setError(false)
    try {
      const message = await replyToConversation(activeId, draft.trim())
      setMessages((current) => [...current, message])
      setDraft('')
      await loadConversations()
    } catch (reason) {
      handle(reason)
    } finally {
      setSending(false)
    }
  }

  const changeStatus = async (status: ConversationStatus) => {
    if (!activeId) return
    try {
      await updateConversationStatus(activeId, status)
      await loadConversations()
    } catch (reason) {
      handle(reason)
    }
  }

  return (
    <section className="panel support-console">
      <header className="support-console__head">
        <h2>{t('support.chat.title')}</h2>
        <p>{t('support.chat.subtitle')}</p>
      </header>

      {error ? <div className="notice notice--error" role="alert">{t('support.chat.error')}</div> : null}

      {conversations && conversations.length === 0 ? (
        <p className="empty-state">{t('support.chat.empty')}</p>
      ) : (
        <div className="support-console__body">
          <ul className="support-console__threads">
            {(conversations ?? []).map((item) => (
              <li key={item.conversation_id}>
                <button
                  type="button"
                  className={`support-console__thread${item.conversation_id === activeId ? ' is-active' : ''}`}
                  onClick={() => setActiveId(item.conversation_id)}
                >
                  <span className="support-console__thread-top">
                    <strong dir="auto">{item.subject || t('support.chat.untitled')}</strong>
                    {item.unread_admin > 0 ? <em className="support-console__dot" aria-hidden="true" /> : null}
                  </span>
                  <span dir="auto" className="support-console__thread-meta">
                    {item.teacher_name || item.teacher_id} · {formatDate(item.last_message_at, language)}
                  </span>
                  <span dir="auto" className="support-console__thread-preview">
                    {item.last_message_preview}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="support-console__thread-view">
            {active ? (
              <>
                <div className="support-console__thread-bar">
                  <strong dir="auto">{active.teacher_name || active.teacher_id}</strong>
                  <label>
                    <span className="visually-hidden">{t('support.chat.status')}</span>
                    <select
                      value={active.status}
                      onChange={(event) => void changeStatus(event.target.value as ConversationStatus)}
                    >
                      {STATUSES.map((value) => (
                        <option key={value} value={value}>{t(`support.chat.status.${value}`)}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="support-console__log" ref={logRef}>
                  {messages.length === 0 ? (
                    <p className="empty-state">{t('support.chat.noMessages')}</p>
                  ) : (
                    messages.map((message) => (
                      <article
                        key={message.message_id}
                        className={`support-console__msg support-console__msg--${message.author_role}`}
                      >
                        <span className="support-console__msg-author" dir="auto">
                          {message.author_role === 'admin'
                            ? message.author_name || t('support.chat.adminSide')
                            : message.author_name || t('support.chat.teacherSide')}
                        </span>
                        <p dir="auto">{message.body}</p>
                        <time>{formatDate(message.at, language)}</time>
                      </article>
                    ))
                  )}
                </div>

                <form className="support-console__composer" onSubmit={(event) => void send(event)}>
                  <textarea
                    dir="auto"
                    rows={3}
                    value={draft}
                    maxLength={4000}
                    placeholder={t('support.chat.placeholder')}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <button
                    className="button button--primary button--small"
                    type="submit"
                    disabled={!draft.trim() || sending}
                  >
                    {t('support.chat.send')}
                  </button>
                </form>
              </>
            ) : (
              <p className="empty-state">{t('support.chat.selectThread')}</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function formatDate(value: string | null, language: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(date)
}
