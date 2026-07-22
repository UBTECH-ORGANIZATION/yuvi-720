import { useEffect, useRef, useState } from 'react'
import { navigate } from '../../app/router'
import { AppBar } from '../../components/AppBar'
import { Toast } from '../../components/Toast'
import { useI18n } from '../../i18n/I18nProvider'
import { apiPatch, apiPost, getLearnerState } from '../../services/api'
import { useBrain } from '../../providers/BrainProvider'
import { YuviRobot3D } from '../learner-mapping/YuviRobot3D'
import { ProfileGlyph } from './ProfileGlyph'
import type { MappingResults, ProfileClaim, ProfileFeedbackVerdict, ProfileSummary } from './types'

type Status = 'loading' | 'analyzing' | 'ready' | 'error'
type ToastState = { variant: 'info'; title: string; body?: string } | null
type ResultsProgress = {
  journey_index: number
  current_source_id: string | null
  completed: boolean
  language: string
  summary: ProfileSummary
}

const pendingSummaries = new Map<string, Promise<ProfileSummary>>()

function FeedbackFace({ verdict }: { verdict: ProfileFeedbackVerdict }) {
  const mouth =
    verdict === 'accurate' ? 'M8.5 13.5c1.1 1.6 5.9 1.6 7 0'
    : verdict === 'inaccurate' ? 'M8.5 15c1.1-1.6 5.9-1.6 7 0'
    : 'M9 14.5h6'
  return (
    <svg className="results-card__face" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="9" cy="10" r=".6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r=".6" fill="currentColor" stroke="none" />
      <path d={mouth} />
    </svg>
  )
}

function requestProfileSummary(learnerId: string, language: string) {
  const key = `${learnerId}:${language}`
  const existing = pendingSummaries.get(key)
  if (existing) return existing
  const request = apiPost<ProfileSummary>('/api/profile-summary', { language })
  pendingSummaries.set(key, request)
  void request.finally(() => pendingSummaries.delete(key))
  return request
}

function savedResultsProgress(value: unknown): ResultsProgress | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ResultsProgress>
  const summary = candidate.summary
  if (
    typeof candidate.journey_index !== 'number' ||
    !(typeof candidate.current_source_id === 'string' || candidate.current_source_id === null) ||
    typeof candidate.completed !== 'boolean' ||
    typeof candidate.language !== 'string' ||
    !summary ||
    typeof summary.hero_message !== 'string' ||
    !Array.isArray(summary.claims)
  ) return null
  return candidate as ResultsProgress
}

function persistResultsProgress(progress: ResultsProgress) {
  return apiPatch('/api/learner-state', { profile_summary_progress: progress })
}

function restoredJourneyIndex(progress: ResultsProgress | null, summary: ProfileSummary) {
  const doneIndex = summary.claims.length + 1
  if (!progress) return 0
  if (progress.completed) return doneIndex
  if (progress.current_source_id) {
    const claimIndex = summary.claims.findIndex(
      (claim) => claim.source_id === progress.current_source_id
    )
    if (claimIndex >= 0) return claimIndex + 1
  }
  return Math.max(0, Math.min(progress.journey_index, doneIndex))
}

export function ResultsPage() {
  const { language, t } = useI18n()
  const { learnerId } = useBrain()
  const [status, setStatus] = useState<Status>('loading')
  const [summary, setSummary] = useState<ProfileSummary | null>(null)
  const [studentName, setStudentName] = useState(t('results.learnerFallback'))
  const [loadingStep, setLoadingStep] = useState(0)
  const [journeyIndex, setJourneyIndex] = useState(0)
  const [toast, setToast] = useState<ToastState>(null)
  const [robotSpeaking, setRobotSpeaking] = useState(false)
  const feedbackQueuesRef = useRef(new Map<string, Promise<void>>())
  const feedbackRevisionRef = useRef(new Map<string, number>())
  const summaryRef = useRef<ProfileSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const state = await getLearnerState()
        if (cancelled) return
        const mappingDone =
          (state.mapping_progress as { completed?: boolean } | null | undefined)?.completed === true
        const mapping = state.mapping_results as MappingResults | null | undefined
        // /results is the profile-verification step and only exists once mapping
        // is actually finished. `mapping_results` can be present from a partial or
        // abandoned run, so completion is judged by mapping_progress.completed —
        // the same authoritative signal OnboardingProvider trusts. Reaching this
        // step early (or with no saved results) is an invalid state: send the
        // learner back to the start of onboarding instead of showing a dead-end.
        if (!mappingDone || !mapping) {
          navigate('/learner-mapping')
          return
        }
        setStudentName(mapping.student_name || t('results.learnerFallback'))
        const savedProgress = savedResultsProgress(state.profile_summary_progress)
        if (savedProgress?.language === language) {
          const restoredIndex = restoredJourneyIndex(savedProgress, savedProgress.summary)
          summaryRef.current = savedProgress.summary
          setSummary(savedProgress.summary)
          setJourneyIndex(restoredIndex)
          setStatus('ready')
          return
        }
        setStatus('analyzing')
        const nextSummary = await requestProfileSummary(learnerId ?? '', language)
        if (cancelled) return
        const restoredIndex = restoredJourneyIndex(savedProgress, nextSummary)
        summaryRef.current = nextSummary
        setSummary(nextSummary)
        setJourneyIndex(restoredIndex)
        await persistResultsProgress({
          journey_index: restoredIndex,
          current_source_id: nextSummary.claims[restoredIndex - 1]?.source_id || null,
          completed: restoredIndex === nextSummary.claims.length + 1,
          language,
          summary: nextSummary,
        }).catch(() => undefined)
        if (cancelled) return
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
    // Language changes remount the route from App.tsx and are the only reason
    // this persisted, localized data needs to be requested again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  useEffect(() => {
    if (status !== 'analyzing') return
    const handle = window.setInterval(() => {
      setLoadingStep((step) => Math.min(step + 1, 2))
    }, 1050)
    return () => window.clearInterval(handle)
  }, [status])

  useEffect(() => {
    const claimCount = summary?.claims.length ?? 0
    const isClaimStep = status === 'ready' && journeyIndex > 0 && journeyIndex <= claimCount
    setRobotSpeaking(isClaimStep)
    if (!isClaimStep) return
    const handle = window.setTimeout(() => setRobotSpeaking(false), 2200)
    return () => window.clearTimeout(handle)
  }, [journeyIndex, status, summary?.claims.length])

  function submitFeedback(sourceId: string, verdict: ProfileFeedbackVerdict) {
    const currentSummary = summaryRef.current || summary
    const currentVerdict = currentSummary?.claims.find((claim) => claim.source_id === sourceId)?.feedback_status
    if (currentVerdict === verdict) return

    const nextSummary = currentSummary ? {
      ...currentSummary,
      claims: currentSummary.claims.map((claim) =>
        claim.source_id === sourceId ? { ...claim, feedback_status: verdict } : claim
      ),
    } : null
    summaryRef.current = nextSummary
    setSummary(nextSummary)
    if (nextSummary) {
      void persistResultsProgress({
        journey_index: journeyIndex,
        current_source_id: sourceId,
        completed: false,
        language,
        summary: nextSummary,
      }).catch(() => undefined)
    }

    const revision = (feedbackRevisionRef.current.get(sourceId) ?? 0) + 1
    feedbackRevisionRef.current.set(sourceId, revision)
    const previous = feedbackQueuesRef.current.get(sourceId) ?? Promise.resolve()
    const request = previous.catch(() => undefined).then(async () => {
      let lastError: unknown
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await apiPost('/api/profile-feedback', {
            language,
            source_id: sourceId,
            verdict,
          })
          return
        } catch (error) {
          lastError = error
          if (attempt === 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 300))
          }
        }
      }
      throw lastError
    })
    feedbackQueuesRef.current.set(sourceId, request)

    void request.catch(() => {
      if (feedbackRevisionRef.current.get(sourceId) !== revision) return
      setToast({ variant: 'info', title: t('results.feedback.errorTitle'), body: t('results.feedback.errorBody') })
    }).finally(() => {
      if (feedbackQueuesRef.current.get(sourceId) === request) {
        feedbackQueuesRef.current.delete(sourceId)
      }
    })
  }

  if (status === 'loading' || status === 'analyzing') {
    return (
      <div className="results-page results-page--transition">
        <AppBar activeStep={3} />
        <main className="results-transition" aria-live="polite">
          <div className="results-transition__robot" aria-label={t('results.robot.aria')}>
            <span className="results-transition__orbit results-transition__orbit--outer" aria-hidden="true" />
            <span className="results-transition__orbit results-transition__orbit--inner" aria-hidden="true" />
            <YuviRobot3D label={t('results.robot.aria')} thinking />
          </div>
          <div className="results-transition__copy">
            <span className="results-eyebrow">{t('results.loading.eyebrow')}</span>
            <h1>{t('results.loading.title')}</h1>
            <p>{t('results.loading.subtitle')}</p>
          </div>
          <div className="results-transition__steps" aria-label={t('results.loading.aria')}>
            {(['answers', 'reflections', 'portrait'] as const).map((step, index) => (
              <div className={`results-transition__step${index <= loadingStep ? ' is-active' : ''}${index < loadingStep ? ' is-done' : ''}`} key={step}>
                <span className="results-transition__step-icon"><ProfileGlyph iconKey={['organization', 'feedback', 'spark'][index]} /></span>
                <span>{t(`results.loading.step.${step}`)}</span>
              </div>
            ))}
          </div>
        </main>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="results-page">
        <AppBar activeStep={3} />
        <main className="results-empty">
          <span className="results-empty__icon"><ProfileGlyph iconKey="growth" /></span>
          <h1>{t('results.error.title')}</h1>
          <p>{t('results.error.subtitle')}</p>
          <button className="results-primary-button" onClick={() => window.location.reload()}>
            {t('results.error.cta')}
          </button>
        </main>
      </div>
    )
  }

  const claims = summary?.claims || []
  const journeyLength = claims.length + 2
  const isIntro = journeyIndex === 0
  const isDone = journeyIndex === journeyLength - 1
  const activeClaim = !isIntro && !isDone ? claims[journeyIndex - 1] : null
  // Verification only means something if the learner actually answers, so the
  // step cannot be skipped past.
  const awaitingAnswer = Boolean(activeClaim) && !activeClaim?.feedback_status

  function goToJourneyStep(nextIndex: number) {
    // Belt-and-braces with the disabled button: never advance off an unanswered
    // claim, whatever calls this.
    if (nextIndex > journeyIndex && awaitingAnswer) return
    const resolvedIndex = Math.max(0, Math.min(nextIndex, journeyLength - 1))
    setJourneyIndex(resolvedIndex)
    if (summaryRef.current) {
      void persistResultsProgress({
        journey_index: resolvedIndex,
        current_source_id: summaryRef.current.claims[resolvedIndex - 1]?.source_id || null,
        completed: resolvedIndex === journeyLength - 1,
        language,
        summary: summaryRef.current,
      }).catch(() => undefined)
    }
  }

  async function openDashboard() {
    if (summaryRef.current) {
      await persistResultsProgress({
        journey_index: journeyLength - 1,
        current_source_id: null,
        completed: true,
        language,
        summary: summaryRef.current,
      }).catch(() => undefined)
    }
    navigate('/student-dashboard')
  }

  return (
    <div className="results-page">
      <AppBar activeStep={3} />
      {toast && (
        <Toast
          variant={toast.variant}
          icon={<ProfileGlyph iconKey="spark" />}
          title={toast.title}
          body={toast.body}
          onDismiss={() => setToast(null)}
          dismissLabel={t('results.toast.dismiss')}
        />
      )}
      <main className="results-journey">
        <header className="results-journey__top">
          <div className="results-journey__progress" aria-label={t('results.journey.progress')}>
            {Array.from({ length: journeyLength }, (_, index) => (
              <span
                className={`${index === journeyIndex ? 'is-active' : ''}${index < journeyIndex ? ' is-complete' : ''}`}
                aria-current={index === journeyIndex ? 'step' : undefined}
                key={index}
              />
            ))}
          </div>
          {activeClaim && (
            <p className="results-journey__counter">
              {t('results.journey.insightCounter', { current: journeyIndex, total: claims.length })}
            </p>
          )}
        </header>

        <section className="results-stage" aria-live="polite">
          <article className="results-card" key={journeyIndex}>
            <div className="results-card__main">
              <div className="results-card__content">
              {isIntro && (
                <>
                  <span className="results-eyebrow"><ProfileGlyph iconKey="spark" />{t('results.hero.eyebrow')}</span>
                  <h1>{t('results.hero.title', { name: studentName })}</h1>
                  <p className="results-card__lead" dir="auto">{summary?.hero_message}</p>
                </>
              )}

              {activeClaim && (
                <>
                  <span className="results-eyebrow"><ProfileGlyph iconKey="spark" />{t('results.insight.label')}</span>
                  <h1 dir="auto">{activeClaim.title}</h1>
                  <p className="results-card__lead" dir="auto">{activeClaim.description}</p>

                  <div className="results-card__feedback" aria-label={t('results.feedback.prompt')}>
                    <span className="results-card__divider" aria-hidden="true" />
                    <strong>{t('results.feedback.prompt')}</strong>
                    <div className="results-card__feedback-actions">
                      {(['accurate', 'unsure', 'inaccurate'] as const).map((verdict) => (
                        <button
                          type="button"
                          className={activeClaim.feedback_status === verdict ? 'is-selected' : ''}
                          aria-pressed={activeClaim.feedback_status === verdict}
                          onClick={() => submitFeedback(activeClaim.source_id, verdict)}
                          key={verdict}
                        >
                          <FeedbackFace verdict={verdict} />
                          <span>{t(`results.feedback.${verdict}`)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {isDone && (
                <>
                  <span className="results-eyebrow"><ProfileGlyph iconKey="spark" />{t('results.claims.eyebrow')}</span>
                  <h1>{t('results.journey.doneTitle')}</h1>
                  <p className="results-card__lead">{t('results.journey.doneSubtitle')}</p>
                </>
              )}
            </div>

            <div className="results-card__yuvi">
              <p className="results-card__bubble" dir="auto">{t('results.robot.bubble')}</p>
              <div
                className={`results-card__robot${robotSpeaking ? ' is-speaking' : ''}`}
                data-speaking={robotSpeaking ? 'true' : 'false'}
                aria-label={t('results.robot.aria')}
              >
                <span className="results-card__robot-halo" aria-hidden="true" />
                <YuviRobot3D
                  label={t('results.robot.aria')}
                  speaking={robotSpeaking}
                  celebrating={isDone}
                />
              </div>
            </div>
            </div>

            <nav className="results-card__actions" aria-label={t('results.journey.navigation')}>
              {journeyIndex > 0 && !isDone && (
                <button className="results-secondary-button" type="button" onClick={() => goToJourneyStep(journeyIndex - 1)}>
                  {t('results.journey.previous')}
                </button>
              )}
              {!isDone && (
                <p className="results-journey__hint" id="results-answer-required">
                  {awaitingAnswer ? t('results.journey.answerRequired') : t('results.journey.feedbackHint')}
                </p>
              )}
              {!isDone && (
                <button
                  className="results-primary-button"
                  type="button"
                  onClick={() => goToJourneyStep(journeyIndex + 1)}
                  disabled={awaitingAnswer}
                  aria-describedby="results-answer-required"
                >
                  {t(isIntro ? 'results.journey.start' : 'results.journey.next')}
                </button>
              )}
              {isDone && (
                <button className="results-primary-button" type="button" onClick={() => void openDashboard()}>
                  {t('results.cta')}
                </button>
              )}
            </nav>
          </article>
        </section>
      </main>
    </div>
  )
}
