/* A schedule, as data rather than as a paragraph of dates.
 *
 * "What do I have next week" is the question prose is worst at answering. The
 * honest answer is eight dated things, and a sentence has to spell each date
 * out in words, in order, with no way to scan it: *"ב־20 באוגוסט יש מבחן
 * בשברים, ב־21 באוגוסט יש שיעור חזרה בשעה 9:00, ובהמשך יעדים ב־23, ב־25 וב־26"*.
 * That is a list pretending to be a sentence.
 *
 * So the model emits one small JSON object inside a ```yuvi-agenda fence and
 * this validates it — exactly the contract `diagram.ts` already lives by, and
 * for the same reason: the model describes, we render, and nothing
 * model-written is ever injected.
 *
 * Two things it deliberately does NOT let the model do:
 *
 *   **Write a date in words.** It emits `2026-08-20`; the day heading is
 *   formatted from that, in the reader's locale and calendar. A model writing
 *   "יום חמישי" next to the 20th is one arithmetic slip from a confident lie
 *   about which day something falls on, and the grounding rules already forbid
 *   it from doing arithmetic on tool output.
 *
 *   **Invent a kind.** The vocabulary is closed and shared with the calendar
 *   screen, so a test wears the same icon in the chat as it does on the board.
 *   Anything unrecognised falls back to a neutral event rather than rendering
 *   an empty slot.
 *
 * Anything that fails validation returns `null` and draws nothing: the
 * sentences around it still stand, which is the same trade the diagram makes.
 *
 * JSX-free so `node --test` can exercise the validator without a DOM.
 */

export const AGENDA_LANGUAGE = 'yuvi-agenda'

/** The seven things a calendar row can be — `school_calendar`'s four event
 *  kinds plus the three sources it aggregates. Same vocabulary the calendar
 *  screen draws icons from. */
export const AGENDA_KINDS = [
  'test', 'lesson', 'reminder', 'event', 'task', 'goal', 'meeting',
] as const

export type AgendaKind = typeof AGENDA_KINDS[number]

export interface AgendaItem {
  kind: AgendaKind
  title: string
  /** `HH:MM` in school time, or null for something that owns the whole day. */
  time: string | null
  /** Who it reaches, as free text or a `{{student:…}}` reference. */
  who: string | null
}

export interface AgendaDay {
  /** `YYYY-MM-DD`. The heading is formatted from this, never written. */
  date: string
  items: AgendaItem[]
}

export interface AgendaSpec {
  title: string | null
  days: AgendaDay[]
}

/* A fortnight of school, at most six things a day. Past that the answer is a
   calendar screen, not a chat message — and the prompt says so. */
const MAX_DAYS = 14
const MAX_ITEMS_PER_DAY = 6
const MAX_ITEMS = 30
const MAX_TITLE = 80
const MAX_WHO = 40
const MAX_AGENDA_TITLE = 60

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > limit ? collapsed.slice(0, limit) : collapsed
}

/** A real day, not just a well-shaped string. `2026-02-31` matches the pattern
 *  and is not a date; rendering it would produce an "Invalid Date" heading. */
function isRealDay(value: string): boolean {
  if (!DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function parseItem(raw: unknown): AgendaItem | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const title = cleanText(source.title, MAX_TITLE)
  if (!title) return null

  const kind = String(source.kind ?? '') as AgendaKind
  const time = cleanText(source.time, 5)
  return {
    kind: AGENDA_KINDS.includes(kind) ? kind : 'event',
    title,
    // A malformed time is dropped, never repaired: an item that reads as
    // all-day is a smaller error than one at a made-up hour.
    time: TIME.test(time) ? time : null,
    who: cleanText(source.who, MAX_WHO) || null,
  }
}

/** Validate a `yuvi-agenda` payload, or `null` if it cannot be trusted. */
export function parseAgendaSpec(source: string): AgendaSpec | null {
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const payload = raw as Record<string, unknown>
  if (!Array.isArray(payload.days)) return null

  const days: AgendaDay[] = []
  let total = 0
  for (const entry of payload.days) {
    if (days.length >= MAX_DAYS || total >= MAX_ITEMS) break
    if (!entry || typeof entry !== 'object') continue
    const day = entry as Record<string, unknown>
    const date = cleanText(day.date, 10)
    if (!isRealDay(date)) continue
    if (!Array.isArray(day.items)) continue

    const items: AgendaItem[] = []
    for (const rawItem of day.items) {
      if (items.length >= MAX_ITEMS_PER_DAY || total >= MAX_ITEMS) break
      const item = parseItem(rawItem)
      if (item) { items.push(item); total += 1 }
    }
    // A day with nothing on it is not worth a card. "Nothing on Wednesday" is
    // a sentence the model can write, and it reads better than an empty box.
    if (items.length) days.push({ date, items })
  }

  if (!days.length) return null
  // Chronological regardless of the order they arrived in: a schedule out of
  // order is worse than no schedule, and sorting it is free.
  days.sort((a, b) => a.date.localeCompare(b.date))
  return { title: cleanText(payload.title, MAX_AGENDA_TITLE) || null, days }
}
