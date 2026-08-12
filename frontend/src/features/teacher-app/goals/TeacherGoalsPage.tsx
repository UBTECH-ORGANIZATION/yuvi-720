/* The class goals workspace — the loop in one place.
 *
 * Extracted from the per-student profile because the profile answers "how is
 * this child doing" while the everyday goals question is the inverse: "across
 * my class, what is waiting for ME?" That inbox — completed goals a teacher has
 * not yet approved — is the top of the page, because approval is the step that
 * pays the student their sparks (A4b) and it is the one only a teacher can do.
 *
 * Both halves are bounded, because real classes break flat lists. One student
 * with fourteen finished goals turned the inbox into fourteen near-identical
 * rows and their board card into a column twice the height of the page:
 *
 *   the inbox groups by child — one row per student, opened on demand, so the
 *   question it answers is "who is waiting for me", not "which goal is 7th";
 *   the board card shows a mix line plus the four goals that need reading, and
 *   defers the rest to the profile;
 *   one search box filters both, over student names AND goal titles.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  EmptyState, ErrorState, Icon, Panel, SectionHeader, Skeleton, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  approveStudentGoal, getGroupGoals, getGroupSnapshot,
  type GoalConversation, type StudentGoal,
} from '../../../services/teacher'
import { GoalDialog } from './GoalDialog'
import './teacher-goals-page.css'
import { StudentAvatar } from '../shared/StudentAvatar'

interface LearnerGoals {
  learner_id: string
  conversations: GoalConversation[]
}

interface PendingRow {
  learnerId: string
  conversationId: string
  goal: StudentGoal
}

export function TeacherGoalsPage() {
  const { t, language } = useI18n()
  const { groupId, isLoading: scopeLoading } = useTeacherScope()

  const [rows, setRows] = useState<LearnerGoals[] | null>(null)
  const [names, setNames] = useState<Map<string, string | null>>(new Map())
  const [error, setError] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const [composeFor, setComposeFor] = useState<string>('')
  const [query, setQuery] = useState('')
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  const load = useCallback(() => {
    if (!groupId) return
    let active = true
    Promise.all([
      getGroupGoals(groupId),
      getGroupSnapshot(groupId, language),
    ])
      .then(([goals, snapshot]) => {
        if (!active) return
        setRows(goals.learners)
        setNames(new Map(
          (snapshot.students ?? []).map((row) => [row.learner_id, row.display_name])))
      })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [groupId, language])

  useEffect(() => { setRows(null); return load() }, [load])

  const nameOf = useCallback(
    (learnerId: string) => names.get(learnerId) ?? learnerId, [names])

  /* One needle over both halves of the page: a teacher looking for "מוטי" and
     a teacher looking for "טלפון" are asking the same kind of question. */
  const matches = useCallback((learnerId: string, title: string) => {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return nameOf(learnerId).toLowerCase().includes(needle)
      || (title ?? '').toLowerCase().includes(needle)
  }, [query, nameOf])

  /* Waiting-for-you, grouped by child. The unit of the teacher's attention is
     the student, not the goal — fourteen rows from one child is one decision
     with fourteen clicks in it. */
  const pendingGroups = useMemo(() => {
    const byLearner = new Map<string, PendingRow[]>()
    for (const learner of rows ?? []) {
      for (const conversation of learner.conversations) {
        for (const goal of conversation.goals) {
          if (goal.progress_stage !== 'summarized' || goal.approved_by) continue
          if (!matches(learner.learner_id, goal.title)) continue
          const list = byLearner.get(learner.learner_id) ?? []
          list.push({ learnerId: learner.learner_id, conversationId: conversation.id, goal })
          byLearner.set(learner.learner_id, list)
        }
      }
    }
    return [...byLearner.entries()]
      .map(([learnerId, goals]) => ({ learnerId, goals }))
      .sort((a, b) => b.goals.length - a.goals.length
        || nameOf(a.learnerId).localeCompare(nameOf(b.learnerId)))
  }, [rows, matches, nameOf])

  const pendingTotal = pendingGroups.reduce((sum, group) => sum + group.goals.length, 0)

  /* The board. Goals are ordered by what a teacher needs to read first, and the
     card shows the head of that list — never the whole tail. */
  const RANK: Record<string, number> = { help: 0, done: 1, active: 2, approved: 3 }

  const board = useMemo(() => (rows ?? [])
    .map((learner) => {
      const goals = learner.conversations
        .flatMap((conversation) => conversation.goals)
        .filter((goal) => matches(learner.learner_id, goal.title))
      const counts = { active: 0, help: 0, done: 0, approved: 0 }
      for (const goal of goals) counts[stateOf(goal) as keyof typeof counts] += 1
      return {
        learnerId: learner.learner_id,
        counts,
        goals: [...goals].sort((a, b) => RANK[stateOf(a)] - RANK[stateOf(b)]),
      }
    })
    // A learner with no goals stays on the board, as an explicit empty card:
    // hiding them let the compose picker offer a child who then disappeared,
    // and "nobody has set them a goal yet" is exactly what this screen is for.
    // Under a search they are dropped, because they match nothing.
    .filter((learner) => learner.goals.length > 0 || !query.trim())
    .sort((a, b) => nameOf(a.learnerId).localeCompare(nameOf(b.learnerId))),
  [rows, matches, nameOf, query])

  const busy = scopeLoading || (rows === null && !error)
  if (error) return <ErrorState title={t('tch.error')} />
  if (!busy && !groupId) return <EmptyState title={t('tch.noGroups')} />

  // Collapsed only when there is enough volume for grouping to be the point.
  const defaultOpen = pendingTotal <= 4
  const isOpen = (learnerId: string) => toggled[learnerId] ?? defaultOpen
  const BOARD_PREVIEW = 4

  const approve = async (row: PendingRow) => {
    const result = await approveStudentGoal(row.learnerId, row.goal.id, row.conversationId)
      .catch(() => null)
    if (!result) { setOutcome(t('tch.error')); return }
    setOutcome(
      result.already_approved ? t('tch.goals.outcome.already')
        : result.capped ? t('tch.goals.outcome.capped')
          : result.granted > 0
            ? t('tch.goals.outcome.granted', { sparks: result.granted })
            : t('tch.goals.outcome.noSparks'))
    load()
  }

  return (
    <div className="tch-goalsPage" aria-busy={busy || undefined}>
      {/* Header, create button and search do not wait on the fetch — only the
          two data regions below do, so nothing shifts when they arrive. */}
      <header className="tch-goalsPage__head">
        <div className="tch-goalsPage__headText">
          <h1>{t('tch.goalsPage.title')}</h1>
          <p className="tch-goalsPage__subtitle">{t('tch.goalsPage.subtitle')}</p>
        </div>
        <div className="tch-goalsPage__headTools">
          <label className="tch-goalsPage__search">
            <Icon name="search" size={15} aria-hidden="true" />
            <span className="sp-sr-only">{t('tch.goalsPage.searchLabel')}</span>
            <input
              className="sp-input sp-input--pill"
              type="search"
              value={query}
              placeholder={t('tch.goalsPage.searchPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="sp-btn sp-btn--primary sp-btn--sm"
            data-tour="teacher.goalCreate"
            aria-expanded={isComposing}
            onClick={() => setIsComposing((value) => !value)}
          >
            <Icon name="plus" size={15} aria-hidden />
            {t('tch.goalsPage.create')}
          </button>
        </div>
      </header>

      {/* Creating a goal is a dialog now, with the reason for the goal beside
          the goal. Inline, it pushed the whole board down the page while the
          teacher filled it in — and there was nowhere to put the context that
          makes the decision a decision. */}
      <GoalDialog
        open={isComposing}
        learnerId={composeFor}
        candidates={[...names.entries()].map(([learnerId, displayName]) => ({
          id: learnerId, name: displayName ?? learnerId,
        }))}
        onPick={setComposeFor}
        onClose={() => { setIsComposing(false); setComposeFor('') }}
        onAssigned={() => { setIsComposing(false); setComposeFor(''); load() }}
      />

      {/* ── waiting for the teacher — the only step nobody else can do ────── */}
      <Panel className="tch-goalsPage__inbox" data-tour="teacher.goalInbox">
        <SectionHeader
          title={t('tch.goalsPage.pending')}
          subtitle={busy ? '' : pendingGroups.length
            ? t('tch.goalsPage.pendingSubGrouped',
                { count: pendingTotal, students: pendingGroups.length })
            : t('tch.goalsPage.pendingSub', { count: 0 })}
        />
        {outcome ? <p className="tch-goalsPage__outcome" dir="auto">{outcome}</p> : null}
        {busy ? (
          <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            {[0, 1].map((index) => <Skeleton key={index} w="100%" h={44} />)}
          </div>
        ) : pendingGroups.length ? (
          <ul className="tch-goalsPage__pendingList">
            {pendingGroups.map((group) => {
              const open = isOpen(group.learnerId)
              return (
                <li key={group.learnerId} className="tch-goalsPage__pendingGroup">
                  <button
                    type="button"
                    className="tch-goalsPage__pendingHead"
                    aria-expanded={open}
                    onClick={() => setToggled(
                      (state) => ({ ...state, [group.learnerId]: !open }))}
                  >
                    <StudentAvatar learnerId={group.learnerId}
                                   name={nameOf(group.learnerId)} size={30} />
                    <strong dir="auto">{nameOf(group.learnerId)}</strong>
                    <span className="tch-goalsPage__pendingCount">
                      {t('tch.goalsPage.pendingCount', { count: group.goals.length })}
                    </span>
                    <Icon
                      name="chevronUp"
                      size={15}
                      aria-hidden
                      className={`tch-goalsPage__chevron${open ? ' is-open' : ''}`}
                    />
                  </button>
                  {open ? (
                    <ul className="tch-goalsPage__pendingGoals">
                      {group.goals.map((row) => (
                        <li key={row.goal.id} className="tch-goalsPage__pendingRow">
                          <span className="tch-goalsPage__goalTitle" dir="auto">
                            {goalTitle(row.goal, t)}
                          </span>
                          {row.goal.reward_value ? (
                            <span className="tch-goalsPage__sparks">
                              <Icon name="spark" size={13} aria-hidden />
                              {row.goal.reward_value}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className="sp-btn sp-btn--primary sp-btn--sm"
                            onClick={() => void approve(row)}
                          >
                            {t('tch.goals.approve')}
                          </button>
                        </li>
                      ))}
                      <li className="tch-goalsPage__pendingFoot">
                        <button
                          type="button"
                          className="sp-btn sp-btn--ghost sp-btn--sm"
                          onClick={() => navigate(`/teacher/student/${group.learnerId}`)}
                        >
                          {t('tch.goalsPage.openProfile')}
                        </button>
                      </li>
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="tch-goalsPage__quiet">
            <Icon name="check" size={15} aria-hidden />
            {query.trim() ? t('tch.goalsPage.noMatches') : t('tch.goalsPage.nothingPending')}
          </p>
        )}
      </Panel>

      {/* ── the board: every student's goals, at a glance ─────────────────── */}
      <SectionHeader title={t('tch.goalsPage.board')} />
      {busy ? (
        <div className="tch-goalsPage__board">
          {[0, 1, 2, 3].map((index) => <SkeletonCard key={index} rows={3} />)}
        </div>
      ) : board.length ? (
        <div className="tch-goalsPage__board">
          {board.map((learner) => {
            const hidden = learner.goals.length - BOARD_PREVIEW
            return (
              <Panel key={learner.learnerId} className="tch-goalsPage__student">
                <button
                  type="button"
                  className="tch-goalsPage__studentHead"
                  onClick={() => navigate(`/teacher/student/${learner.learnerId}`)}
                >
                  <StudentAvatar learnerId={learner.learnerId}
                                 name={nameOf(learner.learnerId)} size={30} />
                  <strong dir="auto">{nameOf(learner.learnerId)}</strong>
                  <Icon name="chevronLeft" size={14} aria-hidden />
                </button>
                {/* The mix first — the shape of this child's goal load in one
                    line, so the four titles below are a sample, not a summary. */}
                <p className="tch-goalsPage__mix" hidden={!learner.goals.length}>
                  {t('tch.goalsPage.mix', {
                    active: learner.counts.active + learner.counts.help,
                    pending: learner.counts.done,
                    approved: learner.counts.approved,
                  })}
                </p>
                {learner.goals.length ? null : (
                  <p className="tch-goalsPage__none">{t('tch.goalsPage.noGoalsYet')}</p>
                )}
                <ul className="tch-goalsPage__goals">
                  {learner.goals.slice(0, BOARD_PREVIEW).map((goal) => (
                    <li key={goal.id} className="tch-goalsPage__goal" dir="auto">
                      <span className="tch-goalsPage__goalText">{goalTitle(goal, t)}</span>
                      <StatusPill tone={STATE_TONE[stateOf(goal)]}>
                        {t(`tch.goalsPage.state.${stateOf(goal)}`)}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
                {hidden > 0 ? (
                  <button
                    type="button"
                    className="tch-goalsPage__more"
                    onClick={() => navigate(`/teacher/student/${learner.learnerId}`)}
                  >
                    {t('tch.goalsPage.moreGoals', { count: hidden })}
                  </button>
                ) : null}
              </Panel>
            )
          })}
        </div>
      ) : (
        <EmptyState
          title={query.trim() ? t('tch.goalsPage.noMatches') : t('tch.goalsPage.empty')}
          body={query.trim() ? undefined : t('tch.goalsPage.emptyBody')}
        />
      )}
    </div>
  )
}

/** The one definition of what state a goal is in.
 *
 *  It was written twice — once for the sort and the counts, once inline in the
 *  pill — so the board could rank a goal as "needs help" and label it "active".
 */
export type GoalState = 'approved' | 'done' | 'help' | 'active'

export function stateOf(goal: StudentGoal): GoalState {
  if (goal.approved_by) return 'approved'
  if (goal.progress_stage === 'summarized') return 'done'
  if (goal.needs_help) return 'help'
  return 'active'
}

const STATE_TONE: Record<GoalState, 'strong' | 'steady' | 'support' | 'neutral'> = {
  approved: 'strong', done: 'steady', help: 'support', active: 'neutral',
}

/** A goal whose title is a bare identifier is labelled, never printed raw.
 *
 *  Seed and imported goals arrive titled "בדיקת לולאת יעדים 1785912066705".
 *  Rendering that verbatim puts a database key in front of a teacher as if it
 *  were the name of something a child is working on.
 */
export function goalTitle(
  goal: StudentGoal, t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const title = (goal.title ?? '').trim()
  if (!title) return t('tch.goalsPage.untitled')
  // A long run of digits is an id, not a name a person typed.
  const cleaned = title.replace(/\s*\b\d{10,}\b\s*/g, ' ').trim()
  return cleaned || t('tch.goalsPage.untitled')
}
