/* Step three: read it back, then write it once.
 *
 * The only step that shows the whole record at once — the write-up the child
 * will read, the note they will not, and every goal. A teacher is about to
 * file something about a student under their own name; the last thing they see
 * should be the thing itself, not a summary of it.
 *
 * ## Who may read this, said by the card rather than under it
 *
 * Each block used to carry a grey line beneath it explaining its own audience,
 * which meant the two facts a teacher checks here — is this right, and who
 * will see it — were at opposite ends of a paragraph. The audience is now the
 * card's header: a tinted glyph, the heading, and the sentence, in that order,
 * before the text it governs.
 *
 * ## Goals as rows of facts, not as sentences about facts
 *
 * A goal here is four things — what, how, by when, and whether the platform
 * will count it. They were a title, a paragraph, and a line of comma-separated
 * prose ending in a raw `2026-08-26`. Now the two machine-readable ones are
 * chips with their own glyph, so "by when" and "what gets counted" are
 * findable without reading, and the date is written the way the rest of the
 * app writes dates.
 */

import type { ReactNode } from 'react'
import { Icon } from '../../../../components/primitives'
import { useI18n } from '../../../../i18n/I18nProvider'
import { formatDay } from '../../../../i18n/dates'
import type { MentoringGoalDraft } from '../../../../services/teacher'

interface Props {
  notes: string
  teacherOnlyNote: string
  goals: MentoringGoalDraft[]
  studentName: string
}

export function ReviewStep({ notes, teacherOnlyNote, goals, studentName }: Props) {
  const { t } = useI18n()
  const named = goals.filter((goal) => goal.title.trim() || goal.next_steps.trim())

  return (
    <div className="tch-step tch-review">
      <ReviewCard tone="shared" icon="message"
                  title={t('tch.mentoring.review.notes', { name: studentName })}
                  hint={t('tch.mentoring.review.sharedHint')}>
        <p className="tch-review__notes" dir="auto">
          {notes.trim() || t('tch.mentoring.review.noNotes')}
        </p>
      </ReviewCard>

      {teacherOnlyNote.trim() ? (
        <ReviewCard tone="private" icon="lock"
                    title={t('tch.mentoring.teacherOnly.label')}
                    hint={t('tch.mentoring.review.privateHint')}>
          <p className="tch-review__notes" dir="auto">{teacherOnlyNote}</p>
        </ReviewCard>
      ) : null}

      <ReviewCard tone="aim" icon="target"
                  title={t('tch.mentoring.review.goals', { count: named.length })}>
        {named.length === 0 ? (
          <p className="tch-review__none" dir="auto">{t('tch.mentoring.review.noGoals')}</p>
        ) : (
          <ol className="tch-review__goals">
            {named.map((goal, index) => (
              <li key={index} className="tch-reviewGoal">
                <span className="tch-reviewGoal__no" aria-hidden>{index + 1}</span>
                <div className="tch-reviewGoal__body">
                  <strong dir="auto">{goal.title || goal.next_steps}</strong>
                  {goal.next_steps && goal.title ? (
                    <p dir="auto">{goal.next_steps}</p>
                  ) : null}
                  <p className="tch-reviewGoal__chips">
                    <span className="tch-reviewGoal__chip">
                      <Icon name="calendar" size={12} aria-hidden />
                      {formatDay(goal.deadline) || goal.deadline}
                    </span>
                    {/* What the platform will and will not count. A goal with
                        no action is not a worse goal — it is one nobody
                        promised to measure, and the teacher should leave this
                        step knowing which of the two they just made. */}
                    {goal.action ? (
                      <span className="tch-reviewGoal__chip tch-reviewGoal__chip--aim">
                        <Icon name="target" size={12} aria-hidden />
                        {t(`tch.goals.action.${goal.action.kind}`)}
                        {' · '}
                        {t('tch.goals.action.perWeek', { target: goal.action.target })}
                      </span>
                    ) : (
                      <span className="tch-reviewGoal__chip tch-reviewGoal__chip--off">
                        <Icon name="note" size={12} aria-hidden />
                        {t('tch.mentoring.review.untracked')}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </ReviewCard>
    </div>
  )
}

/** One block of the record: who may read it, then what it says. */
function ReviewCard({ tone, icon, title, hint, children }: {
  tone: 'shared' | 'private' | 'aim'
  icon: string
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="tch-reviewCard" data-tone={tone}>
      <header className="tch-reviewCard__head">
        <span className="tch-reviewCard__glyph" aria-hidden>
          <Icon name={icon} size={15} />
        </span>
        <span>
          <strong>{title}</strong>
          {hint ? <small>{hint}</small> : null}
        </span>
      </header>
      {children}
    </section>
  )
}
