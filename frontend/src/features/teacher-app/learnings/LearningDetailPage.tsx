/* One learning, opened up.
 *
 * The listing answers "which lesson needs another pass". This answers the next
 * question a teacher always asks: *what exactly* went wrong inside it — which
 * question, on which screen, how long they sat on it, how much help they took.
 *
 * Three views of the same evidence, because teachers read this three ways:
 *   the spine   — the lesson in its own order, screens included, so the shape
 *                 on this page matches the shape the class saw;
 *   per question — sorted hardest first, with time and support beside success;
 *   the charts   — success and time per question, so an outlier is visible
 *                 before it is read.
 *
 * Counts only, never a ranking of children (MoE C5) — the payload behind this
 * screen carries no learner ids at all.
 */

import { useEffect, useState } from 'react'
import { navigate } from '../../../app/router'
import { BarSeries } from '../../../components/charts'
import {
  Card, EmptyState, ErrorState, Icon, Panel, SectionHeader, Skeleton, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import {
  getLearningDetail, type HardQuestion, type LearningDetail,
} from '../../../services/teacher'
import { ObjectiveLine } from '../shared/ObjectiveRef'
import { subjectLabel } from '../shared/subjectLabel'
import { learningName } from './learningRows'
import { questionLabel, ratePercent, rateTone } from './TeacherLearningsPage'
import './teacher-learnings.css'

const SCREEN_ICON: Record<string, string> = {
  question: 'help',
  watch: 'play',
  read: 'book',
  step: 'chevronLeft',
}

export function LearningDetailPage({ groupId, componentId }: {
  groupId: string
  componentId: string
}) {
  const { t, language, direction } = useI18n()
  const [view, setView] = useState<LearningDetail | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    setView(null)
    setError(false)
    getLearningDetail(groupId, componentId, language)
      .then((result) => { if (active) setView(result) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [groupId, componentId, language])

  if (view === null && !error) {
    return (
      <div className="tch-learningDetail" aria-busy="true">
        {/* The way back is not something to wait for. */}
        <header className="tch-learningDetail__head">
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--sm"
            onClick={() => navigate('/teacher/learnings')}
          >
            <Icon name="chevronLeft" size={15} aria-hidden />
            {t('tch.learnings.backToList')}
          </button>
          <div className="tch-learningDetail__titles">
            <h1><Skeleton w={280} h={24} /></h1>
            <p className="tch-learningDetail__meta"><Skeleton w={200} h={13} /></p>
          </div>
        </header>
        <section className="tch-stats" aria-label={t('tch.kpi.stripLabel')}>
          {[0, 1, 2, 3].map((index) => <SkeletonCard key={index} rows={1} />)}
        </section>
        <div style={{ display: 'grid', gap: 'var(--sp-3)', marginBlockStart: 'var(--sp-4)' }}>
          <SkeletonCard rows={4} />
          <SkeletonCard rows={4} />
        </div>
      </div>
    )
  }
  if (error || !view) return <ErrorState title={t('tch.error')} />

  const learning = view.learning
  const name = learningName(learning)
  const questions = view.questions
  // Hardest first: the reason a teacher opened this page.
  const ranked = [...questions].sort(
    (a, b) => (a.success_rate ?? 1) - (b.success_rate ?? 1) || b.attempts - a.attempts)
  const timed = questions.filter((row) => row.avg_seconds)

  return (
    <div className="tch-learningDetail">
      <header className="tch-learningDetail__head">
        <button
          type="button"
          className="sp-btn sp-btn--ghost sp-btn--sm"
          onClick={() => navigate('/teacher/learnings')}
        >
          <Icon name="chevronLeft" size={15} aria-hidden />
          {t('tch.learnings.backToList')}
        </button>
        <div className="tch-learningDetail__titles">
          {/* Same naming rule as the card that opened this page, so the two
              agree — including the untitled case, where the id is shown as an
              id rather than in the slot a name belongs in. */}
          <h1 dir="auto" className={name.named ? undefined : 'tch-learning__idTitle'}>
            {name.title}
          </h1>
          <p className="tch-learningDetail__meta" dir="auto">
            {[
              subjectLabel(learning.subject, t),
              name.named ? null : t('tch.learnings.unnamed'),
              name.rawId,
              learning.unit_title,
            ].filter(Boolean).join(' · ')}
          </p>
          {/* The objective, openable. This page reports how the lesson went;
              the goal it serves — and what that goal asks a child to be able
              to do — was a name at the end of a meta line. */}
          {name.title !== learning.objective_title ? (
            <ObjectiveLine
              objectiveId={learning.objective_id}
              fallback={learning.objective_title ?? undefined}
            />
          ) : null}
        </div>
      </header>

      {/* ── the numbers for this one lesson ────────────────────────────────── */}
      <section className="tch-stats" aria-label={t('tch.kpi.stripLabel')}>
        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--success" aria-hidden="true">
            <Icon name="check" size={18} />
          </span>
          <span className="tch-stat__text">
            <strong className="tch-stat__value">{ratePercent(learning.success_rate)}</strong>
            <span className="tch-stat__label">{t('tch.kpi.successRate')}</span>
            <span className="tch-stat__hint">
              {t('tch.kpi.successOf', { correct: learning.correct, attempts: learning.attempts })}
            </span>
          </span>
        </Card>

        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
            <Icon name="users" size={18} />
          </span>
          <span className="tch-stat__text">
            <strong className="tch-stat__value">
              {learning.learners_engaged}<small>/{learning.group_size}</small>
            </strong>
            <span className="tch-stat__label">{t('tch.learnings.fact.engaged')}</span>
            <span className="tch-stat__hint">
              {t('tch.learnings.screensAndQuestions', {
                screens: learning.screens_total, questions: learning.questions_total,
              })}
            </span>
          </span>
        </Card>

        <Card className="tch-stat">
          <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
            <Icon name="clock" size={18} />
          </span>
          <span className="tch-stat__text">
            <strong className="tch-stat__value">
              {learning.timing_available && learning.avg_minutes_per_learner !== null
                ? learning.avg_minutes_per_learner : '—'}
            </strong>
            <span className="tch-stat__label">{t('tch.learnings.fact.avgMinutes')}</span>
            <span className="tch-stat__hint">
              {learning.estimated_minutes
                ? t('tch.learnings.estimated', { minutes: learning.estimated_minutes })
                : t('tch.pulse.noTiming')}
            </span>
          </span>
        </Card>

        <Card className={`tch-stat${learning.struggling_count ? ' tch-stat--alert' : ''}`}>
          <span
            className={`tch-stat__icon ${
              learning.struggling_count ? 'tch-stat__icon--danger' : 'tch-stat__icon--success'}`}
            aria-hidden="true"
          >
            <Icon name={learning.struggling_count ? 'alert' : 'check'} size={18} />
          </span>
          <span className="tch-stat__text">
            <strong className="tch-stat__value">{learning.struggling_count}</strong>
            <span className="tch-stat__label">{t('tch.learnings.strugglingShort')}</span>
            <span className="tch-stat__hint">
              {t('tch.learnings.supportUsed', {
                hints: learning.hints_used, chats: learning.chat_turns,
              })}
            </span>
          </span>
        </Card>
      </section>

      {!learning.started ? (
        <EmptyState
          title={t('tch.learnings.notStartedTitle')}
          body={t('tch.learnings.notStarted', {
            screens: learning.screens_total, questions: learning.questions_total,
          })}
        />
      ) : (
        <>
          {/* ── charts: success and time, per question ────────────────────── */}
          <div className="tch-learningDetail__charts">
            <Panel className="tch-learningDetail__chart">
              <SectionHeader
                title={t('tch.learnings.chart.success')}
                subtitle={t('tch.learnings.chart.successSub')}
              />
              <BarSeries
                ariaLabel={t('tch.learnings.chart.success')}
                rows={ranked.slice(0, 8).map((question) => ({
                  label: questionLabel(question, t),
                  value: Math.round((question.success_rate ?? 0) * 100),
                  max: 100,
                  tone: rateTone(question.success_rate) === 'danger' ? 'danger'
                    : rateTone(question.success_rate) === 'warn' ? 'warn' : 'primary',
                }))}
                formatValue={(value) => `${value}%`}
              />
            </Panel>

            <Panel className="tch-learningDetail__chart">
              <SectionHeader
                title={t('tch.learnings.chart.time')}
                subtitle={t('tch.learnings.chart.timeSub')}
              />
              {timed.length ? (
                <BarSeries
                  ariaLabel={t('tch.learnings.chart.time')}
                  rows={[...timed]
                    .sort((a, b) => (b.avg_seconds ?? 0) - (a.avg_seconds ?? 0))
                    .slice(0, 8)
                    .map((question) => ({
                      label: questionLabel(question, t),
                      value: question.avg_seconds ?? 0,
                      tone: 'primary' as const,
                    }))}
                  formatValue={(value) => t('tch.learnings.seconds', { n: value })}
                />
              ) : (
                <p className="tch-learningDetail__noTiming">{t('tch.pulse.noTiming')}</p>
              )}
            </Panel>
          </div>

          {/* ── every question, hardest first ─────────────────────────────── */}
          <Panel className="tch-learningDetail__questions">
            <SectionHeader
              title={t('tch.learnings.questionTable')}
              subtitle={t('tch.learnings.questionTableSub')}
            />
            <div className="tch-tableWrap">
              <table className="tch-table">
                <thead>
                  <tr>
                    <th>{t('tch.activity.question')}</th>
                    <th>{t('tch.learnings.col.screen')}</th>
                    <th>{t('tch.kpi.successRate')}</th>
                    <th>{t('tch.activity.attempts')}</th>
                    <th>{t('tch.learnings.col.learners')}</th>
                    <th>{t('tch.learnings.col.avgTime')}</th>
                    <th>{t('tch.activity.hints')}</th>
                    <th>{t('tch.activity.chat')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((question) => (
                    <QuestionRow key={`${question.item_id}:${question.question_id}`} question={question} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── the lesson's own shape ────────────────────────────────────── */}
          <Panel className="tch-learningDetail__spine">
            <SectionHeader
              title={t('tch.learnings.spine')}
              subtitle={t('tch.learnings.spineSub')}
            />
            <ol className="tch-spine">
              {view.screens.map((screen, index) => (
                <li key={screen.item_id} className={`tch-spine__row is-${screen.kind}`}>
                  <span className="tch-spine__index">{index + 1}</span>
                  <span className="tch-spine__icon" aria-hidden="true">
                    <Icon name={SCREEN_ICON[screen.kind] ?? 'chevronLeft'} size={14} />
                  </span>
                  <span className="tch-spine__title" dir="auto">
                    {screen.title || t(`tch.learnings.screenKind.${screen.kind}`)}
                    <small>{t(`tch.learnings.screenKind.${screen.kind}`)}</small>
                  </span>
                  {screen.attempts ? (
                    <span className={`tch-spine__rate is-${rateTone(screen.success_rate)}`}>
                      {ratePercent(screen.success_rate)}
                    </span>
                  ) : (
                    <span className="tch-spine__rate is-none">
                      {screen.question_count ? t('tch.learnings.noAnswersYet') : '—'}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </Panel>
        </>
      )}
      {/* Direction is used by the table's numeric columns via CSS only. */}
      <span hidden data-direction={direction} />
    </div>
  )
}

function QuestionRow({ question }: { question: HardQuestion }) {
  const { t } = useI18n()
  const tone = rateTone(question.success_rate)
  return (
    <tr>
      <td>
        <StatusPill tone={tone === 'danger' ? 'support' : tone === 'warn' ? 'steady' : 'neutral'}>
          {questionLabel(question, t)}
        </StatusPill>
      </td>
      <td dir="auto">{question.screen_title || '—'}</td>
      <td className={`tch-table__rate is-${tone}`}>{ratePercent(question.success_rate)}</td>
      <td>{question.attempts}</td>
      <td>{question.learners}</td>
      <td>{question.avg_seconds ? t('tch.learnings.seconds', { n: question.avg_seconds }) : '—'}</td>
      <td>{question.hints_used ?? 0}</td>
      <td>{question.chat_turns ?? 0}</td>
    </tr>
  )
}
