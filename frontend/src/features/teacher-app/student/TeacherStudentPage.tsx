/* Student profile (F6 student level).
 *
 * Tabs, because a teacher opens this with one question at a time: what is she
 * struggling with, how is she progressing, what did she try, what do I think.
 *
 * Requirement coverage:
 *   Overview     — struggle items (§1) + tailored recommendations (§2)
 *                  + progress vs objectives per subject (§4) + strengths (N§1)
 *   Activity     — per-question support usage, incl. what Yuvi already tried
 *   Reflections  — self-assessment vs system assessment (N§2)
 *   Notes        — the teacher's own insights into the profile (§3)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  BarSeries, DualLine, HoverSparkline, ObjectiveStrip,
} from '../../../components/charts'
import {
  Card, EmptyState, ErrorState, Icon, Panel, SectionHeader, Skeleton, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  getStudentActivity, getStudentDetail, getStudentReflections, getStudentTrends,
  type LearnerTrends, type QuestionRow, type StrengthDetail, type StudentDetail,
  type StudentPortrait, type StruggleItem, type SubjectProgress,
} from '../../../services/teacher'
import {
  AttentionRow, RawEvidence, RecommendationCard, withFallback,
} from '../shared/EvidenceDisclosure'
import { TeacherGoals } from './TeacherGoals'
import { TeacherNotes } from './TeacherNotes'
import { TeacherBadges } from './TeacherBadges'
import { TeacherConnection } from './TeacherConnection'
import { TeacherWellbeing } from './TeacherWellbeing'
import { MomentsFeed } from '../moments/MomentsFeed'
import { getStudentMoments, getStudentBadges, type Moment, type TeacherBadge } from '../../../services/teacher'
import { Badge, type BadgeGlyph, type BadgeTier } from '../../../components/Badge'
import { useTeacherLive } from '../../../providers/TeacherLiveProvider'
import { agoLabel } from '../live/LiveNow'
import { useRoute } from '../../../app/router'
import './teacher-student.css'
import { StudentAvatar } from '../shared/StudentAvatar'
import { countKey } from '../shared/countLabel'
import { subjectLabel } from '../shared/subjectLabel'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'

/** The window every chart on this page shares. One number, so the overview's
 *  sparkline and the activity tab's cover the same month. */
const TREND_DAYS = 30

type Tab = 'overview' | 'activity' | 'goals' | 'badges' | 'reflections'
  | 'connection' | 'wellbeing' | 'notes'
const TABS: Tab[] = ['overview', 'activity', 'goals', 'badges', 'reflections',
                     'connection', 'wellbeing', 'notes']

export function TeacherStudentPage({ learnerId }: { learnerId: string }) {
  const { t, language } = useI18n()
  const { subject } = useTeacherScope()
  const route = useRoute()
  const [tab, setTab] = useState<Tab>('overview')
  const [detail, setDetail] = useState<StudentDetail | null>(null)
  const [badges, setBadges] = useState<TeacherBadge[]>([])
  const [activity, setActivity] = useState<QuestionRow[] | null>(null)
  const [trends, setTrends] = useState<LearnerTrends | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const live = useTeacherLive()
  const { avatarOf } = useTeacherRoster()

  /* Landing ON the thing, not at the top of the page.
     A safety alert's bell row carries `?tab=wellbeing&flag=wb_…`: the tab it
     lives on, and which disclosure it was. "A student wrote something that
     needs an adult" used to drop the teacher at a seven-tab profile and leave
     them to find which sentence it meant.

     `?focus=flags` is the older form of the same intent, and every alert raised
     before this shipped still carries it — a notification's action is written
     once and never rewritten. It opens the same tab, without a particular flag
     to ring. An unrecognised value does nothing, so a plain link still works. */
  // `useRoute()` hands back pathname + search as one string.
  const query = new URLSearchParams(route.split('?')[1] ?? '')
  const wantedTab = query.get('tab')
  const focusFlagId = query.get('flag')
  const flagsRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (wantedTab && (TABS as string[]).includes(wantedTab)) {
      setTab(wantedTab as Tab)
    } else if (query.get('focus') === 'flags') {
      setTab('wellbeing')
    }
    // The query is read once per navigation: re-running it on every render
    // would fight a teacher who then clicks a different tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(false)
    getStudentDetail(learnerId, language, subject ?? undefined)
      .then((result) => { if (active) setDetail(result) })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [learnerId, subject, language])

  /* Badges load beside the detail, not after it: the header leads with the
     child's latest badge — their own symbol of themselves — instead of a grey
     initial. Failure degrades to the initial, never blocks the page. */
  useEffect(() => {
    let active = true
    setBadges([])
    getStudentBadges(learnerId, language)
      .then((response) => { if (active) setBadges((response.badges ?? []).filter((b) => b.earned)) })
      .catch(() => { /* initial avatar is a fine fallback */ })
    return () => { active = false }
  }, [learnerId, language])

  /* The header KPIs come from the same per-question rows the Activity tab
     shows — success rate, minutes, questions worked. Loaded beside the detail;
     failure hides the strip rather than blocking the profile. */
  useEffect(() => {
    let active = true
    setActivity(null)
    getStudentActivity(learnerId, subject ?? undefined)
      .then((result) => { if (active) setActivity(result.questions) })
      .catch(() => { if (active) setActivity([]) })
    return () => { active = false }
  }, [learnerId, subject])

  /* The series behind every chart on this page. Loaded once here rather than
     per tab, because the overview and the activity tab draw from the same
     window and switching tabs should not re-fetch a month of history.
     Failure leaves `null`, and each chart renders its own quiet empty state —
     a profile is still worth reading without its charts. */
  useEffect(() => {
    let active = true
    setTrends(null)
    getStudentTrends(learnerId, TREND_DAYS)
      .then((result) => { if (active) setTrends(result) })
      .catch(() => { if (active) setTrends(null) })
    return () => { active = false }
  }, [learnerId])

  if (isLoading) {
    return (
      <div className="tch-student" aria-busy="true">
        {/* Back, meeting prep and the tab bar are the page's furniture — they
            do not depend on the fetch, so they are here from the first frame
            and the tabs do not slide into place a second later. */}
        <header className="tch-student__head">
          <div className="tch-student__topRow">
            <button
              type="button"
              className="sp-btn sp-btn--ghost sp-btn--sm"
              onClick={() => navigate('/teacher/students')}
            >
              <Icon name="chevronLeft" size={15} aria-hidden="true" />
              {t('tch.student.back')}
            </button>
          </div>
          <div className="tch-student__identity">
            <span className="tch-avatar tch-avatar--pending"
                  style={{ inlineSize: 56, blockSize: 56 }} aria-hidden="true" />
            <div className="tch-student__who">
              <h1><Skeleton w={180} h={26} /></h1>
              <p className="tch-student__seen"><Skeleton w={120} h={13} /></p>
            </div>
          </div>
        </header>
        <nav className="tch-tabs" role="tablist" aria-label={t('tch.student.tabsLabel')}>
          {TABS.map((value) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={value === tab}
              className={value === tab ? 'is-active' : ''}
              onClick={() => setTab(value)}
            >
              {t(`tch.student.tab.${value}`)}
            </button>
          ))}
        </nav>
        <div style={{ display: 'grid', gap: 'var(--sp-4)', marginBlockStart: 'var(--sp-4)' }}>
          <SkeletonCard rows={3} />
          <SkeletonCard rows={2} />
        </div>
      </div>
    )
  }
  if (error || !detail) return <ErrorState title={t('tch.error')} />

  const name = detail.display_name ?? detail.learner_id
  const latestBadge = badges[0] ?? null
  const avatarChoice = avatarOf(learnerId)
  const presence = live.presence[learnerId] ?? null

  /* Header KPIs, all derived from data we actually store (never invented):
     material from objectives vs the catalog, minutes from the wall-clock
     timing the events carry, questions from the rows themselves. */
  const rows = activity ?? []
  const seconds = rows.reduce((sum, row) => sum + (row.time_seconds || 0), 0)
  const learningsCount = new Set(rows.map((row) => row.component_id).filter(Boolean)).size
  const progressRows = Object.values(detail.objectives_progress ?? {})
  const objectivesTotal = progressRows.reduce((sum, row) => sum + row.objectives_total, 0)
  const objectivesMastered = progressRows.reduce((sum, row) => sum + row.objectives_mastered, 0)
  /* Open disclosures, from the detail payload the page already has — no second
     request to put a number on a tab. */
  const openFlags = (detail.wellbeing_flags ?? []).length

  return (
    <div className="tch-student">
      <header className="tch-student__head">
        <div className="tch-student__topRow">
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--sm"
            onClick={() => navigate('/teacher/students')}
          >
            <Icon name="chevronLeft" size={15} aria-hidden="true" />
            {t('tch.student.back')}
          </button>
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
            <h1 dir="auto">{name}</h1>
            <p className="tch-student__seen">
              <Icon name="clock" size={13} aria-hidden />
              {agoLabel(presence?.last_seen_at ?? null, t)}
            </p>
          </div>

          {/* Quick look: the three numbers a teacher wants before any tab. */}
          <dl className="tch-student__quick">
            {/* Every subject. The old `.slice(0, 2)` dropped whichever ones
                happened to come third and fourth out of the object, so a child
                studying three subjects had one silently missing from their own
                header — and which one depended on key order. */}
            {Object.entries(detail.progress ?? {}).map(([subjectKey, progress]) => (
              <div key={subjectKey} className="tch-student__quickItem">
                <dt>{subjectLabel(subjectKey, t)}</dt>
                <dd>{progress.objectives_mastered}/{progress.objectives_total}</dd>
              </div>
            ))}
            <div className="tch-student__quickItem">
              <dt>{t('tch.student.quickBadges')}</dt>
              <dd className="tch-student__quickBadges">
                {badges.slice(0, 3).map((badge) => (
                  <Badge
                    key={`${badge.subject}:${badge.glyph}:${badge.tier}`}
                    subject={badge.subject}
                    glyph={badge.glyph as BadgeGlyph}
                    tier={badge.tier as BadgeTier}
                    size={22}
                    title={badge.title}
                  />
                ))}
                <span>{badges.length}</span>
              </dd>
            </div>
          </dl>
        </div>
      </header>

      {/* The quick numbers — same card language as Home's KPI strip. Shown only
          once the child has activity: four zeroes would read as a verdict. */}
      {rows.length ? (
        <section className="tch-stats tch-student__kpis" aria-label={t('tch.kpi.stripLabel')}>
          {/* Material first. The success rate led this strip and was the least
              useful number on it: it counts attempts, so a child who works
              through a hard lesson twice reads worse than one who answered
              four easy questions once — and the same percentage is already the
              tone on every card in "what they worked on". What a teacher opens
              a profile for is how far through the material this child is. */}
          <Card className="tch-stat">
            <span className="tch-stat__icon tch-stat__icon--success" aria-hidden="true">
              <Icon name="target" size={18} />
            </span>
            <span className="tch-stat__text">
              <strong className="tch-stat__value">
                {objectivesTotal ? `${Math.round((objectivesMastered / objectivesTotal) * 100)}%` : '—'}
              </strong>
              <span className="tch-stat__label">{t('tch.kpi.material')}</span>
              <span className="tch-stat__hint">
                {t('tch.kpi.materialOf', { mastered: objectivesMastered, total: objectivesTotal })}
              </span>
            </span>
          </Card>

          <Card className="tch-stat">
            <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
              <Icon name="clock" size={18} />
            </span>
            <span className="tch-stat__text">
              {/* Wall-clock between events — honest "—" when there is none. */}
              <strong className="tch-stat__value">
                {seconds > 0 ? Math.round(seconds / 60) : '—'}
              </strong>
              <span className="tch-stat__label">{t('tch.kpi.learningMinutes')}</span>
              <span className="tch-stat__hint">
                {seconds > 0 ? t('tch.kpi.acrossLearnings') : t('tch.pulse.noTiming')}
              </span>
            </span>
          </Card>

          <Card className="tch-stat">
            <span className="tch-stat__icon tch-stat__icon--primary" aria-hidden="true">
              <Icon name="help" size={18} />
            </span>
            <span className="tch-stat__text">
              <strong className="tch-stat__value">{rows.length}</strong>
              <span className="tch-stat__label">{t('tch.kpi.questionsWorked')}</span>
              <span className="tch-stat__hint">
                {t('tch.kpi.learningsCount', { count: learningsCount })}
              </span>
            </span>
          </Card>

        </section>
      ) : null}

      {/* Every criterion that fired, not only the top one — the teacher decides
          which matters, but must be able to see all of them. */}
      {detail.attention_all?.length ? (
        <section
          ref={flagsRef}
          className="tch-student__flags"
          data-tour="teacher.studentFlags"
        >
          {detail.attention_all.map((flag) => (
            <AttentionRow key={flag.kind ?? flag.reason} flag={flag} />
          ))}
        </section>
      ) : null}

      <nav className="tch-tabs" role="tablist" aria-label={t('tch.student.tabsLabel')}>
        {TABS.map((value) => {
          /* An open disclosure is the one thing on this page a teacher must not
             have to open a tab to discover. */
          const alerting = value === 'wellbeing' && openFlags > 0
          return (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={tab === value}
              className={`${tab === value ? 'is-active' : ''}${alerting ? ' has-alert' : ''}`}
              onClick={() => setTab(value)}
            >
              {t(`tch.student.tab.${value}`)}
              {alerting ? (
                <span className="tch-tabs__count">
                  <span aria-hidden="true">{openFlags}</span>
                  {/* The digit alone is a number next to a word. What it counts
                      has to be said, or the badge means nothing without sight. */}
                  <span className="sp-sr-only">
                    {t('tch.student.openFlags', { count: openFlags })}
                  </span>
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      {tab === 'overview' ? <OverviewTab detail={detail} trends={trends} /> : null}
      {/* `activity` is already loaded for the header strip — the tab used to
          fetch the very same per-question rows a second time on open, which is
          one round trip for a payload sitting in state a few lines up. The
          month strip lives on the overview only: this tab is about what
          happened inside the work, not when. */}
      {tab === 'activity' ? <ActivityTab learnerId={learnerId} rows={activity} /> : null}
      {tab === 'goals' ? <TeacherGoals learnerId={learnerId} /> : null}
      {tab === 'badges' ? <TeacherBadges learnerId={learnerId} /> : null}
      {tab === 'reflections' ? <ReflectionsTab learnerId={learnerId} /> : null}
      {tab === 'connection' ? <TeacherConnection learnerId={learnerId} /> : null}
      {tab === 'wellbeing'
        ? <TeacherWellbeing learnerId={learnerId} focusFlagId={focusFlagId}
                            fromAlert={wantedTab === 'wellbeing' || query.get('focus') === 'flags'} />
        : null}
      {tab === 'notes' ? <TeacherNotes learnerId={learnerId} /> : null}
    </div>
  )
}

/** This student's own moments — the same feed as Home, scoped to one child. */
function StudentMoments({ learnerId }: { learnerId: string }) {
  const { t, language } = useI18n()
  const [moments, setMoments] = useState<Moment[] | null>(null)

  useEffect(() => {
    let active = true
    setMoments(null)
    getStudentMoments(learnerId, language)
      .then((response) => { if (active) setMoments(response.moments ?? []) })
      .catch(() => { if (active) setMoments([]) })
    return () => { active = false }
  }, [learnerId, language])

  /* This feed is its own fetch, and it used to render nothing at all until it
     landed — so the tab settled, the teacher started reading, and then a panel
     appeared above what they were reading and pushed it down the page. It
     holds its own space now, like every other panel on this screen. */
  if (moments === null) {
    return (
      <Panel className="tch-student__moments" aria-busy="true">
        <SectionHeader title={t('tch.moments.title')} subtitle={t('tch.moments.subtitle')} />
        <SkeletonCard rows={3} />
      </Panel>
    )
  }
  if (!moments.length) return null
  return (
    <Panel className="tch-student__moments">
      <SectionHeader title={t('tch.moments.title')} subtitle={t('tch.moments.subtitle')} />
      <MomentsFeed moments={moments} />
    </Panel>
  )
}

function OverviewTab({ detail, trends }: { detail: StudentDetail; trends: LearnerTrends | null }) {
  const { t, direction } = useI18n()
  const progress = Object.entries(detail.objectives_progress ?? {})

  /* The struggle panel mixed two different claims under one heading. An
     evidence row means "answered these and got them wrong"; a questionnaire row
     is a trait the child described about themselves at onboarding, has no
     objective behind it, and is never retired — so under a heading called
     "difficulties" it reads as a permanent deficiency the system detected.
     Split, not filtered: the questionnaire answers are real, just not that. */
  const struggles = detail.struggle_items ?? []
  const evidenced = struggles.filter((item) => item.source !== 'questionnaire')
  const described = struggles.filter((item) => item.source === 'questionnaire')

  return (
    <div className="tch-student__body" role="tabpanel">
      {/* The month, at a glance — the first thing a teacher asks and the one
          thing seven columns of per-question numbers could not answer. */}
      <TrendStrip trends={trends} />

      {/* MUST §4 — progress against the learning objectives, per subject. */}
      <Panel data-tour="teacher.subjectProgress">
        <SectionHeader title={t('tch.student.progress')} />
        {progress.length ? (
          <div className="tch-progressGrid">
            {progress.map(([subjectId, stats]) => (
              <SubjectProgressCard key={subjectId} subject={subjectId} stats={stats} />
            ))}
          </div>
        ) : (
          <EmptyState title={t('tch.student.noProgress')} />
        )}
      </Panel>

      {/* MUST §1 + nice-to-have §1, as one reading.
          They used to be two panels a screen apart, which is the one layout
          that makes them hard to weigh against each other — and weighing them
          against each other is the entire question a teacher opens this with. */}
      <Balance strengths={detail.strengths_detail ?? []} difficulties={evidenced} />

      {/* Who this child is, in the system's own words. */}
      <PortraitPanel portrait={detail.portrait} described={described} />

      {/* MUST §2 — tailored pedagogical recommendations, each explainable. */}
      <Panel data-tour="teacher.recommendations">
        <SectionHeader
          title={t('tch.student.recommendations')}
          subtitle={t('tch.student.recommendationsSubtitle')}
        />
        <ul className="tch-recs">
          {detail.recommendations.map((recommendation, index) => (
            <RecommendationCard key={index} recommendation={recommendation} />
          ))}
        </ul>
      </Panel>
    </div>
  )
}

/* One subject's progress against the objectives it actually has.
 *
 * The card used to draw the same fact twice — a ring and a bar, both of them
 * `percent` — and then a legend of three counts, two of which are usually
 * zero. At 0% the ring was an empty circle with "0%" written inside it, which
 * reads as a broken widget rather than as "has not started".
 *
 * So: the bar is the picture (it is the only one of the two that can show
 * mastered vs in-progress vs untouched), the fraction is the number, and the
 * legend names only the segments that exist. */
function SubjectProgressCard({ subject, stats }: {
  subject: string
  stats: SubjectProgress
}) {
  const { t } = useI18n()
  const started = stats.objectives_mastered + stats.objectives_in_progress > 0
  const segments = [
    { key: 'mastered', count: stats.objectives_mastered },
    { key: 'progress', count: stats.objectives_in_progress },
    { key: 'idle', count: stats.not_started },
  ].filter((segment) => segment.count > 0)

  return (
    <Card className="tch-progressCard">
      <div className="tch-progressCard__head">
        <strong dir="auto">{subjectLabel(subject, t)}</strong>
        <span className="tch-progressCard__score">
          {/* "0%" is a measurement; "טרם התחילו" is what actually happened. */}
          {started ? (
            <>
              <b>{stats.percent}%</b>
              <small>{t('tch.student.progressOf', {
                mastered: stats.objectives_mastered, total: stats.objectives_total,
              })}</small>
            </>
          ) : (
            <small className="tch-progressCard__idle">{t('tch.student.progressNotStarted')}</small>
          )}
        </span>
      </div>
      <ObjectiveStrip
        mastered={stats.objectives_mastered}
        inProgress={stats.objectives_in_progress}
        notStarted={stats.not_started}
        ariaLabel={t('tch.student.progressAria', {
          mastered: stats.objectives_mastered, total: stats.objectives_total,
        })}
      />
      {/* Nothing to break down when nothing has been touched — the head
          already says "טרם התחילו", and a legend repeating it under an empty
          bar is the same sentence three times. */}
      <ul className="tch-progressCard__legend" hidden={!started}>
        {segments.map((segment) => (
          <li key={segment.key} className={`is-${segment.key}`}>
            <i aria-hidden="true" />
            {t(`tch.student.progressSeg.${segment.key}`, { count: segment.count })}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* Strengths and difficulties, side by side with a rule between them.
 *
 * Both columns are evidence-backed: a strength here is an objective this child
 * actually mastered or recovered in, a difficulty is one they actually got
 * wrong. Neither side is styled as a verdict, and an empty column says so
 * rather than disappearing — "no difficulties detected" is information, and a
 * card with one lonely column reads as if the other question was never asked. */
function Balance({ strengths, difficulties }: {
  strengths: StrengthDetail[]
  difficulties: StruggleItem[]
}) {
  const { t } = useI18n()
  /* When every strength came from the same place — three from the onboarding
     mapping is the common case — the provenance is a fact about the COLUMN,
     not about each row. Repeated per row it is the same visual noise as the
     "חוזקה בפרופיל" chip it replaced, in a quieter colour. */
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

/* One strength. The kind used to lead as a pill — "חוזקה בפרופיל" three times
 * down the list, which is a label for the row's provenance shouted louder than
 * the strength itself. The provenance is still here, as the quiet second line
 * where the evidence belongs. */
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
 * This replaces three bare chips from the onboarding questionnaire — real
 * signal, but a list of three noun phrases is not a description of a person.
 * `student_description` (brain A-5) is a running portrait maintained from
 * observed evidence: a mini-tier reconcile pass that runs lazily off the
 * CHILD's coach bundle, debounced, and already paid for. Reading it here adds
 * no model call to this page and no per-teacher generation — which is the
 * answer to "can we do this without it being expensive": it is already written.
 *
 * The questionnaire answers stay, at the bottom, as what they are: what the
 * child said about themselves before any of this was observed. */
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

  /* Four facets, one sentence each — the newest, because the reconcile pass
     appends and invalidates, so the last active entry is the current belief.
     Nine bulleted sentences under four headings is the whole description, and
     nobody reads a whole description to decide how to open a conversation. The
     rest is one click away and nothing is hidden. */
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

/* The month in one row: what they did each day, how much of it, how often.
 *
 * `per_day` was already being fetched by the old Activity tab and rendered as
 * a seven-column table — the numbers were all there and the SHAPE was not, and
 * the shape is what a teacher reads in a second. */
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
          {/* Every chart says what it counts and every number says what it is.
              This card used to be two unlabelled lines and four bare figures
              under captions like "רצף הכי ארוך" — a teacher could not tell
              whether the spike was Tuesday or what "3" was three OF. */}
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

          {/* A per-subject success strip used to sit here. It was the one chart
              on the page that had to invent its own data to be drawable: a
              subject is not studied every day, so most days had no rate, and
              the line only existed because each gap was filled with the
              previous day's value. A teacher reading a flat week could not tell
              "held steady" from "did not touch it", and the footnote saying so
              was doing work no footnote should have to do. Success by subject
              is answered properly by the objectives panel below, against
              evidence rather than against carried-forward guesses. */}

          {trends.mastered_steps.length ? (
            <p className="tch-trend__mastered">
              <Icon name="check" size={13} aria-hidden />
              {/* `t()` has no plural engine — "1 יעדים הושגו" is what the
                  shared key renders. Same two-key fix as everywhere else. */}
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

/* What one row of activity IS, in words.
 *
 * The profile used to print `row.question_id ?? row.item_id ?? row.question_key`
 * — which is `q1` three times over (the content numbers questions WITHIN a
 * screen, so the raw id names a different question in every screen) and
 * `ENG.G7.FAMILY.GRAMMAR-01-04` for a screen the child only read. The catalogue
 * knows what these are; the row now carries it. */
function rowLabel(
  row: QuestionRow,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (row.ordinal) {
    const base = t('tch.learnings.questionN', { n: row.ordinal })
    return row.part ? `${base} · ${t('tch.learnings.partN', { n: row.part })}` : base
  }
  // No question number: this is a screen the child spent time on rather than a
  // question they answered. Say which kind of screen, not which provider id —
  // and where the catalogue does not even say that, call it a screen, because
  // calling an unanswered item "שאלה" describes something that is not there.
  if (row.kind) return t(`tch.learnings.screenKind.${row.kind}`)
  return t(row.attempts ? 'tch.learnings.question' : 'tch.student.screenItem')
}

/** The lesson a group of rows belongs to, by the same rule the learnings screen
 *  uses — so a lesson is called one thing across the whole portal. */
function groupTitle(
  row: QuestionRow,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  return (row.learning_title || '').trim()
    || (row.objective_title || '').trim()
    || t('tch.learnings.unnamed')
}

function ActivityTab({ learnerId, rows }: { learnerId: string; rows: QuestionRow[] | null }) {
  const { t } = useI18n()

  /* Hardest first — the same reading the learnings detail page gives a whole
     class, for one child. Thin evidence is excluded: one wrong answer is not a
     hard question, it is a Tuesday.

     A question they never got right is excluded too, and that is a display
     decision rather than a judgement about the data: its bar has zero length,
     so a row of them is a column of labels beside an empty track — the chart
     compares rates, and there is nothing to compare at the floor. Nothing is
     lost: every one of them is a red-striped card in "what they worked on"
     below, where the score is written out. */
  const hardest = useMemo(() => {
    return (rows ?? [])
      .filter((row) => row.attempts >= 2 && row.correct > 0)
      .map((row) => ({ row, rate: row.correct / row.attempts }))
      .sort((a, b) => a.rate - b.rate || b.row.attempts - a.row.attempts)
      .slice(0, 8)
  }, [rows])

  /* Said out loud rather than silently dropped from the chart above. */
  const neverRight = useMemo(
    () => (rows ?? []).filter((row) => row.attempts >= 2 && row.correct === 0).length,
    [rows],
  )

  const support = useMemo(() => {
    const total = (key: keyof QuestionRow) =>
      (rows ?? []).reduce((sum, row) => sum + (Number(row[key]) || 0), 0)
    return {
      hints: total('hints_used') + total('content_hints_used'),
      explanations: total('explanations_used'),
      chats: total('chat_turns'),
    }
  }, [rows])

  /* Grouped by lesson, in the order the child met them. A flat table of twenty
     rows called `q1`…`q3` four times over cannot be read at all; the same rows
     under "פתיחה, הקנייה ותרגול סטנדרטי א" answer the question a teacher came
     with, which is about a LESSON and not about a provider id. */
  const lessons = useMemo(() => {
    const byLesson = new Map<string, { title: string; objective: string | null; rows: QuestionRow[] }>()
    for (const row of rows ?? []) {
      const key = row.component_id ?? 'unknown'
      const entry = byLesson.get(key) ?? {
        title: groupTitle(row, t),
        objective: row.objective_title ?? null,
        rows: [],
      }
      entry.rows.push(row)
      byLesson.set(key, entry)
    }
    for (const entry of byLesson.values()) {
      entry.rows.sort((a, b) => Number(a.ordinal ?? 999) - Number(b.ordinal ?? 999))
    }
    return [...byLesson.entries()].map(([id, entry]) => {
      const attempts = entry.rows.reduce((sum, row) => sum + row.attempts, 0)
      const correct = entry.rows.reduce((sum, row) => sum + row.correct, 0)
      return {
        id,
        ...entry,
        attempts,
        correct,
        rate: attempts ? correct / attempts : null,
        /* Whether this lesson is the one worth opening. Every lesson is closed
           by default — twenty of them expanded is the wall of text this was —
           and the summary carries enough to choose between them. */
        needsAttention: entry.rows.some((row) => row.attempts >= 2 && row.correct / row.attempts < 0.5),
      }
    })
  }, [rows, t])

  if (!rows) return <div aria-busy="true"><SkeletonCard rows={4} /></div>
  if (!rows.length) return <EmptyState title={t('tch.student.noActivity')} />

  return (
    /* Inside the tab's own grid, so the gap between the moments feed and the
       panel below it is the same gap as everywhere else on this page — it used
       to be a sibling of this container, and two adjacent panels with no rule
       and no space between them read as one broken card. */
    <div className="tch-student__body" role="tabpanel">
      <StudentMoments learnerId={learnerId} />

      {/* What actually went wrong, before the detail of everything. */}
      {hardest.length || neverRight ? (
        <Panel>
          <SectionHeader
            title={t('tch.student.hardest')}
            subtitle={t('tch.student.hardestSubtitle')}
          />
          {hardest.length ? (
          <BarSeries
            ariaLabel={t('tch.student.hardest')}
            rows={hardest.map(({ row, rate }) => ({
              // The lesson AND the question: "q1" alone is four different
              // questions on this screen.
              label: `${rowLabel(row, t)} · ${groupTitle(row, t)}`,
              value: Math.round(rate * 100),
              max: 100,
              tone: rate < 0.5 ? 'danger' : rate < 0.7 ? 'warn' : 'primary',
            }))}
            formatValue={(value) => `${value}%`}
          />
          ) : null}
          {neverRight ? (
            <p className="tch-student__floor">
              {t(countKey('tch.student.neverRight', neverRight), { count: neverRight })}
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel>
        <SectionHeader
          title={t('tch.student.support')}
          subtitle={t('tch.student.supportSubtitle')}
        />
        <p className="tch-student__support">
          {t('tch.student.supportLine', {
            hints: support.hints,
            explanations: support.explanations,
            chats: support.chats,
          })}
        </p>
      </Panel>

      {/* ── what they worked on, lesson by lesson ─────────────────────────── */}
      <Panel>
        <SectionHeader
          title={t('tch.student.worked')}
          subtitle={t('tch.student.workedSubtitle')}
        />
        {/* One line per lesson, closed. Twenty lessons × up to ten items ×
            a paragraph of what each teaches is a page nobody scrolls to the
            end of — and the thing a teacher came for is which lesson to open,
            which is exactly what the summary line answers. */}
        <div className="tch-worked">
          {lessons.map((lesson) => (
            <details
              key={lesson.id}
              className={`tch-worked__lesson${lesson.needsAttention ? ' is-attention' : ''}`}
            >
              <summary className="tch-worked__summary">
                <Icon name="chevronLeft" size={14} aria-hidden
                      className="tch-worked__caret" />
                <span className="tch-worked__title" dir="auto">{lesson.title}</span>
                <span className="tch-worked__counts">
                  {t(countKey('tch.student.lessonItems', lesson.rows.length),
                     { count: lesson.rows.length })}
                  {lesson.rate !== null
                    ? ` · ${Math.round(lesson.rate * 100)}%`
                    : ` · ${t('tch.student.notAnswered')}`}
                </span>
                {/* One dot per item, in the order they were met — the shape of
                    the lesson before it is opened. */}
                <span className="tch-worked__dots" aria-hidden="true">
                  {lesson.rows.map((row) => (
                    <i key={row.question_key} className={`is-${itemTone(row)}`} />
                  ))}
                </span>
              </summary>
              {lesson.objective ? (
                <p className="tch-worked__objective" dir="auto">{lesson.objective}</p>
              ) : null}
              <ul className="tch-worked__items">
                {lesson.rows.map((row) => (
                  <WorkedItem key={row.question_key} row={row} />
                ))}
              </ul>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  )
}

/* One screen or question, told as a sentence rather than as nine columns.
 *
 * The columns are still all here — attempts, correct, hints, explanations,
 * chat, what helped, first and last — but a teacher reads "3 מתוך 4, עם רמז"
 * and not a row of zeros they have to count across. The heading it belongs to
 * is the SCREEN'S own title, and what it teaches is the content's own
 * description of the item, so this is the lesson describing itself. */
function itemTone(row: QuestionRow): 'none' | 'danger' | 'warn' | 'success' {
  if (!row.attempts) return 'none'
  const rate = row.correct / row.attempts
  return rate < 0.5 ? 'danger' : rate < 0.7 ? 'warn' : 'success'
}

function WorkedItem({ row }: { row: QuestionRow }) {
  const { t } = useI18n()
  const answered = row.attempts > 0
  const tone = itemTone(row)
  const hints = row.hints_used + row.content_hints_used

  const support = [
    hints ? t('tch.student.usedHints', { count: hints }) : null,
    row.explanations_used ? t('tch.student.usedExplanations', { count: row.explanations_used }) : null,
    row.chat_turns ? t('tch.student.usedChat', { count: row.chat_turns }) : null,
  ].filter(Boolean)

  return (
    <li className={`tch-worked__item is-${tone}`}>
      <div className="tch-worked__itemHead">
        <StatusPill tone={tone === 'danger' ? 'support' : tone === 'warn' ? 'steady' : 'neutral'}>
          {rowLabel(row, t)}
        </StatusPill>
        {row.screen_title ? (
          <strong dir="auto">{row.screen_title}</strong>
        ) : null}
        <span className="tch-worked__score">
          {answered
            ? t('tch.student.scoreOf', { correct: row.correct, attempts: row.attempts })
            : t('tch.student.notAnswered')}
        </span>
      </div>

      {/* What the lesson says this item is for. The vendor's own words —
          nothing here is generated, and where they wrote nothing, nothing
          shows. */}
      {row.teaches ? (
        <p className="tch-worked__teaches" dir="auto">{row.teaches}</p>
      ) : null}

      {support.length || row.helped_reported?.length ? (
        <p className="tch-worked__support">
          {support.join(' · ')}
          {row.helped_reported?.length ? (
            <span className="tch-worked__helped">
              {t('tch.student.saidHelped', {
                what: row.helped_reported.map((m) => t(`tch.helped.${m}`)).join(' · '),
              })}
            </span>
          ) : null}
        </p>
      ) : null}

      {row.last_at ? (
        <span className="tch-worked__when">{agoLabel(row.last_at, t)}</span>
      ) : null}
    </li>
  )
}

function ReflectionsTab({ learnerId }: { learnerId: string }) {
  const { t, direction } = useI18n()
  const [data, setData] = useState<Awaited<ReturnType<typeof getStudentReflections>> | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    setData(null)
    getStudentReflections(learnerId)
      .then((result) => { if (active) setData(result) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [learnerId])

  if (error) return <ErrorState title={t('tch.error')} />
  if (!data) return <div aria-busy="true"><SkeletonCard rows={4} /></div>

  const awareness = data.self_awareness
  const samples = awareness?.samples ?? []
  /* The reflections themselves. This endpoint has always returned them and this
     screen has always thrown them away — it rendered `samples.length`, a count
     of how many times a child answered, in place of anything they said. */
  const written = (data.reflections ?? []).filter(
    (row) => (row.text || row.note || '').trim())

  return (
    <div className="tch-student__body" role="tabpanel">
      <Panel>
        <SectionHeader
          title={t('tch.student.selfVsSystem')}
          subtitle={t('tch.student.selfVsSystemSubtitle')}
        />
        {awareness ? (
          <div className="tch-awareness">
            <StatusPill tone={awareness.reading === 'calibrated' ? 'strong' : 'steady'}>
              {t(`tch.awareness.${awareness.reading}`)}
            </StatusPill>
            <p dir="auto">{t('tch.awareness.explain')}</p>

            {/* Two lines for ONE child: how they rated the session against how
                it actually went. The gap between them IS the signal, and a
                single number ("gap: 0.31") states the conclusion while hiding
                whether it is a trend or one odd Tuesday. */}
            {samples.length >= 2 ? (
              <DualLine
                /* The self-rating is 1–5 and the estimate is 0–1; both are put
                   on one 0–1 axis so the distance between the lines is the
                   thing being read. */
                a={samples.map((sample) => sample.self_rating / 5)}
                b={samples.map((sample) => sample.system_estimate)}
                labelA={t('tch.awareness.self')}
                labelB={t('tch.awareness.system')}
                ariaLabel={t('tch.student.selfVsSystem')}
              />
            ) : (
              <p className="tch-awareness__thin">{t('tch.awareness.thin')}</p>
            )}
            <RawEvidence raw={{ gap: awareness.gap, samples: samples.length }} />
          </div>
        ) : (
          <EmptyState title={t('tch.student.noReflections')} />
        )}
      </Panel>

      {written.length ? (
        <Panel>
          <SectionHeader
            title={t('tch.student.reflectionWords')}
            subtitle={t('tch.student.reflectionWordsSubtitle')}
          />
          <ul className="tch-reflections">
            {written.map((row, index) => (
              <li key={row.at ?? index} className="tch-reflection">
                <p dir="auto">{row.text || row.note}</p>
                <span className="tch-reflection__meta">
                  {row.at ? agoLabel(row.at, t) : ''}
                  {typeof row.self_rating === 'number'
                    ? ` · ${t('tch.awareness.selfRating', { rating: row.self_rating })}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  )
}
