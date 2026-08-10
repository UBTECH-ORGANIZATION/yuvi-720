/* The card that does the talking.
 *
 * Positioning is computed here rather than in CSS because it has to be clamped
 * to the viewport: a spotlight near the bottom of Home would otherwise push the
 * card off-screen, which on a laptop means the tour silently dies. So we pick
 * the requested side, flip it if there is no room, and finally clamp both axes.
 *
 * Yuvi presents the tour. The teacher already knows this character from the
 * child's side of the product, and it is the cheapest possible way to say "the
 * same companion is with your students" without a paragraph about it.
 */

import { useEffect, useRef } from 'react'
import { Icon } from '../primitives/Icon'
import { YuviHeadIcon } from '../YuviHeadIcon'
import { useI18n } from '../../i18n/I18nProvider'
import type { Placement } from './steps/teacherTour'
import { physicalSide } from './steps/teacherTour'
import type { TargetRect } from './useTargetRect'
import './tour.css'

interface Props {
  titleKey: string
  bodyKey: string
  placement: Placement
  rect: TargetRect | null
  index: number
  total: number
  isRtl: boolean
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}

const CARD_WIDTH = 320
const CARD_ESTIMATE_HEIGHT = 190
const GAP = 16
const EDGE = 12

function place(rect: TargetRect | null, placement: Placement, isRtl: boolean) {
  if (!rect || placement === 'center') {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }

  const side = physicalSide(placement, isRtl)
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  let top = rect.top
  let left = rect.left

  if (side === 'bottom' || side === 'top') {
    // Flip when the requested side has no room — a card half off the bottom of
    // the screen reads as a broken tour, not a placement preference.
    const below = rect.top + rect.height + GAP
    const above = rect.top - CARD_ESTIMATE_HEIGHT - GAP
    const wantsBelow = side === 'bottom'
    const fitsBelow = below + CARD_ESTIMATE_HEIGHT < viewportH - EDGE
    const fitsAbove = above > EDGE
    top = wantsBelow ? (fitsBelow || !fitsAbove ? below : above)
                     : (fitsAbove || !fitsBelow ? above : below)
    left = rect.left + rect.width / 2 - CARD_WIDTH / 2
  } else {
    top = rect.top + rect.height / 2 - CARD_ESTIMATE_HEIGHT / 2
    left = side === 'right' ? rect.left + rect.width + GAP : rect.left - CARD_WIDTH - GAP
  }

  return {
    top: `${Math.min(Math.max(top, EDGE), Math.max(EDGE, viewportH - CARD_ESTIMATE_HEIGHT - EDGE))}px`,
    left: `${Math.min(Math.max(left, EDGE), Math.max(EDGE, viewportW - CARD_WIDTH - EDGE))}px`,
    transform: 'none',
  }
}

export function TourStepCard(
  { titleKey, bodyKey, placement, rect, index, total, isRtl, onBack, onNext, onSkip }: Props
) {
  const { t } = useI18n()
  const cardRef = useRef<HTMLDivElement | null>(null)
  const isLast = index === total - 1

  // Focus the card on every step so a keyboard user follows the tour rather
  // than being left back on whatever had focus before it opened.
  useEffect(() => { cardRef.current?.focus() }, [index])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onSkip(); return }
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
      style={place(rect, placement, isRtl)}
      role="dialog"
      aria-modal="true"
      aria-label={t(titleKey)}
      tabIndex={-1}
      data-tour-card={index}
    >
      <div className="sp-tour__cardHead">
        <YuviHeadIcon className="sp-tour__yuvi" width={34} height={34} />
        <h2>{t(titleKey)}</h2>
        <button type="button" className="sp-tour__close" onClick={onSkip}
                aria-label={t('tour.skip')}>
          <Icon name="close" size={16} aria-hidden />
        </button>
      </div>

      <p className="sp-tour__body">{t(bodyKey)}</p>

      <div className="sp-tour__foot">
        <span className="sp-tour__progress" aria-live="polite">
          {t('tour.progress', { current: index + 1, total })}
        </span>
        <div className="sp-tour__actions">
          <button type="button" className="sp-tour__skip" onClick={onSkip}>
            {t('tour.skip')}
          </button>
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
