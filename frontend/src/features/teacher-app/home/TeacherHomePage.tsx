/* Teacher home (F6 group level) — the #450 refactor.
 *
 * One question, answered top to bottom: which of my students is fine, which is
 * wobbling, which needs me today — over a stretch of time the teacher chooses.
 *
 * The period (day / 3 days / week / month) is not a label on the same numbers:
 * it re-reads all four zones. The KPIs recompute over it AND against the equal
 * window before it, the bands re-judge against it, the gaps narrow to what the
 * class worked on inside it, and the book becomes the edition before it. Every
 * window is trailing, so the two halves of a comparison are always the same
 * length — see `periodModel`.
 *
 * In order:
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

import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  getGapDiagnosis,
  getGroupEngagement, getGroupGaps, getGroupMoments, getGroupMood, getGroupSnapshot,
  type ClassMood, type Engagement, type GroupInsight, type LearningGap,
  type Moment,
} from '../../../services/teacher'
import {
  DifficultiesCard, type DifficultyItem, type StrengthItem,
} from '../shared/DifficultiesCard'
import { SubgroupDialog } from '../students/SubgroupDialog'
import { TaskBuilder } from '../tasks/TeacherTasksPage'
import { type TaskSeed } from '../tasks/taskSeed'
import { MomentsAlbum } from '../moments/MomentsAlbum'
import { bookEdition } from '../moments/bookModel'
import { BandFace, type Band } from './BandFace'
import { type BandedStudent } from './bandModel'
import { gapToDifficultyItem } from './gapsModel'
import { MoodDialog } from './MoodDialog'
import { MoodDonut, MoodKey, overallValence } from './MoodViz'
import { ValenceFace } from '../../checkin/ValenceFaces'
import { PeriodControl } from './PeriodControl'
import { PraiseDialog } from '../shared/PraiseDialog'
import { Sparkline } from './Sparkline'
import {
  DEFAULT_PERIOD, delta, isPeriodId, periodDays,
  type PeriodId,
} from '../shared/periodModel'
import { subjectLabel } from '../shared/subjectLabel'
import { StatDelta } from './StatDelta'
import { StudentBandDialog } from './StudentBandDialog'
import { StudentsBandCard } from './StudentsBandCard'
import './teacher-home.css'

export function TeacherHomePage() {
  const { t, language } = useI18n()
  const { user, updatePreferences } = useAuth()
  const {
    groupId, group, subgroup, subgroupLearnerIds, subject,
    isLoading: scopeLoading, error: scopeError, refreshSubgroups,
  } = useTeacherScope()

  /* The period is remembered on the user, not in this component's state alone:
     a teacher who reads their class by the month should not have to say so
     every morning, and it must follow them to the classroom machine. Seeded
     from preferences so the first paint is already the right window. */
  const stored = user?.preferences?.teacher_period
  const [period, setPeriod] = useState<PeriodId>(
    isPeriodId(stored) ? stored : DEFAULT_PERIOD)
  const days = periodDays(period)

  const [snapshot, setSnapshot] = useState<GroupInsight | null>(null)
  const [engagement, setEngagement] = useState<Engagement | null>(null)
  const [gaps, setGaps] = useState<LearningGap[]>([])
  const [mood, setMood] = useState<ClassMood | null>(null)
  const [moments, setMoments] = useState<Moment[]>([])
  const [momentsLoading, setMomentsLoading] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  const [bandFilter, setBandFilter] = useState<Band | null>(null)
  const [openStudent, setOpenStudent] = useState<BandedStudent | null>(null)
  const [moodOpen, setMoodOpen] = useState(false)
  const bandsRef = useRef<HTMLElement | null>(null)

  const [builderSeed, setBuilderSeed] = useState<TaskSeed | null>(null)
  const [subgroupFor, setSubgroupFor] = useState<DifficultyItem | null>(null)
  const [praiseFor, setPraiseFor] = useState<StrengthItem | null>(null)
  const [subgroupBusy, setSubgroupBusy] = useState(false)
  const [subgroupError, setSubgroupError] = useState('')

  useEffect(() => {
    if (!groupId) { setIsLoading(false); return }
    let active = true
    setIsLoading(true)
    setError(false)
    Promise.all([
      /* The bands are NOT narrowed by subject, deliberately — see the note on
         the students card below and `group_snapshot`'s own docstring. */
      getGroupSnapshot(groupId, language, days),
      getGroupEngagement(groupId, days, subject),
      getGroupGaps(groupId, language, subject ?? undefined, days),
      /* Its own read rather than a field on the snapshot: the check-in store is
         a different collection with a different shape, and a class that has
         never checked in must not cost the dashboard anything to discover. */
      getGroupMood(groupId, days).catch(() => null),
    ])
      .then(([snapshotResult, engagementResult, gapsResult, moodResult]) => {
        if (!active) return
        setSnapshot(snapshotResult)
        setEngagement(engagementResult)
        setGaps(gapsResult.gaps)
        setMood(moodResult)
      })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [groupId, language, days, subject])

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
    /* The fetch window is derived from the edition itself — the weekly book
       is calendar-aligned (last completed Sun–Sat) while other periods roll,
       so hardcoded offsets fit one and miss the other. The offset excludes
       days newer than the edition (their moments would spend the row limit on
       pages the book will not print), the day count reaches back past the
       edition's first midnight, and `momentsInEdition` trims the overshoot so
       the cover never claims a day the pages do not cover. */
    const DAY = 86_400_000
    const edition = bookEdition(days)
    const offsetDays = Math.max(0, Math.floor((Date.now() - edition.end) / DAY))
    const fetchDays = Math.max(1,
      Math.ceil((Date.now() - edition.start) / DAY) - offsetDays + 1)
    getGroupMoments(groupId, language, fetchDays, offsetDays, subject)
      .then((response) => { if (active) setMoments(response.moments ?? []) })
      .catch(() => { if (active) setMoments([]) })
      .finally(() => { if (active) setMomentsLoading(false) })
    return () => { active = false }
  }, [groupId, language, days, subject])

  /* `user` can arrive after the first render, so the seed above may have fallen
     back to the default before the real preference was readable. Adopt it when
     it lands — but only until the teacher has touched the control, or a slow
     /auth/me would yank the screen back off the period they just picked. */
  const touchedPeriod = useRef(false)
  useEffect(() => {
    if (touchedPeriod.current) return
    if (isPeriodId(stored) && stored !== period) setPeriod(stored)
  }, [stored, period])

  const selectPeriod = (next: PeriodId) => {
    touchedPeriod.current = true
    setPeriod(next)
    /* Fire-and-forget, like the scope bar's: a failed preference write must
       never stop a teacher from reading their own class over a month. */
    void updatePreferences({ teacher_period: next }).catch(() => {})
  }

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

  /* Loading paints the SAME frame — and everything about that frame that is
     FIXED is real from the first frame: the greeting, the period control, each
     KPI's icon and name, the students card's title and its four filter chips.
     Only the measurements grey out — the figure, the comparison chip, the
     sparkline, the count inside a chip — because those are the only things the
     page genuinely does not know yet. Three anonymous grey cards here made the
     whole screen read as "nothing yet" when most of it was already known. */
  if (busy) {
    /* The three KPI cells, in the order and the shapes they load into:
       two sparklines and the mood ring. */
    const pulse = [
      { key: 'engagement', icon: 'users', viz: 'line' },
      { key: 'avgMinutes', icon: 'clock', viz: 'line' },
      { key: 'mood', icon: 'face', viz: 'ring' },
    ] as const
    return (
      <div className="tch-home" aria-busy="true">
        <header className="tch-home__head">
          <h1 dir="auto">{greeting}</h1>
          {/* Live during the load, not a placeholder: switching period is what
              a teacher is most likely to want while waiting, and disabling it
              would make the screen feel stuck rather than busy. */}
          <PeriodControl value={period} onChange={selectPeriod} />
        </header>

        <section className="tch-zone" aria-label={t('tch.pulse.title')}>
          <div className="tch-stats" aria-hidden="true">
            {pulse.map((cell) => (
              <div key={cell.key} className="tch-stat">
                <span className="tch-stat__icon tch-stat__icon--primary">
                  <Icon name={cell.icon} size={18} />
                </span>
                <span className="tch-stat__text">
                  <span className="tch-stat__label">{t(`tch.pulse.${cell.key}`)}</span>
                  {/* The figure and its comparison chip, at the sizes the real
                      ones render at, so the row's height is settled now. */}
                  <span className="tch-stat__line">
                    <Skeleton w={52} h={22} r={4} />
                    <Skeleton w={88} h={16} r={999} />
                  </span>
                  <Skeleton w="72%" h={11} />
                </span>
                <span className="tch-stat__viz">
                  {/* Sparkline canvas is 72×40; the mood donut is a 48px ring. */}
                  {cell.viz === 'ring'
                    ? <Skeleton w={48} h={48} r={999} />
                    : <Skeleton w={72} h={30} r={6} />}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="sp-panel tch-bands" aria-hidden="true">
          <div className="tch-bands__bar">
            <div className="tch-bands__titles">
              <h2>{t('tch.band.title')}</h2>
            </div>
            <div className="tch-bands__tools">
              {/* The four chips, icon + count like the real ones — inert spans
                  rather than disabled buttons, so nothing looks pressable
                  before it is. Only each chip's count is still a question. */}
              <div className="tch-bands__filters">
                {(['red', 'orange', 'green'] as const).map((band) => (
                  <span key={band} className={`tch-bands__chip is-${band}`}>
                    <BandFace band={band} size={20} />
                    <Skeleton w={16} h={14} r={999} />
                  </span>
                ))}
                <span className="tch-bands__chip is-fresh">
                  <Icon name="pulse" size={14} aria-hidden />
                  <Skeleton w={16} h={14} r={999} />
                </span>
              </div>
            </div>
          </div>
          {/* A band of children: face-and-name pairs in the card's own grid
              rhythm. Ten of them — enough to say "a class goes here" without
              pretending to know its size. */}
          <div className="tch-bands__skeletonList">
            {Array.from({ length: 10 }, (_, index) => (
              <span key={index} className="tch-bands__skeletonStudent">
                <Skeleton w={30} h={30} r={999} />
                <Skeleton w={index % 3 === 1 ? 76 : 56} h={12} />
              </span>
            ))}
          </div>
        </section>

        {/* The gaps card: its very heading depends on what the data holds
            (gaps, strengths, or both, possibly narrowed to a subject), so
            unlike the two zones above nothing about it can be printed yet. */}
        <section className="sp-panel" aria-hidden="true">
          <Skeleton w="34%" h={18} />
          <SkeletonCard rows={4} />
        </section>
      </div>
    )
  }
  if (!groupId) return <EmptyState title={t('tch.noGroups')} />

  const gapItems = gaps.filter((gap) => gap.kind === 'gap')
    .map((gap) => gapToDifficultyItem(gap, t))
  const strengths = gaps.filter((gap) => gap.kind === 'strength')

  /* One child, one side.
   *
   * A learner could appear as struggling on one topic and mastering another
   * that carries the SAME title — the catalogue has two distinct science
   * objectives both called "מסה ונפח של גופים", so this is not a data error,
   * but on one card under one heading it reads as the screen contradicting
   * itself, and a teacher cannot act on "both".
   *
   * Resolved toward the difficulty, always: "this child needs help here" is
   * the actionable half, and quietly promoting them to the strengths column
   * would hide the thing worth doing something about. A strength emptied by
   * this is dropped rather than shown with nobody in it. */
  const struggling = new Map<string, Set<string>>()
  gapItems.forEach((item) => {
    const set = struggling.get(item.title) ?? new Set<string>()
    item.learnerIds.forEach((id) => set.add(id))
    struggling.set(item.title, set)
  })
  const strengthItems: StrengthItem[] = strengths
    .map((gap) => {
      const stuck = struggling.get(gap.label)
      return {
        id: gap.objective_id,
        title: gap.label,
        learnerIds: (gap.mastered_ids ?? []).filter((id) => !stuck?.has(id)),
        subjectLabel: gap.subject ?? null,
        /* Matched on the TITLE, not the objective id, because the title is
           what a teacher sees repeat — and after the filter above the note is
           precise rather than apologetic: these really are different children,
           because any who were in both have been removed from this side. */
        alsoADifficulty: Boolean(stuck?.size),
      }
    })
    .filter((strength) => strength.learnerIds.length > 0)

  /* The card's heading has to describe what is actually inside it.
   *
   * One fixed pair of lines claimed both halves whatever was there. Narrowed to
   * maths — which has one difficulty and no strengths — the card announced
   * "what is hard and what is already working · for every topic: who is stuck,
   * who has it, and what you can do" above a single row, promising two things
   * it was not showing and a breadth it did not have. A heading that overstates
   * its own card is how a teacher learns to stop reading headings.
   *
   * And when a subject narrows the card, the subject is NAMED. The scope bar
   * says it too, but the bar is chrome above the page and this is a claim about
   * a class — "what the class is finding hard" and "what the class is finding
   * hard in maths" are different statements, and only one of them is true here.
   */
  const hasGaps = gapItems.length > 0
  const hasStrengths = strengthItems.length > 0
  const shape = hasGaps && hasStrengths ? 'both' : hasStrengths ? 'strengths' : 'gaps'
  const gapsTitle = subject
    ? `${t(`tch.gaps.card.title.${shape}`)} ${
      t('tch.gaps.card.inSubject', { subject: subjectLabel(subject, t) })}`
    : t(`tch.gaps.card.title.${shape}`)

  /* Every "nothing here" on this screen has to name the window it is about.
     Narrowed to three days, a class that simply has not opened anything yet
     this week has no gaps — and the unqualified "no group-wide gaps detected"
     turns that into a claim about the CLASS rather than about the period,
     which is both much stronger and untrue. */
  const inWhen = t(`tch.period.in.${period}`)
  /* What the chips are measured against, phrased once: "לעומת השבוע שעבר".
     Both KPIs compare to the same stretch, so it is built here rather than
     twice at the call sites where the two could drift apart. */
  const comparedTo = t('tch.stat.comparedTo', {
    when: t(`tch.period.prevBare.${period}`),
  })

  /* Computed once each: the chip beside the value and the baseline under the
     hint are two views of one comparison, and deriving them separately is how
     they drift apart. Engagement is measured in percentage POINTS — it is
     itself a percentage, and a relative reading of 24%→83% is "+246%" on a
     metric that cannot exceed 100. Minutes have no ceiling, so they take the
     ordinary relative change. */
  const engagementDelta = delta(
    engagement?.active_pct, engagement?.previous?.active_pct, 'points')
  /* Percentage POINTS, like engagement: this is itself a share, so a relative
     reading of 40%→68% would print "+70%" on a metric capped at 100. */
  const moodDelta = mood?.enough && mood.previous?.enough
    ? delta(mood.positive_pct, mood.previous.positive_pct, 'points')
    : null
  /* Which of the five faces the room as a whole is wearing — the icon on the
     mood KPI, so the mark is the answer rather than the subject. */
  const vibe = overallValence(mood)
  const minutesDelta = delta(
    engagement?.timing_available ? engagement.avg_active_minutes : null,
    engagement?.previous?.timing_available ? engagement.previous.avg_active_minutes : null,
  )

  return (
    <div className="tch-home">
      {/* ── a person saying hello, and the stretch they are reading over ──── */}
      <header className="tch-home__head">
        <h1 dir="auto">{greeting}</h1>
        <PeriodControl value={period} onChange={selectPeriod} />
      </header>

      {/* ── three numbers, each explaining itself ──────────────────────────── */}
      <section className="tch-zone" data-tour="teacher.pulse" aria-label={t('tch.pulse.title')}>
        <div className="tch-stats">
          <Hint text={t('tch.kpi.engagement.hint', { days: engagement?.window_days ?? days })}>
            <div className="tch-stat">
              <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
                <Icon name="users" size={18} />
              </span>
              <span className="tch-stat__text">
                {/* Label first on this row, unlike the KPI cards elsewhere.
                    With a comparison chip attached, value-then-label reads as
                    "53%, ↑9% since last week … of what?" — the subject arrives
                    after two numbers have already been parsed. Naming the
                    metric first costs nothing and the figure still dominates
                    by weight and size. */}
                <span className="tch-stat__label">{t('tch.pulse.engagement')}</span>
                <span className="tch-stat__line">
                  <strong className="tch-stat__value">{engagement?.active_pct ?? 0}%</strong>
                  <StatDelta
                    delta={engagementDelta}
                    label={t('tch.pulse.engagement')}
                    when={comparedTo}
                  />
                </span>
                <span className="tch-stat__hint">
                  {/* "41 מתוך 41 פעילים" — the window is not repeated here:
                      the period control above is the one place that names it. */}
                  {t('tch.pulse.activeOf', {
                    active: engagement?.active_students ?? 0,
                    total: engagement?.students_total ?? 0,
                  })}
                </span>
              </span>
              {/* Oldest day first, so the newest point is at the right-hand
                  end — an SVG is not mirrored by direction, which is what we
                  want here: time reads the same way in both languages.

                  TODAY IS EXCLUDED. It is a half-lived day, so it always came
                  in under a full one and pulled the last point down — a class
                  at 100% engagement showing a line that falls off a cliff at
                  the right, which reads as "they stopped" instead of "it is
                  lunchtime". The figure beside it still counts today. */}
              <span className="tch-stat__viz">
                <Sparkline
                  points={(engagement?.per_day_active ?? [])
                    .filter((row) => !row.partial).map((row) => row.active)}
                  label={t('tch.pulse.perDay', { days: engagement?.window_days ?? days })}
                />
              </span>
            </div>
          </Hint>

          <Hint text={t('tch.kpi.avgMinutes.hint')}>
            <div className="tch-stat">
              <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
                <Icon name="clock" size={18} />
              </span>
              <span className="tch-stat__text">
                <span className="tch-stat__label">{t('tch.pulse.avgMinutes')}</span>
                <span className="tch-stat__line">
                  {/* Honest about missing timing rather than a confident 0. */}
                  <strong className="tch-stat__value">
                    {engagement?.timing_available && engagement.avg_active_minutes !== null
                      ? engagement.avg_active_minutes
                      : '—'}
                  </strong>
                  {/* No timing evidence in EITHER window means no comparison —
                      `delta` is given the nulls rather than a substituted zero,
                      and answers with nothing. */}
                  <StatDelta
                    delta={minutesDelta}
                    label={t('tch.pulse.avgMinutes')}
                    when={comparedTo}
                  />
                </span>
                <span className="tch-stat__hint">
                  {engagement?.timing_available
                    ? t('tch.pulse.minutesPerLearner')
                    : t('tch.pulse.noTiming')}
                </span>
              </span>
              {/* Minutes per day, on the same terms as the figure beside it.
                  Only when timing evidence exists: with none, the series is all
                  zeros and a flat line at the floor would read as "the class
                  did nothing" rather than "we cannot tell". */}
              <span className="tch-stat__viz">
                {engagement?.timing_available ? (
                  <Sparkline
                    points={(engagement.per_day_minutes ?? [])
                      .filter((row) => !row.partial).map((row) => row.minutes)}
                    label={t('tch.pulse.minutesPerDay', {
                      days: engagement?.window_days ?? days,
                    })}
                  />
                ) : null}
              </span>
            </div>
          </Hint>

          {/* Not a number about learning at all — how the class has been
              FEELING, from the daily check-in.

              This slot has now duplicated twice. #450 held a count of students
              needing attention and lost it to the students card below; it then
              held the topic blocking the class and lost that to the gaps card
              below (ADO #500). The pattern is structural: everything under this
              row is already "what is wrong with the class" in rising detail, so
              any summary of that is met again a screen later.

              Mood is the one thing on the page nothing else says, and the
              check-in has been collecting it per child per day since #452
              without any class-level reader. Reported as a SHAPE, never as a
              name and never as an alert — the check-in's own rule is that a
              feeling opens a conversation rather than raising one. */}
          {/* The breakdown rides in the card's OWN tooltip rather than in a
              second one attached to the ring: the hint already covers the whole
              cell, so a nested tooltip would open two bubbles on the same
              hover, and the ring is the last place a teacher would think to
              point at to find out what it means. */}
          {/* With answers behind it the cell is a real button (#505): the
              click the distribution always invited, opening who is behind
              each family. Without answers it stays a plain cell — a disabled
              button would also swallow the hover the hint rides on. */}
          <Hint
            text={(
              <>
                {t('tch.kpi.mood.hint')}
                {mood?.answers ? <MoodKey mood={mood} /> : null}
              </>
            )}
          >
            <MoodCell clickable={!!mood?.answers} onOpen={() => setMoodOpen(true)}>
              {/* The icon says the answer, not the topic. A generic smiley here
                  was the same mark whether the class was having its best week
                  or its worst — decoration in the one slot on the row that had
                  something to say. It now carries the room's overall face, and
                  falls back to the neutral mark below the evidence gate rather
                  than inventing a mood.

                  The BOX stays identical to the other two. Tinting it by
                  valence made one of three marks change colour week to week,
                  which reads as a status light — and a class feeling low is not
                  a warning state. The face carries the meaning; its container
                  is just a container. */}
              <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
                {vibe ? <ValenceFace valence={vibe} size={24} /> : <Icon name="face" size={18} />}
              </span>
              <span className="tch-stat__text">
                <span className="tch-stat__label">{t('tch.pulse.mood')}</span>
                <span className="tch-stat__line">
                  {/* Below the evidence gate the share is noise, and "68% feel
                      good" built on two answers is worse than saying nothing. */}
                  <strong className="tch-stat__value">
                    {mood?.enough ? `${mood.positive_pct}%` : '—'}
                  </strong>
                  {mood?.enough ? (
                    <StatDelta delta={moodDelta} label={t('tch.pulse.mood')} when={comparedTo} />
                  ) : null}
                </span>
                <span className="tch-stat__hint">
                  {/* Of the children who ANSWERED, never of the class — a
                      response rate of eighteen out of forty-one makes those two
                      very different claims. */}
                  {mood?.enough
                    ? t('tch.pulse.moodOf', {
                      answered: mood.answered_students, total: mood.students_total,
                    })
                    : t('tch.pulse.moodThin')}
                </span>

              </span>
              <span className="tch-stat__viz">
                {mood ? <MoodDonut mood={mood} /> : null}
              </span>
            </MoodCell>
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
      {/* The wrapper exists only to anchor the tour step, but it also breaks
          the rhythm: the panel spacing rule matches `.sp-panel` children of
          `.tch-home`, and this plain div is not one — so the card inside it
          contributed no bottom margin and whatever followed sat flush against
          it. Most visible under a short card, which is why it surfaced on the
          quiet book. Carrying the same class keeps the spacing with the tour
          anchor rather than in a second place that can drift. */}
      <div data-tour="teacher.gaps" className="tch-home__zone">
      {/* No subtitle line: the two column headings inside already say what
          each half is, and the sentence above them restated both. */}
      <DifficultiesCard
        className="tch-home__gaps"
        title={gapsTitle}
        items={gapItems}
        names={rosterNames}
        emptyLabel={t('tch.gaps.noneInPeriod', { when: inWhen })}
        onBuildTask={(seed) => setBuilderSeed(seed)}
        onCreateSubgroup={(item) => setSubgroupFor(item)}
        itemsTitle={t('tch.gaps.card.gapsColumn')}
        strengths={strengthItems}
        strengthsTitle={t('tch.gaps.group.strengths')}
        strengthsHeading={t('tch.gaps.who.strength')}
        onPraise={setPraiseFor}
        /* "למה?" answers the question now (#507): the row's id IS the
           objective id on this surface, so the loader reads its diagnosis. */
        loadWhy={(item) => getGapDiagnosis(groupId, item.id, language).catch(() => null)}
      />
      </div>


      {/* ── the week as a book — the page's finale: scrolling down to it pins
             the view, the closed cover fills it, and the book opens ─────────── */}
      <MomentsAlbum
        moments={moments}
        isLoading={momentsLoading}
        periodDays={days}
        nameOf={(id) => rosterNames.get(id) ?? null}
        groupName={group?.name ?? null}
        groupId={group?.id ?? null}
      />

      <StudentBandDialog student={openStudent} onClose={() => setOpenStudent(null)} />

      {/* Who is behind each feeling (#505) — opened from the mood KPI. */}
      {mood ? (
        <MoodDialog
          mood={mood}
          nameOf={(id) => rosterNames.get(id) ?? id}
          open={moodOpen}
          onClose={() => setMoodOpen(false)}
        />
      ) : null}

      {/* The one encouraging action on the page: a good word, sparks optional,
          to the children who got a topic (#467). */}
      <PraiseDialog
        strength={praiseFor}
        names={rosterNames}
        onClose={() => setPraiseFor(null)}
      />

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

/* The mood KPI's shell: a real <button> when there are answers to open
   (#505), a plain cell when there are not — a disabled button would also
   swallow the hover the cell's hint rides on. Same body either way. */
function MoodCell({ clickable, onOpen, children }: {
  clickable: boolean
  onOpen: () => void
  children: ReactNode
}) {
  if (!clickable) return <div className="tch-stat">{children}</div>
  return (
    <button
      type="button"
      className="tch-stat tch-stat--button"
      onClick={onOpen}
      aria-haspopup="dialog"
    >
      {children}
    </button>
  )
}

