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

import { useEffect, useState } from 'react'
import { Icon, Skeleton } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { getLearnerRead, type LearnerRead } from '../../../services/teacher'
import { GoalComposer } from '../student/TeacherGoals'
import './teacher-goals-page.css'
import { formatDay } from '../../../i18n/dates'

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

function LearnerReadPanel({ learnerId }: { learnerId: string }) {
  const { t, language } = useI18n()
  const [read, setRead] = useState<LearnerRead | null>(null)
  const [busy, setBusy] = useState(false)

  const load = (refresh = false) => {
    setBusy(true)
    getLearnerRead(learnerId, language, refresh)
      .then(setRead)
      .catch(() => setRead({ unavailable: true }))
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    let active = true
    setRead(null)
    getLearnerRead(learnerId, language)
      .then((result) => { if (active) setRead(result) })
      .catch(() => { if (active) setRead({ unavailable: true }) })
    return () => { active = false }
  }, [learnerId, language])

  return (
    <aside className="tch-goalRead">
      <header className="tch-goalRead__head">
        <strong>
          <Icon name="spark" size={14} aria-hidden />
          {t('tch.goalRead.title')}
        </strong>
        {read && !read.unavailable ? (
          <button type="button" className="tch-evidence__toggle"
                  disabled={busy} onClick={() => load(true)}>
            <Icon name="reflect" size={13} aria-hidden />
            {busy ? t('tch.tasks.working') : t('tch.goalRead.refresh')}
          </button>
        ) : null}
      </header>

      {read === null ? (
        <div aria-busy="true" className="tch-goalRead__loading">
          <Skeleton w="100%" h={13} /><Skeleton w="90%" h={13} /><Skeleton w="75%" h={13} />
        </div>
      ) : read.unavailable ? (
        <p className="tch-goalRead__none">{t('tch.goalRead.unavailable')}</p>
      ) : (
        <>
          {read.difficulties?.length ? (
            <section className="tch-goalRead__block">
              <h3>{t('tch.goalRead.difficulties')}</h3>
              <ul>{read.difficulties.map((line, index) => (
                <li key={index} dir="auto">{line}</li>))}</ul>
            </section>
          ) : null}

          {/* An empty list is a real answer and is shown as one. "Nothing has
              improved yet" is information; an absent section reads as a bug. */}
          <section className="tch-goalRead__block">
            <h3>{t('tch.goalRead.improvements')}</h3>
            {read.improvements?.length ? (
              <ul>{read.improvements.map((line, index) => (
                <li key={index} dir="auto">{line}</li>))}</ul>
            ) : (
              <p className="tch-goalRead__none">{t('tch.goalRead.noImprovements')}</p>
            )}
          </section>

          {read.involvement ? (
            <section className="tch-goalRead__block">
              <h3>{t('tch.goalRead.involvement')}</h3>
              <p dir="auto">{read.involvement}</p>
            </section>
          ) : null}

          {read.suggestion ? (
            <p className="tch-goalRead__suggestion" dir="auto">
              <Icon name="target" size={13} aria-hidden />
              {read.suggestion}
            </p>
          ) : null}

          {/* How old this is. A reading a teacher acts on has a date on it. */}
          {read.generated_at ? (
            <p className="tch-goalRead__when">
              {t(read.stale ? 'tch.goalRead.stale' : 'tch.goalRead.asOf', {
                date: formatDay(read.generated_at),
              })}
            </p>
          ) : null}
        </>
      )}
    </aside>
  )
}
