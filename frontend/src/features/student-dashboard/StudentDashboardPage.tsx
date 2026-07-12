import { useEffect, useState } from 'react'
import { AppBar } from '../../components/AppBar'
import { EmptyState, ErrorState, Icon, LoadingState } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useBrain } from '../../providers/BrainProvider'
import { useCompanion } from '../../providers/CompanionProvider'
import { getDashboard, type DashboardDTO } from '../../services/brain'
import { navigate } from '../../app/router'
import { selectNextRoute } from '../../services/agents'
import { DashboardHero } from './DashboardHero'
import { DashboardOverview } from './DashboardOverview'
import { SubjectJourney } from './SubjectJourney'
import './student-dashboard.css'

const REFERENCE_LESSON_COMPONENT = 'YuviDori-math-angles-0001-lesson'

/**
 * Student dashboard — 720 F4 projection over the real Learner Brain.
 * Learner-facing feedback is verbal; the component never invents progress,
 * goals, profile facts, curriculum order, or recommendations.
 */
export function StudentDashboardPage() {
  const { t, language } = useI18n()
  const { learnerId, brain, refresh: refreshBrain } = useBrain()
  const { open: openCompanion } = useCompanion()
  const [dashboard, setDashboard] = useState<DashboardDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [isStarting, setIsStarting] = useState(false)
  const [actionError, setActionError] = useState(false)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    if (!dashboard) setLoading(true)
    setError(false)
    getDashboard(learnerId, language, controller.signal)
      .then((next) => {
        if (active) setDashboard(next)
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

  const routeForComponent = (componentId: string | null) =>
    componentId === REFERENCE_LESSON_COMPONENT ? '/learning/lesson' : '/learning'

  const startHeroStep = async () => {
    if (!dashboard || dashboard.hero.mode === 'complete' || isStarting) return
    setActionError(false)
    if (dashboard.hero.mode === 'resume') {
      navigate(routeForComponent(dashboard.hero.componentId))
      return
    }

    setIsStarting(true)
    try {
      const decision = await selectNextRoute(language, learnerId)
      refreshBrain()
      navigate(routeForComponent(decision.component?.id || dashboard.hero.componentId))
    } catch {
      setActionError(true)
    } finally {
      setIsStarting(false)
    }
  }

  const studentName = dashboard?.name || brain?.identity.display_name || t('sdash.learnerFallback')

  const navigation = (
    <nav className="sd-app-nav" aria-label={t('sdash.nav.label')}>
      <button className="is-active" type="button" aria-current="page">
        <Icon name="chart" size={16} />
        <span>{t('sdash.nav.dashboard')}</span>
      </button>
      <button type="button" onClick={() => navigate('/learning')}>
        <Icon name="book" size={16} />
        <span>{t('sdash.nav.learning')}</span>
      </button>
      <button type="button" onClick={() => navigate('/mentoring')}>
        <Icon name="target" size={16} />
        <span>{t('sdash.nav.goals')}</span>
      </button>
    </nav>
  )

  return (
    <div className="sd-page">
      <AppBar
        studentName={studentName}
        studentSubtitle={t('sdash.appbar.subtitle')}
        center={navigation}
      />

      <main className="sd-dashboard">
        {loading && !dashboard && <LoadingState title={t('sdash.loading')} body={t('sdash.loading.body')} />}

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
            <DashboardHero
              dashboard={dashboard}
              isStarting={isStarting}
              actionError={actionError}
              onStart={() => void startHeroStep()}
              onBrowse={() => navigate('/learning')}
            />
            <SubjectJourney subjects={dashboard.subjects} onOpenLearning={() => navigate('/learning')} />
            <DashboardOverview
              dashboard={dashboard}
              onMentoring={() => navigate('/mentoring')}
              onAskYuvi={openCompanion}
            />
            <p className="sd-last-updated" aria-live="polite">
              <Icon name="check" size={14} />
              {t('sdash.live')}
            </p>
          </>
        )}
      </main>
    </div>
  )
}
