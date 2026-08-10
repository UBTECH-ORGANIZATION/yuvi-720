/* "Show me around" — the way back into the tour after it has been dismissed.
 *
 * It lives in the app bar rather than on Home because the tour crosses screens:
 * a teacher who gets lost on the roster should be able to restart from where
 * they are, not have to navigate home first.
 */

import { Icon } from '../primitives/Icon'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../providers/AuthProvider'
import { useTour } from './TourProvider'
import { TEACHER_TOUR_ID, canTakeTeacherTour } from './steps/teacherTour'
import './tour.css'

export function TourButton() {
  const { t } = useI18n()
  const { startTour, isActive } = useTour()
  const { user } = useAuth()

  // The admin console shares this chrome, so an admin who does not teach would
  // otherwise be offered a tour that immediately navigates them into an error.
  if (!canTakeTeacherTour(user?.roles)) return null

  return (
    <button
      type="button"
      className="sp-tour__button"
      onClick={() => startTour(TEACHER_TOUR_ID)}
      disabled={isActive}
      title={t('tour.start')}
      aria-label={t('tour.start')}
      data-tour="teacher.tourButton"
    >
      <Icon name="help" size={16} aria-hidden />
    </button>
  )
}
