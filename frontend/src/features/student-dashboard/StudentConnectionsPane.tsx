import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { EmptyState, ErrorState, Icon, LoadingState } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useBrain } from '../../providers/BrainProvider'
import { listMentoring, type MentoringConversation } from '../../services/mentoring'
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
    return () => { active = false }
  }, [learnerId])

  const teachers = useMemo(() => {
    const names = (rows || []).map((row) => row.teacher_name.trim()).filter(Boolean)
    return [...new Set(names)]
  }, [rows])
  const [selectedTeacher, setSelectedTeacher] = useState('')
  const activeTeacher = selectedTeacher || teachers[0] || t('sdash.chat.teacherFallback')

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
      if (row.deadline && row.next_steps) {
        items.push({
          date: row.deadline,
          kind: 'goal',
          title: row.next_steps,
          teacher: row.teacher_name,
        })
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
              {(teachers.length ? teachers : [t('sdash.chat.teacherFallback')]).map((teacher) => (
                <button
                  key={teacher}
                  className={teacher === activeTeacher ? 'is-active' : ''}
                  type="button"
                  onClick={() => setSelectedTeacher(teacher)}
                >
                  <span className="sd-chat-window__avatar" aria-hidden="true">{teacher.charAt(0)}</span>
                  <span><strong dir="auto">{teacher}</strong><small>{t('sdash.chat.teacherRole')}</small></span>
                </button>
              ))}
            </aside>
            <div className="sd-chat-thread">
              <header className="sd-chat-thread__header">
                <span className="sd-chat-window__avatar" aria-hidden="true">{activeTeacher.charAt(0)}</span>
                <div><strong dir="auto">{activeTeacher}</strong><small>{t('sdash.chat.sharedUpdates')}</small></div>
              </header>
              <div className="sd-chat-thread__body" aria-live="polite">
                {teacherRows.length ? teacherRows.map((row) => (
                  <article className="sd-chat-summary" key={row.id || `${row.date}-${row.meeting_stage}`}>
                    <span>{formatDate(row.date)}</span>
                    <p dir="auto">{row.notes}</p>
                    {row.next_steps && <small dir="auto">{t('sdash.chat.nextStep')}: {row.next_steps}</small>}
                  </article>
                )) : (
                  <EmptyState icon="message" title={t('sdash.chat.empty')} body={t('sdash.chat.emptyBody')} />
                )}
              </div>
              <footer className="sd-chat-thread__footer">
                <button type="button" onClick={() => navigate('/mentoring')}>
                  <Icon name="message" size={17} />
                  {t('sdash.chat.openMentoring')}
                </button>
              </footer>
            </div>
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