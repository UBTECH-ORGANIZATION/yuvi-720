/* The child's side of the conversation.
 *
 * Until now this pane was read-only: it showed what a teacher had written and
 * offered no way to answer, because a 1:1 channel with a minor was excluded by
 * design. `services/direct_messages.py` is that exclusion's replacement — every
 * message is screened before it is stored, in BOTH directions — so the child
 * can write back, and their message goes through exactly the same gate their
 * teacher's does.
 *
 * One asymmetry, and it is deliberate: a message that reads as distress is
 * refused delivery and raises the teacher's urgent alert instead. A child in
 * that moment should not be depending on their teacher opening a thread.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { EmptyState, ErrorState, Icon, LoadingState } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useBrain } from '../../providers/BrainProvider'
import { listMentoring, type MentoringConversation } from '../../services/mentoring'
import { getMyTeachers, type MyTeacher } from '../../services/me'
import {
  MessageRefused, listMyMessages, markMyMessagesRead, sendMyMessage,
  type DirectMessage,
} from '../../services/directMessages'
import './student-connections.css'

interface StudentConnectionsPaneProps {
  mode: 'chat' | 'calendar'
  studentName: string
}

interface CalendarItem {
  date: string
  kind: 'meeting' | 'goal'
  title: string
  teacher: string
}

export function StudentConnectionsPane({ mode, studentName }: StudentConnectionsPaneProps) {
  const { learnerId } = useBrain()
  const { t, language } = useI18n()
  const [rows, setRows] = useState<MentoringConversation[] | null>(null)
  const [roster, setRoster] = useState<MyTeacher[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    setRows(null)
    setError(false)
    // The learner is resolved server-side from the session; learnerId only
    // keys the refetch when the signed-in learner changes.
    listMentoring('learner')
      .then((response) => {
        if (active) setRows(response.conversations)
      })
      .catch(() => {
        if (active) setError(true)
      })

    // The roster is the authority on who my teachers are. It loads separately
    // and never fails the page: if it is unavailable the pane degrades to the
    // old conversation-derived list rather than showing nothing.
    getMyTeachers()
      .then((response) => { if (active) setRoster(response.teachers) })
      .catch(() => { if (active) setRoster([]) })

    return () => { active = false }
  }, [learnerId])

  /* Name AND id. The pane used to flatten teachers to a list of display names,
     which was enough to filter mentoring summaries and is not enough to send
     anything: a message needs the teacher it is addressed to. A teacher who
     only appears in old conversations has no id and no live link, so their
     history stays readable and their composer is closed — losing access is not
     the same as never existing, but it does mean you cannot write to them. */
  const teachers = useMemo(() => {
    const seen = new Set<string>()
    const list: { id: string | null; name: string }[] = []
    for (const teacher of roster) {
      const name = teacher.display_name.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      list.push({ id: teacher.teacher_id, name })
    }
    for (const row of rows || []) {
      const name = row.teacher_name.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      list.push({ id: null, name })
    }
    return list
  }, [roster, rows])

  const [selectedTeacher, setSelectedTeacher] = useState('')
  const active = useMemo(
    () => teachers.find((teacher) => teacher.name === selectedTeacher)
      ?? teachers[0]
      ?? { id: null, name: t('sdash.chat.teacherFallback') },
    [teachers, selectedTeacher, t],
  )
  const activeTeacher = active.name

  const teacherRows = useMemo(
    () => (rows || []).filter((row) => row.teacher_name.trim() === activeTeacher),
    [activeTeacher, rows],
  )

  const calendarItems = useMemo(() => {
    const items: CalendarItem[] = []
    for (const row of rows || []) {
      if (row.date) {
        items.push({
          date: row.date,
          kind: 'meeting',
          title: row.meeting_stage || t('sdash.calendar.meeting'),
          teacher: row.teacher_name,
        })
      }
      for (const goal of row.goals || []) {
        if (goal.deadline && (goal.title || goal.next_steps)) {
          items.push({
            date: goal.deadline,
            kind: 'goal',
            title: goal.title || goal.next_steps || '',
            teacher: row.teacher_name,
          })
        }
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date))
  }, [rows, t])

  const formatDate = (value: string) => {
    const date = new Date(`${value}T12:00:00`)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(language, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(date)
  }

  return (
    <div className="sd-page sd-connections-page">
      <LearnerAppBar studentName={studentName} />
      <main className="sd-connections">
        <header className="sd-connections__heading">
          <span className="sd-connections__icon" aria-hidden="true">
            <Icon name={mode === 'chat' ? 'message' : 'calendar'} size={25} />
          </span>
          <div>
            <h1>{t(`sdash.${mode}.title`)}</h1>
            <p>{t(`sdash.${mode}.subtitle`)}</p>
          </div>
        </header>

        {error ? (
          <ErrorState title={t(`sdash.${mode}.error`)} />
        ) : rows === null ? (
          <LoadingState title={t(`sdash.${mode}.loading`)} />
        ) : mode === 'chat' ? (
          <section className="sd-chat-window" aria-label={t('sdash.chat.windowLabel')}>
            <aside className="sd-chat-window__teachers">
              <h2>{t('sdash.chat.teachers')}</h2>
              {(teachers.length ? teachers : [{ id: null, name: t('sdash.chat.teacherFallback') }])
                .map((teacher) => (
                <button
                  key={teacher.name}
                  className={teacher.name === activeTeacher ? 'is-active' : ''}
                  type="button"
                  onClick={() => setSelectedTeacher(teacher.name)}
                >
                  <span className="sd-chat-window__avatar" aria-hidden="true">{teacher.name.charAt(0)}</span>
                  <span><strong dir="auto">{teacher.name}</strong><small>{t('sdash.chat.teacherRole')}</small></span>
                </button>
              ))}
            </aside>
            <TeacherThread
              key={active.id ?? active.name}
              teacherId={active.id}
              teacherName={activeTeacher}
              summaries={teacherRows}
              formatDate={formatDate}
            />
          </section>
        ) : (
          <section className="sd-calendar-window" aria-label={t('sdash.calendar.windowLabel')}>
            {calendarItems.length ? calendarItems.map((item) => (
              <article className="sd-calendar-item" key={`${item.kind}-${item.date}-${item.title}`}>
                <time dateTime={item.date}>
                  <Icon name="calendar" size={18} />
                  {formatDate(item.date)}
                </time>
                <div className={`sd-calendar-item__marker sd-calendar-item__marker--${item.kind}`} aria-hidden="true">
                  <Icon name={item.kind === 'meeting' ? 'teacher' : 'target'} size={19} />
                </div>
                <div className="sd-calendar-item__copy">
                  <span>{t(`sdash.calendar.kind.${item.kind}`)}</span>
                  <strong dir="auto">{item.title}</strong>
                  {item.teacher && <small dir="auto">{item.teacher}</small>}
                </div>
              </article>
            )) : (
              <EmptyState
                icon="calendar"
                title={t('sdash.calendar.empty')}
                body={t('sdash.calendar.emptyBody')}
                action={<button className="sd-connections__action" type="button" onClick={() => navigate('/mentoring')}>{t('sdash.calendar.openMentoring')}</button>}
              />
            )}
          </section>
        )}
      </main>
    </div>
  )
}
/* One teacher's thread: what they wrote, what the child wrote back, and the box
 * to write in.
 *
 * The mentoring summaries and the direct messages are merged and sorted by
 * time, because they are one relationship and reading them as two lists means
 * reading the same week twice. Summaries have a date only (no clock), so they
 * sort onto the start of their day — the alternative, a separate rail for
 * summaries, is the two-lists problem again.
 */
function TeacherThread({ teacherId, teacherName, summaries, formatDate }: {
  /** Null for a teacher who exists only in old conversations — readable
   *  history, no live link, so nothing can be sent to them. */
  teacherId: string | null
  teacherName: string
  summaries: MentoringConversation[]
  formatDate: (value: string) => string
}) {
  const { t, language } = useI18n()
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [failed, setFailed] = useState<'refused' | 'network' | null>(null)
  const [refusalKey, setRefusalKey] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    if (!teacherId) { setMessages([]); return }
    let active = true
    listMyMessages(teacherId)
      .then((rows) => {
        if (!active) return
        setMessages(rows)
        void markMyMessagesRead(teacherId).catch(() => {})
      })
      .catch(() => { if (active) setMessages([]) })
    return () => { active = false }
  }, [teacherId])

  useEffect(() => load(), [load])

  /* Latest at the bottom — a thread that opens on its oldest line is a thread
     nobody reads the end of. */
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, summaries])

  const timeline = useMemo(() => {
    const rows: {
      key: string; at: string; kind: 'summary' | 'from_teacher' | 'from_me'
      body: MentoringConversation | DirectMessage
    }[] = []
    for (const summary of summaries) {
      rows.push({
        key: `s:${summary.id || summary.date}`,
        // A date with no clock; midday keeps it inside its own day whichever
        // way the timezone falls.
        at: summary.date ? `${summary.date}T12:00:00` : '',
        kind: 'summary', body: summary,
      })
    }
    for (const message of messages) {
      rows.push({
        key: `m:${message.id}`,
        at: message.created_at || '',
        kind: message.sender === 'teacher' ? 'from_teacher' : 'from_me',
        body: message,
      })
    }
    return rows.sort((a, b) => a.at.localeCompare(b.at))
  }, [summaries, messages])

  async function send() {
    const text = draft.trim()
    if (!text || !teacherId || isBusy) return
    setIsBusy(true)
    setFailed(null)
    setRefusalKey(null)
    try {
      await sendMyMessage(teacherId, text, language)
      setDraft('')
      load()
    } catch (error) {
      // The draft stays in the box. A child who was just told their words were
      // not okay should be able to edit them, not retype them from memory.
      if (error instanceof MessageRefused) {
        setFailed('refused')
        setRefusalKey(error.key)
      } else {
        setFailed('network')
      }
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="sd-chat-thread">
      <header className="sd-chat-thread__header">
        <span className="sd-chat-window__avatar" aria-hidden="true">{teacherName.charAt(0)}</span>
        <div><strong dir="auto">{teacherName}</strong><small>{t('sdash.chat.sharedUpdates')}</small></div>
      </header>

      <div className="sd-chat-thread__body" ref={bodyRef} aria-live="polite">
        {timeline.length ? timeline.map((row) => {
          if (row.kind === 'summary') {
            const summary = row.body as MentoringConversation
            return (
              <article className="sd-chat-summary" key={row.key}>
                <span>{formatDate(summary.date)}</span>
                <p dir="auto">{summary.notes}</p>
                {(summary.goals || []).map((goal) => (
                  <small key={goal.id || goal.title} dir="auto">
                    {t('sdash.chat.nextStep')}: {goal.title || goal.next_steps}
                  </small>
                ))}
              </article>
            )
          }
          const message = row.body as DirectMessage
          return (
            <article
              className={`sd-chat-bubble sd-chat-bubble--${row.kind === 'from_me' ? 'me' : 'them'}`}
              key={row.key}
            >
              <p dir="auto">{message.text}</p>
            </article>
          )
        }) : (
          <EmptyState icon="message" title={t('sdash.chat.empty')} body={t('sdash.chat.emptyBody')} />
        )}
      </div>

      {/* The child's own box. A textarea and not an input: an answer to a
          teacher is often more than one line, and a single-line field that
          scrolls sideways is how a child gives up halfway through. */}
      <form
        className="sd-chat-compose"
        onSubmit={(event) => { event.preventDefault(); void send() }}
      >
        <label className="sd-chat-compose__label" htmlFor="sd-chat-compose">
          {t('sdash.chat.compose.label', { teacher: teacherName })}
        </label>
        <div className="sd-chat-compose__row">
          <textarea
            id="sd-chat-compose"
            value={draft}
            dir="auto"
            rows={2}
            disabled={!teacherId}
            placeholder={teacherId
              ? t('sdash.chat.compose.placeholder')
              : t('sdash.chat.compose.closed')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter makes a new line — the shape every
              // chat this age group uses.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <button
            type="submit"
            className="sd-chat-compose__send"
            disabled={!draft.trim() || !teacherId || isBusy}
            aria-label={t('sdash.chat.compose.send')}
            title={t('sdash.chat.compose.send')}
          >
            <Icon name="send" size={18} aria-hidden />
          </button>
        </div>
        {failed ? (
          <p className={`sd-chat-compose__failed${failed === 'refused' ? ' is-refused' : ''}`}
             role="status">
            {failed === 'refused'
              ? t(refusalKey || 'moderation.default')
              : t('sdash.chat.compose.failed')}
          </p>
        ) : null}
      </form>

      <footer className="sd-chat-thread__footer">
        <button type="button" onClick={() => navigate('/mentoring')}>
          <Icon name="message" size={17} />
          {t('sdash.chat.openMentoring')}
        </button>
      </footer>
    </div>
  )
}
