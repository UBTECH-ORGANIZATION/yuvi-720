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

export interface BookEdition {
  /** the edition's identity — the day it was made, "YYYY-MM-DD" */
  key: string
  /** what the cover is stamped with: "dd/mm-dd/mm", or one date for a day */
  label: string
  /** the window the pages are drawn from, [start, end) as epoch ms */
  start: number
  end: number
  /** how long the edition covers, in whole days */
  days: number
}

/* The book looks BACKWARD: it tells the story of the period that FINISHED, not
   the one in progress. A book about the current period would be half-written
   every time it was opened, and its cover would promise days that had not
   happened yet. So the pages are the period BEFORE the one the dashboard is
   reading — pick "week" and the book is last week's.

   Editions are day-aligned even though the numbers above them are not. The
   KPIs use raw trailing windows because that keeps both halves exactly equal
   and is the same length of time in every timezone; a book has a date range
   printed on its cover, so it has to start and end at midnights the teacher
   would recognise — and midnight here means the teacher's own, which is why
   this is computed on the client and not on the server.

   The key is the edition's identity — a new key is what re-wraps the gift.
   Rolling editions change content daily, so their key is the day they were
   made; the weekly edition changes content once a week, so its key is the
   week itself — a book that re-wrapped every morning while its pages stayed
   identical would be a ceremony about nothing. Either way, switching period
   does not re-wrap a book already opened. */
export function bookEdition(days: number, now: Date = new Date()): BookEdition {
  const span = Math.max(1, Math.round(days))
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)

  const two = (value: number) => String(value).padStart(2, '0')
  const stamp = (date: Date) => `${two(date.getDate())}/${two(date.getMonth() + 1)}`
  const dayKey = (date: Date) =>
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`

  let start: Date
  let end: Date
  let key: string
  if (span === 7) {
    /* "בשבוע שעבר" is a promise about the CALENDAR, and here the calendar is
       Israeli: weeks run Sunday to Saturday. So the weekly book is the last
       COMPLETED Sun–Sat week — on a Sunday morning it advances to the week
       that ended yesterday, and it holds that window all week long (Gal,
       2026-08-30). A rolling seven-day cut, one day newer every morning,
       matched the label on no day of the week but Sunday. */
    const weekStart = new Date(midnight)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    start = new Date(weekStart)
    start.setDate(start.getDate() - 7)
    end = weekStart
    key = dayKey(start)
  } else {
    // The current period is today plus the `span - 1` days before it; this
    // edition is the `span` days before that.
    start = new Date(midnight)
    start.setDate(start.getDate() - (2 * span - 1))
    end = new Date(midnight)
    end.setDate(end.getDate() - (span - 1))
    key = dayKey(midnight)
  }

  // The cover names the last day INSIDE the window, not the exclusive edge —
  // stamping the morning after as the closing date reads as an error.
  const lastDay = new Date(end)
  lastDay.setDate(lastDay.getDate() - 1)

  return {
    key,
    // A one-day edition is one date. "25/08-25/08" says the same thing twice
    // and reads as a broken range.
    label: span === 1 ? stamp(start) : `${stamp(start)}-${stamp(lastDay)}`,
    start: start.getTime(),
    end: end.getTime(),
    days: span,
  }
}

/* Only what actually happened in that edition. The feed is fetched with a day
   of headroom on each side — the server's window is a raw trailing one and this
   one is day-aligned to the teacher's clock — so it always CONTAINS the edition
   but reaches past it on both sides, and a cover stamped with a date range has
   to be telling the truth about the pages behind it. An undated moment is
   dropped rather than assumed recent, for the same reason. */
export function momentsInEdition(moments: Moment[], edition: BookEdition): Moment[] {
  return moments.filter((row) => {
    const at = Date.parse(row.at ?? '')
    return Number.isFinite(at) && at >= edition.start && at < edition.end
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
