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

export interface BookWeek {
  /** the edition's identity: its Sunday, "YYYY-MM-DD" */
  key: string
  /** what the cover is stamped with: "dd/mm-dd/mm" over the school days */
  label: string
  /** the window the pages are drawn from, [start, end) as epoch ms */
  start: number
  end: number
}

/* The book is a WEEKLY edition, and it looks BACKWARD: it tells the story of
   the week that finished, not the one in progress. A book about the current
   week would be half-written every time it was opened — Monday's edition
   holding one day of school — and its cover would promise a range that had
   not happened yet. So Sunday brings a closed, complete book about the week
   just gone, which is also when a teacher actually has room to look back.

   The window spans the whole calendar week (Sunday through Saturday) while
   the cover names the school days (Sunday→Friday): a child who practised on
   Saturday belongs in the book, and printing "22/08" on a cover for a class
   that meets Sunday to Friday would read as an error rather than as accuracy. */
export function bookWeek(now: Date = new Date()): BookWeek {
  const sunday = new Date(now)
  sunday.setHours(0, 0, 0, 0)
  sunday.setDate(sunday.getDate() - sunday.getDay() - 7)
  const friday = new Date(sunday)
  friday.setDate(sunday.getDate() + 5)
  const nextSunday = new Date(sunday)
  nextSunday.setDate(sunday.getDate() + 7)
  const two = (value: number) => String(value).padStart(2, '0')
  const label = (date: Date) => `${two(date.getDate())}/${two(date.getMonth() + 1)}`
  const key = `${sunday.getFullYear()}-${two(sunday.getMonth() + 1)}-${two(sunday.getDate())}`
  return {
    key,
    label: `${label(sunday)}-${label(friday)}`,
    start: sunday.getTime(),
    end: nextSunday.getTime(),
  }
}

/* Only what actually happened that week. The feed the dashboard fetches is a
   rolling 14-day window, which always CONTAINS the finished week but reaches
   past it on both sides — and a cover stamped with a date range has to be
   telling the truth about the pages behind it. An undated moment is dropped
   rather than assumed recent, for the same reason. */
export function momentsInWeek(moments: Moment[], week: BookWeek): Moment[] {
  return moments.filter((row) => {
    const at = Date.parse(row.at ?? '')
    return Number.isFinite(at) && at >= week.start && at < week.end
  })
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
