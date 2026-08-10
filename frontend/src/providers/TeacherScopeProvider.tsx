/* Teacher scope — the selected class, shared app-wide.
 *
 * Lives in a provider rather than in each page because remounting a screen must
 * not reset what the teacher chose. The provider itself is mounted ABOVE the
 * route-keyed div (see App.tsx) so navigation does not remount it either.
 *
 * The selected class is persisted to the *user document* (`teacher_group_id`),
 * never to localStorage (project rule). That makes it survive a reload and a
 * new tab, which is what a teacher expects from "I am looking at this class" —
 * and it is a view preference only: every teacher endpoint re-derives access
 * from org scoping, so a stale id grants nothing.
 *
 * The subject filter is retained as an API (pages still narrow by it) but has
 * no chrome any more: teachers said the dropdowns were noise, and a class
 * already implies its subject.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react'
import { listGroups, type Group } from '../services/teacher'
import { useAuth } from './AuthProvider'

/* Subjects come from the catalog the backend already exposes; kept as a small
   constant until a teacher-facing catalog endpoint exists, so the filter can
   ship with the screens rather than after them. */
const KNOWN_SUBJECTS = ['math', 'science'] as const

interface TeacherScopeValue {
  groups: Group[]
  groupId: string | null
  setGroupId: (id: string) => void
  group: Group | null
  subjects: string[]
  subject: string | null
  setSubject: (subject: string | null) => void
  isLoading: boolean
  error: boolean
}

const TeacherScopeContext = createContext<TeacherScopeValue | null>(null)

export function TeacherScopeProvider({ children }: { children: ReactNode }) {
  const { user, isTeacher, updatePreferences } = useAuth()
  const [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState<string | null>(null)
  const [subject, setSubject] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  const remembered = user?.preferences?.teacher_group_id ?? null

  useEffect(() => {
    if (!user || !isTeacher) {
      setGroups([]); setGroupId(null); setIsLoading(false)
      return
    }
    let active = true
    setIsLoading(true)
    setError(false)
    listGroups()
      .then((response) => {
        if (!active) return
        const rows = response.groups ?? []
        setGroups(rows)
        /* Precedence: whatever is already selected in this session, then the
           class the teacher was last looking at, then the first group so the
           app never renders unscoped. A remembered id that no longer resolves
           (the link was revoked, the group archived) falls through silently —
           it is a preference, not a claim. */
        setGroupId((current) => {
          if (current && rows.some((row) => row.id === current)) return current
          if (remembered && rows.some((row) => row.id === remembered)) return remembered
          return rows[0]?.id ?? null
        })
      })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [user, isTeacher, remembered])

  /* Selecting is local-first: the UI switches on the next frame and the write
     is fire-and-forget, because a failed preference write must never block a
     teacher from looking at their own class. */
  const selectGroup = useCallback((id: string) => {
    setGroupId(id)
    void updatePreferences({ teacher_group_id: id }).catch(() => {})
  }, [updatePreferences])

  const value = useMemo<TeacherScopeValue>(() => ({
    groups,
    groupId,
    setGroupId: selectGroup,
    group: groups.find((row) => row.id === groupId) ?? null,
    subjects: [...KNOWN_SUBJECTS],
    subject,
    setSubject,
    isLoading,
    error,
  }), [groups, groupId, subject, isLoading, error, selectGroup])

  return (
    <TeacherScopeContext.Provider value={value}>{children}</TeacherScopeContext.Provider>
  )
}

export function useTeacherScope(): TeacherScopeValue {
  const value = useContext(TeacherScopeContext)
  if (!value) throw new Error('useTeacherScope must be used inside TeacherScopeProvider')
  return value
}
