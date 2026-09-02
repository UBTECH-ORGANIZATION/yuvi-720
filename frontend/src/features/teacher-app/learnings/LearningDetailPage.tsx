/* One learning, opened up.
 *
 * The listing answers "which lesson needs another pass". This answers the next
 * question a teacher always asks: *what exactly* went wrong inside it — which
 * question, how long they sat on it, how much help they took — and what to DO
 * about it: the difficulties card names the hard questions, the children who
 * tried them and never got them, and offers a task or a sub-group for exactly
 * those children (#455).
 *
 * Questions are named by their generated topic (stored server-side, decided
 * once), falling back to the screen's own heading — never a bare "שאלה N"
 * while a name exists. Hovering a name shows the authored question text.
 *
 * Counts stay the rule (MoE C5); `difficulties[].learner_ids` is the one
 * sanctioned "who" — a selection in roster order, never a ranking.
 */

import { useEffect, useState } from 'react'
import { navigate } from '../../../app/router'
import { BarSeries } from '../../../components/charts'
import {
  Card, EmptyState, ErrorState, Icon, Panel, SectionHeader, Skeleton, SkeletonCard, StatusPill,
  Tooltip,
} from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  createSubgroup, generateQuestionTopics, getLearningDetail,
  type DifficultyRow, type HardQuestion, type LearningDetail,
} from '../../../services/teacher'
import { DifficultiesCard, type DifficultyItem } from '../shared/DifficultiesCard'
import { formatSeconds } from '../shared/formatDuration'
import { LearningPreviewDialog } from '../shared/LearningPreviewDialog'
import { ObjectiveLine } from '../shared/ObjectiveRef'
import { subjectLabel } from '../shared/subjectLabel'
import { SubgroupDialog } from '../students/SubgroupDialog'
import { TaskBuilder } from '../tasks/TeacherTasksPage'
import { type TaskSeed } from '../tasks/taskSeed'
import { learningName } from './learningRows'
import { questionLabel, ratePercent, rateTone } from './TeacherLearningsPage'
import './teacher-learnings.css'

/** Patch stored topic decisions into rows already on screen. */
function withTopics<T extends HardQuestion>(
  rows: T[], componentId: string, topics: Record<string, string | null>,
): T[] {
  return rows.map((row) => {
    const key = `${componentId}|${row.item_id}|${row.question_id}`
    return key in topics ? { ...row, topic: topics[key] } : row
  })
}

export function LearningDetailPage({ groupId, componentId }: {
  groupId: string
  componentId: string
}) {
  const { t, language, direction } = useI18n()
  const [view, setView] = useState<LearningDetail | null>(null)
  const [error, setError] = useState(false)

  /* Being here means the next visit to the learnings list is a RETURN — raise
     the flag its scroll-memory restores on (#513). On mount, not on the back
     button, so the browser's own back gesture counts too. */
  useEffect(() => {
    try { sessionStorage.setItem('yuvi.teacher.learningsReturn', '1') }
    catch { /* private mode */ }
  }, [])

  useEffect(() => {
    let active = true
    setView(null)
    setError(false)
    getLearningDetail(groupId, componentId, language)
      .then((result) => { if (active) setView(result) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [groupId, componentId, language])

  /* Topic names are decided server-side, once, and the GET never generates —
     so a first-ever visit arrives with `topics_pending` and fires exactly one
     POST, then patches the rows from its map. No retry loop: a failure leaves
     honest screen-title labels, and the next visit simply asks again. */
  useEffect(() => {
    if (!view?.topics_pending) return
    let active = true
    generateQuestionTopics(groupId, componentId, language)
      .then(({ topics }) => {
        if (!active) return
        setView((current) => current ? {
          ...current,
          topics_pending: false,
          questions: withTopics(current.questions, componentId, topics),
          difficulties: withTopics(current.difficulties, componentId, topics),
        } : current)
      })
      .catch(() => {})
    return () => { active = false }
  }, [view?.topics_pending, groupId, componentId, language])

  /* The card's two actions. The task builder opens HERE, in the same dialog
     the tasks screen uses (the TeacherStudentPage pattern) — a teacher acting
     on a finding never loses the page the finding is on. The sub-group dialog
     is the students page's own, pre-ticked with the difficulty's children. */
  const { students } = useTeacherRoster()
  const { refreshSubgroups } = useTeacherScope()
  const [builderSeed, setBuilderSeed] = useState<TaskSeed | null>(null)
  const [subgroupFor, setSubgroupFor] = useState<DifficultyItem | null>(null)
  const [subgroupBusy, setSubgroupBusy] = useState(false)
  const [subgroupError, setSubgroupError] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)

  const classRoster = students
    .filter((row) => row.group_id === groupId)
    .map((row) => ({ id: row.learner_id, name: row.display_name ?? row.learner_id }))

  async function saveSubgroup(draft: { name: string; learnerIds: string[] }) {
    if (!draft.learnerIds.length || subgroupBusy) return
    const groupName = draft.name
      || t('tch.subgroups.defaultName', { count: draft.learnerIds.length })
    setSubgroupBusy(true)
    setSubgroupError('')
    try {
      // Into the provider's list BEFORE anything selects it — the same
      // load-bearing order the students page keeps. No scope change here:
      // the teacher is reading a lesson, not the roster.
      const created = await createSubgroup(groupId, groupName, draft.learnerIds)
      refreshSubgroups(created)
      setSubgroupFor(null)
    } catch (err) {
      const code = (err as { message?: string })?.message ?? ''
      setSubgroupError(t(`tch.subgroups.error.${code}`) === `tch.subgroups.error.${code}`
        ? t('tch.subgroups.error.generic') : t(`tch.subgroups.error.${code}`))
    } finally {
      setSubgroupBusy(false)
    }
  }

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

  const difficulties: DifficultyItem[] = view.difficulties.map((row: DifficultyRow) => {
    const label = questionLabel(row, t)
    return {
      id: `${row.item_id}:${row.question_id}`,
      title: label,
      // The screen is the subtitle only when the title is a TOPIC — otherwise
      // the label already IS the screen and saying it twice reads as an echo.
      subtitle: row.topic ? row.screen_title || null : null,
      tooltip: row.question_text ?? undefined,
      learnerIds: row.learner_ids,
      evidence: row.evidence,
      seed: {
        title: t('tch.learnings.diffTaskTitle', { topic: label }),
        topic: label,
        objectiveId: learning.objective_id,
        learnerIds: row.learner_ids,
      },
      subgroupName: label,
    }
  })

  return (
    <div className="tch-learningDetail">
      <header className="tch-learningDetail__head">
        {/* Back at the inline-start, preview at the inline-end — the far top
            corner, so the teacher's own window into the lomda is always one
            click away without crowding the title. */}
        <div className="tch-learningDetail__topRow">
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--sm"
            onClick={() => navigate('/teacher/learnings')}
          >
            <Icon name="chevronLeft" size={15} aria-hidden />
            {t('tch.learnings.backToList')}
          </button>
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--sm"
            onClick={() => setPreviewId(componentId)}
          >
            <Icon name="play" size={15} aria-hidden />
            {t('tch.learnings.preview')}
          </button>
        </div>
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
                  formatValue={(value) => formatSeconds(value, t)}
                />
              ) : (
                <p className="tch-learningDetail__noTiming">{t('tch.pulse.noTiming')}</p>
              )}
            </Panel>
          </div>

          {/* ── the difficulties, and what to do about them (#455) ────────── */}
          <DifficultiesCard
            className="tch-learningDetail__difficulties"
            title={t('tch.learnings.diffTitle')}
            subtitle={t('tch.learnings.diffSubtitle')}
            items={difficulties}
            emptyLabel={t('tch.learnings.diffEmpty')}
            onBuildTask={setBuilderSeed}
            onCreateSubgroup={setSubgroupFor}
          />

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

        </>
      )}

      {/* The task builder, ON this page — seeded by whichever difficulty was
          clicked, so building for "the four who never got it" is two clicks. */}
      <Modal
        open={Boolean(builderSeed)}
        onClose={() => setBuilderSeed(null)}
        titleId="tch-learning-builder-title"
        className="tch-builder__modal"
        dismissible={false}
      >
        <div className="tch-builder__head">
          <h2 id="tch-learning-builder-title" className="tch-builder__modalTitle" dir="auto">
            {t('tch.tasks.new')}
          </h2>
        </div>
        {builderSeed ? (
          <TaskBuilder
            groupId={groupId}
            seed={builderSeed}
            onCancel={() => setBuilderSeed(null)}
            onDone={() => setBuilderSeed(null)}
          />
        ) : null}
      </Modal>

      {/* The students page's own create dialog, pre-ticked with the
          difficulty's children and pre-named by its topic. */}
      <SubgroupDialog
        open={Boolean(subgroupFor)}
        editing={null}
        roster={classRoster}
        preselect={subgroupFor?.learnerIds}
        initialName={subgroupFor?.subgroupName}
        busy={subgroupBusy}
        error={subgroupError}
        onClose={() => { setSubgroupFor(null); setSubgroupError('') }}
        onSave={(draft) => void saveSubgroup(draft)}
      />

      <LearningPreviewDialog
        componentId={previewId}
        title={name.title}
        onClose={() => setPreviewId(null)}
      />

      {/* Direction is used by the table's numeric columns via CSS only. */}
      <span hidden data-direction={direction} />
    </div>
  )
}

function QuestionRow({ question }: { question: HardQuestion }) {
  const { t } = useI18n()
  const tone = rateTone(question.success_rate)
  const pill = (
    <StatusPill tone={tone === 'danger' ? 'support' : tone === 'warn' ? 'steady' : 'neutral'}>
      {questionLabel(question, t)}
    </StatusPill>
  )
  return (
    <tr>
      <td className="tch-learningDetail__topicCell">
        {/* The exact authored question, on hover/focus — the app tooltip, not
            `title=`, which touch and keyboard never see. */}
        {question.question_text ? (
          <Tooltip label={t('tch.learnings.diffSource')} trigger={pill}
                   className="tch-questionTip">
            <span dir="auto">{question.question_text}</span>
          </Tooltip>
        ) : pill}
      </td>
      <td dir="auto">{question.screen_title || '—'}</td>
      <td className={`tch-table__rate is-${tone}`}>{ratePercent(question.success_rate)}</td>
      <td>{question.attempts}</td>
      <td>{question.learners}</td>
      <td>{question.avg_seconds ? formatSeconds(question.avg_seconds, t) : '—'}</td>
      <td>{question.hints_used ?? 0}</td>
      <td>{question.chat_turns ?? 0}</td>
    </tr>
  )
}
