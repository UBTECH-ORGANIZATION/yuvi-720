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

export const MAX_ATTACHMENTS = 3
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

export interface Attachment {
  blob_name: string
  content_type: string
  size: number
}

export async function uploadAttachment(file: File): Promise<Attachment> {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch('/api/support/attachments', {
    method: 'POST',
    credentials: 'include',
    body,
  })
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? 'attachment_failed')
  }
  return (await response.json()) as Attachment
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
  attachments: string[] = [],
): Promise<{ ticket: SupportTicket }> {
  return apiPost<{ ticket: SupportTicket }>('/api/support/tickets', {
    ...draft,
    context,
    attachments,
  })
}

export function listMyReports(): Promise<{ tickets: SupportTicket[] }> {
  return apiGet<{ tickets: SupportTicket[] }>('/api/support/tickets/mine')
}

export type ConversationStatus = 'open' | 'pending' | 'closed'

export interface SupportConversation {
  id: string
  teacher_id: string
  teacher_name: string
  subject: string
  status: ConversationStatus
  last_message_at: string
  last_message_preview: string
  message_count: number
  unread_admin: number
  unread_teacher: number
  linked_ticket_id: string | null
  created_at: string
}

export interface SupportMessage {
  id: string
  author_role: 'teacher' | 'admin'
  author_name: string
  body: string
  at: string
}

export function listConversations(): Promise<{
  conversations: SupportConversation[]
  next_cursor: string | null
  has_more: boolean
}> {
  return apiGet('/api/support/conversations')
}

export function openConversation(
  subject: string,
  message: string,
): Promise<{ conversation: SupportConversation }> {
  return apiPost('/api/support/conversations', { subject, message })
}

export function listConversationMessages(conversationId: string): Promise<{
  messages: SupportMessage[]
  next_cursor: string | null
  has_more: boolean
}> {
  return apiGet(`/api/support/conversations/${encodeURIComponent(conversationId)}/messages`)
}

export function sendConversationMessage(
  conversationId: string,
  body: string,
): Promise<{ message: SupportMessage }> {
  return apiPost(`/api/support/conversations/${encodeURIComponent(conversationId)}/messages`, {
    body,
  })
}
