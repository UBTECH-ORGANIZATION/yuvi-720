import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getLearnerState, updateLearnerState } from '../services/api'

interface MotionContextValue {
  reduceMotion: boolean
  setReduceMotion: (value: boolean) => void
}

const MotionContext = createContext<MotionContextValue | null>(null)

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function systemPrefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

// A single attribute on <html> is what every stylesheet (and the game iframe)
// keys off, so non-React surfaces stay in sync without their own plumbing.
function applyDocumentMotion(reduceMotion: boolean) {
  document.documentElement.dataset.motion = reduceMotion ? 'reduced' : 'full'
}

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduceMotion, setReduceMotionState] = useState(systemPrefersReducedMotion)
  const [loadedPreference, setLoadedPreference] = useState(false)

  useEffect(() => {
    let active = true
    getLearnerState()
      .then((state) => {
        if (active && typeof state.reduce_motion === 'boolean') {
          setReduceMotionState(state.reduce_motion)
        }
      })
      .catch(() => {
        // Fall back to the operating system preference.
      })
      .finally(() => {
        if (active) setLoadedPreference(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    applyDocumentMotion(reduceMotion)
  }, [reduceMotion])

  const setReduceMotion = useCallback(
    (value: boolean) => {
      setReduceMotionState(value)
      if (loadedPreference) void updateLearnerState({ reduce_motion: value })
    },
    [loadedPreference]
  )

  return (
    <MotionContext.Provider value={{ reduceMotion, setReduceMotion }}>{children}</MotionContext.Provider>
  )
}

export function useMotion() {
  const context = useContext(MotionContext)
  if (!context) throw new Error('useMotion must be used inside MotionProvider')
  return context
}
