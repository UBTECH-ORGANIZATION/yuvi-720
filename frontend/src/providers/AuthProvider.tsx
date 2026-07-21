import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiGet, apiPatch, apiPost, UNAUTHORIZED_EVENT } from '../services/api'

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
  language: 'he' | 'en' | 'ar'
  reduced_motion: boolean
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

  // MoE 720 session suspend/resume: report focus loss/return while signed in.
  // sendBeacon so the suspend survives tab switches and page unloads; the
  // session itself rides the httpOnly cookie, so no payload is needed.
  useEffect(() => {
    if (!user) return
    const beacon = (path: string) => {
      try {
        if (!navigator.sendBeacon(path)) void apiPost(path, {})
      } catch {
        void apiPost(path, {}).catch(() => undefined)
      }
    }
    const onVisibility = () => {
      beacon(document.hidden ? '/api/auth/session/suspend' : '/api/auth/session/resume')
    }
    const onPageHide = () => beacon('/api/auth/session/suspend')
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
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
    try {
      await apiPost('/api/auth/logout', {})
    } finally {
      setUser(null)
    }
  }, [])

  const updatePreferences = useCallback(async (partial: Partial<UserPreferences>) => {
    // Optimistic: preference toggles must feel instant. Revert if the write fails.
    let previous: AuthUser | null = null
    setUser((current) => {
      previous = current
      if (!current) return current
      return { ...current, preferences: { ...current.preferences, ...partial } }
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
