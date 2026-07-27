import { useCallback, useEffect, useRef, useState } from 'react'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import {
  Icon, LoadingState, ErrorState,
} from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useRewards } from '../../providers/RewardsProvider'
import { stageAmount } from '../../services/rewards'
import { getLearnerState, updateLearnerState } from '../../services/api'
import {
  createMentoring, deleteGoal, deleteConversation, listMentoring, updateGoalProgress, assistMentoring,
  recommendGoal, setRecommendationStatus, requestGoalHelp,
  type MentoringConversation, type MentoringGoal, type GoalProgressStage, type YuviQA, type GoalRecommendation,
} from '../../services/mentoring'
import './mentoring-view.css'

const PROGRESS_STAGES: GoalProgressStage[] = ['chosen', 'started', 'progressed', 'summarized']
const KNOWN_FEELINGS = ['good', 'thoughtful', 'difficult']

interface GoalDraft {
  title: string
  next_steps: string
  deadline: string
  from_yuvi?: boolean
}

/** A resumable draft of the conversation composer, persisted in learner state
 * (DB-backed, never browser storage) so a refresh or leaving returns the
 * student to the same step and content. */
interface ComposerDraft {
  open: boolean
  step: number
  feeling: string
  notes: string
  goals: GoalDraft[]
}

const COMPOSER_STEPS = ['feeling', 'discussed', 'goals', 'review'] as const

function formatDate(value: string | undefined, language: string) {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

/** Day + short month for the small stepping stones on the trail. */
function shortDate(value: string | undefined, language: string) {
  if (!value) return { day: '', month: '' }
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return { day: value, month: '' }
  return {
    day: new Intl.DateTimeFormat(language, { day: 'numeric' }).format(date),
    month: new Intl.DateTimeFormat(language, { month: 'short' }).format(date),
  }
}

// A goal always has a target date; a new manual goal defaults to a week out.
function weekFromToday() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

function goalStage(goal: MentoringGoal): GoalProgressStage {
  return goal.progress_stage && PROGRESS_STAGES.includes(goal.progress_stage) ? goal.progress_stage : 'chosen'
}

// Three learner-facing statuses (new / in progress / done), mapped onto the
// stored progress stages. "Active" is not the first goal — it is derived from
// the time window (deadline not passed and not done yet).
type GoalStatus = 'new' | 'in_progress' | 'done'
const STATUS_TO_STAGE: Record<GoalStatus, GoalProgressStage> = { new: 'chosen', in_progress: 'started', done: 'summarized' }

function goalStatus(goal: MentoringGoal): GoalStatus {
  const stage = goalStage(goal)
  if (stage === 'summarized') return 'done'
  if (stage === 'chosen') return 'new'
  return 'in_progress'
}

function isOverdue(goal: MentoringGoal): boolean {
  if (!goal.deadline || goalStatus(goal) === 'done') return false
  return goal.deadline < new Date().toISOString().slice(0, 10)
}

/** Students may remove only conversations they documented — teacher talks are protected. */
function canDeleteConversation(conversation: MentoringConversation): boolean {
  return conversation.author === 'learner'
}

function feelingLabel(t: (key: string) => string, feeling: string): string {
  return KNOWN_FEELINGS.includes(feeling) ? t(`mentoring.student.composer.feeling.${feeling}`) : feeling
}

/** `/mentoring` is a learner surface: document a conversation with the teacher and
 * capture the goals set in it. Teachers have their own lane (`/teacher-view`). */
export function MentoringPage() {
  return <StudentGoalsPage />
}

function StudentGoalsPage() {
  const { t, language } = useI18n()
  const { applyGrant } = useRewards()
  const [rows, setRows] = useState<MentoringConversation[] | null>(null)
  const [error, setError] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [detail, setDetail] = useState<MentoringConversation | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [helpingId, setHelpingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ conversation: MentoringConversation; goal?: MentoringGoal } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState(false)
  const [draft, setDraft] = useState<ComposerDraft | null>(null)
  // Exactly one conversation is in focus at a time; the trail moves between them.
  const [focus, setFocus] = useState(0)
  const draftTimer = useRef<number | undefined>(undefined)

  const load = () => {
    setRows(null)
    setError(false)
    setFocus(0)
    listMentoring('learner')
      .then((response) => setRows(response.conversations))
      .catch(() => setError(true))
  }

  useEffect(() => {
    load()
    // Resume an unfinished conversation record (DB-backed draft, not storage).
    getLearnerState()
      .then((state) => {
        const saved = (state.mentoring_draft ?? null) as ComposerDraft | null
        if (saved && typeof saved === 'object') {
          setDraft(saved)
          if (saved.open) setComposerOpen(true)
        }
      })
      .catch(() => {})
  }, [])

  // Persist the draft: a "paused" (open:false) snapshot flushes immediately so a
  // fast refresh won't re-pop the modal; edits while open are debounced.
  const persistDraft = useCallback((next: ComposerDraft) => {
    setDraft(next)
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    if (!next.open) {
      updateLearnerState({ mentoring_draft: next }).catch(() => {})
      return
    }
    draftTimer.current = window.setTimeout(() => {
      updateLearnerState({ mentoring_draft: next }).catch(() => {})
    }, 600)
  }, [])

  const clearDraft = useCallback(() => {
    setDraft(null)
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    updateLearnerState({ mentoring_draft: null }).catch(() => {})
  }, [])

  const changeStatus = async (goal: MentoringGoal, conversation: MentoringConversation, status: GoalStatus) => {
    if (!goal.id || !conversation.id || updatingId || goalStatus(goal) === status) return
    setUpdatingId(goal.id)
    try {
      const updated = await updateGoalProgress(conversation.id, goal.id, STATUS_TO_STAGE[status])
      applyGrant(updated.reward)
      setRows((currentRows) => currentRows?.map((row) => row.id === updated.id ? updated : row) ?? null)
    } finally {
      setUpdatingId(null)
    }
  }

  // "It's hard for me" flags the goal for the teacher (stored in DB now, used on
  // the teacher side later). The learner is never blamed.
  const requestHelp = async (goal: MentoringGoal, conversation: MentoringConversation) => {
    if (!goal.id || !conversation.id || helpingId) return
    setHelpingId(goal.id)
    try {
      const updated = await requestGoalHelp(conversation.id, goal.id)
      applyGrant(updated.reward)
      setRows((currentRows) => currentRows?.map((row) => row.id === updated.id ? updated : row) ?? null)
    } finally {
      setHelpingId(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deletingId) return
    const { conversation, goal } = deleteTarget
    if (!conversation.id) return
    setDeleteError(false)
    setDeletingId(goal?.id || conversation.id)
    try {
      if (goal?.id) {
        await deleteGoal(conversation.id, goal.id)
        setRows((currentRows) => currentRows?.map((row) =>
          row.id === conversation.id ? { ...row, goals: (row.goals || []).filter((g) => g.id !== goal.id) } : row,
        ) ?? null)
      } else {
        await deleteConversation(conversation.id)
        setRows((currentRows) => currentRows?.filter((row) => row.id !== conversation.id) ?? null)
        setDetail((current) => current?.id === conversation.id ? null : current)
      }
      setDeleteTarget(null)
    } catch {
      setDeleteError(true)
    } finally {
      setDeletingId(null)
    }
  }

  // Keep the focused index valid after a delete or a reload.
  const current = rows && rows.length > 0 ? Math.min(focus, rows.length - 1) : 0

  return (
    <>
      <LearnerAppBar />
      <main className={`mt-wrap mt-student${rows && rows.length > 0 ? '' : ' mt-student--sparse'}`}>
        <header className="mt-student__hero">
          <p className="mt-student__eyebrow">{t('mentoring.student.eyebrow')}</p>
          <h1>{t('mentoring.student.title')}</h1>
          <p>{t('mentoring.student.subtitle')}</p>
        </header>

        {error ? (
          <ErrorState title={t('mentoring.error')} />
        ) : rows === null ? (
          <LoadingState title={t('mentoring.loading')} />
        ) : rows.length === 0 ? (
          <MentoringEmpty onCreate={() => setComposerOpen(true)} />
        ) : (
          <section className="mt-focus-wrap" aria-label={t('mentoring.student.conversations.title')}>
            {rows.length > 1 && (
              <ConversationSwitch conversations={rows} index={current} language={language} onPick={setFocus} />
            )}
            <ConversationFocus
              key={rows[current].id}
              conversation={rows[current]}
              language={language}
              updating={updatingId}
              helping={helpingId}
              onStatus={(goal, status) => changeStatus(goal, rows[current], status)}
              onHelp={(goal) => requestHelp(goal, rows[current])}
              onOpen={() => setDetail(rows[current])}
              onCompose={() => setComposerOpen(true)}
            />
          </section>
        )}
      </main>

      {composerOpen && (
        <ConversationComposer
          initialDraft={draft}
          onPersist={persistDraft}
          onClear={clearDraft}
          onClose={() => setComposerOpen(false)}
          onSaved={() => { setComposerOpen(false); load() }}
        />
      )}
      {detail && (
        <ConversationDetail
          conversation={detail}
          language={language}
          onClose={() => setDetail(null)}
          onDelete={canDeleteConversation(detail) && detail.id ? () => setDeleteTarget({ conversation: detail }) : undefined}
          onDeleteGoal={canDeleteConversation(detail) && detail.id ? (goal) => setDeleteTarget({ conversation: detail, goal }) : undefined}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          kind={deleteTarget.goal ? 'goal' : 'conversation'}
          busy={Boolean(deletingId)}
          error={deleteError}
          onCancel={() => { setDeleteTarget(null); setDeleteError(false) }}
          onConfirm={confirmDelete}
        />
      )}
    </>
  )
}

// A persistent tag marking goals the learner accepted from Yuvi's suggestion.
function YuviTag() {
  const { t } = useI18n()
  return (
    <span className="mt-yuvi-tag" title={t('mentoring.student.goal.yuviTag')}>
      <Icon name="spark" size={12} />{t('mentoring.student.goal.yuviTag')}
    </span>
  )
}

// Only a handful of talks are offered at once — a long row of near-identical
// dates is noise for a child. The window slides around the talk in focus.
const STRIP_WINDOW = 7

// A timeline of the talks the child has had, not a date picker: a single line
// runs through every talk, and the one in focus is marked by colour alone.
function ConversationSwitch({ conversations, index, language, onPick }: {
  conversations: MentoringConversation[]; index: number; language: string; onPick: (next: number) => void
}) {
  const { t } = useI18n()
  const total = conversations.length
  const stripRef = useRef<HTMLOListElement | null>(null)
  const start = total <= STRIP_WINDOW
    ? 0
    : Math.min(Math.max(index - Math.floor(STRIP_WINDOW / 2), 0), total - STRIP_WINDOW)
  const visible = conversations.slice(start, start + STRIP_WINDOW)

  // Keep the talk in focus visible without the child having to drag the strip.
  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>('.mt-tnode.is-on')
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [index])

  return (
    <nav className="mt-strip-wrap" aria-label={t('mentoring.student.journey.trailAria')}>
      <div className="mt-strip">
        <button
          type="button"
          className="mt-strip__nav mt-strip__nav--newer"
          disabled={index === 0}
          onClick={() => onPick(index - 1)}
          aria-label={t('mentoring.student.journey.newer')}
          title={t('mentoring.student.journey.newer')}
        >
          <Icon name="chevronLeft" size={20} />
        </button>
        <ol
          className="mt-strip__rail"
          ref={stripRef}
          onKeyDown={(event) => {
            // In RTL the visual left arrow moves to the older talk, and back.
            const rtl = document.documentElement.dir === 'rtl'
            const step = event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : event.key === 'ArrowRight' ? (rtl ? -1 : 1) : 0
            if (!step) return
            const next = index + step
            if (next < 0 || next >= total) return
            event.preventDefault()
            onPick(next)
          }}
        >
          {visible.map((conversation, offset) => (
            <TalkCard
              key={conversation.id}
              conversation={conversation}
              language={language}
              active={start + offset === index}
              opening={start + offset === total - 1}
              position={start + offset}
              total={total}
              onPick={() => onPick(start + offset)}
            />
          ))}
        </ol>
        <button
          type="button"
          className="mt-strip__nav mt-strip__nav--older"
          disabled={index >= total - 1}
          onClick={() => onPick(index + 1)}
          aria-label={t('mentoring.student.journey.older')}
          title={t('mentoring.student.journey.older')}
        >
          <Icon name="chevronLeft" size={20} />
        </button>
      </div>
    </nav>
  )
}

/** One stop on the timeline: a dot on the line, the date, and one short line
 * saying what that talk was — so the row reads as a story, not as a calendar. */
function TalkCard({ conversation, language, active, opening, position, total, onPick }: {
  conversation: MentoringConversation; language: string; active: boolean; opening: boolean
  position: number; total: number; onPick: () => void
}) {
  const { t } = useI18n()
  const { day, month } = shortDate(conversation.date, language)
  const goals = conversation.goals || []
  const done = goals.filter((goal) => goalStatus(goal) === 'done').length
  const allDone = goals.length > 0 && done === goals.length

  const context = opening
    ? t('mentoring.student.journey.kind.opening')
    : goals.length === 1
      ? t('mentoring.student.journey.goalsCount.one')
      : goals.length > 1
        ? t('mentoring.student.journey.goalsCount.many', { count: goals.length })
        : t('mentoring.student.journey.kind.followUp')

  const label = [
    t('mentoring.student.journey.talkTag'),
    formatDate(conversation.date, language),
    context,
    t('mentoring.student.journey.position', { index: position + 1, total }),
    goals.length ? t('mentoring.student.journey.goalsProgress', { done, total: goals.length }) : '',
  ].filter(Boolean).join(' — ')

  return (
    <li className={`mt-tnode${active ? ' is-on' : ''}${allDone ? ' is-complete' : ''}`}>
      <span className="mt-tnode__dot" aria-hidden="true">
        {allDone ? <Icon name="check" size={9} /> : null}
      </span>
      <button
        type="button"
        className="mt-tcard"
        onClick={onPick}
        aria-current={active ? 'true' : undefined}
        aria-label={label}
        title={label}
      >
        <span className="mt-tcard__date" aria-hidden="true">
          <span className="mt-tcard__day">{day}</span>
          <span className="mt-tcard__month">{month}</span>
        </span>
        <span className="mt-tcard__ctx" aria-hidden="true">{context}</span>
      </button>
    </li>
  )
}

/** One screen, one story, top to bottom: what I said in the talk → how many
 * goals came out of it → the goals themselves, each with its own next step. */
function ConversationFocus({ conversation, language, updating, helping, onStatus, onHelp, onOpen, onCompose }: {
  conversation: MentoringConversation; language: string; updating: string | null; helping: string | null
  onStatus: (goal: MentoringGoal, status: GoalStatus) => void; onHelp: (goal: MentoringGoal) => void
  onOpen: () => void; onCompose: () => void
}) {
  const { t } = useI18n()
  const goals = conversation.goals || []
  const notes = conversation.notes || ''
  const [expanded, setExpanded] = useState(false)
  // Long notes are hard for a child to scan, so they open on request only.
  const long = notes.length > 170
  // The goals are an accordion: everything stays scannable, and the goal that
  // still needs work is the one already open when the talk is picked.
  const firstActive = goals.find((goal) => goalStatus(goal) !== 'done')?.id ?? null
  const [openGoal, setOpenGoal] = useState<string | null>(firstActive)
  useEffect(() => { setOpenGoal(firstActive) }, [conversation.id, firstActive])

  return (
    <div className="mt-focus">
      <article className="mt-focus__talk">
        <div className="mt-focus__talk-top">
          <div className="mt-focus__label">
            <Icon name="message" size={15} />{t('mentoring.student.focus.saidTitle')}
          </div>
          <span className="mt-focus__meta">
            {formatDate(conversation.date, language)}
            {conversation.teacher_name && ` · ${conversation.teacher_name}`}
          </span>
        </div>
        {notes && (
          <p className={`mt-focus__notes${long && !expanded ? ' is-clamped' : ''}`} dir="auto">{notes}</p>
        )}
        <div className="mt-focus__talk-foot">
          {conversation.meeting_stage && (
            <span className="mt-focus__feeling">
              <Icon name="reflect" size={13} />
              {t('mentoring.student.focus.feeling')}: {feelingLabel(t, conversation.meeting_stage)}
            </span>
          )}
          <div className="mt-focus__talk-actions">
            {long && (
              <button className="mt-text-button" type="button" onClick={() => setExpanded((value) => !value)}>
                {t(expanded ? 'mentoring.student.focus.collapse' : 'mentoring.student.focus.expand')}
              </button>
            )}
            <button className="mt-text-button" type="button" onClick={onOpen}>
              {t('mentoring.student.focus.details')}<Icon name="arrow" size={15} />
            </button>
          </div>
        </div>
      </article>

      {goals.length > 0 ? (
        <>
          {/* The visual bridge: this talk is what produced the goals below. */}
          <div className="mt-flow-link">
            <span className="mt-flow-link__line" aria-hidden="true" />
            <p className="mt-flow-link__pill">
              <Icon name="target" size={14} />
              {goals.length === 1
                ? t('mentoring.student.focus.chosen.one')
                : t('mentoring.student.focus.chosen.many', { count: goals.length })}
            </p>
            <span className="mt-flow-link__line" aria-hidden="true" />
          </div>
          <section className="mt-focus__goals">
            <ul className="mt-goals">
              {goals.map((goal) => (
                <FocusGoal
                  key={goal.id}
                  goal={goal}
                  language={language}
                  updating={updating === goal.id}
                  helping={helping === goal.id}
                  open={openGoal === goal.id}
                  onToggle={() => setOpenGoal((current) => (current === goal.id ? null : goal.id ?? null))}
                  onStatus={(status) => onStatus(goal, status)}
                  onHelp={() => onHelp(goal)}
                />
              ))}
            </ul>
          </section>
        </>
      ) : (
        <p className="mt-journey__empty">{t('mentoring.student.summary.noGoals')}</p>
      )}

      {/* Yuvi sits with the action it belongs to, closing the page instead of
          leaving a long empty tail below the goals. */}
      <aside className="mt-focus__foot">
        <span className="mt-focus__yuvi" aria-hidden="true"><Icon name="spark" size={22} /></span>
        <p>{t('mentoring.student.footer.prompt')}</p>
        <button className="mt-focus__cta" type="button" onClick={onCompose}>
          <Icon name="plus" size={18} /><span>{t('mentoring.student.new')}</span>
        </button>
      </aside>
    </div>
  )
}

// One goal is one compact row a child can scan in a second: name, status, due
// date, the next step in a single line, and one button. Everything else waits
// inside the card until it is opened.
function FocusGoal({ goal, language, updating, helping, open, onToggle, onStatus, onHelp }: {
  goal: MentoringGoal; language: string; updating: boolean; helping: boolean
  open: boolean; onToggle: () => void
  onStatus: (status: GoalStatus) => void; onHelp: () => void
}) {
  const { t } = useI18n()
  const { wallet } = useRewards()
  const status = goalStatus(goal)
  const isDone = status === 'done'
  const overdue = isOverdue(goal)
  // The title may already be the step itself, and then there is nothing to add.
  const step = goal.title && goal.next_steps ? goal.next_steps : ''
  const hasDetail = Boolean(step) || goal.from_yuvi || goal.reward_why || !isDone
  const panelId = `mt-goal-panel-${goal.id}`
  // A single forward move, never a row of look-alike statuses to decode.
  const advance: GoalStatus = status === 'new' ? 'in_progress' : status === 'in_progress' ? 'done' : 'in_progress'
  const advanceLabel = status === 'new'
    ? t('mentoring.student.status.start')
    : status === 'in_progress' ? t('mentoring.student.status.finish') : t('mentoring.student.status.reopen')
  // What this goal is worth, and what the very next move pays — the pull
  // towards finishing is always visible on the goal itself.
  const worth = goal.reward_value || 0
  const nextPayout = isDone ? 0 : stageAmount(goal.reward_value, advance === 'done' ? 'summarized' : 'started', wallet?.rules)

  const summary = (
    <>
      <span className="mt-fgoal__top">
        <span className="mt-fgoal__title" dir="auto">{goal.title || goal.next_steps}</span>
        {worth > 0 && (
          <span className="mt-fgoal__worth" title={t('rewards.goal.worthHint')}>
            <Icon name="spark" size={12} />{t('rewards.goal.worth', { count: worth })}
          </span>
        )}
        <span className={`mt-fgoal__status is-${status}`}>
          {isDone && <Icon name="check" size={11} />}{t(`mentoring.student.status.${status}`)}
        </span>
        {goal.deadline && (
          <span className={`mt-fgoal__when${overdue ? ' is-overdue' : ''}`}>
            <Icon name="calendar" size={13} />
            {t('mentoring.student.goal.due', { date: formatDate(goal.deadline, language) })}
            {overdue && ` · ${t('mentoring.student.status.overdue')}`}
          </span>
        )}
      </span>
      {step && (
        <span className="mt-fgoal__stepline" dir="auto">
          <span className="mt-fgoal__steplabel">{t('mentoring.student.active.nextStep')}:</span> {step}
        </span>
      )}
    </>
  )

  return (
    <li className={`mt-fgoal${isDone ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}${open ? ' is-open' : ''}`}>
      <div className="mt-fgoal__bar">
        {hasDetail ? (
          <button
            type="button"
            className="mt-fgoal__toggle"
            aria-expanded={open}
            aria-controls={panelId}
            title={t(open ? 'mentoring.student.goal.less' : 'mentoring.student.goal.more')}
            onClick={onToggle}
          >
            {summary}
            <Icon name="chevronUp" size={16} className="mt-fgoal__chev" />
          </button>
        ) : (
          <span className="mt-fgoal__toggle is-static">{summary}</span>
        )}
        <button
          className={`mt-fgoal__advance${isDone ? ' is-quiet' : ''}`}
          type="button"
          disabled={updating}
          onClick={() => onStatus(advance)}
        >
          {advanceLabel}
        </button>
      </div>
      {hasDetail && (
        <div className="mt-fgoal__panel" id={panelId} hidden={!open}>
          {step && (
            <p className="mt-fgoal__step" dir="auto">
              <Icon name="arrow" size={13} />{step}
            </p>
          )}
          {goal.reward_why && (
            <p className="mt-fgoal__why" dir="auto">
              <Icon name="spark" size={13} />{goal.reward_why}
            </p>
          )}
          {nextPayout > 0 && (
            <p className="mt-fgoal__payout">
              {t(advance === 'done' ? 'rewards.goal.finishPays' : 'rewards.goal.startPays', { count: nextPayout })}
            </p>
          )}
          <div className="mt-fgoal__extra">
            {goal.from_yuvi && <YuviTag />}
            {!isDone && (goal.needs_help
              ? <span className="mt-jgoal__helped"><Icon name="check" size={13} />{t('mentoring.student.status.helpSent')}</span>
              : <button className="mt-text-button mt-jgoal__help" type="button" disabled={helping} onClick={onHelp}>
                  <Icon name="alert" size={14} />{t('mentoring.student.status.hard')}
                </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function ConversationDetail({ conversation, language, onClose, onDelete, onDeleteGoal }: {
  conversation: MentoringConversation; language: string; onClose: () => void
  onDelete?: () => void; onDeleteGoal?: (goal: MentoringGoal) => void
}) {
  const { t } = useI18n()
  const goals = conversation.goals || []
  return (
    <div className="mt-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="mt-modal" role="dialog" aria-modal="true" aria-labelledby="mt-detail-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="mt-icon-button" type="button" onClick={onClose} aria-label={t('mentoring.student.close')}><Icon name="close" size={21} /></button>
        <p className="mt-student__eyebrow">{formatDate(conversation.date, language)}</p>
        <h2 id="mt-detail-title">{t('mentoring.student.summary.title')}</h2>
        {conversation.teacher_name && <p className="mt-modal__teacher"><Icon name="teacher" size={17} />{conversation.teacher_name}</p>}
        <dl className="mt-modal__details">
          {conversation.meeting_stage && (
            <div><dt>{t('mentoring.student.conversation.feeling')}</dt><dd dir="auto">{feelingLabel(t, conversation.meeting_stage)}</dd></div>
          )}
          <div><dt>{t('mentoring.student.conversation.discussed')}</dt><dd dir="auto">{conversation.notes}</dd></div>
        </dl>
        <h3 className="mt-modal__subtitle">{t('mentoring.student.goals.title')}</h3>
        {goals.length ? (
          <ul className="mt-modal__goals">
            {goals.map((goal) => (
              <li key={goal.id}>
                <strong dir="auto">{goal.title || goal.next_steps}</strong>
                {goal.from_yuvi && <YuviTag />}
                {goal.next_steps && goal.title && <span dir="auto">{goal.next_steps}</span>}
                {goal.deadline && <small>{t('mentoring.student.active.deadline')}: {formatDate(goal.deadline, language)}</small>}
                {onDeleteGoal && goal.id && (
                  <button className="mt-icon-button mt-icon-button--sm" type="button" onClick={() => onDeleteGoal(goal)} aria-label={t('mentoring.student.delete.action')}>
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-modal__empty">{t('mentoring.student.summary.noGoals')}</p>
        )}
        {onDelete && (
          <button className="mt-btn mt-btn--danger" type="button" onClick={onDelete}><Icon name="trash" size={18} />{t('mentoring.student.delete.conversationAction')}</button>
        )}
      </section>
    </div>
  )
}

function DeleteDialog({ kind, busy, error, onCancel, onConfirm }: {
  kind: 'goal' | 'conversation'; busy: boolean; error: boolean; onCancel: () => void; onConfirm: () => void
}) {
  const { t } = useI18n()
  const isGoal = kind === 'goal'
  return (
    <div className="mt-modal-backdrop">
      <section className="mt-modal mt-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mt-delete-title" aria-describedby="mt-delete-description">
        <Icon name="trash" size={24} />
        <h2 id="mt-delete-title">{t(isGoal ? 'mentoring.student.delete.title' : 'mentoring.student.delete.conversationTitle')}</h2>
        <p id="mt-delete-description">{t(isGoal ? 'mentoring.student.delete.description' : 'mentoring.student.delete.conversationDescription')}</p>
        {error && <p className="mt-delete-dialog__error" role="alert">{t('mentoring.student.delete.error')}</p>}
        <div className="mt-composer__actions">
          <button className="mt-btn mt-btn--quiet" type="button" disabled={busy} onClick={onCancel}>{t('mentoring.student.delete.cancel')}</button>
          <button className="mt-btn mt-btn--danger" type="button" disabled={busy} onClick={onConfirm}>{t('mentoring.student.delete.confirm')}</button>
        </div>
      </section>
    </div>
  )
}

function MentoringEmpty({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n()
  const steps = [
    { key: 'document', icon: 'document', tone: 'a' },
    { key: 'goals', icon: 'target', tone: 'b' },
    { key: 'track', icon: 'chart', tone: 'c' },
  ] as const
  return (
    <section className="mt-empty">
      <div className="mt-empty__aside mt-empty__aside--left" aria-hidden="true">
        <div className="mt-ghost-card">
          <span className="mt-ghost-card__label">{t('mentoring.student.empty.aside.lookAhead')}</span>
          <div className="mt-ghost-chart">
            {[42, 66, 52, 82, 60].map((h, i) => <span key={i} style={{ blockSize: `${h}%` }} />)}
          </div>
        </div>
        <div className="mt-ghost-card">
          <span className="mt-ghost-card__label">{t('mentoring.student.empty.aside.yourProgress')}</span>
          <div className="mt-ghost-dotline">{[0, 1, 2, 3, 4].map((i) => <span key={i} />)}</div>
          <p className="mt-ghost-hint">{t('mentoring.student.empty.aside.progressHint')}</p>
        </div>
        <svg className="mt-empty__connector" viewBox="0 0 96 40" fill="none" aria-hidden="true">
          <path className="mt-empty__connector-line" d="M6 22 C 36 22, 48 14, 82 18" />
          <path className="mt-empty__connector-head" d="M74 11 L86 18 L74 25" />
        </svg>
      </div>

      <div className="mt-empty__card">
        <div className="mt-empty__art" aria-hidden="true">
          <svg viewBox="0 0 280 180" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <circle className="mt-empty__blob mt-empty__blob--p" cx="78" cy="104" r="52" />
            <circle className="mt-empty__blob mt-empty__blob--t" cx="150" cy="60" r="46" />
            <circle className="mt-empty__blob mt-empty__blob--c" cx="214" cy="120" r="44" />
            <path className="mt-empty__path" d="M74 150 C 116 150, 120 122, 152 120 S 202 108, 224 92" />
            <g transform="rotate(-8 74 120)">
              <circle className="mt-empty__ring2" cx="74" cy="120" r="26" />
              <circle className="mt-empty__ring2" cx="74" cy="120" r="17" />
              <circle className="mt-empty__ring2" cx="74" cy="120" r="8.5" />
              <circle className="mt-empty__bull" cx="74" cy="120" r="3.4" />
              <path className="mt-empty__dart" d="M96 100 L76 118" />
              <path className="mt-empty__dart-tail" d="M96 100 l8 -3 l-3 8 z" />
            </g>
            <g transform="rotate(-4 128 54)">
              <path className="mt-empty__bubble-p" d="M104 34 h46 a11 11 0 0 1 11 11 v16 a11 11 0 0 1 -11 11 h-28 l-13 11 v-11 h-5 a11 11 0 0 1 -11 -11 v-16 a11 11 0 0 1 11 -11 z" />
              <circle className="mt-empty__bubble-dot" cx="118" cy="53" r="2.6" />
              <circle className="mt-empty__bubble-dot" cx="128" cy="53" r="2.6" />
              <circle className="mt-empty__bubble-dot" cx="138" cy="53" r="2.6" />
            </g>
            <g transform="rotate(7 182 40)">
              <path className="mt-empty__bubble-t" d="M162 24 h38 a10 10 0 0 1 10 10 v13 a10 10 0 0 1 -10 10 h-22 l-11 9 v-9 h-5 a10 10 0 0 1 -10 -10 v-13 a10 10 0 0 1 10 -10 z" />
              <path className="mt-empty__bubble-ln" d="M170 37 h30" />
              <path className="mt-empty__bubble-ln" d="M170 45 h20" />
            </g>
            <path className="mt-empty__hill" d="M186 152 C 200 126, 232 126, 246 152 Z" />
            <path className="mt-empty__pole" d="M216 134 v-34" />
            <path className="mt-empty__flag" d="M216 100 l17 6 l-17 7 z" />
            <path className="mt-empty__spark mt-empty__spark--c" d="M42 46 v12 M36 52 h12" />
            <path className="mt-empty__spark mt-empty__spark--a" d="M250 66 v10 M245 71 h10" />
            <circle className="mt-empty__seed mt-empty__seed--t" cx="150" cy="150" r="3.4" />
            <circle className="mt-empty__seed mt-empty__seed--p" cx="34" cy="96" r="3" />
            <path className="mt-empty__leaf" d="M104 152 c 9 -5 15 -1 15 -1 c 0 0 -3 8 -10 8.5 c -4 0.4 -5 -7.5 -5 -7.5 z" />
          </svg>
        </div>
        <h2 className="mt-empty__title">{t('mentoring.student.empty.title')}</h2>
        <p className="mt-empty__body">{t('mentoring.student.empty.body')}</p>
        <button className="mt-btn mt-empty__cta" type="button" onClick={onCreate}>
          <Icon name="plus" size={18} />{t('mentoring.student.empty.action')}
        </button>
        <ul className="mt-empty__steps">
          {steps.map((s) => (
            <li key={s.key} className={`mt-empty__step mt-empty__step--${s.tone}`}>
              <span className="mt-empty__step-icon"><Icon name={s.icon} size={20} /></span>
              <strong>{t(`mentoring.student.empty.step.${s.key}.title`)}</strong>
              <small>{t(`mentoring.student.empty.step.${s.key}.body`)}</small>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-empty__aside mt-empty__aside--right" aria-hidden="true">
        <div className="mt-ghost-timeline">
          <span className="mt-ghost-timeline__line" />
          {[0, 1, 2].map((i) => (
            <div className="mt-ghost-tl-item" key={i}>
              <span className="mt-ghost-tl-dot" />
              <div className="mt-ghost-card mt-ghost-card--sm">
                <span className="mt-ghost-bar mt-ghost-bar--title" />
                <span className="mt-ghost-bar" />
                <span className="mt-ghost-bar mt-ghost-bar--short" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ConversationComposer({ initialDraft, onPersist, onClear, onClose, onSaved }: {
  initialDraft: ComposerDraft | null
  onPersist: (draft: ComposerDraft) => void
  onClear: () => void
  onClose: () => void
  onSaved: () => void
}) {
  const { t, language, direction } = useI18n()
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(() => Math.min(Math.max(initialDraft?.step ?? 0, 0), COMPOSER_STEPS.length - 1))
  const [feeling, setFeeling] = useState(initialDraft?.feeling ?? '')
  const [notes, setNotes] = useState(initialDraft?.notes ?? '')
  const [goals, setGoals] = useState<GoalDraft[]>(initialDraft?.goals?.length ? initialDraft.goals : [])
  const [feelingOther, setFeelingOther] = useState(
    () => Boolean(initialDraft?.feeling) && !KNOWN_FEELINGS.includes(initialDraft?.feeling ?? ''),
  )
  const [yuviOpen, setYuviOpen] = useState(false)
  const [yuviQA, setYuviQA] = useState<YuviQA[]>([])
  const [yuviQuestion, setYuviQuestion] = useState('')
  const [yuviOptions, setYuviOptions] = useState<string[]>([])
  const [yuviPhase, setYuviPhase] = useState<'asking' | 'ready'>('asking')
  const [yuviBusy, setYuviBusy] = useState(false)
  const [ownMode, setOwnMode] = useState(false)
  const [ownText, setOwnText] = useState('')
  const ownRef = useRef<HTMLInputElement>(null)
  const [rec, setRec] = useState<GoalRecommendation | null>(null)
  const [recLoading, setRecLoading] = useState(false)
  const [recDone, setRecDone] = useState(false)
  const [openGoal, setOpenGoal] = useState<number | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)

  const setGoal = (index: number, patch: Partial<GoalDraft>) =>
    setGoals((current) => current.map((goal, i) => i === index ? { ...goal, ...patch } : goal))
  // A new manual goal opens for editing (accordion — only one open at a time).
  const addGoal = () => { const at = goals.length; setGoals((current) => [...current, { title: '', next_steps: '', deadline: weekFromToday() }]); setOpenGoal(at) }
  const removeGoal = (index: number) => { setGoals((current) => current.filter((_, i) => i !== index)); setOpenGoal(null) }
  const toggleGoal = (index: number) => setOpenGoal((cur) => (cur === index ? null : index))

  // Yuvi = a GUIDED WRITING helper (not a chat): one question + quick chips at a
  // time, and every answer rebuilds the draft below (the saved documentation).
  const askYuvi = async (qa: YuviQA[], more = false) => {
    setYuviBusy(true)
    try {
      const res = await assistMentoring({ language, qa, notes, feeling, more })
      if (qa.length > 0 && typeof res.draft === 'string' && res.draft.trim()) setNotes(res.draft)
      setYuviQuestion(res.question || '')
      setYuviOptions(Array.isArray(res.options) ? res.options : [])
      setYuviPhase(res.phase === 'ready' ? 'ready' : 'asking')
    } catch {
      setYuviQuestion(t('mentoring.student.composer.yuvi.error'))
      setYuviOptions([])
    } finally {
      setYuviBusy(false)
    }
  }

  const openYuvi = () => {
    setYuviOpen(true)
    if (!yuviQuestion) askYuvi(yuviQA)
  }

  // Closing just hides the helper — the draft the child built stays in the box.
  const closeYuvi = () => { setYuviOpen(false); setOwnMode(false); setOwnText('') }

  const answerYuvi = async (text: string) => {
    const answer = text.trim()
    if (!answer || yuviBusy) return
    const nextQA: YuviQA[] = [...yuviQA, { q: yuviQuestion, a: answer }]
    setYuviQA(nextQA)
    setOwnMode(false); setOwnText('')
    await askYuvi(nextQA)
  }

  const moreQuestion = () => { if (!yuviBusy) askYuvi(yuviQA, true) }

  // After the child documents the talk + feeling, Yuvi suggests ONE goal within
  // a one-week window. It is stored server-side on fetch (status "suggested"),
  // so it survives even if the child dismisses it (for future teacher use).
  const acceptRec = () => {
    if (!rec) return
    const goal: GoalDraft = { title: rec.title, next_steps: rec.next_steps, deadline: rec.deadline, from_yuvi: true }
    setGoals((current) => [...current, goal])
    setOpenGoal(null)   // added and complete → show it collapsed
    setRecommendationStatus(rec.id, 'accepted').catch(() => {})
    setRec(null)
  }
  const dismissRec = () => {
    if (!rec) return
    setRecommendationStatus(rec.id, 'dismissed').catch(() => {})
    setRec(null)
  }

  const cleanGoals = goals.filter((goal) => goal.title.trim() || goal.next_steps.trim())
  // A goal must always have a target date — there is no goal without a deadline.
  const goalsValid = cleanGoals.every((goal) => Boolean(goal.deadline))
  const stepValid = [Boolean(feeling.trim()), Boolean(notes.trim()), goalsValid, true]
  const isLast = step === COMPOSER_STEPS.length - 1
  const canSave = stepValid[0] && stepValid[1] && goalsValid

  // Continuously persist a resumable snapshot so a refresh/leave returns here.
  useEffect(() => {
    onPersist({ open: true, step, feeling, notes, goals })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, feeling, notes, goals])

  useEffect(() => {
    if (ownMode) ownRef.current?.focus()
  }, [ownMode])

  // Fetch Yuvi's goal suggestion once, when the child reaches the goals step
  // with a documented talk. Persisted server-side regardless of the outcome.
  useEffect(() => {
    if (step !== 2 || recDone || rec || recLoading || !notes.trim()) return
    setRecLoading(true)
    recommendGoal({ language, notes, feeling })
      .then((r) => { if (r && (r.title || r.next_steps)) setRec(r) })
      .catch(() => {})
      .finally(() => { setRecLoading(false); setRecDone(true) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const goNext = () => { if (stepValid[step] && !isLast) setStep((s) => s + 1) }
  const goBack = () => { if (step > 0) setStep((s) => s - 1) }

  // Closing the wizard is explicit-only: outside clicks never close it, and X
  // asks to confirm. Confirming discards the draft so the next open starts fresh.
  const hasContent = Boolean(feeling.trim()) || Boolean(notes.trim()) || goals.some((g) => g.title.trim() || g.next_steps.trim())
  const discardAndClose = () => { onClear(); onClose() }
  const requestClose = () => { if (hasContent) setConfirmClose(true); else discardAndClose() }

  const submit = async () => {
    if (busy || !canSave) return
    setBusy(true)
    try {
      await createMentoring({
        date: new Date().toISOString().slice(0, 10),
        teacher_name: '', learner_name: '',
        meeting_stage: feeling, notes,
        goals: cleanGoals.map((goal) => ({
          title: goal.title.trim() || goal.next_steps.trim(),
          next_steps: goal.next_steps.trim(),
          deadline: goal.deadline,
          progress_stage: 'chosen',
          from_yuvi: Boolean(goal.from_yuvi),
        })),
        visibility: 'shared', author: 'learner',
      })
      onClear()
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <div className="mt-modal-backdrop" role="presentation">
      <section className="mt-modal mt-composer" role="dialog" aria-modal="true" aria-labelledby="mt-composer-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="mt-icon-button" type="button" onClick={requestClose} aria-label={t('mentoring.student.close')}><Icon name="close" size={21} /></button>
        <div className="mt-composer__intro">
          <span className="mt-composer__badge" aria-hidden="true"><Icon name="message" size={22} /></span>
          <h2 id="mt-composer-title">{t('mentoring.student.composer.heading')}</h2>
          <p className="mt-composer__sub">{t('mentoring.student.composer.lead')}</p>
        </div>

        <ol className="mt-stepper" aria-label={t('mentoring.student.composer.stepsAria')}>
          {COMPOSER_STEPS.map((key, index) => (
            <li key={key} className={index < step ? 'is-complete' : index === step ? 'is-current' : ''}>
              <span>{index < step ? <Icon name="check" size={14} /> : index + 1}</span>
              <small>{t(`mentoring.student.composer.step.${key}`)}</small>
            </li>
          ))}
        </ol>

        <div className="mt-step-body">
          <div className="mt-step-guide">
            <h3>{t(`mentoring.student.composer.guide.${COMPOSER_STEPS[step]}.title`)}</h3>
            <p>{t(`mentoring.student.composer.guide.${COMPOSER_STEPS[step]}.desc`)}</p>
          </div>
          {step === 0 && (
            <div className="mt-field">
              <div className="mt-feeling-options">
                {(['good', 'thoughtful', 'difficult'] as const).map((option) => (
                  <button key={option} type="button" className={!feelingOther && feeling === option ? 'is-selected' : ''} onClick={() => { setFeeling(option); setFeelingOther(false) }}>
                    {t(`mentoring.student.composer.feeling.${option}`)}
                  </button>
                ))}
                {feelingOther ? (
                  <input
                    className="mt-feeling-other"
                    autoFocus
                    value={feeling}
                    onChange={(event) => setFeeling(event.target.value)}
                    placeholder={t('mentoring.student.composer.feeling.otherPlaceholder')}
                    dir={direction}
                    maxLength={80}
                  />
                ) : (
                  <button type="button" onClick={() => { setFeelingOther(true); if (KNOWN_FEELINGS.includes(feeling)) setFeeling('') }}>
                    {t('mentoring.student.composer.feeling.other')}
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="mt-field mt-write">
              {/* Primary — the child writes the documentation here by default */}
              <div className="mt-draft">
                <label className="mt-draft__label" htmlFor="mt-composer-notes">
                  <Icon name="document" size={15} />{t('mentoring.student.composer.draftLabel')}
                </label>
                <textarea id="mt-composer-notes" autoFocus dir={direction} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('mentoring.student.composer.draftPlaceholder')} />
              </div>

              {/* Optional aid — Yuvi, only when the child wants help phrasing */}
              {yuviOpen ? (
                <div className="mt-help" role="group" aria-label={t('mentoring.student.composer.yuvi.helpTitle')}>
                  <div className="mt-help__bar">
                    <span className="mt-yuvi-chat__ava" aria-hidden="true"><Icon name="spark" size={17} /></span>
                    <strong>{t('mentoring.student.composer.yuvi.helpTitle')}</strong>
                    <button type="button" className="mt-icon-button mt-icon-button--sm mt-help__close" onClick={closeYuvi} aria-label={t('mentoring.student.close')}><Icon name="close" size={18} /></button>
                  </div>
                  <div className="mt-help__bubble" dir="auto">
                    {yuviBusy && !yuviQuestion
                      ? <span className="mt-yuvi-typing" aria-label={t('mentoring.student.composer.yuvi.thinking')}><span /><span /><span /></span>
                      : (yuviPhase === 'ready' && !yuviQuestion ? t('mentoring.student.composer.yuvi.ready') : yuviQuestion)}
                  </div>
                  {yuviPhase === 'ready' ? (
                    <div className="mt-help__done">
                      <button type="button" className="mt-btn" onClick={closeYuvi}><Icon name="check" size={16} />{t('mentoring.student.composer.yuvi.finish')}</button>
                      <button type="button" className="mt-help__more" disabled={yuviBusy} onClick={moreQuestion}><Icon name="plus" size={15} />{t('mentoring.student.composer.yuvi.more')}</button>
                    </div>
                  ) : (
                    <>
                      {!ownMode ? (
                        <div className="mt-help__chips">
                          {yuviOptions.map((opt, index) => (
                            <button key={index} type="button" className="mt-chip" disabled={yuviBusy} onClick={() => answerYuvi(opt)} dir="auto">{opt}</button>
                          ))}
                          <button type="button" className="mt-chip mt-chip--own" disabled={yuviBusy} onClick={() => setOwnMode(true)}>
                            <Icon name="message" size={14} />{t('mentoring.student.composer.yuvi.own')}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-help__own">
                          <input ref={ownRef} dir={direction} value={ownText} onChange={(event) => setOwnText(event.target.value)} placeholder={t('mentoring.student.composer.yuvi.ownPlaceholder')} maxLength={300} disabled={yuviBusy} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); answerYuvi(ownText) } }} />
                          <button type="button" className="mt-btn" disabled={yuviBusy || !ownText.trim()} onClick={() => answerYuvi(ownText)}><Icon name="check" size={16} />{t('mentoring.student.composer.yuvi.addToDraft')}</button>
                        </div>
                      )}
                      <button type="button" className="mt-help__more" disabled={yuviBusy} onClick={moreQuestion}>
                        <Icon name="plus" size={15} />{t('mentoring.student.composer.yuvi.more')}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <button type="button" className="mt-help-trigger" onClick={openYuvi}>
                  <Icon name="spark" size={15} />{t('mentoring.student.composer.yuvi.trigger')}
                </button>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="mt-goals-editor">
              {recLoading && (
                <div className="mt-rec mt-rec--loading">
                  <span className="mt-yuvi-chat__ava" aria-hidden="true"><Icon name="spark" size={16} /></span>
                  <span className="mt-yuvi-typing" aria-label={t('mentoring.student.composer.rec.loading')}><span /><span /><span /></span>
                  <span>{t('mentoring.student.composer.rec.loading')}</span>
                </div>
              )}
              {rec && (
                <div className="mt-rec">
                  <div className="mt-rec__head">
                    <span className="mt-yuvi-chat__ava" aria-hidden="true"><Icon name="spark" size={17} /></span>
                    <div><strong>{t('mentoring.student.composer.rec.title')}</strong><small>{t('mentoring.student.composer.rec.aiNote')}</small></div>
                  </div>
                  <p className="mt-rec__goal" dir="auto">{rec.title}</p>
                  {rec.next_steps && <p className="mt-rec__step" dir="auto"><Icon name="check" size={15} />{rec.next_steps}</p>}
                  <p className="mt-rec__when"><Icon name="calendar" size={15} />{t('mentoring.student.composer.rec.within')} · {formatDate(rec.deadline, language)}</p>
                  {rec.rationale && <p className="mt-rec__why" dir="auto">{rec.rationale}</p>}
                  <div className="mt-rec__actions">
                    <button type="button" className="mt-btn" onClick={acceptRec}><Icon name="plus" size={16} />{t('mentoring.student.composer.rec.add')}</button>
                    <button type="button" className="mt-btn mt-btn--quiet" onClick={dismissRec}>{t('mentoring.student.composer.rec.dismiss')}</button>
                  </div>
                </div>
              )}
              {goals.map((goal, index) => {
                const open = openGoal === index
                const label = goal.title.trim() || goal.next_steps.trim()
                const needsDate = Boolean(label) && !goal.deadline
                return (
                  <div className={`mt-goal${open ? ' is-open' : ''}${needsDate ? ' has-warn' : ''}`} key={index}>
                    <button type="button" className="mt-goal__row" onClick={() => toggleGoal(index)} aria-expanded={open}>
                      <Icon name="chevronUp" size={16} className="mt-goal__chev" />
                      <span className={`mt-goal__label${label ? '' : ' is-empty'}`} dir="auto">{label || t('mentoring.student.composer.goalUntitled')}</span>
                      {goal.from_yuvi && <YuviTag />}
                      {needsDate
                        ? <span className="mt-goal__needdate"><Icon name="alert" size={13} />{t('mentoring.student.composer.deadlineMissing')}</span>
                        : <span className="mt-goal__draft">{t('mentoring.student.composer.goalDraftBadge')}</span>}
                    </button>
                    {open && (
                      <div className="mt-goal__body">
                        <input value={goal.title} onChange={(event) => setGoal(index, { title: event.target.value })} placeholder={t('mentoring.student.composer.goal.placeholder')} dir="auto" />
                        <textarea value={goal.next_steps} onChange={(event) => setGoal(index, { next_steps: event.target.value })} placeholder={t('mentoring.student.composer.nextStep.placeholder')} dir="auto" />
                        <label className="mt-goal-editor__date">{t('mentoring.student.composer.when')} *<input type="date" required value={goal.deadline} onChange={(event) => setGoal(index, { deadline: event.target.value })} /></label>
                        {needsDate && <p className="mt-goal__datewarn"><Icon name="alert" size={14} />{t('mentoring.student.composer.deadlineRequired')}</p>}
                        <button type="button" className="mt-btn mt-btn--quiet mt-goal__remove" onClick={() => removeGoal(index)}>
                          <Icon name="trash" size={16} />{t('mentoring.student.composer.removeGoal')}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              {!rec && !recLoading && (
                <button type="button" className="mt-btn mt-btn--quiet mt-goals-editor__add" onClick={addGoal}>
                  <Icon name="plus" size={16} />{t(goals.length ? 'mentoring.student.composer.addAnotherGoal' : 'mentoring.student.composer.addGoal')}
                </button>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="mt-review">
              <div className="mt-review__row"><span>{t('mentoring.student.conversation.feeling')}</span><strong dir="auto">{feeling ? feelingLabel(t, feeling) : '—'}</strong></div>
              <div className="mt-review__row"><span>{t('mentoring.student.conversation.discussed')}</span><strong dir="auto">{notes || '—'}</strong></div>
              <div className="mt-review__goals">
                <span>{t('mentoring.student.goals.title')}</span>
                {cleanGoals.length ? (
                  <ul>
                    {cleanGoals.map((goal, index) => (
                      <li key={index}>
                        <strong dir="auto">{goal.title.trim() || goal.next_steps.trim()}</strong>
                        {goal.from_yuvi && <YuviTag />}
                        {goal.deadline && <small>{t('mentoring.student.active.deadline')}: {formatDate(goal.deadline, language)}</small>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-review__empty">{t('mentoring.student.summary.noGoals')}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-composer__actions">
          {step > 0 ? (
            <button className="mt-btn mt-btn--quiet" type="button" onClick={goBack}>{t('mentoring.student.composer.back')}</button>
          ) : (
            <button className="mt-btn mt-btn--quiet" type="button" onClick={requestClose}>{t('mentoring.student.composer.cancel')}</button>
          )}
          {isLast ? (
            <button className="mt-btn" type="button" disabled={busy || !canSave} onClick={submit}>{t('mentoring.student.composer.save')}</button>
          ) : (
            <button className="mt-btn" type="button" disabled={!stepValid[step]} onClick={goNext}>{t('mentoring.student.composer.next')}</button>
          )}
        </div>
      </section>
    </div>
    {confirmClose && (
      <div className="mt-modal-backdrop mt-confirm-backdrop">
        <section className="mt-modal mt-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mt-close-title" aria-describedby="mt-close-desc">
          <Icon name="alert" size={24} />
          <h2 id="mt-close-title">{t('mentoring.student.composer.close.title')}</h2>
          <p id="mt-close-desc">{t('mentoring.student.composer.close.body')}</p>
          <div className="mt-composer__actions">
            <button className="mt-btn mt-btn--quiet" type="button" onClick={() => setConfirmClose(false)}>{t('mentoring.student.composer.close.stay')}</button>
            <button className="mt-btn mt-btn--danger" type="button" onClick={() => { setConfirmClose(false); discardAndClose() }}>{t('mentoring.student.composer.close.leave')}</button>
          </div>
        </section>
      </div>
    )}
    </>
  )
}
