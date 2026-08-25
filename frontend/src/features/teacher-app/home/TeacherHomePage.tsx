/* Teacher home (F6 group level) — the #450 refactor.
 *
 * One question, answered top to bottom: which of my students is fine, which is
 * wobbling, which needs me today. In order:
 *   1. Greeting          — a person saying hello, not a data header
 *   2. Three KPIs        — each with a tooltip stating its own calculation
 *   3. Every student     — one deterministic band each (red/orange/green),
 *                          recent movers marked "new", click for the whys;
 *                          the door to the live view sits on this card
 *   4. The class book    — the week's top moments as a page-turning book
 *   5. Gaps → sub-groups — the shared difficulties card, actions attached
 *
 * The AI brief hero, the attention inbox, the live card and two KPIs are
 * gone: they reported the same child three ways. What replaced them is
 * deterministic end to end — no model call anywhere on this page — and
 * nothing compares one student to another: bands are per-child judgements
 * with evidence, never a ranking.
 */

import { useEffect, useRef, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  EmptyState, ErrorState, Hint, Icon, Skeleton, SkeletonCard,
} from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useAuth } from '../../../providers/AuthProvider'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  createSubgroup,
  getGroupEngagement, getGroupGaps, getGroupMoments, getGroupSnapshot,
  type Engagement, type GroupInsight, type LearningGap,
  type Moment,
} from '../../../services/teacher'
import { DifficultiesCard, type DifficultyItem } from '../shared/DifficultiesCard'
import { StudentFacepile } from '../shared/StudentFacepile'
import { SubgroupDialog } from '../students/SubgroupDialog'
import { TaskBuilder } from '../tasks/TeacherTasksPage'
import { type TaskSeed } from '../tasks/taskSeed'
import { MomentsAlbum } from '../moments/MomentsAlbum'
import { type Band } from './BandFace'
import { type BandedStudent } from './bandModel'
import { gapToDifficultyItem, mostBlockingGap } from './gapsModel'
import { StudentBandDialog } from './StudentBandDialog'
import { StudentsBandCard } from './StudentsBandCard'
import './teacher-home.css'

export function TeacherHomePage() {
  const { t, language } = useI18n()
  const { user } = useAuth()
  const {
    groupId, group, subgroup, subgroupLearnerIds,
    isLoading: scopeLoading, error: scopeError, refreshSubgroups,
  } = useTeacherScope()

  const [snapshot, setSnapshot] = useState<GroupInsight | null>(null)
  const [engagement, setEngagement] = useState<Engagement | null>(null)
  const [gaps, setGaps] = useState<LearningGap[]>([])
  const [moments, setMoments] = useState<Moment[]>([])
  const [momentsLoading, setMomentsLoading] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  const [bandFilter, setBandFilter] = useState<Band | null>(null)
  const [openStudent, setOpenStudent] = useState<BandedStudent | null>(null)
  const bandsRef = useRef<HTMLElement | null>(null)
  const gapsRef = useRef<HTMLDivElement | null>(null)

  const [builderSeed, setBuilderSeed] = useState<TaskSeed | null>(null)
  const [subgroupFor, setSubgroupFor] = useState<DifficultyItem | null>(null)
  const [subgroupBusy, setSubgroupBusy] = useState(false)
  const [subgroupError, setSubgroupError] = useState('')

  useEffect(() => {
    if (!groupId) { setIsLoading(false); return }
    let active = true
    setIsLoading(true)
    setError(false)
    Promise.all([
      getGroupSnapshot(groupId, language),
      getGroupEngagement(groupId),
      /* No subject: the scope bar says the subject filter does not apply here,
         and a gaps panel that quietly narrowed anyway would make that a lie. */
      getGroupGaps(groupId, language),
    ])
      .then(([snapshotResult, engagementResult, gapsResult]) => {
        if (!active) return
        setSnapshot(snapshotResult)
        setEngagement(engagementResult)
        setGaps(gapsResult.gaps)
      })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [groupId, language])

  /* The album fans out across every learner, so it loads on its own rather
     than holding up the numbers. Its own loading flag, though: "not fetched
     yet" and "a week with nothing in it" are opposite things — the quiet week
     is a real, designed page — and an empty list looks like both until the
     fetch lands. Without this the quiet week flashed on every load. */
  useEffect(() => {
    if (!groupId) return
    let active = true
    setMoments([])
    setMomentsLoading(true)
    getGroupMoments(groupId, language)
      .then((response) => { if (active) setMoments(response.moments ?? []) })
      .catch(() => { if (active) setMoments([]) })
      .finally(() => { if (active) setMomentsLoading(false) })
    return () => { active = false }
  }, [groupId, language])

  /* The greeting: the hour decides the wording, the account decides the name.
     Deterministic — this replaced a model-written brief on purpose. */
  const hour = new Date().getHours()
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  const name = (user?.display_name || user?.username || '').trim()
  const greeting = name
    ? t(`tch.home.greeting.${part}`, { name })
    : t(`tch.home.greetingPlain.${part}`)

  const busy = scopeLoading || isLoading
  if (scopeError || error) return <ErrorState title={t('tch.error')} />

  const students = (snapshot?.students ?? []) as unknown as BandedStudent[]
  const rosterNames = new Map(
    (snapshot?.students ?? []).map((row) => [row.learner_id, row.display_name])
  )

  const focusGaps = () => {
    gapsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const saveSubgroup = async (draft: { name: string; learnerIds: string[] }) => {
    if (!groupId) return
    setSubgroupBusy(true)
    setSubgroupError('')
    try {
      const created = await createSubgroup(groupId, draft.name, draft.learnerIds)
      refreshSubgroups(created)
      setSubgroupFor(null)
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      setSubgroupError(t(
        code === 'name_taken' ? 'tch.subgroups.error.nameTaken'
          : code === 'too_many_subgroups' ? 'tch.subgroups.error.tooMany'
            : 'tch.subgroups.error.generic'))
    } finally {
      setSubgroupBusy(false)
    }
  }

  /* Loading paints the SAME frame: greeting real from the first frame, the
     zone bodies placeholders. Nothing moves when the data lands. */
  if (busy) {
    return (
      <div className="tch-home" aria-busy="true">
        <header className="tch-home__head">
          <h1 dir="auto">{greeting}</h1>
        </header>
        <section className="tch-zone" aria-label={t('tch.pulse.title')}>
          <div className="tch-stats">
            {[0, 1, 2].map((index) => <SkeletonCard key={index} rows={1} />)}
          </div>
        </section>
        <section className="sp-panel tch-bands" aria-hidden="true">
          <Skeleton w="40%" h={18} />
          <SkeletonCard rows={5} />
        </section>
      </div>
    )
  }
  if (!groupId) return <EmptyState title={t('tch.noGroups')} />

  const gapItems = gaps.filter((gap) => gap.kind === 'gap')
    .map((gap) => gapToDifficultyItem(gap, t))
  const blockingGap = mostBlockingGap(gaps)
  const strengths = gaps.filter((gap) => gap.kind === 'strength')

  return (
    <div className="tch-home">
      {/* ── a person saying hello ──────────────────────────────────────────── */}
      <header className="tch-home__head">
        <h1 dir="auto">{greeting}</h1>
      </header>

      {/* ── three numbers, each explaining itself ──────────────────────────── */}
      <section className="tch-zone" data-tour="teacher.pulse" aria-label={t('tch.pulse.title')}>
        <div className="tch-stats">
          <Hint text={t('tch.kpi.engagement.hint', { days: engagement?.window_days ?? 7 })}>
            <div className="tch-stat">
              <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
                <Icon name="users" size={18} />
              </span>
              <span className="tch-stat__text">
                <strong className="tch-stat__value">{engagement?.active_pct ?? 0}%</strong>
                <span className="tch-stat__label">{t('tch.pulse.engagement')}</span>
                <span className="tch-stat__hint">
                  {t('tch.pulse.activeOf', {
                    active: engagement?.active_students ?? 0,
                    total: engagement?.students_total ?? 0,
                    days: engagement?.window_days ?? 7,
                  })}
                </span>
              </span>
            </div>
          </Hint>

          <Hint text={t('tch.kpi.avgMinutes.hint')}>
            <div className="tch-stat">
              <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
                <Icon name="clock" size={18} />
              </span>
              <span className="tch-stat__text">
                {/* Honest about missing timing rather than a confident 0. */}
                <strong className="tch-stat__value">
                  {engagement?.timing_available && engagement.avg_active_minutes !== null
                    ? engagement.avg_active_minutes
                    : '—'}
                </strong>
                <span className="tch-stat__label">{t('tch.pulse.avgMinutes')}</span>
                <span className="tch-stat__hint">
                  {engagement?.timing_available
                    ? t('tch.pulse.minutesPerLearner')
                    : t('tch.pulse.noTiming')}
                </span>
              </span>
            </div>
          </Hint>

          {/* Not a count of people but a teaching decision: the topic holding
              the class back most, and one click to the row that can turn it
              into a task or a sub-group. "Who needs me" is answered directly
              below by the students card, which groups and explains every
              child — a number here only said it twice. */}
          <Hint text={t('tch.kpi.blockingTopic.hint')}>
            {blockingGap ? (
              <button
                type="button"
                className="tch-stat tch-stat--button"
                onClick={focusGaps}
                aria-label={t('tch.kpi.blockingTopic.open', { label: blockingGap.label })}
              >
                <span className="tch-stat__icon tch-stat__icon--warn" aria-hidden="true">
                  <Icon name="target" size={18} />
                </span>
                <span className="tch-stat__text">
                  <strong className="tch-stat__value tch-stat__value--topic" dir="auto">
                    {blockingGap.label}
                  </strong>
                  <span className="tch-stat__label">{t('tch.kpi.blockingTopic')}</span>
                  <span className="tch-stat__hint">
                    {t('tch.kpi.blockingTopic.of', {
                      count: blockingGap.struggling_count,
                      total: blockingGap.group_size,
                    })}
                  </span>
                </span>
              </button>
            ) : (
              <div className="tch-stat">
                <span className="tch-stat__icon tch-stat__icon--success" aria-hidden="true">
                  <Icon name="target" size={18} />
                </span>
                <span className="tch-stat__text">
                  <strong className="tch-stat__value">—</strong>
                  <span className="tch-stat__label">{t('tch.kpi.blockingTopic')}</span>
                  <span className="tch-stat__hint">{t('tch.kpi.blockingTopic.none')}</span>
                </span>
              </div>
            )}
          </Hint>
        </div>
      </section>

      {/* ── every student, one band each ───────────────────────────────────── */}
      <StudentsBandCard
        ref={bandsRef}
        students={students}
        subgroupLearnerIds={subgroupLearnerIds}
        subgroupName={subgroup?.name ?? null}
        bandFilter={bandFilter}
        onBandFilter={setBandFilter}
        onOpenStudent={setOpenStudent}
      />

      {/* ── gaps become sub-group moves the teacher approves ───────────────── */}
      <div data-tour="teacher.gaps" ref={gapsRef}>
      <DifficultiesCard
        className="tch-home__gaps"
        title={t('tch.gaps.card.title')}
        subtitle={t('tch.gaps.card.subtitle')}
        items={gapItems}
        names={rosterNames}
        emptyLabel={t('tch.gaps.none')}
        onBuildTask={(seed) => setBuilderSeed(seed)}
        onCreateSubgroup={(item) => setSubgroupFor(item)}
      />
      </div>

      {/* Strengths stay — quiet, under the gaps. (The sub-group teaching
          recommendations block was removed by request.) */}
      {strengths.length > 0 && (
        <section className="sp-panel tch-home__quiet">
          <div className="tch-home__strengths">
            <h4>{t('tch.gaps.group.strengths')}</h4>
            <ul>
              {strengths.map((gap) => (
                <li key={gap.objective_id}>
                  <bdi dir="auto">{gap.label}</bdi>
                  <StudentFacepile
                    learnerIds={gap.mastered_ids ?? []}
                    names={rosterNames}
                    label={t('tch.gaps.who.aria')}
                    heading={t('tch.gaps.who.strength')}
                    size={20}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── the week as a book — the page's finale: scrolling down to it pins
             the view, the closed cover fills it, and the book opens ─────────── */}
      <MomentsAlbum
        moments={moments}
        isLoading={momentsLoading}
        nameOf={(id) => rosterNames.get(id) ?? null}
        groupName={group?.name ?? null}
        groupId={group?.id ?? null}
      />

      <StudentBandDialog student={openStudent} onClose={() => setOpenStudent(null)} />

      {/* The task builder in place, seeded from a gap row — same wiring as the
          lomda screen, so the two surfaces stay one habit. */}
      <Modal
        open={builderSeed !== null}
        onClose={() => setBuilderSeed(null)}
        titleId="tch-home-builder"
        className="tch-builder__modal"
        dismissible={false}
      >
        {builderSeed ? (
          <TaskBuilder
            groupId={groupId}
            seed={builderSeed}
            onCancel={() => setBuilderSeed(null)}
            onDone={() => setBuilderSeed(null)}
          />
        ) : null}
      </Modal>

      <SubgroupDialog
        open={Boolean(subgroupFor)}
        editing={null}
        roster={(snapshot?.students ?? []).map((row) => ({
          id: row.learner_id, name: row.display_name ?? row.learner_id,
        }))}
        preselect={subgroupFor?.learnerIds}
        initialName={subgroupFor?.subgroupName}
        busy={subgroupBusy}
        error={subgroupError}
        onClose={() => { setSubgroupFor(null); setSubgroupError('') }}
        onSave={(draft) => void saveSubgroup(draft)}
      />
    </div>
  )
}
