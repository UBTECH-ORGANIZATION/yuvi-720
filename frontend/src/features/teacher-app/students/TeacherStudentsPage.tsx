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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  Card, EmptyState, ErrorState, Icon, Skeleton, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useAuth } from '../../../providers/AuthProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import { useTeacherLive } from '../../../providers/TeacherLiveProvider'
import { formatMessageTime } from '../../../hooks/messageTime'
import { PresenceDot, agoLabel } from '../live/LiveNow'
import {
  createSubgroup, deleteSubgroup, getGroupSnapshot, listSubgroups, updateSubgroup,
  type GroupInsight, type Subgroup,
} from '../../../services/teacher'
import { withFallback } from '../shared/EvidenceDisclosure'
import {
  COLUMN_KEYS, DEFAULT_COLUMNS, OPTIONAL_COLUMNS, RosterTable, type ColumnKey,
} from './RosterTable'
import {
  INACTIVE_THRESHOLDS, NO_FILTERS, countByStatus, filterRows, sortRows,
  toRosterRows, type PresenceFilter, type RosterFilters, type SortKey, type StatusFilter,
} from './rosterModel'
import './teacher-students.css'
import { StudentAvatar } from '../shared/StudentAvatar'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { SubgroupBar } from './SubgroupBar'
import { SubgroupDialog } from './SubgroupDialog'
import { useDismiss } from '../shared/useDismiss'

type View = 'table' | 'cards'

/** Exported for the contract test: every filter the assistant can deep-link to
 *  has to land somewhere here, or the button silently opens the whole class. */
export const STATUS_CHIPS: StatusFilter[] = ['all', 'attention', 'not_started', 'active']

/** What `?filter=inactive` means when the link does not say.
 *  Matches `data_tools.DEFAULT_INACTIVE_DAYS`, so the set the assistant
 *  resolved and the set the roster shows are the same people. */
const LINKED_INACTIVE_DAYS = 7

/** Read once, on mount. The page remounts on navigation, so this is where a
 *  deep link from the dashboard's "בשיעור עכשיו" card lands.
 *
 *  `inactive` is deliberately not a status chip. Inactivity cuts across all
 *  three statuses — a flagged learner is usually also inactive, and both are
 *  true — so the roster expresses it as its own `minDaysInactive` control.
 *  What was missing was only the bridge: the assistant could offer
 *  `?filter=inactive`, no chip matched it, and the teacher landed on the
 *  unfiltered class wondering what the button had done. */
function initialQuery(): {
  view: View | null; live: boolean
  status: StatusFilter | null; minDaysInactive: number | null
} {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view')
  const filter = params.get('filter')
  return {
    view: view === 'table' || view === 'cards' ? view : null,
    live: view === 'live',
    status: STATUS_CHIPS.includes(filter as StatusFilter) ? (filter as StatusFilter) : null,
    minDaysInactive: filter === 'inactive' ? LINKED_INACTIVE_DAYS : null,
  }
}

export function TeacherStudentsPage() {
  const { t, language } = useI18n()
  const { user, updatePreferences } = useAuth()
  const { groupId, isLoading: scopeLoading } = useTeacherScope()
  const live = useTeacherLive()
  const [snapshot, setSnapshot] = useState<GroupInsight | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const [entry] = useState(initialQuery)
  const [filters, setFilters] = useState<RosterFilters>(
    () => ({
      ...NO_FILTERS,
      status: entry.status ?? 'all',
      minDaysInactive: entry.minDaysInactive,
    })
  )
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>(
    { key: 'name', direction: 'asc' }
  )
  const [showMore, setShowMore] = useState(false)
  const [subgroups, setSubgroups] = useState<Subgroup[]>([])
  const [activeSubgroup, setActiveSubgroup] = useState<string | null>(null)
  /* One dialog for creating and for amending, and one for the confirmation.
     There is no longer a "picking mode" on the roster: choosing who is in a
     group used to turn the table into a checkbox grid, which took away the
     columns a teacher picks ON. `null` here means "closed"; `editing: null`
     inside it means "creating". */
  const [composing, setComposing] = useState<{ editing: Subgroup | null } | null>(null)
  const [deleting, setDeleting] = useState<Subgroup | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickError, setPickError] = useState('')
  const moreRef = useRef<HTMLDivElement | null>(null)
  // The panel sits over the table header; left open, the first click on a
  // column to sort it lands in the menu instead.
  useDismiss(moreRef, showMore, useCallback(() => setShowMore(false), []))

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
    getGroupSnapshot(groupId, language)
      .then((result) => { if (active) setSnapshot(result) })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [groupId, language])

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

  /* Counted against every filter EXCEPT the status chip itself — which is what
     makes the number a preview of pressing it. Counting the raw rows (the old
     behaviour) let a chip read "(5)" and then produce an empty table, because
     search and presence had already excluded all five. */
  const counts = useMemo(
    () => countByStatus(filterRows(rows, { ...filters, status: 'all' })),
    [rows, filters]
  )

  /* Everyone the teacher is currently looking at — the class, or the sub-group
     they selected. A sub-group is a scope, and the four numbers above the table
     have to describe the same people the table does: "0 דורשים תשומת לב" over a
     roster showing two flagged children in "קשויי הבנה" is the card contradicting
     the list underneath it. */
  const inScope = useMemo(
    () => filterRows(rows, { ...NO_FILTERS, subgroup: filters.subgroup }),
    [rows, filters.subgroup]
  )

  const kpis = useMemo(() => ({
    inLesson: inScope.filter((row) => live.presence[row.learner_id]?.status === 'in_lesson').length,
    attention: inScope.filter((row) => row.status === 'attention').length,
    notStarted: inScope.filter((row) => row.status === 'not_started').length,
    // "Engaged this week" is the complement of a week's silence, which is the
    // same threshold the roster's own `daysInactive` column reports.
    activeWeek: inScope.filter((row) => row.daysInactive !== null && row.daysInactive < 7).length,
  }), [inScope, live.presence])

  /* A sub-group is a SCOPE, like the class picker — not a filter. It survives
     every reset below, or a teacher who narrowed to "קבוצת חיזוק" and then
     pressed a KPI would be silently looking at the whole class again. */
  const scoped = (next: Partial<RosterFilters>): RosterFilters =>
    ({ ...NO_FILTERS, subgroup: filters.subgroup, ...next })

  /** A KPI is a saved filter: pressing it puts the teacher in that list. */
  function applyPreset(preset: 'online' | 'attention' | 'not_started') {
    setFilters(preset === 'online' ? scoped({ presence: 'online' }) : scoped({ status: preset }))
  }

  /** The filters that are on beyond the chips, named, for the empty state. */
  const activeFilters = useMemo(() => {
    const active: string[] = []
    if (filters.query.trim()) active.push(t('tch.students.searchLabel'))
    if (filters.status !== 'all') {
      active.push(t(`tch.students.filter.${CHIP_KEY[filters.status]}`))
    }
    if (filters.presence !== 'all') active.push(t(`tch.students.presence.${filters.presence}`))
    if (filters.minDaysInactive !== null) {
      active.push(t('tch.students.inactiveAtLeast', { days: filters.minDaysInactive }))
    }
    return active
  }, [filters, t])

  const extraCount = (filters.presence !== 'all' ? 1 : 0)
    + (filters.minDaysInactive !== null ? 1 : 0)

  /* ── sub-groups ───────────────────────────────────────────────────────────
     Membership arrives resolved: the server compares the stored ids against the
     live class on every read, so this never has to reconcile a learner who
     transferred out. */
  useEffect(() => {
    if (!groupId) { setSubgroups([]); return }
    let active = true
    listSubgroups(groupId)
      .then((result) => { if (active) setSubgroups(result.subgroups ?? []) })
      // A class with no named slices is the normal case, and a failed read must
      // not take the roster down with it.
      .catch(() => { if (active) setSubgroups([]) })
    return () => { active = false }
  }, [groupId])

  function selectSubgroup(subgroupId: string | null) {
    setActiveSubgroup(subgroupId)
    const chosen = subgroups.find((row) => row.id === subgroupId)
    setFilters((current) => ({ ...current, subgroup: chosen ? chosen.learner_ids : null }))
  }

  async function saveSubgroup(draft: { name: string; learnerIds: string[] }) {
    if (!groupId || !draft.learnerIds.length || saving) return
    const editing = composing?.editing ?? null
    /* An unnamed group still needs a name to be referred to by — on a task's
       launch dialog, in the messages rail, in a goal's audience. So one is
       derived rather than demanded: the teacher's question is "who", and being
       stopped to answer "what shall we call them" is a toll gate in front of it. */
    const name = draft.name || t('tch.subgroups.defaultName', { count: draft.learnerIds.length })
    setSaving(true)
    setPickError('')
    try {
      if (editing) {
        const saved = await updateSubgroup(editing.id, {
          name, learner_ids: draft.learnerIds,
        })
        setSubgroups((current) => current.map((row) => (row.id === saved.id ? saved : row)))
        if (activeSubgroup === saved.id) {
          setFilters((current) => ({ ...current, subgroup: saved.learner_ids }))
        }
      } else {
        const created = await createSubgroup(groupId, name, draft.learnerIds)
        setSubgroups((current) => [...current, created]
          .sort((a, b) => a.name.localeCompare(b.name)))
        // Land the teacher inside what they just made — otherwise the only
        // sign anything happened is a new card they have to notice.
        setActiveSubgroup(created.id)
        setFilters((current) => ({ ...current, subgroup: created.learner_ids }))
      }
      setComposing(null)
    } catch (error) {
      // The server refuses a duplicate name and a learner outside the class;
      // both are the teacher's to fix, so both are shown rather than swallowed.
      const code = (error as { message?: string })?.message ?? ''
      setPickError(t(`tch.subgroups.error.${code}`) === `tch.subgroups.error.${code}`
        ? t('tch.subgroups.error.generic') : t(`tch.subgroups.error.${code}`))
    } finally {
      setSaving(false)
    }
  }

  async function removeSubgroup(subgroup: Subgroup) {
    setDeleting(null)
    try {
      await deleteSubgroup(subgroup.id)
      setSubgroups((current) => current.filter((row) => row.id !== subgroup.id))
      if (activeSubgroup === subgroup.id) selectSubgroup(null)
    } catch { /* still listed; the next read will tell the truth */ }
  }

  /** Which named slices each learner belongs to — a learner may be in several. */
  const subgroupsOf = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const subgroup of subgroups) {
      for (const learnerId of subgroup.learner_ids) {
        map.set(learnerId, [...(map.get(learnerId) ?? []), subgroup.name])
      }
    }
    return map
  }, [subgroups])

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
        {/* The subtitle was a caption; it is the scope control now. Everything
            below — the KPIs, the chips, the table — describes whatever is
            selected here, so it leads rather than annotates. */}
        <SubgroupBar
          total={rows.length}
          subgroups={subgroups}
          selected={activeSubgroup}
          nameOf={(learnerId) =>
            rows.find((row) => row.learner_id === learnerId)?.name ?? learnerId}
          onSelect={selectSubgroup}
          onEdit={(subgroup) => { setPickError(''); setComposing({ editing: subgroup }) }}
          onDelete={setDeleting}
          onCreate={() => { setPickError(''); setComposing({ editing: null }) }}
          busy={busy}
        />
      </header>

      {/* Choosing WHO happens in a dialog, over the roster rather than instead
          of it. As a mode on the table it replaced the status and last-seen
          columns with checkboxes — taking away the very columns a teacher picks
          a group ON. */}
      <SubgroupDialog
        open={composing !== null}
        editing={composing?.editing ?? null}
        roster={rows.map((row) => ({ id: row.learner_id, name: row.name }))}
        busy={saving}
        error={pickError}
        onClose={() => { setComposing(null); setPickError('') }}
        onSave={(draft) => void saveSubgroup(draft)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={t('tch.subgroups.confirmDelete', { name: deleting?.name ?? '' })}
        body={t('tch.subgroups.confirmDeleteBody')}
        confirmLabel={t('tch.subgroups.delete')}
        destructive
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && void removeSubgroup(deleting)}
      />

      {/* The numbers the teacher reads before scanning any row. Same
          `.tch-stats` language as Home and the learnings screen, so "the top of
          a teacher screen is four numbers" is one idea rather than four. */}
      <section className="tch-stats" aria-label={t('tch.pulse.title')}>
        <Card
          interactive
          className={`tch-stat${kpis.inLesson ? ' tch-stat--live' : ''}`}
          role="link"
          tabIndex={0}
          data-tour="teacher.liveNow"
          onClick={() => applyPreset('online')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); applyPreset('online')
            }
          }}
        >
          <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
            <Icon name="pulse" size={18} />
          </span>
          <span className="tch-stat__text">
            <strong className="tch-stat__value">{busy ? '—' : kpis.inLesson}</strong>
            <span className="tch-stat__label">{t('tch.kpi.inLessonNow')}</span>
            <span className="tch-stat__hint">{t('tch.students.kpi.inLessonHint')}</span>
          </span>
        </Card>

        <Card
          interactive
          className={`tch-stat${kpis.attention ? ' tch-stat--alert' : ''}`}
          role="link"
          tabIndex={0}
          onClick={() => applyPreset('attention')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); applyPreset('attention')
            }
          }}
        >
          <span className={`tch-stat__icon ${kpis.attention
            ? 'tch-stat__icon--danger' : 'tch-stat__icon--success'}`} aria-hidden="true">
            <Icon name={kpis.attention ? 'alert' : 'check'} size={18} />
          </span>
          <span className="tch-stat__text">
            <strong className="tch-stat__value">{busy ? '—' : kpis.attention}</strong>
            <span className="tch-stat__label">{t('tch.kpi.needsAttention')}</span>
            <span className="tch-stat__hint">
              {kpis.attention ? t('tch.students.kpi.attentionHint') : t('tch.attention.none')}
            </span>
          </span>
        </Card>

        <Card
          interactive
          className="tch-stat"
          role="link"
          tabIndex={0}
          onClick={() => applyPreset('not_started')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); applyPreset('not_started')
            }
          }}
        >
          <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
            <Icon name="clock" size={18} />
          </span>
          <span className="tch-stat__text">
            <strong className="tch-stat__value">{busy ? '—' : kpis.notStarted}</strong>
            <span className="tch-stat__label">{t('tch.students.filter.notStarted')}</span>
            <span className="tch-stat__hint">{t('tch.students.kpi.notStartedHint')}</span>
          </span>
        </Card>

        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
            <Icon name="users" size={18} />
          </span>
          <span className="tch-stat__text">
            <strong className="tch-stat__value">{busy ? '—' : kpis.activeWeek}</strong>
            <span className="tch-stat__label">{t('tch.students.kpi.activeWeek')}</span>
            <span className="tch-stat__hint">
              {/* "of N students in the class" stops being true the moment the
                  scope is a sub-group, and the count beside it is the thing
                  that makes the sentence checkable. */}
              {t(filters.subgroup
                ? 'tch.students.kpi.activeWeekHint.subgroup'
                : 'tch.students.kpi.activeWeekHint', { total: inScope.length })}
            </span>
          </span>
        </Card>
      </section>

      {/* Three controls, not seven. Presence, days-inactive and the column
          chooser were four more things to read before the list; they are now
          behind "עוד", which says how many of them are on. */}
      <div className="tch-roster__controls" data-tour="teacher.rosterFilters">
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
              {/* Counted against everything else that is on. The old count came
                  from the unfiltered rows, so a chip could read (5) and then
                  show an empty table. */}
              {!busy && value !== 'all' ? ` (${counts[value]})` : ''}
            </button>
          ))}
        </div>

        <div className="tch-roster__tools">
          <div className="tch-roster__more" ref={moreRef}>
            <button
              type="button"
              className={`sp-btn sp-btn--pill sp-btn--sm${showMore ? ' is-active' : ''}`}
              aria-expanded={showMore}
              onClick={() => setShowMore((open) => !open)}
            >
              <Icon name="filter" size={14} aria-hidden />
              {t('tch.students.more')}
              {extraCount ? ` (${extraCount})` : ''}
            </button>
            {showMore ? (
              <div className="tch-roster__moreMenu" role="group" aria-label={t('tch.students.more')}>
                <label className="tch-roster__moreRow">
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
                <label className="tch-roster__moreRow">
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
                      <option key={days} value={days}>
                        {t('tch.students.inactiveAtLeast', { days })}
                      </option>
                    ))}
                  </select>
                </label>
                {view === 'table' ? (
                  <div className="tch-roster__moreRow tch-roster__moreRow--stack">
                    <span>{t('tch.students.columns')}</span>
                    <div className="tch-roster__columnMenu">
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
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

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

      {busy ? (
        <div className="tch-roster__grid">
          {Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} rows={2} />)}
        </div>
      ) : !visible.length ? (
        /* Naming what is on, and offering to undo it. One "no matches" for four
           independent filters leaves the teacher hunting for which one did it. */
        <EmptyState
          title={t('tch.students.noneMatch')}
          body={activeFilters.length
            ? t('tch.students.noneMatchWith', { filters: activeFilters.join(' · ') })
            : undefined}
          action={activeFilters.length ? (
            <button type="button" className="sp-btn sp-btn--sm"
                    onClick={() => setFilters(scoped({}))}>
              {t('tch.students.clearFilters')}
            </button>
          ) : undefined}
        />
      ) : view === 'table' ? (
        <RosterTable
          rows={visible}
          columns={columns}
          presence={live.presence}
          sort={sort}
          onSort={toggleSort}
          subgroupsOf={subgroupsOf}
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
                  <StudentAvatar learnerId={row.learner_id} name={row.name} size={38} />
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
                {/* Which named slices this child is in. The table has had this
                    column since sub-groups shipped; the cards had nothing, so
                    switching view lost the one piece of information that says
                    the groups a teacher drew still exist. */}
                {subgroupsOf.get(row.learner_id)?.length ? (
                  <p className="tch-studentCard__subgroups">
                    {subgroupsOf.get(row.learner_id)!.map((name) => (
                      <span key={name} className="tch-roster__subgroupTag" dir="auto">{name}</span>
                    ))}
                  </p>
                ) : null}
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
