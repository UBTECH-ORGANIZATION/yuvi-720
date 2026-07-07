import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { useCompanion } from '../providers/CompanionProvider'
import { Icon } from './primitives'
import './companion.css'

/* Floating Learning Coach (F3) — present on every learner screen. Mature, calm,
   emoji-free (720-UIUX). Shows the mandatory AI-use disclosure; messages use
   dir="auto" for mixed-language content. */
export function CompanionChat() {
  const { t } = useI18n()
  const { isOpen, toggle, close, messages, isStreaming, disclosure, send } = useCompanion()
  const [draft, setDraft] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.trim() || isStreaming) return
    void send(draft)
    setDraft('')
  }

  return (
    <>
      {!isOpen && (
        <button className="sp-companion-launcher" onClick={toggle} aria-label={t('companion.launcher')}>
          <Icon name="message" size={22} />
          <span>{t('companion.launcher')}</span>
        </button>
      )}

      {isOpen && (
        <section className="sp-companion" role="dialog" aria-label={t('companion.title')}>
          <header className="sp-companion__head">
            <div className="sp-companion__id">
              <span className="sp-companion__avatar" aria-hidden="true"><Icon name="spark" size={18} /></span>
              <div>
                <p className="sp-companion__title">{t('companion.title')}</p>
                <p className="sp-companion__subtitle">{t('companion.subtitle')}</p>
              </div>
            </div>
            <button className="sp-companion__close" onClick={close} aria-label={t('companion.close')}>
              <Icon name="arrow" size={18} />
            </button>
          </header>

          <p className="sp-companion__disclosure" dir="auto">
            <Icon name="lock" size={13} strokeWidth={2} aria-hidden="true" />
            {disclosure || t('companion.disclosure')}
          </p>

          <div className="sp-companion__body" ref={bodyRef}>
            {messages.length === 0 && (
              <div className="sp-companion__msg sp-companion__msg--assistant" dir="auto">
                {t('companion.greeting')}
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`sp-companion__msg sp-companion__msg--${m.role}`}
                dir="auto"
              >
                {m.text || (isStreaming ? t('companion.thinking') : '')}
              </div>
            ))}
          </div>

          <form className="sp-companion__composer" onSubmit={submit}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('companion.placeholder')}
              aria-label={t('companion.placeholder')}
              dir="auto"
            />
            <button type="submit" disabled={isStreaming || !draft.trim()} aria-label={t('companion.send')}>
              <Icon name="arrow" size={18} />
            </button>
          </form>
        </section>
      )}
    </>
  )
}
