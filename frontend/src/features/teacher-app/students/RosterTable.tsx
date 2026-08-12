/* The roster as columns.
 *
 * Cards were the only view, and they stop working at about fifteen students: a
 * teacher comparing "who has not been here in a week" against "who is flagged"
 * cannot hold twelve cards in their head, let alone thirty. Columns are what
 * that question actually wants.
 *
 * Two rules carry over from the card grid and are not negotiable here:
 *
 *   **Sorting is not ranking.** The default order is alphabetical, and it stays
 *   alphabetical unless the teacher asks otherwise. No column is a score, no row
 *   carries a position, and nothing in the markup implies a league table.
 *
 *   **Every status states its evidence.** The status cell is the pill plus the
 *   line underneath it that says what the pill is derived from — the same
 *   contract the card has. A bare "מתקדם/ת" with nothing behind it is the claim
 *   this product does not make.
 */

import { useMemo } from 'react'
import { navigate } from '../../../app/router'
import { Icon, StatusPill } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { PresenceDot, agoLabel } from '../live/LiveNow'
import { withFallback } from '../shared/EvidenceDisclosure'
import type { Presence } from '../../../services/teacher'
import type { RosterRow, RosterStatus, SortKey } from './rosterModel'
import { StudentAvatar } from '../shared/StudentAvatar'

/* Exactly what the group snapshot actually carries. A column the payload
   cannot fill is worse than no column: it reads as "no data for this child"
   when the truth is "this product does not measure that here". */
export const COLUMN_KEYS = [
  'name', 'status', 'subgroups', 'presence', 'lastActivity', 'daysInactive',
] as const
export type ColumnKey = (typeof COLUMN_KEYS)[number]

/** Name is not in here on purpose: a row with no name is not a row. */
export const OPTIONAL_COLUMNS: ColumnKey[] = [
  'status', 'subgroups', 'presence', 'lastActivity', 'daysInactive',
]

export const DEFAULT_COLUMNS: ColumnKey[] = [...COLUMN_KEYS]

/** Presence is live and reorders under the teacher's hands — not sortable. */
const SORTABLE: Partial<Record<ColumnKey, SortKey>> = {
  name: 'name',
  status: 'status',
  lastActivity: 'lastActivity',
  daysInactive: 'daysInactive',
}

type Translate = (key: string, params?: Record<string, string | number>) => string

interface Props {
  rows: RosterRow[]
  columns: ColumnKey[]
  presence: Record<string, Presence>
  sort: { key: SortKey; direction: 'asc' | 'desc' }
  onSort: (key: SortKey) => void
  /** Learner id → the named slices they belong to. A learner may be in several. */
  subgroupsOf?: Map<string, string[]>
}

/* No selection mode. Choosing who is in a sub-group used to turn this table
   into a checkbox grid, which replaced the status and last-seen columns with
   ticks — taking away the columns a teacher picks a group ON. That job moved
   into its own dialog, over the roster rather than instead of it. */
export function RosterTable({
  rows, columns, presence, sort, onSort, subgroupsOf,
}: Props) {
  const { t } = useI18n()
  const visible = useMemo(
    () => COLUMN_KEYS.filter((key) => columns.includes(key)),
    [columns]
  )

  return (
    <div className="tch-tableWrap tch-roster__tableWrap">
      <table className="tch-table tch-roster__table">
        <thead>
          <tr>
            {visible.map((key) => {
              const sortKey = SORTABLE[key]
              const active = sortKey && sort.key === sortKey
              return (
                <th key={key} scope="col" aria-sort={
                  active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                }>
                  {sortKey ? (
                    <button
                      type="button"
                      className="tch-roster__sort"
                      onClick={() => onSort(sortKey)}
                    >
                      {t(`tch.students.col.${key}`)}
                      <Icon
                        name={active && sort.direction === 'desc' ? 'chevronUp' : 'chevronLeft'}
                        size={12}
                        className={`tch-roster__sortIcon${active ? ' is-active' : ''}`}
                        aria-hidden
                      />
                    </button>
                  ) : t(`tch.students.col.${key}`)}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.learner_id}
              className={`tch-roster__row${row.status === 'attention' ? ' is-flagged' : ''}`}
              tabIndex={0}
              role="link"
              onClick={() => navigate(`/teacher/student/${row.learner_id}`)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                navigate(`/teacher/student/${row.learner_id}`)
              }}
            >
              {visible.map((key) => (
                <Cell
                  key={key}
                  column={key}
                  row={row}
                  presence={presence[row.learner_id]}
                  subgroups={subgroupsOf?.get(row.learner_id) ?? []}
                  t={t}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({
  column, row, presence, subgroups, t,
}: {
  column: ColumnKey
  row: RosterRow
  presence: Presence | undefined
  subgroups: string[]
  t: Translate
}) {
  if (column === 'name') {
    return (
      <td className="tch-roster__nameCell">
        <StudentAvatar learnerId={row.learner_id} name={row.name} size={26} />
        <strong dir="auto">{row.name}</strong>
      </td>
    )
  }

  if (column === 'status') {
    return (
      <td className="tch-roster__statusCell">
        <StatusPill tone={TONE[row.status]}>{statusLabel(row, t)}</StatusPill>
        {/* The pill never travels alone — this is what it is derived from. */}
        <span className="tch-roster__evidence" dir="auto">{statusEvidence(row, t)}</span>
      </td>
    )
  }

  if (column === 'subgroups') {
    return (
      <td className="tch-roster__subgroupCell">
        {subgroups.length ? subgroups.map((name) => (
          <span key={name} className="tch-roster__subgroupTag" dir="auto">{name}</span>
        )) : <span className="tch-roster__none">—</span>}
      </td>
    )
  }

  if (column === 'presence') {
    return (
      <td className="tch-roster__presenceCell">
        <PresenceDot presence={presence} />
        <span>{agoLabel(presence?.last_seen_at ?? null, t)}</span>
      </td>
    )
  }

  if (column === 'lastActivity') {
    return <td>{row.lastActivityLabel}</td>
  }

  return (
    <td className={row.daysInactive !== null && row.daysInactive >= 7 ? 'is-stale' : undefined}>
      {row.daysInactive === null ? '—' : row.daysInactive}
    </td>
  )
}

const TONE: Record<RosterStatus, 'strong' | 'steady' | 'neutral'> = {
  active: 'strong',
  attention: 'steady',
  not_started: 'neutral',
}

function statusLabel(row: RosterRow, t: (key: string) => string): string {
  if (row.status === 'attention' && row.attentionKind) {
    return withFallback(
      t(`tch.attention.kind.${row.attentionKind}`),
      `tch.attention.kind.${row.attentionKind}`,
      row.attentionReason ?? '',
    )
  }
  return t(row.status === 'not_started' ? 'tch.students.notStarted' : 'tch.students.active')
}

function statusEvidence(row: RosterRow, t: Translate): string {
  if (row.status === 'attention') return row.attentionEvidence || ''
  if (row.status === 'not_started') return t('tch.students.notStartedHint')
  const days = row.daysInactive
  return days === null ? t('tch.students.activeHint')
    : days <= 0 ? t('tch.students.activeHint.today')
      : t('tch.students.activeHint.days', { days })
}
