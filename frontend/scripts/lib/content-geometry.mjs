/* Pure geometry for the content walker (scripts/content-extract.mjs).
 *
 * Everything here is plain math over boxes `{left, top, right, bottom}` and
 * rects `{x, y, w, h}` — no DOM, so it is unit-tested in node
 * (tests/content-geometry.test.ts). The walker uses it Node-side, on the
 * measurements it pulled out of the page.
 */

export const round1 = (v) => Math.round(v * 10) / 10

export const boxArea = (box) =>
  Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top)

export const toRect = (box) => ({
  x: round1(box.left), y: round1(box.top),
  w: round1(box.right - box.left), h: round1(box.bottom - box.top),
})

export const toBox = (rect) => ({
  left: rect.x, top: rect.y, right: rect.x + rect.w, bottom: rect.y + rect.h,
})

export function intersectBoxes(a, b) {
  const box = {
    left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
  }
  return box.right > box.left && box.bottom > box.top ? box : null
}

export function unionBoxes(boxes) {
  let out = null
  for (const box of boxes) {
    if (!box) continue
    out = out ? {
      left: Math.min(out.left, box.left), top: Math.min(out.top, box.top),
      right: Math.max(out.right, box.right), bottom: Math.max(out.bottom, box.bottom),
    } : { ...box }
  }
  return out
}

/** Nested matches (an option row, its label, its text wrapper) are ONE thing:
 *  keep the outermost, area-descending; a box ≥`overlap` inside a kept one is
 *  the same element again. Returned in reading order (top, then left). */
export function outermost(boxes, overlap = 0.55) {
  const kept = []
  for (const box of [...boxes].sort((a, b) => boxArea(b) - boxArea(a))) {
    const area = Math.max(1, boxArea(box))
    const inside = kept.some((k) => {
      const hit = intersectBoxes(box, k)
      return hit && boxArea(hit) / area > overlap
    })
    if (!inside) kept.push(box)
  }
  return kept.sort((a, b) => (a.top - b.top) || (a.left - b.left))
}

/** Two rects are "the same place" within `tol` px on every edge. */
export function sameRect(a, b, tol = 2) {
  if (!a || !b) return a === b
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
    && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol
}

/** How a screen's layout reacts to the viewport HEIGHT — the question the
 *  pointer overlay and the tall-frame experiment both ask.
 *
 *  `samples`: [{w, h, content_w, content_h, rects: {id: rect|null}}], one per
 *  measured viewport. Per width, the samples of different heights are
 *  compared:
 *  - height_independent: every object sits in the same place and the content
 *    is equally tall at every height → a frame of any height shows the same
 *    geometry; `natural_h` (the content height per width) is what a
 *    non-scrolling "tall frame" would be sized to.
 *  - fit_viewport: the content is never taller than the viewport (the player
 *    scales to fit) → geometry depends on height, but nothing ever scrolls.
 *  - height_dependent: anything else (reflow with height, sticky layouts).
 */
export function classifyLayout(samples, tol = 2) {
  const byWidth = new Map()
  for (const s of samples) {
    if (!s || !(s.w > 0) || !(s.h > 0)) continue
    byWidth.set(s.w, [...(byWidth.get(s.w) || []), s])
  }
  let independent = true
  let fits = true
  const naturalH = []
  for (const [width, column] of [...byWidth.entries()].sort((a, b) => a[0] - b[0])) {
    column.sort((a, b) => a.h - b.h)
    for (const s of column) if (s.content_h > s.h + tol) fits = false
    const first = column[0]
    let steady = column.length > 1
    for (const s of column.slice(1)) {
      if (Math.abs(s.content_h - first.content_h) > tol) steady = false
      const ids = new Set([...Object.keys(first.rects || {}), ...Object.keys(s.rects || {})])
      for (const id of ids) {
        if (!sameRect((first.rects || {})[id] || null, (s.rects || {})[id] || null, tol)) {
          steady = false
        }
      }
    }
    if (!steady) independent = false
    naturalH.push([width, Math.round(first.content_h)])
  }
  if (!byWidth.size) return { kind: 'height_dependent', natural_h: null }
  if (independent) return { kind: 'height_independent', natural_h: naturalH }
  if (fits) return { kind: 'fit_viewport', natural_h: null }
  return { kind: 'height_dependent', natural_h: null }
}

/** Rows of the v8 capture grid: [w, h, content_w, content_h], sorted. A
 *  height-independent screen keeps one height per width — the runtime's
 *  single-sample column path serves any box height from it. */
export function gridRows(samples, layoutKind) {
  const rows = []
  const seenWidths = new Set()
  for (const s of [...samples].sort((a, b) => (a.w - b.w) || (b.h - a.h))) {
    if (layoutKind === 'height_independent') {
      if (seenWidths.has(s.w)) continue
      seenWidths.add(s.w)
    }
    rows.push([s.w, s.h, Math.round(s.content_w), Math.round(s.content_h)])
  }
  return rows.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
}
