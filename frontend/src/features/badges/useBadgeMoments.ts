import { useEffect, useRef, useState } from 'react'
import { getBadges } from '../../services/api'
import type { BadgeDTO } from './types'

/**
 * What the learner's badges did across one lesson.
 *
 * This used to be a pair of floating moments (`BadgeMoments`): a full-screen
 * celebration and a toast, both fired ~1.6s after a completion — which landed
 * ON TOP of the completion dialog that was already open, so the learner got two
 * competing modals and the badge news was buried behind the reflection.
 *
 * The diff is the same; only the delivery changed. The hook hands the numbers
 * to whoever wants to present them, and the completion dialog now opens on
 * them as its first step.
 */

export interface BadgeProgressed {
  badge: BadgeDTO
  /** ring fill BEFORE this lesson, so the ring can animate the delta. */
  from: number
}

export interface BadgeMoments {
  /** true until the post-completion re-fetch has settled. */
  checking: boolean
  /** the `trigger` this result belongs to; 0 = nothing checked yet.
   *
   * Without it a caller cannot tell "no badge moved" from "the diff has not run
   * yet", and the initial (empty) state races the completion: the dialog read
   * `empty` one commit before the check started and skipped its own reward step.
   */
  settledFor: number
  earned: BadgeDTO[]
  progressed: BadgeProgressed[]
  /** nothing changed — the step is skipped rather than shown empty. */
  empty: boolean
}

// A capstone (world) badge outranks a subject one, which outranks a milestone.
const CATEGORY_RANK: Record<BadgeDTO['category'], number> = { world: 0, subject: 1, milestone: 2, coming: 3 }
const keyOf = (badge: BadgeDTO) => `${badge.subject}:${badge.tier}:${badge.title}`
// The brain is written by the xAPI fold, which lands a moment after the client
// hears "completed"; re-reading immediately would diff against stale badges.
const SETTLE_MS = 1600

export function useBadgeMoments(trigger: number, language: string): BadgeMoments {
  const snapshotRef = useRef<BadgeDTO[] | null>(null)
  const [state, setState] = useState<BadgeMoments>({
    checking: false, settledFor: 0, earned: [], progressed: [], empty: true,
  })

  // Snapshot the starting shelf once, when the lesson opens.
  useEffect(() => {
    let alive = true
    getBadges(language)
      .then((badges) => { if (alive) snapshotRef.current = badges })
      .catch(() => { /* no snapshot → no diff, the step is simply skipped */ })
    return () => { alive = false }
  }, [language])

  useEffect(() => {
    if (trigger === 0) return
    let alive = true
    setState({ checking: true, settledFor: 0, earned: [], progressed: [], empty: true })
    const timer = window.setTimeout(async () => {
      try {
        const before = snapshotRef.current
        const after = await getBadges(language)
        if (!alive) return
        snapshotRef.current = after
        if (!before) {
          setState({ checking: false, settledFor: trigger, earned: [], progressed: [], empty: true })
          return
        }
        const beforeMap = new Map(before.map((badge) => [keyOf(badge), badge]))

        const earned = after
          .filter((badge) => badge.earned && !beforeMap.get(keyOf(badge))?.earned)
          .sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category])

        const progressed = after
          .map((badge) => {
            const prev = beforeMap.get(keyOf(badge))
            return prev && !badge.earned && badge.progress > prev.progress
              ? { badge, from: prev.progress }
              : null
          })
          .filter((row): row is BadgeProgressed => row !== null)
          // biggest move first — that is the one worth reading.
          .sort((a, b) => (b.badge.progress - b.from) - (a.badge.progress - a.from))

        setState({
          checking: false,
          settledFor: trigger,
          earned,
          progressed,
          empty: earned.length === 0 && progressed.length === 0,
        })
      } catch {
        if (alive) setState({ checking: false, settledFor: trigger, earned: [], progressed: [], empty: true })
      }
    }, SETTLE_MS)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [trigger, language])

  return state
}
