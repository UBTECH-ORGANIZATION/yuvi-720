/* MafsScene — draws a validated Coach scene in the browser (Phase 2).
 *
 * The backend plans and sanitizes a scene, then solves every label position
 * against the renderer canvas (app/agents/visual_layout.py). This component
 * consumes that same solved layout, so an in-browser still and its Manim video
 * twin place their text identically — layout is not a per-renderer concern.
 *
 * Coordinates: element coordinates are DATA coordinates when the scene has an
 * `axes` element and canvas coordinates otherwise, exactly as the Python
 * renderer treats them. `layout` entries are ALWAYS canvas coordinates and are
 * used as-is — never re-projected.
 */

import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Mafs, Coordinates, Plot, Point, Polygon, Line, Circle, Text, useMovablePoint } from 'mafs'
import 'mafs/core.css'
import './scene.css'
import type { CoachVisualElement, CoachVisualScene } from '../../services/agents'
import { anchorFor, effectivePoints, handleKey, liveSideLabels } from './interactive'

// Mirrors manim_visual.MAX_HANDLES. Hooks cannot be called conditionally, so a
// fixed number of movable points is created and only the declared ones render.
const MAX_HANDLES = 4

// Must match manim_visual.COLORS — the same names appear in the scene spec.
const COLORS: Record<string, string> = {
  primary: '#6f5bff',
  secondary: '#33b8cf',
  accent: '#f2a91b',
  success: '#21a67a',
  warning: '#df704d',
  ink: '#302b4a',
  muted: '#77718f',
  white: '#ffffff',
}

// The canvas the backend solver reasons about (Manim's default frame).
const FRAME_X = 7.1
const FRAME_Y = 4.0

type Pt = [number, number]

const colorOf = (element: CoachVisualElement): string =>
  COLORS[String(element.color ?? 'primary')] ?? COLORS.primary

const xy = (p: Pt) => ({ x: p[0], y: p[1] })

const points = (element: CoachVisualElement): Pt[] =>
  Array.isArray(element.points) ? (element.points as Pt[]) : []

// Mirrors visual_layout / manim_worker for scenes WITHOUT axes.
const FIT_TARGET_X: Pt = [-5.35, 5.35]
const FIT_TARGET_X_WITH_FORMULA: Pt = [-5.45, 0.35]
const FIT_TARGET_Y: Pt = [-2.45, 2.45]
const FORMULA_PATTERN = /(?:=|\\frac|\\sqrt|\b(?:sin|cos|tan|log)\s*\(|[A-Za-zα-ωΑ-Ωθ]\s*[\^/])/i
const POINT_KINDS = new Set(['polygon', 'polyline', 'line', 'arrow', 'point', 'angle', 'right_angle', 'brace'])
const CENTER_KINDS = new Set(['circle', 'rectangle', 'arc'])

/* Manim's Brace occupies this band outward from the span it measures — the
 * same at any length. The backend models it as an obstacle so a brace's own
 * label clears the curl, so this renderer must draw it at the same depth. */
const BRACE_GAP = 0.2
const BRACE_REACH = 0.473
const BRACE_BAR = 0.34

/* A number line's tick numbers. These are drawn by the element rather than
 * solved, so the backend's placement solver models them as obstacles — which
 * means this renderer has to actually DRAW them, at the position the solver
 * assumed, or labels get pushed away from empty space. It was drawing a bare
 * segment with dots and no numbers at all, so a still and its video twin
 * disagreed about what a number line even looks like.
 *
 * Ported from manim_worker's number_line block; the drift guard in
 * test_visual_layout reads both copies. */
const TICK_DROP = 0.42
const TICK_HALF = 0.1

/* Label text must be sized from the RENDERED scale, not in fixed pixels.
 *
 * The solver guarantees labels do not collide, and it states that guarantee in
 * canvas units. Mafs draws text in CSS pixels, so a fixed `size` only honours
 * the guarantee at one container width: in the 346px chat column the geometry
 * shrank while the text did not, and every label overlapped. These mirror the
 * backend's own numbers (visual_layout: _UNITS_PER_POINT, and the font_size of
 * each label request) so a glyph occupies the height the solver reserved for
 * it at any width. */
const UNITS_PER_POINT = 0.01
const TICK_FONT = 18
const VERTEX_FONT = 26
const DEFAULT_LABEL_FONT = 24
const LABEL_FONT: Record<string, number> = { text: 28, point: 26, number_line: 25 }

/** Python's `f"{v:g}"` — 6 significant digits, trailing zeros stripped. */
function formatTick(value: number): string {
  return String(Number(value.toPrecision(6)))
}

function numberLineTicks(element: CoachVisualElement, lengthOf: (a: Pt, b: Pt) => number) {
  const [start, end, step] = element.range as number[]
  const height = ((element.position as number[]) ?? [0, 0])[1]
  const empty = { values: [] as number[], labelled: [] as number[], height }
  if (!(step > 0) || end < start) return empty

  const values: number[] = []
  for (let cursor = start; cursor <= end + 1e-9 && values.length < 4000; cursor += step) {
    values.push(cursor)
  }
  if (!values.length) return empty

  const marks = (element.marks as number[] | undefined) ?? []
  const lastIndex = values.length - 1
  const perTick = Math.max(lengthOf([start, height], [end, height]) / Math.max(lastIndex, 1), 1e-6)
  const widest = Math.max(...values.map((value) => formatTick(value).length))
  const minGap = Math.max(1, Math.ceil((widest * 0.12 + 0.16) / perTick))

  // `selected` grows while it is being tested against — marks claim their slots
  // first, endpoints and the stride fill in only where they clear the gap.
  const selected: number[] = []
  values.forEach((value, i) => {
    if (marks.some((mark) => Math.abs(value - mark) < 1e-6)) selected.push(i)
  })
  for (const candidate of [0, lastIndex]) {
    if (selected.every((chosen) => Math.abs(candidate - chosen) >= minGap)) selected.push(candidate)
  }
  for (let candidate = 0; candidate < values.length; candidate += minGap) {
    if (selected.every((chosen) => Math.abs(candidate - chosen) >= minGap)) selected.push(candidate)
  }
  return { values, labelled: [...new Set(selected)].sort((a, b) => a - b), height }
}

/** The view to show for a canvas-space scene.
 *
 *  The solved frame is 14.2x8 but a scene rarely fills it — a number line uses
 *  under half the height — so showing the whole frame shrinks the drawing until
 *  a chat-sized preview has to be opened to be read. `scene.content` is the
 *  region actually occupied, published by the solver.
 *
 *  Interactive scenes keep the full frame: a dragged vertex needs somewhere to
 *  go, and cropping to where the shape started would pen it in.
 */
function canvasView(scene: CoachVisualScene, toCanvas: (p: Pt) => Pt) {
  const full = { x: [-FRAME_X, FRAME_X] as Pt, y: [-FRAME_Y, FRAME_Y] as Pt }
  if (scene.interactive?.handles?.length) return full
  const content = scene.content ?? inferContent(scene, toCanvas)
  if (!content) return full
  const [x0, y0, x1, y1] = content
  if (!(x1 > x0 && y1 > y0)) return full
  return { x: [x0, x1] as Pt, y: [y0, y1] as Pt }
}

/** Approximate content bounds for scenes stored before the backend published
 *  them. Deliberately generous: this only chooses a crop rectangle, so erring
 *  wide costs a little empty space while erring tight would clip a label. The
 *  exact version lives in visual_layout.content_bounds and wins when present. */
function inferContent(
  scene: CoachVisualScene,
  toCanvas: (p: Pt) => Pt,
): [number, number, number, number] | null {
  const xs: number[] = []
  const ys: number[] = []

  const addGeometry = (p: Pt) => {
    const [x, y] = toCanvas(p)
    xs.push(x - 0.3, x + 0.3)
    ys.push(y - 0.3, y + 0.3)
  }

  for (const element of scene.elements) {
    if (POINT_KINDS.has(element.type)) points(element).forEach(addGeometry)
    else if (CENTER_KINDS.has(element.type)) {
      const [cx, cy] = element.center as Pt
      const r = Number(element.radius ?? 0)
      const w = Number(element.width ?? 0) / 2
      const h = Number(element.height ?? 0) / 2
      const spreadX = Math.max(r, w)
      const spreadY = Math.max(r, h)
      addGeometry([cx - spreadX, cy - spreadY])
      addGeometry([cx + spreadX, cy + spreadY])
    } else if (element.type === 'number_line') {
      const [start, end] = element.range as number[]
      const height = ((element.position as number[]) ?? [0, 0])[1]
      addGeometry([start, height])
      addGeometry([end, height])
      // The tick row hangs below the line and is not a solved label.
      ys.push(toCanvas([start, height])[1] - TICK_DROP - 0.3)
    }

    // Solved labels are already canvas-space. Estimate the glyph box the way
    // the backend does (RTL advance for everything, so it never under-covers).
    for (const [slot, position] of Object.entries(element.layout ?? {})) {
      const text = slot.startsWith('labels:') || slot.startsWith('side_labels:')
        ? String((element.labels as string[] | undefined)?.[0] ?? 'M')
        : String(element.label ?? '')
      const size = (LABEL_FONT[element.type] ?? DEFAULT_LABEL_FONT) * UNITS_PER_POINT
      const halfH = size * 1.28 / 2
      const halfW = Math.max(text.length * 0.8, 0.9) * size / 2
      xs.push(position[0] - halfW, position[0] + halfW)
      ys.push(position[1] - halfH, position[1] + halfH)
    }
  }

  if (!xs.length || !ys.length) return null
  return [
    Math.max(Math.min(...xs) - 0.25, -FRAME_X),
    Math.max(Math.min(...ys) - 0.25, -FRAME_Y),
    Math.min(Math.max(...xs) + 0.25, FRAME_X),
    Math.min(Math.max(...ys) + 0.25, FRAME_Y),
  ]
}

/** Which space are shapes drawn in, and how do solved labels get there?
 *
 *  Solved `layout` positions are ALWAYS canvas coordinates. Element
 *  coordinates are not:
 *
 *   - with axes: they are DATA coordinates. Draw shapes as-is in a data-range
 *     viewBox and convert each label canvas→data.
 *   - without axes: the renderer fits the geometry's bounding box into a target
 *     rectangle. Shapes must go through that same fit or they land in a
 *     different place from their labels — which is exactly what happened when
 *     this branch was missing: triangles drawn at raw coords with their vertex
 *     labels floating a scale factor away.
 */
function useTransform(scene: CoachVisualScene) {
  return useMemo(() => {
    const identity = (p: Pt): Pt => p
    const axes = scene.elements.find((element) => element.type === 'axes')

    if (axes) {
      const [x0, x1] = (axes.x_range as number[]) ?? [-1, 1]
      const [y0, y1] = (axes.y_range as number[]) ?? [-1, 1]
      const position = (axes.position as number[]) ?? [0, 0]
      const hasCircle = scene.elements.some((element) => element.type === 'circle')
      let xLength = 9.5
      let yLength = 5.4
      if (hasCircle) {
        const unit = Math.min(xLength / (x1 - x0), yLength / (y1 - y0))
        xLength = (x1 - x0) * unit
        yLength = (y1 - y0) * unit
      }
      const scaleX = xLength / Math.max(x1 - x0, 1e-6)
      const scaleY = yLength / Math.max(y1 - y0, 1e-6)
      const offsetX = position[0] - ((x0 + x1) / 2) * scaleX
      const offsetY = position[1] - ((y0 + y1) / 2) * scaleY
      return {
        toShape: identity,
        fromShape: identity,
        scale: 1,
        toLabel: (p: Pt): Pt => [(p[0] - offsetX) / scaleX, (p[1] - offsetY) / scaleY],
        viewBox: { x: [x0, x1] as Pt, y: [y0, y1] as Pt },
        padView: true,
        // One data unit of this viewBox is this many canvas units — the factor
        // that turns a rendered pixel scale into pixels-per-canvas-unit, which
        // is the space label sizes are specified in.
        canvasPerViewBox: scaleX,
      }
    }

    // Prefer the transform the backend already solved and published. Deriving
    // it here a second time is how shapes and labels drifted apart before.
    const published = scene.canvas
    if (published && published.space === 'canvas') {
      const { scale_x: scale, offset_x: offsetX, offset_y: offsetY } = published
      const toShape = (p: Pt): Pt => [p[0] * scale + offsetX, p[1] * scale + offsetY]
      return {
        toShape,
        fromShape: (p: Pt): Pt => [(p[0] - offsetX) / scale, (p[1] - offsetY) / scale],
        scale,
        toLabel: identity,
        viewBox: canvasView(scene, toShape),
        padView: false,
        canvasPerViewBox: 1,
      }
    }

    // Fallback for scenes stored before `canvas` existed: recompute the fit.
    const hasNumberLine = scene.elements.some((element) => element.type === 'number_line')
    const fitPoints: Pt[] = []
    for (const element of scene.elements) {
      if (POINT_KINDS.has(element.type)) fitPoints.push(...((element.points as Pt[]) ?? []))
      else if (CENTER_KINDS.has(element.type)) fitPoints.push(element.center as Pt)
      else if (element.type === 'number_line') {
        const range = element.range as number[]
        const height = ((element.position as number[]) ?? [0, 0])[1]
        fitPoints.push([range[0], height], [range[1], height])
      } else if (element.type === 'text' && hasNumberLine) {
        fitPoints.push(element.position as Pt)
      }
    }

    let scale = 1
    let offsetX = 0
    let offsetY = 0
    if (fitPoints.length) {
      const xs = fitPoints.map((p) => p[0])
      const ys = fitPoints.map((p) => p[1])
      const sourceW = Math.max(Math.max(...xs) - Math.min(...xs), 0.1)
      const sourceH = Math.max(Math.max(...ys) - Math.min(...ys), 0.1)
      const hasFormula = scene.elements.some(
        (element) => element.type === 'text' && FORMULA_PATTERN.test(String(element.label ?? '')),
      )
      const [left, right] = hasFormula ? FIT_TARGET_X_WITH_FORMULA : FIT_TARGET_X
      const [bottom, top] = FIT_TARGET_Y
      scale = Math.min(
        (right - left) / sourceW,
        (top - bottom) / sourceH,
        hasNumberLine ? 12.0 : 1.7,
      )
      offsetX = (left + right) / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * scale
      offsetY = (bottom + top) / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * scale
    }

    const toShape = (p: Pt): Pt => [p[0] * scale + offsetX, p[1] * scale + offsetY]
    return {
      toShape,
      fromShape: (p: Pt): Pt => [(p[0] - offsetX) / scale, (p[1] - offsetY) / scale],
      scale,
      toLabel: identity,
      viewBox: canvasView(scene, toShape),
      padView: false,
      canvasPerViewBox: 1,
    }
  }, [scene])
}

/** Rendered width of an element, tracked so text can be sized from it. */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    setWidth(node.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

export function MafsScene({ scene }: { scene: CoachVisualScene }) {
  const axes = scene.elements.find((element) => element.type === 'axes')
  const transform = useTransform(scene)
  const P = transform.toShape
  const [hostRef, hostWidth] = useMeasuredWidth()

  // Give the view the canvas' own aspect instead of a fixed height. A 16:9
  // scene in a 346x380 box letterboxed away half its area and shrank the
  // drawing for no reason; matching the aspect spends the whole box on it.
  const viewWidth = transform.viewBox.x[1] - transform.viewBox.x[0]
  const viewHeight = transform.viewBox.y[1] - transform.viewBox.y[0]
  const height = hostWidth
    ? Math.min(Math.max(hostWidth * (viewHeight / viewWidth), 150), 420)
    : 380

  // Pixels per CANVAS unit — the space the solver's label extents are in.
  // `preserveAspectRatio="contain"` fits the viewBox into width x height, so
  // the smaller ratio wins; canvasPerViewBox converts out of data space.
  const pxPerCanvasUnit = hostWidth
    ? Math.min(hostWidth / viewWidth, height / viewHeight) / (transform.canvasPerViewBox || 1)
    : 0
  const fontPx = (size: number) =>
    pxPerCanvasUnit ? Math.max(size * UNITS_PER_POINT * pxPerCanvasUnit, 1) : 0
  const labelFont = (element: CoachVisualElement, slot: string) => {
    if (slot.startsWith('labels:')) return VERTEX_FONT
    return LABEL_FONT[element.type] ?? DEFAULT_LABEL_FONT
  }

  // --- drag handles ---------------------------------------------------------
  const declared = (scene.interactive?.handles ?? []).slice(0, MAX_HANDLES)
  const slots = Array.from({ length: MAX_HANDLES }, (_, i) => declared[i])
  const seeds = slots.map((handle) => {
    if (!handle) return [0, 0] as Pt
    const element = scene.elements[handle.element]
    const pts = (element?.points as Pt[] | undefined) ?? [[0, 0]]
    return P(handle.vertex === undefined ? pts[0] : pts[handle.vertex] ?? pts[0])
  })
  // Keep a dragged vertex inside the drawn area. Without this the shape (and
  // the vertex's own label) can be pulled straight out of the frame, which
  // looks like the diagram broke rather than like a limit was reached.
  const bounds = transform.viewBox
  const inset = 0.06
  const constrain = ([x, y]: Pt): Pt => [
    Math.min(Math.max(x, bounds.x[0] + (bounds.x[1] - bounds.x[0]) * inset),
             bounds.x[1] - (bounds.x[1] - bounds.x[0]) * inset),
    Math.min(Math.max(y, bounds.y[0] + (bounds.y[1] - bounds.y[0]) * inset),
             bounds.y[1] - (bounds.y[1] - bounds.y[0]) * inset),
  ]
  const options = { color: COLORS.accent, constrain }

  // Unconditional, fixed-length: hook order must not depend on the scene.
  const movable = [
    useMovablePoint(seeds[0], options),
    useMovablePoint(seeds[1], options),
    useMovablePoint(seeds[2], options),
    useMovablePoint(seeds[3], options),
  ]

  // Dragged positions, back in ELEMENT coordinates so the rest of the
  // component keeps working in the space the scene was authored in.
  const drags: Record<string, Pt> = {}
  slots.forEach((handle, i) => {
    if (!handle) return
    drags[handleKey(handle.element, handle.vertex)] = transform.fromShape(
      movable[i].point as Pt,
    )
  })

  // Pad an axes view a little so a label solved just outside the data range
  // (a vertex label above the topmost point) is not clipped away.
  const pad = transform.padView ? 0.08 : 0
  const view = transform.viewBox
  const xSpan = view.x[1] - view.x[0]
  const ySpan = view.y[1] - view.y[0]
  const viewBox = {
    x: [view.x[0] - xSpan * pad, view.x[1] + xSpan * pad] as Pt,
    y: [view.y[0] - ySpan * pad, view.y[1] + ySpan * pad] as Pt,
  }

  /** Place one solved label. `slot` indexes the element's layout map.
   *
   *  Solved coordinates describe the scene AS PLANNED. When a handle has moved
   *  a vertex they are stale, so the label is re-hung at the same offset from
   *  its (recomputed) anchor — preserving the side the solver chose without
   *  re-running the solver in the browser. */
  const label = (
    element: CoachVisualElement,
    slot: string,
    text: string,
    color: string,
    key: string,
    index?: number,
  ) => {
    const solved = element.layout?.[slot]
    if (!solved || !text) return null
    let canvas = solved as Pt
    if (index !== undefined && Object.keys(drags).length) {
      const original = (element.points as Pt[] | undefined) ?? []
      const current = effectivePoints(element, index, drags)
      const was = anchorFor(element.type, slot, original.map(P))
      const now = anchorFor(element.type, slot, current.map(P))
      if (was && now) canvas = [canvas[0] + (now[0] - was[0]), canvas[1] + (now[1] - was[1])]
    }
    const at: Pt = transform.toLabel(canvas)
    return (
      // No `attach`: Mafs centres on the point, which is what the solver
      // returns — an attach direction would re-offset an already-solved position.
      <Text key={key} x={at[0]} y={at[1]} color={color} size={fontPx(labelFont(element, slot))}>
        {text}
      </Text>
    )
  }

  const drawn: React.ReactNode[] = []
  const labels: React.ReactNode[] = []

  scene.elements.forEach((element, index) => {
    const color = colorOf(element)
    const pts = effectivePoints(element, index, drags)
    const key = `${element.type}-${index}`

    switch (element.type) {
      case 'polygon':
        if (pts.length >= 3) {
          drawn.push(
            <Polygon
              key={key}
              points={pts.map(P)}
              color={color}
              fillOpacity={Number(element.fill_opacity ?? 0.08)}
              strokeStyle="solid"
            />,
          )
          ;(element.labels as string[] | undefined)?.forEach((text, i) =>
            labels.push(label(element, `labels:${i}`, text, COLORS.ink, `${key}-v${i}`, index)),
          )
          // Only substituted when the originals are provably measurements —
          // otherwise the planner's own text is kept verbatim.
          const sides =
            liveSideLabels(element, (element.points as Pt[]) ?? [], pts) ??
            (element.side_labels as string[] | undefined)
          sides?.forEach((text, i) =>
            labels.push(label(element, `side_labels:${i}`, text, COLORS.ink, `${key}-s${i}`, index)),
          )
        }
        break

      case 'polyline':
        if (pts.length >= 2) {
          drawn.push(
            <Plot.Parametric
              key={key}
              xy={(t) => {
                // Piecewise-linear walk of the sampled points; Mafs wants a
                // function of t, and the scene already carries the samples.
                const scaled = Math.max(0, Math.min(pts.length - 1, t * (pts.length - 1)))
                const i = Math.min(pts.length - 2, Math.floor(scaled))
                const f = scaled - i
                return P([
                  pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
                  pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
                ])
              }}
              t={[0, 1]}
              color={color}
              style={element.dashed ? 'dashed' : 'solid'}
            />,
          )
        }
        break

      case 'line':
      case 'arrow':
        if (pts.length >= 2) {
          drawn.push(
            <Line.Segment
              key={key}
              point1={P(pts[0])}
              point2={P(pts[1])}
              color={color}
              style={element.dashed ? 'dashed' : 'solid'}
            />,
          )
        }
        break

      case 'point':
        if (pts.length >= 1) drawn.push(<Point key={key} {...xy(P(pts[0]))} color={color} />)
        break

      case 'circle':
        drawn.push(
          <Circle
            key={key}
            center={P(element.center as Pt)}
            radius={Number(element.radius ?? 1) * transform.scale}
            color={color}
            fillOpacity={0.06}
          />,
        )
        break

      case 'rectangle': {
        const [cx, cy] = element.center as Pt
        const hw = Number(element.width ?? 1) / 2
        const hh = Number(element.height ?? 1) / 2
        drawn.push(
          <Polygon
            key={key}
            points={[
              P([cx - hw, cy - hh]),
              P([cx + hw, cy - hh]),
              P([cx + hw, cy + hh]),
              P([cx - hw, cy + hh]),
            ]}
            color={color}
            fillOpacity={Number(element.fill_opacity ?? 0.08)}
          />,
        )
        break
      }

      // Mafs has no arc/angle primitive — sample them as polylines, which is
      // exactly what the Python renderer does for the same shapes.
      case 'arc':
      case 'angle':
      case 'right_angle': {
        const arc = sampleArcLike(element).map(P)
        drawn.push(...openPath(arc, color, key))
        break
      }

      case 'brace':
        if (pts.length >= 2) {
          // Manim draws a real brace in the element's colour; this drew a grey
          // straight line, so a measurement read as an unrelated rule and the
          // still stopped matching its video twin.
          const [ax, ay] = P(pts[0])
          const [bx, by] = P(pts[1])
          const len = Math.hypot(bx - ax, by - ay) || 1
          // Outward normal, forced to point away from the geometry (down for a
          // horizontal span) exactly as the worker's normal does.
          let nx = (by - ay) / len
          let ny = -(bx - ax) / len
          if (ny > 0) { nx = -nx; ny = -ny }
          const at = (x: number, y: number, d: number): Pt => [x + nx * d, y + ny * d]
          const cx = (ax + bx) / 2
          const cy = (ay + by) / 2
          drawn.push(
            ...openPath(
              [
                at(ax, ay, BRACE_GAP),
                at(ax, ay, BRACE_BAR),
                at(cx, cy, BRACE_BAR),
                at(cx, cy, BRACE_REACH),
                at(cx, cy, BRACE_BAR),
                at(bx, by, BRACE_BAR),
                at(bx, by, BRACE_GAP),
              ],
              color,
              key,
            ),
          )
        }
        break

      case 'number_line': {
        const [start, end] = element.range as number[]
        const { values, labelled, height } = numberLineTicks(element, (a, b) => {
          const [ax, ay] = P(a)
          const [bx, by] = P(b)
          return Math.hypot(bx - ax, by - ay)
        })
        drawn.push(
          <Line.Segment key={key} point1={P([start, height])} point2={P([end, height])} color={color} />,
        )
        values.forEach((value, i) => {
          const [cx, cy] = P([value, height])
          drawn.push(
            <Line.Segment
              key={`${key}-t${i}`}
              point1={[cx, cy - TICK_HALF]}
              point2={[cx, cy + TICK_HALF]}
              color={color}
            />,
          )
        })
        labelled.forEach((i) => {
          const [cx, cy] = P([values[i], height])
          drawn.push(
            <Text key={`${key}-n${i}`} x={cx} y={cy - TICK_DROP} color={COLORS.muted} size={fontPx(TICK_FONT)}>
              {formatTick(values[i])}
            </Text>,
          )
        })
        ;(element.marks as number[] | undefined)?.forEach((mark, i) => (
          drawn.push(<Point key={`${key}-m${i}`} {...xy(P([mark, height]))} color={COLORS.accent} />)
        ))
        break
      }

      case 'axes':
      case 'text':
        break // axes drawn by <Coordinates>, text handled purely as a label

      default:
        break
    }

    if (element.type === 'text') {
      labels.push(label(element, 'position', String(element.label ?? ''), colorOf(element), `${key}-t`, index))
    } else if (element.label && element.type !== 'polygon') {
      labels.push(label(element, 'label', String(element.label), COLORS.ink, `${key}-l`, index))
    }
  })

  return (
    <div className="sp-visual-scene" ref={hostRef}>
    <Mafs
      viewBox={viewBox}
      // "contain" keeps scene units SQUARE. With independent x/y scaling a
      // circle renders as an ellipse and every solved label offset is skewed —
      // the backend canvas is square-unit (Manim's frame is 14.2x8, exactly
      // 16:9), so the client must not stretch it.
      preserveAspectRatio="contain"
      pan={false}
      zoom={false}
      height={height}
    >
      {axes ? (
        <Coordinates.Cartesian
          xAxis={{ lines: Number((axes.x_range as number[])[2] ?? 1) }}
          yAxis={{ lines: Number((axes.y_range as number[])[2] ?? 1) }}
        />
      ) : null}
      {drawn}
      {labels}
      {/* Rendered last so a handle sits above the geometry it moves. Mafs'
          `element` is an SVG node — wrapping it in a <span> silently breaks it. */}
      {slots.map((handle, i) =>
        handle ? <Fragment key={`handle-${i}`}>{movable[i].element}</Fragment> : null,
      )}
    </Mafs>
    </div>
  )
}

/** Draw an OPEN path. Mafs' Polygon always closes its ring, which turns a
 *  right-angle tick into a filled triangle and an angle arc into a wedge. */
function openPath(pts: Pt[], color: string, key: string) {
  const segments = []
  for (let i = 0; i < pts.length - 1; i++) {
    segments.push(
      <Line.Segment key={`${key}-seg${i}`} point1={pts[i]} point2={pts[i + 1]} color={color} />,
    )
  }
  return segments
}

/** Sample an arc, an angle wedge, or a right-angle tick into a point list. */
function sampleArcLike(element: CoachVisualElement): Pt[] {
  if (element.type === 'arc') {
    const [cx, cy] = element.center as Pt
    const radius = Number(element.radius ?? 1)
    const start = Number(element.start_angle ?? 0)
    const sweep = Number(element.angle ?? Math.PI / 2)
    return Array.from({ length: 25 }, (_, i) => {
      const theta = start + (sweep * i) / 24
      return [cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)] as Pt
    })
  }

  const pts = points(element)
  if (pts.length < 3) return []
  const [rayA, vertex, rayB] = pts
  const unit = (p: Pt): Pt => {
    const dx = p[0] - vertex[0]
    const dy = p[1] - vertex[1]
    const length = Math.hypot(dx, dy) || 1
    return [dx / length, dy / length]
  }
  const a = unit(rayA)
  const b = unit(rayB)

  if (element.type === 'right_angle') {
    const size = 0.32
    return [
      [vertex[0] + a[0] * size, vertex[1] + a[1] * size],
      [vertex[0] + (a[0] + b[0]) * size, vertex[1] + (a[1] + b[1]) * size],
      [vertex[0] + b[0] * size, vertex[1] + b[1] * size],
    ]
  }

  const from = Math.atan2(a[1], a[0])
  let to = Math.atan2(b[1], b[0])
  // Always sweep the minor arc, or an obtuse-looking wedge appears.
  while (to - from > Math.PI) to -= 2 * Math.PI
  while (from - to > Math.PI) to += 2 * Math.PI
  const radius = 0.45
  return Array.from({ length: 17 }, (_, i) => {
    const theta = from + ((to - from) * i) / 16
    return [vertex[0] + radius * Math.cos(theta), vertex[1] + radius * Math.sin(theta)] as Pt
  })
}

export default MafsScene
