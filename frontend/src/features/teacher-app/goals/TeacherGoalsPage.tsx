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
 * rows, and a term of conversations does the same thing to the history:
 *
 *   the inbox groups by child — one row per student, opened on demand, so the
 *   question it answers is "who is waiting for me", not "which goal is 7th";
 *   the history below it does the same for conversations, newest first,
 *   because a term of talks across thirty children is a page nobody scrolls;
 *   one search box filters both, over student names AND goal titles.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  EmptyState, ErrorState, Icon, Panel, SectionHeader, Skeleton, SkeletonCard,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  approveStudentGoal, getGroupGoals, getGroupSnapshot,
  type GoalConversation, type StudentGoal,
} from '../../../services/teacher'
import { Modal } from '../../../components/primitives/Modal'
import { ConversationHistory } from './ConversationHistory'
import { goalTitle, stateOf, STATE_TONE, type GoalState } from './goalState'
import { MentoringComposer } from './MentoringComposer'
import { emptyDraft, newDraftId, useMentoringDraft } from './teacherMentoringDraft'
import './teacher-goals-page.css'
import { StudentAvatar } from '../shared/StudentAvatar'
import { GoalProgressLine } from '../student/TeacherGoals'

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
  const {
    groupId, isLoading: scopeLoading, subgroupId, subgroupLearnerIds,
  } = useTeacherScope()

  const [rows, setRows] = useState<LearnerGoals[] | null>(null)
  const [names, setNames] = useState<Map<string, string | null>>(new Map())
  const [error, setError] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  /* One write-up at a time, kept on the server — see `teacherMentoringDraft`.
     `picking` is the step before it exists: who is this conversation about. */
  const { draft, teacherId, persist, clear } = useMentoringDraft()
  const [picking, setPicking] = useState(false)
  /* The picker's own needle, separate from the page's: narrowing who you are
     about to write about should not also narrow the history behind the modal. */
  const [pickQuery, setPickQuery] = useState('')
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

  /* The scope's sub-group, applied exactly: each row is one child, so the
     narrowing is a membership check, not an approximation. Derived per render
     from the provider — never copied — for the same reason as the roster. */
  const scopedRows = useMemo(() => {
    if (!subgroupId) return rows
    const inScope = new Set(subgroupLearnerIds)
    return (rows ?? []).filter((learner) => inScope.has(learner.learner_id))
  }, [rows, subgroupId, subgroupLearnerIds])

  /* Waiting-for-you, grouped by child. The unit of the teacher's attention is
     the student, not the goal — fourteen rows from one child is one decision
     with fourteen clicks in it. */
  const pendingGroups = useMemo(() => {
    const byLearner = new Map<string, PendingRow[]>()
    for (const learner of scopedRows ?? []) {
      for (const conversation of learner.conversations) {
        for (const goal of conversation.goals) {
          if (stateOf(goal) !== 'done') continue
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
  }, [scopedRows, matches, nameOf])

  const pendingTotal = pendingGroups.reduce((sum, group) => sum + group.goals.length, 0)

  const pickable = useMemo(() => {
    const needle = pickQuery.trim().toLowerCase()
    return [...names.entries()]
      .filter(([learnerId, displayName]) =>
        !needle || (displayName ?? learnerId).toLowerCase().includes(needle))
      .sort((a, b) => (a[1] ?? a[0]).localeCompare(b[1] ?? b[0]))
  }, [names, pickQuery])


  const busy = scopeLoading || (rows === null && !error)
  if (error) return <ErrorState title={t('tch.error')} />
  if (!busy && !groupId) return <EmptyState title={t('tch.noGroups')} />

  // Always collapsed on open: the panel's first answer is WHO is waiting and
  // how much; the goal list behind a name is a deliberate second click.
  const isOpen = (learnerId: string) => toggled[learnerId] ?? false

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
            className="sp-btn sp-btn--sm"
            data-tour="teacher.goalCreate"
            aria-expanded={Boolean(draft?.open) || picking}
            onClick={() => (draft?.open ? persist({ ...draft, open: true }) : setPicking(true))}
          >
            <Icon name="plus" size={15} aria-hidden />
            {draft?.open ? t('tch.mentoring.resume') : t('tch.mentoring.create')}
          </button>
        </div>
      </header>

      {/* Who the conversation was with, before anything is written. Separate
          from the composer because it is answered once and never revisited —
          a picker sitting above the write-up for three steps is a control the
          teacher has already finished with. */}
      <Modal open={picking} onClose={() => { setPicking(false); setPickQuery('') }}
             titleId="tch-mentoring-pick" className="tch-pickDialog">
        <h2 id="tch-mentoring-pick" dir="auto">{t('tch.mentoring.pick.title')}</h2>
        <p className="tch-goalsPage__composeHint">{t('tch.mentoring.pick.body')}</p>
        {/* A search box and a grid, because a class is forty children. As a
            single scrolling column of names it was a list you read rather than
            a set you pick from: the child you want is below the fold and the
            only way to reach them is to scroll past everyone else. */}
        <label className="tch-pickDialog__search">
          <Icon name="search" size={15} aria-hidden="true" />
          <span className="sp-sr-only">{t('tch.goalsPage.searchLabel')}</span>
          <input className="sp-input sp-input--pill" type="search" autoFocus
                 value={pickQuery} placeholder={t('tch.mentoring.pick.search')}
                 onChange={(event) => setPickQuery(event.target.value)} />
        </label>
        {pickable.length ? (
          <ul className="tch-pickDialog__list">
            {pickable.map(([learnerId, displayName]) => (
              <li key={learnerId}>
                <button type="button" onClick={() => {
                  setPicking(false)
                  setPickQuery('')
                  persist(emptyDraft(learnerId, newDraftId()))
                }}>
                  <StudentAvatar learnerId={learnerId} name={displayName ?? learnerId} size={30} />
                  <span><bdi>{displayName ?? learnerId}</bdi></span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tch-goalsPage__composeHint">{t('tch.goalsPage.noMatches')}</p>
        )}
      </Modal>

      {/* A goal is the output of a conversation, so the conversation is what
          gets written. Several goals can come out of one talk, and they land
          as one record rather than as unrelated assignments. */}
      {draft?.open ? (
        <MentoringComposer
          open
          draft={draft}
          candidates={[...names.entries()].map(([learnerId, displayName]) => ({
            id: learnerId, name: displayName ?? learnerId,
          }))}
          onDraft={persist}
          onClose={clear}
          onSaved={() => { clear(); load() }}
        />
      ) : null}

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
                          {/* What the platform counted — the approval is a
                              judgement, and this is its evidence. */}
                          <GoalProgressLine goal={row.goal} />
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

      {/* ── the talks held with each student ──────────────────────────────── */}
      {/* This was the class goals board. The board answered "what goals does
          each child have", which the student profile answers better and with
          more room; what nothing answered was "when did I last sit down with
          this child, and what came out of it" — even though every goal has
          been stored inside a conversation since the beginning. */}
      <SectionHeader title={t('tch.mentoring.history.title')}
                     subtitle={t('tch.mentoring.history.subtitle')} />
      {busy ? (
        <div className="tch-goalsPage__board">
          {[0, 1, 2, 3].map((index) => <SkeletonCard key={index} rows={3} />)}
        </div>
      ) : (
        <ConversationHistory
          learners={scopedRows ?? []}
          nameOf={nameOf}
          matches={matches}
          searching={Boolean(query.trim())}
          teacherId={teacherId}
          onChanged={load}
        />
      )}
    </div>
  )
}

/* Re-exported: these lived here before the history needed them too, and
   `goalState` is now the definition. */
export { goalTitle, stateOf, STATE_TONE }
export type { GoalState }
