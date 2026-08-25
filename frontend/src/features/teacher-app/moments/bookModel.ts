/* Which moments make the class book, and in what order (#450 v2).
 *
 * The book shows the week's TOP TEN. The rating ranks MOMENTS for selection —
 * the same job the server's `_trim` weights do — never students against each
 * other (MoE C5): a child appearing twice is two strong moments, not a scoreboard.
 *
 * The teacher asked for improvement to weigh most: a child climbing back up
 * (recovery, comeback, a personal best, effort held over weeks, a misconception
 * untangled) outranks a first success, which outranks a finished goal, which
 * outranks the sensitive-but-important feelings pages. Recency breaks ties, so
 * the book stays this week's book.
 */

import type { Moment } from '../../../services/teacher'

const RATING: Record<string, number> = {
  // the improvement family — the most important pages
  recovery: 100,
  comeback: 95,
  personal_best: 90,
  sustained_effort: 85,
  misconception_resolved: 80,
  // breakthroughs
  hard_question_cracked: 70,
  breakthrough: 65,
  first_mastery: 60,
  // finished goals
  goal_done: 55,
  // sensitive pages — in the book, but never crowding out the climbs
  feelings_journey: 40,
  wellbeing_shared: 35,
}

export const BOOK_SIZE = 10

/** Each kind has this many drawn picture plates (<kind>-1.jpg … <kind>-N.jpg). */
export const PLATE_VARIANTS = 6

/** The book's front cover has this many drawn artworks (cover-1 … cover-N). */
export const COVER_VARIANTS = 3

function hashString(key: string): number {
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash * 31) + key.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

/* Which plate each page wears. Same-kind pages get DISTINCT variants — walk
   the kind's occurrences in book order from a deterministic starting plate
   (hashed off the first occurrence), so a picture repeats only when one kind
   fills more than PLATE_VARIANTS pages. Keyed by page index, not moment
   identity: the book's order IS the assignment. */
export function platePlan(pages: Moment[]): number[] {
  const nextByKind = new Map<string, number>()
  return pages.map((moment) => {
    const start = nextByKind.get(moment.kind)
      ?? hashString(`${moment.learner_id ?? ''}|${moment.at ?? ''}`) % PLATE_VARIANTS
    nextByKind.set(moment.kind, start + 1)
    return (start % PLATE_VARIANTS) + 1
  })
}

/** The cover artwork — stable per class, so the book always looks like ITS book. */
export function coverVariant(groupName: string | null): number {
  return (hashString(groupName ?? '') % COVER_VARIANTS) + 1
}

/* The book is a WEEKLY edition: the school week it collects (Sunday→Friday),
   stamped on the cover so the teacher knows when the next book arrives, and
   keyed so the gift-wrapped first sight happens once per edition. */
export function bookWeek(now: Date = new Date()): { key: string; label: string } {
  const sunday = new Date(now)
  sunday.setHours(0, 0, 0, 0)
  sunday.setDate(sunday.getDate() - sunday.getDay())
  const friday = new Date(sunday)
  friday.setDate(sunday.getDate() + 5)
  const two = (value: number) => String(value).padStart(2, '0')
  const label = (date: Date) => `${two(date.getDate())}/${two(date.getMonth() + 1)}`
  const key = `${sunday.getFullYear()}-${two(sunday.getMonth() + 1)}-${two(sunday.getDate())}`
  return { key, label: `${label(sunday)}-${label(friday)}` }
}

export function topMoments(moments: Moment[], limit: number = BOOK_SIZE): Moment[] {
  return [...moments]
    .sort((a, b) => {
      const byRating = (RATING[b.kind] ?? 20) - (RATING[a.kind] ?? 20)
      if (byRating !== 0) return byRating
      return Date.parse(b.at ?? '') - Date.parse(a.at ?? '')
    })
    .slice(0, limit)
}

/* Where a flick is heading, from the velocity it is travelling at — Apple's
 * momentum projection (UIScrollView's exponential decay), used by the book's
 * floor turner to commit a fast gesture without waiting for it to travel the
 * full threshold.
 *
 * `velocity` is px/second; the result is the additional distance the gesture
 * would coast through if released now. The deceleration constant is the
 * SNAPPY one (0.99, ~99x velocity/s) rather than the scroll-like 0.998
 * (~499x): at 0.998 even a slow two-finger crawl projects past a page-turn
 * threshold, which would turn the gentle-scroll case into a hair trigger.
 */
export function project(velocity: number, deceleration: number = 0.99): number {
  return (velocity / 1000) * deceleration / (1 - deceleration)
}
