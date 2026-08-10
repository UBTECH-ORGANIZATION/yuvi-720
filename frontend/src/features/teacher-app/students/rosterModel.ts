/* Roster rows: shaping, filtering, sorting.
 *
 * Pure and DOM-free so `node --test` can import it directly. The filtering rules
 * are the part of the roster a teacher will notice being wrong — "show me who
 * has not been here in a week" returning the wrong twelve children is a worse
 * failure than any styling bug — so they live here rather than inline in a
 * component, and they are tested.
 *
 * `statusOf` is deliberately defensive in the *cautious* direction: a row from
 * an older payload with no `status` downgrades to "flagged or unknown", never to
 * "progressing". A child who has never logged in must not be reported to their
 * teacher as active.
 */

export type RosterStatus = 'attention' | 'not_started' | 'active'
export type SortKey = 'name' | 'status' | 'lastActivity' | 'daysInactive'
export type PresenceFilter = 'all' | 'online' | 'offline'
export type StatusFilter = 'all' | RosterStatus

export interface RosterRow {
  learner_id: string
  name: string
  status: RosterStatus
  attentionKind: string | null
  attentionReason: string | null
  attentionEvidence: string | null
  lastActivityAt: string | null
  lastActivityLabel: string
  daysInactive: number | null
  isOnline: boolean
}

export interface RosterFilters {
  status: StatusFilter
  presence: PresenceFilter
  /** Minimum days without activity, or null for "any". */
  minDaysInactive: number | null
  query: string
}

export const NO_FILTERS: RosterFilters = {
  status: 'all', presence: 'all', minDaysInactive: null, query: '',
}

/** Thresholds the teacher can pick from. Coarse on purpose — the question is
 *  "has this child dropped off?", not "exactly how many days". */
export const INACTIVE_THRESHOLDS = [3, 7, 14] as const

interface SourceStudent {
  learner_id: string
  display_name?: string | null
  status?: string
  attention?: { kind?: string | null; reason?: string | null; evidence?: string | null } | null
  activity?: { last_event_at?: string | null; days_inactive?: number | null } | null
}

export function statusOf(row: { status?: string; attention?: unknown }): RosterStatus {
  const declared = row.status
  if (declared === 'attention' || declared === 'not_started' || declared === 'active') {
    return declared
  }
  return row.attention ? 'attention' : 'active'
}

export function toRosterRows(
  students: SourceStudent[],
  options: {
    isOnline: (learnerId: string) => boolean
    formatDate: (iso: string) => string
    neverLabel: string
  },
): RosterRow[] {
  return students.map((student) => {
    const lastActivityAt = student.activity?.last_event_at ?? null
    return {
      learner_id: student.learner_id,
      name: student.display_name ?? student.learner_id,
      status: statusOf(student),
      attentionKind: student.attention?.kind ?? null,
      attentionReason: student.attention?.reason ?? null,
      attentionEvidence: student.attention?.evidence ?? null,
      lastActivityAt,
      lastActivityLabel: lastActivityAt ? options.formatDate(lastActivityAt) : options.neverLabel,
      daysInactive: student.activity?.days_inactive ?? null,
      isOnline: options.isOnline(student.learner_id),
    }
  })
}

export function filterRows(rows: RosterRow[], filters: RosterFilters): RosterRow[] {
  const needle = filters.query.trim().toLowerCase()
  return rows.filter((row) => {
    if (filters.status !== 'all' && row.status !== filters.status) return false
    if (filters.presence === 'online' && !row.isOnline) return false
    if (filters.presence === 'offline' && row.isOnline) return false
    if (filters.minDaysInactive !== null) {
      // A learner with no activity at all has no `days_inactive` number, but
      // they are the most inactive person in the class — excluding them from
      // "inactive 7+ days" would hide exactly who the teacher is looking for.
      if (row.daysInactive === null) {
        if (row.lastActivityAt !== null) return false
      } else if (row.daysInactive < filters.minDaysInactive) {
        return false
      }
    }
    if (needle && !row.name.toLowerCase().includes(needle)) return false
    return true
  })
}

/** Attention first when sorting by status — the column exists to surface it. */
const STATUS_ORDER: Record<RosterStatus, number> = {
  attention: 0, not_started: 1, active: 2,
}

export function sortRows(
  rows: RosterRow[], key: SortKey, direction: 'asc' | 'desc',
): RosterRow[] {
  const sign = direction === 'asc' ? 1 : -1
  return rows.slice().sort((a, b) => {
    /* Missing values are ranked BEFORE the direction is applied, deliberately.
       Folding them into the comparison and then multiplying by the sign sends
       them to the top of the descending list, where a child with no recorded
       activity reads as the most recently active person in the class. Absence
       is not a low score; it belongs at the end either way. */
    const missing = missingRank(a, b, key)
    if (missing !== 0) return missing

    // Alphabetical is the tiebreak everywhere, so equal rows never shuffle
    // between renders and no column ever implies a hidden ranking.
    return compare(a, b, key) * sign || a.name.localeCompare(b.name)
  })
}

/** +1 / -1 when exactly one side has no value for this column, else 0. */
function missingRank(a: RosterRow, b: RosterRow, key: SortKey): number {
  const left = valueOf(a, key)
  const right = valueOf(b, key)
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return 0
}

function valueOf(row: RosterRow, key: SortKey): number | string | null {
  if (key === 'name') return row.name
  if (key === 'status') return STATUS_ORDER[row.status]
  if (key === 'daysInactive') return row.daysInactive
  return row.lastActivityAt ? Date.parse(row.lastActivityAt) : null
}

function compare(a: RosterRow, b: RosterRow, key: SortKey): number {
  if (key === 'name') return a.name.localeCompare(b.name)
  if (key === 'status') return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  if (key === 'daysInactive') return (a.daysInactive ?? 0) - (b.daysInactive ?? 0)
  // Most recent first reads as "ascending" for an activity column: the teacher
  // means "who is freshest", not "which timestamp is numerically smaller".
  return Date.parse(b.lastActivityAt ?? '') - Date.parse(a.lastActivityAt ?? '')
}

export function countByStatus(rows: RosterRow[]): Record<RosterStatus, number> {
  return {
    attention: rows.filter((row) => row.status === 'attention').length,
    not_started: rows.filter((row) => row.status === 'not_started').length,
    active: rows.filter((row) => row.status === 'active').length,
  }
}
