import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { navigate, useRoute } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { ErrorState, Icon, LoadingState } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useBrain } from '../../providers/BrainProvider'
import { useLessonRoadmap } from '../../providers/LessonRoadmapProvider'
import {
  createLearningSession,
  getLearningCatalog,
  getLearningTiming,
  type LearningComponentDTO,
  type LearningSessionDTO,
  type LearningTimingDTO,
  type LearningUnitDTO,
} from '../../services/learning'
import { LearningRoadmap } from '../learning-portal/LearningRoadmap'
import { playProgressionAudio } from '../../services/progressionAudio'
import './lesson-workspace.css'

interface ProviderMessage {
  source?: string
  event?: string
  verb?: string
}

type FrameState = 'loading' | 'ready' | 'error'
const PROVIDER_READY_TIMEOUT_MS = 15000

function isProviderMessage(value: unknown): value is ProviderMessage {
  return typeof value === 'object' && value !== null
}

/** Signed 720 F1 provider workspace with the existing fixed F3 Coach panel. */
export function LessonPage() {
  const { t, language } = useI18n()
  const { learnerId, refresh: refreshBrain } = useBrain()
  const { publish: publishRoadmap, clear: clearRoadmap } = useLessonRoadmap()
  const route = useRoute()
  const selection = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return {
      unitId: params.get('unit'),
      componentId: params.get('component'),
    }
  }, [route])
  const [session, setSession] = useState<LearningSessionDTO | null>(null)
  const [timing, setTiming] = useState<LearningTimingDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [frameState, setFrameState] = useState<FrameState>('loading')
  const [error, setError] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [progressionReady, setProgressionReady] = useState(false)
  const [roadmap, setRoadmap] = useState<LearningUnitDTO | null>(null)
  const [travellingFromId, setTravellingFromId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const completionActionRef = useRef<HTMLButtonElement>(null)
  const completionDialogRef = useRef<HTMLElement>(null)
  const completionPendingRef = useRef(false)

  useEffect(() => {
    let active = true
    if (!selection.componentId) {
      setError(true)
      setLoading(false)
      return () => {
        active = false
      }
    }
    setLoading(true)
    setError(false)
    setFrameState('loading')
    createLearningSession(learnerId, selection.componentId, selection.unitId, language)
      .then((nextSession) => {
        if (active) {
          setSession(nextSession)
          setRoadmap(nextSession.roadmap)
          setCompleted(false)
          setProgressionReady(false)
          setTravellingFromId(null)
          completionPendingRef.current = false
        }
      })
      .catch(() => {
        if (active) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [language, learnerId, reloadKey, selection.componentId, selection.unitId])

  useEffect(() => {
    if (!session) return
    const readyTimeout = window.setTimeout(() => {
      setFrameState((current) => current === 'loading' ? 'error' : current)
    }, PROVIDER_READY_TIMEOUT_MS)
    return () => window.clearTimeout(readyTimeout)
  }, [session])

  useEffect(() => {
    if (!session) return
    const providerOrigin = new URL(session.player_url).origin
    const controller = new AbortController()
    const timers = new Set<number>()
    const wait = (delay: number) => new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        resolve()
      }, delay)
      timers.add(timer)
    })

    const confirmPersistedCompletion = async () => {
      completionPendingRef.current = true
      try {
        for (let attempt = 0; attempt < 5 && !controller.signal.aborted; attempt += 1) {
          await wait(attempt === 0 ? 1450 : 850)
          if (controller.signal.aborted) return
          try {
            const catalog = await getLearningCatalog(learnerId, controller.signal)
            const nextRoadmap = catalog.units.find((unit) => unit.id === session.unit.id)
            const persistedComponent = nextRoadmap?.components.find(
              (component) => component.id === session.component.id,
            )
            if (!nextRoadmap || persistedComponent?.progress_state !== 'completed') continue

            setRoadmap(nextRoadmap)
            setProgressionReady(false)
            setCompleted(true)
            refreshBrain()
            window.dispatchEvent(new CustomEvent('yuvilab:brain-updated'))
            getLearningTiming(session, controller.signal)
              .then(setTiming)
              .catch(() => undefined)

            if (nextRoadmap.next_component_id) {
              const launchTimer = window.setTimeout(() => {
                timers.delete(launchTimer)
                setTravellingFromId(session.component.id)
              }, 320)
              timers.add(launchTimer)
            }
            return
          } catch {
            if (controller.signal.aborted) return
          }
        }
      } finally {
        completionPendingRef.current = false
      }
    }

    const handleProviderMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== providerOrigin || !isProviderMessage(event.data)) return
      if (event.data.source !== 'content-provider') return
      setFrameState('ready')
      if (event.data.event === 'component-completed' || event.data.verb === 'completed') {
        if (event.data.event === 'component-completed' && !completionPendingRef.current) {
          void confirmPersistedCompletion()
        }
      }
    }
    window.addEventListener('message', handleProviderMessage)
    return () => {
      controller.abort()
      timers.forEach((timer) => window.clearTimeout(timer))
      window.removeEventListener('message', handleProviderMessage)
    }
  }, [learnerId, refreshBrain, session])

  useEffect(() => {
    if (!completed) return
    if (progressionReady) completionActionRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!progressionReady) return
        setCompleted(false)
        setTravellingFromId(null)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(completionDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) || [])]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [completed, progressionReady])

  useEffect(() => {
    if (!completed) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const hasNextStation = Boolean(roadmap?.next_component_id)
    const duration = reducedMotion ? 450 : hasNextStation ? 6800 : 2600
    const stopAudio = reducedMotion ? () => undefined : playProgressionAudio(duration)
    const readyTimer = window.setTimeout(() => {
      setTravellingFromId(null)
      setProgressionReady(true)
    }, duration)
    return () => {
      window.clearTimeout(readyTimer)
      stopAudio()
    }
  }, [completed, roadmap?.next_component_id])

  useEffect(() => {
    if (!roadmap || !session) return
    publishRoadmap({
      unit: roadmap,
      activeComponentId: session.component.id,
      travellingFromId,
    })
  }, [publishRoadmap, roadmap, session, travellingFromId])

  useEffect(() => () => clearRoadmap(), [clearRoadmap])

  const nextComponent = useMemo(() => {
    if (!roadmap || !session) return null
    return roadmap.components.find(
      (component) => component.id === roadmap.next_component_id,
    ) || null
  }, [roadmap, session])

  const openRoadmapComponent = (component: LearningComponentDTO) => {
    if (!roadmap) return
    const params = new URLSearchParams({ unit: roadmap.id, component: component.id })
    navigate(`/learning/lesson?${params}`)
  }

  const closeCompletion = () => {
    if (!progressionReady) return
    setCompleted(false)
    setTravellingFromId(null)
  }

  const continueAfterCompletion = () => {
    if (!progressionReady) return
    closeCompletion()
    if (nextComponent) openRoadmapComponent(nextComponent)
    else navigate('/learning')
  }

  const elapsedMinutes = timing?.total_elapsed_seconds != null
    ? Math.max(1, Math.round(timing.total_elapsed_seconds / 60))
    : null
  const timingLabel = elapsedMinutes === 1
    ? t('learning.lesson.elapsed.one')
    : elapsedMinutes != null
      ? t('learning.lesson.elapsed', { minutes: elapsedMinutes })
      : null

  return (
    <div className="learning-lesson-page">
      <LearnerAppBar />
      <main className="learning-lesson-main">
        <header className="learning-lesson-toolbar">
          <button className="learning-lesson-back" type="button" onClick={() => navigate('/learning')}>
            <Icon name="arrow" size={17} />
            {t('learning.lesson.back')}
          </button>
          <div className="learning-lesson-heading">
            <span>{session?.unit.title || t('learning.lesson.eyebrow')}</span>
            <h1>{session?.component.title || t('learning.lesson.preparing')}</h1>
          </div>
          <div className="learning-lesson-actions">
            {session?.component.estimated_minutes && (
              <span className="learning-lesson-duration"><Icon name="clock" size={15} />{t('learning.component.minutes', { minutes: session.component.estimated_minutes })}</span>
            )}
          </div>
        </header>

        {loading && <LoadingState title={t('learning.lesson.loading')} body={t('learning.lesson.loading.body')} />}
        {error && !loading && (
          <ErrorState
            title={t('learning.lesson.error')}
            body={t('learning.lesson.error.body')}
            action={(
              <div className="learning-lesson-error-actions">
                <button className="learning-primary-button" type="button" onClick={() => setReloadKey((key) => key + 1)}>{t('learning.retry')}</button>
                <button className="learning-secondary-button" type="button" onClick={() => navigate('/learning')}>{t('learning.lesson.back')}</button>
              </div>
            )}
          />
        )}

        {session && !loading && !error && (
          <section className="learning-player-shell" aria-label={t('learning.lesson.frameLabel')}>
            {!session.language_supported && (
              <div className="learning-player-notice" role="status">
                <Icon name="alert" size={16} />
                <span>{t('learning.language.fallback')}</span>
              </div>
            )}
            <div className="learning-player-frame-wrap">
              {frameState === 'loading' && (
                <div className="learning-player-loading" role="status">
                  <span className="learning-player-spinner" aria-hidden="true" />
                  <span>{t('learning.lesson.frameLoading')}</span>
                </div>
              )}
              {frameState === 'error' && (
                <div className="learning-player-loading learning-player-loading--error" role="alert">
                  <Icon name="alert" size={26} />
                  <strong>{t('learning.lesson.frameError')}</strong>
                  <span>{t('learning.lesson.frameError.body')}</span>
                  <button
                    className="learning-primary-button"
                    type="button"
                    onClick={() => setReloadKey((key) => key + 1)}
                  >
                    {t('learning.lesson.frameError.retry')}
                  </button>
                </div>
              )}
              <iframe
                key={session.session_id}
                className="learning-provider-frame"
                src={session.player_url}
                title={session.component.title}
                sandbox="allow-scripts allow-same-origin"
                allow="autoplay"
                onLoad={() => setFrameState('ready')}
              />
            </div>
          </section>
        )}

        {completed && roadmap && createPortal((
          <div className="learning-completion-backdrop" role="presentation">
            <section
              ref={completionDialogRef}
              className="learning-completion-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="learning-completion-title"
              aria-describedby="learning-completion-description"
            >
              <header className="learning-completion-dialog__header">
                <div className="learning-completion-icon"><Icon name="check" size={22} /></div>
                <div>
                  <span>{t('learning.lesson.completionDialog.eyebrow')}</span>
                  <h2 id="learning-completion-title">{t('learning.lesson.completed')}</h2>
                  <p id="learning-completion-description">
                    {timingLabel || t('learning.lesson.completed.body')}
                  </p>
                </div>
                <button
                  className="learning-completion-dialog__close"
                  type="button"
                  disabled={!progressionReady}
                  aria-label={t('learning.lesson.completionDialog.close')}
                  onClick={closeCompletion}
                >
                  ×
                </button>
              </header>

              <div className="learning-completion-dialog__journey">
                <LearningRoadmap
                  unit={roadmap}
                  activeComponentId={session?.component.id}
                  travellingFromId={travellingFromId}
                  cinematic
                  onTravelComplete={() => {
                    setTravellingFromId(null)
                  }}
                />
              </div>

              <footer className="learning-completion-dialog__footer">
                <div>
                  <strong>{t('learning.lesson.completionDialog.evidence')}</strong>
                  <span>
                    {!progressionReady
                      ? t('learning.lesson.completionDialog.progressing')
                      : nextComponent
                      ? t('learning.lesson.completionDialog.next', { title: nextComponent.title })
                      : t('learning.lesson.completed.body')}
                  </span>
                </div>
                <button
                  ref={completionActionRef}
                  type="button"
                  disabled={!progressionReady}
                  aria-busy={!progressionReady}
                  onClick={continueAfterCompletion}
                >
                  {nextComponent ? t('learning.lesson.continueJourney') : t('learning.lesson.chooseNext')}
                </button>
              </footer>
            </section>
          </div>
        ), document.body)}
      </main>
    </div>
  )
}
