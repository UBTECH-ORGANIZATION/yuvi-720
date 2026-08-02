/* The celebration column of the completion dialog: what this lesson earned.

   Reward news used to arrive as two floating moments that opened on top of the
   completion dialog — a full-screen badge celebration and a progress toast — so
   the learner had to dismiss a modal to get back to the modal underneath. Then
   it became a first "beat" the learner had to click past to reach the
   reflection. Now it is a column standing beside the reflection: the coin is
   celebrated and the reflection is answered in one view, with no step to
   dismiss and no second button competing for the same click.

   The column paints itself (gradient + rays + confetti), so when nothing moved
   it is not rendered at all — the dialog collapses to one column and the
   celebration never rings hollow. */

import { useEffect, useRef, useState } from 'react'
import { Badge } from '../../components/Badge'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { announceAvatarUpdated } from '../badges/ProfileAvatar'
import type { AvatarChoice, BadgeDTO } from '../badges/types'
import type { BadgeMoments, BadgeProgressed } from '../badges/useBadgeMoments'
import { updateLearnerState } from '../../services/api'
import './lesson-rewards.css'

// Bright on the deep violet panel — the old set was tuned for a light card and
// half of it disappeared against the gradient.
const CONFETTI_COLORS = ['#ffd166', '#4cc9f0', '#67d7a6', '#ff8fab', '#c4b5fd', '#ffffff']
const RING_R = 94
const RING_C = 2 * Math.PI * RING_R
const RING_MS = 1050

export function LessonRewards({ moments }: { moments: BadgeMoments }) {
  const { t } = useI18n()
  const hero = moments.earned[0] || null

  return (
    <div className="lesson-rewards">
      <span className="lesson-rewards__rays" aria-hidden />
      {hero && <Confetti big={hero.subject === 'world'} />}

      {hero
        ? <EarnedHero badge={hero} />
        : <ProgressLead count={moments.progressed.length} />}

      {moments.earned.slice(1).map((badge) => (
        <ExtraEarned key={`${badge.subject}:${badge.tier}:${badge.title}`} badge={badge} />
      ))}

      {moments.progressed.length > 0 && (
        <section className="lesson-rewards__progress">
          <h3>{t('learning.rewards.progressTitle')}</h3>
          <ul>
            {moments.progressed.slice(0, 3).map((row) => (
              <ProgressRow key={`${row.badge.subject}:${row.badge.tier}:${row.badge.title}`} row={row} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** Falls across the whole column, not one card inside it — this IS the moment. */
function Confetti({ big }: { big: boolean }) {
  const [pieces] = useState(() =>
    Array.from({ length: big ? 40 : 26 }, (_, i) => ({
      left: `${2 + Math.random() * 96}%`,
      background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      duration: `${2.4 + Math.random() * 2.2}s`,
      delay: `${Math.random() * 0.9}s`,
    })),
  )
  return (
    <div className="lesson-rewards__confetti" aria-hidden>
      {pieces.map((piece, i) => (
        <i
          key={i}
          style={{
            left: piece.left,
            background: piece.background,
            animationDuration: piece.duration,
            animationDelay: piece.delay,
          }}
        />
      ))}
    </div>
  )
}

/** The coin that flipped to earned — the headline of the column. */
function EarnedHero({ badge }: { badge: BadgeDTO }) {
  const { t } = useI18n()
  const [used, setUsed] = useState(false)

  const useAsAvatar = async () => {
    if (used) return
    setUsed(true)
    const choice: AvatarChoice = {
      kind: 'badge',
      badge: { subject: badge.subject, glyph: badge.glyph, tier: badge.tier },
    }
    try {
      await updateLearnerState({ avatar: choice })
      announceAvatarUpdated(choice)
    } catch {
      /* the server validates; a failed pick is not worth interrupting the moment */
    }
  }

  // `meta` is the subject · topic line. On a milestone coin it repeats the
  // title, and a card that says the same thing twice reads like a bug.
  const caption = badge.subtitle
    || (badge.meta && badge.meta !== badge.title ? badge.meta : '')
    || t('learning.rewards.earnedBody')

  return (
    <article className="lesson-rewards__hero">
      <div className="lesson-rewards__coin">
        <Badge
          subject={badge.subject}
          glyph={badge.glyph}
          tier={badge.tier}
          state="earned"
          title={badge.title}
          motif={badge.motif}
        />
      </div>
      <span className="lesson-rewards__eyebrow">{t('learning.rewards.earnedEyebrow')}</span>
      <h3>{badge.title}</h3>
      <p>{caption}</p>
      <button
        type="button"
        className={`lesson-rewards__avatar-btn${used ? ' is-used' : ''}`}
        onClick={useAsAvatar}
        disabled={used}
      >
        <Icon name={used ? 'check' : 'spark'} size={15} />
        {used ? t('learning.rewards.avatarDone') : t('learning.rewards.useAsAvatar')}
      </button>
    </article>
  )
}

/** Two coins at once is rare; the second gets a compact line, not a second stage. */
function ExtraEarned({ badge }: { badge: BadgeDTO }) {
  const { t } = useI18n()
  return (
    <div className="lesson-rewards__extra">
      <span className="lesson-rewards__row-coin" aria-hidden>
        <Badge subject={badge.subject} glyph={badge.glyph} tier={badge.tier} state="earned" noStars />
      </span>
      <span className="lesson-rewards__row-text">
        <strong>{badge.title}</strong>
        <span>{t('learning.rewards.earnedEyebrow')}</span>
      </span>
    </div>
  )
}

/** Nothing was won, but coins moved — the column still has real news to give. */
function ProgressLead({ count }: { count: number }) {
  const { t } = useI18n()
  return (
    <article className="lesson-rewards__hero lesson-rewards__hero--progress">
      <div className="lesson-rewards__lead-icon" aria-hidden><Icon name="spark" size={26} /></div>
      <span className="lesson-rewards__eyebrow">{t('learning.rewards.stepTitle')}</span>
      <h3>{t('learning.rewards.movedTitle', { count })}</h3>
      <p>{t('learning.rewards.movedBody')}</p>
    </article>
  )
}

/** A coin that moved but is not won yet — the ring animates the delta. */
function ProgressRow({ row }: { row: BadgeProgressed }) {
  const { t } = useI18n()
  const rootRef = useRef<HTMLLIElement | null>(null)
  const to = Math.max(0, Math.min(1, row.badge.progress))
  const from = Math.max(0, Math.min(to, row.from))
  const [nowPct, setNowPct] = useState(Math.round(from * 100))
  const deltaPct = Math.max(0, Math.round((to - from) * 100))

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || to <= from) {
      setNowPct(Math.round(to * 100))
      return
    }
    const ring = rootRef.current?.querySelector<SVGCircleElement>('.yv-badge__ring')
    ring?.animate(
      [{ strokeDashoffset: RING_C * (1 - from) }, { strokeDashoffset: RING_C * (1 - to) }],
      { duration: RING_MS, easing: 'cubic-bezier(0.4,0,0.2,1)', fill: 'forwards' },
    )
    let raf = 0
    let start: number | null = null
    const step = (ts: number) => {
      if (start === null) start = ts
      const p = Math.min((ts - start) / RING_MS, 1)
      setNowPct(Math.round((from + (to - from) * p) * 100))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [from, to])

  return (
    <li className="lesson-rewards__row" ref={rootRef}>
      <span className="lesson-rewards__row-coin" aria-hidden>
        <Badge
          subject={row.badge.subject}
          glyph={row.badge.glyph}
          tier={row.badge.tier}
          state="inprogress"
          progress={to}
          noStars
        />
      </span>
      <span className="lesson-rewards__row-text">
        <strong>{row.badge.title}</strong>
        <span>{row.badge.howToEarn || row.badge.meta || t('learning.rewards.progressBody')}</span>
      </span>
      <span className="lesson-rewards__row-delta">
        <b>+{deltaPct}%</b>
        <span>{t('learning.rewards.progressNow', { percent: nowPct })}</span>
      </span>
    </li>
  )
}
