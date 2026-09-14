import { useEffect, useId, useRef, useState } from 'react'
import { navigate } from '../../app/router'
import { formatMessageTime } from '../../hooks/messageTime'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../providers/AuthProvider'
import { ProfileAvatar } from '../badges/ProfileAvatar'
import { openReportIssue } from '../support/ReportIssueDialog'
import { isSupportEnabled, useSupportSession } from './useSupportSession'
import './support-page.css'

/** A person wearing a headset - the human on the other end, drawn warmly. */
function SupporterAvatar({ className = 'support-page__avatar' }: { className?: string }) {
  // One gradient per instance: the avatar repeats down the thread, and ids don't.
  const gradientId = useId()
  return (
    <svg className={className} viewBox="0 0 44 44" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--sp-primary-600)" />
          <stop offset="1" stopColor="var(--sp-primary-700)" />
        </linearGradient>
      </defs>
      <circle cx="22" cy="22" r="22" fill={`url(#${gradientId})`} />
      <circle cx="22" cy="19" r="5.5" fill="#fff" />
      <path d="M12 35c0-5.2 4.5-7.8 10-7.8S32 29.8 32 35z" fill="#fff" />
      {/* The headset band and cups - what says "someone is listening". */}
      <path
        d="M12.5 20a9.5 9.5 0 0 1 19 0"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="10" y="18" width="4.6" height="7.4" rx="2.3" fill="#fff" />
      <rect x="29.4" y="18" width="4.6" height="7.4" rx="2.3" fill="#fff" />
    </svg>
  )
}

function initialsOf(name: string) {
  return name.split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

/**
 * Asking a human for help, as a screen of its own.
 *
 * It used to be a panel floating over the dashboard, which made a conversation
 * with a person feel like a notification. This is a plain chat: the thread fills
 * the page, the composer sits under it, and nothing else competes for attention.
 * Screen sharing and voice stay opt-in, visible while they run and stoppable in
 * one click.
 */
export function SupportPage() {
  const { t, language } = useI18n()
  const { user } = useAuth()
  const support = useSupportSession()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement | null>(null)
  // The greeting is written the moment the screen opens, so that is its clock.
  const openedAt = useRef(new Date().toISOString())

  useEffect(() => {
    void isSupportEnabled().then(setAvailable)
  }, [])

  const { phase, connect, markRead, unread } = support

  useEffect(() => {
    if (available === false) return
    if (phase === 'idle' || phase === 'ended') void connect(language)
  }, [available, connect, language, phase])

  // Reading the thread IS opening this page, so nothing here stays unread.
  useEffect(() => {
    if (unread > 0) markRead()
  }, [markRead, unread])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [support.messages.length])

  const goBack = () => {
    if (window.history.length > 1) window.history.back()
    else navigate('/')
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    support.sendMessage(draft)
    setDraft('')
  }

  const sharing = support.share.active
  const unavailable = available === false || support.phase === 'unavailable'

  return (
    <div className="support-page">
      <header className="support-page__head">
        <button type="button" className="support-page__back" onClick={goBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{t('supportWidget.back')}</span>
        </button>
        <SupporterAvatar />
        <h1>{t('supportWidget.title')}</h1>
      </header>

      {/* Stays on screen for as long as a stream runs: the learner must never be
          able to forget that someone can see the screen or hear the room. */}
      {(sharing || support.voice.active) && (
        <div className="support-page__live" role="status">
          <span className="support-page__dot" aria-hidden="true" />
          <span>{sharing ? t('supportWidget.sharing') : t('supportWidget.voiceOn')}</span>
          <button
            type="button"
            onClick={() => {
              if (sharing) support.stopSharing()
              if (support.voice.active) support.stopVoice()
            }}
          >
            {t('supportWidget.stopNow')}
          </button>
        </div>
      )}

      <main className="support-page__thread" ref={logRef} aria-live="polite">
        {unavailable ? (
          <div className="support-page__fallback">
            <p>{t('supportWidget.unavailable')}</p>
            <button type="button" className="support-page__report" onClick={openReportIssue}>
              {t('support.report.menuTitle')}
            </button>
          </div>
        ) : (
          <>
            {/* A greeting, not an empty state: the thread opens already looking
                like a conversation somebody started. It is local to the screen
                and never sent anywhere. */}
            <div className="support-page__row is-theirs">
              <SupporterAvatar className="support-page__row-avatar" />
              <div className="support-page__message">
                <span className="support-page__body">{t('supportWidget.greeting')}</span>
                <time className="support-page__time">
                  {formatMessageTime(openedAt.current, language)}
                </time>
              </div>
            </div>
            {support.messages.map((message) => (
              <div
                key={message.message_id}
                className={`support-page__row ${message.sender === 'user' ? 'is-mine' : 'is-theirs'}`}
              >
                {message.sender === 'user' ? (
                  <ProfileAvatar
                    className="support-page__row-avatar support-page__row-avatar--me"
                    fallback={initialsOf(user?.display_name ?? '')}
                  />
                ) : (
                  <SupporterAvatar className="support-page__row-avatar" />
                )}
                <div className="support-page__message">
                  <span className="support-page__body">{message.body}</span>
                  <time className="support-page__time">
                    {formatMessageTime(message.sent_at ?? message.created_at ?? '', language)}
                  </time>
                </div>
              </div>
            ))}
            {support.supporterTyping && (
              <p className="support-page__typing">{t('supportWidget.typing')}</p>
            )}
          </>
        )}
      </main>

      {support.share.pending && (
        <div className="support-page__consent" role="alertdialog" aria-labelledby="support-consent-share">
          <p id="support-consent-share">
            {support.share.pending === 'display'
              ? t('supportWidget.consent.display')
              : t('supportWidget.consent.dom')}
          </p>
          <div>
            <button
              type="button"
              className="primary"
              onClick={() => void support.acceptShare(support.share.pending ?? 'dom')}
            >
              {t('supportWidget.consent.allow')}
            </button>
            <button type="button" onClick={support.declineShare}>
              {t('supportWidget.consent.deny')}
            </button>
          </div>
        </div>
      )}

      {support.voice.pending && (
        <div className="support-page__consent" role="alertdialog" aria-labelledby="support-consent-voice">
          <p id="support-consent-voice">{t('supportWidget.consent.voice')}</p>
          <div>
            <button type="button" className="primary" onClick={() => void support.acceptVoice()}>
              {t('supportWidget.consent.allow')}
            </button>
            <button type="button" onClick={support.declineVoice}>
              {t('supportWidget.consent.deny')}
            </button>
          </div>
        </div>
      )}

      {support.voice.active && (
        <div className="support-page__voice">
          <button type="button" onClick={support.toggleMute}>
            {support.voice.muted ? t('supportWidget.unmute') : t('supportWidget.mute')}
          </button>
          <button type="button" onClick={support.stopVoice}>
            {t('supportWidget.hangUp')}
          </button>
        </div>
      )}

      {!unavailable && (
        <form className="support-page__composer" onSubmit={submit}>
          <label className="support-page__sr-only" htmlFor="support-page-input">
            {t('supportWidget.inputLabel')}
          </label>
          <input
            id="support-page-input"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              support.notifyTyping()
            }}
            placeholder={t('supportWidget.placeholder')}
            autoComplete="off"
          />
          <button type="submit" className="primary" disabled={!draft.trim()}>
            {t('supportWidget.send')}
          </button>
        </form>
      )}

      <audio ref={support.audioRef} hidden />
    </div>
  )
}
