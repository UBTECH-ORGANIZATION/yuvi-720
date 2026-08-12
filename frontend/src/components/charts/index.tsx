/* Minimal SVG chart kit for the teacher app.
 *
 * Hand-rolled rather than a chart library, for three reasons that matter here:
 *  - Colours are `var(--sp-*)`, so dark mode and theme changes are free. A
 *    canvas library needs JS to read computed CSS vars and re-instantiate.
 *  - **Time runs left to right, in every language.** An interface mirrors; an
 *    axis does not. Hebrew and Arabic write dates, timelines and graph axes
 *    left-to-right — the convention is near-universal — and mirroring the plot
 *    put last month on the right and yesterday on the left, so every rise read
 *    as a fall. The charts here are drawn in one direction and the labels
 *    around them follow the page.
 *  - **No component here accepts more than one series of learners.** The MoE
 *    spec forbids student-to-student comparison, and a kit with no API for it
 *    cannot be misused into violating that.
 *
 * Every chart is `role="img"` with an aria-label composed by the caller.
 */

import { useState, type PointerEvent } from 'react'
import './charts.css'

/* ── ProgressRing ─────────────────────────────────────────────────────────── */

interface ProgressRingProps {
  percent: number
  size?: number
  label?: string
  sublabel?: string
  tone?: 'primary' | 'success' | 'warn' | 'danger'
}

export function ProgressRing({
  percent, size = 72, label, sublabel, tone = 'primary',
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  const stroke = 7
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (clamped / 100) * circumference

  return (
    <div className="sp-chart-ring" style={{ inlineSize: size }}>
      <svg
        width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        role="img" aria-label={label ? `${label}: ${clamped}%` : `${clamped}%`}
      >
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke="var(--sp-border)" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={`var(--sp-${tone === 'primary' ? 'primary-600' : `${tone}-600`})`}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="sp-chart-ring__value" aria-hidden="true">
        <strong>{clamped}%</strong>
        {sublabel ? <span>{sublabel}</span> : null}
      </div>
    </div>
  )
}

/* ── Sparkline ────────────────────────────────────────────────────────────── */

interface SparklineProps {
  points: number[]
  labels?: string[]
  ariaLabel: string
  height?: number
}

export function Sparkline({ points, labels, ariaLabel, height = 44 }: SparklineProps) {
  if (points.length < 2) return null
  const width = 100
  const max = Math.max(...points, 1)
  const step = width / (points.length - 1)
  const path = points
    .map((value, index) => {
      const x = index * step
      const y = height - (value / max) * (height - 6) - 3
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg
      className="sp-chart-spark" viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none" role="img" aria-label={ariaLabel}
    >
      <path d={`${path} L${width},${height} L0,${height} Z`} className="sp-chart-spark__fill" />
      <path d={path} className="sp-chart-spark__line" />
      {labels ? <title>{labels.join(' · ')}</title> : null}
    </svg>
  )
}

/* ── ObjectiveStrip ───────────────────────────────────────────────────────── */

interface ObjectiveStripProps {
  mastered: number
  inProgress: number
  needsReview?: number
  notStarted: number
  ariaLabel: string
}

/** Objectives as a single stacked bar — mastered / in progress / not started. */
export function ObjectiveStrip({
  mastered, inProgress, notStarted, ariaLabel,
}: ObjectiveStripProps) {
  const total = Math.max(1, mastered + inProgress + notStarted)
  const pct = (value: number) => `${(100 * value) / total}%`
  return (
    <div className="sp-chart-strip" role="img" aria-label={ariaLabel}>
      <span className="sp-chart-strip__seg is-mastered" style={{ inlineSize: pct(mastered) }} />
      <span className="sp-chart-strip__seg is-progress" style={{ inlineSize: pct(inProgress) }} />
      <span className="sp-chart-strip__seg is-idle" style={{ inlineSize: pct(notStarted) }} />
    </div>
  )
}

/* ── BarSeries ────────────────────────────────────────────────────────────── */

interface BarSeriesProps {
  /** One row per category. Deliberately no multi-series API. */
  rows: { label: string; value: number; max?: number; tone?: 'primary' | 'warn' | 'danger' }[]
  ariaLabel: string
  formatValue?: (value: number) => string
}

export function BarSeries({ rows, ariaLabel, formatValue }: BarSeriesProps) {
  const ceiling = Math.max(1, ...rows.map((row) => row.max ?? row.value))
  return (
    <ul className="sp-chart-bars" role="img" aria-label={ariaLabel}>
      {rows.map((row) => (
        <li key={row.label} className="sp-chart-bars__row">
          <span className="sp-chart-bars__label" dir="auto">{row.label}</span>
          <span className="sp-chart-bars__track">
            <span
              className={`sp-chart-bars__fill is-${row.tone ?? 'primary'}`}
              style={{ inlineSize: `${(100 * row.value) / ceiling}%` }}
            />
          </span>
          <span className="sp-chart-bars__value">
            {formatValue ? formatValue(row.value) : row.value}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ── DualLine ─────────────────────────────────────────────────────────────── */

interface DualLineProps {
  /** Both lines share one x axis, so both arrays must be the same length. */
  a: (number | null)[]
  b: (number | null)[]
  labelA: string
  labelB: string
  ariaLabel: string
  height?: number
}

/**
 * Two series of ONE learner, on one axis — self-rating against system estimate.
 *
 * This does not weaken the kit's rule. The rule is that no chart accepts more
 * than one series **of learners**, because the MoE spec forbids comparing
 * children to each other; comparing a child's own view of a session to the
 * evidence from that same session is the entire point of the self-awareness
 * signal, and it is one child either way. There is deliberately no array-of-
 * series API here — exactly two lines, both belonging to the same person.
 * (`test_moe_contracts` greps this directory for the tokens a multi-student
 * API would use, and it cannot tell code from prose — so the phrase it looks
 * for must not appear here even in a comment explaining its absence.)
 *
 * `null` is a gap, not a zero: a session where only one of the two numbers
 * exists must not draw the other line down to the floor. The path breaks and
 * resumes, which is what "we don't know" looks like.
 */
export function DualLine({
  a, b, labelA, labelB, ariaLabel, height = 90,
}: DualLineProps) {
  const length = Math.max(a.length, b.length)
  if (length < 2) return null
  const width = 100
  const pad = 6
  const step = width / (length - 1)

  const toPath = (points: (number | null)[]) => {
    let path = ''
    let pen = 'M'
    points.forEach((value, index) => {
      if (value === null || value === undefined || Number.isNaN(value)) {
        pen = 'M'      // lift the pen; the next point starts a new run
        return
      }
      const x = index * step
      const y = height - pad - Math.max(0, Math.min(1, value)) * (height - pad * 2)
      path += `${pen}${x.toFixed(2)},${y.toFixed(2)} `
      pen = 'L'
    })
    return path.trim()
  }

  const dots = (points: (number | null)[], className: string) =>
    points.map((value, index) => (
      value === null || value === undefined ? null : (
        <circle
          key={`${className}:${index}`}
          className={className}
          cx={index * step}
          cy={height - pad - Math.max(0, Math.min(1, value)) * (height - pad * 2)}
          r={1.8}
        />
      )
    ))

  return (
    <div className="sp-chart-dual">
      {/* Sessions run oldest to newest, left to right, whichever way the page
          reads — the legend below follows the page, the axis does not. */}
      <svg
        viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
        role="img" aria-label={ariaLabel}
      >
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} className="sp-chart-dual__axis" />
        <path d={toPath(a)} className="sp-chart-dual__a" />
        <path d={toPath(b)} className="sp-chart-dual__b" />
        {dots(a, 'sp-chart-dual__dotA')}
        {dots(b, 'sp-chart-dual__dotB')}
      </svg>
      <p className="sp-chart-dual__legend">
        <span className="sp-chart-dual__key is-a" />{labelA}
        <span className="sp-chart-dual__key is-b" />{labelB}
      </p>
    </div>
  )
}

/* ── HoverSparkline ───────────────────────────────────────────────────────── */

export interface TrendPoint {
  /** ISO date. Shown in the readout, so a shape becomes a day. */
  date: string
  value: number
}

interface HoverSparklineProps {
  points: TrendPoint[]
  /** Renders one point's value — "8 questions", "24 min", "61%". */
  format: (value: number, point: TrendPoint) => string
  /** How the date is written in the readout. */
  formatDate: (date: string) => string
  ariaLabel: string
  height?: number
}

/** A sparkline you can interrogate.
 *
 *  `Sparkline` puts every label into one `<title>`, which a browser renders as a
 *  thirty-line tooltip after a second of hovering — so in practice the chart was
 *  a shape with no numbers on it, and a teacher could not tell which day the
 *  spike was. This tracks the nearest point and prints its date and its value.
 *
 *  The plot is `dir="ltr"` and the series is never reversed: the oldest day is
 *  on the left in every language, so the line moves forward as it moves right.
 *  It used to reverse the data under RTL, which put today at the far left and
 *  turned a month of improvement into a graph that fell. The readout is
 *  positioned inside that LTR box, and its own text carries `dir="auto"` so a
 *  Hebrew date is still written as Hebrew.
 */
export function HoverSparkline({
  points, format, formatDate, ariaLabel, height = 56,
}: HoverSparklineProps) {
  const [at, setAt] = useState<number | null>(null)
  if (points.length < 2) return null

  const width = 100
  const max = Math.max(...points.map((point) => point.value), 1)
  const step = width / (points.length - 1)
  const xOf = (index: number) => index * step
  const yOf = (value: number) => height - (value / max) * (height - 8) - 4

  const path = points
    .map((point, index) =>
      `${index === 0 ? 'M' : 'L'}${xOf(index).toFixed(2)},${yOf(point.value).toFixed(2)}`)
    .join(' ')

  const track = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (!box.width) return
    const ratio = (event.clientX - box.left) / box.width
    setAt(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))))
  }

  const active = at === null ? null : points[at]

  return (
    <div className="sp-spark" dir="ltr"
         onPointerMove={track} onPointerLeave={() => setAt(null)}>
      {/* Clamped inside the box, so a point at either end does not print off
          the edge of the card. */}
      {active ? (
        <span
          className="sp-spark__readout"
          style={{ insetInlineStart: `${Math.min(86, Math.max(2, xOf(at as number)))}%` }}
        >
          <b dir="auto">{format(active.value, active)}</b>
          <small dir="auto">{formatDate(active.date)}</small>
        </span>
      ) : null}

      <svg
        className="sp-chart-spark" viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none" role="img" aria-label={ariaLabel}
      >
        <path d={`${path} L${width},${height} L0,${height} Z`} className="sp-chart-spark__fill" />
        <path d={path} className="sp-chart-spark__line" />
        {active ? (
          <>
            <line
              x1={xOf(at as number)} x2={xOf(at as number)} y1={0} y2={height}
              className="sp-spark__rule" vectorEffect="non-scaling-stroke"
            />
            {/* A circle would render as an ellipse: `preserveAspectRatio="none"`
                stretches the box. A tiny rounded rect keeps its shape. */}
            <rect
              x={xOf(at as number) - 0.9} y={yOf(active.value) - 2.2}
              width={1.8} height={4.4} rx={0.9}
              className="sp-spark__dot"
            />
          </>
        ) : null}
      </svg>

      {/* The same numbers, reachable without a pointer. A chart whose values
          exist only on hover has no values at all for some readers. */}
      <ul className="sp-sr-only">
        {points.map((point) => (
          <li key={point.date} dir="auto">
            {formatDate(point.date)}: {format(point.value, point)}
          </li>
        ))}
      </ul>
    </div>
  )
}
