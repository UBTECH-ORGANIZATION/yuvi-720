import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './AuthProvider'

/* One theme preference, two caches.

   A visitor can choose a theme on the landing screen (no user document yet) and
   again after signing in. Those used to be two disconnected states, so logging
   in silently discarded the landing choice. They are now the same preference
   held in two places, each carrying the epoch-ms stamp of the click that set it:

     - cookie `sp_theme` = "<value>|<stamp>"  (read by index.html before React)
     - user document `preferences.theme` + `preferences.theme_updated_at`

   Whichever was written LAST wins, regardless of where the choice was made, and
   the loser is brought up to date. (No localStorage — see the app-wide rule that
   learner state lives in the backend.)

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

const THEME_COOKIE = 'sp_theme'

interface StoredTheme {
  value: ThemePreference
  updatedAt: number
}

function readThemeCookie(): StoredTheme | null {
  // The stamp is optional so cookies written by an older build still parse —
  // they just date to 0 and therefore lose to any stored user preference.
  const match = document.cookie.match(/(?:^|;\s*)sp_theme=(light|dark|system)(?:\|(\d+))?/)
  if (!match) return null
  return { value: match[1] as ThemePreference, updatedAt: Number(match[2] ?? 0) }
}

function writeThemeCookie(value: ThemePreference, updatedAt: number): void {
  document.cookie = `${THEME_COOKIE}=${value}|${updatedAt}; path=/; max-age=31536000; SameSite=Lax`
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, updatePreferences } = useAuth()
  const [cookie, setCookie] = useState<StoredTheme | null>(readThemeCookie)

  const serverValue = (user?.preferences.theme as ThemePreference | undefined) ?? null
  const serverAt = user?.preferences.theme_updated_at ?? 0
  // Signed out there is only the cookie; signed in, the newer of the two wins.
  // Falling back to 'system' (not a fixed 'dark') means an untouched account
  // follows the device instead of overriding it.
  const cookieWins = Boolean(user) && cookie !== null && cookie.updatedAt > serverAt
  const winner: ThemePreference = !user
    ? cookie?.value ?? 'system'
    : cookieWins
      ? (cookie as StoredTheme).value
      : serverValue ?? cookie?.value ?? 'system'

  // AuthProvider gates the tree on /me, so the winning preference is already
  // known on the very first render — no intermediate paint in the wrong theme.
  const [preference, setPreferenceState] = useState<ThemePreference>(winner)
  const [systemValue, setSystemValue] = useState<Theme>(systemTheme)

  // A different user signing in adopts their own theme.
  useEffect(() => {
    setPreferenceState(winner)
  }, [winner])

  // Reconcile the two caches so the next boot — which paints from the cookie
  // before React exists — already agrees with the user document.
  const promotedStamp = useRef<number | null>(null)
  useEffect(() => {
    if (!user) return
    if (cookieWins) {
      const pending = cookie as StoredTheme
      if (promotedStamp.current === pending.updatedAt) return
      promotedStamp.current = pending.updatedAt
      void updatePreferences({ theme: pending.value, theme_updated_at: pending.updatedAt }).catch(
        () => undefined
      )
      return
    }
    if (cookie?.value === winner && cookie.updatedAt === serverAt) return
    writeThemeCookie(winner, serverAt)
    setCookie({ value: winner, updatedAt: serverAt })
  }, [user, cookie, cookieWins, winner, serverAt, updatePreferences])

  const theme: Theme = preference === 'system' ? systemValue : preference

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme
    // The preference is known synchronously (user document or cookie), so the
    // first applied theme is already the right one — uncloak the page and drop
    // the boot screen only after it is on the DOM, never in the wrong theme.
    root.classList.remove('theme-pending')
    document.getElementById('app-boot-screen')?.remove()
  }, [theme])

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemValue(event.matches ? 'dark' : 'light')
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  const setPreference = useCallback(
    (next: ThemePreference) => {
      const stamp = Date.now()
      setPreferenceState(next)
      // Always write the cookie, signed in or not: it is what paints the page on
      // the next load, and its stamp is what makes "last choice wins" decidable.
      writeThemeCookie(next, stamp)
      setCookie({ value: next, updatedAt: stamp })
      promotedStamp.current = stamp
      // Fire-and-forget: AuthProvider already applied it optimistically and
      // reverts its own copy on failure. A failed write must never block the UI.
      if (user) void updatePreferences({ theme: next, theme_updated_at: stamp }).catch(() => undefined)
    },
    [user, updatePreferences]
  )

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
