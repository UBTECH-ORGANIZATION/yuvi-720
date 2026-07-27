import type { BadgeGlyph, BadgeMotif, BadgeState, BadgeTier } from '../../components/Badge'

/**
 * Wire shape of a badge from `GET /api/badges` — a projection of the brain
 * (backend `app/services/badges.py`). The frontend only renders it.
 */
export interface BadgeDTO {
  /** subject family key (`science`, `math`, `world`, `spark`, …). */
  subject: string
  glyph: BadgeGlyph
  tier: BadgeTier
  state: BadgeState
  /** 0..1 ring fill for in-progress badges. */
  progress: number
  /** badge display name (e.g. "חוקר/ת מעבדה"). */
  title: string
  /** one-line "what it means / what you did". */
  subtitle?: string
  /** subject · topic line for the meta chip. */
  meta?: string
  /** objective titles this badge certifies (teacher evidence). */
  certifies?: string[]
  earned: boolean
  /** ISO date the badge was earned, when known. */
  earnedAt?: string | null
  /** grouping for the shelf. */
  category: 'subject' | 'milestone' | 'world' | 'coming'
  /** localized "how to win this badge". */
  howToEarn?: string
  /** milestone coins carry no star tier. */
  noStars?: boolean
  /** decorative background pattern behind the glyph. */
  motif?: BadgeMotif
}

/** The stored profile-avatar choice (`learner_state.avatar`). */
export type AvatarChoice =
  | { kind: 'initial' }
  | { kind: 'yuvi'; design?: unknown }
  | { kind: 'badge'; badge: Pick<BadgeDTO, 'subject' | 'glyph' | 'tier'> }
