/* Teacher home (F6 group level).
 *
 * Three zones, in descending order of what a teacher must act on:
 *   1. Needs you now  — the attention inbox, full width, coloured accents
 *   2. Class pulse    — engagement + progress, compact stat row
 *   3. Depth          — learning gaps and sub-group moves, collapsed
 *
 * That ordering IS the requirement "אופן הצגת המידע יאפשר הבחנה בין מידע מהותי
 * למידע משני" — essential above secondary, by layout rather than by label.
 *
 * Nothing here compares one student to another: the trends are aggregates and
 * the gaps are counts.
 */

import { useEffect, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  Card, EmptyState, ErrorState, Icon, SectionHeader, Skeleton, SkeletonCard,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  getGroupEngagement, getGroupGaps, getGroupMoments, getGroupSnapshot,
  type Engagement, type GroupInsight, type GroupRecommendation, type LearningGap,
  type Moment,
} from '../../../services/teacher'
import { useTeacherLive } from '../../../providers/TeacherLiveProvider'
import { AlertRow } from '../live/LiveNow'
import { AttentionRow, EvidenceToggle } from '../shared/EvidenceDisclosure'
import { StudentFacepile } from '../shared/StudentFacepile'
import { countKey } from '../shared/countLabel'
import { putSeed } from '../tasks/taskSeed'
import { DailyBriefHero } from './DailyBrief'
import { MomentsFeed } from '../moments/MomentsFeed'
import './teacher-home.css'

export function TeacherHomePage() {
  const { t, language } = useI18n()
  const {
    groups, groupId, setGroupId, group, subject,
    isLoading: scopeLoading, error: scopeError,
  } = useTeacherScope()
  const live = useTeacherLive()

  const [snapshot, setSnapshot] = useState<GroupInsight | null>(null)
  const [engagement, setEngagement] = useState<Engagement | null>(null)
  const [gaps, setGaps] = useState<LearningGap[]>([])
  const [moments, setMoments] = useState<Moment[]>([])
  const [recommendations, setRecommendations] = useState<GroupRecommendation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  /** Which gap's assignment dialog is open, by objective id. One at a time. */

  useEffect(() => {
    if (!groupId) { setIsLoading(false); return }
    let active = true
    setIsLoading(true)
    setError(false)
    Promise.all([
      getGroupSnapshot(groupId, language, subject ?? undefined),
      getGroupEngagement(groupId),
      getGroupGaps(groupId, language, subject ?? undefined),
    ])
      .then(([snapshotResult, engagementResult, gapsResult]) => {
        if (!active) return
        setSnapshot(snapshotResult)
        setEngagement(engagementResult)
        setGaps(gapsResult.gaps)
        setRecommendations(gapsResult.recommendations)
      })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [groupId, subject, language])

  /* The feed fans out across every learner in the group, so it loads on its own
     rather than holding up the stats a teacher opens Home for. An empty feed is
     a valid state — nothing changed this week is information too. */
  useEffect(() => {
    if (!groupId) return
    let active = true
    setMoments([])
    getGroupMoments(groupId, language)
      .then((response) => { if (active) setMoments(response.moments ?? []) })
      .catch(() => { if (active) setMoments([]) })
    return () => { active = false }
  }, [groupId, language])

  const busy = scopeLoading || isLoading
  if (scopeError || error) return <ErrorState title={t('tch.error')} />

  const trends = snapshot?.trends

  /* Names for the sub-group picker. The gap carries learner ids (it is computed
     over mastery, not over the roster), so the display names come from the
     snapshot the page already loaded rather than a second fetch. */
  const rosterNames = new Map(
    (snapshot?.students ?? []).map((row) => [row.learner_id, row.display_name])
  )

  /* The people a row is about. `learner_ids` is always the struggling set —
     which is the sub-group of a gap row and the *opposite* one on a strength
     row, where the children being described are the ones who mastered it. A
     payload from before `mastered_ids` existed simply shows no faces there
     rather than the wrong ones. */
  const subGroupOf = (gap: LearningGap) =>
    (gap.kind === 'gap' ? gap.learner_ids : gap.mastered_ids) ?? []

  /* A live alert and a derived attention flag can describe the SAME condition —
     a distress message raises a `safety_flag` alert and also becomes a
     `wellbeing` flag in the insights engine, so the student appeared twice in
     the inbox. The alert wins: it is minutes old and can be acknowledged, while
     the flag is a read-only projection of the same fact.

     Suppression is per condition, not per student: a learner can legitimately
     have a live struggle AND a nine-day inactivity flag, and collapsing those
     would hide the one the alert does not cover. */
  const COVERED_BY: Record<string, string[]> = {
    safety_flag: ['wellbeing'],
    coach_handoff: ['help_requested'],
    struggling: ['wheel_spinning', 'rapid_guessing', 'slow_progress'],
  }
  const covered = new Set(
    live.openAlerts.flatMap((alert) =>
      (COVERED_BY[alert.kind] ?? []).map((kind) => `${alert.learner_id}:${kind}`))
  )
  const attention = (snapshot?.attention ?? []).filter(
    (flag) => !covered.has(`${flag.learner_id}:${flag.kind}`)
  )

  // Names come from the snapshot the page already loaded — the live lane
  // deliberately carries learner ids only, so nothing has to join on the server.
  const nameFor = (learnerId: string) =>
    snapshot?.students.find((row) => row.learner_id === learnerId)?.display_name ?? learnerId

  // Presence arrives keyed by learner; the strip wants the group's full roster
  // so the absent are visible too, and the snapshot is what knows who that is.
  const liveRows = (snapshot?.students ?? []).map(
    (student) => live.presence[student.learner_id]
      ?? {
        learner_id: student.learner_id, status: 'offline' as const, connections: 0,
        component_id: null, unit_id: null, objective_id: null, session_id: null,
        last_seen_at: null, lesson_entered_at: null, struggling: null,
        help_requested_at: null,
      }
  )

  const inLessonNow = liveRows.filter((row) => row.status === 'in_lesson').length
  const needsCount = attention.length + live.openAlerts.length
  const today = new Date().toLocaleDateString(
    language === 'he' ? 'he-IL' : language === 'ar' ? 'ar' : 'en-GB',
    { weekday: 'long', day: 'numeric', month: 'long' }
  )

  /* Loading paints the SAME frame, not a different page: the header and the
     class picker are real from the first frame, and only the four values and
     the zone bodies are placeholders. Nothing moves when the data lands. */
  if (busy) {
    return (
      <div className="tch-home" aria-busy="true">
        <header className="tch-home__head">
          <h1><Skeleton w={220} h={26} /></h1>
          <p className="tch-home__subtitle"><Skeleton w={180} h={14} /></p>
        </header>
        {/* Same order as the loaded page, or the layout jumps as data lands:
            the numbers first, then the hero that talks about them. */}
        <section className="tch-zone" aria-label={t('tch.pulse.title')}>
          <div className="tch-stats">
            {[0, 1, 2, 3].map((index) => <SkeletonCard key={index} rows={1} />)}
          </div>
        </section>
        {/* The hero holds its own space here. Without it the whole page jumped
            down the moment the scope resolved and the real hero mounted. */}
        <section className="tch-brief is-loading" aria-hidden="true">
          <div className="tch-brief__aurora"><i /><i /><i /></div>
        </section>
        <div className="tch-home__cols">
          <section className="tch-zone tch-zone--urgent"><SkeletonCard rows={4} /></section>
        </div>
        <div className="tch-home__row tch-home__row--single">
          <section className="tch-zone tch-zone--quiet"><SkeletonCard rows={2} /></section>
        </div>
      </div>
    )
  }
  if (!groupId) return <EmptyState title={t('tch.noGroups')} />

  return (
    <div className="tch-home">
      {/* Which class, and which day. This sits ABOVE the brief because it is the
          frame the brief is read inside: a summary with no class name on it is a
          summary of nothing in particular. */}
      <header className="tch-home__head">
        {/* Switching class is a dashboard act — the picker lives here, on the
            title itself, not as a dropdown in the chrome. */}
        {groups.length > 1 ? (
          <label className="tch-home__classPick" data-tour="teacher.scope">
            <span className="sp-sr-only">{t('tch.scope.group')}</span>
            <select
              value={groupId ?? ''}
              onChange={(event) => setGroupId(event.target.value)}
              aria-label={t('tch.scope.group')}
            >
              {groups.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
            <Icon name="chevronUp" size={16} aria-hidden className="tch-home__classChevron" />
          </label>
        ) : (
          <h1 dir="auto" data-tour="teacher.scope">{group?.name ?? t('tch.title')}</h1>
        )}
        <p className="tch-home__subtitle">
          {today}
          <span className="tch-home__dot" aria-hidden="true"> · </span>
          {t('tch.home.studentsCount', { count: trends?.students_total ?? 0 })}
        </p>
      </header>

      {/* ── the numbers a teacher scans before anything else ───────────────── */}
      <section className="tch-zone" data-tour="teacher.pulse" aria-label={t('tch.pulse.title')}>
        <div className="tch-stats">
          {/* The way in to the live classroom, which now lives on the roster —
              "who is here right now" is a question about the class list, and on
              this page it competed with the attention inbox for the same eye. */}
          <Card
            interactive
            className={`tch-stat${inLessonNow ? ' tch-stat--live' : ''}`}
            role="link"
            tabIndex={0}
            onClick={() => navigate('/teacher/students?view=live')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                navigate('/teacher/students?view=live')
              }
            }}
            aria-label={t('tch.kpi.inLessonNow.open')}
          >
            <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
              <Icon name="pulse" size={18} />
            </span>
            <span className="tch-stat__text">
              <strong className="tch-stat__value">{inLessonNow}</strong>
              <span className="tch-stat__label">{t('tch.kpi.inLessonNow')}</span>
              <span className="tch-stat__hint">
                {t('tch.live.counts', {
                  inLesson: inLessonNow,
                  online: liveRows.filter((row) => row.status !== 'offline').length,
                  total: liveRows.length,
                })}
              </span>
            </span>
          </Card>

          {/* "Needs attention" used to be a KPI here AND the header of the
              inbox immediately below it — the same number, twice, a centimetre
              apart. The inbox keeps it, because that is where the teacher acts
              on it, and this slot says something no other tile on the page
              does: who has never started at all. They are invisible in every
              engagement percentage, because they generate no events to be a
              percentage of. */}
          <Card
            interactive
            className="tch-stat"
            role="link"
            tabIndex={0}
            onClick={() => navigate('/teacher/students?filter=not_started')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                navigate('/teacher/students?filter=not_started')
              }
            }}
          >
            <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
              <Icon name="clock" size={18} />
            </span>
            <span className="tch-stat__text">
              <strong className="tch-stat__value">{trends?.not_started ?? 0}</strong>
              <span className="tch-stat__label">{t('tch.students.filter.notStarted')}</span>
              <span className="tch-stat__hint">{t('tch.students.kpi.notStartedHint')}</span>
            </span>
          </Card>

          <Card className="tch-stat">
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
          </Card>

          <Card className="tch-stat">
            <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
              <Icon name="clock" size={18} />
            </span>
            <span className="tch-stat__text">
              {/* Honest about missing timing rather than showing a confident 0. */}
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
          </Card>

        </div>
      </section>

      {/* The front door, under the numbers it talks about.
          It used to sit above them, and carried its own row of three stats —
          every one of which was already on this page: "טרם התחילו" twice over,
          "דורשים תשומת לב" beside the inbox that heads with it, and
          "היו פעילים 2/6" beside a KPI whose own hint reads "2 מתוך 6".
          The strip owns the numbers; the hero owns the sentence about them. */}
      <DailyBriefHero groupId={groupId} />

      {/* ── needs you now · beside the live board ──────────────────────────── */}
      {/* Two columns on purpose: mid-class the teacher's question is "who is
          stuck right now AND where is everyone" — one glance, no scrolling.
          The inbox scrolls inside its card instead of pushing the page down. */}
      <div className="tch-home__cols">
        <section className="tch-zone tch-zone--urgent" data-tour="teacher.attentionInbox">
          <SectionHeader
            title={t('tch.attention.title')}
            subtitle={t('tch.attention.subtitle', { count: needsCount })}
          />

          <div className="tch-home__inboxScroll">
            {/* Realtime alerts first — they are minutes old, the flags below are
                derived from days of history. */}
            {live.openAlerts.length ? (
              <div className="tch-home__alerts">
                {live.openAlerts.map((alert) => (
                  <AlertRow
                    key={alert._id}
                    alert={alert}
                    name={nameFor(alert.learner_id)}
                    onOpen={() => navigate(`/teacher/student/${alert.learner_id}`)}
                    onAcknowledge={() => live.acknowledge(alert._id)}
                    onResolve={() => live.resolve(alert._id)}
                  />
                ))}
              </div>
            ) : null}

            {attention.length ? (
              <div className="tch-home__attention">
                {attention.map((flag) => (
                  <AttentionRow
                    key={`${flag.learner_id}:${flag.kind}`}
                    flag={flag}
                    title={flag.display_name ?? flag.learner_id}
                    onOpen={() => navigate(`/teacher/student/${flag.learner_id}`)}
                  />
                ))}
              </div>
            ) : !live.openAlerts.length ? (
              <EmptyState title={t('tch.attention.none')} />
            ) : null}
          </div>
        </section>
      </div>

      {/* ── zone 3 · depth ─────────────────────────────────────────────────── */}
      {/* One card per zone, flat rows inside — a card inside a card says
          "container" twice and content zero times. */}
      {/* The weekly digest panel used to sit here. The brief at the top of the
          page answers the same question on a cadence that matches how often a
          teacher actually looks — two AI summaries of one class, at two
          cadences, on one screen was one too many. `weekly_digest` and its
          route are untouched. */}
      <div className="tch-home__row tch-home__row--single">
        <section className="tch-zone tch-zone--quiet" data-tour="teacher.moments">
          <details open={moments.length > 0}>
            <summary className="tch-zone__summary">
              {t('tch.moments.title')}
              <span className="tch-zone__count">{moments.length}</span>
            </summary>
            <div className="tch-zone__body">
              <p className="tch-panelSub">{t('tch.moments.subtitle')}</p>
              <MomentsFeed moments={moments} nameOf={(id) => rosterNames.get(id) ?? null} showLearner />
            </div>
          </details>
        </section>
      </div>

      <section className="tch-zone tch-zone--quiet" data-tour="teacher.gaps">
        <details open={gaps.length > 0}>
          <summary className="tch-zone__summary">
            {t('tch.gaps.title')}
            <span className="tch-zone__count">{gaps.length}</span>
          </summary>

          <div className="tch-zone__body">
            {gaps.length ? (
              <>
                {/* Two headed lists, and a sentence per row.
                    The bar this replaces was polymorphic — it filled with
                    `struggling / with_evidence` on one row and
                    `mastered / with_evidence` on the next, so the same length
                    meant opposite things on adjacent lines and only a colour
                    said which. The fraction beside it had no noun, and its
                    denominator was not the class but "the learners with any
                    evidence on this objective", which nothing on screen said.
                    A sentence can carry all three, and colour stops being the
                    only thing distinguishing a strength from a gap. */}
                {(['gap', 'strength'] as const).map((kind) => {
                  const rows = gaps.filter((gap) => gap.kind === kind)
                  if (!rows.length) return null
                  return (
                    <div key={kind} className="tch-gaps__group">
                      <h4 className="tch-gaps__groupTitle">
                        {t(kind === 'gap' ? 'tch.gaps.group.gaps' : 'tch.gaps.group.strengths')}
                      </h4>
                      <ul className="tch-gaps__list">
                        {rows.map((gap) => (
                          <li key={gap.objective_id} className={`tch-gap tch-gap--${gap.kind}`}>
                            <strong className="tch-gap__label" dir="auto">{gap.label}</strong>
                            <p className="tch-gap__sentence" dir="auto">
                              {gap.with_evidence
                                ? t(kind === 'gap'
                                    ? 'tch.gaps.sentence.gap' : 'tch.gaps.sentence.strength', {
                                  count: kind === 'gap' ? gap.struggling_count : gap.mastered_count,
                                  tried: gap.with_evidence,
                                })
                                : t('tch.gaps.noneTried')}
                              {' '}
                              <span className="tch-gap__classSize">
                                {t('tch.gaps.classSize', { size: gap.group_size })}
                              </span>
                            </p>
                            {/* A gap's answer is material, not a goal.
                                This used to open the sub-group goal dialog —
                                a title, next steps and a date, which is a note
                                to the teacher's future self rather than
                                anything a child receives. What actually closes
                                a gap is work on it, so the button now starts a
                                task about this objective, with the children it
                                is a gap FOR carried through to the send. */}
                            <div className="tch-gap__actions">
                              {/* Whose row this is. A gap row is about the
                                  children who are stuck, a strength row about
                                  the ones who have it — the same sentence over
                                  two different sets of people, and neither set
                                  had a face on it. The count answers "how
                                  many"; only this answers "who", which is the
                                  question a teacher acts on. */}
                              <StudentFacepile
                                learnerIds={subGroupOf(gap)}
                                names={rosterNames}
                                label={t('tch.gaps.who.aria')}
                                heading={t(gap.kind === 'gap'
                                  ? 'tch.gaps.who.gap' : 'tch.gaps.who.strength')}
                              />
                              <EvidenceToggle
                                raw={{
                                  struggling_count: gap.struggling_count,
                                  mastered_count: gap.mastered_count,
                                  with_evidence: gap.with_evidence,
                                  group_size: gap.group_size,
                                }}
                              />
                              {gap.kind === 'gap' ? (
                                <button
                                  type="button"
                                  className="sp-btn sp-btn--ghost sp-btn--sm"
                                  onClick={() => {
                                    putSeed({
                                      title: t('tch.gaps.taskTitle', { label: gap.label }),
                                      topic: gap.label,
                                      objectiveId: gap.objective_id,
                                      learnerIds: gap.learner_ids,
                                    })
                                    navigate('/teacher/tasks')
                                  }}
                                >
                                  <Icon name="backpack" size={14} aria-hidden />
                                  {t(countKey('tch.gaps.buildTask', gap.learner_ids.length),
                                     { count: gap.learner_ids.length })}
                                </button>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}

                {recommendations.length ? (
                  <div className="tch-groupRecs">
                    <SectionHeader title={t('tch.gaps.recommendations')} />
                    <ul>
                      {recommendations.map((recommendation) => {
                        /* Each move comes from exactly one gap, so the people it
                           is a move FOR are already on the page — joined on the
                           objective rather than re-derived, so the faces here and
                           the faces on the row above can never disagree. */
                        const source = gaps.find(
                          (gap) => gap.objective_id === recommendation.objective_id)
                        return (
                        <li key={`${recommendation.action}:${recommendation.objective_id}`}>
                          {/* The move is UI text and the label is Kata content, so
                              these are routinely opposite directions (Hebrew
                              objective, English interface). Without isolation the
                              bidi algorithm pulls the separator into the Hebrew
                              run and the two words collide: "masteryמערכת". */}
                          <strong dir="auto">{recommendation.text}</strong>
                          <span className="tch-groupRecs__sep"> — </span>
                          {/* An objective the catalogue cannot name renders as
                              nothing rather than as its dotted MOE key — and
                              the em dash goes with it, so the sentence does not
                              end mid-air. */}
                          {recommendation.label ? (
                            <bdi dir="auto">{recommendation.label}</bdi>
                          ) : null}
                          {source ? (
                            <StudentFacepile
                              className="tch-groupRecs__who"
                              learnerIds={subGroupOf(source)}
                              names={rosterNames}
                              label={t('tch.gaps.who.aria')}
                              heading={t(source.kind === 'gap'
                                ? 'tch.gaps.who.gap' : 'tch.gaps.who.strength')}
                              size={20}
                            />
                          ) : null}
                        </li>
                        )
                      })}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState title={t('tch.gaps.none')} />
            )}
          </div>
        </details>
      </section>
    </div>
  )
}
