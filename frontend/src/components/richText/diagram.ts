/* The declarative diagram payload, and the geometry it becomes.
 *
 * A model never authors markup here. It emits a small JSON object inside a
 * ```yuvi-diagram fence; this module validates it and computes every
 * coordinate, so the renderer only has to draw. That mirrors the rule the
 * visual pipeline already lives by — the model describes, we render — and it
 * is why nothing model-written is ever injected or executed.
 *
 * Anything that fails validation returns `null` and draws nothing. A broken
 * picture is worse than no picture: the sentences around it still stand.
 *
 * JSX-free on purpose, so `node --test` can check the validator and the layout
 * without a DOM. A diagram that silently mis-lays out is not a bug a test of a
 * component wrapper would ever catch.
 */

/** The fence language. `flow` and `cycle` cover process and relationship
 *  questions, which is nearly all of them; more kinds are cheap to add. */
export const DIAGRAM_LANGUAGE = 'yuvi-diagram'

export type DiagramKind = 'flow' | 'cycle'

export interface DiagramNode { id: string; label: string }
export interface DiagramEdge { from: string; to: string; label: string | null }

export interface DiagramSpec {
  kind: DiagramKind
  title: string | null
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

const MAX_NODES = 8
const MIN_NODES = 2
const MAX_EDGES = 16
const MAX_LABEL = 64
const MAX_EDGE_LABEL = 28
const MAX_ID = 40

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > limit ? '' : collapsed
}

/** Kahn's algorithm, returning the depth of each node — or `null` if the graph
 *  has a cycle, which a `flow` is by definition not. */
function levelsOf(nodes: DiagramNode[], edges: DiagramEdge[]): Map<string, number> | null {
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>(nodes.map((node) => [node.id, []]))
  for (const edge of edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
    outgoing.get(edge.from)!.push(edge.to)
  }

  const level = new Map(nodes.map((node) => [node.id, 0]))
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id)
  let visited = 0
  while (queue.length) {
    const id = queue.shift()!
    visited += 1
    for (const next of outgoing.get(id)!) {
      level.set(next, Math.max(level.get(next)!, level.get(id)! + 1))
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }
  return visited === nodes.length ? level : null
}

/** Validate one payload. Strict by design: every rejection path renders nothing.
 *
 * Forgiving in exactly two safe places — a bare string node, and a missing id —
 * because those are the two things models get wrong without meaning anything
 * different by it. */
export function parseDiagramSpec(raw: string): DiagramSpec | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const source = data as Record<string, unknown>

  const kind = source.kind
  if (kind !== 'flow' && kind !== 'cycle') return null

  const rawNodes = source.nodes
  if (!Array.isArray(rawNodes) || rawNodes.length < MIN_NODES || rawNodes.length > MAX_NODES) {
    return null
  }
  const nodes: DiagramNode[] = []
  const ids = new Set<string>()
  for (const [index, entry] of rawNodes.entries()) {
    const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
    const label = cleanText(record ? record.label : entry, MAX_LABEL)
    if (!label) return null
    const id = cleanText(record?.id, MAX_ID) || `n${index + 1}`
    if (ids.has(id)) return null
    ids.add(id)
    nodes.push({ id, label })
  }

  const rawEdges = source.edges
  if (rawEdges !== undefined && !Array.isArray(rawEdges)) return null
  const listed: DiagramEdge[] = []
  for (const entry of (rawEdges as unknown[] | undefined) ?? []) {
    if (!entry || typeof entry !== 'object') return null
    const record = entry as Record<string, unknown>
    const from = cleanText(record.from, MAX_ID)
    const to = cleanText(record.to, MAX_ID)
    if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) return null
    listed.push({ from, to, label: cleanText(record.label, MAX_EDGE_LABEL) || null })
  }
  if (listed.length > MAX_EDGES) return null

  const title = cleanText(source.title, MAX_LABEL) || null

  if (kind === 'cycle') {
    // A ring is defined by the node order; listed edges only contribute labels.
    // Asking a model to close a loop correctly buys nothing but failures.
    const labels = new Map(listed.map((edge) => [`${edge.from}\u0000${edge.to}`, edge.label]))
    const ring = nodes.map((node, index) => {
      const next = nodes[(index + 1) % nodes.length]
      return { from: node.id, to: next.id, label: labels.get(`${node.id}\u0000${next.id}`) ?? null }
    })
    return { kind, title, nodes, edges: ring }
  }

  if (!listed.length) return null
  const touched = new Set<string>()
  for (const edge of listed) {
    touched.add(edge.from)
    touched.add(edge.to)
  }
  // A node nothing points at and that points at nothing is a node the model
  // forgot to connect — the drawing would be a lie about the process.
  if (touched.size !== nodes.length) return null
  if (!levelsOf(nodes, listed)) return null
  return { kind, title, nodes, edges: listed }
}

/* ── layout ────────────────────────────────────────────────────────────────
 *
 * Box sizes are estimated from character counts rather than measured in the
 * DOM. That keeps layout a pure function — testable, identical on the server
 * and in a browser, and free of the two-pass flicker a `getBBox` pass costs.
 * The estimate is generous, and every label is centred, so a few pixels of
 * error never shows.
 */

/* Calibrated to `--sp-fs-chat-meta` (14px), the floor both chat panels use for
 * text inside a diagram. `MAX_LINE_CHARS` is deliberately lower than the width
 * alone would allow: it trades a wider box for a taller one, so raising the
 * type did not make a diagram scroll sideways in a phone-width bubble. */
const CHAR_WIDTH = 7.95
const LINE_HEIGHT = 19
const PAD_X = 14
const PAD_Y = 10
const MAX_LINE_CHARS = 16
const MIN_BOX_WIDTH = 85
const LEVEL_GAP = 52
const COLUMN_GAP = 22
const CANVAS_PAD = 12
const TITLE_HEIGHT = 27
const ARROW_HEAD = 8

const RTL_SCRIPT = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F]/

export function isRtlText(text: string): boolean {
  return RTL_SCRIPT.test(text)
}

export interface LayoutNode {
  id: string
  x: number
  y: number
  w: number
  h: number
  lines: string[]
  rtl: boolean
}

export interface LayoutLabel {
  x: number
  y: number
  w: number
  h: number
  text: string
  rtl: boolean
}

export interface LayoutEdge {
  from: string
  to: string
  /** `d` of the connector line. */
  d: string
  /** `points` of the arrowhead polygon. */
  head: string
  label: LayoutLabel | null
}

export interface DiagramLayout {
  width: number
  height: number
  title: string | null
  titleRtl: boolean
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  /** A one-line reading of the diagram, for `aria-label`. */
  description: string
}

function wrapLabel(label: string): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of label.split(' ')) {
    let remaining = word
    while (remaining.length > MAX_LINE_CHARS) {
      if (current) { lines.push(current); current = '' }
      lines.push(remaining.slice(0, MAX_LINE_CHARS))
      remaining = remaining.slice(MAX_LINE_CHARS)
    }
    if (!current) current = remaining
    else if (current.length + 1 + remaining.length <= MAX_LINE_CHARS) current += ` ${remaining}`
    else { lines.push(current); current = remaining }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function boxOf(label: string) {
  const lines = wrapLabel(label)
  const widest = lines.reduce((longest, line) => Math.max(longest, line.length), 0)
  return {
    lines,
    w: Math.max(MIN_BOX_WIDTH, Math.round(widest * CHAR_WIDTH + PAD_X * 2)),
    h: lines.length * LINE_HEIGHT + PAD_Y * 2,
  }
}

const round = (value: number) => Math.round(value * 10) / 10

/** Where a line from a box's centre toward `(tx, ty)` leaves the box. */
function borderPoint(node: LayoutNode, tx: number, ty: number) {
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const scale = Math.min(
    dx ? node.w / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY,
    dy ? node.h / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY
  )
  return { x: cx + dx * scale, y: cy + dy * scale }
}

function arrowHead(x: number, y: number, angle: number): string {
  const left = angle + Math.PI * 0.83
  const right = angle - Math.PI * 0.83
  return [
    `${round(x)},${round(y)}`,
    `${round(x + ARROW_HEAD * Math.cos(left))},${round(y + ARROW_HEAD * Math.sin(left))}`,
    `${round(x + ARROW_HEAD * Math.cos(right))},${round(y + ARROW_HEAD * Math.sin(right))}`,
  ].join(' ')
}

function connect(from: LayoutNode, to: LayoutNode, label: string | null): LayoutEdge {
  const fromCentre = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  const toCentre = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
  const start = borderPoint(from, toCentre.x, toCentre.y)
  const end = borderPoint(to, fromCentre.x, fromCentre.y)
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  return {
    from: from.id,
    to: to.id,
    d: `M ${round(start.x)} ${round(start.y)} L ${round(end.x)} ${round(end.y)}`,
    head: arrowHead(end.x, end.y, angle),
    label: label
      ? {
          x: round((start.x + end.x) / 2),
          y: round((start.y + end.y) / 2),
          w: Math.round(label.length * CHAR_WIDTH + 12),
          h: 21,
          text: label,
          rtl: isRtlText(label),
        }
      : null,
  }
}

function layoutFlow(spec: DiagramSpec, rtl: boolean, top: number): { nodes: LayoutNode[]; width: number; height: number } {
  const levels = levelsOf(spec.nodes, spec.edges)!
  const rows: DiagramNode[][] = []
  for (const node of spec.nodes) {
    const depth = levels.get(node.id) ?? 0
    ;(rows[depth] ||= []).push(node)
  }

  const boxes = new Map(spec.nodes.map((node) => [node.id, boxOf(node.label)]))
  const rowWidths = rows.map((row) =>
    row.reduce((total, node) => total + boxes.get(node.id)!.w, 0) + COLUMN_GAP * (row.length - 1)
  )
  const widest = Math.max(...rowWidths)
  const width = widest + CANVAS_PAD * 2

  const nodes: LayoutNode[] = []
  let y = top
  rows.forEach((row, index) => {
    const ordered = rtl ? [...row].reverse() : row
    const rowHeight = Math.max(...row.map((node) => boxes.get(node.id)!.h))
    let x = CANVAS_PAD + (widest - rowWidths[index]) / 2
    for (const node of ordered) {
      const box = boxes.get(node.id)!
      nodes.push({
        id: node.id,
        x: round(x),
        y: round(y + (rowHeight - box.h) / 2),
        w: box.w,
        h: box.h,
        lines: box.lines,
        rtl: isRtlText(node.label),
      })
      x += box.w + COLUMN_GAP
    }
    y += rowHeight + LEVEL_GAP
  })

  return { nodes, width, height: y - LEVEL_GAP + CANVAS_PAD }
}

function layoutCycle(spec: DiagramSpec, rtl: boolean, top: number): { nodes: LayoutNode[]; width: number; height: number } {
  const boxes = spec.nodes.map((node) => ({ node, ...boxOf(node.label) }))
  const count = boxes.length
  const circumference = boxes.reduce((total, box) => total + box.w + COLUMN_GAP, 0)
  const tallest = Math.max(...boxes.map((box) => box.h))
  const radius = Math.max(94, circumference / (2 * Math.PI), (tallest + 26) * count / (2 * Math.PI))

  // A Hebrew or Arabic reader traces a cycle the way they read: anticlockwise.
  const spin = rtl ? -1 : 1
  const placed = boxes.map((box, index) => {
    const angle = -Math.PI / 2 + spin * ((index * 2 * Math.PI) / count)
    return { box, cx: radius * Math.cos(angle), cy: radius * Math.sin(angle) }
  })

  const minX = Math.min(...placed.map((p) => p.cx - p.box.w / 2))
  const maxX = Math.max(...placed.map((p) => p.cx + p.box.w / 2))
  const minY = Math.min(...placed.map((p) => p.cy - p.box.h / 2))
  const maxY = Math.max(...placed.map((p) => p.cy + p.box.h / 2))

  const nodes = placed.map(({ box, cx, cy }) => ({
    id: box.node.id,
    x: round(cx - box.w / 2 - minX + CANVAS_PAD),
    y: round(cy - box.h / 2 - minY + top),
    w: box.w,
    h: box.h,
    lines: box.lines,
    rtl: isRtlText(box.node.label),
  }))

  return {
    nodes,
    width: maxX - minX + CANVAS_PAD * 2,
    height: maxY - minY + top + CANVAS_PAD,
  }
}

/** Turn a validated spec into coordinates. Pure — same input, same picture. */
export function layoutDiagram(spec: DiagramSpec, rtl: boolean): DiagramLayout {
  const top = CANVAS_PAD + (spec.title ? TITLE_HEIGHT : 0)
  const placed = spec.kind === 'cycle'
    ? layoutCycle(spec, rtl, top)
    : layoutFlow(spec, rtl, top)

  const byId = new Map(placed.nodes.map((node) => [node.id, node]))
  const edges = spec.edges
    .map((edge) => {
      const from = byId.get(edge.from)
      const to = byId.get(edge.to)
      return from && to ? connect(from, to, edge.label) : null
    })
    .filter((edge): edge is LayoutEdge => edge !== null)

  const sequence = spec.nodes.map((node) => node.label).join(' → ')
  return {
    width: Math.round(placed.width),
    height: Math.round(placed.height),
    title: spec.title,
    titleRtl: spec.title ? isRtlText(spec.title) : false,
    nodes: placed.nodes,
    edges,
    description: spec.title ? `${spec.title}: ${sequence}` : sequence,
  }
}
