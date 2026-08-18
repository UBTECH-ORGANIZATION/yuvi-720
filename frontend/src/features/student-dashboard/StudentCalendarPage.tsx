import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { EmptyState, ErrorState, Icon, LoadingState } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { getCalendarWeek, type CalendarItem, type CalendarWeek } from '../../services/calendar'
import {
  formatCalendarDay, formatCalendarRange, formatCalendarTime, groupItemsByDay,
  shiftDate, weekBoundsForDate, weekDays,
} from './calendarModel'
import './student-calendar.css'

const ICONS = { task: 'backpack', goal: 'target', meeting: 'teacher', event: 'calendar', lesson: 'book' }

function todayInIsrael() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function CalendarEntry({ item }: { item: CalendarItem }) {
  const { t, language } = useI18n()
  const content = (
    <>
      <span className="student-calendar__itemIcon" aria-hidden="true">
        <Icon name={ICONS[item.kind]} size={17} />
      </span>
      <span className="student-calendar__itemCopy">
        <small>{t(`sdash.calendar.kind.${item.kind}`)}</small>
        <strong dir="auto">{
          item.title || (item.kind === 'meeting'
            ? t('sdash.calendar.meeting')
            : t('sdash.calendar.untitled'))
        }</strong>
        <span>
          {item.all_day ? t('sdash.calendar.allDay') : formatCalendarTime(item.start_at, language)}
          {item.status !== 'upcoming' && ` · ${t(`sdash.calendar.status.${item.status}`)}`}
        </span>
      </span>
    </>
  )
  return (
    <article className={`student-calendar__item is-${item.kind} is-${item.status}`}>
      {item.action_route ? (
        <button type="button" onClick={() => navigate(item.action_route || '')}>{content}</button>
      ) : content}
    </article>
  )
}

export function StudentCalendarPage({ studentName }: { studentName: string }) {
  const { t, language } = useI18n()
  const [anchor, setAnchor] = useState(todayInIsrael)
  const [week, setWeek] = useState<CalendarWeek | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError(false)
    getCalendarWeek(anchor, controller.signal)
      .then(setWeek)
      .catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [anchor, reloadKey])

  const days = useMemo(() => week ? weekDays(week.week_start) : [], [week])
  const grouped = useMemo(() => groupItemsByDay(week?.items || []), [week])
  const [visibleWeekStart, visibleWeekEnd] = weekBoundsForDate(anchor)
  const [currentWeekStart] = weekBoundsForDate(todayInIsrael())
  const weekLabel = visibleWeekStart === currentWeekStart
    ? t('sdash.calendar.thisWeek')
    : formatCalendarRange(visibleWeekStart, visibleWeekEnd, language)

  return (
    <div className="sd-page">
      <LearnerAppBar studentName={studentName} />
      <main className="student-calendar">
        <header className="student-calendar__header">
          <div>
            <p>{t('sdash.calendar.eyebrow')}</p>
            <h1>{t('sdash.calendar.title')}</h1>
            <span>{t('sdash.calendar.subtitle')}</span>
          </div>
          <nav aria-label={t('sdash.calendar.weekNavigation')}>
            <button type="button" aria-label={t('sdash.calendar.previousWeek')}
                    onClick={() => setAnchor((value) => shiftDate(value, -7))}>
              <Icon name="chevronLeft" size={18} />
            </button>
            <button type="button" className="student-calendar__today" onClick={() => setAnchor(todayInIsrael())}>
              {weekLabel}
            </button>
            <button type="button" className="student-calendar__next" aria-label={t('sdash.calendar.nextWeek')}
                    onClick={() => setAnchor((value) => shiftDate(value, 7))}>
              <Icon name="chevronLeft" size={18} />
            </button>
          </nav>
        </header>

        {error ? (
          <ErrorState title={t('sdash.calendar.error')} action={
            <button className="student-calendar__retry" type="button" onClick={() => setReloadKey((value) => value + 1)}>
              {t('sdash.retry')}
            </button>
          } />
        ) : !week ? (
          <LoadingState title={t('sdash.calendar.loading')} />
        ) : !week.items.length ? (
          <section className="student-calendar__empty">
            <EmptyState icon="calendar" title={t('sdash.calendar.empty')} body={t('sdash.calendar.emptyBody')} />
          </section>
        ) : (
          <section className="student-calendar__week" aria-label={t('sdash.calendar.windowLabel')}>
            {days.map((day) => (
              <section className="student-calendar__day" key={day}>
                <h2 className={day === todayInIsrael() ? 'is-today' : ''}>
                  <time dateTime={day}>{formatCalendarDay(day, language, true)}</time>
                </h2>
                <div className="student-calendar__dayItems">
                  {(grouped.get(day) || []).map((item) => <CalendarEntry item={item} key={item.id} />)}
                  {!grouped.has(day) && <p className="student-calendar__dayEmpty">{t('sdash.calendar.noItems')}</p>}
                </div>
              </section>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}