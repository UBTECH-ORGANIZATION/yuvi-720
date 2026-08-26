/* How a KPI moved against the period before it.
 *
 * Renders nothing at all when there is no comparison to make. That is the
 * whole design decision here: a missing baseline is not "0%", and a flat line
 * where a number should be reads as "nothing changed" rather than "we cannot
 * say". `periodModel.delta` returns null for every one of those cases — the
 * previous window had no data, the metric has no trustworthy evidence, a rise
 * off exactly zero has no finite percentage — and this component honours it by
 * staying silent.
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

export function StatDelta({ delta, label }: { delta: Delta | null; label: string }) {
  const { t } = useI18n()
  if (!delta) return null
  const magnitude = Math.abs(delta.pct)
  return (
    <span
      className={`tch-delta tch-delta--${delta.direction}`}
      /* One reading for assistive tech instead of three fragments ("up", "12",
         "%"): what moved, which way, by how much. */
      aria-label={t(`tch.delta.${delta.direction}`, { pct: magnitude, label })}
    >
      <span aria-hidden="true">{ARROW[delta.direction]}</span>
      <span aria-hidden="true">
        {delta.direction === 'flat' ? t('tch.delta.same') : `${magnitude}%`}
      </span>
    </span>
  )
}
