/** How a coach pointer frame becomes something drawable — or deliberately
 *  doesn't. The lomda iframe is cross-origin: we cannot read its layout or
 *  scroll, so geometry is authored by the nightly capture, which measures the
 *  same screen on a grid of viewport SIZES (widths × heights): the CET player
 *  transform-scales and centers by width, methodica FITS the viewport
 *  (scale = min(width-fit, height-fit)) — one size's coordinates land wrong
 *  at any other. The runtime bilinear-interpolates its live box between the
 *  surrounding samples and draws in pixels; a height-constant screen makes
 *  the height axis a natural no-op. Anything less trustworthy degrades to a
 *  whole-frame glow; no iframe at all means nothing is drawn. Wrong geometry
 *  is worse than none.
 */

import type { CoachPointerFrame, PointerBreakpoint } from './agents'

export type PointerPresentation =
  /** Pixel rect relative to the frame box — the capture was measured at (or
   *  interpolated to) exactly this box width, so pixels map one-to-one. */
  | { mode: 'rect'; rect: { x: number; y: number; w: number; h: number } }
  /** The target lives below the internal fold of a screen that scrolls
   *  inside the iframe (whose scroll we cannot read) — show a "look lower"
   *  chevron at the frame's bottom edge, horizontally near the target.
   *  `x` is a fraction of the box width. */
  | { mode: 'edge'; x: number }
  | { mode: 'glow' }
  | { mode: 'none' }

/** Below this the lomda has reflowed too far from any capture for geometry
 *  to mean the same content. */
const MIN_BOX_W = 480
const MIN_BOX_H = 360
/** How far outside the sampled width range extrapolation is still honest —
 *  a centered layout keeps shifting linearly, but only for a while. */
const RANGE_TOLERANCE = 0.2
/** For a HEIGHT-responsive screen (its height samples differ), how far the
 *  live box height may sit outside the sampled heights. A height-constant
 *  screen ignores this — any height reads the same geometry. */
const HEIGHT_TOLERANCE = 0.25
/** A single sampled width can serve alone only this close to the live one. */
const LONE_TOLERANCE = 0.08

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

interface Placed {
  rect: { x: number; y: number; w: number; h: number }
  contentH: number
}

function lerpPlaced(a: Placed, b: Placed, t: number): Placed {
  return {
    rect: {
      x: lerp(a.rect.x, b.rect.x, t),
      y: lerp(a.rect.y, b.rect.y, t),
      w: lerp(a.rect.w, b.rect.w, t),
      h: lerp(a.rect.h, b.rect.h, t),
    },
    contentH: lerp(a.contentH, b.contentH, t),
  }
}

/** Interpolate one width's height samples to the live box height, or null
 *  when a height-responsive screen is sampled too far from it. */
function columnAt(column: PointerBreakpoint[], boxH: number): Placed | null {
  const placedOf = (bp: PointerBreakpoint): Placed =>
    ({ rect: { ...bp.rect }, contentH: bp.content_h })
  if (column.length === 1) return placedOf(column[0])
  const low = column[0]
  const high = column[column.length - 1]
  const heightConstant =
    Math.abs(low.rect.x - high.rect.x) < 2 && Math.abs(low.rect.y - high.rect.y) < 2
    && Math.abs(low.rect.w - high.rect.w) < 2 && Math.abs(low.rect.h - high.rect.h) < 2
    && Math.abs(low.content_h - high.content_h) < 2
  if (heightConstant) return placedOf(high)
  if (boxH < low.h * (1 - HEIGHT_TOLERANCE)) return null
  if (boxH > high.h * (1 + HEIGHT_TOLERANCE)) return null
  const t = (boxH - low.h) / (high.h - low.h)
  return lerpPlaced(placedOf(low), placedOf(high), t)
}

/** Bilinear-interpolate the capture grid to the live box, or null when the
 *  sampled sizes cannot honestly describe it. */
function placeAt(
  breakpoints: PointerBreakpoint[], boxW: number, boxH: number,
): Placed | null {
  const bps = breakpoints
    .filter((bp) => bp && bp.w > 0 && bp.h > 0
      && bp.rect && bp.rect.w > 0 && bp.rect.h > 0)
  if (!bps.length) return null
  // Group into width columns; each column holds that width's height samples.
  const byWidth = new Map<number, PointerBreakpoint[]>()
  for (const bp of bps) {
    byWidth.set(bp.w, [...(byWidth.get(bp.w) || []), bp])
  }
  const widths = [...byWidth.keys()].sort((a, b) => a - b)
  for (const w of widths) byWidth.get(w)!.sort((a, b) => a.h - b.h)
  if (widths.length === 1) {
    const only = columnAt(byWidth.get(widths[0])!, boxH)
    if (!only) return null
    if (Math.abs(boxW - widths[0]) / widths[0] > LONE_TOLERANCE) return null
    const s = boxW / widths[0]
    return {
      rect: { x: only.rect.x * s, y: only.rect.y * s, w: only.rect.w * s, h: only.rect.h * s },
      contentH: only.contentH * s,
    }
  }
  if (boxW < widths[0] * (1 - RANGE_TOLERANCE)) return null
  if (boxW > widths[widths.length - 1] * (1 + RANGE_TOLERANCE)) return null
  // The surrounding width pair — or the nearest two, extrapolating linearly
  // just past the sampled range (a centered layout's margins grow linearly).
  let i0 = 0
  for (let i = 0; i < widths.length - 1; i += 1) {
    if (widths[i] <= boxW) i0 = i
  }
  const w0 = widths[i0]
  const w1 = widths[i0 + 1]
  const c0 = columnAt(byWidth.get(w0)!, boxH)
  const c1 = columnAt(byWidth.get(w1)!, boxH)
  if (!c0 || !c1) return null
  return lerpPlaced(c0, c1, (boxW - w0) / (w1 - w0))
}

export function presentPointer(
  pointer: CoachPointerFrame | null,
  playback: 'frame' | 'tab',
  boxW: number,
  boxH: number,
): PointerPresentation {
  if (!pointer || playback !== 'frame') return { mode: 'none' }
  if (!pointer.region || !pointer.breakpoints?.length) return { mode: 'glow' }
  if (boxW < MIN_BOX_W || boxH < MIN_BOX_H) return { mode: 'glow' }
  const placed = placeAt(pointer.breakpoints, boxW, boxH)
  if (!placed) return { mode: 'glow' }
  const { rect, contentH } = placed
  if (rect.w <= 0 || rect.h <= 0) return { mode: 'glow' }
  if (contentH > boxH * 1.05) {
    // The content overflows the live box, so the iframe scrolls internally —
    // and that scroll is unreadable from outside. A target below the first
    // viewport gets the honest directional cue; one above it could still be
    // scrolled away, so the whole-frame glow is as precise as truth allows.
    if (rect.y > boxH * 0.92) {
      return { mode: 'edge', x: Math.min(1, Math.max(0, (rect.x + rect.w / 2) / boxW)) }
    }
    return { mode: 'glow' }
  }
  return {
    mode: 'rect',
    rect: {
      x: Math.max(0, Math.min(boxW, rect.x)),
      y: Math.max(0, Math.min(boxH, rect.y)),
      w: Math.min(boxW, rect.w),
      h: Math.min(boxH, rect.h),
    },
  }
}

/** A pointer belongs to one screen. Either key can be partial — the arrival
 *  push is `component|item`, and a player that only reports on answers leaves
 *  the current key as `component||` (the assumed-screen case). An empty
 *  segment is a wildcard, not a contradiction: only two PRESENT segments that
 *  differ prove the learner left the screen the pointer describes. */
export function pointerMatchesKey(
  pointerKey: string, currentKey: string | null,
): boolean {
  if (!currentKey) return true // no signal to contradict it
  const [pc, pi] = String(pointerKey || '').split('|')
  const [cc, ci] = String(currentKey).split('|')
  if (pc && cc && pc !== cc) return false
  if (pi && ci && pi !== ci) return false
  return true
}
