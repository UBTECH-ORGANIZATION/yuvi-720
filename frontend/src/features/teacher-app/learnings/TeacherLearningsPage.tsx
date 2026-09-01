/* The learnings screen — the class picture per learning, not per student.
 *
 * Every other teacher surface answers "how is this child doing"; this one
 * answers "how did my MATERIAL do": which lesson carried the class, which one
 * burned the most minutes, which exact question kept coming back wrong.
 *
 * It is also the place a teacher goes to FIND material, so the catalogue is the
 * spine: every published learning has a row, including the ones nobody has
 * opened. Search narrows by name, the subject tabs narrow by lane, and the rows
 * group under their unit — because "מערכת צירים · הקנייה א" is how the content
 * is organised in a teacher's head, not a flat list of thirteen lesson names.
 *
 * Above those sections sits one pinned group: the learnings that went badly.
 * Curriculum order is the right order for browsing and the wrong one for the
 * question this screen is usually opened with, so the material that needs
 * another pass is lifted to the top — LEARNINGS ranked, never children (MoE C5;
 * the payload behind this screen carries no learner ids at all).
 *
 * The rows are aggregates of the same per-question data the student Activity
 * tab shows — counts only, never a ranking of children.
 */

import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  Card, EmptyState, ErrorState, Hint, Icon, Panel, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  getGroupLearnings, type LearningRow, type LearningsView,
} from '../../../services/teacher'
import { StatDelta } from '../home/StatDelta'
import { countKey } from '../shared/countLabel'
import { LearningPreviewDialog } from '../shared/LearningPreviewDialog'
import { delta } from '../shared/periodModel'
import { ObjectiveLine, ObjectiveRef } from '../shared/ObjectiveRef'
import { subjectLabel } from '../shared/subjectLabel'
import { agoLabel } from '../live/LiveNow'
import {
  byAttention, groupByObjective, learningName, needsAttention,
  objectiveGroupName, type ObjectiveGroup,
} from './learningRows'
import './teacher-learnings.css'

/** The bucket for rows whose unit the catalogue does not know. Not an id, so it
 *  can never collide with one. */
const NO_UNIT = '\u0000no-unit'

export function ratePercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

export function rateTone(rate: number | null): 'success' | 'warn' | 'danger' | 'none' {
  if (rate === null) return 'none'
  if (rate < 0.5) return 'danger'
  if (rate < 0.7) return 'warn'
  return 'success'
}

/** The question's TOPIC when one was generated (#455); otherwise the screen's
 *  own heading plus the content's part letter; never a bare number when a name
 *  exists. "שאלה N" survives only as the very last resort — a row the
 *  catalogue cannot place at all. */
export function questionLabel(
  question: {
    ordinal?: number | null; part?: number | null; question_id: string
    topic?: string | null; screen_title?: string
  },
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const part = question.part && question.part <= 6
    ? t(`tch.learnings.part.${question.part}`)
    : question.part ? t('tch.learnings.partN', { n: question.part }) : null
  if (question.topic) return part ? `${question.topic} · ${part}` : question.topic
  if (question.screen_title) {
    return part ? `${question.screen_title} · ${part}` : question.screen_title
  }
  if (!question.ordinal) return t('tch.learnings.question')
  const base = t('tch.learnings.questionN', { n: question.ordinal })
  return part ? `${base} · ${part}` : base
}

export function TeacherLearningsPage() {
  const { t, language } = useI18n()
  /* The subject chips below are not this screen's own state any more: they read
     and write the portal-wide scope, so arriving here with maths already set
     lights the maths chip, and picking one here keeps it on when the teacher
     moves to a profile. Two independent filters that looked identical was the
     confusing part, not the chips. */
  const {
    groupId, subject, setSubject, subjects, isLoading: scopeLoading,
  } = useTeacherScope()

  const [view, setView] = useState<LearningsView | null>(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [onlyStarted, setOnlyStarted] = useState(false)
  /* Which objective the teacher stepped into. The first glance is objective
     cards; opening one swaps the whole body for its lomdot, with the way back
     at the top. Route state, deliberately not a route: the way back must also
     survive nothing — leaving the page and returning starts at the map. */
  const [openObjective, setOpenObjective] = useState<string | null>(null)
  /* The first glance is only the objectives the class is actually working —
     the full catalogue is one click below, not on the screen by default. */
  const [showCatalog, setShowCatalog] = useState(false)
  /* One preview dialog for the whole page; each card only says which lomda. */
  const [preview, setPreview] = useState<{ id: string; title: string } | null>(null)

  useEffect(() => {
    if (!groupId) return
    let active = true
    setView(null)
    setError(false)
    // Unfiltered on purpose: subject narrowing is instant client-side, and the
    // catalogue is small enough that re-fetching per tab would be worse.
    getGroupLearnings(groupId, language)
      .then((result) => { if (active) setView(result) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [groupId, language])

  /* A different class or a different subject lane is a different map — an open
     objective from the old one must not keep the teacher trapped inside it,
     and the catalogue folds back down too. */
  useEffect(() => {
    setOpenObjective(null)
    setShowCatalog(false)
  }, [groupId, subject])

  const filtered = useMemo(() => {
    const rows = view?.learnings ?? []
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (subject && row.subject !== subject) return false
      if (onlyStarted && !row.started) return false
      if (!needle) return true
      // `component_id` is searchable too: it is the only name an off-catalogue
      // row has, so it is the only thing a teacher can search one by.
      return [row.title, row.unit_title, row.objective_title, row.component_id]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(needle))
    })
  }, [view, query, subject, onlyStarted])

  /* The map: one card per objective, grouped under subject headings. */
  const objectiveGroups = useMemo(() => groupByObjective(filtered), [filtered])

  const drill = useMemo(
    () => openObjective
      ? objectiveGroups.find((group) => group.key === openObjective) ?? null
      : null,
    [openObjective, objectiveGroups])

  const subjectSections = useMemo(() => {
    const bySubject = new Map<string, ObjectiveGroup<LearningRow>[]>()
    for (const group of objectiveGroups) {
      const key = group.subject ?? ''
      bySubject.set(key, [...(bySubject.get(key) ?? []), group])
    }
    /* The scope's own subject order first — the sections and the chips must
       tell the same story — then whatever the catalogue knows that the scope
       does not, the subject-less bucket last. */
    const known = subjects.filter((entry) => bySubject.has(entry))
    const extras = [...bySubject.keys()]
      .filter((entry) => entry && !known.includes(entry)).sort()
    const order = [...known, ...extras, ...(bySubject.has('') ? [''] : [])]
    return order.map((entry) => ({
      subject: entry || null,
      groups: bySubject.get(entry)!,
    }))
  }, [objectiveGroups, subjects])

  /* The first glance: the five objectives the class is actually living in.
     `groupByObjective` already orders trouble-first-then-recency, so the top
     of that order IS "most active". Everything else — including untouched
     material a teacher browses to assign next — waits under one fold. */
  const activeTop = useMemo(
    () => objectiveGroups.filter((group) => group.started > 0).slice(0, 5),
    [objectiveGroups])
  const catalogFolded = activeTop.length > 0
    && activeTop.length < objectiveGroups.length

  /* Inside an objective — or under a search, which cuts across objectives —
     the body is lomda cards: the pinned went-badly group, then unit sections. */
  const searching = query.trim() !== ''
  const visibleRows = drill ? drill.rows : filtered

  /* The pinned group: material that went badly, worst first.
     Ranking LEARNINGS is not ranking children — the rows are class-wide counts
     and the payload behind this screen carries no learner ids at all (MoE C5).
     These rows are LIFTED out of their unit sections rather than copied into a
     second list: the same card twice, a screen apart, is the duplication this
     dashboard already removed once from the KPI strip. */
  const attention = useMemo(
    () => byAttention(visibleRows.filter(needsAttention)), [visibleRows])

  /* Everything else grouped by unit, units ordered by whichever was worked most
     recently — a teacher scanning mid-term wants live material at the top, not
     alphabet. */
  const units = useMemo(() => {
    const pinned = new Set(attention.map((row) => row.component_id))
    const byUnit = new Map<string, { title: string | null; rows: LearningRow[] }>()
    for (const row of visibleRows) {
      if (pinned.has(row.component_id)) continue
      // One bucket for everything the catalogue could not place, rather than a
      // section per orphan headed by its own component id.
      const key = row.unit_id ?? NO_UNIT
      const entry = byUnit.get(key) ?? { title: row.unit_title ?? null, rows: [] }
      entry.rows.push(row)
      byUnit.set(key, entry)
    }
    return [...byUnit.entries()]
      .map(([id, entry]) => ({
        id,
        title: entry.title,
        rows: [...entry.rows].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
        lastAt: entry.rows.reduce<string>(
          (latest, row) => (row.last_activity_at ?? '') > latest ? row.last_activity_at! : latest, ''),
      }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
  }, [visibleRows, attention])

  /* Same frame while loading: the real title, the real search box and the real
     toggle — only the four KPI values and the cards below them are placeholders,
     so the toolbar does not jump down the page when the catalogue arrives. */
  if (scopeLoading || (view === null && !error)) {
    return (
      <div className="tch-learnings" aria-busy="true">
        <header className="tch-learnings__head">
          <h1>{t('tch.learnings.title')}</h1>
          <p className="tch-learnings__subtitle">{t('tch.learnings.subtitle')}</p>
        </header>
        <section className="tch-stats" aria-label={t('tch.kpi.stripLabel')}>
          {[0, 1, 2, 3].map((index) => <SkeletonCard key={index} rows={1} />)}
        </section>
        <div className="tch-learnings__toolbar">
          <label className="tch-learnings__search">
            <Icon name="search" size={15} aria-hidden />
            <input
              type="search"
              value={query}
              dir="auto"
              placeholder={t('tch.learnings.searchPlaceholder')}
              aria-label={t('tch.learnings.searchPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="tch-learnings__filters">
            <button type="button" className="tch-chip is-on" disabled>
              {t('tch.scope.allSubjects')}
            </button>
          </div>
        </div>
        <div className="tch-learnings__grid">
          {[0, 1, 2, 3].map((index) => <SkeletonCard key={index} rows={2} />)}
        </div>
      </div>
    )
  }
  if (error || !view) return <ErrorState title={t('tch.error')} />
  if (!groupId) return <EmptyState title={t('tch.noGroups')} />

  const totals = view.totals
  /* The strip's news: a trailing week vs the week before, both from the same
     payload. `pulse` is optional in the type only for a stale client cache —
     without it the values fall to zero and the chips simply do not render. */
  const week = view.pulse?.current
  const lastWeek = view.pulse?.previous
  const comparedTo = t('tch.stat.comparedTo', { when: t('tch.period.prevBare.week') })
  const successNow = week?.success_rate != null
    ? Math.round(week.success_rate * 100) : null
  const successBefore = lastWeek?.success_rate != null
    ? Math.round(lastWeek.success_rate * 100) : null

  return (
    <div className="tch-learnings">
      <header className="tch-learnings__head">
        <h1>{t('tch.learnings.title')}</h1>
        <p className="tch-learnings__subtitle">{t('tch.learnings.subtitle')}</p>
      </header>

      {drill ? (
        /* ── inside one objective: the way back, then a hero naming it ────── */
        <section className="tch-learnings__drillHead">
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--sm"
            onClick={() => setOpenObjective(null)}
          >
            <Icon name="chevronLeft" size={15} aria-hidden />
            {t('tch.learnings.backToObjectives')}
          </button>
          <Panel className="tch-learnings__drillCard">
            <div className="tch-learnings__drillTitles">
              {/* The title IS the "what does this objective mean" door — one
                  name, clickable, instead of a heading with the same words
                  repeated as a link under it. */}
              <h2 dir="auto">
                {drill.objectiveId ? (
                  <ObjectiveRef
                    objectiveId={drill.objectiveId}
                    fallback={objectiveGroupName(drill) ?? undefined}
                    className="tch-learnings__drillRef"
                  />
                ) : (objectiveGroupName(drill) ?? t('tch.learnings.noObjective'))}
              </h2>
              <p className="tch-learnings__drillMeta" dir="auto">
                {[
                  subjectLabel(drill.subject, t),
                  t(countKey('tch.learnings.lomdot', drill.rows.length),
                    { count: drill.rows.length }),
                  drill.started
                    ? t('tch.learnings.objStarted', {
                        started: drill.started, total: drill.rows.length })
                    : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            {drill.started ? (
              <div className={`tch-learnings__drillRate is-${rateTone(drill.successRate)}`}>
                <strong dir="ltr">{ratePercent(drill.successRate)}</strong>
                <span>{t('tch.kpi.successOf', {
                  correct: drill.correct, attempts: drill.attempts })}</span>
              </div>
            ) : (
              <p className="tch-learning__idle">
                <Icon name="clock" size={14} aria-hidden />
                {t('tch.learnings.objIdle')}
              </p>
            )}
          </Panel>
        </section>
      ) : (
        <>
      {/* ── the week's news, each figure against the week before it ─────────
             All four are the SAME trailing week (the home dashboard's default
             period), so the strip answers "how is the material doing right
             now" — the all-time totals live on in the catalogue coverage
             hint and the cards below. Label first: with a comparison chip
             attached, value-then-label reads backwards (see the home strip). */}
      <section className="tch-stats" aria-label={t('tch.kpi.stripLabel')}>
        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
            <Icon name="library" size={18} />
          </span>
          <span className="tch-stat__text">
            <span className="tch-stat__label">{t('tch.learnings.kpi.weekLearnings')}</span>
            <span className="tch-stat__line">
              <strong className="tch-stat__value">{week?.learnings_active ?? 0}</strong>
              <StatDelta
                delta={delta(week?.learnings_active, lastWeek?.learnings_active)}
                label={t('tch.learnings.kpi.weekLearnings')}
                when={comparedTo}
              />
            </span>
            <span className="tch-stat__hint">
              {t('tch.learnings.kpi.ofCatalog', { total: totals.catalog_total })}
            </span>
          </span>
        </Card>

        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--success" aria-hidden="true">
            <Icon name="check" size={18} />
          </span>
          <span className="tch-stat__text">
            <span className="tch-stat__label">{t('tch.kpi.successRate')}</span>
            <span className="tch-stat__line">
              <strong className="tch-stat__value">
                {successNow !== null ? `${successNow}%` : '—'}
              </strong>
              {/* Percentage-point delta — a rate's honest unit; "+246%" on a
                  metric capped at 100 reads as a bug (see periodModel). */}
              <StatDelta
                delta={delta(successNow, successBefore, 'points')}
                label={t('tch.kpi.successRate')}
                when={comparedTo}
              />
            </span>
            <span className="tch-stat__hint">
              {t('tch.kpi.successOf', {
                correct: week?.correct ?? 0, attempts: week?.attempts ?? 0 })}
            </span>
          </span>
        </Card>

        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
            <Icon name="clock" size={18} />
          </span>
          <span className="tch-stat__text">
            <span className="tch-stat__label">{t('tch.learnings.kpi.classMinutes')}</span>
            <span className="tch-stat__line">
              {/* Wall-clock evidence or an honest dash — never a confident 0.
                  No timing in EITHER window → delta gets nulls and says
                  nothing. */}
              <strong className="tch-stat__value">
                {week?.timing_available && week.total_minutes !== null
                  ? week.total_minutes : '—'}
              </strong>
              <StatDelta
                delta={delta(
                  week?.timing_available ? week.total_minutes : null,
                  lastWeek?.timing_available ? lastWeek.total_minutes : null)}
                label={t('tch.learnings.kpi.classMinutes')}
                when={comparedTo}
              />
            </span>
            <span className="tch-stat__hint">
              {week?.timing_available ? t('tch.kpi.acrossLearnings') : t('tch.pulse.noTiming')}
            </span>
          </span>
        </Card>

        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
            <Icon name="users" size={18} />
          </span>
          <span className="tch-stat__text">
            <span className="tch-stat__label">{t('tch.learnings.kpi.activeLearners')}</span>
            <span className="tch-stat__line">
              <strong className="tch-stat__value">{week?.active_learners ?? 0}</strong>
              <StatDelta
                delta={delta(week?.active_learners, lastWeek?.active_learners)}
                label={t('tch.learnings.kpi.activeLearners')}
                when={comparedTo}
              />
            </span>
            <span className="tch-stat__hint">
              {t('tch.learnings.kpi.ofClass', { total: totals.group_size })}
            </span>
          </span>
        </Card>
      </section>

      {/* ── find it ───────────────────────────────────────────────────────── */}
      <div className="tch-learnings__toolbar" data-tour="teacher.learningsFilters">
        <label className="tch-learnings__search">
          <Icon name="search" size={15} aria-hidden />
          <input
            type="search"
            value={query}
            dir="auto"
            placeholder={t('tch.learnings.searchPlaceholder')}
            aria-label={t('tch.learnings.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="tch-learnings__filters" role="group" aria-label={t('tch.scope.subject')}>
          <button
            type="button"
            className={`tch-chip${subject === null ? ' is-on' : ''}`}
            aria-pressed={subject === null}
            onClick={() => setSubject(null)}
          >
            {t('tch.scope.allSubjects')}
          </button>
          {/* From scope, not from `view.subjects`: the chips and the bar must
              offer the same list, or a subject set in one is unreachable in the
              other. Both are folded from the same rows server-side. */}
          {subjects.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`tch-chip${subject === entry ? ' is-on' : ''}`}
              aria-pressed={subject === entry}
              onClick={() => setSubject(entry)}
            >
              {subjectLabel(entry, t)}
            </button>
          ))}
          <span className="tch-learnings__filterSep" aria-hidden="true" />
          <button
            type="button"
            className={`tch-chip${onlyStarted ? ' is-on' : ''}`}
            aria-pressed={onlyStarted}
            onClick={() => setOnlyStarted((value) => !value)}
          >
            {t('tch.learnings.onlyStarted')}
          </button>
        </div>
      </div>
        </>
      )}

      {/* ── the objectives map: the first glance, unless the teacher stepped
             into one or a search cuts across them.

             Live material first and ONLY, then the whole catalogue behind one
             fold — the same rule the student track uses: one decision per
             screen, not the whole curriculum at once. When nothing has
             started yet the catalogue IS the content, so it shows unfolded. */}
      {!drill && !searching ? (
        objectiveGroups.length ? (
          <>
            {activeTop.length ? (
              <section className="tch-learnings__unit">
                <h2 className="tch-learnings__unitTitle" dir="auto">
                  <Icon name="target" size={15} aria-hidden />
                  {t('tch.learnings.activeObjectives')}
                  <span className="tch-learnings__unitCount">{activeTop.length}</span>
                </h2>
                <div className="tch-learnings__grid">
                  {activeTop.map((group) => (
                    <ObjectiveCard
                      key={group.key}
                      group={group}
                      showSubject={!subject}
                      onOpen={() => setOpenObjective(group.key)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {catalogFolded ? (
              <button
                type="button"
                className="tch-learnings__catalogToggle"
                aria-expanded={showCatalog}
                onClick={() => setShowCatalog((value) => !value)}
              >
                <Icon name="library" size={15} aria-hidden />
                {t('tch.learnings.allObjectives')}
                <span className="tch-learnings__unitCount">{objectiveGroups.length}</span>
                <Icon name={showCatalog ? 'chevronUp' : 'chevronDown'}
                      size={15} aria-hidden />
              </button>
            ) : null}

            {!activeTop.length || (catalogFolded && showCatalog) ? (
              /* Skipped while the active five ARE the whole map — the same
                 five cards again under a heading is not a catalogue. */
              subjectSections.map((section) => (
                <section key={section.subject ?? 'none'} className="tch-learnings__unit">
                  <h2 className="tch-learnings__unitTitle" dir="auto">
                    <Icon name="library" size={15} aria-hidden />
                    {section.subject
                      ? subjectLabel(section.subject, t)
                      : t('tch.learnings.noSubject')}
                    <span className="tch-learnings__unitCount">{section.groups.length}</span>
                  </h2>
                  <div className="tch-learnings__grid">
                    {section.groups.map((group) => (
                      <ObjectiveCard
                        key={group.key}
                        group={group}
                        onOpen={() => setOpenObjective(group.key)}
                      />
                    ))}
                  </div>
                </section>
              ))
            ) : null}
          </>
        ) : (
          <EmptyState
            title={t('tch.learnings.empty')}
            body={t('tch.learnings.emptyBody')}
          />
        )
      ) : null}

      {/* ── what went badly, ahead of the curriculum order ─────────────────── */}
      {(drill || searching) && attention.length ? (
        <section className="tch-learnings__unit tch-learnings__unit--attention">
          <h2 className="tch-learnings__unitTitle" dir="auto">
            <Icon name="alert" size={15} aria-hidden />
            {t('tch.learnings.attention')}
            <span className="tch-learnings__unitCount">{attention.length}</span>
          </h2>
          <p className="tch-learnings__unitNote">{t('tch.learnings.attentionSub')}</p>
          <div className="tch-learnings__grid">
            {attention.map((row) => (
              <LearningCard key={row.component_id} row={row} groupId={groupId}
                            onPreview={setPreview} showObjective={!drill} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ── the rest, in curriculum order, grouped by unit ─────────────────── */}
      {drill || searching ? (
        units.length || attention.length ? (
          units.map((unit) => (
            <section key={unit.id} className="tch-learnings__unit">
              <h2 className="tch-learnings__unitTitle" dir="auto">
                <Icon name="library" size={15} aria-hidden />
                {unit.title ?? t('tch.learnings.noUnit')}
                <span className="tch-learnings__unitCount">{unit.rows.length}</span>
              </h2>
              <div className="tch-learnings__grid">
                {unit.rows.map((row) => (
                  <LearningCard key={row.component_id} row={row} groupId={groupId}
                                onPreview={setPreview} showObjective={!drill} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <EmptyState
            title={t('tch.learnings.noMatches')}
            body={t('tch.learnings.noMatchesBody')}
          />
        )
      ) : null}

      <LearningPreviewDialog
        componentId={preview?.id ?? null}
        title={preview?.title}
        onClose={() => setPreview(null)}
      />
    </div>
  )
}

/** One learning objective, folded over its lomdot — the map's card.
 *
 *  The student track's goal-card grammar on purpose (state badge, name, one
 *  meta line, a progress meter): a teacher flipping between their own view and
 *  a child's should meet the same object. The meter is the class success rate
 *  in the card's tone — the number says it once, the bar makes it scannable
 *  across a row of five; the `correct/attempts` evidence moved to its title.
 */
function ObjectiveCard({ group, showSubject = false, onOpen }: {
  group: ObjectiveGroup<LearningRow>
  /** In the mixed most-active row the subject is not given by a heading. */
  showSubject?: boolean
  onOpen: () => void
}) {
  const { t } = useI18n()
  const tone = rateTone(group.successRate)
  const state = group.attention ? 'hot' : group.started ? 'active' : 'idle'
  const title = objectiveGroupName(group)
  const percent = group.successRate === null
    ? 0 : Math.round(group.successRate * 100)

  return (
    <Panel className={`tch-objective is-${state}`}>
      <button type="button" className="tch-objective__open" onClick={onOpen}>
        <span className="tch-objective__head">
          <span className="tch-objective__state" aria-hidden="true">
            <Icon name={state === 'hot' ? 'alert' : state === 'active' ? 'pulse' : 'target'}
                  size={17} />
          </span>
          <strong className="tch-objective__title" dir="auto">
            {title ?? t('tch.learnings.noObjective')}
          </strong>
          {group.started ? (
            /* The number wears its own name — "63%" alone read as anything
               (progress? coverage?). The word is tiny and the evidence
               (correct/attempts) stays on hover. */
            <span
              className="tch-objective__rateWrap"
              title={t('tch.kpi.successOf', {
                correct: group.correct, attempts: group.attempts })}
            >
              <strong className={`tch-objective__rate is-${tone}`} dir="ltr">
                {ratePercent(group.successRate)}
              </strong>
              <span className="tch-objective__rateWord">
                {t('tch.learnings.rateWord')}
              </span>
            </span>
          ) : null}
        </span>

        {group.started ? (
          <span
            className={`tch-objective__meter is-${tone}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t('tch.kpi.successRate')}
          >
            <span style={{ inlineSize: `${percent}%` }} />
          </span>
        ) : null}

        <span className="tch-objective__meta" dir="auto">
          {[
            showSubject ? subjectLabel(group.subject, t) : null,
            t(countKey('tch.learnings.lomdot', group.rows.length),
              { count: group.rows.length }),
            group.started
              ? agoLabel(group.lastAt, t)
              : t('tch.learnings.idleShort'),
          ].filter(Boolean).join(' · ')}
        </span>

        {group.attention ? (
          <span className="tch-objective__flag">
            <Icon name="alert" size={13} aria-hidden />
            {t(countKey('tch.learnings.objAttention', group.attention),
               { count: group.attention })}
          </span>
        ) : null}
      </button>
    </Panel>
  )
}

function LearningCard({ row, groupId, onPreview, showObjective = true }: {
  row: LearningRow
  groupId: string
  onPreview: (target: { id: string; title: string }) => void
  /** False inside an objective drill-down, where the hero above the grid
   *  already names the objective — repeating it on every card is noise. */
  showObjective?: boolean
}) {
  const { t } = useI18n()
  const tone = rateTone(row.success_rate)
  const name = learningName(row)
  const open = () => navigate(
    `/teacher/learnings/${encodeURIComponent(groupId)}/${encodeURIComponent(row.component_id)}`)

  return (
    <Panel
      className={`tch-learning${row.struggling_count ? ' tch-learning--hot' : ''}${
        row.started ? '' : ' tch-learning--idle'}`}
    >
      {/* The teacher's own window into this lomda — OUTSIDE the card's open
          button (a button inside a button is not a thing a browser honours),
          pinned to the far corner by CSS. */}
      <button
        type="button"
        className="sp-btn sp-btn--ghost sp-btn--sm tch-learning__preview"
        onClick={() => onPreview({ id: row.component_id, title: name.title })}
        aria-label={t('tch.learnings.preview')}
      >
        <Icon name="play" size={14} aria-hidden />
      </button>
      <div className="tch-learning__head">
        {/* The open button stretches over the whole card via CSS (::after
            overlay) — the card *is* the click target, and the preview,
            objective and pill sit above the overlay as siblings, because a
            button inside a button is not a thing a browser honours. */}
        <button type="button" className="tch-learning__open" onClick={open}>
          <div className="tch-learning__titles">
            {/* A row the catalogue never named has only its id, and the teacher
                still has to tell five of them apart — so the id is shown, but
                as an identifier and not dressed up as a name. */}
            <strong dir="auto" className={name.named ? undefined : 'tch-learning__idTitle'}>
              {name.title}
            </strong>
            <span className="tch-learning__meta" dir="auto">
              {[
                subjectLabel(row.subject, t),
                name.named ? null : t('tch.learnings.unnamed'),
                // Not repeated when it is already the title above.
                name.rawId,
              ].filter(Boolean).join(' · ')}
            </span>
          </div>
        </button>
        {row.is_assessment ? (
          <Hint text={t('tch.learnings.assessmentHint')}
                className="tch-learning__assessment">
            <StatusPill tone="steady">{t('tch.learnings.assessment')}</StatusPill>
          </Hint>
        ) : null}
      </div>

      {/* The objective this lesson serves, as a button rather than as text —
          OUTSIDE the card's own open button, because a button inside a button
          is not a thing a browser will honour. It used to be the tail of the
          meta line: a name with no way to ask what it means. */}
      {showObjective && name.title !== row.objective_title ? (
        <ObjectiveLine
          objectiveId={row.objective_id}
          fallback={row.objective_title ?? undefined}
        />
      ) : null}

      {/* Two lines, and a flag when it needs one.
          The card used to say the success rate three ways — a percentage, a bar
          filled to that percentage, and `correct/attempts` — then four icon
          facts, a struggling line, a list of hard questions, and a footer button
          to the same route the whole card already opens. Everything a teacher
          reads to *decide whether to look* is here; everything they read once
          they have decided is on the detail page, which has room for it. */}
      {row.started ? (
        <div className="tch-learning__lines">
          <p className={`tch-learning__line tch-learning__line--rate is-${tone}`}>
            <strong>{ratePercent(row.success_rate)}</strong>
            <span>{t('tch.kpi.successOf', { correct: row.correct, attempts: row.attempts })}</span>
          </p>
          <p className="tch-learning__line">
            {t('tch.learnings.engagedOf', {
              engaged: row.learners_engaged, total: row.group_size,
            })}
            {row.timing_available && row.avg_minutes_per_learner !== null
              ? ` · ${t('tch.learnings.avgMinutesShort', {
                  minutes: row.avg_minutes_per_learner })}`
              : ''}
          </p>
          {row.struggling_count ? (
            <p className="tch-learning__struggling">
              <Icon name="alert" size={14} aria-hidden />
              {/* `t()` has no plural engine, so a shared {count} key renders
                  "1 students are struggling" — the same defect the chat's six
                  keys carried, on the screen those six were fixed for. */}
              {t(countKey('tch.learnings.struggling', row.struggling_count),
                 { count: row.struggling_count })}
            </p>
          ) : null}
        </div>
      ) : (
        /* Not started is information, not an empty state: it is how a teacher
           finds what to assign next. */
        <p className="tch-learning__idle">
          <Icon name="clock" size={14} aria-hidden />
          {t('tch.learnings.notStarted', {
            screens: row.screens_total, questions: row.questions_total,
          })}
        </p>
      )}

      {/* One click target. The footer button went to the same place the card
          header already links to. */}
      <p className="tch-learning__when">
        {row.started ? agoLabel(row.last_activity_at, t) : (
          row.estimated_minutes
            ? t('tch.learnings.estimated', { minutes: row.estimated_minutes })
            : ''
        )}
      </p>
    </Panel>
  )
}
