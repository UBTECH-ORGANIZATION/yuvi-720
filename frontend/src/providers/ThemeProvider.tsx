import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { getLearnerState, updateLearnerState } from '../services/api'

export type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function timeoutSignal(ms: number) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    cancel: () => window.clearTimeout(timeoutId)
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(systemTheme)
  const [hasUserChoice, setHasUserChoice] = useState(false)
  const [loadedPreference, setLoadedPreference] = useState(false)

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme
    // Only uncloak once the saved theme has actually been applied to the DOM above,
    // so the app never becomes visible while still showing the wrong (OS-default) theme.
    if (loadedPreference) {
      root.classList.remove('theme-pending')
      document.getElementById('app-boot-screen')?.remove()
    }
  }, [theme, loadedPreference])

  useEffect(() => {
    // Resolve the saved preference (or time out) before the layout effect above
    // is allowed to uncloak the page.
    let active = true
    const timeout = timeoutSignal(2500)
    getLearnerState(timeout.signal)
      .then((state) => {
        if (!active) return
        if (state.theme === 'light' || state.theme === 'dark') {
          setHasUserChoice(true)
          setTheme(state.theme)
        }
      })
      .catch(() => {
        // Keep the system-preferred theme if the saved preference cannot be loaded.
      })
      .finally(() => {
        timeout.cancel()
        if (active) setLoadedPreference(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => {
      if (!hasUserChoice) setTheme(event.matches ? 'dark' : 'light')
    }
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [hasUserChoice])

  const toggleTheme = () => {
    setHasUserChoice(true)
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light'
      if (loadedPreference) void updateLearnerState({ theme: next })
      return next
    })
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}