import { useEffect, useRef } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { useVoiceCall } from './useVoiceCall'
import './voice-call.css'

/** The spoken-practice panel inside Yuvi's chat.
 *
 *  It shows the transcript as it happens, so a learner can see that what they
 *  said was understood — and so the conversation leaves a readable trace
 *  without anyone keeping the recording. */
export function VoiceCallPanel({ surface, onClose }: { surface?: string; onClose: () => void }) {
  const { t, language } = useI18n()
  const { state, turns, disclosure, call, hangUp } = useVoiceCall(language, surface)
  const tail = useRef<HTMLDivElement | null>(null)

  useEffect(() => { tail.current?.scrollIntoView({ block: 'end' }) }, [turns.length])

  const live = state === 'listening' || state === 'speaking'

  return (
    <section className="vcall" aria-label={t('voice.title')}>
      <header className="vcall__head">
        <span className={`vcall__orb vcall__orb--${state}`} aria-hidden="true" />
        <div>
          <p className="vcall__title">{t('voice.title')}</p>
          <p className="vcall__state">{t(`voice.state.${state}`)}</p>
        </div>
        <button type="button" className="vcall__close" onClick={() => { hangUp(); onClose() }}>
          {t('voice.close')}
        </button>
      </header>

      {disclosure ? <p className="vcall__disclosure">{disclosure}</p> : null}

      <div className="vcall__transcript" role="log" aria-live="polite">
        {turns.length === 0 ? (
          <p className="vcall__hint">{t('voice.hint')}</p>
        ) : (
          turns.map((turn, index) => (
            <div key={index} className="vcall__row">
              <p className={`vcall__turn vcall__turn--${turn.role}`} dir="auto">
                {turn.text}
              </p>
              {turn.correction ? (
                <div className="vcall__fix" dir="auto">
                  <p className="vcall__fix-lead">{t('voice.fix.lead')}</p>
                  <p className="vcall__fix-say" dir="ltr" lang="en">{turn.correction.say}</p>
                  {turn.correction.note ? (
                    <p className="vcall__fix-note">{turn.correction.note}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
        <div ref={tail} />
      </div>

      {state === 'error' ? <p className="vcall__error">{t('voice.error')}</p> : null}

      <footer className="vcall__foot">
        {live ? (
          <button type="button" className="vcall__btn vcall__btn--end" onClick={hangUp}>
            {t('voice.end')}
          </button>
        ) : (
          <button
            type="button"
            className="vcall__btn"
            onClick={() => call()}
            disabled={state === 'connecting'}
          >
            {state === 'connecting' ? t('voice.state.connecting') : t('voice.start')}
          </button>
        )}
      </footer>
    </section>
  )
}
