/* The conversations held with each student — compact rows, not a card wall.
 *
 * The card grid drew one card per student INCLUDING the thirty nobody had
 * talked to yet: a screen of zeros and "עוד לא תועדה שיחה" where the real
 * record was four cards (#497). Now only students WITH talks get a row —
 * newest talk first, because "who did I sit with recently" is the question —
 * and the students without one collapse into a single expandable line, so the
 * genuinely useful fact ("we have never had this conversation") survives
 * without costing a card each.
 *
 * The talks themselves open in a dialog over the list (`ConversationLog`, the
 * same record the student profile renders), which leaves the list where it
 * was. Everything deeper about one child — approving, the full log, a new
 * write-up — lives on their profile now; every row links there.
 */

import { useMemo, useState } from 'react'
import { navigate } from '../../../app/router'
import { EmptyState, Hint, Icon } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { formatDay } from '../../../i18n/dates'
import { type GoalConversation } from '../../../services/teacher'
import { StudentAvatar } from '../shared/StudentAvatar'
import { ConversationLog } from './ConversationLog'
import { stateOf } from './goalState'

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
  openGoals: number
}

export function ConversationHistory({
  learners, nameOf, matches, searching, teacherId, onChanged,
}: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState<string | null>(null)

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
        // Still being worked on: neither signed off nor abandoned. The one
        // number on this row that is about the future rather than the past.
        openGoals: goals.filter((goal) => stateOf(goal) === 'active'
                                       || stateOf(goal) === 'help').length,
      }
    }), [learners, matches])

  /* Rows with a record, most recent talk first — the list answers "who did I
     sit with, and when". Alphabetical put the child you spoke to this morning
     under S while three untouched terms of A-children led the page. */
  const talked = useMemo(() => rows
    .filter((row) => row.conversations.length > 0)
    .sort((a, b) =>
      (b.conversations[0]?.date || '').localeCompare(a.conversations[0]?.date || '')
      || nameOf(a.learnerId).localeCompare(nameOf(b.learnerId))), [rows, nameOf])

  const opened = talked.find((row) => row.learnerId === open) ?? null

  if (!talked.length) {
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
        {talked.map((row) => {
          const last = row.conversations[0]
          return (
            /* The class stays `__student` — it still means "one student's
               card", and the roster harness counts them by it. */
            <li key={row.learnerId} className="tch-goalsPage__student tch-talkCard">
              {/* The CARD is the door to the talks — a card whose whole
                  purpose is being opened should not hide that behind a small
                  icon. The profile is the one secondary action, at the
                  corner, outside the button (a button inside a button is not
                  a thing a browser honours). */}
              <button
                type="button"
                className="tch-talkCard__pick"
                onClick={() => setOpen(row.learnerId)}
              >
                {/* One line: avatar, name beside it, the date pushed to the far
                    end by the chevron. No dir="auto" on the name — a Latin name
                    would flip its own alignment and drift away from the avatar;
                    the bdi already isolates it. */}
                <span className="tch-talkCard__head">
                  <StudentAvatar learnerId={row.learnerId}
                                 name={nameOf(row.learnerId)} size={30} />
                  <strong className="tch-talkCard__name"><bdi>{nameOf(row.learnerId)}</bdi></strong>
                  {last ? (
                    <span className="tch-talkCard__meta">{formatDay(last.date)}</span>
                  ) : null}
                  <Icon name="chevronLeft" size={15} aria-hidden
                        className="tch-talkCard__go" />
                </span>
                {/* Two quiet chips instead of a dotted sentence — the number
                    leads, its word follows. */}
                <span className="tch-talkCard__stats">
                  <span className="tch-talkCard__stat">
                    <strong>{row.conversations.length}</strong>
                    {t('tch.mentoring.history.stat.talks')}
                  </span>
                  {row.openGoals > 0 ? (
                    <span className="tch-talkCard__stat">
                      <strong>{row.openGoals}</strong>
                      {t('tch.mentoring.history.stat.openGoals')}
                    </span>
                  ) : null}
                </span>
              </button>
              {/* The corner position lives on the Hint WRAPPER — the tooltip
                  anchors to the wrapper, so an absolutely-positioned button
                  inside a flow wrapper would open its bubble somewhere else. */}
              <Hint text={t('tch.mentoring.history.profile')}
                    className="tch-talkCard__corner">
                <button
                  type="button"
                  className="tch-talkCard__profile"
                  aria-label={t('tch.mentoring.history.profile')}
                  onClick={() => navigate(`/teacher/student/${row.learnerId}`)}
                >
                  <Icon name="users" size={14} aria-hidden />
                </button>
              </Hint>
            </li>
          )
        })}
      </ul>

      {/* Over the list, not inside it: reading one child's talks must not move
          the next child's row out from under the cursor. */}
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
            <ConversationLog
              learnerId={opened.learnerId}
              conversations={opened.conversations}
              teacherId={teacherId}
              onChanged={() => {
                // Nothing left behind it, so the dialog would be an empty box
                // over the list the teacher is about to go back to anyway.
                if (opened.conversations.length === 1) setOpen(null)
                onChanged()
              }}
            />
          </>
        ) : null}
      </Modal>
    </>
  )
}
