/* The messages screen — the teacher's line to each student, in one place.
 *
 * This is deliberately NOT a free-form chat with a minor (excluded by design:
 * an unmoderated 1:1 channel needs a moderation and retention policy this
 * product does not claim to have). It is the structured lanes, presented the
 * way a teacher thinks about them — as a conversation per child:
 *
 *   מילה טובה   → stored server-side, delivered by Yuvi in the kid's own chat,
 *                 in Yuvi's voice, plus a bell notification.
 *   עדכון        → a shared note; rings the student's bell.
 *   יעדים        → assignments and approvals appear as thread events.
 *
 * The student's side of the conversation happens where the student lives —
 * in their goals and their talks with Yuvi — and flows back to the teacher
 * through the profile, not through this composer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  EmptyState, ErrorState, Icon, Panel, SkeletonCard,
} from '../../../components/primitives'
import { formatMessageTime } from '../../../hooks/messageTime'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import { useTeacherLive } from '../../../providers/TeacherLiveProvider'
import { PresenceDot, agoLabel } from '../live/LiveNow'
import {
  createTeacherInsight, getGroupSnapshot, getStudentGoals, getStudentKudos,
  listTeacherInsights, sendKudos,
} from '../../../services/teacher'
import './teacher-messages.css'

interface ThreadEvent {
  key: string
  kind: 'kudos' | 'note' | 'goal_assigned' | 'goal_approved'
  at: string
  text: string
  /** kudos only: Yuvi has already spoken it in the kid's chat. */
  delivered?: boolean
}

type ComposeMode = 'kudos' | 'note'

export function TeacherMessagesPage() {
  const { t, language } = useI18n()
  const { groupId, isLoading: scopeLoading } = useTeacherScope()
  const live = useTeacherLive()

  const [students, setStudents] = useState<{ learner_id: string; display_name: string | null }[] | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!groupId) return
    let active = true
    setStudents(null)
    getGroupSnapshot(groupId, language)
      .then((snapshot) => {
        if (!active) return
        const rows = snapshot.students ?? []
        setStudents(rows)
        setSelected((current) =>
          current && rows.some((row) => row.learner_id === current)
            ? current
            : rows[0]?.learner_id ?? null)
      })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [groupId, language])

  if (scopeLoading || (students === null && !error)) {
    return (
      <div className="tch-messages" aria-busy="true">
        {/* Real header, skeleton rail and thread — the two-column frame is the
            same one the loaded page uses, so nothing shifts on arrival. */}
        <header className="tch-messages__head">
          <h1>{t('tch.messages.title')}</h1>
          <p className="tch-messages__subtitle">{t('tch.messages.subtitle')}</p>
        </header>
        <Panel className="tch-messages__layout">
          <SkeletonCard rows={6} />
          <SkeletonCard rows={8} />
        </Panel>
      </div>
    )
  }
  if (error) return <ErrorState title={t('tch.error')} />
  if (!groupId || !students?.length) return <EmptyState title={t('tch.noGroups')} />

  const nameOf = (learnerId: string) =>
    students.find((row) => row.learner_id === learnerId)?.display_name ?? learnerId

  return (
    <div className="tch-messages">
      <header className="tch-messages__head">
        <h1>{t('tch.messages.title')}</h1>
        <p className="tch-messages__subtitle">{t('tch.messages.subtitle')}</p>
      </header>

      <Panel className="tch-messages__layout" data-tour="teacher.messages">
        {/* ── who ─────────────────────────────────────────────────────────── */}
        <nav className="tch-messages__people" aria-label={t('tch.messages.pickAria')}>
          {students.map((student) => {
            const presence = live.presence[student.learner_id] ?? null
            return (
              <button
                key={student.learner_id}
                type="button"
                className={`tch-messages__person${selected === student.learner_id ? ' is-active' : ''}`}
                onClick={() => setSelected(student.learner_id)}
              >
                <span className="tch-messages__avatar" aria-hidden="true">
                  {(student.display_name ?? student.learner_id).slice(0, 1)}
                </span>
                <span className="tch-messages__personText">
                  <span dir="auto">{student.display_name ?? student.learner_id}</span>
                  <small>{agoLabel(presence?.last_seen_at ?? null, t)}</small>
                </span>
                <PresenceDot presence={presence} />
              </button>
            )
          })}
        </nav>

        {/* ── the thread ──────────────────────────────────────────────────── */}
        {selected ? (
          <Thread key={selected} learnerId={selected} name={nameOf(selected)} />
        ) : (
          <EmptyState title={t('tch.messages.pick')} />
        )}
      </Panel>
    </div>
  )
}

function Thread({ learnerId, name }: { learnerId: string; name: string }) {
  const { t, language } = useI18n()
  const [events, setEvents] = useState<ThreadEvent[] | null>(null)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<ComposeMode>('kudos')
  const [isBusy, setIsBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    let active = true
    Promise.all([
      getStudentKudos(learnerId).catch(() => ({ kudos: [] })),
      listTeacherInsights(learnerId).catch(() => ({ insights: [] })),
      getStudentGoals(learnerId).catch(() => ({ conversations: [] })),
    ]).then(([kudos, insights, goals]) => {
      if (!active) return
      const rows: ThreadEvent[] = []
      for (const row of kudos.kudos) {
        rows.push({
          key: `k:${row.id}`,
          kind: 'kudos',
          at: row.created_at ?? '',
          text: row.message,
          delivered: Boolean(row.delivered_at),
        })
      }
      for (const insight of insights.insights) {
        if (insight.visibility !== 'shared') continue
        rows.push({
          key: `n:${insight._id}`, kind: 'note',
          at: insight.created_at, text: insight.text,
        })
      }
      for (const conversation of goals.conversations) {
        for (const goal of conversation.goals ?? []) {
          if (!goal.title) continue
          if (conversation.author === 'teacher') {
            rows.push({
              key: `g:${goal.id}`, kind: 'goal_assigned',
              at: conversation.date ?? '', text: goal.title,
            })
          }
          if (goal.approved_at) {
            rows.push({
              key: `a:${goal.id}`, kind: 'goal_approved',
              at: goal.approved_at, text: goal.title,
            })
          }
        }
      }
      rows.sort((a, b) => (a.at || '').localeCompare(b.at || ''))
      setEvents(rows)
    })
    return () => { active = false }
  }, [learnerId])

  useEffect(() => { setEvents(null); return load() }, [load])

  async function send() {
    const message = draft.trim()
    if (!message || isBusy) return
    setIsBusy(true)
    setFailed(false)
    try {
      if (mode === 'kudos') {
        await sendKudos(learnerId, message, language)
      } else {
        await createTeacherInsight(learnerId, {
          kind: 'note', text: message, visibility: 'shared',
        })
      }
      setDraft('')
      load()
    } catch {
      setFailed(true)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="tch-thread" aria-label={name}>
      <header className="tch-thread__head">
        <strong dir="auto">{name}</strong>
        <button
          type="button"
          className="sp-btn sp-btn--ghost sp-btn--sm"
          onClick={() => navigate(`/teacher/student/${learnerId}`)}
        >
          {t('tch.attention.open')}
        </button>
      </header>

      {/* Honest about the medium: this reaches the child through Yuvi and the
          bell — their answers live in their goals and their talks with Yuvi. */}
      <p className="tch-thread__how">
        <Icon name="handoff" size={13} aria-hidden />
        {t('tch.messages.how')}
      </p>

      <div className="tch-thread__body">
        {events === null ? (
          <div aria-busy="true"><SkeletonCard rows={3} /></div>
        ) : events.length ? (
          events.map((event) => (
            <article key={event.key} className={`tch-thread__event tch-thread__event--${event.kind}`}>
              {event.kind === 'kudos' || event.kind === 'note' ? (
                /* Bubble, then the clock underneath it — the same shape and the
                   same Israel-time formatter the child sees in their own chat,
                   so both sides of a conversation agree on when it happened. */
                <>
                  <div className="tch-thread__bubble">
                    <p dir="auto">{event.text}</p>
                    <span className="tch-thread__meta">
                      {event.kind === 'kudos'
                        ? event.delivered
                          ? t('tch.messages.deliveredByYuvi')
                          : t('tch.messages.waitingForYuvi')
                        : t('tch.messages.sentToBell')}
                    </span>
                  </div>
                  <time className="tch-thread__time" dateTime={event.at}>
                    {formatMessageTime(event.at, language)}
                  </time>
                </>
              ) : (
                <>
                  <div className="tch-thread__system">
                    <Icon name="target" size={13} aria-hidden />
                    <span dir="auto">
                      {t(event.kind === 'goal_assigned'
                        ? 'tch.messages.goalAssigned'
                        : 'tch.messages.goalApproved', { title: event.text })}
                    </span>
                  </div>
                  <time className="tch-thread__time tch-thread__time--system" dateTime={event.at}>
                    {formatMessageTime(event.at, language)}
                  </time>
                </>
              )}
            </article>
          ))
        ) : (
          <p className="tch-thread__empty">{t('tch.messages.empty', { name })}</p>
        )}
      </div>

      <form
        className="tch-thread__composer"
        onSubmit={(event) => { event.preventDefault(); void send() }}
      >
        <div className="tch-thread__modes" role="radiogroup" aria-label={t('tch.messages.modeAria')}>
          <button
            type="button"
            className={`tch-chip${mode === 'kudos' ? ' is-on' : ''}`}
            aria-pressed={mode === 'kudos'}
            onClick={() => setMode('kudos')}
          >
            <Icon name="spark" size={12} aria-hidden />
            {t('tch.messages.mode.kudos')}
          </button>
          <button
            type="button"
            className={`tch-chip${mode === 'note' ? ' is-on' : ''}`}
            aria-pressed={mode === 'note'}
            onClick={() => setMode('note')}
          >
            <Icon name="bell" size={12} aria-hidden />
            {t('tch.messages.mode.note')}
          </button>
        </div>
        <div className="tch-thread__inputRow">
          <input
            value={draft}
            dir="auto"
            placeholder={t(mode === 'kudos'
              ? 'tch.messages.placeholder.kudos'
              : 'tch.messages.placeholder.note')}
            aria-label={t('tch.messages.modeAria')}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="tch-dock__send"
            disabled={!draft.trim() || isBusy}
            aria-label={t('tch.connection.kudos.send')}
            title={t('tch.connection.kudos.send')}
          >
            <Icon name="send" size={17} aria-hidden />
          </button>
        </div>
        {failed ? <p className="tch-thread__failed" role="status">{t('tch.kudos.failed')}</p> : null}
      </form>
    </section>
  )
}
