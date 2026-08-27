/* How the class has been feeling — as a shape, a key, and one overall face.
 *
 * A distribution, never a name and never an alert. That is the daily check-in's
 * own rule — a feeling is a conversation opener, not an alarm — and it is why
 * this renders proportions rather than "3 children are upset". A teacher who
 * sees a hard week here goes and talks to the room; a teacher who sees a red
 * number goes looking for the culprit, and the check-in was built to prevent
 * exactly that.
 *
 * Three parts, in what they answer:
 *   MoodDonut — how the room divides. A ring rather than the stacked bar it
 *               replaces: five thin slices of a 6px stripe were too small to
 *               compare, and a bar reads as a scale from good to bad, which is
 *               the one thing a spread of feelings must not look like.
 *   MoodKey   — which slice is which, as the very face the child tapped to say
 *               it, with how many said it. The face IS the label: nothing to
 *               look up, and it ties what the teacher reads to what the child
 *               actually answered. Faces, not colour alone — the five read
 *               apart in grayscale and for a colour-blind teacher.
 *   overallValence — where the room sits, for the card's own mark.
 */

import { ValenceFace } from '../../checkin/ValenceFaces'
import { useI18n } from '../../../i18n/I18nProvider'
import { VALENCES, type MoodWindow } from '../../../services/teacher'

const SIZE = 48
const STROKE = 10
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/* A hairline of background between slices, so two adjacent families of similar
   weight are countable rather than reading as one long arc. */
const GAP = 2

export function MoodDonut({ mood }: { mood: MoodWindow }) {
  const { t } = useI18n()
  if (!mood.answers) return null

  const present = VALENCES.filter((valence) => (mood.by_valence[valence] ?? 0) > 0)
  const total = present.reduce((sum, valence) => sum + mood.by_valence[valence], 0)
  if (!total) return null

  let cursor = 0
  const arcs = present.map((valence) => {
    const share = mood.by_valence[valence] / total
    const length = CIRCUMFERENCE * share
    const arc = { valence, length: Math.max(length - GAP, 1), offset: cursor }
    cursor += length
    return arc
  })

  return (
    <svg
      className="tch-donut"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role="img"
      /* One sentence rather than five unlabelled arcs. Screen readers get the
         counts in words; the ring is a shape, and a shape read out slice by
         slice is noise. The key below is `aria-hidden` — it repeats this. */
      aria-label={present
        .map((valence) => `${t(`tch.mood.valence.${valence}`)}: ${mood.by_valence[valence]}`)
        .join(', ')}
    >
      {/* Rotated so the first slice starts at twelve o'clock rather than at
          three. Not mirrored for RTL: an SVG coordinate system is not flipped
          by the surrounding direction, and a ring has no reading order to
          mirror — the key underneath is what carries the sequence. */}
      <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} fill="none">
        {arcs.map((arc) => (
          <circle
            key={arc.valence}
            className={`tch-donut__arc tch-donut__arc--${arc.valence}`}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            strokeWidth={STROKE}
            strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
            strokeDashoffset={-arc.offset}
          />
        ))}
      </g>
    </svg>
  )
}

/* The ring's legend — in the card's tooltip, not under it.
 *
 * It lived on a row of its own below the cell first, and five faces with bare
 * counts is a puzzle at a glance: the colours matched the ring but nothing said
 * what any of them MEANT without hovering each one. In the bubble there is room
 * to name every family in words beside its face and its count, which is the
 * whole reading rather than a compressed hint at it — and it buys the card back
 * a line of height it was spending on something a teacher had to decode.
 */
export function MoodKey({ mood }: { mood: MoodWindow }) {
  const { t } = useI18n()
  if (!mood.answers) return null

  return (
    <span className="tch-moodKey">
      {VALENCES.filter((valence) => (mood.by_valence[valence] ?? 0) > 0).map((valence) => (
        <span key={valence} className={`tch-moodKey__item tch-moodKey__item--${valence}`}>
          <ValenceFace valence={valence} size={16} />
          <span className="tch-moodKey__label">{t(`tch.mood.valence.${valence}`)}</span>
          <span className="tch-moodKey__count">{mood.by_valence[valence]}</span>
        </span>
      ))}
    </span>
  )
}

/* Where the room sits overall, as one of the five faces.
 *
 * The MEAN, weighted by how many children gave each answer — not the most
 * common answer. A class that is 30% "okay" and 60% split across the two good
 * families is not an okay class, and the mode would call it one. Ranking the
 * families best-to-hardest and taking the centre of gravity is the reading that
 * matches the number beside it.
 *
 * Returns null below the evidence gate: a face is a strong claim, and one drawn
 * from two answers makes it about children it did not ask.
 */
export function overallValence(mood: MoodWindow | null | undefined) {
  if (!mood?.enough || !mood.answers) return null
  let weighted = 0
  let total = 0
  VALENCES.forEach((valence, rank) => {
    const count = mood.by_valence[valence] ?? 0
    weighted += rank * count
    total += count
  })
  if (!total) return null
  return VALENCES[Math.round(weighted / total)]
}
