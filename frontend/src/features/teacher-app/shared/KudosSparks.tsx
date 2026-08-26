/* The gift a teacher can attach to a good word (#467).
 *
 * Three fixed amounts rather than a free field, so the values keep a shared
 * meaning across teachers and a child learns what each one means. The set is
 * mirrored from the server (`rewards.TEACHER_SPARK_AMOUNTS`), which is the only
 * place that decides what is payable — this is the button row, not the rule.
 *
 * "No sparks" is a real, first-selected option: most good words should be just
 * words, and a composer that made every message cost something would turn
 * praise into currency.
 */

import { useRef } from 'react'
import { Icon } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { KUDOS_SPARK_AMOUNTS } from '../../../services/teacher'

export function KudosSparks({
  value, onChange, disabled = false,
}: {
  value: number
  onChange: (next: number) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="tch-kudosSparks">
      <span className="tch-kudosSparks__label" id="tch-kudosSparks-label">
        {t('tch.kudos.sparksLabel')}
      </span>
      <div className="tch-kudosSparks__row" role="group" aria-labelledby="tch-kudosSparks-label">
        <button
          type="button"
          className={`tch-kudosSparks__chip${value === 0 ? ' is-on' : ''}`}
          aria-pressed={value === 0}
          disabled={disabled}
          onClick={() => onChange(0)}
        >
          {t('tch.kudos.sparksNone')}
        </button>
        {KUDOS_SPARK_AMOUNTS.map((amount) => (
          <button
            key={amount}
            type="button"
            className={`tch-kudosSparks__chip${value === amount ? ' is-on' : ''}`}
            aria-pressed={value === amount}
            disabled={disabled}
            onClick={() => onChange(amount)}
          >
            <Icon name="spark" size={12} aria-hidden />
            {amount}
          </button>
        ))}
      </div>
      <p className="tch-kudosSparks__hint">{t('tch.kudos.sparksHint')}</p>
    </div>
  )
}

/* A key that is stable for the life of one composer, so a double-clicked send
 * pays once. Deliberately NOT regenerated per attempt: a retry after a failure
 * is the same gesture, and the server keys the grant on this. */
export function useDraftId(): string {
  const ref = useRef<string>('')
  if (!ref.current) {
    ref.current = `kd_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
  }
  return ref.current
}
