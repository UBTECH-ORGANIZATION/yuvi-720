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
 * The rows are aggregates of the same per-question data the student Activity
 * tab shows — counts only, never a ranking of children (MoE C5).
 */

import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  Card, EmptyState, ErrorState, Icon, Panel, SectionHeader, Skeleton, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  getGroupLearnings, type LearningRow, type LearningsView,
} from '../../../services/teacher'
import { EvidenceToggle } from '../shared/EvidenceDisclosure'
import { agoLabel } from '../live/LiveNow'
import './teacher-learnings.css'

export function ratePercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

export function rateTone(rate: number | null): 'success' | 'warn' | 'danger' | 'none' {
  if (rate === null) return 'none'
  if (rate < 0.5) return 'danger'
  if (rate < 0.7) return 'warn'
  return 'success'
}

/** "שאלה 3 · סעיף 2" when the catalogue knows, the raw id only as a last resort. */
export function questionLabel(
  question: { ordinal?: number | null; part?: number | null; question_id: string },
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!question.ordinal) return t('tch.learnings.question')
  const base = t('tch.learnings.questionN', { n: question.ordinal })
  return question.part ? `${base} · ${t('tch.learnings.partN', { n: question.part })}` : base
}

export function TeacherLearningsPage() {
  const { t, language } = useI18n()
  const { groupId, isLoading: scopeLoading } = useTeacherScope()

  const [view, setView] = useState<LearningsView | null>(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState<string | null>(null)
  const [onlyStarted, setOnlyStarted] = useState(false)

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

  const filtered = useMemo(() => {
    const rows = view?.learnings ?? []
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (subject && row.subject !== subject) return false
      if (onlyStarted && !row.started) return false
      if (!needle) return true
      return [row.title, row.unit_title, row.objective_title]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(needle))
    })
  }, [view, query, subject, onlyStarted])

  /* Grouped by unit, units ordered by whichever was worked most recently — a
     teacher scanning mid-term wants live material at the top, not alphabet. */
  const units = useMemo(() => {
    const byUnit = new Map<string, { title: string; rows: LearningRow[] }>()
    for (const row of filtered) {
      const key = row.unit_id ?? row.component_id
      const entry = byUnit.get(key)
        ?? { title: row.unit_title ?? row.title, rows: [] }
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
  }, [filtered])

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

  return (
    <div className="tch-learnings">
      <header className="tch-learnings__head">
        <h1>{t('tch.learnings.title')}</h1>
        <p className="tch-learnings__subtitle">{t('tch.learnings.subtitle')}</p>
      </header>

      {/* ── the class totals over everything they learned ─────────────────── */}
      <section className="tch-stats" aria-label={t('tch.kpi.stripLabel')}>
        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
            <Icon name="library" size={18} />
          </span>
          <span className="tch-stat__text">
            <strong className="tch-stat__value">
              {totals.learnings}<small>/{totals.catalog_total}</small>
            </strong>
            <span className="tch-stat__label">{t('tch.learnings.kpi.learnings')}</span>
            <span className="tch-stat__hint">
              {t('tch.learnings.kpi.activeOf', {
                active: totals.active_learners, total: totals.group_size,
              })}
            </span>
          </span>
        </Card>

        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--success" aria-hidden="true">
            <Icon name="check" size={18} />
          </span>
          <span className="tch-stat__text">
            <strong className="tch-stat__value">{ratePercent(totals.success_rate)}</strong>
            <span className="tch-stat__label">{t('tch.kpi.successRate')}</span>
            <span className="tch-stat__hint">
              {t('tch.kpi.successOf', { correct: totals.correct, attempts: totals.attempts })}
            </span>
          </span>
        </Card>

        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
            <Icon name="clock" size={18} />
          </span>
          <span className="tch-stat__text">
            {/* Wall-clock evidence or an honest dash — never a confident 0. */}
            <strong className="tch-stat__value">
              {totals.timing_available && totals.total_minutes !== null
                ? totals.total_minutes : '—'}
            </strong>
            <span className="tch-stat__label">{t('tch.learnings.kpi.classMinutes')}</span>
            <span className="tch-stat__hint">
              {totals.timing_available ? t('tch.kpi.acrossLearnings') : t('tch.pulse.noTiming')}
            </span>
          </span>
        </Card>

        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--warn" aria-hidden="true">
            <Icon name="lightbulb" size={18} />
          </span>
          <span className="tch-stat__text">
            <strong className="tch-stat__value">
              {view.learnings.reduce((sum, row) => sum + row.hints_used, 0)}
            </strong>
            <span className="tch-stat__label">{t('tch.learnings.kpi.hints')}</span>
            <span className="tch-stat__hint">{t('tch.learnings.kpi.hintsHint')}</span>
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
          {(view.subjects ?? []).map((entry) => (
            <button
              key={entry}
              type="button"
              className={`tch-chip${subject === entry ? ' is-on' : ''}`}
              aria-pressed={subject === entry}
              onClick={() => setSubject(entry)}
            >
              {t(`tch.subject.${entry}`)}
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

      {/* ── what to reinforce — the gaps engine's reading of this data ─────── */}
      {view.recommendations.length ? (
        <Panel className="tch-learnings__analysis" data-tour="teacher.learningsAnalysis">
          <SectionHeader
            title={t('tch.learnings.analysis')}
            subtitle={t('tch.learnings.analysisSub')}
          />
          <ul className="tch-learnings__recs">
            {view.recommendations.map((recommendation) => (
              <li key={`${recommendation.action}:${recommendation.objective_id}`}>
                <div className="tch-learnings__recRow">
                  <Icon name="wand" size={15} aria-hidden className="tch-learnings__recIcon" />
                  <span>
                    <strong dir="auto">{recommendation.text}</strong>
                    <span className="tch-learnings__recSep"> — </span>
                    <bdi dir="auto">{recommendation.label}</bdi>
                  </span>
                </div>
                <EvidenceToggle raw={recommendation.because.raw} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* ── the learnings themselves, grouped by unit ──────────────────────── */}
      {units.length ? (
        units.map((unit) => (
          <section key={unit.id} className="tch-learnings__unit">
            <h2 className="tch-learnings__unitTitle" dir="auto">
              <Icon name="library" size={15} aria-hidden />
              {unit.title}
              <span className="tch-learnings__unitCount">{unit.rows.length}</span>
            </h2>
            <div className="tch-learnings__grid">
              {unit.rows.map((row) => (
                <LearningCard key={row.component_id} row={row} groupId={groupId} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <EmptyState
          title={query ? t('tch.learnings.noMatches') : t('tch.learnings.empty')}
          body={query ? t('tch.learnings.noMatchesBody') : t('tch.learnings.emptyBody')}
        />
      )}
    </div>
  )
}

function LearningCard({ row, groupId }: { row: LearningRow; groupId: string }) {
  const { t } = useI18n()
  const tone = rateTone(row.success_rate)
  const open = () => navigate(
    `/teacher/learnings/${encodeURIComponent(groupId)}/${encodeURIComponent(row.component_id)}`)

  return (
    <Panel
      className={`tch-learning${row.struggling_count ? ' tch-learning--hot' : ''}${
        row.started ? '' : ' tch-learning--idle'}`}
    >
      <button type="button" className="tch-learning__open" onClick={open}>
        <div className="tch-learning__head">
          <div className="tch-learning__titles">
            <strong dir="auto">{row.title}</strong>
            <span className="tch-learning__meta" dir="auto">
              {[
                row.subject ? t(`tch.subject.${row.subject}`) : null,
                row.objective_title,
              ].filter(Boolean).join(' · ')}
            </span>
          </div>
          {row.is_assessment ? (
            <StatusPill tone="steady">{t('tch.learnings.assessment')}</StatusPill>
          ) : null}
        </div>
      </button>

      {row.started ? (
        <>
          {/* The success bar: the one number that decides whether this learning
              needs another pass, with its raw counters right beside it. */}
          <div className="tch-learning__rate">
            <span className={`tch-learning__ratePct is-${tone}`}>
              {ratePercent(row.success_rate)}
            </span>
            <span className="tch-learning__bar" role="presentation">
              <span
                className={`tch-learning__barFill is-${tone}`}
                style={{ inlineSize: `${Math.round((row.success_rate ?? 0) * 100)}%` }}
              />
            </span>
            <span className="tch-learning__rateOf">
              {t('tch.kpi.successOf', { correct: row.correct, attempts: row.attempts })}
            </span>
          </div>

          <dl className="tch-learning__facts">
            <div>
              <dt><Icon name="users" size={13} aria-hidden />{t('tch.learnings.fact.engaged')}</dt>
              <dd>{row.learners_engaged}/{row.group_size}</dd>
            </div>
            <div>
              <dt><Icon name="clock" size={13} aria-hidden />{t('tch.learnings.fact.avgMinutes')}</dt>
              <dd>
                {row.timing_available && row.avg_minutes_per_learner !== null
                  ? row.avg_minutes_per_learner : '—'}
              </dd>
            </div>
            <div>
              <dt><Icon name="lightbulb" size={13} aria-hidden />{t('tch.learnings.fact.hints')}</dt>
              <dd>{row.hints_used}</dd>
            </div>
            <div>
              <dt><Icon name="message" size={13} aria-hidden />{t('tch.learnings.fact.chat')}</dt>
              <dd>{row.chat_turns}</dd>
            </div>
          </dl>

          {row.struggling_count ? (
            <p className="tch-learning__struggling">
              <Icon name="alert" size={14} aria-hidden />
              {t('tch.learnings.struggling', { count: row.struggling_count })}
            </p>
          ) : null}

          {row.hard_questions.length ? (
            <div className="tch-learning__hard">
              <span className="tch-learning__hardTitle">{t('tch.learnings.hardQuestions')}</span>
              <ul>
                {row.hard_questions.map((question) => (
                  <li key={question.question_id}>
                    <StatusPill tone="support">{questionLabel(question, t)}</StatusPill>
                    <span className="tch-learning__hardFacts" dir="auto">
                      {question.screen_title ? `${question.screen_title} · ` : ''}
                      {t('tch.learnings.hardOf', {
                        percent: Math.round((question.success_rate ?? 0) * 100),
                        attempts: question.attempts,
                        learners: question.learners,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
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

      <footer className="tch-learning__foot">
        <span className="tch-learning__when">
          {row.started ? agoLabel(row.last_activity_at, t) : (
            row.estimated_minutes
              ? t('tch.learnings.estimated', { minutes: row.estimated_minutes })
              : ''
          )}
        </span>
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={open}>
          {t('tch.learnings.openDetail')}
          <Icon name="chevronLeft" size={13} aria-hidden />
        </button>
      </footer>
    </Panel>
  )
}
