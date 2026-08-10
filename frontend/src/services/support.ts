import { apiGet, apiPost } from './api'

export type TicketCategory = 'bug' | 'content' | 'access' | 'performance' | 'other'
export type TicketSeverity = 'low' | 'normal' | 'high' | 'blocking'
export type TicketStatus = 'new' | 'in_review' | 'in_progress' | 'resolved' | 'closed'

export interface SupportTicket {
  id: string
  category: TicketCategory
  severity: TicketSeverity
  title: string
  description: string
  status: TicketStatus
  created_at: string
  updated_at: string
}

export interface ReportContext {
  route: string
  user_agent: string
  viewport: string
  language: string
  theme: string
  occurred_at: string
}

export interface ReportDraft {
  title: string
  description: string
  category: TicketCategory
  severity: TicketSeverity
}

/** Technical context the console needs to reproduce a fault — never learner identity. */
export function collectReportContext(language: string, theme: string): ReportContext {
  return {
    route: window.location.pathname,
    user_agent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language,
    theme,
    occurred_at: new Date().toISOString(),
  }
}

export function submitReport(
  draft: ReportDraft,
  context: ReportContext,
): Promise<{ ticket: SupportTicket }> {
  return apiPost<{ ticket: SupportTicket }>('/api/support/tickets', { ...draft, context })
}

export function listMyReports(): Promise<{ tickets: SupportTicket[] }> {
  return apiGet<{ tickets: SupportTicket[] }>('/api/support/tickets/mine')
}
