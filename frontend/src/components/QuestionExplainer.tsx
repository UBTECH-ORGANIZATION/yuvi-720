import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { getQuestionExplainer, type ExplainerDeck } from '../services/agents'
import { Icon } from './primitives'

interface QuestionExplainerProps {
  componentId: string | null
  language: string
  onClose: () => void
}

type Phase = 'loading' | 'ready' | 'error'

/* "Learn it another way" — a short generated slide deck (with 1–2 Manim
   animations) that re-explains the current question. The deck is cached per
   question across all learners, so only the first student ever waits for it. */
export function QuestionExplainer({ componentId, language, onClose }: QuestionExplainerProps) {
  const { t, direction } = useI18n()
  const [phase, setPhase] = useState<Phase>('loading')
  const [deck, setDeck] = useState<ExplainerDeck | null>(null)
  const [index, setIndex] = useState(0)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    let attempts = 0
    let timer = 0
    const poll = async (first = false) => {
      try {
        const res = await getQuestionExplainer(componentId, language, first)
        if (cancelled.current) return
        if (res.status === 'ready' && res.deck?.slides?.length) {
          setDeck(res.deck)
          setPhase('ready')
          return
        }
        if (res.status === 'unavailable') {
          setPhase('error')
          return
        }
        attempts += 1
        if (attempts > 40) {           // ~2 min ceiling on a cold generation
          setPhase('error')
          return
        }
        timer = window.setTimeout(() => void poll(false), 3000)
      } catch {
        if (!cancelled.current) setPhase('error')
      }
    }
    void poll(true)   // first open → logged once as "different way" usage
    return () => {
      cancelled.current = true
      window.clearTimeout(timer)
    }
  }, [componentId, language])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const slides = deck?.slides || []
  const slide = slides[index] || null
  const atStart = index === 0
  const atEnd = index >= slides.length - 1

  return (
    <div className="sp-explainer-backdrop" role="presentation" onClick={onClose}>
      <section
        className="sp-explainer"
        role="dialog"
        aria-modal="true"
        aria-label={t('companion.explainer.title')}
        dir={direction}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sp-explainer__head">
          <span className="sp-explainer__badge" aria-hidden="true"><Icon name="spark" size={16} /></span>
          <strong>{t('companion.explainer.title')}</strong>
          <button
            type="button"
            className="sp-explainer__close"
            onClick={onClose}
            aria-label={t('companion.explainer.close')}
          >
            ×
          </button>
        </header>

        {phase === 'loading' && (
          <div className="sp-explainer__state" role="status">
            <span className="sp-explainer__spinner" aria-hidden="true" />
            <p>{t('companion.explainer.generating')}</p>
            <small>{t('companion.explainer.generatingHint')}</small>
          </div>
        )}

        {phase === 'error' && (
          <div className="sp-explainer__state">
            <p>{t('companion.explainer.error')}</p>
            <button type="button" className="is-primary" onClick={onClose}>
              {t('companion.explainer.close')}
            </button>
          </div>
        )}

        {phase === 'ready' && slide && (
          <>
            <div className="sp-explainer__stage">
              <article className="sp-explainer__slide" dir="auto" key={index}>
                {slide.visual && (
                  <figure className="sp-explainer__visual">
                    {slide.visual.type === 'video' ? (
                      <video
                        src={slide.visual.data_url}
                        autoPlay
                        muted
                        loop
                        playsInline
                        aria-label={slide.visual.alt || slide.title}
                      />
                    ) : (
                      <img src={slide.visual.data_url} alt={slide.visual.alt || slide.title} />
                    )}
                  </figure>
                )}
                {slide.title && <h3>{slide.title}</h3>}
                {slide.body && <p>{slide.body}</p>}
              </article>
            </div>

            <footer className="sp-explainer__foot">
              <div className="sp-explainer__dots" aria-hidden="true">
                {slides.map((_, i) => (
                  <i key={i} className={i === index ? 'is-active' : ''} />
                ))}
              </div>
              <div className="sp-explainer__nav">
                <button
                  type="button"
                  disabled={atStart}
                  onClick={() => setIndex((value) => Math.max(0, value - 1))}
                >
                  {t('companion.explainer.prev')}
                </button>
                {atEnd ? (
                  <button type="button" className="is-primary" onClick={onClose}>
                    {t('companion.explainer.done')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="is-primary"
                    onClick={() => setIndex((value) => Math.min(slides.length - 1, value + 1))}
                  >
                    {t('companion.explainer.next')}
                  </button>
                )}
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
