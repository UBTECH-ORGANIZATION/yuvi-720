import { useEffect, useRef, useState } from 'react'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { EmptyState, ErrorState, Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useBrain } from '../../providers/BrainProvider'
import { getDashboard, updateGoalStatus, type DashboardDTO } from '../../services/brain'
import { getCalendarUpcoming, type CalendarItem } from '../../services/calendar'
import {
  getLearningCatalog,
  type LearningUnitDTO,
} from '../../services/learning'
import { navigate } from '../../app/router'
import { selectNextRoute } from '../../services/agents'
import { DashboardHero } from './DashboardHero'
import { DashboardLoadingScreen } from './DashboardLoadingScreen'
import { ActivenessWeb } from './ActivenessWeb'
import { MyGoals } from './MyGoals'
import { MySubjects } from './MySubjects'
import { ActivenessMapSection } from './ActivenessMapSection'
import { StudentConnectionsPane } from './StudentConnectionsPane'
import { StudentCalendarPage } from './StudentCalendarPage'
import { UpcomingStrip } from './UpcomingStrip'
import './student-dashboard.css'

/**
 * Student dashboard — 720 F4 projection over the real Learner Brain.
 * Learner-facing feedback is verbal; the component never invents progress,
 * goals, profile facts, curriculum order, or recommendations.
 */
export function StudentDashboardPage() {
  const { t, language } = useI18n()
  const { learnerId, brain, refresh: refreshBrain } = useBrain()
  const [dashboard, setDashboard] = useState<DashboardDTO | null>(null)
  const [todayItems, setTodayItems] = useState<CalendarItem[]>([])
  const [roadmapUnits, setRoadmapUnits] = useState<LearningUnitDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [isStarting, setIsStarting] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [minimumLoadElapsed, setMinimumLoadElapsed] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumLoadElapsed(true), 1600)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!learnerId) return
    let active = true
    const controller = new AbortController()
    if (!dashboard) setLoading(true)
    setError(false)
    Promise.all([
      getDashboard(learnerId, language, controller.signal),
      getCalendarUpcoming(controller.signal).catch(() => null),
    ])
      .then(([nextDashboard, upcoming]) => {
        if (!active) return
        setDashboard(nextDashboard)
        if (upcoming) setTodayItems(upcoming.items)
      })
      .catch(() => {
        if (active && !controller.signal.aborted) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
    // `dashboard` deliberately stays out: reloadKey controls background refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnerId, language, reloadKey])

  // The lesson catalog loads once per visit (or language switch). It is NOT
  // tied to the focus/brain-updated refresh cycle — refetching it made the
  // whole carousel remount and replay its entrance animation mid-session.
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    getLearningCatalog(controller.signal, language)
      .then((catalog) => {
        if (active) setRoadmapUnits(catalog.units)
      })
      .catch(() => undefined)
    return () => {
      active = false
      controller.abort()
    }
  }, [learnerId, language])

  useEffect(() => {
    const refresh = () => setReloadKey((key) => key + 1)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('yuvilab:brain-updated', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('yuvilab:brain-updated', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // The overview is three tall cards, so it scrolls section by section rather
  // than settling halfway between two. Scoped to <html> because that is the
  // scroll container, and only while the overview itself is on screen — the
  // calendar and chat sub-routes scroll normally.
  const isOverview = !window.location.pathname.endsWith('/calendar')
    && !window.location.pathname.endsWith('/chat')
  const snapReady = isOverview && minimumLoadElapsed && !!dashboard

  useEffect(() => {
    if (!snapReady) return
    document.documentElement.classList.add('sd-snap')
    return () => document.documentElement.classList.remove('sd-snap')
  }, [snapReady])

  // Open on the first card instead of the strip above it. Once per visit: a
  // background refresh must never yank a learner back up the page.
  const openedOnHero = useRef(false)
  useEffect(() => {
    if (!snapReady || openedOnHero.current) return
    openedOnHero.current = true
    // Never fight a deep link or a scroll position the browser restored.
    if (window.location.hash || (document.scrollingElement?.scrollTop ?? 0) > 8) return
    document.querySelector('.sd-hero-card--split')
      ?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [snapReady])

  // The hero now carries its unit, so the lesson opens with both ids. This used
  // to test the component id against `/-00001-/` — one provider's numbering
  // convention, hard-coded — and silently dumped every other unit on the portal.
  const routeForComponent = (componentId: string | null, unitId?: string | null) => {
    if (!componentId) return '/learning'
    const params = new URLSearchParams({ component: componentId })
    if (unitId) params.set('unit', unitId)
    return `/learning/lesson?${params.toString()}`
  }

  const startHeroStep = async () => {
    if (!dashboard || dashboard.hero.mode === 'complete' || isStarting) return
    setActionError(false)
    // A pinned TASK is not catalog content: `selectNextRoute` speaks only
    // components and would answer with a lesson, not the paper the teacher
    // pinned. Straight to the opening the child's own task route accepts.
    if (dashboard.hero.mode === 'pinned'
        && dashboard.hero.pinnedKind === 'task' && dashboard.hero.launchId) {
      navigate(`/tasks/${encodeURIComponent(dashboard.hero.launchId)}`)
      return
    }
    if (dashboard.hero.mode === 'resume') {
      navigate(routeForComponent(dashboard.hero.componentId, dashboard.hero.unitId))
      return
    }

    setIsStarting(true)
    try {
      const decision = await selectNextRoute(language)
      refreshBrain()
      navigate(routeForComponent(
        decision.component?.id || dashboard.hero.componentId,
        decision.component?.unit_id || dashboard.hero.unitId,
      ))
    } catch {
      setActionError(true)
    } finally {
      setIsStarting(false)
    }
  }

  const studentName = dashboard?.name || brain?.identity.display_name || t('sdash.learnerFallback')

  if (window.location.pathname.endsWith('/calendar')) {
    return <StudentCalendarPage studentName={studentName} />
  }
  if (window.location.pathname.endsWith('/chat')) {
    return <StudentConnectionsPane studentName={studentName} />
  }

  if (!minimumLoadElapsed || (loading && !dashboard)) return <DashboardLoadingScreen />

  return (
    <div className="sd-page">
      <LearnerAppBar studentName={studentName} />

      <main className="sd-dashboard">
        {error && !dashboard && (
          <ErrorState
            title={t('sdash.error')}
            body={t('sdash.error.body')}
            action={<button className="sd-button sd-button--primary" type="button" onClick={() => setReloadKey((key) => key + 1)}>{t('sdash.retry')}</button>}
          />
        )}

        {dashboard && !dashboard.hasProfile && !dashboard.hasLearningEvidence && (
          <EmptyState
            title={t('sdash.noData')}
            body={t('sdash.noData.body')}
            action={<button className="sd-button sd-button--primary" type="button" onClick={() => navigate('/learner-mapping')}>{t('sdash.noDataCta')}</button>}
          />
        )}

        {dashboard && (dashboard.hasProfile || dashboard.hasLearningEvidence) && (
          <>
            <UpcomingStrip items={todayItems} />
            {/* One hero card, two halves: what to do next, and where the learner
                actually stands on the six activeness competencies. */}
            <section className="sd-hero-card sd-hero-card--split">
              <DashboardHero
                dashboard={dashboard}
                isStarting={isStarting}
                actionError={actionError}
                onStart={() => void startHeroStep()}
                onResume={dashboard.hero.resume ? () => navigate(routeForComponent(
                  dashboard.hero.resume?.componentId ?? null,
                  dashboard.hero.resume?.unitId,
                )) : undefined}
              />
              <ActivenessWeb competencies={dashboard.competencies} />
            </section>
            <section className="sd-hero-card sd-hero-card--subjects">
              <MySubjects
                subjects={dashboard.subjects}
                units={roadmapUnits}
                onOpenLearning={() => navigate('/learning')}
              />
            </section>
            <div className="sd-grid">
              <div className="sd-grid__main">
                <MyGoals
                  goals={dashboard.goals}
                  onSeeAll={() => navigate('/mentoring')}
                  onAddGoal={() => navigate('/mentoring')}
                  onUpdateStatus={async (goalId, status) => {
                    if (!learnerId) return
                    await updateGoalStatus(learnerId, goalId, status)
                    setReloadKey((key) => key + 1)
                  }}
                />
              </div>
            </div>
            <p className="sd-last-updated" aria-live="polite">
              <Icon name="check" size={14} />
              {t('sdash.live')}
            </p>
            <ActivenessMapSection
              competencies={dashboard.competencies}
              studentName={studentName}
            />
          </>
        )}
      </main>
    </div>
  )
}
