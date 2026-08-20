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
import { navigate, useRoute } from '../app/router'
import { Toast } from '../components/Toast'
import { Icon } from '../components/primitives'
import { useI18n } from '../i18n/I18nProvider'
import { subscribe } from '../services/realtime'
import {
  acknowledgeAlert, getLive, resolveAlert,
  type Presence, type TeacherAlert,
} from '../services/teacher'
import { useAuth } from './AuthProvider'
import { useTeacherRoster } from './TeacherRosterProvider'
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
  const { nameOf } = useTeacherRoster()
  const { t } = useI18n()
  const pathname = useRoute()

  const [presence, setPresence] = useState<Record<string, Presence>>({})
  const [alerts, setAlerts] = useState<TeacherAlert[]>([])
  const [isConnected, setIsConnected] = useState(false)
  /* A student wrote. The frame carries WHO, never the words — the toast names
     the child and opens their thread; reading anything goes through the
     screen's own membership-checked fetch. Held in a ref-free single slot: a
     second arrival replaces the first rather than stacking a column of toasts
     over the class. */
  const [messageFrom, setMessageFrom] = useState<string | null>(null)
  const onMessages = pathname.startsWith('/teacher/messages')
  // Read from the stream handler without re-subscribing on every navigation.
  const onMessagesRef = useRef(onMessages)
  useEffect(() => { onMessagesRef.current = onMessages }, [onMessages])

  /* A raised hand gets the same single-slot toast: name the child, take the
     teacher to the live class. NOT suppressed anywhere — a hand is the one
     signal that must interrupt, even over the table that also shows it. */
  const [handFrom, setHandFrom] = useState<string | null>(null)
  // Alert ids are DETERMINISTIC (a re-raised hand reuses the resolved doc's
  // id), so "have I seen this id" cannot decide the toast — it would announce
  // the first hand of the day and swallow every one after. What toasts is a
  // TRANSITION into `open`: the last status per id lives here, seeded from
  // every snapshot so a pre-existing hand never toasts on page load, and a
  // replayed open frame (same status) stays quiet.
  const alertStatusOf = useRef(new Map<string, string>())

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
        // Pre-existing alerts never toast — the toast announces an arrival,
        // not the standing state a teacher just loaded.
        for (const alert of snapshot.alerts ?? []) {
          alertStatusOf.current.set(alert._id, alert.status)
        }
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
          const alert = frame.alert as TeacherAlert
          const previous = alertStatusOf.current.get(alert._id)
          if (alert.kind === 'coach_handoff' && alert.status === 'open'
              && previous !== 'open') {
            setHandFrom(alert.learner_id)
          }
          alertStatusOf.current.set(alert._id, alert.status)
          applyAlert(alert)
        } else if (frame.type === 'presence') {
          const row = frame.presence as Presence
          setPresence((current) => ({ ...current, [row.learner_id]: row }))
        } else if (frame.type === 'direct_message' && frame.sender === 'learner') {
          // Suppressed on the messages screen itself: the thread the teacher
          // is looking at announces its own arrivals.
          if (!onMessagesRef.current) setMessageFrom(String(frame.learner_id || ''))
        } else if (frame.type === 'snapshot') {
          // A reconnect re-sends the snapshot. Merge rather than replace: the
          // alerts we already have may include ones acknowledged locally.
          const snapshot = frame as unknown as { alerts: TeacherAlert[]; presence: Presence[] }
          for (const alert of snapshot.alerts ?? []) {
            alertStatusOf.current.set(alert._id, alert.status)
          }
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

  /* The cross-container path. SSE frames only travel inside one worker's
     process, so on a scaled deployment a child served elsewhere would never
     reach this screen through the stream. The server's snapshot read merges
     the persisted rows all workers write, and this poll carries that merge
     here — per learner, the newer `last_seen_at` wins, so a fresh SSE frame
     is never clobbered by a slightly older poll. */
  useEffect(() => {
    if (!user || !isTeacher || !groupId) return
    const timer = window.setInterval(() => {
      getLive(groupId)
        .then((snapshot) => {
          setPresence((current) => {
            const next = { ...current }
            for (const row of snapshot.presence ?? []) {
              const held = next[row.learner_id]
              if (!held || (row.last_seen_at ?? '') >= (held.last_seen_at ?? '')) {
                next[row.learner_id] = row
              }
            }
            return next
          })
        })
        .catch(() => {})
    }, 20_000)
    return () => window.clearInterval(timer)
  }, [user, isTeacher, groupId])

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

  return (
    <TeacherLiveContext.Provider value={value}>
      {children}
      {messageFrom !== null && !onMessages && (
        <Toast
          icon={<Icon name="message" size={20} />}
          title={t('tch.msgToast.title', {
            name: nameOf(messageFrom) ?? t('tch.msgToast.someone') })}
          actionLabel={t('tch.msgToast.open')}
          onAction={() => {
            setMessageFrom(null)
            navigate(`/teacher/messages?student=${encodeURIComponent(messageFrom)}`)
          }}
          onDismiss={() => setMessageFrom(null)}
        />
      )}
      {handFrom !== null && (
        <Toast
          icon={<Icon name="hand" size={20} />}
          title={t('tch.handToast.title', {
            name: nameOf(handFrom) ?? t('tch.msgToast.someone') })}
          actionLabel={t('tch.handToast.open')}
          onAction={() => {
            setHandFrom(null)
            navigate('/teacher/students')
          }}
          onDismiss={() => setHandFrom(null)}
        />
      )}
    </TeacherLiveContext.Provider>
  )
}

export function useTeacherLive(): TeacherLiveValue {
  const value = useContext(TeacherLiveContext)
  if (!value) throw new Error('useTeacherLive must be used inside TeacherLiveProvider')
  return value
}
