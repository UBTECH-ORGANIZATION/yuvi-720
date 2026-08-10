/* Roster (F6). Filterable list of the teacher's own students.
 *
 * Two views over one model. The table is the default because a card wall stops
 * being scannable at about fifteen students and a class of thirty is unusable in
 * it; cards remain for teachers who read faces rather than rows.
 *
 * Rows carry the student's own state only — never a rank, a score comparison or
 * an implied ordering against classmates. The default order is alphabetical,
 * deliberately, so nothing reads as a leaderboard, and sorting a column is an
 * explicit act by the teacher rather than a judgement by the product.
 *
 * The status pill has three values, not two. "No flag fired" used to render as
 * "מתקדם/ת", which meant a child who had never once logged in was reported to
 * their teacher as progressing. `status` now comes from the insights engine
 * (attention / not_started / active) and every pill states the datum underneath.
 *
 * "בכיתה עכשיו" lives here rather than on the dashboard: who is present right
 * now is a question about the class list, and on Home it competed with the
 * attention inbox for the same glance.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  Card, EmptyState, ErrorState, Icon, Skeleton, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useAuth } from '../../../providers/AuthProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import { useTeacherLive } from '../../../providers/TeacherLiveProvider'
import { formatMessageTime } from '../../../hooks/messageTime'
import { LiveNowStrip, PresenceDot, agoLabel } from '../live/LiveNow'
import { getGroupSnapshot, type GroupInsight } from '../../../services/teacher'
import { withFallback } from '../shared/EvidenceDisclosure'
import {
  COLUMN_KEYS, DEFAULT_COLUMNS, OPTIONAL_COLUMNS, RosterTable, type ColumnKey,
} from './RosterTable'
import {
  INACTIVE_THRESHOLDS, NO_FILTERS, countByStatus, filterRows, sortRows,
  toRosterRows, type PresenceFilter, type RosterFilters, type SortKey, type StatusFilter,
} from './rosterModel'
import './teacher-students.css'

type View = 'table' | 'cards'

const STATUS_CHIPS: StatusFilter[] = ['all', 'attention', 'not_started', 'active']

/** Read once, on mount. The page remounts on navigation, so this is where a
 *  deep link from the dashboard's "בשיעור עכשיו" card lands. */
function initialQuery(): { view: View | null; live: boolean; status: StatusFilter | null } {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view')
  const status = params.get('filter')
  return {
    view: view === 'table' || view === 'cards' ? view : null,
    live: view === 'live',
    status: STATUS_CHIPS.includes(status as StatusFilter) ? (status as StatusFilter) : null,
  }
}

export function TeacherStudentsPage() {
  const { t, language } = useI18n()
  const { user, updatePreferences } = useAuth()
  const { groupId, subject, isLoading: scopeLoading } = useTeacherScope()
  const live = useTeacherLive()
  const [snapshot, setSnapshot] = useState<GroupInsight | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const [entry] = useState(initialQuery)
  const [filters, setFilters] = useState<RosterFilters>(
    () => ({ ...NO_FILTERS, status: entry.status ?? 'all' })
  )
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>(
    { key: 'name', direction: 'asc' }
  )
  const [showColumns, setShowColumns] = useState(false)
  const liveRef = useRef<HTMLDivElement | null>(null)

  /* View and columns are user preferences, not browser state: a teacher who
     chose cards keeps them on the classroom machine too. The URL still wins for
     one navigation, so a deep link can force a view without rewriting what the
     teacher picked. */
  const savedView = (user?.preferences?.teacher_roster_view as View | undefined) ?? 'table'
  const [view, setView] = useState<View>(entry.view ?? savedView)
  const savedColumns = user?.preferences?.teacher_roster_columns ?? []
  const columns: ColumnKey[] = savedColumns.length
    ? (savedColumns.filter((key: string) => COLUMN_KEYS.includes(key as ColumnKey)) as ColumnKey[])
    : DEFAULT_COLUMNS

  useEffect(() => {
    if (!groupId) { setIsLoading(false); return }
    let active = true
    setIsLoading(true)
    setError(false)
    getGroupSnapshot(groupId, language, subject ?? undefined)
      .then((result) => { if (active) setSnapshot(result) })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [groupId, subject, language])

  // Arriving from the dashboard's live KPI: put the strip where the eye is.
  useEffect(() => {
    if (!entry.live || isLoading) return
    liveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [entry.live, isLoading])

  function chooseView(next: View) {
    setView(next)
    void updatePreferences({ teacher_roster_view: next }).catch(() => {})
  }

  function toggleColumn(key: ColumnKey) {
    const next = columns.includes(key)
      ? columns.filter((column) => column !== key)
      : [...COLUMN_KEYS].filter((column) => columns.includes(column) || column === key)
    void updatePreferences({ teacher_roster_columns: next }).catch(() => {})
  }

  function toggleSort(key: SortKey) {
    setSort((current) => (
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    ))
  }

  const rows = useMemo(
    () => toRosterRows(snapshot?.students ?? [], {
      isOnline: (id) => (live.presence[id]?.status ?? 'offline') !== 'offline',
      formatDate: (iso) => formatMessageTime(iso, language),
      neverLabel: t('tch.live.neverSeen'),
    }),
    [snapshot, live.presence, language, t]
  )
  const visible = useMemo(
    () => sortRows(filterRows(rows, filters), sort.key, sort.direction),
    [rows, filters, sort]
  )
  const counts = useMemo(() => countByStatus(rows), [rows])

  // Presence arrives keyed by learner; the strip wants the group's full roster
  // so the absent are visible too, and the snapshot is what knows who that is.
  const liveRows = useMemo(
    () => (snapshot?.students ?? []).map((student) => live.presence[student.learner_id] ?? {
      learner_id: student.learner_id, status: 'offline' as const, connections: 0,
      component_id: null, unit_id: null, objective_id: null, session_id: null,
      last_seen_at: null, lesson_entered_at: null, struggling: null,
      help_requested_at: null,
    }),
    [snapshot, live.presence]
  )
  const nameFor = (learnerId: string) =>
    rows.find((row) => row.learner_id === learnerId)?.name ?? learnerId

  if (error) return <ErrorState title={t('tch.error')} />
  if (!scopeLoading && !isLoading && !groupId) return <EmptyState title={t('tch.noGroups')} />

  const busy = scopeLoading || isLoading

  return (
    <div className="tch-roster" aria-busy={busy || undefined}>
      {/* The title and the controls do not depend on the fetch, so they are
          painted immediately and only the rows below them are a skeleton — the
          page stops jumping a row down when the data lands. */}
      <header className="tch-roster__head">
        <h1>{t('tch.students.title')}</h1>
        <p className="tch-roster__subtitle">
          {busy ? <Skeleton w={120} h={14} />
            : t('tch.students.subtitle', { count: rows.length })}
        </p>
      </header>

      <div className="tch-roster__live" ref={liveRef}>
        {busy ? <SkeletonCard rows={3} /> : (
          <LiveNowStrip
            presence={liveRows}
            nameFor={nameFor}
            isConnected={live.isConnected}
            onOpen={(learnerId) => navigate(`/teacher/student/${learnerId}`)}
          />
        )}
      </div>

      <div className="tch-roster__controls" data-tour="teacher.rosterFilters">
        <div className="tch-roster__filters" role="group" aria-label={t('tch.students.filterLabel')}>
          {STATUS_CHIPS.map((value) => (
            <button
              key={value}
              type="button"
              className={`sp-btn sp-btn--pill sp-btn--sm ${filters.status === value ? 'is-active' : ''}`}
              aria-pressed={filters.status === value}
              onClick={() => setFilters((current) => ({ ...current, status: value }))}
            >
              {t(`tch.students.filter.${CHIP_KEY[value]}`)}
              {!busy && value !== 'all' ? ` (${counts[value]})` : ''}
            </button>
          ))}
        </div>

        <div className="tch-roster__tools">
          <label className="tch-roster__search">
            <Icon name="search" size={15} aria-hidden="true" />
            <span className="sp-sr-only">{t('tch.students.searchLabel')}</span>
            <input
              className="sp-input sp-input--pill"
              type="search"
              value={filters.query}
              placeholder={t('tch.students.searchPlaceholder')}
              onChange={(event) =>
                setFilters((current) => ({ ...current, query: event.target.value }))}
            />
          </label>

          {view === 'table' ? (
            <div className="tch-roster__columns">
              <button
                type="button"
                className={`sp-btn sp-btn--pill sp-btn--sm${showColumns ? ' is-active' : ''}`}
                aria-expanded={showColumns}
                onClick={() => setShowColumns((open) => !open)}
              >
                <Icon name="filter" size={14} aria-hidden />
                {t('tch.students.columns')}
              </button>
              {showColumns ? (
                <div className="tch-roster__columnMenu" role="group"
                     aria-label={t('tch.students.columns')}>
                  {OPTIONAL_COLUMNS.map((key) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={columns.includes(key)}
                        onChange={() => toggleColumn(key)}
                      />
                      {t(`tch.students.col.${key}`)}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="tch-roster__views" role="group" aria-label={t('tch.students.viewLabel')}>
            {(['table', 'cards'] as View[]).map((value) => (
              <button
                key={value}
                type="button"
                className={`sp-btn sp-btn--pill sp-btn--sm${view === value ? ' is-active' : ''}`}
                aria-pressed={view === value}
                title={t(`tch.students.view.${value}`)}
                aria-label={t(`tch.students.view.${value}`)}
                onClick={() => chooseView(value)}
              >
                <Icon name={value === 'table' ? 'document' : 'library'} size={14} aria-hidden />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Column filters sit under the chips rather than inside the header cells:
          a <th> that is both a sort button and a select is a keyboard trap, and
          these apply to the card view too. */}
      <div className="tch-roster__colFilters">
        <label>
          <span>{t('tch.students.col.presence')}</span>
          <select
            className="sp-input sp-input--pill"
            value={filters.presence}
            onChange={(event) => setFilters((current) => ({
              ...current, presence: event.target.value as PresenceFilter,
            }))}
          >
            <option value="all">{t('tch.students.filter.any')}</option>
            <option value="online">{t('tch.students.presence.online')}</option>
            <option value="offline">{t('tch.students.presence.offline')}</option>
          </select>
        </label>
        <label>
          <span>{t('tch.students.col.daysInactive')}</span>
          <select
            className="sp-input sp-input--pill"
            value={filters.minDaysInactive ?? ''}
            onChange={(event) => setFilters((current) => ({
              ...current,
              minDaysInactive: event.target.value ? Number(event.target.value) : null,
            }))}
          >
            <option value="">{t('tch.students.filter.any')}</option>
            {INACTIVE_THRESHOLDS.map((days) => (
              <option key={days} value={days}>{t('tch.students.inactiveAtLeast', { days })}</option>
            ))}
          </select>
        </label>
      </div>

      {busy ? (
        <div className="tch-roster__grid">
          {Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} rows={2} />)}
        </div>
      ) : !visible.length ? (
        <EmptyState title={t('tch.students.noneMatch')} />
      ) : view === 'table' ? (
        <RosterTable
          rows={visible}
          columns={columns}
          presence={live.presence}
          sort={sort}
          onSort={toggleSort}
        />
      ) : (
        <ul className="tch-roster__grid">
          {visible.map((row) => (
            <li key={row.learner_id}>
              <Card
                interactive
                className={`tch-studentCard ${row.status === 'attention' ? 'is-flagged' : ''}${
                  row.status === 'not_started' ? ' is-idle' : ''}`}
                onClick={() => navigate(`/teacher/student/${row.learner_id}`)}
              >
                <div className="tch-studentCard__head">
                  <span className="tch-studentCard__avatar" aria-hidden="true">
                    {row.name.slice(0, 1)}
                  </span>
                  <strong dir="auto">{row.name}</strong>
                  {/* Dot + "last seen", never the dot alone: a dropped socket
                      is not a child leaving, so the timestamp is what makes
                      the indicator honest. */}
                  <span className="tch-studentCard__presence">
                    <PresenceDot presence={live.presence[row.learner_id]} />
                    <span className="tch-studentCard__seen">
                      {agoLabel(live.presence[row.learner_id]?.last_seen_at ?? null, t)}
                    </span>
                  </span>
                </div>
                {/* Every pill states what it is derived from. "Progressing"
                    with nothing under it was the claim we could not back. */}
                <StatusPill tone={row.status === 'attention' ? 'steady'
                  : row.status === 'not_started' ? 'neutral' : 'strong'}>
                  {row.status === 'attention' && row.attentionKind
                    ? withFallback(
                        t(`tch.attention.kind.${row.attentionKind}`),
                        `tch.attention.kind.${row.attentionKind}`,
                        row.attentionReason ?? '',
                      )
                    : t(row.status === 'not_started'
                        ? 'tch.students.notStarted' : 'tch.students.active')}
                </StatusPill>
                <p className="tch-studentCard__evidence" dir="auto">
                  {row.status === 'attention' ? row.attentionEvidence
                    : row.status === 'not_started' ? t('tch.students.notStartedHint')
                      : row.daysInactive === null ? t('tch.students.activeHint')
                        : row.daysInactive <= 0 ? t('tch.students.activeHint.today')
                          : t('tch.students.activeHint.days', { days: row.daysInactive })}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* The chips predate the model's status names and their locale keys are already
   translated in three languages — map rather than rename. */
const CHIP_KEY: Record<StatusFilter, string> = {
  all: 'all', attention: 'attention', not_started: 'notStarted', active: 'active',
}
