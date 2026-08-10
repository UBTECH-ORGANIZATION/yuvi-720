/* Minimal SVG chart kit for the teacher app.
 *
 * Hand-rolled rather than a chart library, for three reasons that matter here:
 *  - Colours are `var(--sp-*)`, so dark mode and theme changes are free. A
 *    canvas library needs JS to read computed CSS vars and re-instantiate.
 *  - RTL mirroring is a `scaleX(-1)` on the plot group; awkward in canvas.
 *  - **No component here accepts more than one series of learners.** The MoE
 *    spec forbids student-to-student comparison, and a kit with no API for it
 *    cannot be misused into violating that.
 *
 * Every chart is `role="img"` with an aria-label composed by the caller.
 */

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
  /** Flip horizontally for RTL reading order. */
  rtl?: boolean
}

export function Sparkline({ points, labels, ariaLabel, height = 44, rtl }: SparklineProps) {
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
      style={rtl ? { transform: 'scaleX(-1)' } : undefined}
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
