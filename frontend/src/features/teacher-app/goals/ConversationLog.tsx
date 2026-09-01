/* One child's documented talks, oldest story told newest-first.
 *
 * Extracted from the history dialog (#497): the same record now renders in two
 * places — the mentoring page's per-student dialog and the student profile's
 * mentoring section — and two renderings of a conversation record is one of
 * them eventually drifting. Everything the record carries stays: notes, who
 * wrote it, the private-note marker, the goals with their states, and the
 * delete that only the author gets.
 */

import { useState } from 'react'
import { Icon, StatusPill } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { formatDay } from '../../../i18n/dates'
import {
  deleteMentoringConversation, type GoalConversation, type StudentGoal,
} from '../../../services/teacher'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { GoalProgressLine } from '../student/TeacherGoals'
import { goalTitle, stateOf, STATE_TONE } from './goalState'
import './teacher-goals-page.css'

interface Props {
  learnerId: string
  /** Newest first — the caller sorts, this renders. */
  conversations: GoalConversation[]
  /** Who is signed in. A write-up can only be removed by whoever filed it. */
  teacherId: string
  /** Re-read after a record is removed. */
  onChanged: () => void
  /** The profile's density: notes clamp to two lines (tap to unfold) and a
   *  talk's goals become state-toned chips instead of rows — the full rows
   *  live on the live-goals list right above the log there. The dialog view
   *  stays full: it is the one place the whole record is the point. */
  compact?: boolean
}

export function ConversationLog({
  learnerId, conversations, teacherId, onChanged, compact = false,
}: Props) {
  const { t } = useI18n()
  /* Which record is being removed, held until the confirm comes back. A talk
     is a record about a child, so this asks first — and the ask names the
     date, because "delete this conversation" is not enough to tell two of them
     apart. */
  const [removing, setRemoving] = useState<GoalConversation | null>(null)
  const [busy, setBusy] = useState(false)
  /* Which clamped write-ups the teacher unfolded, per record. */
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set())

  /** Yours to remove: you wrote it, or nobody recorded who did. */
  const mine = (conversation: GoalConversation) =>
    conversation.author === 'teacher'
    && (!conversation.teacher_id || conversation.teacher_id === teacherId)

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await deleteMentoringConversation(learnerId, removing.id)
      setRemoving(null)
      onChanged()
    } catch {
      /* Left on screen with the confirm still up: a delete that silently did
         nothing is worse than one that visibly did not happen. */
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ol className="tch-goalsPage__talks">
        {conversations.map((conversation) => (
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
              compact && !unfolded.has(conversation.id) ? (
                /* Two lines of the write-up, the rest one tap away — the log
                   on the profile is a reminder, not the reading copy. */
                <button
                  type="button"
                  className="tch-goalsPage__talkNotes tch-goalsPage__talkNotes--clamped"
                  dir="auto"
                  onClick={() => setUnfolded((current) =>
                    new Set(current).add(conversation.id))}
                >
                  {conversation.notes}
                </button>
              ) : (
                <p className="tch-goalsPage__talkNotes" dir="auto">{conversation.notes}</p>
              )
            ) : null}
            {conversation.goals.length ? (
              compact ? (
                /* The goals as state-toned chips: which and how they ended.
                   Their counted progress lives on the live list above. */
                <ul className="tch-goalsPage__goalChips">
                  {conversation.goals.map((goal: StudentGoal) => (
                    <li key={goal.id}>
                      <StatusPill tone={STATE_TONE[stateOf(goal)]}>
                        {goalTitle(goal, t)}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              ) : (
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
              )
            ) : (
              <p className="tch-goalsPage__none">
                {t('tch.mentoring.history.talkOnly')}
              </p>
            )}
          </li>
        ))}
      </ol>

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
export function authorOf(
  conversation: GoalConversation, t: (key: string) => string,
): string {
  if (conversation.author === 'learner') return t('tch.mentoring.history.byStudent')
  return conversation.teacher_name?.trim() || t('tch.mentoring.history.byTeacher')
}
