/* A sub-group, as faces.
 *
 * The gaps panel could say "1 of 2 students who attempted this are struggling
 * with it" and then offer a button to build them a task — without ever saying
 * WHO. The teacher knows their class by face and by name, so a count is the one
 * form of that sentence they cannot act on from memory; the answer was two
 * clicks away on another screen.
 *
 * Overlapping coins, then the names on hover/focus/tap. That ordering is
 * deliberate: the row is a scan target, and six full names inline would turn a
 * one-line sentence into a paragraph, but a face is recognised without reading.
 *
 * The rule from `group_analytics` travels with the ids and is kept here: this is
 * a *selection*, never a ranking. Faces appear in the order the sub-group
 * arrives (roster order), unnumbered, and no metric is shown beside any of them
 * — nothing on screen invites comparing one child to another.
 *
 * Built on `Tooltip` rather than a `title` attribute, because a `title` is
 * invisible to touch and to the keyboard, and "who is this about?" is exactly
 * the question the row exists to answer.
 */

import { Tooltip } from '../../../components/primitives'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import { StudentAvatar } from './StudentAvatar'

interface Props {
  /** The sub-group. Empty renders nothing at all — not an empty row of coins. */
  learnerIds: string[]
  /** Names the caller already resolved (the gaps panel has the snapshot's).
   *  Falls back to the teacher-wide roster, then to the inert id. */
  names?: Map<string, string | null>
  /** Accessible name for the trigger, e.g. "show who is in this sub-group". */
  label: string
  /** Heading above the names in the bubble, e.g. "Students in this sub-group". */
  heading?: string
  /** How many coins before the rest become a "+N". Kept small: the stack is a
   *  glance, and the bubble is where the full list lives. */
  max?: number
  size?: number
  className?: string
}

export function StudentFacepile({
  learnerIds, names, label, heading, max = 5, size = 24, className,
}: Props) {
  const { nameOf } = useTeacherRoster()
  if (!learnerIds.length) return null

  const nameFor = (learnerId: string) =>
    names?.get(learnerId) ?? nameOf(learnerId) ?? learnerId

  const shown = learnerIds.slice(0, max)

  return (
    <Tooltip
      label={label}
      className={['tch-facepile', className].filter(Boolean).join(' ')}
      trigger={
        <span className="tch-facepile__stack" style={{ '--face': `${size}px` } as never}>
          {shown.map((learnerId) => (
            <span key={learnerId} className="tch-facepile__face">
              <StudentAvatar learnerId={learnerId} name={nameFor(learnerId)} size={size} />
            </span>
          ))}
          {/* The TOTAL, not the remainder. "+11" beside five faces asks the
              teacher to add — and the number they actually want is how many
              children this row is about, which was the one number the stack
              never showed. Always drawn, even when every face fits, so the
              badge means the same thing every time it is read.

              `dir="ltr"` so the bidi algorithm cannot reorder the digits on a
              Hebrew row. */}
          <span
            className="tch-facepile__more"
            dir="ltr"
            title={label}
          >
            {learnerIds.length}
          </span>
        </span>
      }
    >
      {heading ? <strong className="tch-facepile__heading">{heading}</strong> : null}
      <ul className="tch-facepile__names">
        {learnerIds.map((learnerId) => (
          <li key={learnerId}>
            <StudentAvatar learnerId={learnerId} name={nameFor(learnerId)} size={20} />
            <span dir="auto">{nameFor(learnerId)}</span>
          </li>
        ))}
      </ul>
    </Tooltip>
  )
}
