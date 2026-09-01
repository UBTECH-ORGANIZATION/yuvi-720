/* The card that does the talking.
 *
 * Positioning lives in `placement.ts` because it has to be clamped to the
 * viewport — a spotlight near the bottom of the page would otherwise push the
 * card off-screen, which on a laptop means the tour silently dies — and because
 * the flying guide has to know which side the card really took.
 *
 * Yuvi presents the tour. The teacher already knows this character from the
 * child's side of the product, and it is the cheapest possible way to say "the
 * same companion is with your students" without a paragraph about it.
 */

import { useEffect, useRef } from 'react'
import { Icon } from '../primitives/Icon'
import { YuviHeadIcon } from '../YuviHeadIcon'
import { useI18n } from '../../i18n/I18nProvider'
import { placeCard } from './placement'
import type { Placement } from './steps/types'
import type { TargetRect } from './useTargetRect'
import './tour.css'

interface Props {
  titleKey: string
  bodyKey: string
  /** Interpolated into both strings; the welcome step greets by name. */
  values?: Record<string, string | number>
  placement: Placement
  rect: TargetRect | null
  index: number
  total: number
  isRtl: boolean
  onBack: () => void
  onNext: () => void
  /** Absent on a tour that cannot be walked out of — the learner's first run. */
  onSkip?: () => void
}

export function TourStepCard(
  { titleKey, bodyKey, values, placement, rect, index, total, isRtl, onBack, onNext, onSkip }: Props
) {
  const { t } = useI18n()
  const cardRef = useRef<HTMLDivElement | null>(null)
  const isLast = index === total - 1

  // Focus the card on every step so a keyboard user follows the tour rather
  // than being left back on whatever had focus before it opened.
  useEffect(() => { cardRef.current?.focus() }, [index])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape is a way out, so it obeys the same rule as the skip button.
      if (event.key === 'Escape') { onSkip?.(); return }
      // Arrows are physical keys: in RTL the *visual* forward key is the left
      // one, so they swap with the reading direction.
      const forward = isRtl ? 'ArrowLeft' : 'ArrowRight'
      const back = isRtl ? 'ArrowRight' : 'ArrowLeft'
      if (event.key === forward) { event.preventDefault(); onNext() }
      if (event.key === back && index > 0) { event.preventDefault(); onBack() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, isRtl, onBack, onNext, onSkip])

  return (
    <div
      ref={cardRef}
      className="sp-tour__card"
      style={placeCard(rect, placement, isRtl)}
      role="dialog"
      aria-modal="true"
      aria-label={t(titleKey, values)}
      tabIndex={-1}
      data-tour-card={index}
    >
      <div className="sp-tour__cardHead">
        <YuviHeadIcon className="sp-tour__yuvi" width={34} height={34} />
        <h2>{t(titleKey, values)}</h2>
        {onSkip ? (
          <button type="button" className="sp-tour__close" onClick={onSkip}
            aria-label={t('tour.skip')}>
            <Icon name="close" size={16} aria-hidden />
          </button>
        ) : null}
      </div>

      <p className="sp-tour__body">{t(bodyKey, values)}</p>

      <div className="sp-tour__foot">
        <span className="sp-tour__progress" aria-live="polite">
          {t('tour.progress', { current: index + 1, total })}
        </span>
        <div className="sp-tour__actions">
          {onSkip ? (
            <button type="button" className="sp-tour__skip" onClick={onSkip}>
              {t('tour.skip')}
            </button>
          ) : null}
          {index > 0 ? (
            <button type="button" className="sp-tour__back" onClick={onBack}>
              {t('tour.back')}
            </button>
          ) : null}
          <button type="button" className="sp-btn sp-btn--primary sp-btn--sm" onClick={onNext}>
            {t(isLast ? 'tour.done' : 'tour.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
