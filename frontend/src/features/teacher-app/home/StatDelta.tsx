/* How a KPI moved, and what it was measured against.
 *
 * One chip carrying both, because neither half is usable alone: "↑59%" invites
 * "since when?", and a period named on a separate line reads as unrelated
 * furniture. Together they are a sentence — "up 59% vs last week".
 *
 * What the chip deliberately does NOT carry is the old figure. It was there
 * briefly as "מ-24%", and it cost more than it paid: in a Hebrew interface a
 * bare "מ-14.4" reads as a date (14 April), and the number is recoverable
 * anyway — the value is printed directly beside the change it produced.
 *
 * Renders nothing at all when there is no comparison to make. That is the
 * whole design decision here: a missing baseline is not "0%", and a flat line
 * where a number should be reads as "nothing changed" rather than "we cannot
 * say". `periodModel.delta` returns null for every one of those cases.
 *
 * Direction is coloured, but the arrow is what carries the meaning: colour
 * alone would be the only signal for a teacher who cannot distinguish the two.
 * Both metrics that use this are "more is better", so up is always the good
 * direction; a metric where that flips would need its own polarity, not a
 * different colour here.
 */

import { useI18n } from '../../../i18n/I18nProvider'
import { type Delta } from '../shared/periodModel'

const ARROW = { up: '↑', down: '↓', flat: '=' } as const

export function StatDelta({
  delta, label, when,
}: {
  delta: Delta | null
  label: string
  /** The stretch it is measured against, already phrased: "לעומת השבוע שעבר".
   *  Named rather than left implicit, because the same 2% drop against
   *  yesterday and against last month are different pieces of news — which is
   *  the entire point of the period control above. */
  when: string
}) {
  const { t } = useI18n()
  if (!delta) return null

  const magnitude = Math.abs(delta.value)
  /* The full sentence — "מעורבות: ירידה של 5 נקודות אחוז לעומת השבוע שעבר" —
     built once and carried twice: spoken to assistive tech and shown on hover.
     It left the visible chip on purpose: three chips each repeating "לעומת
     השבוע שעבר" was the row's loudest text saying the least, when the period
     control above already names the window. The chip keeps only the news. */
  const sentence = t(`tch.delta.${delta.direction}`, {
    label,
    when,
    amount: delta.unit === 'points'
      ? t('tch.delta.amount.points', { n: magnitude })
      : t('tch.delta.amount.relative', { n: magnitude }),
  })
  return (
    <span
      className={`tch-delta tch-delta--${delta.direction}`}
      aria-label={sentence}
      title={sentence}
    >
      <span aria-hidden="true">{ARROW[delta.direction]}</span>
      <span aria-hidden="true">
        {delta.direction === 'flat' ? t('tch.delta.same') : `${magnitude}%`}
      </span>
    </span>
  )
}
