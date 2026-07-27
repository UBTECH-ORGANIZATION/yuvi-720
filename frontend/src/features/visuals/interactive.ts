/* Drag support for Coach scenes (Phase 3).
 *
 * Two problems have to be solved for a handle to be honest:
 *
 * 1. LABELS GO STALE. The backend solves label positions against the scene as
 *    planned. Move a vertex and those coordinates describe a shape that no
 *    longer exists. Re-solving in the browser would mean porting the whole
 *    solver, so instead each label's OFFSET FROM ITS ANCHOR is recorded once;
 *    during a drag the anchor is recomputed and the offset re-applied. That
 *    keeps the side the solver chose while following the geometry.
 *
 * 2. MEASUREMENTS BECOME LIES. Side labels like "4" describe the planned
 *    triangle. Drag a vertex and "4" is simply wrong. But the labels are free
 *    text — "יתר" is not a measurement, and a triangle drawn 2 units wide may
 *    legitimately be labelled "40". So a live value is only substituted when
 *    the ORIGINAL labels are demonstrably measurements: all numeric, and all
 *    agreeing on one scene-units-per-label-unit ratio. Anything else is left
 *    exactly as the planner wrote it.
 */

import type { CoachVisualElement } from '../../services/agents'

export type Pt = [number, number]

export const handleKey = (element: number, vertex?: number) =>
  vertex === undefined ? `${element}` : `${element}:${vertex}`

/** Points for an element with any dragged overrides applied. */
export function effectivePoints(
  element: CoachVisualElement,
  index: number,
  drags: Record<string, Pt>,
): Pt[] {
  const base = (element.points as Pt[] | undefined) ?? []
  if (!Object.keys(drags).length) return base
  if (element.type === 'point') {
    const moved = drags[handleKey(index)]
    return moved ? [moved] : base
  }
  return base.map((p, i) => drags[handleKey(index, i)] ?? p)
}

const centroid = (pts: Pt[]): Pt => [
  pts.reduce((sum, p) => sum + p[0], 0) / pts.length,
  pts.reduce((sum, p) => sum + p[1], 0) / pts.length,
]

/** Where a label slot is anchored, in the same space as `pts`.
 *  Mirrors visual_layout.collect_label_requests so an offset recorded against
 *  the solver's anchor stays meaningful. */
export function anchorFor(type: string, slot: string, pts: Pt[]): Pt | null {
  if (!pts.length) return null
  if (slot.startsWith('labels:')) {
    const i = Number(slot.split(':')[1])
    return pts[i] ?? null
  }
  if (slot.startsWith('side_labels:')) {
    const i = Number(slot.split(':')[1])
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if (!a || !b) return null
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  }
  if (type === 'point') return pts[0]
  if (type === 'polygon') return centroid(pts)
  return pts[0]
}

const edgeLength = (pts: Pt[], i: number) => {
  const a = pts[i]
  const b = pts[(i + 1) % pts.length]
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

/** Scene-units-per-label-unit, or null when the labels are not measurements.
 *
 *  Returns a ratio only if EVERY side label parses as a number and they all
 *  agree on the same ratio. A triangle drawn 4 units wide and labelled "40" is
 *  a measurement at ratio 0.1; one labelled "יתר", or one whose numbers do not
 *  scale consistently, is not — and its labels must not be rewritten.
 */
export function measurementScale(element: CoachVisualElement, pts: Pt[]): number | null {
  const labels = element.side_labels as string[] | undefined
  if (!labels?.length || pts.length < 3) return null

  const ratios: number[] = []
  for (let i = 0; i < labels.length; i++) {
    const text = (labels[i] ?? '').trim()
    if (!text) continue
    if (!/^\d+(\.\d+)?$/.test(text)) return null       // not a measurement
    const length = edgeLength(pts, i)
    if (length < 1e-6) return null
    ratios.push(Number(text) / length)
  }
  if (ratios.length < 2) return null

  const first = ratios[0]
  const consistent = ratios.every((r) => Math.abs(r - first) / first < 0.02)
  return consistent ? first : null
}

/** Live side-label text for a dragged polygon, or the originals untouched. */
export function liveSideLabels(
  element: CoachVisualElement,
  originalPts: Pt[],
  currentPts: Pt[],
): string[] | null {
  const labels = element.side_labels as string[] | undefined
  if (!labels?.length) return null
  const scale = measurementScale(element, originalPts)
  if (scale === null) return null
  return labels.map((text, i) => {
    if (!text?.trim()) return text
    const value = edgeLength(currentPts, i) * scale
    // Match the planner's precision: "4" stays an integer, "4.5" keeps a decimal.
    const decimals = text.includes('.') ? 1 : Math.abs(value - Math.round(value)) < 0.05 ? 0 : 1
    return value.toFixed(decimals)
  })
}
