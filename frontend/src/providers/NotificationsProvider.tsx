/* The bell, for both roles.
 *
 * Mounted app-wide because a learner should get "your teacher set you a goal"
 * wherever they are, not only on the dashboard. New rows arrive over the
 * connection the page already holds — learners subscribe to their own `user:`
 * topic through the coach stream, so the bell costs no extra connection.
 *
 * Dismissal is optimistic with a short undo window. That is only safe because
 * the server soft-deletes: undo re-reads a row that still exists rather than
 * trying to recreate one that was destroyed.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { useRoute } from '../app/router'
import { subscribe } from '../services/realtime'
import {
  dismissAllNotifications, dismissNotifications, listNotifications,
  markAllNotificationsRead, markNotificationsRead,
  type AppNotification, type NotificationRole,
} from '../services/notifications'
import { useAuth } from './AuthProvider'

/** How long a dismissed row can be brought back before it leaves the panel. */
const UNDO_MS = 5000

interface NotificationsValue {
  notifications: AppNotification[]
  unread: number
  /** Which hat this bell is currently wearing. */
  role: NotificationRole
  /** Rows dismissed in this session, still recoverable. */
  pendingUndo: AppNotification[]
  isLoading: boolean
  markRead: (ids: string[]) => Promise<void>
  markAllRead: () => Promise<void>
  dismiss: (id: string) => Promise<void>
  undoDismiss: (id: string) => Promise<void>
  dismissAll: () => Promise<void>
  refresh: () => void
}

const NotificationsContext = createContext<NotificationsValue | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const pathname = useRoute()

  /* The portal names the hat. `gal` is a learner AND a teacher: standing in the
     teacher app, "your goal was approved — 12 sparks" is mail for the other
     half of his account, and a bell that mixes them makes both unreadable. The
     server re-checks the role against the session, so this is a view choice,
     never an access one. */
  const isTeacherPortal = pathname.startsWith('/teacher') || pathname.startsWith('/admin')
  const canTeach = Boolean(user?.roles?.some((role) => role === 'teacher' || role === 'admin'))
  const isLearner = Boolean(user?.roles?.includes('learner'))
  const role: NotificationRole =
    isTeacherPortal && canTeach ? 'teacher' : isLearner ? 'learner' : canTeach ? 'teacher' : 'learner' 
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [pendingUndo, setPendingUndo] = useState<AppNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const undoTimers = useRef(new Map<string, number>())

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    if (!user) {
      setNotifications([]); setUnread(0); setIsLoading(false)
      return
    }
    let active = true
    listNotifications(false, role)
      .then((result) => {
        if (!active) return
        setNotifications(result.notifications ?? [])
        setUnread(result.unread ?? 0)
      })
      .catch(() => {})
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [user, nonce, role])

  // Live arrivals. The learner's stream is the coach channel (which also carries
  // their `user:` topic); a teacher-only account has no such stream, so their
  // bell fills on load and on refresh — teacher-side notifications are not
  // time-critical the way an alert is.
  useEffect(() => {
    if (!user?.roles?.includes('learner')) return
    return subscribe('learner-triggers', () => '/api/agent/triggers/subscribe', (frame) => {
      if (frame.type !== 'notification') return
      const incoming = frame.notification as AppNotification
      // A live row addressed to the other hat belongs in the other bell.
      if ((incoming.recipient_role || 'learner') !== role) return
      setNotifications((current) =>
        current.some((row) => row._id === incoming._id) ? current : [incoming, ...current])
      setUnread((count) => count + 1)
    })
  }, [user, role])

  const markRead = useCallback(async (ids: string[]) => {
    setNotifications((current) => current.map((row) =>
      ids.includes(row._id) && !row.read_at
        ? { ...row, read_at: new Date().toISOString() } : row))
    const result = await markNotificationsRead(ids, role).catch(() => null)
    if (result) setUnread(result.unread)
  }, [role])

  const markAllRead = useCallback(async () => {
    setNotifications((current) => current.map((row) =>
      row.read_at ? row : { ...row, read_at: new Date().toISOString() }))
    setUnread(0)
    await markAllNotificationsRead(role).catch(() => {})
  }, [role])

  const dismiss = useCallback(async (id: string) => {
    const row = notifications.find((entry) => entry._id === id)
    setNotifications((current) => current.filter((entry) => entry._id !== id))
    if (row) {
      setPendingUndo((current) => [...current, row])
      const timer = window.setTimeout(() => {
        setPendingUndo((current) => current.filter((entry) => entry._id !== id))
        undoTimers.current.delete(id)
      }, UNDO_MS)
      undoTimers.current.set(id, timer)
    }
    const result = await dismissNotifications([id], role).catch(() => null)
    if (result) setUnread(result.unread)
  }, [notifications, role])

  const undoDismiss = useCallback(async (id: string) => {
    const timer = undoTimers.current.get(id)
    if (timer) { window.clearTimeout(timer); undoTimers.current.delete(id) }
    setPendingUndo((current) => current.filter((entry) => entry._id !== id))
    // The row was never destroyed — a plain refetch brings it back.
    refresh()
  }, [refresh])

  const dismissAll = useCallback(async () => {
    setNotifications([])
    setUnread(0)
    await dismissAllNotifications(role).catch(() => {})
  }, [role])

  useEffect(() => () => {
    undoTimers.current.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const value = useMemo<NotificationsValue>(() => ({
    notifications, unread, role, pendingUndo, isLoading,
    markRead, markAllRead, dismiss, undoDismiss, dismissAll, refresh,
  }), [notifications, unread, role, pendingUndo, isLoading,
       markRead, markAllRead, dismiss, undoDismiss, dismissAll, refresh])

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  )
}

export function useNotifications(): NotificationsValue {
  const value = useContext(NotificationsContext)
  if (!value) throw new Error('useNotifications must be used inside NotificationsProvider')
  return value
}
