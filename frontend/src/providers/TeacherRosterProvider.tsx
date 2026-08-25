/* Learner id → name, for every class this teacher teaches.
 *
 * The assistant is scoped to the *union* of a teacher's groups, so it can name a
 * child from any of them. Resolving names from the currently-selected group's
 * snapshot meant two failures the teacher actually saw: a message that read
 * "Tal" turned into `demo-tal` the moment they switched class, and a brand-new
 * answer about another class rendered as a raw id straight away.
 *
 * So the map is teacher-wide and fetched once, above the route key, rather than
 * per-screen and per-group. Mounted beside `TeacherScopeProvider` in
 * `TeacherShell` — it must not remount on navigation, or every screen change
 * would re-resolve every name in the chat history.
 *
 * A missing entry still means something real: a learner who never finished the
 * mapping flow has no `display_name` at all, and `labelFor` renders the inert id
 * rather than inventing one.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react'
import { getTeacherRoster, type RosterEntry } from '../services/teacher'
import type { AvatarChoice } from '../features/badges/types'
import { useAuth } from './AuthProvider'

interface TeacherRosterValue {
  students: RosterEntry[]
  /** The name, or null when this learner has none — never a guess. */
  nameOf: (learnerId: string) => string | null
  /** The learner's chosen avatar, or null when they have not picked one.
   *  Fetched with the roster so a badge coin costs no extra request per row. */
  avatarOf: (learnerId: string) => AvatarChoice | null
  /** For components that still take a Map (the band card, the album). */
  names: Map<string, string | null>
  isLoading: boolean
}

const TeacherRosterContext = createContext<TeacherRosterValue | null>(null)

export function TeacherRosterProvider({ children }: { children: ReactNode }) {
  const { user, isTeacher } = useAuth()
  const [students, setStudents] = useState<RosterEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user || !isTeacher) {
      setStudents([])
      setIsLoading(false)
      return
    }
    let active = true
    setIsLoading(true)
    getTeacherRoster()
      .then((response) => { if (active) setStudents(response.students ?? []) })
      // Names degrade to ids; every screen still works, so this is not an error
      // state worth showing a teacher.
      .catch(() => { if (active) setStudents([]) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [user, isTeacher])

  const names = useMemo(
    () => new Map(students.map((row) => [row.learner_id, row.display_name])),
    [students]
  )
  const nameOf = useCallback(
    (learnerId: string) => names.get(learnerId) ?? null, [names]
  )

  const avatars = useMemo(
    () => new Map(students.map((row) => [row.learner_id, row.avatar ?? null])),
    [students]
  )
  const avatarOf = useCallback(
    (learnerId: string) => avatars.get(learnerId) ?? null, [avatars]
  )

  const value = useMemo<TeacherRosterValue>(
    () => ({ students, names, nameOf, avatarOf, isLoading }),
    [students, names, nameOf, avatarOf, isLoading]
  )

  return (
    <TeacherRosterContext.Provider value={value}>{children}</TeacherRosterContext.Provider>
  )
}

export function useTeacherRoster(): TeacherRosterValue {
  const value = useContext(TeacherRosterContext)
  if (!value) throw new Error('useTeacherRoster must be used inside TeacherRosterProvider')
  return value
}

/** The roster when there is one, `null` when there is not — for the handful of
 *  components that render on BOTH sides of the app.
 *
 *  The notification bell is the case: it is the same component for a learner
 *  and a teacher, so it cannot require a teacher-only provider, but it still
 *  wants to turn "a learner id" into "Moti" when a teacher is the one reading. */
export function useOptionalTeacherRoster(): TeacherRosterValue | null {
  return useContext(TeacherRosterContext)
}
