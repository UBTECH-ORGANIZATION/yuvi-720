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
  type YubiDesign,
} from './yubiDesign'

interface YubiDesignContextValue {
  design: YubiDesign
  loaded: boolean
  refresh: () => Promise<YubiDesign>
  applySavedDesign: (design: YubiDesign) => void
}

const YubiDesignContext = createContext<YubiDesignContextValue | null>(null)

/**
 * Application-wide view of the persisted Yuvi design.
 * MongoDB remains authoritative; this context synchronizes every live Yuvi
 * immediately after a successful save without relying on browser storage.
 */
export function YubiDesignProvider({ children }: { children: ReactNode }) {
  const [design, setDesign] = useState<YubiDesign>(() => cloneDesign(DEFAULT_DESIGN))
  const [loaded, setLoaded] = useState(false)

  const applySavedDesign = useCallback((next: YubiDesign) => {
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
    <YubiDesignContext.Provider value={{ design, loaded, refresh, applySavedDesign }}>
      {children}
    </YubiDesignContext.Provider>
  )
}

export function useYubiDesign() {
  const value = useContext(YubiDesignContext)
  if (!value) throw new Error('useYubiDesign must be used inside YubiDesignProvider')
  return value
}
