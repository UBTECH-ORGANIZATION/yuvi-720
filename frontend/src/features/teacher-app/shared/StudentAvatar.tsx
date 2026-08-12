/* One avatar for every learner, on every teacher screen.
 *
 * There were eight of these — `.tch-studentCard__avatar` (38px, gradient),
 * `.tch-roster__avatar` (26px, flat), `.tch-tile__avatar` (28px),
 * `.tch-messages__avatar` (30px), `.tch-goalsPage__avatar` (30px, twice),
 * `.tch-student__avatar` (52px) and `.sd-chat-window__avatar` (42px, and not
 * even a circle) — each with its own `slice(0, 1)`. Six sizes, two fills, two
 * border radii, and a child who has earned a badge showed a grey letter on
 * every one of them.
 *
 * The badge system already solved this on the student profile. This makes that
 * the rule rather than the exception: the coin the learner chose is who they
 * are in this product, so it is who they are in the teacher's list too.
 *
 * The initial is not a placeholder — a learner who has chosen no badge must
 * render a letter, never an empty coin.
 */

import { Badge } from '../../../components/Badge'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import type { AvatarChoice } from '../../badges/types'

interface Props {
  learnerId: string
  /** The resolved display name, so the initial matches what the row shows. */
  name?: string | null
  /** Rendered pixel width. The coin and the letter both scale to it. */
  size?: number
  className?: string
  /** Pass an avatar the caller already has, skipping the roster lookup. */
  choice?: AvatarChoice | null
}

export function StudentAvatar({ learnerId, name, size = 32, className, choice }: Props) {
  const { avatarOf, nameOf } = useTeacherRoster()
  const active = choice ?? avatarOf(learnerId)
  const label = (name ?? nameOf(learnerId) ?? learnerId).trim()

  const classes = ['tch-avatar', className].filter(Boolean).join(' ')
  const style = { inlineSize: size, blockSize: size, fontSize: Math.round(size * 0.42) }

  if (active && active.kind === 'badge') {
    return (
      <span className={`${classes} tch-avatar--badge`} style={style} aria-hidden="true">
        <Badge
          subject={active.badge.subject}
          glyph={active.badge.glyph}
          tier={active.badge.tier}
          state="earned"
          size={size}
          mini
        />
      </span>
    )
  }

  return (
    <span className={classes} style={style} aria-hidden="true">
      {label.slice(0, 1)}
    </span>
  )
}
