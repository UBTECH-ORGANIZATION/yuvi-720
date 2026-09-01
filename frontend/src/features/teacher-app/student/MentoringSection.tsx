/* The child's mentoring center, on the child's page (#497).
 *
 * The profile used to show five live goals and send the teacher to the class
 * mentoring screen for everything else — approving a finished goal, rereading
 * a talk, documenting a new one. But the profile is where a teacher stands
 * when they are thinking about ONE child, so the whole loop lives here now:
 *
 *   what is waiting for me      — this child's finished goals, approve in place
 *   what is live                — the open goals, with what the platform counted
 *   what we talked about        — the documented conversations, newest first
 *   and both doors              — תיעוד שיחה (the full composer) and a quick goal
 *
 * The class mentoring page keeps the class-wide versions of the same answers;
 * everything per-child deep-links back to this section (`#goals`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Icon, Panel, SectionHeader, SkeletonRows,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import {
  approveStudentGoal, getStudentGoals,
  type GoalConversation, type StudentGoal,
} from '../../../services/teacher'
import { ConversationLog } from '../goals/ConversationLog'
import { GoalDialog } from '../goals/GoalDialog'
import { goalTitle, stateOf } from '../goals/goalState'
import { MentoringComposer } from '../goals/MentoringComposer'
import {
  emptyDraft, newDraftId, useMentoringDraft,
} from '../goals/teacherMentoringDraft'

/** Talks shown before "show all" — the log is a record, not the headline. */
const TALKS_SHOWN = 2

/** The goal's counted progress as one small chip — `3/1` with a ✓ when met.
 *
 *  The full sentence the chip replaces ("ניסיון חוזר אחרי טעות · 3 מתוך 1 ·
 *  בוצע בפועל", plus the quality basis under it) moved to the chip's tooltip:
 *  at approve time the teacher needs the fraction and the check; the wording
 *  is evidence they read once, not furniture every row repeats. */
function ProgressChip({ goal }: { goal: StudentGoal }) {
  const { t } = useI18n()
  const progress = goal.progress
  if (!progress) return null
  const quality = progress.quality ?? null
  const tip = [
    [
      t(`tch.goals.action.${progress.kind}`),
      t('tch.goals.action.count', { count: progress.count, target: progress.target }),
      progress.met ? t('tch.goals.action.met') : null,
    ].filter(Boolean).join(' · '),
    quality && quality.chatted > 0
      ? t('tch.goals.quality.basis', {
          chatted: quality.chatted, substantive: quality.substantive })
      : null,
  ].filter(Boolean).join('\n')
  return (
    <span
      className={`tch-mentoringSec__prog${progress.met ? ' is-met' : ''}`}
      title={tip}
      aria-label={tip}
    >
      <Icon name={progress.met ? 'check' : 'target'} size={12} aria-hidden />
      <span dir="ltr">{progress.count}/{progress.target}</span>
    </span>
  )
}

export function MentoringSection({ learnerId, name }: { learnerId: string; name: string }) {
  const { t } = useI18n()
  const [conversations, setConversations] = useState<GoalConversation[] | null>(null)
  const [version, setVersion] = useState(0)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [allTalks, setAllTalks] = useState(false)
  const [isComposing, setComposing] = useState(false)
  /* The same server-held draft the mentoring page uses — ONE write-up per
     teacher, resumable from either screen. `teacherId` rides along and is
     what lets the log offer delete only on this teacher's own records. */
  const { draft, teacherId, persist, clear } = useMentoringDraft()

  const reload = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => {
    let active = true
    getStudentGoals(learnerId)
      .then((response) => {
        if (!active) return
        setConversations([...(response.conversations ?? [])]
          .sort((a, b) => (b.date || '').localeCompare(a.date || '')))
      })
      .catch(() => { if (active) setConversations([]) })
    return () => { active = false }
  }, [learnerId, version])

  const rows = useMemo(() => (conversations ?? []).flatMap((conversation) =>
    (conversation.goals ?? [])
      .filter((goal) => goal.title || goal.next_steps)
      .map((goal) => ({ goal, conversation }))), [conversations])

  /* Finished and waiting for the one step only a teacher can take — the
     profile's copy of the mentoring page's inbox, already narrowed to this
     child. Everything else (open goals included) stays inside the talk log,
     where each goal wears its state chip. */
  const pending = rows.filter(({ goal }) => stateOf(goal) === 'done')

  const approve = async (goal: StudentGoal, conversationId: string) => {
    const result = await approveStudentGoal(learnerId, goal.id, conversationId)
      .catch(() => null)
    if (!result) { setOutcome(t('tch.error')); return }
    setOutcome(
      result.already_approved ? t('tch.goals.outcome.already')
        : result.capped ? t('tch.goals.outcome.capped')
          : result.granted > 0
            ? t('tch.goals.outcome.granted', { sparks: result.granted })
            : t('tch.goals.outcome.noSparks'))
    reload()
  }

  const shownTalks = allTalks
    ? (conversations ?? [])
    : (conversations ?? []).slice(0, TALKS_SHOWN)

  return (
    <section id="goals" className="tch-student__goals">
      <Panel className="tch-goalsCard tch-mentoringSec">
        <SectionHeader
          title={t('tch.nav.goals')}
          action={(
            <span className="tch-mentoringSec__actions">
              <button
                type="button"
                className="sp-btn sp-btn--sm"
                aria-expanded={Boolean(draft?.open)}
                onClick={() => (draft?.open
                  ? persist({ ...draft, open: true })
                  : persist(emptyDraft(learnerId, newDraftId())))}
              >
                <Icon name="note" size={14} aria-hidden />
                {draft?.open ? t('tch.mentoring.resume') : t('tch.mentoring.create')}
              </button>
              <button
                type="button"
                className="sp-btn sp-btn--ghost sp-btn--sm"
                onClick={() => setComposing(true)}
              >
                <Icon name="plus" size={14} aria-hidden />
                {t('tch.goalsPage.create')}
              </button>
            </span>
          )}
        />

        {outcome ? (
          <p className="tch-goalsPage__outcome" role="status" dir="auto">{outcome}</p>
        ) : null}

        {conversations === null ? (
          <SkeletonRows rows={3} />
        ) : (
          /* Two lanes across the full row — the goals waiting for the teacher
             at the inline start, the talk log beside them — so the record
             reads sideways instead of stacking down the page. No standing
             list of the open goals: they already live as state-toned chips
             on the talks they came out of. */
          <div className="tch-mentoringSec__cols">
            {/* ── waiting for the teacher — the only step nobody else can do ── */}
            <div className="tch-mentoringSec__col">
              <h4 className="tch-mentoringSec__subhead">
                {t('tch.goalsPage.pending')}
              </h4>
              {pending.length ? (
                <ul className="tch-goalsPage__pendingGoals">
                  {pending.map(({ goal, conversation }) => (
                    /* One line per goal: title, the counted evidence as a
                       chip (sentence on hover), sparks, the button. */
                    <li key={goal.id} className="tch-goalsPage__pendingRow">
                      <span className="tch-goalsPage__goalTitle" dir="auto">
                        {goalTitle(goal, t)}
                      </span>
                      <ProgressChip goal={goal} />
                      {goal.reward_value ? (
                        <span className="tch-goalsPage__sparks">
                          <Icon name="spark" size={13} aria-hidden />
                          {goal.reward_value}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="sp-btn sp-btn--primary sp-btn--sm"
                        onClick={() => void approve(goal, conversation.id)}
                      >
                        {t('tch.goals.approve')}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tch-goalsCard__none">{t('tch.student.pendingNone')}</p>
              )}
            </div>

            {/* ── the documented talks — the record behind the lane beside ── */}
            <div className="tch-mentoringSec__col">
              <h4 className="tch-mentoringSec__subhead">{t('tch.student.talks')}</h4>
              {conversations.length ? (
                <>
                  <ConversationLog
                    learnerId={learnerId}
                    conversations={shownTalks}
                    teacherId={teacherId}
                    onChanged={reload}
                    compact
                  />
                  {conversations.length > TALKS_SHOWN && !allTalks ? (
                    <button
                      type="button"
                      className="sp-btn sp-btn--ghost sp-btn--sm tch-mentoringSec__more"
                      onClick={() => setAllTalks(true)}
                    >
                      <Icon name="chevronDown" size={14} aria-hidden />
                      {t('tch.student.talksAll', { count: conversations.length })}
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="tch-goalsCard__none">{t('tch.mentoring.history.never')}</p>
              )}
            </div>
          </div>
        )}
      </Panel>

      {/* The full write-up, this child already chosen. The same server draft
          as the mentoring page's composer — start here, finish there. */}
      {draft?.open ? (
        <MentoringComposer
          open
          draft={draft}
          candidates={[{ id: learnerId, name }]}
          onDraft={persist}
          onClose={clear}
          onSaved={() => { clear(); reload() }}
        />
      ) : null}

      <GoalDialog
        open={isComposing}
        learnerId={learnerId}
        candidates={[{ id: learnerId, name }]}
        onPick={() => { /* one candidate, already chosen */ }}
        onClose={() => setComposing(false)}
        onAssigned={() => { setComposing(false); reload() }}
      />
    </section>
  )
}
