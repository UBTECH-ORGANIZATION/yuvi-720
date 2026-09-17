import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiBeacon, apiGet, apiPatch, apiPost, UNAUTHORIZED_EVENT } from '../services/api'
import { setTelemetryUser } from '../services/telemetry'

/* The server closes a session after LRS_SESSION_IDLE_MINUTES (30) without a
   sign of life; five minutes leaves plenty of margin for a slow network. */
const SESSION_PING_MS = 5 * 60 * 1000

/* AuthProvider — the single source of "who is using the app".

   The session is an httpOnly cookie, so the client never holds a token; it only
   knows the resolved user from GET /api/auth/me. This provider must sit ABOVE
   ThemeProvider and BrainProvider: the theme comes from the user's stored
   preferences, and the learner id every surface reads is this user's id.

   The tree renders nothing until /me resolves. That boot gate is deliberate —
   it is what stops a flash of the wrong theme, and it guarantees no child ever
   observes an "unknown" identity. */

export type Theme = 'light' | 'dark' | 'system'

export interface UserPreferences {
  theme: Theme
  /** Epoch ms of the click that chose `theme` — lets ThemeProvider decide
      whether this or the browser's `sp_theme` cookie was written last. */
  theme_updated_at: number
  language: 'he' | 'en' | 'ar'
  reduced_motion: boolean
  /** Onboarding tours already finished or skipped, by slug. The server applies
      a PATCH of this field as a union, so sending `['teacher']` adds it rather
      than replacing the list. */
  tours_completed: string[]
  /** The class a teacher last looked at. A view preference, so it survives a
      reload; access is still re-checked server-side on every request. */
  teacher_group_id: string | null
  /** The rest of that scope, remembered the same way. Null means "not
      narrowed". A sub-group can be deleted between sessions, so a remembered id
      that no longer resolves must fall back to the whole class — never to an
      empty roster. */
  teacher_subgroup_id: string | null
  teacher_subject: string | null
  /** The stretch of time the dashboard is read over. Not part of the scope
      above: scope says WHO and applies portal-wide, this says over how long and
      applies to one screen. Typed loosely because the period vocabulary belongs
      to the dashboard (`home/periodModel`), which validates it on read. */
  teacher_period: string
  /** How a teacher reads their roster. Table by default — a card wall stops
      being scannable at about fifteen students. */
  teacher_roster_view: 'table' | 'cards'
  /** Visible roster columns, by key. Empty means "the defaults": a teacher who
      never opened the chooser has no opinion to freeze against future columns. */
  teacher_roster_columns: string[]
  /** Which edition of the class book was already unwrapped, per group id
      ({group_id: the edition's day, "YYYY-MM-DD"}). Server-side so the
      once-per-edition gift ceremony follows the TEACHER, not the browser. */
  teacher_book_seen: Record<string, string>
}

export interface AuthUser {
  user_id: string
  username: string
  display_name: string
  roles: string[]
  preferences: UserPreferences
}

interface MeResponse {
  authenticated: boolean
  user: AuthUser | null
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid_credentials')
    this.name = 'InvalidCredentialsError'
  }
}

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  isTeacher: boolean
  login: (username: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  updatePreferences: (partial: Partial<UserPreferences>) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    apiGet<MeResponse>('/api/auth/me')
      .then((data) => {
        if (active) setUser(data.authenticated ? data.user : null)
      })
      .catch(() => {
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Any 401 anywhere means the cookie expired or was cleared server-side.
  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  // Tie performance telemetry to the *internal* id and the role, and nothing
  // else. That is enough to ask "is it slow for one school, or for teachers
  // only, or for everyone" without any name, email or username ever reaching
  // Application Insights.
  useEffect(() => {
    const role = user?.roles?.includes('teacher') ? 'teacher' : user ? 'learner' : undefined
    setTelemetryUser(user?.user_id ?? null, role)
  }, [user?.user_id, user?.roles])

  // MoE 720 session suspend/resume: report focus loss/return while signed in.
  // sendBeacon so the suspend survives tab switches and page unloads; the
  // session itself rides the httpOnly cookie, so no payload is needed.
  //
  // One `suspend` per pause and one `resume` per return: `visibilitychange`
  // and `pagehide` both fire when a tab closes (and `pageshow` on a
  // back-forward restore), so the pair is tracked rather than the events.
  // While the tab is visible a ping every few minutes is the sign of life the
  // server's idle timeout counts on — without it a browser that was killed
  // and a child quietly reading look the same.
  useEffect(() => {
    if (!user) return
    let suspended = document.hidden
    const suspend = () => {
      if (suspended) return
      suspended = true
      apiBeacon('/api/auth/session/suspend')
    }
    const resume = () => {
      if (!suspended) return
      suspended = false
      apiBeacon('/api/auth/session/resume')
    }
    const onVisibility = () => (document.hidden ? suspend() : resume())
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resume()
    }
    const ping = () => {
      if (!document.hidden) apiBeacon('/api/auth/session/ping')
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', suspend)
    window.addEventListener('pageshow', onPageShow)
    const timer = window.setInterval(ping, SESSION_PING_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', suspend)
      window.removeEventListener('pageshow', onPageShow)
      window.clearInterval(timer)
    }
  }, [user])

  const login = useCallback(async (username: string, password: string) => {
    let data: MeResponse
    try {
      data = await apiPost<MeResponse>('/api/auth/login', { username, password })
    } catch {
      // The backend answers 401 for both unknown user and wrong password on
      // purpose, so the UI can only ever say "those details didn't match".
      throw new InvalidCredentialsError()
    }
    if (!data.user) throw new InvalidCredentialsError()
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    let redirectUrl: string | null = null
    try {
      const result = await apiPost<{ redirect_url?: string | null }>('/api/auth/logout', {})
      redirectUrl = result?.redirect_url ?? null
    } finally {
      setUser(null)
    }
    // A Ministry-provisioned account also has a session at the Ministry.
    // Dropping only our cookie would let the next click sign the same child
    // straight back in — on a shared classroom machine, the wrong child.
    if (redirectUrl) window.location.assign(redirectUrl)
  }, [])

  const updatePreferences = useCallback(async (partial: Partial<UserPreferences>) => {
    // Optimistic: preference toggles must feel instant. Revert if the write fails.
    let previous: AuthUser | null = null
    setUser((current) => {
      previous = current
      if (!current) return current
      const merged = { ...current.preferences, ...partial }
      // `tours_completed` is a union server-side, so mirror that locally — a
      // plain spread would briefly show the *only* tour just finished and drop
      // every earlier one, and anything reading it in that window (the tour
      // auto-start) would draw the wrong conclusion.
      if (partial.tours_completed) {
        merged.tours_completed = Array.from(new Set([
          ...(current.preferences.tours_completed ?? []),
          ...partial.tours_completed,
        ]))
      }
      return { ...current, preferences: merged }
    })
    try {
      const data = await apiPatch<{ preferences: UserPreferences }>('/api/auth/preferences', partial)
      setUser((current) => (current ? { ...current, preferences: data.preferences } : current))
    } catch (error) {
      setUser(previous)
      throw error
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isTeacher: Boolean(user?.roles.includes('teacher')),
      login,
      logout,
      updatePreferences
    }),
    [user, isLoading, login, logout, updatePreferences]
  )

  // Gate the tree on the session so no child renders against an unknown user.
  if (isLoading) return <div className="sp-auth-boot" aria-busy="true" />

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
