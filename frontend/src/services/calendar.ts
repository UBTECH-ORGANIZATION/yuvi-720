import { apiGet } from './api'

export type CalendarItemKind = 'task' | 'goal' | 'meeting' | 'event' | 'lesson'
export type CalendarItemStatus = 'upcoming' | 'overdue' | 'completed' | 'closed' | 'cancelled'
export type CalendarProximity = 'overdue' | 'today' | 'tomorrow' | 'this_week'

export interface CalendarItem {
  id: string
  kind: CalendarItemKind
  title: string
  subject: string | null
  teacher_name: string | null
  start_at: string
  end_at: string | null
  all_day: boolean
  status: CalendarItemStatus
  proximity: CalendarProximity | null
  action_route: string | null
}

export interface CalendarWeek {
  contract_version: 1
  timezone: 'Asia/Jerusalem'
  week_start: string
  week_end: string
  items: CalendarItem[]
}

export interface CalendarUpcoming {
  contract_version: 1
  timezone: 'Asia/Jerusalem'
  items: CalendarItem[]
  has_more: boolean
}

export function getCalendarWeek(week?: string, signal?: AbortSignal) {
  const query = week ? `?week=${encodeURIComponent(week)}` : ''
  return apiGet<CalendarWeek>(`/api/calendar${query}`, signal ? { signal } : undefined)
}

export function getCalendarUpcoming(signal?: AbortSignal) {
  return apiGet<CalendarUpcoming>('/api/calendar/upcoming?limit=30',
    signal ? { signal } : undefined)
}