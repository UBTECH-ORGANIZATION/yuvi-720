/* Student profile (F6 student level).
 *
 * One scrolling screen, no tabs. A teacher opens this with one question —
 * where is this child in the learning, what needs my depth, and what do I
 * assign about it — and the page answers in that order: identity and alarms,
 * Yuvi's one-paragraph read, the status dials, then the work columns. What a
 * teacher only sometimes wants (portrait, strengths/difficulties, the month
 * chart) waits behind buttons instead of holding a screen of height.
 *
 * Requirement coverage:
 *   Status band   — planner focus + progress vs objectives per subject (§4)
 *   Topics        — hardest topics, each with a short digested "why"
 *   Dialogs       — struggle items (§1) + strengths (N§1) + portrait
 *   Recommendations — tailored pedagogical recommendations (§2)
 *   Wellbeing     — open disclosures, deep-linked from safety alerts
 */

import {
  useEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactElement, type ReactNode,
} from 'react'
import { navigate } from '../../../app/router'
import {
  HoverSparkline, ProgressRing,
} from '../../../components/charts'
import {
  Card, ErrorState, Icon, Panel, SectionHeader, Skeleton,
  Hint, SkeletonRows, StatusPill, Tooltip,
} from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import { PraiseDialog } from '../shared/PraiseDialog'
import type { StrengthItem } from '../shared/DifficultiesCard'
import { useAuth } from '../../../providers/AuthProvider'
import { FocusPanel } from '../live/FocusPanel'
import { ScoreStats } from './ScoreCards'
import {
  generateTopicDigest, getFocusRoadmap, getLearnerRead, getPinnedNext,
  getStudentActivity,
  getStudentDetail,
  getStudentGoals, getStudentObjectives, getStudentScores, getStudentTrends,
  getTopicDigest,
  unpinNext,
  type RoadmapStep,
  type LearnerRead, type LearnerTrends, type ObjectiveBreakdownRow,
  type PlannerFocus, type QuestionRow, type StudentScores,
  type StrengthDetail, type StudentDetail, type StudentGoal,
  type StudentPortrait, type StruggleItem, type SubjectProgress,
  type TeacherRecommendation,
  type TopicDigest, type TopicDigestItem,
} from '../../../services/teacher'
import {
  RawEvidence, RecommendationCard, withFallback,
} from '../shared/EvidenceDisclosure'
import { GoalProgressLine } from './TeacherGoals'
import { GoalDialog } from '../goals/GoalDialog'
import { TeacherWellbeing } from './TeacherWellbeing'
import { getStudentBadges, type TeacherBadge } from '../../../services/teacher'
import { Badge, type BadgeGlyph, type BadgeTier } from '../../../components/Badge'
import { useTeacherLive } from '../../../providers/TeacherLiveProvider'
import { agoLabel } from '../live/LiveNow'
import { useRoute } from '../../../app/router'
import './teacher-student.css'
import { StudentAvatar } from '../shared/StudentAvatar'
import { countKey } from '../shared/countLabel'
import { subjectLabel } from '../shared/subjectLabel'
import { putSeed, type TaskSeed } from '../tasks/taskSeed'
import { TaskBuilder } from '../tasks/TeacherTasksPage'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'

/** The window every chart on this page shares. One number, so the status
 *  band's consistency dial and the month chart cover the same month. */
const TREND_DAYS = 30

type DigestState = 'idle' | 'ready' | 'generating' | 'unavailable'

export function TeacherStudentPage({ learnerId }: { learnerId: string }) {
  const { t, language } = useI18n()
  const { subject, subjects, groupId } = useTeacherScope()
  const route = useRoute()
  const [detail, setDetail] = useState<StudentDetail | null>(null)
  const [badges, setBadges] = useState<TeacherBadge[]>([])
  const [activity, setActivity] = useState<QuestionRow[] | null>(null)
  const [trends, setTrends] = useState<LearnerTrends | null>(null)
  const [scores, setScores] = useState<StudentScores | null>(null)
  const [digest, setDigest] = useState<TopicDigest | null>(null)
  const [digestState, setDigestState] = useState<DigestState>('idle')
  const [error, setError] = useState(false)
  const live = useTeacherLive()
  const { avatarOf, nameOf } = useTeacherRoster()

  /* The learner read, fetched once for the whole page: the AI-analysis bar
     shows its subjects, and the recommendations panel leads with its
     overview paragraph. Cached server-side for a day, so this is one cheap
     GET on every visit after the first. */
  const [read, setRead] = useState<LearnerRead | null>(null)
  useEffect(() => {
    let active = true
    setRead(null)
    getLearnerRead(learnerId, language)
      .then((result) => { if (active) setRead(result) })
      .catch(() => { if (active) setRead({ unavailable: true }) })
    return () => { active = false }
  }, [learnerId, language])

  /* Building a task from a finding on this page opens the builder HERE, in
     the same dialog the tasks screen uses — the teacher never loses the
     profile they were reading. Without a group scope there is no builder to
     mount, so the seed rides to the tasks screen the old way. */
  const [builderSeed, setBuilderSeed] = useState<TaskSeed | null>(null)
  const buildTask = (seed: TaskSeed) => {
    if (groupId) {
      setBuilderSeed(seed)
    } else {
      putSeed(seed)
      navigate('/teacher/tasks')
    }
  }

  /* Landing ON the thing, not at the top of the page.
     A safety alert's bell row carries `?tab=wellbeing&flag=wb_…` and older
     alerts carry `?focus=flags` — both written into stored notification
     actions, so both shapes are honoured forever. There is no tab bar any
     more; the wellbeing section is always on the page, and a deep link means
     "scroll me there and ring the flag". An unrecognised value does nothing,
     so a plain link still works. */
  // `useRoute()` hands back pathname + search as one string.
  const query = new URLSearchParams(route.split('?')[1] ?? '')
  const focusFlagId = query.get('flag')
  const wantsWellbeing =
    query.get('tab') === 'wellbeing' || query.get('focus') === 'flags'
  const wellbeingRef = useRef<HTMLElement | null>(null)
  /* The full disclosure records live behind the compact card, in a dialog —
     a deep link means "open it", not just "scroll near it". */
  const [wbOpen, setWbOpen] = useState(false)

  useEffect(() => {
    if (!wantsWellbeing || !detail) return
    wellbeingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setWbOpen(true)
    // Scrolled once per navigation, once the sections exist to scroll to —
    // re-running on every render would fight a teacher who scrolled away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, detail])

  /* The profile's spine. Deliberately NOT cleared to null on a scope change:
     the page a teacher is reading stays readable while the narrower answer is
     fetched, so switching subject re-draws the numbers rather than the whole
     screen. `detail === null` therefore means "never loaded", which is
     exactly the state the placeholders below stand in for. */
  useEffect(() => {
    let active = true
    setError(false)
    getStudentDetail(learnerId, language, subject ?? undefined)
      .then((result) => { if (active) setDetail(result) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [learnerId, subject, language])

  /* Badges load beside the detail, not after it: the header leads with the
     child's latest badge — their own symbol of themselves — instead of a grey
     initial. All states are kept: the earned ones decorate, the in-progress
     ones are what the hover explains the child is working toward. */
  useEffect(() => {
    let active = true
    setBadges([])
    getStudentBadges(learnerId, language)
      .then((response) => { if (active) setBadges(response.badges ?? []) })
      .catch(() => { /* initial avatar is a fine fallback */ })
    return () => { active = false }
  }, [learnerId, language])

  /* The header KPIs, the independence dial and the topics all read from the
     same per-question rows. Loaded beside the detail; failure hides those
     sections rather than blocking the profile. */
  useEffect(() => {
    let active = true
    setActivity(null)
    getStudentActivity(learnerId, subject ?? undefined)
      .then((result) => { if (active) setActivity(result.questions) })
      .catch(() => { if (active) setActivity([]) })
    return () => { active = false }
  }, [learnerId, subject])

  /* The series behind every chart on this page. Loaded once here; failure
     leaves `null`, and each chart renders its own quiet empty state — a
     profile is still worth reading without its charts. */
  useEffect(() => {
    let active = true
    setTrends(null)
    getStudentTrends(learnerId, TREND_DAYS)
      .then((result) => { if (active) setTrends(result) })
      .catch(() => { if (active) setTrends(null) })
    return () => { active = false }
  }, [learnerId])

  /* The two habit scores (PBI 451) — server-computed, whole-child by design:
     the endpoint takes no subject because how a child works is not a per-
     subject fact, so the cards stand under any subject filter. Failure leaves
     the skeleton cells; the band is still worth reading without them. */
  useEffect(() => {
    let active = true
    setScores(null)
    getStudentScores(learnerId)
      .then((result) => { if (active) setScores(result) })
      .catch(() => { if (active) setScores(null) })
    return () => { active = false }
  }, [learnerId])

  /* The topics digest. The GET is cached-only and costs nothing; when there
     is evidence but no digest yet, ONE generation is fired automatically —
     the digest IS the card's reading now. The guard ref keeps a failed
     generation from re-firing on every re-render; a new scope is a new
     chance. */
  const generatedFor = useRef<string | null>(null)
  useEffect(() => {
    let active = true
    setDigest(null)
    setDigestState('idle')
    const scopeKey = `${learnerId}|${language}|${subject ?? 'all'}`
    getTopicDigest(learnerId, language, subject ?? undefined)
      .then(async (cached) => {
        if (!active) return
        if (cached.topics.length) {
          setDigest(cached)
          setDigestState('ready')
          return
        }
        if (!cached.has_evidence || generatedFor.current === scopeKey) {
          setDigest(cached)
          setDigestState(cached.has_evidence ? 'unavailable' : 'ready')
          return
        }
        generatedFor.current = scopeKey
        setDigestState('generating')
        try {
          const generated = await generateTopicDigest(learnerId, language, subject ?? undefined)
          if (!active) return
          setDigest(generated)
          setDigestState(generated.topics.length ? 'ready' : 'unavailable')
        } catch {
          if (active) setDigestState('unavailable')
        }
      })
      .catch(() => { if (active) setDigestState('unavailable') })
    return () => { active = false }
  }, [learnerId, subject, language])

  /* Nothing is gated on "the page has loaded" any more, because the page does
     not load as one thing. Six requests answer at six different times, and
     each section owns the wait for its own: the identity is real on the first
     frame (the roster already holds the name and the face), the dials land
     when the detail answers, the figures when the activity does, Yuvi's read
     whenever the model is done. The only whole-page state left is failure. */
  if (error && !detail) return <ErrorState title={t('tch.error')} />

  /* The roster resolved every child in this teacher's classes long before
     this page was opened, so the name in the header is not something to wait
     for. The detail's own copy is the fallback, and the id the last resort —
     never a guess, and never a grey bar where a name could have been. */
  const rosterName = nameOf(learnerId)
  const name = rosterName ?? detail?.display_name ?? learnerId
  const nameKnown = Boolean(rosterName || detail)
  /* Badges are per subject, so an active subject filter narrows them like
     everything else on the page — a science filter showing a maths coin would
     be the one element ignoring the bar. Client-side, because the earned list
     is already loaded whole for the hero's newest-badge slot. */
  const inSubject = (badge: TeacherBadge) =>
    !subject || !badge.subject || badge.subject === subject
  const earnedBadges = badges.filter((badge) => badge.earned && inSubject(badge))
  const towardBadges = badges
    .filter((badge) => badge.state === 'inprogress' && badge.progress > 0 && inSubject(badge))
    .sort((a, b) => b.progress - a.progress)
  const latestBadge = earnedBadges[0] ?? null
  const avatarChoice = avatarOf(learnerId)
  const presence = live.presence[learnerId] ?? null
  /* The newest open disclosure, in the hero — the one line a teacher must not
     have to scroll for. It links down to the full record. */
  const distress = (detail?.wellbeing_flags ?? [])[0] ?? null

  /* Open disclosures, from the detail payload the page already has — no second
     request to put a number on a section. */
  const openFlags = (detail?.wellbeing_flags ?? []).length

  const openWellbeing = () => {
    wellbeingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setWbOpen(true)
  }

  return (
    <div className="tch-student">
      {/* The tour's anchor for "this is a student profile". It used to hang on
          the strip of attention flags below, which was a list of alarms and is
          now gone; the identity row is the thing that says whose page this
          is. */}
      <header className="tch-student__head" data-tour="teacher.studentHero">
        <div className="tch-student__topRow">
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--sm"
            onClick={() => navigate('/teacher/students')}
          >
            <Icon name="chevronLeft" size={15} aria-hidden="true" />
            {t('tch.student.back')}
          </button>

          {/* The badge cluster balances the back button on the other end of
              the row, clear of the KPI strip below. The hover answers both
              questions a cluster of icons raises: what are these, and what is
              the child working toward. */}
          {earnedBadges.length ? (
            <Tooltip
              label={t('tch.student.quickBadges')}
              className="tch-student__badgeTip"
              trigger={(
                <span className="tch-student__badgeCluster">
                  <span className="tch-student__badgeLabel">{t('tch.student.quickBadges')}</span>
                  {earnedBadges.slice(0, 3).map((badge) => (
                    <Badge
                      key={`${badge.subject}:${badge.glyph}:${badge.tier}`}
                      subject={badge.subject}
                      glyph={badge.glyph as BadgeGlyph}
                      tier={badge.tier as BadgeTier}
                      size={22}
                      title={badge.title}
                    />
                  ))}
                  <span>{earnedBadges.length}</span>
                </span>
              )}
            >
              <div className="tch-badgeTip">
                {earnedBadges.slice(0, 4).map((badge) => (
                  <div key={`${badge.subject}:${badge.glyph}:${badge.tier}`}
                       className="tch-badgeTip__row">
                    <Badge subject={badge.subject} glyph={badge.glyph as BadgeGlyph}
                           tier={badge.tier as BadgeTier} size={20} title={badge.title} />
                    <span className="tch-badgeTip__text">
                      <strong dir="auto">{badge.title}</strong>
                      {badge.meta ? <span dir="auto">{badge.meta}</span> : null}
                    </span>
                  </div>
                ))}
                {towardBadges.length ? (
                  <>
                    <p className="tch-badgeTip__lead">{t('tch.student.badgeToward')}</p>
                    {towardBadges.slice(0, 2).map((badge) => (
                      <div key={`${badge.subject}:${badge.glyph}:${badge.tier}`}
                           className="tch-badgeTip__row is-toward">
                        <Badge subject={badge.subject} glyph={badge.glyph as BadgeGlyph}
                               tier={badge.tier as BadgeTier} size={20} title={badge.title} />
                        <span className="tch-badgeTip__text">
                          <strong dir="auto">{badge.title}</strong>
                          <span>{Math.round(badge.progress * 100)}%</span>
                        </span>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            </Tooltip>
          ) : null}
        </div>

        <div className="tch-student__identity">
          {/* The same face the roster shows, so a child is recognisable across
              screens. Their own choice wins; failing that their latest earned
              badge, which is still their symbol rather than a grey initial. */}
          <StudentAvatar
            learnerId={learnerId}
            name={name}
            size={56}
            choice={avatarChoice ?? (latestBadge ? {
              kind: 'badge',
              badge: {
                subject: latestBadge.subject,
                glyph: latestBadge.glyph as BadgeGlyph,
                tier: latestBadge.tier as BadgeTier,
              },
            } : null)}
          />
          <div className="tch-student__who">
            {nameKnown
              ? <h1 dir="auto">{name}</h1>
              : <h1 aria-busy="true"><Skeleton w={180} h={26} /></h1>}
            <p className="tch-student__seen">
              <Icon name="clock" size={13} aria-hidden />
              {agoLabel(presence?.last_seen_at ?? null, t)}
            </p>
            {distress ? (
              /* A child said something that needs an adult. This is hero
                 material, not something to discover three screens down. */
              <button
                type="button"
                className="tch-student__distress tch-appear"
                onClick={openWellbeing}
              >
                <Icon name="alert" size={13} aria-hidden />
                <strong>{t('tch.student.heroDistress')}</strong>
                <span dir="auto">{distress.evidence}</span>
              </button>
            ) : null}
          </div>

          {/* The two habit scores, ON the identity row (PBI 451). The raw
              counters that stood here — minutes, questions, help-used — are
              gone: counting help events is exactly the reading Reut retired,
              and the minutes and question counts live on in the trend
              dialog's charts. Each stat is the score itself, a door to the
              why-is-it-down dialog; its hover hint carries the window and
              the partial-signals marker. */}
          <ScoreStats scores={scores} />
        </div>
      </header>

      {/* The strip of attention flags that used to sit here is gone.
          It listed every criterion that fired, which was the right instinct
          and the wrong place: between the identity row and the dials, it was
          the first thing read about a child and it was a list of alarms. The
          same criteria are still on the page — the wellbeing chip is in the
          hero, the rest are the recommendations column, each one already
          carrying its own evidence — so this was a third telling, above the
          two that explain themselves. */}

      <div className="tch-student__body">
        {detail ? (
          <div className="tch-appear">
            <StatusBand
              learnerId={learnerId}
              focus={detail.focus ?? null}
              progress={detail.objectives_progress ?? {}}
              trends={trends}
              rows={activity}
            />
          </div>
        ) : (
          <StatusBandSkeleton subjects={subject ? 1 : subjects.length} />
        )}

        {/* Yuvi's read of where this child stands — right under the dials it
            narrates, with its one suggestion turned into a door: build the
            task it describes. Mounted before the detail answers: the bar is
            collapsed anyway, and it waits on the model, not on us. */}
        <ReadSummary learnerId={learnerId}
                     read={read}
                     platformSubjects={Object.keys(detail?.objectives_progress ?? {})}
                     rows={activity}
                     onBuildTask={buildTask} />

        {/* Two columns: the work (topics, goals) leads, the context
            (recommendations, wellbeing) rides beside it. On a narrow screen
            they stack in the same order. */}
        <div className="tch-student__columns">
          <div className="tch-student__main">
            <TopicsPanel
              rows={activity}
              learnerId={learnerId}
              digest={digest}
              digestState={digestState}
              onBuildTask={buildTask}
            />
            <GoalsCard learnerId={learnerId} name={name} />
          </div>

          <div className="tch-student__side">
            {/* MUST §2 — tailored pedagogical recommendations, each explainable. */}
            {detail ? (
              <div className="tch-appear">
                <RecsPanel
                  learnerId={learnerId}
                  rows={activity}
                  recommendations={detail.recommendations}
                  /* The same rule as the status band's focus card: an
                     off-subject planner pick steps aside under a subject
                     filter, or the "next step" sentence would name a maths
                     lesson on a science-filtered page. */
                  focus={subject && detail.focus?.subject
                         && detail.focus.subject !== subject
                    ? null : detail.focus ?? null}
                  progress={detail.objectives_progress ?? {}}
                  onBuildTask={buildTask}
                />
              </div>
            ) : (
              <RecsPanelSkeleton />
            )}

          </div>
        </div>

        {/* The sometimes-reading, behind doors: who this child is, what they
            are strong and weak in, the month's shape — and the wellbeing
            record, its door wearing the red count. One row of doors, spread
            over the whole width. */}
        {!detail ? <MoreDoorsSkeleton /> : (
        <MoreDialogs
          detail={detail}
          trends={trends}
          extra={(
            <button
              type="button"
              id="wellbeing"
              ref={(node) => { wellbeingRef.current = node }}
              className="sp-btn sp-btn--ghost tch-wbBtn"
              onClick={() => setWbOpen(true)}
            >
              <Icon name="alert" size={15} aria-hidden />
              {t('tch.student.wellbeingTitle')}
              {openFlags > 0 ? (
                <span className="tch-flagCount">
                  <span aria-hidden="true">{openFlags}</span>
                  {/* The digit alone is a number next to a word. What
                      it counts has to be said. */}
                  <span className="sp-sr-only">
                    {t('tch.student.openFlags', { count: openFlags })}
                  </span>
                </span>
              ) : null}
            </button>
          )}
        />
        )}

        {/* The full records, with the words, the reply and the actions —
            exactly the screen the safety flow was built as, one door in. */}
        <Modal open={wbOpen} onClose={() => setWbOpen(false)}
               titleId="tch-wb-dialog" className="tch-student__moreDialog">
          <h2 id="tch-wb-dialog" className="sp-sr-only">
            {t('tch.student.wellbeingTitle')}
          </h2>
          <TeacherWellbeing
            learnerId={learnerId}
            focusFlagId={focusFlagId}
            fromAlert={wantsWellbeing}
          />
        </Modal>
      </div>

      {/* The task builder, ON the profile — the same dialog the tasks screen
          mounts, seeded by whichever finding was clicked. The teacher builds
          and sends without ever leaving this page. */}
      <Modal
        open={Boolean(builderSeed && groupId)}
        onClose={() => setBuilderSeed(null)}
        titleId="tch-student-builder-title"
        className="tch-builder__modal"
        dismissible={false}
      >
        <div className="tch-builder__head">
          <h2 id="tch-student-builder-title" className="tch-builder__modalTitle" dir="auto">
            {t('tch.tasks.new')}
          </h2>
        </div>
        {builderSeed && groupId ? (
          <TaskBuilder
            groupId={groupId}
            seed={builderSeed}
            onCancel={() => setBuilderSeed(null)}
            onDone={() => setBuilderSeed(null)}
          />
        ) : null}
      </Modal>
    </div>
  )
}

/* ── the page on its way in ────────────────────────────────────────────────
 *
 * These are not grey boxes standing in for "some content". Each one is its
 * section with the data taken out: the same grid, the same number of cells,
 * the same 104px dial, the same three recommendation slots — and, printed
 * rather than greyed, every heading that never depended on a request in the
 * first place. "עצמאות" is as true before the fetch answers as after it, and
 * a teacher reading the placeholder already knows what is coming and where.
 *
 * What greys out is only what we genuinely do not know yet. The page then
 * fills in section by section as each request answers, instead of holding
 * everything back for the slowest one.
 */

function StatusBandSkeleton({ subjects }: { subjects: number }) {
  const { t } = useI18n()
  /* The row a teacher is about to get, in the count they are about to get
     it: the focus card, then one cell per subject in scope — the two habit
     scores live on the hero strip now, not here. Getting the count right is
     the whole point — a placeholder that reflows into a different grid is
     worse than none. */
  const cellCount = 1 + subjects
  return (
    <section className="tch-status" aria-busy="true">
      <div
        className={`tch-status__grid${cellCount > 5 ? ' tch-status__grid--two-rows' : ''}`}
        style={cellCount > 5
          ? { '--tch-status-cols': Math.ceil(cellCount / 2) } as CSSProperties
          : undefined}>
        <Card className="tch-status__cell tch-status__focus">
          <div className="tch-status__focusTop">
            <h4 className="tch-status__focusHead">
              <Icon name="target" size={14} aria-hidden />
              {t('tch.student.focusTitle')}
            </h4>
          </div>
          <Skeleton w="82%" h={17} />
          <Skeleton w="46%" h={20} r={999} />
        </Card>

        {/* Which subjects this child has evidence in is exactly what the
            detail is being asked, so these headings stay blank — printing a
            guess and correcting it a moment later is a worse lie than a bar. */}
        {Array.from({ length: subjects }, (_, index) => (
          <Card key={index} className="tch-status__cell">
            <Skeleton w="54%" h={15} />
            <Skeleton w={104} h={54} r={10} />
            <Skeleton w="72%" h={12} />
          </Card>
        ))}

      </div>
    </section>
  )
}

function RecsPanelSkeleton() {
  const { t } = useI18n()
  /* The three slots are fixed — a profile always answers what is working,
     what is stuck and what comes next — so the pills are printed and only
     the sentences are still on their way. */
  const slots = [
    { key: 'working', tone: 'strong' },
    { key: 'stuck', tone: 'steady' },
    { key: 'next', tone: 'neutral' },
  ] as const
  return (
    <Panel className="tch-recsPanel" aria-busy="true">
      <SectionHeader
        title={t('tch.student.recommendations')}
        subtitle={t('tch.student.recommendationsSubtitle')}
      />
      <ul className="tch-recs">
        {slots.map((slot) => (
          <li key={slot.key} className="tch-rec">
            <div className="tch-rec__head">
              <StatusPill tone={slot.tone}>{t(`tch.recs.slot.${slot.key}`)}</StatusPill>
            </div>
            <Skeleton w="100%" h={13} />
            <Skeleton w="62%" h={13} />
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/** The bottom row of doors. Which ones open depends on what this child has,
 *  so the placeholder only holds the row's height and shape. */
function MoreDoorsSkeleton() {
  return (
    <div className="tch-student__more" aria-hidden="true">
      {[0, 1, 2].map((index) => <Skeleton key={index} h={42} r={999} />)}
    </div>
  )
}

/* ── Yuvi's one-paragraph read, with its suggestion made actionable ───────── */

function ReadSummary({ learnerId, read, platformSubjects, rows, onBuildTask }: {
  learnerId: string
  /** The page-level learner read — fetched once for the whole profile,
   *  because the recommendations panel leads with its overview. `null`
   *  while it loads. */
  read: LearnerRead | null
  /** The catalogue subjects — every one gets a column, so "the model had
   *  nothing to say about math" renders as a stated fact, not a hole. */
  platformSubjects: string[]
  /** The per-question rows — the measured performance line each subject
   *  column leads with, computed here and never asked of the model. */
  rows: QuestionRow[] | null
  /** Opens the task builder on this page, seeded with the finding. */
  onBuildTask: (seed: TaskSeed) => void
}) {
  const { t } = useI18n()
  /* Closed by default: the read is depth, not vitals — a teacher who wants
     Yuvi's account opens the bar, and everyone else keeps a short page. */
  const [open, setOpen] = useState(false)

  /* Per-subject sections side by side, then the two general lines. Not a
     paragraph: four different claims must not wear one voice. Every platform
     subject holds its column even when the read said nothing about it — an
     absent math column reads as an omission; "no measured progress yet" is
     the honest sentence. Extra subjects the read DID cover (English lives
     outside the catalogue) append after. */
  /* The measured line each column leads with — from the rows, not the model:
     the one number a teacher takes away even if they skim the prose. */
  const perf = useMemo(() => {
    const map = new Map<string, { attempts: number; correct: number; questions: number }>()
    for (const row of rows ?? []) {
      const subjectId = (row.subject || '').trim()
      if (!row.attempts || !subjectId) continue
      const slot = map.get(subjectId) ?? { attempts: 0, correct: 0, questions: 0 }
      slot.attempts += row.attempts
      slot.correct += row.correct
      slot.questions += 1
      map.set(subjectId, slot)
    }
    return map
  }, [rows])

  const readSections = read && !read.unavailable ? (read.subjects ?? []) : []
  const subjects = read && !read.unavailable ? [
    ...platformSubjects.map((subjectId) => {
      const section = readSections.find((entry) => entry.subject === subjectId)
      return {
        subject: subjectId,
        summary: section?.summary ?? '',
        points: section?.points ?? null,
      }
    }),
    ...readSections.filter((section) => !platformSubjects.includes(section.subject))
      .map((section) => ({
        subject: section.subject,
        summary: section.summary ?? '',
        points: section.points as string[] | null,
      })),
  ] : []
  return (
    /* The same spotlight surface as the class brief on Home — this is the one
       loud object on the profile, and everything under it stays in the quiet
       card language. */
    <section className={`tch-read${open ? ' is-open' : ''}`}
             aria-label={t('tch.student.readTitle')}>
      {/* Decorative only, and behind everything — the same slow aurora the
          class brief carries, so the two "Yuvi speaks" surfaces are one
          family. `prefers-reduced-motion` stops it dead. */}
      <div className="tch-read__aurora" aria-hidden="true"><i /><i /><i /></div>
      <div className="tch-read__inner">
        <button
          type="button"
          className="tch-read__toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="tch-read__eyebrow">
            <Icon name="spark" size={14} aria-hidden />
            {t('tch.student.readTitle')}
          </span>
          <Icon name={open ? 'chevronUp' : 'chevronLeft'} size={15} aria-hidden />
        </button>
        {!open ? null : read === null ? (
          <div aria-busy="true" className="tch-read__loading">
            <Skeleton w="100%" h={13} /><Skeleton w="70%" h={13} />
          </div>
        ) : read.unavailable ? (
          <p className="tch-read__none">{t('tch.goalRead.unavailable')}</p>
        ) : (
          <>
            {subjects.length ? (
              /* One column per subject with a rule between them — the read
                 answers per subject, the way the teacher plans per subject. */
              <div className="tch-read__subjects">
                {subjects.map((section, index) => (
                  <div key={section.subject} className="tch-read__subjectWrap">
                    {index > 0 ? <i className="tch-read__rule" aria-hidden="true" /> : null}
                    <div className="tch-read__subject">
                      <h5 dir="auto">{subjectLabel(section.subject, t)}</h5>
                      {(() => {
                        const stats = perf.get(section.subject)
                        return stats ? (
                          <p className="tch-read__perf">
                            {t('tch.student.readPerf', {
                              percent: Math.round((stats.correct / stats.attempts) * 100),
                              questions: stats.questions,
                            })}
                          </p>
                        ) : null
                      })()}
                      {/* The model's own account of the subject, in prose —
                          what goes well and what trips them, above the
                          numbered points. */}
                      {section.summary ? (
                        <p className="tch-read__summary" dir="auto">{section.summary}</p>
                      ) : null}
                      {section.points?.length ? (
                        <ul>
                          {section.points.map((point) => (
                            <li key={point}><span dir="auto">{point}</span></li>
                          ))}
                        </ul>
                      ) : section.summary ? null : (
                        <p className="tch-read__subjectNone">
                          {t('tch.student.readNoProgress')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {/* The two general prose lines that stood here (involvement +
                notable) are gone per Reut: they repeated themselves visit
                after visit. The per-subject read above and the suggestion
                below are the parts that carry information. */}
            {read.suggestion ? (
              <div className="tch-read__suggest">
                <p dir="auto">
                  <Icon name="target" size={13} aria-hidden />
                  {read.suggestion}
                </p>
                <button
                  type="button"
                  className="sp-btn sp-btn--ghost sp-btn--sm"
                  onClick={() => {
                    /* The suggestion is anchored server-side to a real
                       objective or hard topic — the builder opens ON that
                       material, not on a sentence of advice. */
                    const anchor = read.suggestion_anchor
                    onBuildTask({
                      title: anchor ? t('tch.gaps.taskTitle', { label: anchor.title }) : '',
                      topic: anchor?.title ?? read.suggestion ?? '',
                      objectiveId: anchor?.objective_id ?? null,
                      learnerIds: [learnerId],
                    })
                  }}
                >
                  <Icon name="backpack" size={14} aria-hidden />
                  {read.suggestion_anchor
                    ? t('tch.student.readTaskOn', { topic: read.suggestion_anchor.title })
                    : t('tch.student.readTask')}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

/* ── the status band: four dials, one glance ────────────────────────────────
 *
 * The teacher's question is "what does this child need from me", and the band
 * answers its three parts: position (planner focus + mastery per subject),
 * rhythm (consistency), and cost (independence). Every number is derived from
 * data the page already loads — the band invents nothing.
 */

/* The momentum chip a dial card wears in its corner: which way the metric has
 * moved across the trend window, with the two measured halves in the tooltip.
 * The chip says the direction; the hover says the numbers behind it. */
function TrendChip({ momentum }: {
  momentum: { dir: string; why: string } | null
}) {
  const { t } = useI18n()
  if (!momentum) return null
  return (
    <Hint text={momentum.why} className="tch-trendHint">
      <span className={`tch-trend is-${momentum.dir}`} tabIndex={0}>
        {momentum.dir !== 'flat' ? (
          <Icon name={momentum.dir === 'up' ? 'trendUp' : 'chevronDown'}
                size={11} aria-hidden />
        ) : null}
        {t(`tch.trend.${momentum.dir}`)}
      </span>
    </Hint>
  )
}

function StatusBand({ learnerId, focus: rawFocus, progress, trends, rows }: {
  learnerId: string
  focus: PlannerFocus | null
  progress: Record<string, SubjectProgress>
  trends: LearnerTrends | null
  rows: QuestionRow[] | null
}) {
  const { t, language } = useI18n()
  const { subject: scopeSubject, groupId } = useTeacherScope()
  const { user } = useAuth()
  /* The planner's pick is cross-subject by design — `next_focus` answers "where
     does the platform take this child next", whatever the subject. Under an
     active subject filter an off-subject pick would be the one card on the band
     contradicting the bar, so it steps aside; clear the filter and it is back.
     The roadmap dialog stays whole-path either way — it says it is. */
  const focus = scopeSubject && rawFocus?.subject && rawFocus.subject !== scopeSubject
    ? null : rawFocus
  const subjects = Object.entries(progress)
  /* Which subject's per-objective breakdown is open, if any. */
  const [objSubject, setObjSubject] = useState<string | null>(null)
  /* The planner's road ahead, behind a click on the focus card. */
  const [roadOpen, setRoadOpen] = useState(false)

  /* The pin (#244). This card used to read `next_focus` alone, so a pin set
     from the live view left the profile CONTRADICTING the child's hero — the
     one screen a teacher opens to see what the child sees. Now it reads the
     same fact the hero honours, and shows how the last pin ended: "done ✓"
     and "never pinned" are different answers. */
  const [pinView, setPinView] = useState<
    Awaited<ReturnType<typeof getPinnedNext>> | null>(null)
  const [pinNonce, setPinNonce] = useState(0)
  const [pinOpen, setPinOpen] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)
  useEffect(() => {
    let active = true
    getPinnedNext(learnerId, language)
      .then((result) => { if (active) setPinView(result) })
      // The band still stands without the pin lane — the planner focus is
      // real either way; a failed read just means no pin strip.
      .catch(() => { if (active) setPinView(null) })
    return () => { active = false }
  }, [learnerId, language, pinNonce])

  const activePin = pinView?.pin_state === 'active' ? pinView.pinned : null
  const pinnedBy = activePin
    ? (activePin.pinned_by === user?.user_id
      ? (user?.display_name || activePin.pinned_by) : activePin.pinned_by)
    : ''
  /* A spent pin stays worth a line for a week — after that it is history,
     not context. */
  const recentLast = pinView?.last && pinView.last.ended_at
    && Date.now() - Date.parse(pinView.last.ended_at) < 7 * 24 * 3600 * 1000
    ? pinView.last : null

  const unpin = async () => {
    if (pinBusy) return
    setPinBusy(true)
    try {
      await unpinNext(learnerId)
      setPinNonce((nonce) => nonce + 1)
    } catch {
      /* The strip re-reads on the next nonce; a failed unpin leaves the pin
         visibly standing, which is the truthful outcome. */
    } finally {
      setPinBusy(false)
    }
  }

  /* ── momentum: the same window, cut in half ────────────────────────────────
     The subject chips compare the recent half of the trend window against the
     half before it — computed from the series the dials already read, never
     estimated. Too little data on either side means NO chip: a trend drawn
     from two questions would be a verdict on noise. (The two habit scores on
     the hero strip carry their own server-computed trend — see ScoreStats.) */
  const halfIndex = trends ? Math.floor(trends.per_day.length / 2) : 0
  const boundary = trends?.per_day[halfIndex]?.date ?? null
  const halfDays = trends ? trends.per_day.length - halfIndex : 0

  const subjectMomentum = (subjectId: string): { dir: string; why: string } | null => {
    if (!trends || !boundary) return null
    const series = trends.per_subject.find((s) => s.subject === subjectId)?.series ?? []
    const agg = (points: { attempts: number; success_rate: number | null }[]) => {
      const attempts = points.reduce((sum, p) => sum + p.attempts, 0)
      const correct = points.reduce((sum, p) => sum + p.attempts * (p.success_rate ?? 0), 0)
      return { attempts, rate: attempts > 0 ? correct / attempts : null }
    }
    const prior = agg(series.filter((p) => p.date < boundary))
    const recent = agg(series.filter((p) => p.date >= boundary))
    if (prior.attempts < 3 || recent.attempts < 3
        || prior.rate === null || recent.rate === null) return null
    const delta = Math.round((recent.rate - prior.rate) * 100)
    return {
      dir: delta >= 5 ? 'up' : delta <= -5 ? 'down' : 'flat',
      why: t('tch.trend.successWhy', {
        recent: Math.round(recent.rate * 100),
        prior: Math.round(prior.rate * 100), days: halfDays,
      }),
    }
  }

  /* How many cells the grid is about to hold: focus + one dial per subject —
     the two habit scores moved up to the hero strip (Gal, 2026-08-27).
     Counted here rather than in CSS because the dialogs below are children of
     the same grid — closed they render nothing, but a selector counting DOM
     children could never rely on that. */
  const cellCount = 1 + subjects.length

  return (
    /* No outer card, no heading: the dials are cards themselves and open the
       page — a title above them was a label on the obvious. */
    <section className="tch-status" data-tour="teacher.subjectProgress">
      <div
        /* Five cells share one row. Past five, `auto-fit` fills a first row
           and strands the remainder alone under it — one orphaned dial reads
           as a layout accident, not as a sixth measurement. So six-plus cells
           split into two even rows instead (7 → 4+3, 8 → 4+4); the class
           applies only above the width where two rows genuinely fit — below
           it the minmax wrap keeps doing the right thing. */
        className={`tch-status__grid${cellCount > 5 ? ' tch-status__grid--two-rows' : ''}`}
        style={cellCount > 5
          ? { '--tch-status-cols': Math.ceil(cellCount / 2) } as CSSProperties
          : undefined}>
        {/* Where the child's app is pointing — the pin when one stands (the
            hero honours it), the planner's own pick otherwise. This card and
            the child's dashboard can never disagree about what comes next. */}
        <Card className="tch-status__cell tch-status__focus">
          {/* The whole card opens the planner's roadmap — where this pick
              leads, step by step. The pin strip below sits OUTSIDE this door:
              buttons inside a button is markup that cannot be clicked apart. */}
          <button
            type="button"
            className="tch-status__cellOpen tch-status__focusOpen"
            onClick={() => setRoadOpen(true)}
            aria-haspopup="dialog"
          >
          {/* Head row spans the card: the cell's name at the inline start,
              the subject chip at the inline end (the top-left corner). */}
          <div className="tch-status__focusTop">
            <h4 className="tch-status__focusHead">
              <Icon name="target" size={14} aria-hidden />
              {t('tch.student.focusTitle')}
            </h4>
            {!activePin && focus?.subject && focus.mode !== 'complete' ? (
              <span className="tch-status__focusSubject" dir="auto">
                {subjectLabel(focus.subject, t)}
              </span>
            ) : null}
          </div>
          {activePin ? (
            <>
              {/* The pinned step IS what the child sees on their hero. */}
              <p className="tch-status__focusWhat" dir="auto">
                {pinView?.pinned_title ?? ''}
              </p>
              <p className="tch-status__focusMeta">
                <StatusPill tone="strong">
                  {t('tch.student.pin.by', { name: pinnedBy })}
                </StatusPill>
              </p>
            </>
          ) : focus && focus.mode === 'complete' ? (
            <p className="tch-status__focusDone">
              <Icon name="check" size={15} aria-hidden />
              {t('tch.student.focusMode.complete')}
            </p>
          ) : focus && (focus.objective_title || focus.subject) ? (
            <>
              {/* The objective IS the answer, so it gets the cell's middle
                  and its weight; the mode pill closes the card. */}
              <p className="tch-status__focusWhat" dir="auto">
                {focus.objective_title ?? subjectLabel(focus.subject ?? '', t)}
              </p>
              <p className="tch-status__focusMeta">
                <StatusPill tone={focus.mode === 'review' ? 'steady' : 'strong'}>
                  {t(`tch.student.focusMode.${focus.mode}`)}
                </StatusPill>
              </p>
            </>
          ) : (
            <p className="tch-status__none">{t('tch.student.focusNone')}</p>
          )}
          </button>

          {/* The pin lane: act on the pin, or read how the last one ended.
              Rendered only once the pin read answered — a strip that appears
              and rewords itself mid-glance would cost more than it says. */}
          {pinView && (
            <div className="tch-status__pinBar">
              {/* Only a COMPLETED pin earns a line: "the teacher removed a
                  pin" is an act, not an outcome, and reporting it read as
                  noise on the card. */}
              {!pinView.pinned && recentLast?.outcome === 'completed' && (
                <span className="tch-status__pinNote" dir="auto">
                  <Icon name="check" size={13} aria-hidden />
                  {t('tch.student.pin.outcome.completed',
                    { title: pinView.last_title ?? '' })}
                </span>
              )}
              {activePin && (
                <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                        disabled={pinBusy} onClick={() => void unpin()}>
                  {t('tch.liveView.act.unpin')}
                </button>
              )}
              {groupId && (
                <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                        aria-haspopup="dialog" onClick={() => setPinOpen(true)}>
                  {t('tch.student.pin.change')}
                </button>
              )}
            </div>
          )}
        </Card>

        {/* The same panel the live view opens — two pin dialogs would be two
            opinions about what a pin is. No scope lever here: this page is
            about ONE child. */}
        {/* The panel carries its own heading now — the modal borrows it as
            the accessible title instead of stacking a second one above it. */}
        <Modal open={pinOpen} onClose={() => setPinOpen(false)}
               titleId="tch-focus-panel-title" className="tch-focusModal">
          {pinOpen && groupId ? (
            <FocusPanel
              learnerId={learnerId}
              groupId={groupId}
              onChanged={() => setPinNonce((nonce) => nonce + 1)}
            />
          ) : null}
        </Modal>

        <RoadmapDialog learnerId={learnerId} open={roadOpen}
                       onClose={() => setRoadOpen(false)} />

        {subjects.map(([subjectId, stats]) => {
          const hasProgress = stats.objectives_mastered + stats.objectives_in_progress > 0
          /* "Not started" must mean not started. A child with math ACTIVITY
             and no objective progress yet has started — that is a 0%, which
             here is a measurement and not a slur, because the caption says
             what it measures. */
          const worked = (rows ?? []).some((row) =>
            (row.subject || '').trim() === subjectId && row.attempts > 0)
          return (
            <Card key={subjectId} className="tch-status__cell">
              {/* Outside the door button (a chip inside it would nest two
                  interactive elements), floating on the card's corner. */}
              <TrendChip momentum={subjectMomentum(subjectId)} />
              {/* The whole cell is the door to its own breakdown — the dial
                  says "1 of 3", the dialog says which three. */}
              <button
                type="button"
                className="tch-status__cellOpen"
                onClick={() => setObjSubject(subjectId)}
                aria-haspopup="dialog"
              >
                <h4 dir="auto">{subjectLabel(subjectId, t)}</h4>
                {/* The dial is always drawn — a missing gauge beside four drawn
                    ones reads as a rendering bug, not as a fact. The caption is
                    what tells the truth: achieved fraction, "worked but nothing
                    achieved yet", or "not started". */}
                <ProgressRing arc="half" percent={stats.percent} size={104}
                              label={subjectLabel(subjectId, t)} />
                <p className="tch-status__caption">
                  {hasProgress
                    ? t('tch.student.progressOf', {
                        mastered: stats.objectives_mastered, total: stats.objectives_total,
                      })
                    : worked
                      ? t('tch.student.progressWorkedNone')
                      : t('tch.student.progressNotStarted')}
                </p>
              </button>
            </Card>
          )
        })}

        <ObjectivesDialog
          learnerId={learnerId}
          subject={objSubject}
          onClose={() => setObjSubject(null)}
        />
      </div>
    </section>
  )
}

/* The planner's road, drawn as the pipeline it is: each stop is what the
 * ranking will serve once the one before it is completed. Deterministic —
 * the endpoint replays the live `next_focus` over simulated mastery, so this
 * can never disagree with the focus card that opened it. */
function RoadmapDialog({ learnerId, open, onClose }: {
  learnerId: string
  open: boolean
  onClose: () => void
}) {
  const { t, language } = useI18n()
  const [steps, setSteps] = useState<RoadmapStep[] | null>(null)

  useEffect(() => { setSteps(null) }, [learnerId, language])

  useEffect(() => {
    if (!open || steps !== null) return
    let active = true
    getFocusRoadmap(learnerId, language)
      .then((result) => { if (active) setSteps(result.steps) })
      .catch(() => { if (active) setSteps([]) })
    return () => { active = false }
  }, [open, steps, learnerId, language])

  /* Fewer stops than the window asked for means the simulation ran out of
     material — the road genuinely ends, and the end is worth a node. */
  const finished = steps !== null && steps.length > 0 && steps.length < 6
    && steps[steps.length - 1].mode !== 'complete'

  return (
    <Modal open={open} onClose={onClose} titleId="tch-roadmap-title"
           className="tch-roadmapDialog">
      <h2 id="tch-roadmap-title" className="tch-builder__modalTitle" dir="auto">
        {t('tch.student.roadmapTitle')}
      </h2>
      <p className="tch-roadmap__hint" dir="auto">{t('tch.student.roadmapHint')}</p>
      {steps === null ? (
        <div aria-busy="true" className="tch-objDialog__loading">
          <Skeleton w="100%" h={14} /><Skeleton w="85%" h={14} /><Skeleton w="90%" h={14} />
        </div>
      ) : steps.length === 0 ? (
        <p className="tch-objDialog__none">{t('tch.student.focusNone')}</p>
      ) : (
        <ol className="tch-roadmap">
          {steps.map((step, index) => (
            <li key={`${step.objective_id ?? 'end'}:${index}`}
                className={`tch-roadmap__step${index === 0 ? ' is-now' : ''}`}>
              <span className="tch-roadmap__marker" aria-hidden="true" />
              <div className="tch-roadmap__body">
                <span className="tch-roadmap__tags">
                  {index === 0 ? (
                    <span className="tch-roadmap__now">{t('tch.student.roadmapNow')}</span>
                  ) : null}
                  {step.subject ? (
                    <span className={`tch-roadmap__subj is-${step.subject}`} dir="auto">
                      {subjectLabel(step.subject, t)}
                    </span>
                  ) : null}
                  {step.mode !== 'complete' ? (
                    <span className="tch-roadmap__mode">
                      {t(`tch.student.focusMode.${step.mode}`)}
                    </span>
                  ) : null}
                </span>
                <span className="tch-roadmap__title" dir="auto">
                  {step.mode === 'complete'
                    ? t('tch.student.focusMode.complete')
                    : step.objective_title ?? step.objective_id}
                </span>
                {/* The sub-material the objective lives in — the same words
                    the lesson archive uses, and what tells two same-named
                    objectives apart on one road. */}
                {step.mode !== 'complete' && step.unit_title
                  && step.unit_title !== step.objective_title ? (
                  <span className="tch-roadmap__unit" dir="auto">{step.unit_title}</span>
                ) : null}
              </div>
            </li>
          ))}
          {finished ? (
            <li className="tch-roadmap__step is-end">
              <span className="tch-roadmap__marker" aria-hidden="true" />
              <div className="tch-roadmap__body">
                <span className="tch-roadmap__title">
                  <Icon name="check" size={14} aria-hidden />
                  {t('tch.student.focusMode.complete')}
                </span>
              </div>
            </li>
          ) : null}
        </ol>
      )}
      <div className="tch-builder__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.subgroups.cancel')}
        </button>
      </div>
    </Modal>
  )
}

/* One subject's objectives, each with its own measured position — the list a
 * dial's "1 of 3" summarises. Everything here is catalogue + mastery data;
 * the percentage is mastery's own score, never an estimate made for display. */
function ObjectivesDialog({ learnerId, subject, onClose }: {
  learnerId: string
  subject: string | null
  onClose: () => void
}) {
  const { t, language } = useI18n()
  const [rows, setRows] = useState<ObjectiveBreakdownRow[] | null>(null)

  useEffect(() => {
    if (!subject) return
    let active = true
    setRows(null)
    getStudentObjectives(learnerId, subject, language)
      .then((result) => { if (active) setRows(result.objectives) })
      .catch(() => { if (active) setRows([]) })
    return () => { active = false }
  }, [learnerId, subject, language])

  return (
    <Modal open={subject !== null} onClose={onClose}
           titleId="tch-obj-dialog" className="tch-objDialog">
      <h2 id="tch-obj-dialog" className="tch-builder__modalTitle" dir="auto">
        {subject ? t('tch.student.objTitle', { subject: subjectLabel(subject, t) }) : ''}
      </h2>
      {rows === null ? (
        <div aria-busy="true" className="tch-objDialog__loading">
          <Skeleton w="100%" h={14} /><Skeleton w="90%" h={14} /><Skeleton w="95%" h={14} />
        </div>
      ) : rows.length === 0 ? (
        <p className="tch-objDialog__none">{t('tch.student.objEmpty')}</p>
      ) : (
        <ul className="tch-objDialog__list">
          {rows.map((row) => (
            <li key={row.objective_id} className="tch-objDialog__row">
              <span className="tch-objDialog__nameCell">
                <span className="tch-objDialog__name" dir="auto">
                  {row.title || row.objective_id}
                  {row.needs_review ? (
                    <span className="tch-objDialog__review">
                      {t('tch.student.objReview')}
                    </span>
                  ) : null}
                </span>
                {/* What actually happened there, in one quiet line — the
                    numbers a teacher asks right after "where do they stand". */}
                {row.questions > 0 ? (
                  <span className="tch-objDialog__meta">
                    {t('tch.student.objMeta', {
                      questions: row.questions, minutes: row.minutes,
                      help: row.help_used,
                    })}
                    {row.last_at ? ` · ${agoLabel(row.last_at, t)}` : ''}
                  </span>
                ) : null}
              </span>
              <span className="tch-objDialog__bar" aria-hidden="true">
                <i className={`is-${row.status}`}
                   style={{ inlineSize: `${row.percent}%` }} />
              </span>
              <span className="tch-objDialog__figures">
                <strong className={`is-${row.status}`}>
                  {row.status === 'mastered'
                    ? t('tch.student.objStatus.mastered')
                    : row.status === 'in_progress'
                      ? `${row.percent}%`
                      : t('tch.student.objStatus.notStarted')}
                </strong>
                {row.attempts > 0 ? (
                  <span className="tch-objDialog__evidence">
                    {t('tch.student.objAttempts', {
                      successes: row.successes, attempts: row.attempts,
                    })}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="tch-builder__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.subgroups.cancel')}
        </button>
      </div>
    </Modal>
  )
}

/* ── recommendations the numbers write themselves ──────────────────────────
 *
 * The server's recommendations react to SIGNALS (a streak, an idle spell, a
 * long question). These react to the TOPIC TABLE: where the child is weakest,
 * where they are strong enough to give rather than take, and how much help
 * their answers needed. The datum is in the sentence — no "why?" needed — and
 * each carries the act it points at: a task seeded on that very material.
 */

function RecsPanel({ learnerId, rows, recommendations, focus, progress, onBuildTask }: {
  learnerId: string
  rows: QuestionRow[] | null
  /** The server's deterministic MoE-category recommendations — each still
   *  renders with its "why" evidence, bucketed into the slot it belongs to. */
  recommendations: TeacherRecommendation[]
  focus: PlannerFocus | null
  /** Per-subject objective progress — the "measured win" the working row
   *  falls back to when no topic is strong enough to name. */
  progress: Record<string, SubjectProgress>
  onBuildTask: (seed: TaskSeed) => void
}) {
  const { t } = useI18n()
  const { nameOf } = useTeacherRoster()
  const [praiseFor, setPraiseFor] = useState<StrengthItem | null>(null)
  /* Which win has already had its good word said. Per browser, on purpose:
     this suppresses a NUDGE, it is not a record of anything. A teacher on a
     second machine seeing the button again is a much smaller cost than storing
     a growing map of praised topics on the account — and the kudos itself,
     which is the real artefact, is on the server already. */
  const praisedKey = `yuvi.teacher.praised:${learnerId}`
  const [praisedFor, setPraisedFor] = useState<string | null>(() => {
    try { return window.localStorage.getItem(praisedKey) } catch { return null }
  })

  /* The same signals the panel always derived, now feeding fixed slots. */
  const derived = useMemo(() => {
    const topics = buildTopicSections(rows ?? []).flatMap((section) => section.topics)
    const weakest = topics.filter((topic) => topic.rate < 0.6)[0] ?? null
    const strongest = [...topics]
      .filter((topic) => topic.rate >= 0.85 && topic.attempts >= 6)
      .sort((a, b) => b.rate - a.rate)[0] ?? null
    const answered = (rows ?? []).filter((row) => row.attempts > 0)
    const helped = answered.filter((row) =>
      row.hints_used + row.content_hints_used + row.explanations_used + row.chat_turns > 0)
    const dependent = answered.length >= 6 && helped.length / answered.length >= 0.5
    return { weakest, strongest, helped: helped.length, answered: answered.length, dependent }
  }, [rows])

  const seedFor = (topic: string, objectiveId: string | null) => ({
    title: t('tch.gaps.taskTitle', { label: topic }),
    topic,
    objectiveId,
    learnerIds: [learnerId],
  })

  const buildButton = (topic: string, objectiveId: string | null) => (
    <button
      type="button"
      className="sp-btn sp-btn--ghost sp-btn--sm"
      onClick={() => onBuildTask(seedFor(topic, objectiveId))}
    >
      <Icon name="backpack" size={14} aria-hidden />
      {t('tch.recs.buildTask')}
    </button>
  )

  /* Server recommendations, each in the slot its MoE category argues for:
     extra practice and reinforcement are the child stuck; a referral is a
     step to take. (Deepening backs the working row when nothing measured
     qualifies; enrichment-from-strength no longer renders here at all.) */
  const serverStuck = recommendations.filter((rec) =>
    rec.category === 'extra_practice' || rec.category === 'reinforce')
  const serverNext = recommendations.filter((rec) =>
    rec.category === 'refer_intervention')

  /* The next step is synthesised, not just filtered: close the open gap
     first, then continue where the planner already points. */
  const { weakest, strongest, dependent } = derived
  const focusTitle = focus?.objective_title ?? null
  const nextStep = weakest
    ? {
        text: focusTitle && focus?.objective_id !== weakest.objectiveId
          ? t('tch.recs.nextPractice', { topic: weakest.label, next: focusTitle })
          : t('tch.recs.nextPracticeOnly', { topic: weakest.label }),
        topic: weakest.label,
        objectiveId: weakest.objectiveId,
      }
    : focusTitle
      ? {
          text: t('tch.recs.nextFocus', { next: focusTitle }),
          topic: focusTitle,
          objectiveId: focus?.objective_id ?? null,
        }
      : null

  /* EXACTLY three parts — one per slot, no more. Each slot takes its own
     best claim: the derived, numbered one when the rows support it, else the
     server's evidence-backed one (which keeps its "why"). One act only: the
     build button lives on the NEXT STEP — the stuck row is the diagnosis,
     and giving both a button seeded the same task twice. */
  /* The working row is a MEASURED win — a strong topic, or the subject where
     objectives were actually mastered. Its act is a word to the child: the
     button lands on the messages screen with this student selected and a
     praise sentence prefilled, still the teacher's to edit and send. A
     recorded character strength is not shown here — a teacher cannot act on
     "wants to succeed", and this row exists to be acted on. */
  const win = strongest
    ? {
        text: t('tch.recs.workingTopic', {
          topic: strongest.label,
          percent: Math.round(strongest.rate * 100),
        }),
        praiseTopic: strongest.label,
      }
    : (() => {
        const best = Object.entries(progress)
          .filter(([, stats]) => stats.objectives_mastered > 0)
          .sort((a, b) => b[1].objectives_mastered - a[1].objectives_mastered)[0]
        if (!best) return null
        const subjectName = subjectLabel(best[0], t)
        return {
          text: t(countKey('tch.recs.workingMastered', best[1].objectives_mastered), {
            subject: subjectName, mastered: best[1].objectives_mastered,
          }),
          praiseTopic: subjectName,
        }
      })()

  const praiseDialog = (
    <PraiseDialog
      strength={praiseFor}
      names={new Map([[learnerId, nameOf(learnerId)]])}
      onClose={(sent) => {
        if (sent && praiseFor) {
          setPraisedFor(praiseFor.title)
          try { window.localStorage.setItem(praisedKey, praiseFor.title) } catch { /* private mode */ }
        }
        setPraiseFor(null)
      }}
    />
  )

  const serverDeepen = recommendations.filter((rec) => rec.category === 'deepen')
  const working: ReactElement | null = win ? (
    <li key="win" className="tch-rec">
      <div className="tch-rec__head">
        <StatusPill tone="strong">{t('tch.recs.slot.working')}</StatusPill>
        <span className="tch-rec__acts">
          {/* Opens the composer HERE rather than navigating to the messages
              screen with a sentence pre-seeded. Leaving the profile to say a
              good word cost the teacher the context they were reading — and
              landing on a different screen with words already typed made the
              act feel like the system's rather than theirs.

              Hidden once said, until the win itself changes. The row is a
              standing observation, not an inbox item, so it keeps saying the
              same true thing every time the page is opened; without this the
              button invites the same message about the same topic every week,
              which is how praise stops meaning anything. A NEW strongest topic
              brings it back — that is a new thing to say. */}
          {praisedFor === win.praiseTopic ? (
            <span className="tch-rec__said">
              <Icon name="check" size={13} aria-hidden />
              {t('tch.recs.praised')}
            </span>
          ) : (
            <button
              type="button"
              className="sp-btn sp-btn--ghost sp-btn--sm"
              onClick={() => setPraiseFor({
                id: win.praiseTopic,
                title: win.praiseTopic,
                learnerIds: [learnerId],
              })}
            >
              <Icon name="message" size={14} aria-hidden />
              {t('tch.recs.praise')}
            </button>
          )}
        </span>
      </div>
      <p className="tch-rec__text" dir="auto">{win.text}</p>
    </li>
  ) : serverDeepen[0] ? (
    <RecommendationCard key="sw" recommendation={serverDeepen[0]} />
  ) : null

  const stuck: ReactElement | null = weakest ? (
    <li key="weak" className="tch-rec">
      <div className="tch-rec__head">
        <StatusPill tone="steady">{t('tch.recs.slot.stuck')}</StatusPill>
      </div>
      <p className="tch-rec__text" dir="auto">
        {t('tch.recs.practiceTopic', {
          topic: weakest.label,
          percent: Math.round(weakest.rate * 100),
          questions: weakest.questions,
        })}
      </p>
    </li>
  ) : dependent ? (
    <li key="dependent" className="tch-rec">
      <div className="tch-rec__head">
        <StatusPill tone="support">{t('tch.recs.slot.stuck')}</StatusPill>
      </div>
      <p className="tch-rec__text" dir="auto">
        {t('tch.recs.independenceTask', {
          helped: derived.helped, answered: derived.answered,
        })}
      </p>
    </li>
  ) : serverStuck[0] ? (
    <RecommendationCard key="ss" recommendation={serverStuck[0]} />
  ) : null

  const next: ReactElement | null = nextStep ? (
    <li key="step" className="tch-rec">
      <div className="tch-rec__head">
        <StatusPill tone="neutral">{t('tch.recs.slot.next')}</StatusPill>
        <span className="tch-rec__acts">
          {buildButton(nextStep.topic, nextStep.objectiveId)}
        </span>
      </div>
      <p className="tch-rec__text" dir="auto">{nextStep.text}</p>
    </li>
  ) : serverNext[0] ? (
    <RecommendationCard key="sn" recommendation={serverNext[0]} />
  ) : null

  const items = [working, stuck, next].filter(Boolean) as ReactElement[]

  return (
    <Panel className="tch-recsPanel" data-tour="teacher.recommendations">
      <SectionHeader
        title={t('tch.student.recommendations')}
        subtitle={t('tch.student.recommendationsSubtitle')}
      />
      {/* The generic opening paragraph that led this panel is gone per Reut —
          it read the same for every child. The three slot cards below carry
          the evidence-backed content. */}
      <ul className="tch-recs">{items}</ul>
      {praiseDialog}
    </Panel>
  )
}

/* ── goals: a card, not a screen ────────────────────────────────────────────
 *
 * The full goal experience (drafts, data-based suggestions, the learner-read
 * context column) lives in `GoalDialog`, the same dialog the goals board
 * opens — one composer, everywhere. The card only answers "what goals are
 * live and how are they going", and the + hands over to the dialog with this
 * child already chosen.
 */

function GoalsCard({ learnerId, name }: { learnerId: string; name: string }) {
  const { t } = useI18n()
  const [goals, setGoals] = useState<StudentGoal[] | null>(null)
  const [isComposing, setComposing] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let active = true
    getStudentGoals(learnerId)
      .then((response) => {
        if (!active) return
        setGoals((response.conversations ?? []).flatMap((row) => row.goals ?? []))
      })
      .catch(() => { if (active) setGoals([]) })
    return () => { active = false }
  }, [learnerId, version])

  return (
    <section id="goals" className="tch-student__goals">
      <Panel className="tch-goalsCard">
        <SectionHeader
          title={t('tch.student.goalsCard')}
          action={(
            <button
              type="button"
              className="sp-btn sp-btn--ghost sp-btn--sm"
              onClick={() => setComposing(true)}
            >
              <Icon name="plus" size={14} aria-hidden />
              {t('tch.goalsPage.create')}
            </button>
          )}
        />
        {goals === null ? (
          <SkeletonRows rows={2} />
        ) : goals.length ? (
          <ul className="tch-goalsCard__list">
            {goals.slice(0, 5).map((goal) => (
              <li key={goal.id} className="tch-goalsCard__goal">
                {/* Title and stage share one line; the stage is a chip beside
                    the words, never a full-width bar under them. */}
                <div className="tch-goalsCard__goalHead">
                  <strong dir="auto">{goal.title}</strong>
                  {goal.progress_stage ? (
                    <StatusPill tone={goal.progress_stage === 'summarized' ? 'strong' : 'neutral'}>
                      {t(`tch.goals.stage.${goal.progress_stage}`)}
                    </StatusPill>
                  ) : null}
                  {goal.deadline ? (
                    <span className="tch-goalsCard__deadline">
                      {t('tch.goals.deadline', { date: goal.deadline })}
                    </span>
                  ) : null}
                </div>
                <GoalProgressLine goal={goal} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="tch-goalsCard__none">{t('tch.student.goalsNone')}</p>
        )}
      </Panel>

      <GoalDialog
        open={isComposing}
        learnerId={learnerId}
        candidates={[{ id: learnerId, name }]}
        onPick={() => { /* one candidate, already chosen */ }}
        onClose={() => setComposing(false)}
        onAssigned={() => {
          setComposing(false)
          setVersion((value) => value + 1)
        }}
      />
    </section>
  )
}

/* ── the sometimes-reading, behind doors ───────────────────────────────────── */

function MoreDialogs({ detail, trends, extra }: {
  detail: StudentDetail
  trends: LearnerTrends | null
  /** An extra door rendered in the same row, same dress — the wellbeing
   *  button rides here so the bottom of the page is ONE row of doors. */
  extra?: ReactNode
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState<'portrait' | 'balance' | 'trend' | null>(null)

  const struggles = detail.struggle_items ?? []
  const evidenced = struggles.filter((item) => item.source !== 'questionnaire')
  const described = struggles.filter((item) => item.source === 'questionnaire')
  const hasPortrait = Boolean(detail.portrait?.blocks.length || described.length)
  const hasBalance = Boolean((detail.strengths_detail ?? []).length || evidenced.length)

  const doors: { key: 'portrait' | 'balance' | 'trend'; icon: string; label: string; show: boolean }[] = [
    { key: 'portrait', icon: 'face', label: t('tch.student.portrait'), show: hasPortrait },
    { key: 'balance', icon: 'spark', label: t('tch.student.balanceBtn'), show: hasBalance },
    { key: 'trend', icon: 'chart', label: t('tch.student.trend'), show: Boolean(trends) },
  ]
  if (!doors.some((door) => door.show) && !extra) return null

  return (
    <div className="tch-student__more">
      {doors.filter((door) => door.show).map((door) => (
        <button
          key={door.key}
          type="button"
          className="sp-btn sp-btn--ghost"
          onClick={() => setOpen(door.key)}
        >
          <Icon name={door.icon} size={15} aria-hidden />
          {door.label}
        </button>
      ))}
      {extra}

      <Modal open={open === 'portrait'} onClose={() => setOpen(null)}
             titleId="tch-more-portrait" className="tch-student__moreDialog">
        <h2 id="tch-more-portrait" className="sp-sr-only">{t('tch.student.portrait')}</h2>
        <PortraitPanel portrait={detail.portrait} described={described} />
      </Modal>

      <Modal open={open === 'balance'} onClose={() => setOpen(null)}
             titleId="tch-more-balance" className="tch-student__moreDialog">
        <h2 id="tch-more-balance" className="sp-sr-only">{t('tch.student.balanceBtn')}</h2>
        <Balance strengths={detail.strengths_detail ?? []} difficulties={evidenced} />
      </Modal>

      <Modal open={open === 'trend'} onClose={() => setOpen(null)}
             titleId="tch-more-trend" className="tch-student__moreDialog">
        <h2 id="tch-more-trend" className="sp-sr-only">{t('tch.student.trend')}</h2>
        <TrendStrip trends={trends} />
      </Modal>
    </div>
  )
}

function Balance({ strengths, difficulties }: {
  strengths: StrengthDetail[]
  difficulties: StruggleItem[]
}) {
  const { t } = useI18n()
  /* When every strength came from the same place — three from the onboarding
     mapping is the common case — the provenance is a fact about the COLUMN,
     not about each row. */
  const notes = strengths.map((strength) => strengthNote(strength, t))
  const sharedNote = notes.length > 1 && new Set(notes).size === 1 ? notes[0] : null

  if (!strengths.length && !difficulties.length) return null

  return (
    <Panel className="tch-balance" data-tour="teacher.struggles">
      <div className="tch-balance__cols">
        <section className="tch-balance__col tch-balance__col--strong">
          <h3 className="tch-balance__title">
            <Icon name="spark" size={15} aria-hidden />
            {t('tch.student.strengths')}
          </h3>
          {sharedNote ? (
            <p className="tch-balance__caption" dir="auto">{sharedNote}</p>
          ) : null}
          {strengths.length ? (
            <ul className="tch-strengths">
              {strengths.map((strength, index) => (
                <StrengthRow key={index} strength={strength} note={sharedNote ? null : notes[index]} />
              ))}
            </ul>
          ) : (
            <p className="tch-balance__none">{t('tch.student.noStrengths')}</p>
          )}
        </section>

        <div className="tch-balance__rule" role="presentation" />

        <section className="tch-balance__col tch-balance__col--soft">
          <h3 className="tch-balance__title">
            <Icon name="target" size={15} aria-hidden />
            {t('tch.student.struggles')}
          </h3>
          {difficulties.length ? (
            <ul className="tch-struggles">
              {difficulties.map((item, index) => (
                <StruggleRow key={item.objective_id ?? index} item={item} />
              ))}
            </ul>
          ) : (
            <p className="tch-balance__none">{t('tch.student.noStruggles')}</p>
          )}
        </section>
      </div>
      <p className="tch-balance__foot">{t('tch.student.balanceFoot')}</p>
    </Panel>
  )
}

/* One strength. The provenance is the quiet second line where the evidence
 * belongs, not a pill shouted louder than the strength itself. */
function strengthNote(
  strength: StrengthDetail,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const evidence = strength.evidence ?? {}
  const attempts = Number(evidence.attempts ?? 0)
  if (strength.kind === 'success_area' && attempts) {
    return t('tch.strength.evidence.mastered', {
      successes: Number(evidence.successes ?? 0), attempts,
    })
  }
  if (strength.kind === 'consistent_improvement') {
    const when = typeof evidence.at === 'string' ? ` · ${agoLabel(evidence.at, t)}` : ''
    return t('tch.strength.evidence.improved') + when
  }
  const key = `tch.strength.source.${strength.source ?? 'system'}`
  return withFallback(t(key), key, t('tch.strength.source.system'))
}

function StrengthRow({ strength, note }: { strength: StrengthDetail; note: string | null }) {
  return (
    <li className="tch-strength">
      <span className="tch-strength__label" dir="auto">{strength.label}</span>
      {note ? <span className="tch-strength__note" dir="auto">{note}</span> : null}
    </li>
  )
}

/* How the system sees this learner, in the sentences it has already written.
 *
 * `student_description` (brain A-5) is a running portrait maintained from
 * observed evidence — already paid for, no model call on this page. The
 * questionnaire answers stay at the bottom as what they are: what the child
 * said about themselves before any of this was observed. */
const PORTRAIT_ICON: Record<string, string> = {
  how_to_reach: 'message',
  what_frustrates: 'alert',
  learning_preferences: 'book',
  motivational_patterns: 'spark',
}

function PortraitPanel({ portrait, described }: {
  portrait: StudentPortrait | null
  described: StruggleItem[]
}) {
  const { t } = useI18n()
  const [isFull, setFull] = useState(false)
  if (!portrait?.blocks.length && !described.length) return null

  const blocks = portrait?.blocks ?? []
  const extra = blocks.reduce((sum, block) => sum + Math.max(0, block.lines.length - 1), 0)

  return (
    <Panel className="tch-portrait">
      <SectionHeader
        title={t('tch.student.portrait')}
        subtitle={t('tch.student.portraitSubtitle')}
      />
      {blocks.length ? (
        <>
          <div className="tch-portrait__facets">
            {blocks.map((block) => {
              const lead = block.lines[block.lines.length - 1]
              const rest = isFull ? block.lines.slice(0, -1) : []
              return (
                <section key={block.key} className="tch-portrait__facet">
                  <h4>
                    <Icon name={PORTRAIT_ICON[block.key] ?? 'spark'} size={13} aria-hidden />
                    {t(`tch.portrait.${block.key}`)}
                  </h4>
                  <p dir="auto">{lead}</p>
                  {rest.map((line, index) => (
                    <p key={index} className="tch-portrait__more" dir="auto">{line}</p>
                  ))}
                </section>
              )
            })}
          </div>
          <div className="tch-portrait__foot">
            <span className="tch-portrait__provenance">
              {t('tch.student.portraitFrom', { count: portrait?.evidence_count ?? 0 })}
              {portrait?.updated_at ? ` · ${agoLabel(portrait.updated_at, t)}` : ''}
            </span>
            {extra ? (
              <button
                type="button"
                className="tch-evidence__toggle"
                aria-expanded={isFull}
                onClick={() => setFull((value) => !value)}
              >
                <Icon name={isFull ? 'chevronUp' : 'chevronLeft'} size={13} aria-hidden />
                {isFull
                  ? t('tch.student.portraitLess')
                  : t(countKey('tch.student.portraitMore', extra), { count: extra })}
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {described.length ? (
        <p className="tch-portrait__said" dir="auto">
          <span className="tch-portrait__saidLabel">{t('tch.student.selfMapped')}</span>
          {described.map((item) => item.label).filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </Panel>
  )
}

/* One struggle row, drawn the same way whichever list it is in — the two lists
 * differ in what they CLAIM, not in how a row looks. */
function StruggleRow({ item }: { item: StruggleItem }) {
  const { t } = useI18n()
  return (
    <li className="tch-struggle">
      <div className="tch-struggle__head">
        <strong dir="auto">{item.label ?? item.objective_id}</strong>
        {item.subject ? (
          <StatusPill tone="neutral">{subjectLabel(item.subject, t)}</StatusPill>
        ) : null}
      </div>
      {item.evidence?.length ? (
        <p className="tch-struggle__tags" dir="auto">
          {item.evidence.map((entry) => entry.tag).filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <RawEvidence raw={item.raw_evidence as Record<string, unknown>} />
    </li>
  )
}

/* The month in one row: what they did each day, how much of it, how often. */
function TrendStrip({ trends }: { trends: LearnerTrends | null }) {
  const { t, language } = useI18n()
  if (!trends) return null
  const days = trends.per_day
  const worked = days.some((day) => day.attempts > 0 || day.minutes > 0)

  /* Short and dateful — "12 באוג׳". The readout appears over a 56px line, so
     the full date would be wider than the chart it is annotating. */
  const shortDate = (iso: string) => {
    const parsed = new Date(iso)
    if (Number.isNaN(parsed.getTime())) return iso
    return parsed.toLocaleDateString(
      language === 'he' ? 'he-IL' : language === 'ar' ? 'ar' : 'en-GB',
      { day: 'numeric', month: 'short' })
  }

  return (
    <Panel className="tch-trend">
      <SectionHeader
        title={t('tch.student.trend')}
        subtitle={t('tch.student.trendSubtitle', { days: trends.days })}
      />
      {worked ? (
        <>
          <div className="tch-trend__charts">
            <div className="tch-trend__chart">
              <span className="tch-trend__chartLabel">{t('tch.student.trendAttempts')}</span>
              <span className="tch-trend__chartHint">{t('tch.student.trendAttemptsHint')}</span>
              <HoverSparkline
                points={days.map((day) => ({ date: day.date, value: day.attempts }))}
                format={(value) => t('tch.student.trendAttemptsValue', { count: value })}
                formatDate={shortDate}
                ariaLabel={t('tch.student.trendAttempts')}
                height={56}
              />
            </div>
            <div className="tch-trend__chart">
              <span className="tch-trend__chartLabel">{t('tch.student.trendMinutes')}</span>
              <span className="tch-trend__chartHint">{t('tch.student.trendMinutesHint')}</span>
              <HoverSparkline
                points={days.map((day) => ({ date: day.date, value: day.minutes }))}
                format={(value) => t('tch.student.trendMinutesValue', { count: value })}
                formatDate={shortDate}
                ariaLabel={t('tch.student.trendMinutes')}
                height={56}
              />
            </div>
          </div>

          <dl className="tch-trend__facts">
            <div>
              <dt>{t('tch.student.trendActiveDays')}</dt>
              <dd>{t('tch.student.trendActiveDaysValue', {
                count: trends.active_days, days: trends.days })}</dd>
              <p>{t('tch.student.trendActiveDaysHint')}</p>
            </div>
            <div>
              <dt>{t('tch.student.trendStreak')}</dt>
              <dd>{t('tch.student.trendStreakValue', { count: trends.streak })}</dd>
              <p>{t('tch.student.trendStreakHint')}</p>
            </div>
            <div>
              <dt>{t('tch.kpi.successRate')}</dt>
              {/* A fraction, or an em dash. Never a confident 0%. */}
              <dd>{trends.totals.success_rate === null
                ? '—' : `${Math.round(trends.totals.success_rate * 100)}%`}</dd>
              <p>{t('tch.student.trendSuccessHint')}</p>
            </div>
            <div>
              <dt>{t('tch.student.trendMinutes')}</dt>
              <dd>{t('tch.student.trendMinutesValue', { count: trends.totals.minutes })}</dd>
              <p>{t('tch.student.trendTotalMinutesHint')}</p>
            </div>
          </dl>

          {trends.mastered_steps.length ? (
            <p className="tch-trend__mastered">
              <Icon name="check" size={13} aria-hidden />
              {t(countKey('tch.student.trendMastered', trends.mastered_steps.length),
                 { count: trends.mastered_steps.length })}
            </p>
          ) : null}
        </>
      ) : (
        <p className="tch-trend__quiet">{t('tch.student.trendQuiet', { days: trends.days })}</p>
      )}
    </Panel>
  )
}

/* ── the hardest card's unit of meaning: a topic, not a question ─────────────
 *
 * "שאלה 2 · פתיחה, הקנייה ותרגול סטנדרטי א" told a teacher which BAR went
 * badly and nothing about which IDEA did. The objective is the product's
 * shared word for an idea — mastery, the gaps card, tasks and the coach all
 * speak in objectives — so it is the grouping key, and every question that
 * serves the same objective is summed into one row.
 *
 * Every label here is authored catalogue content carried on the row by
 * `learning_analytics.label_learner_rows`; nothing is inferred. Where the
 * catalogue does not name the objective the row falls to the unit and then to
 * the lesson — and SAYS so with a level tag, because a lesson title presented
 * as a topic would be a lie of altitude.
 *
 * The same aggregation runs server-side in `topic_digest` (same keys, same
 * thresholds) — that is how a digest paragraph finds its topic row. Keep the
 * two in lockstep. */

/** Enough evidence to call a topic hard: total attempts across all its
 *  questions, matching the class-wide reading (`HARD_QUESTION_MIN_ATTEMPTS`). */
const TOPIC_MIN_ATTEMPTS = 4
const TOPICS_PER_SUBJECT = 8
/** Below this rate a question "went badly" and its authored `teaches` text
 *  feeds the server-side digest for this topic. */
const TOPIC_TEACHES_RATE = 0.7

interface Topic {
  key: string
  /** Authored catalogue title — objective, or the named fallback level. */
  label: string
  /** Which catalogue level `label` names. Only `objective` passes untagged;
   *  a unit or lesson name is tagged as such on the row. */
  level: 'objective' | 'unit' | 'lesson'
  objectiveId: string | null
  subject: string
  attempts: number
  correct: number
  rate: number
  questions: number
  /** The content's own `teaches` text for the questions that went badly —
   *  the digest's raw material, not shown raw. */
  teaches: string[]
  /** Distinct unit titles seen under this topic — the relabel source when two
   *  objectives share a title. */
  unitTitles: string[]
}

function buildTopicSections(rows: QuestionRow[]): { subject: string; topics: Topic[] }[] {
  const bySubject = new Map<string, Map<string, Topic>>()
  for (const row of rows) {
    if (!row.attempts) continue // a screen only read is not evidence of difficulty
    const objectiveTitle = (row.objective_title || '').trim()
    const unitTitle = (row.unit_title || '').trim()
    const learningTitle = (row.learning_title || '').trim()
    let key: string
    let label: string
    let level: Topic['level']
    if (row.objective_id && objectiveTitle) {
      key = `obj:${row.objective_id}`
      label = objectiveTitle
      level = 'objective'
    } else if (unitTitle) {
      key = `unit:${unitTitle}`
      label = unitTitle
      level = 'unit'
    } else if (learningTitle) {
      key = `lesson:${row.component_id ?? learningTitle}`
      label = learningTitle
      level = 'lesson'
    } else {
      // The catalogue names this work at no level at all — a topic row must
      // trace to an authored title, so this row contributes none.
      continue
    }
    const subject = (row.subject || '').trim()
    const topics = bySubject.get(subject) ?? new Map<string, Topic>()
    bySubject.set(subject, topics)
    const topic = topics.get(key) ?? {
      key, label, level,
      objectiveId: row.objective_id ?? null,
      subject,
      attempts: 0, correct: 0, rate: 0, questions: 0,
      teaches: [], unitTitles: [],
    }
    topics.set(key, topic)
    topic.attempts += row.attempts
    topic.correct += row.correct
    topic.questions += 1
    if (unitTitle && !topic.unitTitles.includes(unitTitle)) topic.unitTitles.push(unitTitle)
    const teaches = (row.teaches || '').trim()
    if (teaches && row.correct / row.attempts < TOPIC_TEACHES_RATE
        && !topic.teaches.includes(teaches)) {
      topic.teaches.push(teaches)
    }
  }

  const sections: { subject: string; topics: Topic[] }[] = []
  for (const [subject, topics] of bySubject) {
    /* The catalogue's objective titles come from the registry's SUB-TOPIC
       level, and two objectives under one sub-topic really do share a title
       (verified live: MASS-PRACTICE and GROSS-NET are both "מסה ונפח של
       גופים"). Two rows saying the same words would read as a bug, so where
       objective titles collide within a subject, those topics fall to their
       distinct unit titles — and the level tag says so. */
    const labelCount = new Map<string, number>()
    for (const topic of topics.values()) {
      if (topic.level !== 'objective') continue
      labelCount.set(topic.label, (labelCount.get(topic.label) ?? 0) + 1)
    }
    for (const topic of topics.values()) {
      if (topic.level !== 'objective' || (labelCount.get(topic.label) ?? 0) < 2) continue
      if (topic.unitTitles.length) {
        topic.label = topic.unitTitles.join(' · ')
        topic.level = 'unit'
      }
    }
    const ranked = [...topics.values()]
      .filter((topic) => topic.attempts >= TOPIC_MIN_ATTEMPTS)
      .map((topic) => ({ ...topic, rate: topic.correct / topic.attempts }))
      .sort((a, b) => a.rate - b.rate || b.attempts - a.attempts)
      .slice(0, TOPICS_PER_SUBJECT)
    if (ranked.length) sections.push({ subject, topics: ranked })
  }
  // Most-worked subject first — the same order the teacher's attention takes.
  sections.sort((a, b) =>
    b.topics.reduce((sum, topic) => sum + topic.attempts, 0)
    - a.topics.reduce((sum, topic) => sum + topic.attempts, 0))
  return sections
}

function TopicRow({ topic, learnerId, digestItem, digestState, onBuildTask }: {
  topic: Topic
  learnerId: string
  digestItem: TopicDigestItem | null
  digestState: DigestState
  onBuildTask: (seed: TaskSeed) => void
}) {
  const { t } = useI18n()
  const percent = Math.round(topic.rate * 100)
  const tone = topic.rate < 0.5 ? 'danger' : topic.rate < 0.7 ? 'warn' : 'success'

  /* A closed drawer per topic: the summary row carries the topic, its subject
     and its numbers; opening it reveals the digested "why" and the build-task
     act. The list stays scannable, the depth stays one click away. */
  return (
    <details className="tch-topics__topic">
      <summary className="tch-topics__row">
        <span className="tch-topics__name" dir="auto">
          {topic.label}
          {topic.level !== 'objective' ? (
            /* A unit or lesson title standing in for a topic says which level
               it is naming — never dressed up as an idea it is not. */
            <span className="tch-topics__levelTag">
              {t(`tch.student.topicLevel.${topic.level}`)}
            </span>
          ) : null}
        </span>
        {topic.subject ? (
          <span className={`tch-topics__subj is-${topic.subject}`} dir="auto">
            {subjectLabel(topic.subject, t)}
          </span>
        ) : null}
        <span className="tch-topics__bar" aria-hidden="true">
          <i className={`is-${tone}`} style={{ inlineSize: `${percent}%` }} />
        </span>
        <span className="tch-topics__figures">
          <span className={`tch-topics__value is-${tone}`}>
            {/* A topic never answered right is the headline — and at the
                floor a percentage compares nothing, so the fraction is
                written in words instead. */}
            {topic.correct === 0
              ? t('tch.student.topicFloor', { attempts: topic.attempts })
              : `${percent}%`}
          </span>
          {/* How much is behind the number, quietly — a real pattern and a
              thin one must not wear the same paint. */}
          <span className="tch-topics__evidence">
            {t(countKey('tch.student.topicQuestions', topic.questions), { count: topic.questions })}
            {' · '}
            {t(countKey('tch.student.topicAttempts', topic.attempts), { count: topic.attempts })}
          </span>
        </span>
        <span className="tch-topics__chevron" aria-hidden="true">
          <Icon name="chevronDown" size={14} />
        </span>
      </summary>
      <div className="tch-topics__detail">
        {/* One short paragraph on why this topic is hard — grounded in the
            content's own descriptions and the numbers, written once and
            cached. The raw source texts never render here. */}
        {digestItem ? (
          <p className="tch-topics__why" dir="auto">{digestItem.sentences.join(' ')}</p>
        ) : digestState === 'generating' ? (
          <p className="tch-topics__digestWait" aria-live="polite">
            {t('tch.student.digestGenerating')}
          </p>
        ) : null}
        {/* The finding's next move, on the finding itself — the same seed the
            dashboard's gap rows plant: the builder opens on this objective,
            and the child rides along to the send dialog. */}
        <button
          type="button"
          className="sp-btn sp-btn--ghost sp-btn--sm tch-topics__assign"
          onClick={() => {
            onBuildTask({
              title: t('tch.gaps.taskTitle', { label: topic.label }),
              topic: topic.label,
              objectiveId: topic.objectiveId,
              learnerIds: [learnerId],
            })
          }}
        >
          <Icon name="backpack" size={14} aria-hidden />
          {t('tch.student.topicAssign')}
        </button>
      </div>
    </details>
  )
}

function TopicsPanel({ rows, learnerId, digest, digestState, onBuildTask }: {
  rows: QuestionRow[] | null
  learnerId: string
  digest: TopicDigest | null
  digestState: DigestState
  onBuildTask: (seed: TaskSeed) => void
}) {
  const { t } = useI18n()

  /* Hardest TOPICS first — "שאלה 2 הקשתה" is a fact a teacher can do nothing
     with; "מערכת צירים הקשתה" is a lesson plan. */
  const topicSections = useMemo(() => buildTopicSections(rows ?? []), [rows])
  /* Which subject's topics are shown — 'all' until the teacher narrows. */
  const [filter, setFilter] = useState('all')
  const digestByKey = useMemo(() => {
    const map = new Map<string, TopicDigestItem>()
    for (const item of digest?.topics ?? []) map.set(item.key, item)
    return map
  }, [digest])

  /* The panel's own wait, wearing the panel's own heading: the teacher can
     see a ranked list of hard topics is coming here, rather than a floating
     grey card that could turn out to be anything. */
  if (!rows) {
    return (
      <Panel aria-busy="true">
        <SectionHeader
          title={t('tch.student.hardest')}
          subtitle={t('tch.student.hardestSubtitle')}
        />
        <div className="sp-skeleton__rows">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} h={34} />)}
        </div>
      </Panel>
    )
  }
  if (!topicSections.length) return null

  return (
    <Panel>
      {/* No refresh button. It appeared only when the digest had gone stale,
          which made it a control that exists on some visits and not others —
          and what it offered was to re-word a summary of rows the teacher can
          already read underneath it. The rows are always current; the summary
          catches up on its own. */}
      <SectionHeader
        title={t('tch.student.hardest')}
        subtitle={t('tch.student.hardestSubtitle')}
      />
      {/* One flat list, a subject chip on every row — the subject headings
          became a filter. Rows stay ranked within their subject (sections
          are concatenated, never re-sorted across subjects). */}
      {topicSections.length > 1 ? (
        <div className="tch-builder__chips tch-topics__filter">
          <button type="button" className={`tch-chip${filter === 'all' ? ' is-on' : ''}`}
                  aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            {t('tch.tasks.allSubjects')}
          </button>
          {topicSections.map((section) => (
            <button key={section.subject || 'other'} type="button"
                    className={`tch-chip${filter === section.subject ? ' is-on' : ''}`}
                    aria-pressed={filter === section.subject}
                    onClick={() => setFilter(section.subject)}>
              {subjectLabel(section.subject, t) || t('tch.subject.other')}
            </button>
          ))}
        </div>
      ) : null}
      <div className="tch-topics">
        {topicSections
          .filter((section) => filter === 'all' || section.subject === filter)
          .flatMap((section) => section.topics)
          .map((topic) => (
            <TopicRow
              key={topic.key}
              topic={topic}
              learnerId={learnerId}
              digestItem={digestByKey.get(topic.key) ?? null}
              digestState={digestState}
              onBuildTask={onBuildTask}
            />
          ))}
      </div>
    </Panel>
  )
}
