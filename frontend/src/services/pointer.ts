/** How a coach pointer frame becomes something drawable — or deliberately
 *  doesn't. The lomda iframe is cross-origin: we cannot read its layout or
 *  scroll, so a precise highlight is allowed ONLY when the nightly capture
 *  says the screen fits without internal scroll and the runtime box is big
 *  enough for the captured fractions to still mean what they meant. Anything
 *  less trustworthy degrades to a whole-frame glow; no iframe at all means
 *  nothing is drawn. Wrong geometry is worse than none.
 */

import type { CoachPointerFrame } from './agents'

export type PointerPresentation =
  | { mode: 'rect'; rect: { x: number; y: number; w: number; h: number } }
  | { mode: 'glow' }
  | { mode: 'none' }

/** Below this the lomda has reflowed too far from the capture viewport for
 *  fractional rects to land on the same content. */
const MIN_BOX_W = 480
const MIN_BOX_H = 360

export function presentPointer(
  pointer: CoachPointerFrame | null,
  playback: 'frame' | 'tab',
  boxW: number,
  boxH: number,
): PointerPresentation {
  if (!pointer || playback !== 'frame') return { mode: 'none' }
  const rect = pointer.rect
  if (!rect || !pointer.no_scroll || boxW < MIN_BOX_W || boxH < MIN_BOX_H) {
    return { mode: 'glow' }
  }
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const clamped = {
    x: clamp(rect.x), y: clamp(rect.y), w: clamp(rect.w), h: clamp(rect.h),
  }
  if (clamped.w <= 0 || clamped.h <= 0) return { mode: 'glow' }
  return { mode: 'rect', rect: clamped }
}

/** A pointer belongs to one screen. The arrival push key can be partial
 *  (`component|item`), so identity is component+item — a stale pointer for a
 *  screen the learner left must never render. */
export function pointerMatchesKey(
  pointerKey: string, currentKey: string | null,
): boolean {
  if (!currentKey) return true // no signal to contradict it
  const [pc, pi] = String(pointerKey || '').split('|')
  const [cc, ci] = String(currentKey).split('|')
  return pc === cc && pi === ci
}
