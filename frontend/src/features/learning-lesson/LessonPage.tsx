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
import { BadgeMoments } from '../badges/BadgeMoments'
import { ReflectionPanel } from './ReflectionPanel'
import { playProgressionAudio } from '../../services/progressionAudio'
import './lesson-workspace.css'

interface ProviderMessage {
  source?: string
  event?: string
  verb?: string
}

type FrameState = 'loading' | 'ready' | 'error'
const PROVIDER_READY_TIMEOUT_MS = 15000
// How often to poll the catalog for a Kata-relayed completion while a lesson is
// open (cross-origin content can't postMessage us — see the completion effect).
const COMPLETION_POLL_MS = 5000

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
  // 720 §6: on re-entry to an ALREADY-completed component, the learner chooses
  // "view performance" or "redo". Until they choose, we hold a light overlay
  // over the (resumed) content. Only "redo" launches a fresh attempt (restart).
  const [reentryOpen, setReentryOpen] = useState(false)
  // Consumed by the session effect: the next (re)launch is an explicit redo, so
  // the backend resets our coach thread + one-shot hint state for a fresh run.
  const restartPendingRef = useRef(false)
  // Bumped once a completion is confirmed so BadgeMoments re-checks for a newly
  // earned badge (celebration) or a progress bump (toast).
  const [badgeCheck, setBadgeCheck] = useState(0)
  const completionActionRef = useRef<HTMLButtonElement>(null)
  const completionDialogRef = useRef<HTMLElement>(null)
  const completionPendingRef = useRef(false)
  const completedRef = useRef(false)
  useEffect(() => { completedRef.current = completed }, [completed])

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
    const isRedo = restartPendingRef.current
    restartPendingRef.current = false
    createLearningSession(selection.componentId, selection.unitId, language, isRedo)
      .then((nextSession) => {
        if (active) {
          setSession(nextSession)
          setRoadmap(nextSession.roadmap)
          setCompleted(false)
          setProgressionReady(false)
          setTravellingFromId(null)
          completionPendingRef.current = false
          // §6 re-entry: if this component is already completed and we're NOT
          // mid-redo, offer the view/redo choice over the resumed content.
          const persisted = nextSession.roadmap.components.find(
            (component) => component.id === nextSession.component.id,
          )
          setReentryOpen(!isRedo && persisted?.progress_state === 'completed')
          // Re-resolve the companion thread: the SAME open thread on a resume,
          // or the freshly reset one after a redo.
          window.dispatchEvent(new CustomEvent('yuvilab:lesson-session-created'))
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
            const catalog = await getLearningCatalog(controller.signal)
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
            setBadgeCheck((count) => count + 1)
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

    // Fast path: the backend pushes a `completion` trigger over the coach SSE
    // the moment the component-level `completed` statement is ingested (Kata
    // relay → our ingest → triggers). Finalize instantly instead of waiting for
    // the next poll tick; confirmPersistedCompletion still verifies the flip to
    // 'completed' in the catalog, so this only removes latency, not the guard.
    const handleXapiCompletion = (event: Event) => {
      const detail = (event as CustomEvent<{ componentId?: string | null }>).detail
      if (detail?.componentId && detail.componentId !== session.component.id) return
      if (completionPendingRef.current || completedRef.current) return
      void confirmPersistedCompletion()
    }
    window.addEventListener('yuvilab:xapi-completion', handleXapiCompletion)

    // Kata content is hosted cross-origin (lomdot.education.gov.il) and never
    // postMessages us — completion arrives via xAPI → Kata relay → our ingest →
    // the catalog's progress_state. Poll while the lesson is open so we detect
    // the flip to 'completed' and run the same finalize path as the message.
    const pollTimer = window.setInterval(async () => {
      if (controller.signal.aborted || completionPendingRef.current || completedRef.current) return
      try {
        const catalog = await getLearningCatalog(controller.signal)
        const unit = catalog.units.find((candidate) => candidate.id === session.unit.id)
        const persisted = unit?.components.find((c) => c.id === session.component.id)
        if (persisted?.progress_state === 'completed') void confirmPersistedCompletion()
      } catch {
        /* transient catalog/network error — the next tick retries */
      }
    }, COMPLETION_POLL_MS)

    return () => {
      controller.abort()
      timers.forEach((timer) => window.clearTimeout(timer))
      window.clearInterval(pollTimer)
      window.removeEventListener('message', handleProviderMessage)
      window.removeEventListener('yuvilab:xapi-completion', handleXapiCompletion)
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

  // §6 "view performance": keep the resumed content + our chat/hint state; just
  // dismiss the choice. The content itself shows the review on re-entry.
  const viewCompletedPerformance = () => setReentryOpen(false)

  // §6 "redo the component": fresh attempt — the next launch resets our coach
  // thread + one-shot hint state and reloads the content.
  const redoCompletedComponent = () => {
    setReentryOpen(false)
    restartPendingRef.current = true
    setReloadKey((key) => key + 1)
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
      <BadgeMoments trigger={badgeCheck} />
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
              {reentryOpen && (
                <div className="learning-reentry" role="dialog" aria-modal="true" aria-labelledby="learning-reentry-title">
                  <div className="learning-reentry__card">
                    <div className="learning-reentry__icon"><Icon name="check" size={22} /></div>
                    <h2 id="learning-reentry-title">{t('learning.lesson.reentry.title')}</h2>
                    <p>{t('learning.lesson.reentry.body')}</p>
                    <div className="learning-reentry__actions">
                      <button className="learning-primary-button" type="button" onClick={viewCompletedPerformance}>
                        {t('learning.lesson.reentry.view')}
                      </button>
                      <button className="learning-secondary-button" type="button" onClick={redoCompletedComponent}>
                        {t('learning.lesson.reentry.redo')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
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

              <ReflectionPanel
                componentId={session?.component.id || null}
                sessionId={session?.session_id || null}
                onDone={() => undefined}
              />

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
