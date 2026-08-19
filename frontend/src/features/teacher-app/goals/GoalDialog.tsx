/* Setting a goal, with the reason for it on the same screen.
 *
 * The composer used to expand inline under the header: choosing a child, then
 * drafts, then four fields, pushing the board down the page while the teacher
 * filled it in. As a dialog it holds still, and — the actual point — it has room
 * for the left-hand column.
 *
 * ## The left column is context, not a draft
 *
 * A teacher writing a goal is answering "where is this child at?", and the
 * answer was spread over four panels on another screen. `learner_read` assembles
 * it: what is hard, what has got better, how engaged they are, one thing worth
 * doing next — each sentence naming the evidence under it.
 *
 * It is deliberately NOT the goal. The drafts on the right are the goal
 * suggestions, and they already existed; this says why one would be a good idea.
 * Keeping them apart is what stops the panel becoming a machine that writes the
 * goal and a teacher who presses OK.
 *
 * Cached for a day server-side, and the panel says when it was written, because
 * a teacher acting on a reading is entitled to know how old it is.
 */

import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { GoalComposer } from '../student/TeacherGoals'
import { LearnerReadPanel } from './LearnerReadPanel'
import './teacher-goals-page.css'

interface Props {
  open: boolean
  /** Empty until the teacher has chosen who — the picker is inside the dialog. */
  learnerId: string
  candidates: { id: string; name: string }[]
  onPick: (learnerId: string) => void
  onClose: () => void
  onAssigned: () => void
}

export function GoalDialog({
  open, learnerId, candidates, onPick, onClose, onAssigned,
}: Props) {
  const { t, language } = useI18n()

  return (
    <Modal open={open} onClose={onClose} titleId="tch-goal-title"
           className="tch-goalDialog" dismissible={false}>
      <h2 id="tch-goal-title" className="tch-builder__modalTitle" dir="auto">
        {t('tch.goalsPage.create')}
      </h2>

      {/* Opened from a student's own profile there is nobody to pick — the
          child is the context, and a one-option dropdown would only ask the
          teacher to confirm what the page already said. */}
      {candidates.length > 1 || !learnerId ? (
        <label className="tch-builder__field tch-goalDialog__who">
          <span>{t('tch.goalsPage.composeFor')}</span>
          <select className="sp-input" value={learnerId}
                  onChange={(event) => onPick(event.target.value)}>
            <option value="">{t('tch.goalsPage.composePick')}</option>
            {candidates.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
      ) : null}

      {learnerId ? (
        <div className="tch-goalDialog__body">
          {/* Context on the left, the decision on the right. In `en` the grid
              flips with the document, so "left" here means "first". */}
          <LearnerReadPanel key={learnerId} learnerId={learnerId} />
          <div className="tch-goalDialog__compose">
            <GoalComposer
              key={learnerId}
              learnerId={learnerId}
              language={language}
              framed={false}
              onAssigned={onAssigned}
            />
          </div>
        </div>
      ) : (
        <p className="tch-goalsPage__composeHint">{t('tch.goalsPage.composeHint')}</p>
      )}

      <div className="tch-builder__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.subgroups.cancel')}
        </button>
      </div>
    </Modal>
  )
}
