/* How a KPI moved against the period before it, and what it moved from.
 *
 * Two pieces, deliberately not one. The chip sits beside the value and carries
 * the movement; the baseline sits under the hint and carries what the movement
 * was measured against. They were briefly one chip, and it failed twice over:
 * "מ-14.4" beside a number reads as a date in a Hebrew interface (14 April),
 * and a baseline packed into a coloured pill competes with the figure it is
 * supposed to be context for.
 *
 * Both render NOTHING when there is no comparison to make. That is the whole
 * design decision here: a missing baseline is not "0%", and a flat line where
 * a number should be reads as "nothing changed" rather than "we cannot say".
 * `periodModel.delta` returns null for every one of those cases.
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
  delta, label, formatValue = (value: number) => String(value),
}: {
  delta: Delta | null
  label: string
  /** Renders the old figure the way its KPI renders the current one — a
   *  percentage keeps its %, minutes carry their unit. A bare "14.4" in a
   *  Hebrew interface reads as 14 April. */
  formatValue?: (value: number) => string
}) {
  const { t } = useI18n()
  if (!delta) return null

  const magnitude = Math.abs(delta.value)
  return (
    <span
      className={`tch-delta tch-delta--${delta.direction}`}
      /* One reading for assistive tech instead of three fragments — and the
         one place the two units are still told apart. On screen both print a
         %, because a teacher reading "83%" above "24%" wants the gap between
         them; spoken aloud, "59 percentage points" is the precise claim and
         costs nothing to say in full. */
      aria-label={t(`tch.delta.${delta.direction}`, {
        label,
        amount: delta.unit === 'points'
          ? t('tch.delta.amount.points', { n: magnitude })
          : t('tch.delta.amount.relative', { n: magnitude }),
      })}
    >
      <span aria-hidden="true">{ARROW[delta.direction]}</span>
      <span aria-hidden="true">
        {delta.direction === 'flat' ? t('tch.delta.same') : `${magnitude}%`}
      </span>
      {/* Where the arrow came from. "↑59%" alone invites "from what?", and the
          answer is the other half of the sentence a teacher is forming.

          Not on a flat reading: nothing moved, so the baseline is the figure
          already printed beside it, and "ללא שינוי מ-2%" prints 2% twice. */}
      {delta.direction !== 'flat' && (
        <span className="tch-delta__from" aria-hidden="true">
          {t('tch.delta.from', { previous: formatValue(delta.previous) })}
        </span>
      )}
    </span>
  )
}

/* WHICH stretch of time the chip's baseline came from.
 *
 * The value itself lives in the chip, beside the change it produced; this line
 * carries only the period, so the same number is never printed twice on one
 * small card. Together they read as one sentence: "↑59% from 24%" · "vs last
 * week".
 *
 * It exists because a comparison with an unnamed baseline is not checkable. A
 * teacher looking at "↓2% from 14.4" cannot tell whether that is against
 * yesterday or against last month, and the answer changes what they do about
 * it — the whole point of the period control above.
 */
export function StatBaseline({ delta, when }: { delta: Delta | null; when: string }) {
  const { t } = useI18n()
  if (!delta) return null
  return <span className="tch-stat__was">{t('tch.stat.comparedTo', { when })}</span>
}
