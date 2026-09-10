import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { isSupportEnabled, useSupportSession } from './useSupportSession'
import './support-widget.css'

const OPEN_EVENT = 'yuvilab:support-widget'

/** Opens the live support panel from anywhere (menus, error screens, the tour). */
export function openSupportWidget(): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

/**
 * The floating "I need help" companion.
 *
 * Live chat with a human, an optional voice call and an optional look at the screen -
 * each one opt-in, each one visible while it runs, each one stoppable in one click.
 * The learner is told in plain language what a supporter can see before anything starts.
 */
export function SupportWidget() {
  const { t, language } = useI18n()
  const support = useSupportSession()
  const [open, setOpen] = useState(false)
  const [available, setAvailable] = useState(false)
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void isSupportEnabled().then(setAvailable)
  }, [])

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  const { phase, connect, markRead, unread } = support

  useEffect(() => {
    if (!open) return
    if (phase === 'idle' || phase === 'ended') void connect(language)
  }, [connect, language, open, phase])

  // Opening the panel is what marks the conversation read - not every re-render.
  useEffect(() => {
    if (open && unread > 0) markRead()
  }, [markRead, open, unread])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [support.messages.length])

  if (!available) return null

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    support.sendMessage(draft)
    setDraft('')
  }

  const sharing = support.share.active
  const statusKey = support.connected ? 'supportWidget.status.connected' : 'supportWidget.status.connecting'

  return (
    <>
      {/* The indicator stays on screen even when the panel is closed: the learner must
          never be able to forget that someone can see the screen. */}
      {(sharing || support.voice.active) && (
        <div className="support-widget-indicator" role="status">
          <span className="support-widget-dot" aria-hidden="true" />
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

      <button
        type="button"
        className="support-widget-launcher"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {t('supportWidget.launcher')}
        {support.unread > 0 && !open && (
          <span className="support-widget-badge" aria-label={t('supportWidget.unread')}>
            {support.unread}
          </span>
        )}
      </button>

      {open && (
        <section className="support-widget-panel" aria-label={t('supportWidget.title')}>
          <header>
            <div>
              <h2>{t('supportWidget.title')}</h2>
              <p className="support-widget-status">{t(statusKey)}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label={t('supportWidget.close')}>
              ×
            </button>
          </header>

          <p className="support-widget-privacy">{t('supportWidget.privacy')}</p>

          {support.phase === 'unavailable' && (
            <p className="support-widget-empty">{t('supportWidget.unavailable')}</p>
          )}

          {support.share.pending && (
            <div className="support-widget-consent" role="alertdialog">
              <p>
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
            <div className="support-widget-consent" role="alertdialog">
              <p>{t('supportWidget.consent.voice')}</p>
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

          <div className="support-widget-log" ref={logRef} aria-live="polite">
            {support.messages.length === 0 && (
              <p className="support-widget-empty">{t('supportWidget.emptyChat')}</p>
            )}
            {support.messages.map((message) => (
              <p
                key={message.message_id}
                className={`support-widget-message ${message.sender === 'user' ? 'mine' : 'theirs'}`}
              >
                {message.body}
              </p>
            ))}
            {support.supporterTyping && (
              <p className="support-widget-typing">{t('supportWidget.typing')}</p>
            )}
          </div>

          {support.voice.active && (
            <div className="support-widget-voice">
              <button type="button" onClick={support.toggleMute}>
                {support.voice.muted ? t('supportWidget.unmute') : t('supportWidget.mute')}
              </button>
              <button type="button" onClick={support.stopVoice}>
                {t('supportWidget.hangUp')}
              </button>
            </div>
          )}

          <form className="support-widget-composer" onSubmit={submit}>
            <label className="sr-only" htmlFor="support-widget-input">
              {t('supportWidget.inputLabel')}
            </label>
            <input
              id="support-widget-input"
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

          <audio ref={support.audioRef} hidden />
        </section>
      )}
    </>
  )
}
