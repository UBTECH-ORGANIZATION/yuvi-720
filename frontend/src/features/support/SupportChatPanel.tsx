import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import {
  listConversationMessages,
  listConversations,
  openConversation,
  sendConversationMessage,
  type SupportConversation,
  type SupportMessage,
} from '../../services/support'
import './support-chat.css'
import { useSupportSocket } from './useSupportSocket'

/* Human support for teachers only: an administrator answers from the admin
   console. Live updates arrive over a WebSocket that carries pointers only, so
   every event just refetches the thread. */

export function SupportChatPanel() {
  const { t, direction } = useI18n()
  const [open, setOpen] = useState(false)
  const [conversations, setConversations] = useState<SupportConversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [draft, setDraft] = useState('')
  const [subject, setSubject] = useState('')
  const [composing, setComposing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const unread = conversations.reduce((total, item) => total + item.unread_teacher, 0)

  const loadConversations = useCallback(async () => {
    try {
      const result = await listConversations()
      setConversations(result.conversations)
      setActiveId((current) => current ?? result.conversations[0]?.id ?? null)
    } catch {
      setError(true)
    }
  }, [])

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const result = await listConversationMessages(conversationId)
      setMessages(result.messages)
    } catch {
      setError(true)
    }
  }, [])

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

  const startThread = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!subject.trim() || sending) return
    setSending(true)
    setError(false)
    try {
      const result = await openConversation(subject.trim(), draft.trim())
      setSubject('')
      setDraft('')
      setComposing(false)
      setActiveId(result.conversation.id)
      await loadConversations()
    } catch {
      setError(true)
    } finally {
      setSending(false)
    }
  }

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeId || !draft.trim() || sending) return
    setSending(true)
    setError(false)
    try {
      const result = await sendConversationMessage(activeId, draft.trim())
      setMessages((current) => [...current, result.message])
      setDraft('')
      await loadConversations()
    } catch {
      setError(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        className="sp-support-launch"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M21 12a8 8 0 10-3.2 6.4L21 20l-1-3.2A7.9 7.9 0 0021 12z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        <span>{t('support.chat.launch')}</span>
        {unread > 0 ? <em className="sp-support-launch__dot" aria-hidden="true" /> : null}
      </button>

      {open ? (
        <section
          className="sp-support"
          role="dialog"
          aria-label={t('support.chat.title')}
          dir={direction}
        >
          <header className="sp-support__head">
            <h2>{t('support.chat.title')}</h2>
            <button
              className="sp-support__close"
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('support.report.close')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <p className="sp-support__note">{t('support.chat.humanNote')}</p>

          {conversations.length > 0 ? (
            <div className="sp-support__threads" role="tablist" aria-label={t('support.chat.threads')}>
              {conversations.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  type="button"
                  aria-selected={item.id === activeId}
                  className={`sp-support__thread${item.id === activeId ? ' is-active' : ''}`}
                  onClick={() => setActiveId(item.id)}
                >
                  <span dir="auto">{item.subject || t('support.chat.untitled')}</span>
                  {item.unread_teacher > 0 ? <em aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ) : null}

          {composing || conversations.length === 0 ? (
            <form className="sp-support__new" onSubmit={(event) => void startThread(event)}>
              <label>
                <span>{t('support.chat.subject')}</span>
                <input
                  dir="auto"
                  value={subject}
                  maxLength={160}
                  required
                  onChange={(event) => setSubject(event.target.value)}
                />
              </label>
              <label>
                <span>{t('support.chat.firstMessage')}</span>
                <textarea
                  dir="auto"
                  rows={3}
                  value={draft}
                  maxLength={4000}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </label>
              <div className="sp-support__new-actions">
                <button className="sp-support__send" type="submit" disabled={!subject.trim() || sending}>
                  {t('support.chat.start')}
                </button>
                {conversations.length > 0 ? (
                  <button className="sp-support__link" type="button" onClick={() => setComposing(false)}>
                    {t('support.chat.cancel')}
                  </button>
                ) : null}
              </div>
            </form>
          ) : (
            <>
              <div className="sp-support__log" ref={logRef}>
                {messages.length === 0 ? (
                  <p className="sp-support__empty">{t('support.chat.waiting')}</p>
                ) : (
                  messages.map((message) => (
                    <article
                      key={message.id}
                      className={`sp-support__msg sp-support__msg--${message.author_role}`}
                    >
                      <span className="sp-support__msg-author">
                        {message.author_role === 'admin'
                          ? t('support.chat.team')
                          : t('support.chat.you')}
                      </span>
                      <p dir="auto">{message.body}</p>
                    </article>
                  ))
                )}
              </div>

              <form className="sp-support__composer" onSubmit={(event) => void send(event)}>
                <textarea
                  dir="auto"
                  rows={2}
                  value={draft}
                  maxLength={4000}
                  placeholder={t('support.chat.placeholder')}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button className="sp-support__send" type="submit" disabled={!draft.trim() || sending}>
                  {t('support.chat.send')}
                </button>
              </form>
              <button className="sp-support__link" type="button" onClick={() => setComposing(true)}>
                {t('support.chat.newThread')}
              </button>
            </>
          )}

          {error ? <p className="sp-support__error" role="alert">{t('support.chat.error')}</p> : null}
        </section>
      ) : null}
    </>
  )
}
