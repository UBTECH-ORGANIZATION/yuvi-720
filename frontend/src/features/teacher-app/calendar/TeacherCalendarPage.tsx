/* The class calendar: everything with a date, in one place.
 *
 * **The day column is decided server-side.** Each item arrives stamped with
 * `day` — a `YYYY-MM-DD` already computed in the school's timezone. This page
 * groups by that string and never re-derives it from a timestamp, because
 * doing so in the browser is what puts a 22:30 deadline in the wrong column on
 * a tablet left in another timezone.
 *
 * **Nothing here is a copy.** Task launches, goal deadlines and meetings are
 * read from the stores that own them; only `event` rows belong to the
 * calendar. Moving a task's due date changes this screen with no second edit,
 * which is the whole reason it aggregates rather than duplicates.
 *
 * **Every row carries the icon of the section that owns it** — a task wears
 * the Tasks icon, a goal the Goals icon — so the calendar reads as a view
 * onto the rest of the product rather than a fifth place things live.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  EmptyState, ErrorState, Icon, SectionHeader, SkeletonCard,
} from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  createCalendarEvent, deleteCalendarEvent, getGroupCalendar, listSubgroups,
  type CalendarEventKind, type CalendarItem, type CalendarSource, type Subgroup,
} from '../../../services/teacher'
import './teacher-calendar.css'

type ViewMode = 'month' | 'week' | 'day'

/** Sunday-first: the school week this product is used in starts on Sunday. */
const WEEK_START = 0

const SOURCES: CalendarSource[] = ['event', 'task', 'goal', 'meeting']

/** The icon each row wears. Deliberately the owning section's own icon — a
 *  task looks like the Tasks tab, a goal like the Goals tab — so the calendar
 *  reads as a window onto them rather than a separate world. */
const ICONS: Record<string, string> = {
  event: 'calendar', task: 'backpack', goal: 'target', meeting: 'teacher',
  lesson: 'book', reminder: 'bell', test: 'document',
}

const iconFor = (item: Pick<CalendarItem, 'source' | 'kind'>) =>
  ICONS[item.kind] ?? ICONS[item.source] ?? 'calendar'

/* ── day-string helpers ───────────────────────────────────────────────────
 * All of these operate on `YYYY-MM-DD` strings, deliberately. Parsing a day
 * into a Date and back is how a calendar loses a day at a DST boundary; the
 * only Date used is a UTC-noon anchor, which no timezone can shift off its
 * date. */

const dayString = (date: Date) => date.toISOString().slice(0, 10)

/** A Date fixed at noon UTC — far enough from both midnights that no offset
 *  moves it to another date. */
function anchor(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date, 12))
}

function addDays(day: string, count: number): string {
  const value = anchor(day)
  value.setUTCDate(value.getUTCDate() + count)
  return dayString(value)
}

function addMonths(day: string, count: number): string {
  const value = anchor(day)
  value.setUTCDate(1)
  value.setUTCMonth(value.getUTCMonth() + count)
  return dayString(value)
}

const startOfWeek = (day: string) =>
  addDays(day, -((anchor(day).getUTCDay() - WEEK_START + 7) % 7))

function monthGrid(day: string): { from: string; to: string } {
  const first = anchor(day)
  first.setUTCDate(1)
  const last = anchor(day)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  return { from: startOfWeek(dayString(first)), to: addDays(startOfWeek(dayString(last)), 6) }
}

function rangeFor(view: ViewMode, cursor: string): { from: string; to: string } {
  if (view === 'day') return { from: cursor, to: cursor }
  if (view === 'week') {
    const from = startOfWeek(cursor)
    return { from, to: addDays(from, 6) }
  }
  return monthGrid(cursor)
}

function daysBetween(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
  return days
}

/** The time of a timed item, in the school's zone rather than the browser's. */
function timeIn(zone: string, at: string | null): string {
  if (!at) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone,
    }).format(new Date(at))
  } catch {
    return ''
  }
}

const localeOf = (language: string) =>
  language === 'he' ? 'he-IL' : language === 'ar' ? 'ar' : 'en-GB'

export function TeacherCalendarPage() {
  const { t, language } = useI18n()
  const { groupId, isLoading: scopeLoading } = useTeacherScope()
  const { students, nameOf } = useTeacherRoster()

  const [view, setView] = useState<ViewMode>('month')
  const [cursor, setCursor] = useState(() => dayString(new Date()))
  const [items, setItems] = useState<CalendarItem[] | null>(null)
  const [zone, setZone] = useState('Asia/Jerusalem')
  const [error, setError] = useState(false)
  const [subgroupList, setSubgroupList] = useState<Subgroup[]>([])
  /** One control, two kinds of narrowing: `sub:<id>` or `learner:<id>`. */
  const [scope, setScope] = useState('')
  const [hidden, setHidden] = useState<Set<CalendarSource>>(new Set())
  const [composeDay, setComposeDay] = useState<string | null>(null)
  const [detail, setDetail] = useState<CalendarItem | null>(null)
  const [nonce, setNonce] = useState(0)

  const range = useMemo(() => rangeFor(view, cursor), [view, cursor])
  const reload = useCallback(() => setNonce((value) => value + 1), [])

  const classmates = useMemo(
    () => students.filter((row) => row.group_id === groupId),
    [students, groupId])

  useEffect(() => {
    if (!groupId) return
    let active = true
    setScope('')
    listSubgroups(groupId)
      .then((result) => { if (active) setSubgroupList(result.subgroups ?? []) })
      .catch(() => { if (active) setSubgroupList([]) })
    return () => { active = false }
  }, [groupId])

  useEffect(() => {
    if (!groupId) return
    let active = true
    setItems(null); setError(false)
    const [kind, id] = scope.split(':')
    getGroupCalendar(groupId, range.from, range.to, {
      subgroup: kind === 'sub' ? id : null,
      learner: kind === 'learner' ? id : null,
    })
      .then((result) => {
        if (!active) return
        setItems(result.items ?? [])
        setZone(result.timezone || 'Asia/Jerusalem')
      })
      .catch(() => { if (active) { setError(true); setItems([]) } })
    return () => { active = false }
  }, [groupId, range.from, range.to, scope, nonce])

  /* One pass into day buckets. Keyed by the server's `day` — the client's own
     clock never gets a vote on which column something belongs to. */
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>()
    for (const item of items ?? []) {
      if (hidden.has(item.source)) continue
      const list = map.get(item.day) ?? []
      list.push(item)
      map.set(item.day, list)
    }
    return map
  }, [items, hidden])

  const counts = useMemo(() => {
    const tally: Record<string, number> = {}
    for (const item of items ?? []) tally[item.source] = (tally[item.source] ?? 0) + 1
    return tally
  }, [items])

  const toggleSource = (source: CalendarSource) =>
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })

  const step = (direction: number) => setCursor((current) =>
    view === 'month' ? addMonths(current, direction)
      : addDays(current, direction * (view === 'week' ? 7 : 1)))

  const heading = useMemo(() => {
    const locale = localeOf(language)
    const date = anchor(cursor)
    if (view === 'day') {
      return new Intl.DateTimeFormat(locale, {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
      }).format(date)
    }
    if (view === 'week') {
      const from = startOfWeek(cursor)
      const format = new Intl.DateTimeFormat(locale, {
        day: 'numeric', month: 'short', timeZone: 'UTC',
      })
      return `${format.format(anchor(from))} — ${format.format(anchor(addDays(from, 6)))}`
    }
    return new Intl.DateTimeFormat(locale, {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(date)
  }, [cursor, view, language])

  if (!scopeLoading && !groupId) return <EmptyState title={t('tch.noGroups')} />

  return (
    <div className="tch-cal">
      <SectionHeader
        title={t('tch.calendar.title')}
        subtitle={t('tch.calendar.subtitle')}
        action={
          <button type="button" className="sp-btn sp-btn--sm"
                  onClick={() => setComposeDay(cursor)}>
            <Icon name="plus" size={15} aria-hidden />
            {t('tch.calendar.create')}
          </button>
        }
      />

      <div className="tch-cal__toolbar">
        <div className="tch-cal__nav">
          <button type="button" className="tch-cal__step"
                  aria-label={t('tch.calendar.prev')} onClick={() => step(-1)}>
            <Icon name="chevronLeft" size={16} aria-hidden />
          </button>
          <button type="button" className="tch-cal__step tch-cal__step--next"
                  aria-label={t('tch.calendar.next')} onClick={() => step(1)}>
            <Icon name="chevronLeft" size={16} aria-hidden />
          </button>
          <strong className="tch-cal__heading" dir="auto">{heading}</strong>
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                  onClick={() => setCursor(dayString(new Date()))}>
            {t('tch.calendar.today')}
          </button>
        </div>

        <div className="tch-cal__views" role="group" aria-label={t('tch.calendar.view')}>
          {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
            <button key={mode} type="button"
                    className={`tch-cal__view${view === mode ? ' is-on' : ''}`}
                    aria-pressed={view === mode}
                    onClick={() => setView(mode)}>
              {t(`tch.calendar.view.${mode}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="tch-cal__filters">
        {/* One control for every way of narrowing: the whole class, a
            sub-group, or one child. Grouped rather than two selects, because
            they are mutually exclusive answers to the same question. */}
        <label className="tch-cal__scope">
          <span>{t('tch.calendar.scope')}</span>
          <select className="sp-input" value={scope}
                  onChange={(event) => setScope(event.target.value)}>
            <option value="">{t('tch.calendar.scope.all')}</option>
            {subgroupList.length ? (
              <optgroup label={t('tch.calendar.scope.subgroups')}>
                {subgroupList.map((row) => (
                  <option key={row.id} value={`sub:${row.id}`}>{row.name}</option>
                ))}
              </optgroup>
            ) : null}
            {classmates.length ? (
              <optgroup label={t('tch.calendar.scope.students')}>
                {classmates.map((row) => (
                  <option key={row.learner_id} value={`learner:${row.learner_id}`}>
                    {row.display_name ?? row.learner_id}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>

        {/* The legend is the filter. Counts make it a summary too: "what is in
            this month" answered before any cell is read. */}
        <div className="tch-cal__legend">
          {SOURCES.map((source) => (
            <button key={source} type="button"
                    className={`tch-cal__chip tch-cal__chip--${source}${hidden.has(source) ? ' is-off' : ''}`}
                    aria-pressed={!hidden.has(source)}
                    onClick={() => toggleSource(source)}>
              <Icon name={ICONS[source]} size={13} aria-hidden />
              {t(`tch.calendar.source.${source}`)}
              <em>{counts[source] ?? 0}</em>
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorState title={t('tch.error')} /> : null}

      {items === null ? (
        <SkeletonCard rows={6} />
      ) : view === 'day' ? (
        <DayList items={byDay.get(cursor) ?? []} zone={zone}
                 onOpen={setDetail} onAdd={() => setComposeDay(cursor)} />
      ) : (
        <Grid view={view} range={range} cursor={cursor} byDay={byDay} zone={zone}
              nameOf={nameOf}
              onPick={(day) => { setCursor(day); setView('day') }}
              onOpen={setDetail} />
      )}

      {detail ? (
        <EventDetails item={detail} zone={zone} nameOf={nameOf}
                      onClose={() => setDetail(null)}
                      onDeleted={() => { setDetail(null); reload() }} />
      ) : null}

      {composeDay ? (
        <ComposeEvent
          groupId={groupId as string}
          day={composeDay}
          subgroups={subgroupList}
          students={classmates}
          onClose={() => setComposeDay(null)}
          onCreated={() => { setComposeDay(null); reload() }}
        />
      ) : null}
    </div>
  )
}

/** Month and week share one grid — a week is a month with a single row. */
function Grid({ view, range, cursor, byDay, zone, nameOf, onPick, onOpen }: {
  view: ViewMode
  range: { from: string; to: string }
  cursor: string
  byDay: Map<string, CalendarItem[]>
  zone: string
  nameOf: (learnerId: string) => string | null
  onPick: (day: string) => void
  onOpen: (item: CalendarItem) => void
}) {
  const { t, language } = useI18n()
  const days = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to])
  const today = dayString(new Date())
  const month = cursor.slice(0, 7)
  const locale = localeOf(language)

  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
    return Array.from({ length: 7 }, (_, index) =>
      format.format(anchor(addDays(startOfWeek(range.from), index))))
  }, [locale, range.from])

  const cap = view === 'week' ? 6 : 3

  return (
    <div className={`tch-cal__grid tch-cal__grid--${view}`}>
      {weekdays.map((label) => (
        <div key={label} className="tch-cal__weekday">{label}</div>
      ))}
      {days.map((day) => {
        const rows = byDay.get(day) ?? []
        // A month view shows whole weeks, so it always spills into the
        // neighbouring months. Those days are dimmed rather than hidden —
        // the week has to stay intact — but they must not read as this month.
        const outside = view === 'month' && day.slice(0, 7) !== month
        return (
          <div key={day}
               className={`tch-cal__cell${day === today ? ' is-today' : ''}${outside ? ' is-outside' : ''}`}>
            <button type="button" className="tch-cal__dateBtn"
                    onClick={() => onPick(day)}
                    aria-label={`${day} · ${t('tch.calendar.view.day')}`}>
              <span className="tch-cal__date">{Number(day.slice(8))}</span>
            </button>
            <div className="tch-cal__items">
              {rows.slice(0, cap).map((item) => (
                <EventPip key={`${item.source}:${item.id}`} item={item} zone={zone}
                          nameOf={nameOf} onOpen={onOpen} />
              ))}
              {rows.length > cap ? (
                <button type="button" className="tch-cal__more"
                        onClick={() => onPick(day)}>
                  {t('tch.calendar.more', { count: rows.length - cap })}
                </button>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** One line in a day cell: kind icon, time, title — and the child's name when
 *  the item belongs to one, because "מפגש" alone does not say with whom. */
function EventPip({ item, zone, nameOf, onOpen }: {
  item: CalendarItem
  zone: string
  nameOf: (learnerId: string) => string | null
  onOpen: (item: CalendarItem) => void
}) {
  const { t } = useI18n()
  const who = item.learner_id ? nameOf(item.learner_id) ?? item.learner_id : null
  const label = item.title || t(`tch.calendar.source.${item.source}`)
  return (
    <button type="button"
            className={`tch-cal__pip tch-cal__pip--${item.source}`}
            title={who ? `${label} · ${who}` : label}
            onClick={() => onOpen(item)}>
      <Icon name={iconFor(item)} size={12} aria-hidden />
      {!item.all_day ? <em className="tch-cal__time">{timeIn(zone, item.at)}</em> : null}
      <span className="tch-cal__pipText" dir="auto">{label}</span>
      {who ? <span className="tch-cal__pipWho" dir="auto">{who}</span> : null}
    </button>
  )
}

function DayList({ items, zone, onOpen, onAdd }: {
  items: CalendarItem[]; zone: string
  onOpen: (item: CalendarItem) => void
  onAdd: () => void
}) {
  const { t } = useI18n()
  const { nameOf } = useTeacherRoster()

  if (!items.length) {
    return (
      <EmptyState
        title={t('tch.calendar.emptyDay')}
        body={t('tch.calendar.emptyDayBody')}
        action={
          <button type="button" className="sp-btn sp-btn--sm" onClick={onAdd}>
            <Icon name="plus" size={15} aria-hidden />
            {t('tch.calendar.create')}
          </button>
        }
      />
    )
  }

  return (
    <ul className="tch-cal__day">
      {items.map((item) => {
        const who = item.learner_id ? nameOf(item.learner_id) ?? item.learner_id : null
        return (
          <li key={`${item.source}:${item.id}`}>
            <button type="button"
                    className={`tch-cal__row tch-cal__row--${item.source}`}
                    onClick={() => onOpen(item)}>
              <span className="tch-cal__when">
                {item.all_day ? t('tch.calendar.allDay') : timeIn(zone, item.at)}
              </span>
              <span className={`tch-cal__badge tch-cal__badge--${item.source}`}>
                <Icon name={iconFor(item)} size={16} aria-hidden />
              </span>
              <span className="tch-cal__what" dir="auto">
                <strong>{item.title || t(`tch.calendar.source.${item.source}`)}</strong>
                <span className="tch-cal__sub">
                  {t(`tch.calendar.source.${item.source}`)}
                  {who ? ` · ${who}` : ''}
                  {!who && item.learner_ids.length
                    ? ` · ${t('tch.calendar.reaches', { count: item.learner_ids.length })}`
                    : ''}
                </span>
              </span>
              <Icon name="chevronLeft" size={15} aria-hidden
                    className="tch-cal__rowGo" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** The whole point of clicking a row: what is this, when, and who does it
 *  reach — with the way back to the screen that owns it. */
function EventDetails({ item, zone, nameOf, onClose, onDeleted }: {
  item: CalendarItem
  zone: string
  nameOf: (learnerId: string) => string | null
  onClose: () => void
  onDeleted: () => void
}) {
  const { t, language } = useI18n()
  const [busy, setBusy] = useState(false)
  const description = String((item.meta?.description as string) ?? '')

  const when = useMemo(() => {
    const day = new Intl.DateTimeFormat(localeOf(language), {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(anchor(item.day))
    return item.all_day ? `${day} · ${t('tch.calendar.allDay')}`
      : `${day} · ${timeIn(zone, item.at)}`
  }, [item, zone, language, t])

  const names = item.learner_ids.map((id) => nameOf(id) ?? id)

  const remove = async () => {
    setBusy(true)
    await deleteCalendarEvent(item.id).catch(() => null)
    setBusy(false)
    onDeleted()
  }

  return (
    <Modal open onClose={onClose} titleId="tch-cal-detail" className="tch-cal__modal">
      <div className="tch-cal__detailHead">
        <span className={`tch-cal__badge tch-cal__badge--${item.source}`}>
          <Icon name={iconFor(item)} size={18} aria-hidden />
        </span>
        <div>
          <h2 id="tch-cal-detail" dir="auto">
            {item.title || t(`tch.calendar.source.${item.source}`)}
          </h2>
          <p className="tch-cal__detailKind">
            {t(`tch.calendar.source.${item.source}`)}
            {item.subject ? ` · ${item.subject}` : ''}
          </p>
        </div>
      </div>

      <dl className="tch-cal__detail">
        <dt>{t('tch.calendar.detail.when')}</dt>
        <dd dir="auto">{when}</dd>

        {item.learner_id ? (
          <>
            <dt>{t('tch.calendar.detail.student')}</dt>
            <dd dir="auto">{nameOf(item.learner_id) ?? item.learner_id}</dd>
          </>
        ) : null}

        {!item.learner_id && names.length ? (
          <>
            <dt>{t('tch.calendar.detail.reaches')}</dt>
            {/* Named, not counted: "6 students" is a number a teacher then has
                to go and look up. */}
            <dd dir="auto">{names.join(' · ')}</dd>
          </>
        ) : null}

        {description ? (
          <>
            <dt>{t('tch.calendar.detail.notes')}</dt>
            <dd dir="auto">{description}</dd>
          </>
        ) : null}
      </dl>

      <div className="tch-cal__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.calendar.close')}
        </button>
        {/* Only our own events are deletable here. A goal or a launch is edited
            where it lives — deleting one from a calendar view would be the
            duplication this feature exists to avoid. */}
        {item.source === 'event' ? (
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                  disabled={busy} onClick={() => void remove()}>
            <Icon name="trash" size={15} aria-hidden />
            {t('tch.calendar.delete')}
          </button>
        ) : null}
        {item.href ? (
          <button type="button" className="sp-btn sp-btn--sm"
                  onClick={() => navigate(item.href as string)}>
            {t('tch.calendar.open')}
          </button>
        ) : null}
      </div>
    </Modal>
  )
}

const KINDS: CalendarEventKind[] = ['lesson', 'reminder', 'test', 'event']

function ComposeEvent({ groupId, day, subgroups, students, onClose, onCreated }: {
  groupId: string
  day: string
  subgroups: Subgroup[]
  students: { learner_id: string; display_name: string | null }[]
  onClose: () => void
  onCreated: () => void
}) {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<CalendarEventKind>('lesson')
  const [allDay, setAllDay] = useState(true)
  const [date, setDate] = useState(day)
  const [time, setTime] = useState('09:00')
  const [target, setTarget] = useState(`group:${groupId}`)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const save = async () => {
    if (!title.trim()) return
    setSaving(true); setFailed(false)
    const [targetKind, targetId] = target.split(':')
    // An all-day event is sent day-shaped and a timed one as a full stamp —
    // the server refuses the mix, because storing an instant is exactly what
    // makes an all-day event slide a day in another timezone.
    const result = await createCalendarEvent(groupId, {
      title: title.trim(),
      kind,
      all_day: allDay,
      start_at: allDay ? date : `${date}T${time}:00`,
      targets: [{ kind: targetKind, id: targetId }],
    }).catch(() => null)
    setSaving(false)
    if (!result) { setFailed(true); return }
    onCreated()
  }

  return (
    <Modal open onClose={onClose} titleId="tch-cal-new" className="tch-cal__modal">
      <h2 id="tch-cal-new" dir="auto">{t('tch.calendar.create')}</h2>
      <div className="tch-cal__form">
        <label>
          <span>{t('tch.calendar.field.title')}</span>
          <input className="sp-input" value={title} dir="auto" autoFocus
                 onChange={(event) => setTitle(event.target.value)} />
        </label>

        <div className="tch-cal__kinds" role="group"
             aria-label={t('tch.calendar.field.kind')}>
          {KINDS.map((value) => (
            <button key={value} type="button"
                    className={`tch-cal__kind${kind === value ? ' is-on' : ''}`}
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}>
              <Icon name={ICONS[value]} size={16} aria-hidden />
              {t(`tch.calendar.kind.${value}`)}
            </button>
          ))}
        </div>

        <label>
          <span>{t('tch.calendar.field.who')}</span>
          <select className="sp-input" value={target}
                  onChange={(event) => setTarget(event.target.value)}>
            <option value={`group:${groupId}`}>{t('tch.calendar.scope.all')}</option>
            {subgroups.length ? (
              <optgroup label={t('tch.calendar.scope.subgroups')}>
                {subgroups.map((row) => (
                  <option key={row.id} value={`subgroup:${row.id}`}>{row.name}</option>
                ))}
              </optgroup>
            ) : null}
            {students.length ? (
              <optgroup label={t('tch.calendar.scope.students')}>
                {students.map((row) => (
                  <option key={row.learner_id} value={`learner:${row.learner_id}`}>
                    {row.display_name ?? row.learner_id}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>

        <div className="tch-cal__when2">
          <label>
            <span>{t('tch.calendar.field.date')}</span>
            <input className="sp-input" type="date" value={date}
                   onChange={(event) => setDate(event.target.value)} />
          </label>
          {!allDay ? (
            <label>
              <span>{t('tch.calendar.field.time')}</span>
              <input className="sp-input" type="time" value={time}
                     onChange={(event) => setTime(event.target.value)} />
            </label>
          ) : null}
        </div>

        <label className="tch-cal__check">
          <input type="checkbox" checked={allDay}
                 onChange={(event) => setAllDay(event.target.checked)} />
          <span>{t('tch.calendar.field.allDay')}</span>
        </label>

        {failed ? <p className="tch-cal__failed">{t('tch.error')}</p> : null}
      </div>
      <div className="tch-cal__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.subgroups.cancel')}
        </button>
        <button type="button" className="sp-btn sp-btn--sm"
                disabled={!title.trim() || saving} onClick={() => void save()}>
          {t('tch.calendar.save')}
        </button>
      </div>
    </Modal>
  )
}
