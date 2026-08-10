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
  reportPathChoice,
  type LearningComponentDTO,
  type LearningSessionDTO,
  type LearningTimingDTO,
  type LearningUnitDTO,
} from '../../services/learning'
import { optionalExtra as findOptionalExtra, previousStation, whatNowKey } from '../learning/pathView'
import { noteLoad, playbackMode } from '../learning/embedGuard'
import { useBadgeMoments } from '../badges/useBadgeMoments'
import { LessonRewards } from './LessonRewards'
import { ReflectionPanel } from './ReflectionPanel'
import { playCelebrationCheer } from '../../services/celebrationAudio'
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
  // Some providers' players cannot be framed at all (see `embedGuard`). When the
  // server says so, or when the frame is caught reloading itself in a loop, the
  // activity is offered in its own tab instead of strobing in place.
  const frameLoadsRef = useRef<number[]>([])
  const [reloadStorm, setReloadStorm] = useState(false)
  const [forceFrame, setForceFrame] = useState(false)
  const [openedExternally, setOpenedExternally] = useState(false)
  // A component the route has not opened yet is refused by the server (409).
  // That is a normal, explainable state — not the "something went wrong" card.
  const [lockedOut, setLockedOut] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [progressionReady, setProgressionReady] = useState(false)
  const [roadmap, setRoadmap] = useState<LearningUnitDTO | null>(null)
  const [travellingFromId, setTravellingFromId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // 720 §6: on re-entry to an ALREADY-completed component, the learner chooses
  // "view performance" or "redo". Until they choose, we hold a light overlay
  // over the (resumed) content. Only "redo" launches a fresh attempt (restart).
  const [reentryOpen, setReentryOpen] = useState(false)
  // True when the launch already found this component finished. The completion
  // POLL below only reads catalog STATE, so on re-entry it sees `completed` —
  // which was already true — and threw the celebration dialog up a few seconds
  // after the learner opened a lesson they had merely come back to look at.
  // A live signal (SSE / postMessage) is evidence something JUST happened and
  // still celebrates, which is what a redo needs.
  const wasCompletedAtLaunchRef = useRef(false)
  // Consumed by the session effect: the next (re)launch is an explicit redo, so
  // the backend resets our coach thread + one-shot hint state for a fresh run.
  const restartPendingRef = useRef(false)
  // Bumped once a completion is confirmed so the badge diff re-checks for a
  // newly earned coin or a progress bump. The result opens the dialog rather
  // than floating over it.
  const [badgeCheck, setBadgeCheck] = useState(0)
  // The completion dialog is a two-beat moment: what you earned, then what you
  // noticed. Reward news used to arrive as its own modal ON TOP of this one.
  const completionActionRef = useRef<HTMLButtonElement>(null)
  const completionDialogRef = useRef<HTMLElement>(null)
  const completionPendingRef = useRef(false)
  // …and a third beat: what the path decided next. Revealed once the reflection
  // is sent, so the learner leaves knowing where they are going and why.
  const [whatNowOpen, setWhatNowOpen] = useState(false)
  // How long the path was when this lesson opened. If the plan grew while they
  // worked (a repair round, an extra they asked for), the dialog says so instead
  // of letting the roadmap silently sprout a station.
  const stepsAtOpenRef = useRef<number | null>(null)
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
    setLockedOut(false)
    setFrameState('loading')
    const isRedo = restartPendingRef.current
    restartPendingRef.current = false
    createLearningSession(selection.componentId, selection.unitId, language, isRedo)
      .then((nextSession) => {
        if (active) {
          setSession(nextSession)
          setRoadmap(nextSession.roadmap)
          // A fresh launch is a fresh verdict on the frame: this component may
          // be hosted by a different player than the last one in the same unit.
          frameLoadsRef.current = []
          setReloadStorm(false)
          setForceFrame(false)
          setOpenedExternally(false)
          setCompleted(false)
          setProgressionReady(false)
          setWhatNowOpen(false)
          stepsAtOpenRef.current = nextSession.roadmap.steps_total ?? null
          setTravellingFromId(null)
          completionPendingRef.current = false
          // §6 re-entry: if this component is already completed and we're NOT
          // mid-redo, offer the view/redo choice over the resumed content.
          const persisted = nextSession.roadmap.components.find(
            (component) => component.id === nextSession.component.id,
          )
          setReentryOpen(!isRedo && persisted?.progress_state === 'completed')
          wasCompletedAtLaunchRef.current = persisted?.progress_state === 'completed'
          // Re-resolve the companion thread: the SAME open thread on a resume,
          // or the freshly reset one after a redo.
          window.dispatchEvent(new CustomEvent('yuvilab:lesson-session-created'))
        }
      })
      .catch((reason: unknown) => {
        if (!active) return
        const status = (reason as { status?: number } | null)?.status
        if (status === 409) setLockedOut(true)
        else setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [language, learnerId, reloadKey, selection.componentId, selection.unitId])

  // Frame it, or hand it to a tab of its own. Everything else about the lesson
  // — the route, the coach, the completion signal — is identical either way;
  // only where the activity is painted changes.
  const playback = playbackMode(session?.embeddable, reloadStorm, forceFrame)

  useEffect(() => {
    if (!session || playback === 'tab') return
    const readyTimeout = window.setTimeout(() => {
      setFrameState((current) => current === 'loading' ? 'error' : current)
    }, PROVIDER_READY_TIMEOUT_MS)
    return () => window.clearTimeout(readyTimeout)
  }, [playback, session])

  const handleFrameLoad = () => {
    setFrameState('ready')
    const { loads, storm } = noteLoad(frameLoadsRef.current, Date.now())
    frameLoadsRef.current = loads
    if (storm) setReloadStorm(true)
  }

  const openInNewTab = () => {
    if (!session) return
    // `noopener` only: the referrer is left intact, because a provider may key
    // its launch on it. The tab owns the activity; this page keeps the route,
    // the coach and the completion watch.
    window.open(session.player_url, '_blank', 'noopener')
    setOpenedExternally(true)
  }

  useEffect(() => {
    if (!session) return
    // Content we author ourselves is served from this origin, so its launch is a
    // relative path — resolve against the page before reading the origin.
    const providerOrigin = new URL(session.player_url, window.location.origin).origin
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
    const checkPersistedCompletion = async () => {
      if (controller.signal.aborted || completionPendingRef.current || completedRef.current) return
      // Nothing to detect: it was already finished when we opened it. Polling a
      // state that never changes is how re-entry ended up celebrating.
      if (wasCompletedAtLaunchRef.current) return
      try {
        const catalog = await getLearningCatalog(controller.signal)
        const unit = catalog.units.find((candidate) => candidate.id === session.unit.id)
        const persisted = unit?.components.find((c) => c.id === session.component.id)
        if (persisted?.progress_state === 'completed') void confirmPersistedCompletion()
      } catch {
        /* transient catalog/network error — the next tick retries */
      }
    }
    const pollTimer = window.setInterval(() => { void checkPersistedCompletion() }, COMPLETION_POLL_MS)

    // When the activity runs in its own tab, THIS page is in the background —
    // where browsers throttle timers hard. Coming back is the strongest signal
    // that something may have happened, so check on the way in rather than
    // making the learner watch a throttled interval catch up.
    const handleVisible = () => { if (!document.hidden) void checkPersistedCompletion() }
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)

    return () => {
      controller.abort()
      timers.forEach((timer) => window.clearTimeout(timer))
      window.clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleVisible)
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
    const hasNextStation = Boolean(roadmap?.next_path_node_id)
    const duration = reducedMotion ? 450 : hasNextStation ? 6800 : 2600
    const stopAudio = reducedMotion ? () => undefined : playCelebrationCheer(duration)
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
    // On `path_node_id`, not `id`: a repair round puts the same component on the
    // path twice, so the id alone no longer identifies a station.
    return roadmap.components.find(
      (component) => component.path_node_id === roadmap.next_path_node_id,
    ) || null
  }, [roadmap, session])

  // 720 F1 "אפשרות לחזור לתכנים קודמים": the nearest earlier station on THIS
  // learner's path. Walks `path_index` over stations they actually settled, so
  // it can no longer offer a component they never took (or a skipped extra).
  const previousComponent = useMemo(
    () => (roadmap && session ? previousStation(roadmap, session.component.id) : null),
    [roadmap, session],
  )

  // What the coins did across this lesson, read once the brain has settled.
  const badgeMoments = useBadgeMoments(badgeCheck, language)
  // The column appears only when there is real news to put in it. Showing it
  // while the diff was still loading meant the dialog opened two-column with a
  // spinner and then collapsed to one the moment nothing had moved — a visible
  // flinch on the most common outcome. Now the reflection is there instantly and
  // the celebration slides in beside it if a coin actually moved.
  const badgeCheckSettled = badgeCheck > 0 && badgeMoments.settledFor === badgeCheck
  const showRewardsStep = badgeCheckSettled && !badgeMoments.empty

  // What the path decided, in one sentence keyed off the NEXT node's reason —
  // never a mastery level and never a score (720 §2, §3.4).
  const whatNowMessage = useMemo(() => {
    if (!nextComponent) return t('learning.path.next.unit_completed_by_assessment')
    return t(whatNowKey(nextComponent), { title: nextComponent.title })
  }, [nextComponent, t])

  // The path just got longer than it was when this lesson opened — say it out
  // loud, so the extra station reads as the system responding, not as a glitch.
  const pathGrew = Boolean(
    roadmap && stepsAtOpenRef.current !== null && roadmap.steps_total > stepsAtOpenRef.current,
  )

  // An optional stage this learner's route dropped, offered as a real choice.
  const optionalExtra = useMemo(() => (roadmap ? findOptionalExtra(roadmap) : null), [roadmap])

  const openRoadmapComponent = (component: LearningComponentDTO) => {
    if (!roadmap) return
    const params = new URLSearchParams({ unit: roadmap.id, component: component.id })
    navigate(`/learning/lesson?${params}`)
  }

  // §6 re-entry, "move on": they already finished this one, so the useful default
  // is the next station rather than sitting on work that is done.
  const continueFromCompleted = () => {
    setReentryOpen(false)
    if (nextComponent) openRoadmapComponent(nextComponent)
    else navigate('/learning')
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
      <LearnerAppBar />
      <main className="learning-lesson-main">
        <header className="learning-lesson-toolbar">
          {/* Both ways OUT of this lesson, in one cluster. They used to be two
              siblings of a three-column grid, so the optional second one landed
              in the flexible middle column and stretched across the whole bar. */}
          <nav className="learning-lesson-nav" aria-label={t('learning.lesson.back')}>
            {/* Leaving for the roadmap. A `map` icon, not an arrow: an arrow here
                was the same gesture as "one step back" beside it, and two
                identical arrows on two identical pills is a coin toss. */}
            <button className="learning-lesson-back" type="button" onClick={() => navigate('/learning')}>
              <Icon name="map" size={16} />
              {t('learning.lesson.back')}
            </button>
            {/* Moving WITHIN the roadmap — a quiet link, not a second pill, so
                its weight matches how often it is the right thing to press. */}
            {previousComponent && (
              <button
                className="learning-lesson-prev"
                type="button"
                onClick={() => openRoadmapComponent(previousComponent)}
                title={`${t('learning.lesson.previous')} · ${previousComponent.title}`}
              >
                <Icon name="chevronLeft" size={15} />
                {t('learning.lesson.previous')}
              </button>
            )}
          </nav>
          <div className="learning-lesson-heading">
            <span>{session?.unit.title || t('learning.lesson.eyebrow')}</span>
            <h1>{session?.component.title || (lockedOut ? t('learning.lesson.locked') : t('learning.lesson.preparing'))}</h1>
          </div>
          <div className="learning-lesson-actions">
            {session?.component.estimated_minutes && (
              <span className="learning-lesson-duration"><Icon name="clock" size={15} />{t('learning.component.minutes', { minutes: session.component.estimated_minutes })}</span>
            )}
          </div>
        </header>

        {loading && <LoadingState title={t('learning.lesson.loading')} body={t('learning.lesson.loading.body')} />}
        {lockedOut && !loading && (
          <ErrorState
            title={t('learning.lesson.locked')}
            body={t('learning.lesson.locked.body')}
            action={(
              <div className="learning-lesson-error-actions">
                <button className="learning-primary-button" type="button" onClick={() => navigate('/learning')}>
                  {t('learning.lesson.locked.back')}
                </button>
              </div>
            )}
          />
        )}
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

        {session && !loading && !error && !lockedOut && (
          <section className="learning-player-shell" aria-label={t('learning.lesson.frameLabel')}>
            {!session.language_supported && (
              <div className="learning-player-notice" role="status">
                <Icon name="alert" size={16} />
                <span>{t('learning.language.fallback')}</span>
              </div>
            )}
            <div className="learning-player-frame-wrap">
              {/* This provider's player cannot live in a frame, so it gets a tab
                  of its own. Nothing else moves: the route, the coach and the
                  completion signal are unchanged, because completion reaches us
                  through the Kata relay and never through the frame. */}
              {playback === 'tab' ? (
                <div className="learning-player-external">
                  <span className="learning-player-external__mark" aria-hidden="true">
                    <Icon name="expand" size={26} />
                  </span>
                  <h2>{t('learning.lesson.external.title')}</h2>
                  <p>{t('learning.lesson.external.body')}</p>
                  <button className="learning-primary-button" type="button" onClick={openInNewTab}>
                    {t(openedExternally ? 'learning.lesson.external.reopen' : 'learning.lesson.external.open')}
                    <Icon name="arrow" size={16} />
                  </button>
                  {openedExternally && (
                    <p className="learning-player-external__note" role="status">
                      {t('learning.lesson.external.waiting')}
                    </p>
                  )}
                  {/* Only when WE guessed. If the server knows the frame cannot
                      work, offering it back would just restart the loop. */}
                  {session.embeddable !== false && reloadStorm && (
                    <button
                      className="learning-player-external__anyway"
                      type="button"
                      onClick={() => { frameLoadsRef.current = []; setForceFrame(true) }}
                    >
                      {t('learning.lesson.external.showHere')}
                    </button>
                  )}
                </div>
              ) : (
              <>
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
                // `storage-access` grants nothing by itself: it is the embedder's
                // half of the Storage Access API, without which a player that
                // asks for its own cookies in a frame is refused before it can
                // even prompt. Harmless for content that never asks.
                allow="autoplay; storage-access"
                onLoad={handleFrameLoad}
              />
              </>
              )}
              {reentryOpen && (
                <div className="learning-reentry" role="dialog" aria-modal="true" aria-labelledby="learning-reentry-title">
                  <div className="learning-reentry__card">
                    {/* §6 also allows REVIEWING the finished component. The two
                        buttons are the decisions; dismissing lands on the content
                        itself, which shows the review on re-entry. */}
                    <button
                      className="learning-reentry__close"
                      type="button"
                      onClick={viewCompletedPerformance}
                      aria-label={t('learning.lesson.reentry.view')}
                    >×</button>
                    <div className="learning-reentry__icon"><Icon name="check" size={22} /></div>
                    <h2 id="learning-reentry-title">{t('learning.lesson.reentry.title')}</h2>
                    <p>{t('learning.lesson.reentry.body')}</p>
                    <div className="learning-reentry__actions">
                      <button className="learning-primary-button" type="button" onClick={continueFromCompleted}>
                        {nextComponent ? t('learning.lesson.reentry.next') : t('learning.lesson.chooseNext')}
                        <Icon name="arrow" size={16} />
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
              className={`learning-completion-dialog${showRewardsStep ? '' : ' is-single'}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="learning-completion-title"
              aria-describedby="learning-completion-description"
            >
              <button
                className="learning-completion-dialog__close"
                type="button"
                disabled={!progressionReady}
                aria-label={t('learning.lesson.completionDialog.close')}
                onClick={closeCompletion}
              >
                ×
              </button>

              {/* The reward news stands BESIDE the reflection rather than in
                  front of it: one view, one primary action, nothing to click
                  past. It is absent entirely when no coin moved. */}
              {showRewardsStep && (
                <aside className="learning-completion-celebrate" aria-label={t('learning.rewards.stepTitle')}>
                  <LessonRewards moments={badgeMoments} />
                </aside>
              )}

              <div className="learning-completion-work">
                <header className="learning-completion-work__head">
                  <div className="learning-completion-icon"><Icon name="check" size={19} /></div>
                  <div>
                    <span>{t('learning.lesson.completionDialog.eyebrow')}</span>
                    <h2 id="learning-completion-title">{t('learning.lesson.completed')}</h2>
                  </div>
                </header>
                <p id="learning-completion-description" className="learning-completion-work__lede">
                  {timingLabel || t('learning.lesson.completed.body')}
                </p>

                <div className="learning-completion-work__body">
                  <ReflectionPanel
                    componentId={session?.component.id || null}
                    sessionId={session?.session_id || null}
                    onDone={() => setWhatNowOpen(true)}
                  />
                </div>

                {/* The third beat. Answering the reflection reveals what the path
                    decided and why — one sentence a child can read, built from the
                    next node's reason code and never from a level or a score. */}
                <div className={`learning-completion-work__next${whatNowOpen ? ' is-revealed' : ''}`}>
                  {whatNowOpen && <h3 className="learning-whatnow__title">{t('learning.path.whatNow')}</h3>}
                  <p>
                    {!progressionReady
                      ? t('learning.lesson.completionDialog.progressing')
                      : whatNowOpen
                      ? whatNowMessage
                      : nextComponent
                      ? t('learning.lesson.completionDialog.next', { title: nextComponent.title })
                      : t('learning.lesson.completed.body')}
                  </p>
                  {pathGrew && whatNowOpen && (
                    <p className="learning-whatnow__grew">
                      <Icon name="spark" size={14} />
                      {t('learning.path.grew')}
                    </p>
                  )}
                  <div className="learning-completion-work__choices">
                    <button
                      ref={completionActionRef}
                      className="learning-completion-cta"
                      type="button"
                      disabled={!progressionReady}
                      aria-busy={!progressionReady}
                      onClick={continueAfterCompletion}
                    >
                      {nextComponent ? t('learning.path.continue') : t('learning.lesson.chooseNext')}
                      <Icon name="arrow" size={17} />
                    </button>
                    {/* 720 §1 פעלנות — the learner may overrule the route. Taking
                        an extra is recorded, so the next re-plan already knows. */}
                    {optionalExtra && progressionReady && (
                      <button
                        className="learning-completion-alt"
                        type="button"
                        onClick={() => {
                          void reportPathChoice(session?.component.id || null, 'more_practice')
                          closeCompletion()
                          openRoadmapComponent(optionalExtra)
                        }}
                      >
                        <Icon name="plus" size={15} />
                        {t('learning.path.morePractice')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        ), document.body)}
      </main>
    </div>
  )
}
