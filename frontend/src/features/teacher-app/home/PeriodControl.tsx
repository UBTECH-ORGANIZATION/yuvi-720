/* The stretch of time the dashboard is read over.
 *
 * A segmented control rather than a dropdown: there are exactly four options,
 * they are ordered (short → long), and the whole point is to move between them
 * quickly and see the screen answer. A dropdown would hide three quarters of a
 * four-item scale behind a click and give no sense of where the current choice
 * sits on it.
 *
 * It lives in the dashboard's own header, at the inline END — physically the
 * top-left in Hebrew, opposite the greeting. Deliberately NOT in the scope bar,
 * which is anchored at the leading edge and speaks for the whole portal: this
 * changes one screen, so it belongs on that screen, next to the numbers it
 * governs.
 */

import { useI18n } from '../../../i18n/I18nProvider'
import { PERIODS, type PeriodId } from '../shared/periodModel'

export function PeriodControl({
  value, onChange, disabled = false,
}: {
  value: PeriodId
  onChange: (next: PeriodId) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  return (
    <div
      className="tch-period"
      role="group"
      aria-label={t('tch.period.label')}
      data-tour="teacher.period"
    >
      {PERIODS.map((period) => (
        <button
          key={period.id}
          type="button"
          className={`tch-period__seg${period.id === value ? ' is-on' : ''}`}
          /* `aria-pressed` rather than a radio group: these are four buttons
             that each re-read the screen, and a screen reader should hear
             "pressed", not a form field that needs submitting. */
          aria-pressed={period.id === value}
          disabled={disabled}
          onClick={() => onChange(period.id)}
        >
          {t(`tch.period.${period.id}`)}
        </button>
      ))}
    </div>
  )
}
