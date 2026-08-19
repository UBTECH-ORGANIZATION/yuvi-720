/* The conversations held with each student, one card each.
 *
 * This replaces the class goals board, and the swap is the point of the whole
 * refactor. The board answered "what goals does each child have", which the
 * student profile already answers better and with more room. The question this
 * screen is actually for is "when did I last sit down with this child, and what
 * came out of it" — and nothing anywhere answered that, even though every goal
 * has been stored inside a conversation from the beginning.
 *
 * ## Cards that say something, and a dialog for the detail
 *
 * The first version was full-width rows that expanded in place. Two problems,
 * both visible the moment a real class loaded: a row 1400px wide holding a name
 * and a date is mostly empty, and expanding one pushed every card below it down
 * the page, so reading Dana's talks moved Ella's card out from under the
 * cursor. Now each card carries its own numbers — how many talks, how many
 * goals still open — and the talks themselves open in a dialog over the grid,
 * which leaves the grid where it was.
 */

import { useMemo, useState } from 'react'
import { navigate } from '../../../app/router'
import { EmptyState, Icon, Panel, StatusPill } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { formatDay } from '../../../i18n/dates'
import {
  deleteMentoringConversation, type GoalConversation, type StudentGoal,
} from '../../../services/teacher'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { StudentAvatar } from '../shared/StudentAvatar'
import { GoalProgressLine } from '../student/TeacherGoals'
import { goalTitle, stateOf, STATE_TONE } from './goalState'

interface Props {
  learners: { learner_id: string; conversations: GoalConversation[] }[]
  nameOf: (learnerId: string) => string
  /** Filters students and goal titles alike — one needle for the whole page. */
  matches: (learnerId: string, title: string) => boolean
  searching: boolean
  /** Who is signed in. A write-up can only be removed by whoever filed it. */
  teacherId: string
  /** Re-read the page after a record is removed. */
  onChanged: () => void
}

interface Row {
  learnerId: string
  conversations: GoalConversation[]
  goals: StudentGoal[]
  openGoals: number
}

export function ConversationHistory({
  learners, nameOf, matches, searching, teacherId, onChanged,
}: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState<string | null>(null)
  /* Which record is being removed, held until the confirm comes back. A talk
     is a record about a child, so this asks first — and the ask names the
     date, because "delete this conversation" is not enough to tell two of them
     apart. */
  const [removing, setRemoving] = useState<GoalConversation | null>(null)
  const [busy, setBusy] = useState(false)

  /** Yours to remove: you wrote it, or nobody recorded who did. */
  const mine = (conversation: GoalConversation) =>
    conversation.author === 'teacher'
    && (!conversation.teacher_id || conversation.teacher_id === teacherId)

  const rows = useMemo<Row[]>(() => learners
    .map((learner) => {
      const conversations = [...learner.conversations]
        .filter((conversation) =>
          matches(learner.learner_id, conversation.notes || '')
          || conversation.goals.some((goal) => matches(learner.learner_id, goal.title)))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      const goals = conversations.flatMap((conversation) => conversation.goals)
      return {
        learnerId: learner.learner_id,
        conversations,
        goals,
        // Still being worked on: neither signed off nor abandoned. The one
        // number on this card that is about the future rather than the past.
        openGoals: goals.filter((goal) => stateOf(goal) === 'active'
                                       || stateOf(goal) === 'help').length,
      }
    })
    // A student nobody has spoken to yet keeps their card: "we have never had
    // this conversation" is the single most useful thing this screen can say.
    // Under a search they drop out, because they match nothing.
    .filter((row) => row.conversations.length > 0 || !searching)
    .sort((a, b) => nameOf(a.learnerId).localeCompare(nameOf(b.learnerId))),
  [learners, matches, nameOf, searching])

  const opened = rows.find((row) => row.learnerId === open) ?? null

  const remove = async () => {
    if (!removing || !open) return
    setBusy(true)
    try {
      await deleteMentoringConversation(open, removing.id)
      setRemoving(null)
      // Nothing left behind it, so the dialog would be an empty box over the
      // grid the teacher is about to go back to anyway.
      if (opened?.conversations.length === 1) setOpen(null)
      onChanged()
    } catch {
      /* Left on screen with the confirm still up: a delete that silently did
         nothing is worse than one that visibly did not happen. */
    } finally {
      setBusy(false)
    }
  }

  if (!rows.length) {
    return (
      <EmptyState
        title={searching ? t('tch.goalsPage.noMatches') : t('tch.mentoring.history.empty')}
        body={searching ? undefined : t('tch.mentoring.history.empty.body')}
      />
    )
  }

  return (
    <>
      <ul className="tch-goalsPage__history">
        {rows.map((row) => {
          const last = row.conversations[0]
          return (
            /* The class stays `__student` — it still means "one student's
               card", and the roster harness counts them by it. */
            <li key={row.learnerId}>
              <Panel className="tch-goalsPage__student">
                <div className="tch-talkCard__who">
                  <StudentAvatar learnerId={row.learnerId}
                                 name={nameOf(row.learnerId)} size={38} />
                  <span>
                    <strong><bdi>{nameOf(row.learnerId)}</bdi></strong>
                    <small>
                      {last ? t('tch.mentoring.history.lastOn',
                                { date: formatDay(last.date) })
                            : t('tch.mentoring.history.never')}
                    </small>
                  </span>
                </div>

                {/* Two numbers, both about this child rather than about the
                    class. A card that only repeats the name is a link with
                    extra padding. */}
                <dl className="tch-talkCard__stats">
                  <div>
                    <dt>{t('tch.mentoring.history.stat.talks')}</dt>
                    <dd>{row.conversations.length}</dd>
                  </div>
                  <div>
                    <dt>{t('tch.mentoring.history.stat.openGoals')}</dt>
                    <dd>{row.openGoals}</dd>
                  </div>
                </dl>

                <div className="tch-talkCard__actions">
                  <button
                    type="button"
                    className="sp-btn sp-btn--sm tch-goalsPage__talkToggle"
                    disabled={!row.conversations.length}
                    onClick={() => setOpen(row.learnerId)}
                  >
                    <Icon name="note" size={14} aria-hidden />
                    {t('tch.mentoring.history.openTalks')}
                  </button>
                  <button
                    type="button"
                    className="tch-goalsPage__more"
                    onClick={() => navigate(`/teacher/student/${row.learnerId}`)}
                  >
                    {t('tch.mentoring.history.profile')}
                  </button>
                </div>
              </Panel>
            </li>
          )
        })}
      </ul>

      {/* Over the grid, not inside it: reading one child's talks must not move
          the next child's card out from under the cursor. */}
      <Modal open={Boolean(opened)} onClose={() => setOpen(null)}
             titleId="tch-talks-title" className="tch-talksDialog">
        {opened ? (
          <>
            <header className="tch-talksDialog__head">
              <StudentAvatar learnerId={opened.learnerId}
                             name={nameOf(opened.learnerId)} size={34} />
              <div>
                <h2 id="tch-talks-title"><bdi>{nameOf(opened.learnerId)}</bdi></h2>
                <p>{t('tch.mentoring.history.count',
                      { count: opened.conversations.length })}</p>
              </div>
            </header>
            <ol className="tch-goalsPage__talks">
              {opened.conversations.map((conversation) => (
                <li key={conversation.id} className="tch-goalsPage__talk">
                  <p className="tch-goalsPage__talkMeta">
                    <span>{formatDay(conversation.date)}</span>
                    <span>{authorOf(conversation, t)}</span>
                    {/* Named, not hidden: a teacher rereading a record should
                        know it carries something the child cannot see, even
                        where the text itself is not shown. */}
                    {conversation.teacher_only_note ? (
                      <span className="tch-goalsPage__private">
                        <Icon name="lock" size={12} aria-hidden />
                        {t('tch.mentoring.history.hasPrivate')}
                      </span>
                    ) : null}
                    {/* Only on your own write-ups. A colleague's record of a
                        talk they were in, and a child's own reflection, are
                        both refused by the server — so neither offers the
                        button that would be refused. */}
                    {mine(conversation) ? (
                      <button type="button" className="tch-goalsPage__remove"
                              onClick={() => setRemoving(conversation)}>
                        <Icon name="trash" size={12} aria-hidden />
                        {t('tch.mentoring.history.remove')}
                      </button>
                    ) : null}
                  </p>
                  {conversation.notes ? (
                    <p className="tch-goalsPage__talkNotes" dir="auto">{conversation.notes}</p>
                  ) : null}
                  {conversation.goals.length ? (
                    <ul className="tch-goalsPage__goals">
                      {conversation.goals.map((goal: StudentGoal) => (
                        <li key={goal.id} className="tch-goalsPage__talkGoal" dir="auto">
                          <span>{goalTitle(goal, t)}</span>
                          <GoalProgressLine goal={goal} />
                          <StatusPill tone={STATE_TONE[stateOf(goal)]}>
                            {t(`tch.goalsPage.state.${stateOf(goal)}`)}
                          </StatusPill>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="tch-goalsPage__none">
                      {t('tch.mentoring.history.talkOnly')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </Modal>

      {/* The date is in the question. Two talks with the same child in one
          week are the normal case, and "delete this conversation" cannot tell
          them apart. */}
      <ConfirmDialog
        open={Boolean(removing)}
        title={t('tch.mentoring.history.remove.title')}
        body={t('tch.mentoring.history.remove.body',
                { date: formatDay(removing?.date) })}
        confirmLabel={t('tch.mentoring.history.remove.confirm')}
        destructive
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      />
    </>
  )
}

/** Who documented it. Legacy records carry neither a name nor an id — they
 *  predate storing the teacher — so the last resort is the honest generic. */
function authorOf(conversation: GoalConversation, t: (key: string) => string): string {
  if (conversation.author === 'learner') return t('tch.mentoring.history.byStudent')
  return conversation.teacher_name?.trim() || t('tch.mentoring.history.byTeacher')
}
