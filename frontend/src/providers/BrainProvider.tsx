import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getBrain, type Brain } from '../services/brain'

/* BrainProvider — the frontend seam onto the Learner Brain (architecture §17.2).
   Surfaces read the brain projection through this provider; they never invent
   learner data on the client. Until unified sign-in (Phase 5) the current learner
   is the demo learner; the id becomes session-derived without changing consumers. */

const CURRENT_LEARNER_ID = 'demo-learner'

interface BrainContextValue {
  learnerId: string
  brain: Brain | null
  isLoading: boolean
  error: string | null
  refresh: () => void
}

const BrainContext = createContext<BrainContextValue | null>(null)

export function BrainProvider({ children }: { children: ReactNode }) {
  const [brain, setBrain] = useState<Brain | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setIsLoading(true)
    setError(null)
    getBrain(CURRENT_LEARNER_ID, controller.signal)
      .then((data) => {
        if (active) setBrain(data)
      })
      .catch(() => {
        if (active) setError('brain_unavailable')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [reloadKey])

  return (
    <BrainContext.Provider
      value={{ learnerId: CURRENT_LEARNER_ID, brain, isLoading, error, refresh }}
    >
      {children}
    </BrainContext.Provider>
  )
}

export function useBrain() {
  const value = useContext(BrainContext)
  if (!value) throw new Error('useBrain must be used inside BrainProvider')
  return value
}
