/* One initials avatar for every learner, on every teacher screen. */
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'

interface Props {
  learnerId: string
  /** The resolved display name, so the initial matches what the row shows. */
  name?: string | null
  /** Rendered pixel width. The coin and the letter both scale to it. */
  size?: number
  className?: string
}

export function StudentAvatar({ learnerId, name, size = 32, className }: Props) {
  const { nameOf, isLoading } = useTeacherRoster()
  const label = (name ?? nameOf(learnerId) ?? learnerId).trim()

  const classes = ['tch-avatar', className].filter(Boolean).join(' ')
  const style = { inlineSize: size, blockSize: size, fontSize: Math.round(size * 0.42) }

    if (!name && isLoading) {
    return (
      <span className={`${classes} tch-avatar--pending`} style={style}
            aria-hidden="true" data-pending="true" />
    )
  }

  return (
    <span className={classes} style={style} aria-hidden="true">
      {label.slice(0, 1)}
    </span>
  )
}
