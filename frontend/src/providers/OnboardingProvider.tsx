import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useRoute } from '../app/router'
import { getLearnerState } from '../services/api'
import { useAuth } from './AuthProvider'

/* Where the signed-in learner is in onboarding, read from their saved backend
   state (never the client). A learner who has not finished mapping + profile
   verification cannot wander into the dashboard or the learning world — they
   are returned to the step they left off at, which is exactly what
   `learner_state.mapping_progress` / `profile_summary_progress` already record
   per learner id. */

export type OnboardingStage = 'loading' | 'mapping' | 'results' | 'done'

export const STAGE_ROUTE: Record<Exclude<OnboardingStage, 'loading' | 'done'>, string> = {
  mapping: '/learner-mapping',
  results: '/results'
}

interface OnboardingContextValue {
  stage: OnboardingStage
  /* `stage === 'done'` is also what a FAILED read falls back to, deliberately —
     a network blip must not trap a learner. So anything irreversible needs to
     know the difference between "their saved state says they finished" and "we
     could not ask". The learner tour does: it is offered once, ever, and
     burning that on a dropped request would cost a child their first run. */
  verified: boolean
  refresh: () => void
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

interface Progress {
  completed?: boolean
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const learnerId = user?.user_id ?? null
  const [stage, setStage] = useState<OnboardingStage>('loading')
  const [verified, setVerified] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  // Re-check on every navigation until onboarding is finished, so completing a
  // step immediately unlocks the next one. Once 'done' this stops firing, so a
  // settled learner never pays for another round-trip.
  const pathname = useRoute()
  const key = stage === 'done' ? 'done' : pathname

  useEffect(() => {
    if (!learnerId) {
      setStage('loading')
      setVerified(false)
      return
    }
    if (stage === 'done') return
    let active = true
    getLearnerState()
      .then((state) => {
        if (!active) return
        const mapping = state.mapping_progress as Progress | null | undefined
        const results = state.profile_summary_progress as Progress | null | undefined
        if (!mapping?.completed) setStage('mapping')
        else if (!results?.completed) setStage('results')
        else { setStage('done'); setVerified(true) }
      })
      .catch(() => {
        // Never trap a learner behind a failed read — let the route through and
        // let the page itself surface the error. Not `verified`: we did not
        // learn that they finished, we only stopped blocking them.
        if (active) setStage('done')
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnerId, reloadKey, key])

  return (
    <OnboardingContext.Provider value={{ stage, verified, refresh }}>{children}</OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const value = useContext(OnboardingContext)
  if (!value) throw new Error('useOnboarding must be used inside OnboardingProvider')
  return value
}
