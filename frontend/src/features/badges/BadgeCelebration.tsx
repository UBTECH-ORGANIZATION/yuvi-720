import { useMemo, useState } from 'react'
import { Badge } from '../../components/Badge'
import type { BadgeDTO } from './types'
import '../../styles/badge-celebration.css'

/**
 * The earn moment — a cinematic banner (badge left, story + actions right) shown
 * as a modal the instant a badge flips to earned. Layout ported from the badge
 * design artifact's `.cine`, dressed in Yuvi's purple→cyan brand.
 *
 * Two actions, per product: adopt the coin as the profile picture, or dismiss.
 */

const CONFETTI_COLORS = ['#6f5bff', '#9f7afe', '#4cc9f0', '#4cc9f0', '#f3c96a', '#67d7a6']

export interface BadgeCelebrationProps {
  badge: BadgeDTO
  /** persist this badge as the profile avatar (`learner_state.avatar`). */
  onUseAsAvatar: (badge: BadgeDTO) => void
  onDismiss: () => void
  /** already the chosen avatar → the primary button reads as done. */
  used?: boolean
  eyebrow?: string
  useLabel?: string
  usedLabel?: string
  dismissLabel?: string
}

export function BadgeCelebration({
  badge,
  onUseAsAvatar,
  onDismiss,
  used = false,
  eyebrow = 'הישג חדש!',
  useLabel = 'השתמש/י בזה כתמונת הפרופיל',
  usedLabel = '✓ זו התמונה שלך עכשיו',
  dismissLabel = 'מגניב, תודה!',
}: BadgeCelebrationProps) {
  const [isUsed, setIsUsed] = useState(used)

  // Bigger confetti burst for the rarer capstone (world) badge.
  const pieceCount = badge.subject === 'world' ? 40 : 24
  const pieces = useMemo(
    () =>
      Array.from({ length: pieceCount }, (_, i) => ({
        left: `${4 + Math.random() * 92}%`,
        background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        duration: `${2.4 + Math.random() * 2}s`,
        delay: `${Math.random() * 0.7}s`,
      })),
    [pieceCount],
  )

  const handleUse = () => {
    if (isUsed) return
    setIsUsed(true)
    onUseAsAvatar(badge)
  }

  return (
    <div className="badge-cine-overlay" role="dialog" aria-modal="true" aria-labelledby="badge-cine-title">
      <div className="badge-cine">
        <div className="badge-cine__confetti" aria-hidden>
          {pieces.map((p, i) => (
            <i key={i} style={{ left: p.left, background: p.background, animationDuration: p.duration, animationDelay: p.delay }} />
          ))}
        </div>

        <div className="badge-cine__badge">
          <Badge subject={badge.subject} glyph={badge.glyph} tier={badge.tier} state="earned" title={badge.title} motif={badge.motif} />
        </div>

        <div className="badge-cine__body">
          <div className="badge-cine__eyebrow">{eyebrow}</div>
          <h2 id="badge-cine-title">{badge.title}</h2>
          {badge.subtitle && <p className="badge-cine__sub">{badge.subtitle}</p>}
          {badge.meta && <div className="badge-cine__meta">{badge.meta}</div>}
          <div className="badge-cine__btns">
            <button
              type="button"
              className={`badge-cine__btn badge-cine__btn--primary${isUsed ? ' is-used' : ''}`}
              onClick={handleUse}
              disabled={isUsed}
            >
              {isUsed ? usedLabel : useLabel}
            </button>
            <button type="button" className="badge-cine__btn badge-cine__btn--ghost" onClick={onDismiss}>
              {dismissLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
