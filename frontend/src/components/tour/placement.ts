/* Where the card lands, and therefore where Yuvi may not stand.
 *
 * Shared because the two have to agree. The card asks for a side and then
 * FLIPS if there is no room — near the bottom of the page a `top` placement
 * becomes a bottom one. The guide used to read the requested side and park
 * itself opposite that, so on exactly those flipped steps it parked underneath
 * the card and vanished behind it (the card sits one layer up). Both now
 * resolve the same side from the same function.
 */

import { physicalSide, type Placement } from './steps/types'
import type { TargetRect } from './useTargetRect'

export const CARD_WIDTH = 320
export const CARD_HEIGHT = 190
export const GAP = 16
export const EDGE = 12

export type Side = 'top' | 'bottom' | 'left' | 'right' | 'center'

/** The side the card will ACTUALLY sit on, flip included. */
export function resolveSide(
  rect: TargetRect | null, placement: Placement, isRtl: boolean,
): Side {
  if (!rect || placement === 'center') return 'center'
  const side = physicalSide(placement, isRtl)
  if (side !== 'top' && side !== 'bottom') return side

  const viewportH = window.innerHeight
  const fitsBelow = rect.top + rect.height + GAP + CARD_HEIGHT < viewportH - EDGE
  const fitsAbove = rect.top - CARD_HEIGHT - GAP > EDGE
  if (side === 'bottom') return fitsBelow || !fitsAbove ? 'bottom' : 'top'
  return fitsAbove || !fitsBelow ? 'top' : 'bottom'
}

/** Absolute position for the card, clamped so it can never leave the screen. */
export function cardRect(rect: TargetRect | null, placement: Placement, isRtl: boolean) {
  const side = resolveSide(rect, placement, isRtl)
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  if (!rect || side === 'center') {
    return {
      top: viewportH / 2 - CARD_HEIGHT / 2,
      left: viewportW / 2 - CARD_WIDTH / 2,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      side,
    }
  }

  let top: number
  let left: number

  if (side === 'bottom' || side === 'top') {
    top = side === 'bottom'
      ? rect.top + rect.height + GAP
      : rect.top - CARD_HEIGHT - GAP
    left = rect.left + rect.width / 2 - CARD_WIDTH / 2
  } else {
    top = rect.top + rect.height / 2 - CARD_HEIGHT / 2
    left = side === 'right' ? rect.left + rect.width + GAP : rect.left - CARD_WIDTH - GAP
  }

  return {
    top: Math.min(Math.max(top, EDGE), Math.max(EDGE, viewportH - CARD_HEIGHT - EDGE)),
    left: Math.min(Math.max(left, EDGE), Math.max(EDGE, viewportW - CARD_WIDTH - EDGE)),
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    side,
  }
}

export function placeCard(rect: TargetRect | null, placement: Placement, isRtl: boolean) {
  const box = cardRect(rect, placement, isRtl)
  if (!rect || box.side === 'center') {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }
  return { top: `${box.top}px`, left: `${box.left}px`, transform: 'none' }
}
