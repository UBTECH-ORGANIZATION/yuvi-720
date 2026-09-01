import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRoute } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import {
  Icon, LoadingState, ErrorState,
} from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useRewards } from '../../providers/RewardsProvider'
import { getLearnerState, updateLearnerState } from '../../services/api'
import {
  createMentoring, deleteGoal, deleteConversation, listMentoring, updateGoalProgress, assistMentoring,
  recommendGoal, setRecommendationStatus, requestGoalHelp,
  type MentoringConversation, type MentoringGoal, type GoalProgressStage, type YuviQA, type GoalRecommendation,
} from '../../services/mentoring'
import {
  buildDayGroups, goalStatus, isOverdue, STATUS_TO_STAGE,
  type DayGroup, type GoalStatus,
} from './goalTimeline'
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

/** Day + short month, for the quiet "which talk did this come from" line. */
function shortDayMonth(value: string | undefined, language: string) {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(date)
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

/** Near dates are named, not spelled out — a child reads "today" faster. */
function dayLabel(t: (key: string) => string, language: string, date: string): string {
  if (!date) return t('mentoring.student.day.noDate')
  const now = new Date()
  if (date === now.toISOString().slice(0, 10)) return t('mentoring.student.day.today')
  now.setDate(now.getDate() + 1)
  if (date === now.toISOString().slice(0, 10)) return t('mentoring.student.day.tomorrow')
  return formatDate(date, language)
}

/** Students may remove only conversations they documented — teacher talks are protected. */
function canDeleteConversation(conversation: MentoringConversation): boolean {
  return conversation.author === 'learner'
}

function feelingLabel(t: (key: string) => string, feeling: string): string {
  return KNOWN_FEELINGS.includes(feeling) ? t(`mentoring.student.composer.feeling.${feeling}`) : feeling
}

/** `/mentoring` is a learner surface: document a conversation with the teacher and
 * capture the goals set in it. Teachers have their own lane (`/teacher`). */
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
  // Finished days are folded away so the page opens on what still needs doing.
  const [showEarlier, setShowEarlier] = useState(false)
  const route = useRoute()
  const draftTimer = useRef<number | undefined>(undefined)

  const load = () => {
    setRows(null)
    setError(false)
    listMentoring()
      .then((response) => setRows(response.conversations))
      .catch(() => setError(true))
  }

  /* Deep link from a notification: `/mentoring?conversation=…&goal=…`.
     Without this the bell can only say "something happened" and leave the kid to
     go and find it, which is the difference between a notification and an
     announcement. Every goal is on the page now, so this only has to scroll to
     the right one and flash it. */
  const [flashGoalId, setFlashGoalId] = useState<string | null>(null)
  useEffect(() => {
    if (!rows?.length) return
    const params = new URLSearchParams(route.split('?')[1] ?? '')
    const goalId = params.get('goal')
    if (!goalId) return
    /* Deliberately NOT cleared on a timer. A timer-driven highlight is at the
       mercy of every other re-render on this page — the goal list refetches, the
       effect re-runs, and the marker blinks out early or twice. The CSS
       animation runs once and ends on its own, so the class can simply stay. */
    setFlashGoalId(goalId)
    // A finished goal lives in a folded day; scrolling to something still
    // hidden would land the child on nothing at all.
    if (buildDayGroups(rows).some((group) =>
      group.settled && group.entries.some((entry) => entry.goal.id === goalId))) {
      setShowEarlier(true)
    }
    // Wait a frame for that day to render before scrolling.
    const raf = window.requestAnimationFrame(() => {
      document.querySelector(`[data-goal-id="${goalId}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })

    return () => window.cancelAnimationFrame(raf)
  }, [rows, route])

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
      .catch(() => { })
  }, [])

  // Persist the draft: a "paused" (open:false) snapshot flushes immediately so a
  // fast refresh won't re-pop the modal; edits while open are debounced.
  const persistDraft = useCallback((next: ComposerDraft) => {
    setDraft(next)
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    if (!next.open) {
      updateLearnerState({ mentoring_draft: next }).catch(() => { })
      return
    }
    draftTimer.current = window.setTimeout(() => {
      updateLearnerState({ mentoring_draft: next }).catch(() => { })
    }, 600)
  }, [])

  const clearDraft = useCallback(() => {
    setDraft(null)
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    updateLearnerState({ mentoring_draft: null }).catch(() => { })
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

  const groups = useMemo(() => buildDayGroups(rows || []), [rows])
  const settled = groups.filter((group) => group.settled)
  const live = groups.filter((group) => !group.settled)
  const settledCount = settled.reduce((total, group) => total + group.entries.length, 0)

  const renderDay = (group: DayGroup) => (
    <section className={`mt-day${group.late ? ' is-late' : ''}`} key={group.key}>
      <h2 className="mt-day__head">
        <Icon name="calendar" size={14} />
        <span className="mt-day__label">{dayLabel(t, language, group.date)}</span>
        {group.late && <span className="mt-day__late">{t('mentoring.student.status.overdue')}</span>}
      </h2>
      <ul className="mt-goals">
        {group.entries.map(({ goal, conversation }) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            conversation={conversation}
            language={language}
            updating={updatingId === goal.id}
            helping={helpingId === goal.id}
            flash={flashGoalId === goal.id}
            onStatus={(status) => changeStatus(goal, conversation, status)}
            onHelp={() => requestHelp(goal, conversation)}
            onOpenTalk={() => setDetail(conversation)}
          />
        ))}
      </ul>
    </section>
  )

  return (
    <>
      <LearnerAppBar />
      <main className={`mt-wrap mt-student${groups.length > 0 ? '' : ' mt-student--sparse'}`}>
        <header className="mt-student__hero">
          <p className="mt-student__eyebrow">{t('mentoring.student.eyebrow')}</p>
          <h1>{t('mentoring.student.title')}</h1>
          <p>{t('mentoring.student.subtitle')}</p>
        </header>

        {error ? (
          <ErrorState title={t('mentoring.error')} />
        ) : rows === null ? (
          <LoadingState title={t('mentoring.loading')} />
        ) : groups.length === 0 ? (
          <MentoringEmpty onCreate={() => setComposerOpen(true)} />
        ) : (
          <>
            <section className="mt-duelist" aria-label={t('mentoring.student.goals.eyebrow')}>
              {settled.length > 0 && (
                <>
                  <button
                    type="button"
                    className={`mt-duelist__earlier${showEarlier ? ' is-open' : ''}`}
                    aria-expanded={showEarlier}
                    onClick={() => setShowEarlier((value) => !value)}
                  >
                    <Icon name="chevronUp" size={15} className="mt-duelist__chev" />
                    {t('mentoring.student.timeline.earlier', { count: settledCount })}
                  </button>
                  {showEarlier && settled.map(renderDay)}
                </>
              )}
              {live.map(renderDay)}
            </section>

            {/* Yuvi sits with the action it belongs to, closing the page instead
                of leaving a long empty tail below the goals. */}
            <aside className="mt-focus__foot">
              <span className="mt-focus__yuvi" aria-hidden="true"><Icon name="spark" size={22} /></span>
              <p>{t('mentoring.student.footer.prompt')}</p>
              <button className="mt-focus__cta" type="button" onClick={() => setComposerOpen(true)}>
                <Icon name="plus" size={18} /><span>{t('mentoring.student.new')}</span>
              </button>
            </aside>
          </>
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

// A timeline of the days goals are due, so the strip of talk dates is gone:
// the child navigates by when work is owed, not by when it was agreed.

/** One goal, as a child needs to read it: what to do, what it is worth, and
 * one button. The due date is the heading it sits under, so it is not repeated
 * here, and the talk it came from is a quiet line at the foot — present, but
 * no longer the thing organising the screen. */
function GoalCard({ goal, conversation, language, updating, helping, flash, onStatus, onHelp, onOpenTalk }: {
  goal: MentoringGoal; conversation: MentoringConversation; language: string
  updating: boolean; helping: boolean
  /** Goal the notification deep link pointed at; briefly highlighted. */
  flash: boolean
  onStatus: (status: GoalStatus) => void; onHelp: () => void; onOpenTalk: () => void
}) {
  const { t } = useI18n()
  const status = goalStatus(goal)
  const isDone = status === 'done'
  const overdue = isOverdue(goal)
  // The title may already be the step itself, and then there is nothing to add.
  const step = goal.title && goal.next_steps ? goal.next_steps : ''
  // A single forward move, never a row of look-alike statuses to decode. The
  // button is also the only place the status is stated: a separate chip said
  // the same thing twice.
  const advance: GoalStatus = status === 'in_progress' ? 'done' : 'in_progress'
  const advanceLabel = status === 'new'
    ? t('mentoring.student.status.start')
    : status === 'in_progress' ? t('mentoring.student.status.finish') : t('mentoring.student.status.reopen')
  /* One spark figure, and it is the goal's worth. Finishing settles whatever is
     left of that value server-side, so the number here is what the learner ends
     up with — which is why the old "finishing pays N" line is gone rather than
     corrected: two numbers for one goal read as a contradiction. */
  const worth = goal.reward_value || 0

  return (
    <li
      /* Anchor for the notification deep link — the bell scrolls to this and
         flashes it, so a kid lands on the goal itself rather than on a list. */
      data-goal-id={goal.id}
      className={`mt-dgoal${isDone ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}${flash ? ' is-flash' : ''}`}
    >
      <div className="mt-dgoal__row">
        <div className="mt-dgoal__main">
          <p className="mt-dgoal__title" dir="auto">
            {isDone && <Icon name="check" size={14} className="mt-dgoal__tick" />}
            {goal.title || goal.next_steps}
          </p>
          {step && <p className="mt-dgoal__step" dir="auto">{step}</p>}
        </div>
        {worth > 0 && (
          <span className="mt-dgoal__worth" title={t('rewards.goal.worthHint')}>
            <Icon name="spark" size={12} />{t('rewards.goal.worth', { count: worth })}
          </span>
        )}
        <button
          className={`mt-dgoal__advance${isDone ? ' is-quiet' : ''}`}
          type="button"
          disabled={updating}
          onClick={() => onStatus(advance)}
        >
          {advanceLabel}
        </button>
      </div>
      <div className="mt-dgoal__foot">
        {goal.from_yuvi && <YuviTag />}
        {!isDone && (goal.needs_help
          ? <span className="mt-dgoal__helped"><Icon name="check" size={13} />{t('mentoring.student.status.helpSent')}</span>
          : <button className="mt-text-button mt-dgoal__help" type="button" disabled={helping} onClick={onHelp}>
            <Icon name="alert" size={14} />{t('mentoring.student.status.hard')}
          </button>
        )}
        <button className="mt-text-button mt-dgoal__talk" type="button" onClick={onOpenTalk}>
          <Icon name="message" size={13} />
          {t('mentoring.student.goal.fromTalk', { date: shortDayMonth(conversation.date, language) })}
        </button>
      </div>
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
    setRecommendationStatus(rec.id, 'accepted').catch(() => { })
    setRec(null)
  }
  const dismissRec = () => {
    if (!rec) return
    setRecommendationStatus(rec.id, 'dismissed').catch(() => { })
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
      .catch(() => { })
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
