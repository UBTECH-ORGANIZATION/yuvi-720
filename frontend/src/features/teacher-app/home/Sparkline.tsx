/* The shape of the period, under the number that summarises it.
 *
 * `per_day_active` has been computed on every dashboard load since the
 * engagement endpoint existed and rendered nowhere — a daily series, already
 * paid for, thrown away. It is here because it is the one piece of real data
 * that answers "the screen feels flat" (ADO #501) without being decoration:
 * 83% and 83% are the same number whether the class worked every day or
 * everyone appeared on Sunday, and only the shape tells those apart.
 *
 * Deliberately unlabelled and unaxised. It is a texture beside a figure, not a
 * chart — a teacher who wants the numbers has the hint line under it, and
 * axes on a strip this size would be furniture rather than information.
 */

/* Sized to sit beside the mood ring at the far end of a KPI cell, not under
   the hint where it started — a 18px strip on a row of its own read as a
   stray mark rather than as the figure's shape. */
const WIDTH = 72
const HEIGHT = 40

export function Sparkline({ points, label }: { points: number[]; label: string }) {
  /* Two points is a line segment, not a trend. Below that there is no shape
     to show and an empty box would read as a rendering failure. */
  if (points.length < 3) return null

  const peak = Math.max(...points, 1)
  const step = WIDTH / (points.length - 1)
  const y = (value: number) => HEIGHT - 1 - (value / peak) * (HEIGHT - 2)
  const line = points.map((value, index) => `${index * step},${y(value)}`).join(' ')
  /* Closed back along the baseline so the area under it can be tinted — the
     fill is what makes a 64px strip legible at a glance; the stroke alone
     reads as a scratch. */
  const area = `0,${HEIGHT} ${line} ${WIDTH},${HEIGHT}`

  return (
    <svg
      className="tch-spark"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={label}
      /* No `dir` needed: an SVG coordinate system is not mirrored by the
         surrounding direction, so the oldest day stays on the left in Hebrew
         as it is in English — which is what we want, like the book's date
         ranges. Worth stating, because the instinct here is to mirror it. */
      preserveAspectRatio="none"
    >
      <polygon className="tch-spark__area" points={area} />
      <polyline className="tch-spark__line" points={line} />
    </svg>
  )
}
