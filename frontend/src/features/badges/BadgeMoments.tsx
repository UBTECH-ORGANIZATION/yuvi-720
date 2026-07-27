import { useEffect, useRef, useState } from 'react'
import { navigate } from '../../app/router'
import { useI18n } from '../../i18n/I18nProvider'
import { getBadges, updateLearnerState } from '../../services/api'
import { BadgeCelebration } from './BadgeCelebration'
import { ProgressToast } from '../../components/ProgressToast'
import { announceAvatarUpdated } from './ProfileAvatar'
import type { AvatarChoice, BadgeDTO } from './types'

/**
 * Watches the learner's badges around a lesson and fires the two moments:
 * a full-screen celebration when a badge is newly earned, and a progress toast
 * when a badge's ring moved forward. Drop it into any page that finishes tasks
 * and bump `trigger` once the brain has been updated.
 */

const COPY = {
  he: {
    eyebrow: 'הישג חדש!',
    subtitle: 'כל הכבוד — המטבע הזה שלך עכשיו!',
    use: 'השתמש/י בזה כתמונת הפרופיל',
    used: '✓ זו התמונה שלך עכשיו',
    dismiss: 'מגניב, תודה!',
    toastTitle: 'יפה, התקדמת!',
    toBadges: 'לעמוד ההישגים ←',
  },
  en: {
    eyebrow: 'New badge!',
    subtitle: 'Awesome — this badge is yours now!',
    use: 'Use as my profile picture',
    used: '✓ This is your picture now',
    dismiss: 'Cool, thanks!',
    toastTitle: 'Nice progress!',
    toBadges: 'See my badges →',
  },
} as const

const CATEGORY_RANK: Record<BadgeDTO['category'], number> = { world: 0, subject: 1, milestone: 2, coming: 3 }
const keyOf = (b: BadgeDTO) => `${b.subject}:${b.tier}:${b.title}`

export function BadgeMoments({ trigger }: { trigger: number }) {
  const { language } = useI18n()
  const t = COPY[language === 'en' ? 'en' : 'he']
  const snapshotRef = useRef<BadgeDTO[] | null>(null)
  const [celebration, setCelebration] = useState<BadgeDTO | null>(null)
  const [toast, setToast] = useState<{ badge: BadgeDTO; from: number } | null>(null)

  // Snapshot the starting state once, when the lesson opens.
  useEffect(() => {
    let alive = true
    getBadges(language).then((b) => { if (alive) snapshotRef.current = b }).catch(() => {})
    return () => { alive = false }
  }, [language])

  // On each completion, re-fetch after a short settle and diff against the snapshot.
  useEffect(() => {
    if (trigger === 0) return
    let alive = true
    const timer = window.setTimeout(async () => {
      try {
        const before = snapshotRef.current
        const after = await getBadges(language)
        snapshotRef.current = after
        if (!before || !alive) return
        const beforeMap = new Map(before.map((b) => [keyOf(b), b]))

        const newlyEarned = after
          .filter((b) => b.earned && !beforeMap.get(keyOf(b))?.earned)
          .sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category])
        if (newlyEarned.length) { setCelebration(newlyEarned[0]); return }

        const bumps = after
          .map((b) => {
            const prev = beforeMap.get(keyOf(b))
            return prev && !b.earned && b.progress > prev.progress ? { badge: b, from: prev.progress } : null
          })
          .filter((x): x is { badge: BadgeDTO; from: number } => x !== null)
          .sort((a, b) => b.badge.progress - b.from - (a.badge.progress - a.from))
        if (bumps.length) setToast(bumps[0])
      } catch {
        /* transient — no moment shown this time */
      }
    }, 1600)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [trigger, language])

  const useAsAvatar = async (b: BadgeDTO) => {
    const choice: AvatarChoice = { kind: 'badge', badge: { subject: b.subject, glyph: b.glyph, tier: b.tier } }
    try {
      await updateLearnerState({ avatar: choice })
      announceAvatarUpdated(choice)
    } catch { /* server validates; ignore */ }
  }

  return (
    <>
      {celebration && (
        <BadgeCelebration
          badge={{ ...celebration, subtitle: celebration.subtitle || t.subtitle }}
          onUseAsAvatar={useAsAvatar}
          onDismiss={() => setCelebration(null)}
          eyebrow={t.eyebrow}
          useLabel={t.use}
          usedLabel={t.used}
          dismissLabel={t.dismiss}
        />
      )}
      {toast && (
        <ProgressToast
          badge={toast.badge}
          fromProgress={toast.from}
          title={t.toastTitle}
          towardLabel={toast.badge.title}
          actionLabel={t.toBadges}
          onAction={() => { setToast(null); navigate('/badges') }}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  )
}
