import type { CalendarItem } from '../../services/calendar'

const ISRAEL_TIMEZONE = 'Asia/Jerusalem'

export function itemLocalDate(item: Pick<CalendarItem, 'start_at' | 'all_day'>): string {
  if (item.all_day && /^\d{4}-\d{2}-\d{2}$/.test(item.start_at)) return item.start_at
  const value = new Date(item.start_at)
  if (Number.isNaN(value.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value)
}

export function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index))
}

export function weekBoundsForDate(value: string): [string, string] {
  const date = new Date(`${value}T12:00:00Z`)
  const start = shiftDate(value, -date.getUTCDay())
  return [start, shiftDate(start, 6)]
}

export function formatCalendarRange(start: string, end: string, language: string): string {
  const formatter = new Intl.DateTimeFormat(language, {
    timeZone: ISRAEL_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return `${formatter.format(new Date(`${start}T12:00:00Z`))} – ${formatter.format(new Date(`${end}T12:00:00Z`))}`
}

export function groupItemsByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const grouped = new Map<string, CalendarItem[]>()
  for (const item of items) {
    const key = itemLocalDate(item)
    if (!key) continue
    grouped.set(key, [...(grouped.get(key) || []), item])
  }
  return grouped
}

export function formatCalendarDay(value: string, language: string, long = false): string {
  return new Intl.DateTimeFormat(language, {
    timeZone: ISRAEL_TIMEZONE,
    weekday: long ? 'long' : 'short',
    day: 'numeric',
    month: long ? 'long' : 'short',
  }).format(new Date(`${value}T12:00:00Z`))
}

export function formatCalendarTime(value: string, language: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(language, {
    timeZone: ISRAEL_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}