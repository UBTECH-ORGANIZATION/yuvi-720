import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthProvider'

/* Theme follows the *person*, not the browser: it is stored on the user document
   and arrives with the session in GET /api/auth/me, so it survives a reload and
   moves between devices. (No localStorage — see the app-wide rule that learner
   state lives in the backend.)

   'system' is a real, persisted value, not the absence of a choice: it means
   "keep tracking prefers-color-scheme". */

export type Theme = 'light' | 'dark'
export type ThemePreference = Theme | 'system'

interface ThemeContextValue {
  theme: Theme
  preference: ThemePreference
  toggleTheme: () => void
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, updatePreferences } = useAuth()
  // AuthProvider gates the tree on /me, so the stored preference is already
  // known on the very first render — no intermediate paint in the wrong theme.
  const stored = user?.preferences.theme ?? 'system'
  const [preference, setPreferenceState] = useState<ThemePreference>(stored)
  const [systemValue, setSystemValue] = useState<Theme>(systemTheme)

  // A different user signing in adopts their own theme.
  useEffect(() => {
    setPreferenceState(stored)
  }, [stored])

  const theme: Theme = preference === 'system' ? systemValue : preference

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemValue(event.matches ? 'dark' : 'light')
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next)
    // Fire-and-forget: AuthProvider already applied it optimistically and
    // reverts its own copy on failure. A failed write must never block the UI.
    if (user) void updatePreferences({ theme: next }).catch(() => undefined)
  }

  const toggleTheme = () => setPreference(theme === 'light' ? 'dark' : 'light')

  return (
    <ThemeContext.Provider value={{ theme, preference, toggleTheme, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
