/* Tracking one task: the class, each question, and each child's paper.
 *
 * Three levels, as the plan asks — class, sub-group, and one student — over one
 * set of numbers, so switching scope never changes what a figure means.
 *
 * The thing this screen exists for, and the reason a bare histogram would not
 * do: every per-question bucket carries learner ids, so "six got this wrong"
 * is a list of six children you can open, not a number you then go hunting for.
 *
 * And the part asked for explicitly: beside a child's score sits **the exact
 * feedback they were shown**. That is what makes an AI-assisted grade
 * auditable — a teacher can see what the child was actually told, rather than
 * trusting it was reasonable.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  EmptyState, ErrorState, Icon, Panel, SectionHeader, Skeleton, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import { apiGet } from '../../../services/api'

import { MathText } from '../../tasks/MathText'
import { StudentAvatar } from '../shared/StudentAvatar'
import {
  closeTask, getLearnerAttempt, getTaskTracking, listTaskLaunches, reopenTask,
  type LearnerAttempt, type TaskLaunch, type TaskTracking, type TrackingQuestion,
} from '../../../services/tasks'
import './teacher-tasks.css'
import { formatDay } from '../../../i18n/dates'

const BUCKETS = ['correct', 'partial', 'wrong', 'skipped'] as const

interface TaskSummaryProse {
  headline: string | null
  summary: string | null
  bullets: { text: string; why: string; ref: string; evidence: Record<string, unknown> }[]
  facts: Record<string, number | null>
  actions: { kind: string; label_key: string; learner_ids: string[]; count: number }[]
}

export function TaskTrackingPage({ taskId }: { taskId: string }) {
  const { t, language } = useI18n()
  /* The sub-group scope is the PORTAL's, not this page's. The page used to
     fetch its own list and keep its own `'all'`, which is how switching class
     kept the old selection and sent a stale `subgroup_id` the server 403'd
     into a swallowed catch. The portal's scope bar is the only handle now —
     this screen just narrows by whatever it says. */
  const { groupId, subgroups, subgroupId } = useTeacherScope()
  const { nameOf } = useTeacherRoster()
  const [data, setData] = useState<TaskTracking | null>(null)
  const [prose, setProse] = useState<TaskSummaryProse | null>(null)
  /* Separate from `prose === null`, which cannot tell "still generating" from
     "there is none". This paragraph is a model call over the results, so it
     lands seconds after the numbers — and with no placeholder it appeared out
     of nowhere and pushed the per-question list the teacher was reading down
     the page. */
  const [proseLoading, setProseLoading] = useState(true)
  const [openLearner, setOpenLearner] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [launches, setLaunches] = useState<TaskLaunch[]>([])
  /* Which opening is on screen. `null` means "whichever is newest", which is
     what a teacher opening this page the morning after a send wants — not the
     round they ran last term. */
  const [launchId, setLaunchId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadLaunches = useCallback(async () => {
    try {
      const payload = await listTaskLaunches(taskId)
      setLaunches(payload.launches)
    } catch {
      setLaunches([])
    }
  }, [taskId])

  useEffect(() => { void loadLaunches() }, [loadLaunches])

  /** Close or reopen, then refresh both the openings and the numbers. */
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await run()
      await loadLaunches()
      const refreshed = await getTaskTracking(taskId, launchId ?? undefined)
      setData(refreshed)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    getTaskTracking(taskId, launchId ?? undefined, controller.signal)
      .then(setData)
      .catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [taskId, launchId])

  const scope = subgroupId ?? 'all'

  /* The prose is refetched per scope because it is a summary *of that scope* —
     a class paragraph shown above a sub-group's numbers would be describing
     children who are not on the screen. */
  useEffect(() => {
    const controller = new AbortController()
    setProse(null)
    setProseLoading(true)
    const query = new URLSearchParams({ language })
    if (scope !== 'all') query.set('subgroup_id', scope)
    apiGet<TaskSummaryProse>(
      `/api/teacher/tasks/${encodeURIComponent(taskId)}/summary?${query}`,
      { signal: controller.signal },
    )
      .then(setProse)
      .catch(() => { /* the numbers below stand alone */ })
      .finally(() => { if (!controller.signal.aborted) setProseLoading(false) })
    return () => controller.abort()
  }, [taskId, scope, language])

  const inScope = useMemo(() => {
    if (scope === 'all' || !data) return null
    const chosen = subgroups.find((entry) => entry.id === scope)
    return new Set(chosen?.learner_ids ?? [])
  }, [scope, subgroups, data])

  const learners = useMemo(() => (
    !data ? [] : inScope
      ? data.learners.filter((row) => inScope.has(row.learner_id))
      : data.learners
  ), [data, inScope])

  const questions = useMemo(() => (
    !data ? [] : inScope
      ? data.questions.map((question) => ({
          ...question,
          ...Object.fromEntries(BUCKETS.map((bucket) => [
            bucket, question[bucket].filter((id) => inScope.has(id)),
          ])),
        })) as TrackingQuestion[]
      : data.questions
  ), [data, inScope])

  if (error) {
    return <ErrorState title={t('tch.tasks.trackError')} body={t('tch.tasks.trackErrorBody')} />
  }
  if (!data) {
    // Inside `.tch-track`, so the skeletons sit where the content will —
    // loading straight onto the page background put them flush against the
    // chrome and then everything jumped inward when the fetch landed.
    return (
      <div className="tch-track" aria-busy="true">
        <div className="tch-tasks__loading">
          {[0, 1, 2].map((index) => <Skeleton key={index} w="100%" h={72} />)}
        </div>
      </div>
    )
  }

  const done = learners.filter((row) => row.status === 'submitted' || row.status === 'graded')
  const scores = done.map((row) => row.score).filter((score): score is number => score !== null)

  return (
    <div className="tch-track">
      <SectionHeader
        title={data.title ?? t('tasks.untitled')}
        subtitle={t(`tch.tasks.status.${data.status}`)}
        action={
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                  onClick={() => navigate('/teacher/tasks')}>
            {t('tch.tasks.backToList')}
          </button>
        }
      />

      {/* A per-question breakdown across two different papers is a breakdown of
          nothing, so this is stated rather than buried. */}
      {data.stale_snapshots > 0 ? (
        <p className="tch-track__stale">
          <Icon name="alert" size={15} />
          {t('tch.tasks.stale', { n: String(data.stale_snapshots) })}
        </p>
      ) : null}

      {/* Which opening. Above everything, because it changes what every number
          below means — two openings of one task are two classes, two dates and
          two sets of results that must never be read as one. */}
      {launches.length > 1 ? (
        <div className="tch-track__openings">
          <span className="tch-builder__hint">{t('tch.tasks.openingsLabel')}</span>
          <div className="tch-track__scope">
            {launches.map((launch) => (
              <button key={launch.id} type="button"
                      className={`tch-chip${(data.launch_id === launch.id) ? ' is-on' : ''}`}
                      aria-pressed={data.launch_id === launch.id}
                      onClick={() => setLaunchId(launch.id)}>
                {t('tch.tasks.opening', { n: String(launch.seq) })}
                {' · '}
                {formatDay(launch.opened_at)}
                {' · '}
                {t('tch.tasks.openingCount', {
                  done: String(launch.completed), all: String(launch.assigned),
                })}
                {launch.status === 'closed' ? ` · ${t('tch.tasks.status.closed')}` : ''}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Close or reopen THIS opening. Reopening is the answer to "the child
          was away that day" — the paper they hold is the paper they get back,
          because a fresh round is a new opening rather than an un-close. */}
      {data.launch_id ? (
        <div className="tch-track__openingActions">
          {data.launch_status === 'closed' ? (
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" disabled={busy}
                    onClick={() => void act(() => reopenTask(taskId, data.launch_id))}>
              <Icon name="reflect" size={15} />
              {t('tch.tasks.reopen')}
            </button>
          ) : (
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" disabled={busy}
                    onClick={() => void act(() => closeTask(taskId, data.launch_id))}>
              <Icon name="lock" size={15} />
              {t('tch.tasks.closeOpening')}
            </button>
          )}
        </div>
      ) : null}

      {/* No local sub-group chips: the portal's scope bar is the one handle on
          that filter, and this screen simply honours it. */}
      <div className="tch-stats">
        <Stat label={t('tch.tasks.stat.assigned')} value={String(learners.length)} />
        <Stat label={t('tch.tasks.stat.completed')} value={String(done.length)} />
        <Stat label={t('tch.tasks.stat.average')}
              value={scores.length
                ? `${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}%`
                : '—'} />
        <Stat label={t('tch.tasks.stat.review')}
              value={String(done.filter((row) => row.needs_review).length)} />
      </div>

      {proseLoading ? (
        <Panel className="tch-track__prose" aria-busy="true">
          <Skeleton w="62%" h={20} />
          <Skeleton w="100%" h={13} />
          <Skeleton w="88%" h={13} />
        </Panel>
      ) : prose?.headline || prose?.bullets.length ? (
        <Panel className="tch-track__prose">
          {prose.headline ? <h3>{prose.headline}</h3> : null}
          {prose.summary ? <p>{prose.summary}</p> : null}
          {prose.bullets.length ? (
            <ul>
              {prose.bullets.map((bullet) => (
                /* The claim alone. The "why" drill-down read as chrome on
                   every bullet and told the teacher little the sentence
                   itself did not. */
                <li key={bullet.ref}>
                  <span>{bullet.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {prose.actions.length ? (
            <div className="tch-track__actions">
              {prose.actions.map((action) => (
                <button key={action.kind} type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                        onClick={() => setOpenLearner(action.learner_ids[0] ?? null)}>
                  {t(action.label_key, { n: String(action.count) })}
                </button>
              ))}
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel>
        <SectionHeader title={t('tch.tasks.perQuestion')} />
        {questions.length === 0 ? (
          <EmptyState icon="inbox" title={t('tch.tasks.noQuestions')} />
        ) : (
          <ul className="tch-track__questions">
            {questions.map((question, index) => (
              <QuestionRow key={question.id} question={question} index={index}
                           onOpenLearner={setOpenLearner} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <SectionHeader title={t('tch.tasks.perStudent')} />
        <ul className="tch-track__learners">
          {learners.map((row) => (
            <li key={row.learner_id}>
              <button type="button" className="tch-track__learner"
                      onClick={() => setOpenLearner(row.learner_id)}>
                <StudentAvatar learnerId={row.learner_id} size={30} />
                <span className="tch-track__name">
                  {nameOf(row.learner_id) ?? row.learner_id}
                </span>
                <StatusPill tone={row.status === 'not_started' ? 'support' : 'neutral'}>
                  {t(`tch.tasks.attempt.${row.status}`)}
                </StatusPill>
                <span className="tch-track__score">
                  {row.score !== null ? `${row.score}%` : '—'}
                </span>
                {row.needs_review ? (
                  <span className="tch-track__flag" title={t('tch.tasks.needsReview')}>
                    <Icon name="alert" size={14} />
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      {openLearner ? (
        <LearnerPaper taskId={taskId} learnerId={openLearner}
                      launchId={data?.launch_id}
                      onClose={() => setOpenLearner(null)} />
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tch-stat">
      <span className="tch-stat__value">{value}</span>
      <span className="tch-stat__label">{label}</span>
    </div>
  )
}

function QuestionRow({ question, index, onOpenLearner }: {
  question: TrackingQuestion
  index: number
  onOpenLearner: (learnerId: string) => void
}) {
  const { t } = useI18n()
  const { nameOf } = useTeacherRoster()
  const [open, setOpen] = useState(false)
  const total = BUCKETS.reduce((sum, bucket) => sum + question[bucket].length, 0)

  return (
    <li className="tch-track__q">
      <button type="button" className="tch-track__qHead" aria-expanded={open}
              onClick={() => setOpen((current) => !current)}>
        <span className="tch-track__qNum" aria-hidden="true">{index + 1}</span>
        <MathText className="tch-track__qText" content={question.prompt} />
        <span className="tch-track__qBar" aria-hidden="true">
          {BUCKETS.map((bucket) => (
            question[bucket].length ? (
              <span key={bucket} className={`is-${bucket}`}
                    style={{ flexGrow: question[bucket].length }} />
            ) : null
          ))}
        </span>
        <span className="tch-track__qCount">
          {t('tch.tasks.qCount', {
            right: String(question.correct.length), all: String(total),
          })}
        </span>
      </button>

      {open ? (
        <div className="tch-track__qBuckets">
          {BUCKETS.map((bucket) => (
            question[bucket].length ? (
              <div key={bucket} className={`tch-track__bucket is-${bucket}`}>
                <h4>{t(`tasks.verdict.${bucket}`)} · {question[bucket].length}</h4>
                <ul>
                  {question[bucket].map((learnerId) => (
                    <li key={learnerId}>
                      <button type="button" onClick={() => onOpenLearner(learnerId)}>
                        {nameOf(learnerId) ?? learnerId}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          ))}
        </div>
      ) : null}
    </li>
  )
}

/** One child's paper. The teacher sees the key, their answer, the mark — and
 *  the sentence the child read, which is the point of the panel. */
function LearnerPaper({ taskId, learnerId, launchId, onClose }: {
  taskId: string; learnerId: string; launchId?: string; onClose: () => void
}) {
  const { t } = useI18n()
  const { nameOf } = useTeacherRoster()
  const [paper, setPaper] = useState<LearnerAttempt | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setPaper(null)
    setMissing(false)
    getLearnerAttempt(taskId, learnerId, launchId, controller.signal)
      .then(setPaper)
      .catch(() => { if (!controller.signal.aborted) setMissing(true) })
    return () => controller.abort()
  }, [taskId, learnerId, launchId])

  const close = useCallback(() => onClose(), [onClose])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className="tch-paper" role="dialog" aria-modal="true">
      <div className="tch-paper__scrim" onClick={close} />
      <Panel className="tch-paper__panel">
        <header className="tch-paper__head">
          <StudentAvatar learnerId={learnerId} size={34} />
          <h3>{nameOf(learnerId) ?? learnerId}</h3>
          {paper?.score !== null && paper?.score !== undefined ? (
            <span className="tch-paper__score">{paper.score}%</span>
          ) : null}
          <button type="button" className="sp-btn sp-btn--icon sp-btn--ghost"
                  aria-label={t('tch.tasks.closePaper')} onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </header>

        {missing ? (
          <EmptyState icon="inbox" title={t('tch.tasks.noPaper')} />
        ) : !paper ? (
          <Skeleton w="100%" h={180} />
        ) : (
          <>
            {/* Exactly what the child was told, beside the number they were not. */}
            {paper.learner_feedback ? (
              <p className="tch-paper__said">
                <Icon name="message" size={15} />
                <span>{paper.learner_feedback}</span>
              </p>
            ) : null}

            <ul className="tch-paper__questions">
              {paper.questions.map((question, index) => (
                <li key={question.id} className={`tch-paper__q is-${question.bucket}`}>
                  <span className="tch-paper__qNum">{index + 1}</span>
                  <div className="tch-paper__qBody">
                    <MathText className="tch-paper__prompt" content={question.prompt} />
                    <p className="tch-paper__given">
                      <span>{t('tch.tasks.theyAnswered')}</span>
                      <GivenAnswer question={question} />
                    </p>
                    {question.feedback ? (
                      <p className="tch-paper__qSaid">{question.feedback}</p>
                    ) : null}
                  </div>
                  <span className={`tch-paper__mark is-${question.bucket}`}>
                    {question.correctness !== null
                      ? `${Math.round(question.correctness * 100)}%`
                      : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  )
}

/** The child's answer, rendered as what they chose rather than as an index —
 *  "2" tells a teacher nothing about which option that was. */
function GivenAnswer({ question }: { question: LearnerAttempt['questions'][number] }) {
  const { t } = useI18n()
  const given = question.given

  if (given === undefined || given === null || given === '') {
    return <em>{t('tasks.verdict.skipped')}</em>
  }
  if (typeof given === 'boolean') {
    return <span>{t(given ? 'tasks.true' : 'tasks.false')}</span>
  }
  if (typeof given === 'number' && question.options?.[given]) {
    return <MathText content={question.options[given]} />
  }
  if (Array.isArray(given) && question.options) {
    const picked = given
      .map((entry) => (typeof entry === 'number' ? question.options?.[entry] : null))
      .filter(Boolean)
    if (picked.length) {
      return (
        <span className="tch-paper__multi">
          {picked.map((option, index) => <MathText key={index} content={option!} />)}
        </span>
      )
    }
  }
  return <span dir="auto">{typeof given === 'string' ? given : JSON.stringify(given)}</span>
}
