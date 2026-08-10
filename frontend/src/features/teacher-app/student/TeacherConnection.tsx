/* The connection tab — the teacher's side of the record the student already sees.
 *
 * The student's connections pane renders their mentoring conversations as a
 * chat-shaped history; the teacher had no counterpart, so "where do I talk to
 * this student?" had no answer. This is that answer, honestly framed: the
 * structured lanes (kudos through Yuvi, goals, documented conversations) —
 * deliberately NOT a free-form chat with a minor, which the product excludes
 * by design (A10: no unmoderated 1:1 channel).
 */

import { useEffect, useState } from 'react'
import {
  EmptyState, Icon, Panel, SectionHeader, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import {
  getStudentGoals, sendKudos, type GoalConversation,
} from '../../../services/teacher'

export function TeacherConnection({ learnerId }: { learnerId: string }) {
  const { t, language } = useI18n()
  const [conversations, setConversations] = useState<GoalConversation[] | null>(null)
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    let active = true
    setConversations(null)
    getStudentGoals(learnerId)
      .then((response) => { if (active) setConversations(response.conversations) })
      .catch(() => { if (active) setConversations([]) })
    return () => { active = false }
  }, [learnerId])

  async function praise() {
    const message = draft.trim()
    if (!message || isBusy) return
    setIsBusy(true)
    try {
      await sendKudos(learnerId, message, language)
      setDraft('')
      setSent(true)
    } catch {
      /* the composer stays filled; nothing was delivered */
    } finally {
      setIsBusy(false)
    }
  }

  if (conversations === null) {
    return <div aria-busy="true"><SkeletonCard rows={3} /></div>
  }

  return (
    <div className="tch-connection">
      {/* ── a word through Yuvi — the one direct line to the child ────────── */}
      <Panel className="tch-connection__kudos">
        <SectionHeader
          title={t('tch.connection.kudos.title')}
          subtitle={t('tch.connection.kudos.subtitle')}
        />
        {sent ? (
          <p className="tch-connection__sent">
            <Icon name="check" size={15} aria-hidden />
            {t('tch.connection.kudos.sent')}
          </p>
        ) : null}
        <form
          className="tch-connection__composer"
          onSubmit={(event) => { event.preventDefault(); void praise() }}
        >
          <input
            value={draft}
            dir="auto"
            placeholder={t('tch.connection.kudos.placeholder')}
            aria-label={t('tch.connection.kudos.placeholder')}
            onChange={(event) => { setDraft(event.target.value); setSent(false) }}
          />
          <button
            type="submit"
            className="sp-btn sp-btn--primary sp-btn--sm"
            disabled={!draft.trim() || isBusy}
          >
            {t('tch.connection.kudos.send')}
          </button>
        </form>
      </Panel>

      {/* ── the shared record ─────────────────────────────────────────────── */}
      <SectionHeader
        title={t('tch.connection.history')}
        subtitle={t('tch.connection.historySub')}
      />
      {conversations.length ? (
        <ol className="tch-connection__timeline">
          {conversations.map((conversation) => (
            <li key={conversation.id} className="tch-connection__entry">
              <span className="tch-connection__entryIcon" aria-hidden="true">
                <Icon name={conversation.author === 'teacher' ? 'teacher' : 'message'} size={15} />
              </span>
              <div className="tch-connection__entryBody">
                <div className="tch-connection__entryHead">
                  <StatusPill tone={conversation.author === 'teacher' ? 'steady' : 'neutral'}>
                    {conversation.author === 'teacher'
                      ? t('tch.connection.byTeacher')
                      : t('tch.connection.byStudent')}
                  </StatusPill>
                  {conversation.date ? (
                    <span className="tch-connection__date">{conversation.date.slice(0, 10)}</span>
                  ) : null}
                </div>
                {conversation.goals.length ? (
                  <ul className="tch-connection__goals">
                    {conversation.goals.map((goal) => (
                      <li key={goal.id} dir="auto">
                        <Icon name="target" size={12} aria-hidden />
                        {goal.title}
                        {goal.approved_by ? (
                          <span className="tch-connection__approved">
                            {t('tch.goalsPage.state.approved')}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title={t('tch.connection.empty')}
          body={t('tch.connection.emptyBody')}
        />
      )}
    </div>
  )
}
