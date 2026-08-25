/* The why behind a band (#450): face + name up top, then the reasons written
 * for a teacher — every rule that fired, as a sentence with its evidence
 * (MoE C4: the claim never travels without the data behind it). A door to the
 * full profile closes the loop; the band itself is teacher-facing only.
 */

import { navigate } from '../../../app/router'
import { Icon } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { describeSignal } from '../shared/evidenceText'
import { StudentAvatar } from '../shared/StudentAvatar'
import { BandFace } from './BandFace'
import { isFreshChange, type BandedStudent } from './bandModel'

export function StudentBandDialog({
  student, onClose,
}: {
  student: BandedStudent | null
  onClose: () => void
}) {
  const { t, language } = useI18n()
  if (!student) {
    return <Modal open={false} onClose={onClose} titleId="tch-band-dialog"><span /></Modal>
  }
  const { band } = student
  return (
    <Modal open onClose={onClose} titleId="tch-band-dialog" className="tch-bandDialog">
      <header className="tch-bandDialog__head">
        <BandFace band={band.band} size={44} />
        <div className="tch-bandDialog__who">
          <h2 id="tch-band-dialog" dir="auto">
            <StudentAvatar learnerId={student.learner_id} name={student.display_name} size={26} />
            {student.display_name || student.learner_id}
          </h2>
          <p className={`tch-bandDialog__state is-${band.band}`}>
            {t(`tch.band.${band.band}`)}
            {isFreshChange(band) && band.previous ? (
              <span className="tch-bandDialog__moved" dir="auto">
                {' · '}
                {t('tch.band.movedFrom', { from: t(`tch.band.${band.previous}`) })}
              </span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          className="sp-btn sp-btn--ghost sp-btn--sm tch-bandDialog__close"
          onClick={onClose}
          aria-label={t('tch.band.dialogClose')}
        >
          <Icon name="close" size={16} aria-hidden />
        </button>
      </header>

      <ul className="tch-bandDialog__reasons">
        {band.reasons.map((reason, index) => {
          const sentences = describeSignal(
            reason.signal, undefined, reason.evidence, t, language)
          return (
            <li key={`${reason.signal}:${index}`} dir="auto">
              {sentences.length ? sentences.join(' ') : t(`tch.why.${reason.signal}`)}
            </li>
          )
        })}
      </ul>

      <footer className="tch-bandDialog__actions">
        <button
          type="button"
          className="sp-btn"
          onClick={() => {
            onClose()
            navigate(`/teacher/student/${encodeURIComponent(student.learner_id)}`)
          }}
        >
          {t('tch.band.openProfile')}
        </button>
      </footer>
    </Modal>
  )
}
