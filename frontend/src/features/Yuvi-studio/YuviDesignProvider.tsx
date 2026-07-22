import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { getLearnerState } from '../../services/api'
import {
  DEFAULT_DESIGN,
  cloneDesign,
  normalizeDesign,
  type YuviDesign,
} from './YuviDesign'

interface YuviDesignContextValue {
  design: YuviDesign
  loaded: boolean
  refresh: () => Promise<YuviDesign>
  applySavedDesign: (design: YuviDesign) => void
}

const YuviDesignContext = createContext<YuviDesignContextValue | null>(null)

/**
 * Application-wide view of the persisted Yuvi design.
 * MongoDB remains authoritative; this context synchronizes every live Yuvi
 * immediately after a successful save without relying on browser storage.
 */
export function YuviDesignProvider({ children }: { children: ReactNode }) {
  const [design, setDesign] = useState<YuviDesign>(() => cloneDesign(DEFAULT_DESIGN))
  const [loaded, setLoaded] = useState(false)

  const applySavedDesign = useCallback((next: YuviDesign) => {
    setDesign(normalizeDesign(next))
    setLoaded(true)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const state = await getLearnerState()
      const next = normalizeDesign(state.avatar)
      setDesign(next)
      return next
    } catch {
      const fallback = cloneDesign(DEFAULT_DESIGN)
      setDesign(fallback)
      return fallback
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <YuviDesignContext.Provider value={{ design, loaded, refresh, applySavedDesign }}>
      {children}
    </YuviDesignContext.Provider>
  )
}

export function useYuviDesign() {
  const value = useContext(YuviDesignContext)
  if (!value) throw new Error('useYuviDesign must be used inside YuviDesignProvider')
  return value
}
