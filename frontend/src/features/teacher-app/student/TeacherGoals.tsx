/* Goals tab: three AI drafts the teacher edits, and approval → sparks.
 *
 * Two rules the UI is built around.
 *
 * **The AI drafts, the teacher decides.** Suggestions arrive as editable text in
 * a form, never as a one-click "assign this". Nothing the model produced reaches
 * a child's profile without a person having read and confirmed it — and each
 * draft shows the observation it came from, so confirming is an informed act.
 *
 * **Never claim sparks that were not granted.** Approving a goal the learner
 * already summarized pays nothing, because the ledger row exists; the fifth
 * approval of a day pays nothing because of the cap. Both are reported as what
 * they are. Pretending otherwise would be easy and would make the wallet lie.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  EmptyState, Icon, Panel, SectionHeader, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  approveStudentGoal, assignStudentGoal, getGoalSuggestions, getStudentGoals,
  suggestStudentGoals,
  type ApprovalResult, type GoalAction, type GoalConversation, type GoalDraft,
  type StudentGoal,
} from '../../../services/teacher'
import { withFallback } from '../shared/EvidenceDisclosure'
import { describeSignal } from '../shared/evidenceText'
import './teacher-goals.css'

interface Props { learnerId: string }

export function TeacherGoals({ learnerId }: Props) {
  const { t, language } = useI18n()
  const { subject } = useTeacherScope()

  const [conversations, setConversations] = useState<GoalConversation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const [outcome, setOutcome] = useState<ApprovalResult | null>(null)

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    let active = true
    setIsLoading(true)
    getStudentGoals(learnerId)
      .then((result) => { if (active) setConversations(result.conversations ?? []) })
      .catch(() => { if (active) setConversations([]) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [learnerId, nonce])

  const rows = conversations.flatMap((conversation) =>
    (conversation.goals ?? [])
      .filter((goal) => goal.title || goal.next_steps)
      .map((goal) => ({ goal, conversation })))

  const pending = rows.filter(({ goal }) => !goal.approved_by)
  const approved = rows.filter(({ goal }) => goal.approved_by)

  const approve = async (goal: StudentGoal, conversationId: string) => {
    const result = await approveStudentGoal(learnerId, goal.id, conversationId).catch(() => null)
    if (result) { setOutcome(result); reload() }
  }

  if (isLoading) return <div aria-busy="true" style={{ display: 'grid', gap: 'var(--sp-3)' }}><SkeletonCard rows={2} /><SkeletonCard rows={3} /></div>

  return (
    <div className="tch-goals">
      <GoalComposer
        learnerId={learnerId}
        language={language}
        subject={subject ?? undefined}
        onAssigned={reload}
      />

      {outcome ? <ApprovalOutcome result={outcome} onDismiss={() => setOutcome(null)} /> : null}

      <section>
        <SectionHeader
          title={t('tch.goals.pending')}
          subtitle={t('tch.goals.pending.hint', { count: pending.length })}
        />
        {pending.length ? (
          <ul className="tch-goals__list">
            {pending.map(({ goal, conversation }) => (
              <GoalRow
                key={goal.id}
                goal={goal}
                onApprove={() => void approve(goal, conversation.id)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState title={t('tch.goals.pending.none')} />
        )}
      </section>

      {approved.length ? (
        <section>
          <SectionHeader title={t('tch.goals.approved')} />
          <ul className="tch-goals__list">
            {approved.map(({ goal }) => <GoalRow key={goal.id} goal={goal} />)}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function GoalRow({ goal, onApprove }: { goal: StudentGoal; onApprove?: () => void }) {
  const { t } = useI18n()
  return (
    <li className="tch-goal">
      <div className="tch-goal__head">
        <strong dir="auto">{goal.title}</strong>
        <div className="tch-goal__meta">
          <StatusPill tone={goal.approved_by ? 'strong' : 'neutral'}>
            {withFallback(
              t(`tch.goals.stage.${goal.progress_stage}`),
              `tch.goals.stage.${goal.progress_stage}`,
              goal.progress_stage,
            )}
          </StatusPill>
          {goal.reward_value ? (
            <span className="tch-goal__sparks">
              <Icon name="spark" size={13} aria-hidden="true" />
              {goal.reward_value}
            </span>
          ) : null}
        </div>
      </div>
      {goal.next_steps ? <p className="tch-goal__steps" dir="auto">{goal.next_steps}</p> : null}
      <GoalProgressLine goal={goal} />
      {goal.deadline ? (
        <span className="tch-goal__deadline">{t('tch.goals.deadline', { date: goal.deadline })}</span>
      ) : null}
      {onApprove ? (
        <button type="button" className="sp-btn sp-btn--sm" onClick={onApprove}>
          {t('tch.goals.approve')}
        </button>
      ) : (
        <span className="tch-goal__approved">
          {t('tch.goals.approvedAt', { date: (goal.approved_at ?? '').slice(0, 10) })}
        </span>
      )}
    </li>
  )
}

/** What the platform counted for an action-tracked goal: "hints used 3/5 ✓".
 *  Exported for the class Goals page — the same number must read the same
 *  everywhere. Goals without an action render nothing, exactly as before. */
export function GoalProgressLine({ goal }: { goal: StudentGoal }) {
  const { t } = useI18n()
  const progress = goal.progress
  if (!progress) return null
  return (
    <p className={`tch-goal__progress${progress.met ? ' tch-goal__progress--met' : ''}`}
       dir="auto">
      <Icon name={progress.met ? 'check' : 'target'} size={13} aria-hidden="true" />
      {t(`tch.goals.action.${progress.kind}`)}
      {' · '}
      {t('tch.goals.action.count', { count: progress.count, target: progress.target })}
      {progress.met ? ` · ${t('tch.goals.action.met')}` : ''}
    </p>
  )
}

/** Says exactly what happened, including when that is "nothing". */
function ApprovalOutcome({ result, onDismiss }: {
  result: ApprovalResult
  onDismiss: () => void
}) {
  const { t } = useI18n()
  const key = result.already_approved ? 'tch.goals.outcome.already'
    : result.already_earned ? 'tch.goals.outcome.alreadyEarned'
    : result.capped ? 'tch.goals.outcome.capped'
    : 'tch.goals.outcome.granted'
  return (
    <div className="tch-goals__outcome" role="status">
      <p dir="auto">{t(key, { sparks: result.granted })}</p>
      <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onDismiss}>
        {t('tch.goals.outcome.dismiss')}
      </button>
    </div>
  )
}

/** Exported for the class Goals page: same composer, student chosen outside.
 *  `framed=false` drops the Panel so a host card doesn't nest cards. */
export function GoalComposer({ learnerId, language, subject, onAssigned, framed = true }: {
  learnerId: string
  language: string
  subject?: string
  onAssigned: () => void
  framed?: boolean
}) {
  const { t } = useI18n()
  const [drafts, setDrafts] = useState<GoalDraft[] | null>(null)
  const [madeAt, setMadeAt] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [title, setTitle] = useState('')
  const [steps, setSteps] = useState('')
  const [deadline, setDeadline] = useState('')
  /* The countable action of the draft in use. Hand-written goals carry none —
     the platform cannot promise to count something it was never told about. */
  const [action, setAction] = useState<GoalAction | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  /* What was suggested last time, if anything — read only, no model call. A
     teacher who was here yesterday sees the same three today, immediately,
     instead of a button that spends a request to say the same thing. */
  useEffect(() => {
    let active = true
    setDrafts(null); setMadeAt(null); setStale(false)
    getGoalSuggestions(learnerId, language, subject)
      .then((result) => {
        if (!active || !result.goals?.length) return
        setDrafts(result.goals)
        setMadeAt(result.generated_at)
        setStale(result.stale)
      })
      .catch(() => {})
    return () => { active = false }
  }, [learnerId, language, subject])

  const suggest = async () => {
    setIsSuggesting(true)
    const result = await suggestStudentGoals(learnerId, language, subject).catch(() => null)
    setDrafts(result?.goals ?? [])
    setMadeAt(result?.generated_at ?? null)
    setStale(false)
    setIsSuggesting(false)
  }

  const use = (draft: GoalDraft) => {
    setTitle(draft.title)
    setSteps(draft.next_steps)
    setDeadline(draft.deadline)
    setAction(draft.action ?? null)
  }

  const assign = async () => {
    if (!title.trim()) return
    setIsSaving(true)
    await assignStudentGoal(
      learnerId, { title: title.trim(), next_steps: steps.trim(), deadline, action }, language
    ).catch(() => null)
    setTitle(''); setSteps(''); setDeadline(''); setAction(null)
    setIsSaving(false)
    onAssigned()
  }

  const Frame = framed ? Panel : 'div'
  return (
    <Frame className="tch-composer" data-tour="teacher.goalComposer">
      <SectionHeader title={t('tch.goals.compose')} subtitle={t('tch.goals.compose.hint')} />

      {/* Asked for once. There is no button to press again for a different
          answer to the same question: three grounded suggestions that change on
          every press are three suggestions a teacher learns to disbelieve, and
          the re-roll is paid for each time. New observations bring new ones —
          nothing else does. */}
      {!drafts?.length || stale ? (
        <button
          type="button"
          className="sp-btn sp-btn--sm sp-btn--ghost"
          onClick={() => void suggest()}
          disabled={isSuggesting}
        >
          <Icon name="wand" size={15} aria-hidden="true" />
          {isSuggesting ? t('tch.goals.suggesting')
            : stale ? t('tch.goals.suggest.again') : t('tch.goals.suggest')}
        </button>
      ) : null}

      {drafts?.length && madeAt ? (
        <p className="tch-composer__made" dir="auto">
          {t(stale ? 'tch.goals.suggest.moved' : 'tch.goals.suggest.made', {
            /* The page's language, not the browser's: `8/12/2026` inside a
               Hebrew sentence is an American date nobody on this screen reads. */
            date: new Date(madeAt).toLocaleDateString(
              language === 'he' ? 'he-IL' : language === 'ar' ? 'ar' : 'en-GB',
              { day: 'numeric', month: 'short' }),
          })}
        </p>
      ) : null}

      {drafts?.length ? (
        <ul className="tch-drafts">
          {drafts.map((draft, index) => (
            <DraftCard key={`${draft.title}:${index}`} draft={draft} onUse={() => use(draft)} />
          ))}
        </ul>
      ) : drafts ? (
        <EmptyState title={t('tch.goals.noSuggestions')} body={t('tch.goals.noSuggestions.body')} />
      ) : null}

      <div className="tch-composer__form">
        {/* At the fields, not only in the section header: a teacher typing a
            title must know the child is the reader, or the goal comes out as
            an instruction to themselves (the #253 voice bug, by hand). */}
        <p className="tch-composer__audience" dir="auto">
          <Icon name="spark" size={13} aria-hidden="true" />
          {t('tch.goals.field.audience')}
        </p>
        <label>
          <span>{t('tch.goals.field.title')}</span>
          <input className="sp-input" value={title} dir="auto"
                 onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <span>{t('tch.goals.field.steps')}</span>
          <textarea className="sp-input" rows={2} value={steps} dir="auto"
                    onChange={(event) => setSteps(event.target.value)} />
        </label>
        <label>
          <span>{t('tch.goals.field.deadline')}</span>
          <input className="sp-input" type="date" value={deadline}
                 onChange={(event) => setDeadline(event.target.value)} />
        </label>
        <button
          type="button"
          className="sp-btn sp-btn--sm"
          disabled={!title.trim() || isSaving}
          onClick={() => void assign()}
        >
          {t('tch.goals.assign')}
        </button>
      </div>
    </Frame>
  )
}

function DraftCard({ draft, onUse }: { draft: GoalDraft; onUse: () => void }) {
  const { t, language } = useI18n()
  const [open, setOpen] = useState(false)

  // No evidence means no grounded suggestion. Saying so is the honest answer;
  // three plausible invented goals would be exactly the failure this refuses.
  if (draft.unavailable) {
    return (
      <li className="tch-draft tch-draft--empty">
        <p dir="auto">{t('tch.goals.noSuggestions.body')}</p>
      </li>
    )
  }

  return (
    <li className="tch-draft">
      <div className="tch-draft__card">
        <div className="tch-draft__head">
          <strong dir="auto">{draft.title}</strong>
          <StatusPill tone={draft.ai ? 'strong' : 'neutral'}>
            {draft.ai ? t('tch.goals.draft.ai') : t('tch.goals.draft.derived')}
          </StatusPill>
        </div>
        {draft.next_steps ? <p dir="auto">{draft.next_steps}</p> : null}
        {draft.rationale ? (
          <p className="tch-draft__why" dir="auto">{draft.rationale}</p>
        ) : null}
        {/* This goal will be measured: which platform action, how many times.
            Shown before assigning, so the tracking is a promise the teacher
            made knowingly, not a surprise on the goals screen. */}
        {draft.action ? (
          <p className="tch-goal__progress" dir="auto">
            <Icon name="target" size={13} aria-hidden="true" />
            {t(`tch.goals.action.${draft.action.kind}`)}
            {' · '}
            {t('tch.goals.action.perWeek', { target: draft.action.target })}
          </p>
        ) : null}

        <button
          type="button"
          className="tch-evidence__toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={open ? 'chevronUp' : 'chevronLeft'} size={13} aria-hidden="true" />
          {t('tch.evidence.why')}
        </button>
        {/* One sentence, keyed off the signal — the same treatment a
            recommendation gets. This used to print the whole evidence payload
            the model was given: the struggle list, the challenge dicts and the
            description CONTAINER, rendered as `label: value` lines. A teacher
            asking "why this goal?" was answered with `blocks [object Object]`
            and `events since generation 4`. */}
        {open ? (
          <div className="tch-draft__because">
            {describeSignal(draft.because.signal, draft.because.value,
                            draft.because.raw, t, language)
              .map((sentence, index) => <p key={index} dir="auto">{sentence}</p>)}
          </div>
        ) : null}

        <button type="button" className="sp-btn sp-btn--sm sp-btn--ghost" onClick={onUse}>
          {t('tch.goals.draft.use')}
        </button>
      </div>
    </li>
  )
}
