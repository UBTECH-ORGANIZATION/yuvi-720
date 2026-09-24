/** The tall-frame experiment (flagged; see backend `GET /coach/screen-frames`).
 *
 *  The lomda iframe is cross-origin, so when its content is taller than the
 *  frame it scrolls INSIDE, where we cannot read the scroll — and a focus
 *  mark on such a screen can only be named, not drawn. For a screen whose
 *  layout does not depend on the viewport height (capture v8
 *  `height_independent`, e.g. the CET player), the iframe can instead be as
 *  tall as its content: the PAGE scrolls, which we can read and drive, and
 *  every mark on the screen becomes an exact rect.
 *
 *  Pure functions only; LessonPage owns the DOM. */

export type ScreenLayoutKind = 'height_independent' | 'fit_viewport' | 'height_dependent'

export interface ScreenLayout {
  kind: ScreenLayoutKind
  /** [capture width, natural content height] per sampled width. */
  natural_h: [number, number][] | null
}

export interface ScreenFrames {
  tall_frame: boolean
  player_host: string
  items: Record<string, ScreenLayout>
}

/** How far outside the sampled widths the content height may be inferred. */
const RANGE_TOLERANCE = 0.2
const LONE_TOLERANCE = 0.08
/** A canvas taller than this is not a frame any more; leave it scrolling. */
export const TALL_MAX = 4000
/** The learner scrolled this recently: do not move the page under them. */
export const USER_SCROLL_GRACE_MS = 1500

/** The canvas height for this screen at this box, or null to keep the
 *  normal frame (not height-independent, unknown width, or it already fits). */
export function tallCanvasHeight(layout: ScreenLayout | null | undefined, boxW: number, boxH: number): number | null {
  if (!layout || layout.kind !== 'height_independent' || !layout.natural_h?.length) return null
  if (!(boxW > 0) || !(boxH > 0)) return null
  const samples = [...layout.natural_h].filter(([w, h]) => w > 0 && h > 0).sort((a, b) => a[0] - b[0])
  if (!samples.length) return null
  let height: number
  if (samples.length === 1) {
    const [w, h] = samples[0]
    if (Math.abs(boxW - w) / w > LONE_TOLERANCE) return null
    height = h * (boxW / w)
  } else {
    const minW = samples[0][0]
    const maxW = samples[samples.length - 1][0]
    if (boxW < minW * (1 - RANGE_TOLERANCE) || boxW > maxW * (1 + RANGE_TOLERANCE)) return null
    let i = 0
    for (let k = 0; k < samples.length - 1; k += 1) if (samples[k][0] <= boxW) i = k
    const [w0, h0] = samples[i]
    const [w1, h1] = samples[i + 1]
    height = h0 + (h1 - h0) * ((boxW - w0) / (w1 - w0))
  }
  height = Math.round(height)
  if (height <= boxH * 1.02 || height > TALL_MAX) return null
  return height
}

/** `component|item|question` → item. */
export function itemOfKey(key: string | null | undefined): string {
  return String(key || '').split('|')[1] || ''
}

/** Where to scroll the page so a mark is in view, or null when it already is. */
export function scrollTargetFor(
  rect: { y: number; h: number }, viewTop: number, viewH: number, margin = 48,
): number | null {
  if (rect.y >= viewTop + 8 && rect.y + Math.min(rect.h, viewH - 16) <= viewTop + viewH - 8) return null
  return Math.max(0, Math.round(rect.y - margin))
}

export function mayAutoScroll(lastUserScrollAt: number, now: number): boolean {
  return now - lastUserScrollAt > USER_SCROLL_GRACE_MS
}
