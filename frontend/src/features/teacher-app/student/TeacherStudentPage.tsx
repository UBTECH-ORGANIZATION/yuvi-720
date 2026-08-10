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

import { useEffect, useState } from 'react'
import { navigate } from '../../../app/router'
import { ObjectiveStrip, ProgressRing } from '../../../components/charts'
import {
  Card, EmptyState, ErrorState, Icon, Panel, SectionHeader, Skeleton, SkeletonCard, StatusPill,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  getStudentActivity, getStudentDetail, getStudentReflections,
  type QuestionRow, type StudentDetail,
} from '../../../services/teacher'
import { AttentionRow, RawEvidence, RecommendationCard } from '../shared/EvidenceDisclosure'
import { TeacherGoals } from './TeacherGoals'
import { TeacherNotes } from './TeacherNotes'
import { TeacherBadges } from './TeacherBadges'
import { TeacherConnection } from './TeacherConnection'
import { MeetingPrepDrawer, useMeetingDrawer } from './MeetingPrepDrawer'
import { MomentsFeed } from '../moments/MomentsFeed'
import { getStudentMoments, getStudentBadges, type Moment, type TeacherBadge } from '../../../services/teacher'
import { Badge, type BadgeGlyph, type BadgeTier } from '../../../components/Badge'
import { useTeacherLive } from '../../../providers/TeacherLiveProvider'
import { agoLabel } from '../live/LiveNow'
import { useRoute } from '../../../app/router'
import './teacher-student.css'

type Tab = 'overview' | 'activity' | 'goals' | 'badges' | 'reflections' | 'connection' | 'notes'
const TABS: Tab[] = ['overview', 'activity', 'goals', 'badges', 'reflections', 'connection', 'notes']

export function TeacherStudentPage({ learnerId }: { learnerId: string }) {
  const { t, language } = useI18n()
  const { subject } = useTeacherScope()
  const route = useRoute()
  const [isMeetingOpen, setMeetingOpen] = useMeetingDrawer(route)
  const [tab, setTab] = useState<Tab>('overview')
  const [detail, setDetail] = useState<StudentDetail | null>(null)
  const [badges, setBadges] = useState<TeacherBadge[]>([])
  const [activity, setActivity] = useState<QuestionRow[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const live = useTeacherLive()

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
            <span className="tch-student__avatar" aria-hidden="true" />
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
  const presence = live.presence[learnerId] ?? null

  /* Header KPIs, all derived from data we actually store (never invented):
     answers come from attempts/correct, minutes from the wall-clock timing the
     events carry, material from objectives vs the catalog. */
  const rows = activity ?? []
  const attempts = rows.reduce((sum, row) => sum + row.attempts, 0)
  const correct = rows.reduce((sum, row) => sum + row.correct, 0)
  const seconds = rows.reduce((sum, row) => sum + (row.time_seconds || 0), 0)
  const learningsCount = new Set(rows.map((row) => row.component_id).filter(Boolean)).size
  const progressRows = Object.values(detail.objectives_progress ?? {})
  const objectivesTotal = progressRows.reduce((sum, row) => sum + row.objectives_total, 0)
  const objectivesMastered = progressRows.reduce((sum, row) => sum + row.objectives_mastered, 0)

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
          {/* Meeting prep opens as a drawer over this page, not a route — you
              prepare while looking at the profile you are preparing from. */}
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--sm tch-student__meeting"
            data-tour="teacher.meetingPrep"
            onClick={() => setMeetingOpen(true)}
          >
            <Icon name="message" size={15} aria-hidden="true" />
            {t('tch.meeting.open')}
          </button>
        </div>

        <div className="tch-student__identity">
          {/* The child's latest badge is the avatar: their own earned symbol,
              not a grey initial. No badge yet → the initial, honestly. */}
          {latestBadge ? (
            <span className="tch-student__badgeAvatar">
              <Badge
                subject={latestBadge.subject}
                glyph={latestBadge.glyph as BadgeGlyph}
                tier={latestBadge.tier as BadgeTier}
                size={56}
                title={latestBadge.title}
              />
            </span>
          ) : (
            <span className="tch-student__avatar" aria-hidden="true">{name.slice(0, 1)}</span>
          )}
          <div className="tch-student__who">
            <h1 dir="auto">{name}</h1>
            <p className="tch-student__seen">
              <Icon name="clock" size={13} aria-hidden />
              {agoLabel(presence?.last_seen_at ?? null, t)}
            </p>
          </div>

          {/* Quick look: the three numbers a teacher wants before any tab. */}
          <dl className="tch-student__quick">
            {Object.entries(detail.progress ?? {}).slice(0, 2).map(([subjectKey, progress]) => (
              <div key={subjectKey} className="tch-student__quickItem">
                <dt>{t(`tch.subject.${subjectKey}`)}</dt>
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
          <Card className="tch-stat">
            <span className="tch-stat__icon tch-stat__icon--success" aria-hidden="true">
              <Icon name="check" size={18} />
            </span>
            <span className="tch-stat__text">
              <strong className="tch-stat__value">
                {attempts ? `${Math.round((correct / attempts) * 100)}%` : '—'}
              </strong>
              <span className="tch-stat__label">{t('tch.kpi.successRate')}</span>
              <span className="tch-stat__hint">
                {t('tch.kpi.successOf', { correct, attempts })}
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
        </section>
      ) : null}

      {/* Every criterion that fired, not only the top one — the teacher decides
          which matters, but must be able to see all of them. */}
      {detail.attention_all?.length ? (
        <section className="tch-student__flags" data-tour="teacher.studentFlags">
          {detail.attention_all.map((flag) => (
            <AttentionRow key={flag.kind ?? flag.reason} flag={flag} />
          ))}
        </section>
      ) : null}

      <nav className="tch-tabs" role="tablist" aria-label={t('tch.student.tabsLabel')}>
        {TABS.map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            className={tab === value ? 'is-active' : ''}
            onClick={() => setTab(value)}
          >
            {t(`tch.student.tab.${value}`)}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? <OverviewTab detail={detail} /> : null}
      {tab === 'activity' ? (
        <>
          <StudentMoments learnerId={learnerId} />
          <ActivityTab learnerId={learnerId} />
        </>
      ) : null}
      {tab === 'goals' ? <TeacherGoals learnerId={learnerId} /> : null}
      {tab === 'badges' ? <TeacherBadges learnerId={learnerId} /> : null}
      {tab === 'reflections' ? <ReflectionsTab learnerId={learnerId} /> : null}
      {tab === 'connection' ? <TeacherConnection learnerId={learnerId} /> : null}
      {tab === 'notes' ? <TeacherNotes learnerId={learnerId} /> : null}

      <MeetingPrepDrawer
        learnerId={learnerId}
        isOpen={isMeetingOpen}
        onClose={() => setMeetingOpen(false)}
      />
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

  if (moments === null || !moments.length) return null
  return (
    <Panel className="tch-student__moments">
      <SectionHeader title={t('tch.moments.title')} subtitle={t('tch.moments.subtitle')} />
      <MomentsFeed moments={moments} />
    </Panel>
  )
}

function OverviewTab({ detail }: { detail: StudentDetail }) {
  const { t } = useI18n()
  const progress = Object.entries(detail.objectives_progress ?? {})

  return (
    <div className="tch-student__body" role="tabpanel">
      {/* MUST §4 — progress against the learning objectives, per subject. */}
      <Panel data-tour="teacher.subjectProgress">
        <SectionHeader title={t('tch.student.progress')} />
        {progress.length ? (
          <div className="tch-progressGrid">
            {progress.map(([subjectId, stats]) => (
              <Card key={subjectId} className="tch-progressCard">
                <div className="tch-progressCard__head">
                  <strong>{t(`tch.subject.${subjectId}`)}</strong>
                  <ProgressRing percent={stats.percent} size={56} />
                </div>
                <ObjectiveStrip
                  mastered={stats.objectives_mastered}
                  inProgress={stats.objectives_in_progress}
                  notStarted={stats.not_started}
                  ariaLabel={t('tch.student.progressAria', {
                    mastered: stats.objectives_mastered,
                    total: stats.objectives_total,
                  })}
                />
                <p className="tch-progressCard__legend">
                  {t('tch.student.progressLegend', {
                    mastered: stats.objectives_mastered,
                    inProgress: stats.objectives_in_progress,
                    notStarted: stats.not_started,
                  })}
                </p>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState title={t('tch.student.noProgress')} />
        )}
      </Panel>

      {/* MUST §1 — knowledge items the system detected difficulty on. */}
      <Panel data-tour="teacher.struggles">
        <SectionHeader
          title={t('tch.student.struggles')}
          subtitle={t('tch.student.strugglesSubtitle')}
        />
        {detail.struggle_items?.length ? (
          <ul className="tch-struggles">
            {detail.struggle_items.map((item, index) => (
              <li key={item.objective_id ?? index} className="tch-struggle">
                <div className="tch-struggle__head">
                  <strong dir="auto">{item.label ?? item.objective_id}</strong>
                  {item.subject ? (
                    <StatusPill tone="neutral">{t(`tch.subject.${item.subject}`)}</StatusPill>
                  ) : null}
                </div>
                {item.evidence?.length ? (
                  <p className="tch-struggle__tags" dir="auto">
                    {item.evidence.map((entry) => entry.tag).filter(Boolean).join(' · ')}
                  </p>
                ) : null}
                <RawEvidence raw={item.raw_evidence as Record<string, unknown>} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t('tch.student.noStruggles')} />
        )}
      </Panel>

      {/* MUST §2 — tailored pedagogical recommendations, each explainable. */}
      <Panel data-tour="teacher.recommendations">
        <SectionHeader title={t('tch.student.recommendations')} />
        <ul className="tch-recs">
          {detail.recommendations.map((recommendation, index) => (
            <RecommendationCard key={index} recommendation={recommendation} />
          ))}
        </ul>
      </Panel>

      {/* Nice-to-have §1 — strengths, with the evidence behind each. */}
      {detail.strengths_detail?.length ? (
        <Panel>
          <SectionHeader title={t('tch.student.strengths')} />
          <ul className="tch-strengths">
            {detail.strengths_detail.map((strength, index) => (
              <li key={index} className="tch-strength">
                <StatusPill tone="strong">{t(`tch.strength.${strength.kind}`)}</StatusPill>
                <span dir="auto">{strength.label}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  )
}

function ActivityTab({ learnerId }: { learnerId: string }) {
  const { t } = useI18n()
  const { subject } = useTeacherScope()
  const [rows, setRows] = useState<QuestionRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    setRows(null)
    getStudentActivity(learnerId, subject ?? undefined)
      .then((result) => { if (active) setRows(result.questions) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [learnerId, subject])

  if (error) return <ErrorState title={t('tch.error')} />
  if (!rows) return <div aria-busy="true"><SkeletonCard rows={4} /></div>
  if (!rows.length) return <EmptyState title={t('tch.student.noActivity')} />

  return (
    <div className="tch-student__body" role="tabpanel">
      <Panel>
        <SectionHeader
          title={t('tch.student.activity')}
          subtitle={t('tch.student.activitySubtitle')}
        />
        <div className="tch-tableWrap">
          <table className="tch-table">
            <thead>
              <tr>
                <th>{t('tch.activity.question')}</th>
                <th>{t('tch.activity.attempts')}</th>
                <th>{t('tch.activity.correct')}</th>
                <th>{t('tch.activity.hints')}</th>
                <th>{t('tch.activity.explanations')}</th>
                <th>{t('tch.activity.chat')}</th>
                <th>{t('tch.activity.helped')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.question_key}>
                  <td dir="auto">{row.question_id ?? row.item_id ?? row.question_key}</td>
                  <td>{row.attempts}</td>
                  <td>{row.correct}</td>
                  {/* What Yuvi already tried, so the teacher never walks in cold. */}
                  <td>{row.hints_used + row.content_hints_used}</td>
                  <td>{row.explanations_used}</td>
                  <td>{row.chat_turns}</td>
                  <td dir="auto">
                    {row.helped_reported?.length
                      ? row.helped_reported.map((method) => t(`tch.helped.${method}`)).join(' · ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function ReflectionsTab({ learnerId }: { learnerId: string }) {
  const { t } = useI18n()
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
            <RawEvidence raw={{ gap: awareness.gap, samples: awareness.samples.length }} />
          </div>
        ) : (
          <EmptyState title={t('tch.student.noReflections')} />
        )}
      </Panel>
    </div>
  )
}
