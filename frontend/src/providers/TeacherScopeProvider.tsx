/* Teacher scope — the class, the sub-group and the subject, shared app-wide.
 *
 * Lives in a provider rather than in each page because remounting a screen must
 * not reset what the teacher chose. The provider itself is mounted ABOVE the
 * route-keyed div (see App.tsx) so navigation does not remount it either.
 *
 * All three persist to the *user document*, never to localStorage (project
 * rule). That makes a choice survive a reload and a new tab, which is what a
 * teacher expects from "I am looking at this class" — and all three are view
 * preferences only: every teacher endpoint re-derives access from org scoping,
 * so a stale or crafted id here grants nothing.
 *
 * Because they persist, two things are load-bearing rather than tidy:
 *
 *   A remembered id can dangle. A sub-group can be deleted or emptied between
 *   sessions, and a class the teacher no longer has can still be in the
 *   document. A dangling narrowing must resolve to "everyone" — never to an
 *   empty roster, which reads as "this class has no students".
 *
 *   Sub-group ids are class-specific. Switching class clears the selection in
 *   the SAME commit as the class itself, not in an effect a frame later: the
 *   frame in between is exactly how the roster came to filter a new class by
 *   the old class's learner ids, showing zero rows and four zeroed KPIs with no
 *   way out but "Everyone".
 *
 * The subject is deliberately NOT cleared on a class change — it is a shared
 * vocabulary, and a teacher who teaches maths to two classes means it in both.
 * The reconcile below drops it if the new class has nothing in it.
 *
 * Which of the three a given screen actually honours is not decided here: see
 * `components/scope/scopeDimensions.ts`. This provider holds the scope; that
 * module says who may show a control for it.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import {
  getGroupSubjects, listGroups, listSubgroups, type Group, type Subgroup,
} from '../services/teacher'
import { useAuth } from './AuthProvider'

interface TeacherScopeValue {
  groups: Group[]
  groupId: string | null
  setGroupId: (id: string) => void
  group: Group | null
  /** Sub-groups of the selected class. Empty until the fetch lands. */
  subgroups: Subgroup[]
  subgroupId: string | null
  setSubgroupId: (id: string | null) => void
  subgroup: Subgroup | null
  /** Who the current narrowing means. Empty array = the whole class, so a
   *  screen must check `subgroupId`, not this length, before filtering. */
  subgroupLearnerIds: string[]
  /** Re-read the list after a sub-group is created, renamed or deleted.
   *  Pass the written row to make it visible IMMEDIATELY: selecting a just-
   *  created id against the pre-create list reads as dangling, and the
   *  reconcile would widen the selection away before the re-read lands. */
  refreshSubgroups: (written?: Subgroup) => void
  /** Subjects this class has material or history in. */
  subjects: string[]
  subject: string | null
  setSubject: (subject: string | null) => void
  isLoading: boolean
  /** Whether the two per-class lists have landed FOR THE CURRENT CLASS.
   *
   *  Not "are they empty": empty and not-yet-known look identical from the
   *  outside and mean opposite things. The scope bar needs the difference to
   *  hold a segment's width open while its list is in flight — three lists
   *  arriving separately is three widths, and each one shoved the whole nav
   *  sideways as it landed. */
  subgroupsReady: boolean
  subjectsReady: boolean
  error: boolean
}

const TeacherScopeContext = createContext<TeacherScopeValue | null>(null)

export function TeacherScopeProvider({ children }: { children: ReactNode }) {
  const { user, isTeacher, updatePreferences } = useAuth()
  const [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState<string | null>(null)

  const [subgroups, setSubgroups] = useState<Subgroup[]>([])
  const [subgroupId, setSubgroupId] = useState<string | null>(null)
  const [subjects, setSubjects] = useState<string[]>([])
  const [subject, setSubject] = useState<string | null>(null)

  /* Which class the two lists above describe. A reconcile that fires while
     these are still the previous class's answer would clear a perfectly good
     selection, so nothing is judged dangling until its list is known to be
     about the class in hand. */
  const [subgroupsFor, setSubgroupsFor] = useState<string | null>(null)
  const [subjectsFor, setSubjectsFor] = useState<string | null>(null)
  const [reloadSubgroups, setReloadSubgroups] = useState(0)

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  const remembered = user?.preferences?.teacher_group_id ?? null

  /* Seeded once per signed-in user rather than read reactively: `updatePreferences`
     is optimistic, so the document echoes back every write, and an effect that
     mirrored it would be a state loop dressed as a sync. */
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (!user || !isTeacher) { seededFor.current = null; return }
    if (seededFor.current === user.user_id) return
    seededFor.current = user.user_id
    setSubgroupId(user.preferences?.teacher_subgroup_id ?? null)
    setSubject(user.preferences?.teacher_subject ?? null)
  }, [user, isTeacher])

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

  /* One read of the sub-groups for the whole portal. The roster, task tracking,
     the calendar, the message rail and the launch dialog each used to fetch
     this for themselves and keep the selection in their own shape — five
     encodings of one fact, which is why switching class fixed the list on some
     screens and not the selection on any. */
  useEffect(() => {
    if (!groupId) { setSubgroups([]); setSubgroupsFor(null); return }
    let active = true
    setSubgroupsFor(null)
    listSubgroups(groupId)
      .then((response) => {
        if (!active) return
        setSubgroups(response.subgroups ?? [])
        setSubgroupsFor(groupId)
      })
      /* Silent: a class with no sub-groups and a class whose list failed to
         load both mean "cannot narrow right now". Leaving `subgroupsFor` null
         is what keeps the failure from being read as "your sub-group is gone". */
      .catch(() => { if (active) setSubgroups([]) })
    return () => { active = false }
  }, [groupId, reloadSubgroups])

  useEffect(() => {
    if (!groupId) { setSubjects([]); setSubjectsFor(null); return }
    let active = true
    setSubjectsFor(null)
    getGroupSubjects(groupId, user?.preferences?.language ?? 'he')
      .then((response) => {
        if (!active) return
        setSubjects(response.subjects ?? [])
        setSubjectsFor(groupId)
      })
      .catch(() => { if (active) setSubjects([]) })
    return () => { active = false }
  }, [groupId, user?.preferences?.language])

  /* ── the two reconciles ──────────────────────────────────────────────────
     Both only ever WIDEN the scope, and only against a list known to describe
     the current class. Nothing here can narrow a teacher's view behind their
     back, which is the property that makes running them automatically safe. */

  useEffect(() => {
    if (!groupId || !subgroupId || subgroupsFor !== groupId) return
    if (subgroups.some((row) => row.id === subgroupId)) return
    // Deleted, or belonged to a class this teacher no longer has. Persist the
    // widening too, or it dangles again on every future load.
    setSubgroupId(null)
    void updatePreferences({ teacher_subgroup_id: null }).catch(() => {})
  }, [groupId, subgroupId, subgroups, subgroupsFor, updatePreferences])

  useEffect(() => {
    if (!groupId || !subject || subjectsFor !== groupId) return
    if (subjects.includes(subject)) return
    // This class has no material and no history in it, so every screen it
    // touches would come back empty and correct.
    setSubject(null)
    void updatePreferences({ teacher_subject: null }).catch(() => {})
  }, [groupId, subject, subjects, subjectsFor, updatePreferences])

  /* Selecting is local-first: the UI switches on the next frame and the write
     is fire-and-forget, because a failed preference write must never block a
     teacher from looking at their own class. */
  const selectGroup = useCallback((id: string) => {
    setGroupId(id)
    /* In the same commit as the class, not in an effect after it — see the
       header. The list goes with the selection: a stale list would let the
       reconcile above match the new selection against the old class. */
    setSubgroupId(null)
    setSubgroups([])
    setSubgroupsFor(null)
    void updatePreferences({
      teacher_group_id: id, teacher_subgroup_id: null,
    }).catch(() => {})
  }, [updatePreferences])

  const selectSubgroup = useCallback((id: string | null) => {
    setSubgroupId(id)
    void updatePreferences({ teacher_subgroup_id: id }).catch(() => {})
  }, [updatePreferences])

  const selectSubject = useCallback((next: string | null) => {
    setSubject(next)
    void updatePreferences({ teacher_subject: next }).catch(() => {})
  }, [updatePreferences])

  const refreshSubgroups = useCallback((written?: Subgroup) => {
    /* The merge is what lets a caller select what it just created in the same
       breath: the row is in the list before the reconcile next looks. The
       re-read still happens — the server's copy wins over the optimistic one. */
    if (written) {
      setSubgroups((current) => [...current.filter((row) => row.id !== written.id), written]
        .sort((a, b) => a.name.localeCompare(b.name)))
    }
    setReloadSubgroups((n) => n + 1)
  }, [])

  const value = useMemo<TeacherScopeValue>(() => {
    const active = subgroups.find((row) => row.id === subgroupId) ?? null
    return {
      groups,
      groupId,
      setGroupId: selectGroup,
      group: groups.find((row) => row.id === groupId) ?? null,
      subgroups,
      subgroupId,
      setSubgroupId: selectSubgroup,
      subgroup: active,
      subgroupLearnerIds: active?.learner_ids ?? [],
      refreshSubgroups,
      /* The current subject is always offered, even before its list arrives or
         when the fetch failed. A control showing a segment that is not among
         its own options cannot be reasoned about — or cleared. */
      subjects: subject && !subjects.includes(subject)
        ? [...subjects, subject].sort()
        : subjects,
      subject,
      setSubject: selectSubject,
      isLoading,
      // `*For` holds the class its list describes, so this is "landed, and for
      // the class we are actually showing" rather than "landed at some point".
      subgroupsReady: !groupId || subgroupsFor === groupId,
      subjectsReady: !groupId || subjectsFor === groupId,
      error,
    }
  }, [groups, groupId, subgroups, subgroupId, subjects, subject, isLoading, error,
      subgroupsFor, subjectsFor,
      selectGroup, selectSubgroup, selectSubject, refreshSubgroups])

  return (
    <TeacherScopeContext.Provider value={value}>{children}</TeacherScopeContext.Provider>
  )
}

export function useTeacherScope(): TeacherScopeValue {
  const value = useContext(TeacherScopeContext)
  if (!value) throw new Error('useTeacherScope must be used inside TeacherScopeProvider')
  return value
}
