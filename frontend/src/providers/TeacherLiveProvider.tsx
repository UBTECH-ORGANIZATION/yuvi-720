/* The teacher's live state: presence per learner, open alerts, one connection.
 *
 * Opens with a snapshot so a fresh tab renders the whole board immediately —
 * "nothing is happening" and "nothing has happened since you connected" look
 * identical on an empty screen, and only one of them is true.
 *
 * The replay cursor lives in React state, never in localStorage (project rule,
 * and the right call anyway: a cursor from yesterday's session would replay a
 * day of alerts into a fresh morning). On reconnect the URL is rebuilt with
 * `?since=`, and because alert ids are deterministic the replay cannot produce
 * duplicates even if the cursor is stale.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { subscribe } from '../services/realtime'
import {
  acknowledgeAlert, getLive, resolveAlert,
  type Presence, type TeacherAlert,
} from '../services/teacher'
import { useAuth } from './AuthProvider'
import { useTeacherScope } from './TeacherScopeProvider'

interface TeacherLiveValue {
  presence: Record<string, Presence>
  alerts: TeacherAlert[]
  /** Open alerts, most severe first, then newest. */
  openAlerts: TeacherAlert[]
  isConnected: boolean
  acknowledge: (alertId: string) => Promise<void>
  resolve: (alertId: string) => Promise<void>
}

const TeacherLiveContext = createContext<TeacherLiveValue | null>(null)

const SEVERITY_RANK: Record<string, number> = { urgent: 0, attention: 1, info: 2 }

export function TeacherLiveProvider({ children }: { children: ReactNode }) {
  const { user, isTeacher } = useAuth()
  const { groupId } = useTeacherScope()

  const [presence, setPresence] = useState<Record<string, Presence>>({})
  const [alerts, setAlerts] = useState<TeacherAlert[]>([])
  const [isConnected, setIsConnected] = useState(false)

  // Held in a ref so the stream's URL builder can read the latest value without
  // the effect re-running (and so re-subscribing) on every alert.
  const cursorRef = useRef(0)

  const applyAlert = useCallback((incoming: TeacherAlert) => {
    cursorRef.current = Math.max(cursorRef.current, incoming.seq ?? 0)
    setAlerts((current) => {
      const index = current.findIndex((row) => row._id === incoming._id)
      if (index === -1) return [...current, incoming]
      const next = [...current]
      next[index] = incoming        // deterministic ids make this an upsert
      return next
    })
  }, [])

  useEffect(() => {
    if (!user || !isTeacher || !groupId) return
    let active = true
    setIsConnected(false)

    getLive(groupId)
      .then((snapshot) => {
        if (!active) return
        setAlerts(snapshot.alerts ?? [])
        setPresence(Object.fromEntries(
          (snapshot.presence ?? []).map((row) => [row.learner_id, row])
        ))
        cursorRef.current = snapshot.cursor ?? 0
        setIsConnected(true)
      })
      .catch(() => { if (active) setIsConnected(false) })

    const unsubscribe = subscribe(
      `teacher-live:${groupId}`,
      () => {
        const params = new URLSearchParams({ group_id: groupId })
        if (cursorRef.current) params.set('since', String(cursorRef.current))
        return `/api/teacher/stream?${params}`
      },
      (frame) => {
        if (!active) return
        if (frame.type === 'alert') {
          applyAlert(frame.alert as TeacherAlert)
        } else if (frame.type === 'presence') {
          const row = frame.presence as Presence
          setPresence((current) => ({ ...current, [row.learner_id]: row }))
        } else if (frame.type === 'snapshot') {
          // A reconnect re-sends the snapshot. Merge rather than replace: the
          // alerts we already have may include ones acknowledged locally.
          const snapshot = frame as unknown as { alerts: TeacherAlert[]; presence: Presence[] }
          ;(snapshot.alerts ?? []).forEach(applyAlert)
          setPresence((current) => ({
            ...current,
            ...Object.fromEntries((snapshot.presence ?? []).map((row) => [row.learner_id, row])),
          }))
          setIsConnected(true)
        }
      }
    )

    return () => { active = false; unsubscribe() }
  }, [user, isTeacher, groupId, applyAlert])

  const acknowledge = useCallback(async (alertId: string) => {
    // Optimistic: the teacher clicked "seen", and the row must stop shouting
    // immediately. The server frame arrives moments later and confirms it.
    setAlerts((current) => current.map((row) =>
      row._id === alertId ? { ...row, status: 'acknowledged' as const } : row))
    await acknowledgeAlert(alertId).catch(() => {})
  }, [])

  const resolve = useCallback(async (alertId: string) => {
    setAlerts((current) => current.map((row) =>
      row._id === alertId ? { ...row, status: 'resolved' as const } : row))
    await resolveAlert(alertId).catch(() => {})
  }, [])

  const value = useMemo<TeacherLiveValue>(() => ({
    presence,
    alerts,
    openAlerts: alerts
      .filter((row) => row.status !== 'resolved')
      .sort((a, b) =>
        (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
        || (b.seq ?? 0) - (a.seq ?? 0)),
    isConnected,
    acknowledge,
    resolve,
  }), [presence, alerts, isConnected, acknowledge, resolve])

  return <TeacherLiveContext.Provider value={value}>{children}</TeacherLiveContext.Provider>
}

export function useTeacherLive(): TeacherLiveValue {
  const value = useContext(TeacherLiveContext)
  if (!value) throw new Error('useTeacherLive must be used inside TeacherLiveProvider')
  return value
}
