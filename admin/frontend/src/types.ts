export interface AdminIdentity {
  email: string
  name: string
}

export interface AuthStatus {
  authenticated: boolean
  admin: AdminIdentity | null
  oauth_configured: boolean
  public_access: boolean
}

export interface EnvironmentBadge {
  environment: string
  host: string
  database: string
  is_production: boolean
}

export interface UsageBucket {
  key: string
  requests: number
  completed: number
  failed: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  characters: number
  cost_usd: number | null
  unpriced_requests: number
  exact_usage_events?: number | null
}

export interface UsageEvent {
  event_id: string
  started_at: string
  actor_id: string
  actor_type: string
  endpoint: string
  feature: string
  operation: string
  provider: string
  deployment: string
  model_tier: string | null
  streaming: boolean
  meter: string
  status: string
  usage_status: string
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  total_tokens: number | null
  finish_reason: string | null
  stream_termination: string | null
  quantity: number | null
  cost_usd: number | null
  latency_ms: number
}

export interface PricingRate {
  pricing_id: string
  provider: string
  deployment: string
  display_name: string
  meter: string
  unit_size: number
  input_usd_per_unit: number | null
  cached_input_usd_per_unit: number | null
  output_usd_per_unit: number | null
  characters_usd_per_unit: number | null
  currency: string
  price_scope: string
  pricing_note: string | null
  source_url: string
  source_checked_at: string
  effective_from: string
}

export interface UsageSummary {
  access_mode: 'public_preview' | 'authenticated_admin'
  period: { days: number; start: string; end: string }
  filters: { actor_id: string | null; endpoint: string | null }
  totals: UsageBucket
  by_actor: UsageBucket[]
  by_endpoint: UsageBucket[]
  by_operation: UsageBucket[]
  by_deployment: UsageBucket[]
  by_feature: UsageBucket[]
  daily: UsageBucket[]
  recent: UsageEvent[]
  pricing: PricingRate[]
}

export interface UsageFilters {
  days: number
  actorId?: string
  endpoint?: string
}

export interface CoachDebugTraceStep {
  name: string
  status: 'ok' | 'skipped' | 'blocked' | 'error'
  source: 'system' | 'agent'
}

export interface CoachDebugTrace {
  created_at: string
  steps: CoachDebugTraceStep[]
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'meeting' | 'won' | 'lost'

export interface Lead {
  lead_id: string
  created_at: string | null
  updated_at: string | null
  status: LeadStatus
  notes: string
  full_name: string
  role: string
  organization: string
  city: string
  phone: string
  email: string
  grades: string
  message: string
  source: string
  updated_by: string | null
}

export interface LeadBoard {
  leads: Lead[]
  statuses: LeadStatus[]
  sources: string[]
  counts_by_status: Record<string, number>
  total: number
}

export interface LeadFilters {
  days?: number
  status?: LeadStatus
  source?: string
  search?: string
}

export type TicketStatus = 'new' | 'in_review' | 'in_progress' | 'resolved' | 'closed'
export type TicketSeverity = 'low' | 'normal' | 'high' | 'blocking'
export type TicketCategory = 'bug' | 'content' | 'access' | 'performance' | 'other'
export type TicketReporterType = 'learner' | 'teacher' | 'guest'

export interface SupportTicket {
  ticket_id: string
  created_at: string | null
  updated_at: string | null
  status: TicketStatus
  admin_notes: string
  updated_by: string | null
  source: 'in_app' | 'public'
  reporter_type: TicketReporterType
  reporter_id: string | null
  reporter_name: string
  contact_email: string
  category: TicketCategory
  severity: TicketSeverity
  title: string
  description: string
  context: Record<string, string>
  attachments: { blob_name?: string; content_type?: string; size?: number }[]
}

export interface SupportBoard {
  tickets: SupportTicket[]
  statuses: TicketStatus[]
  counts_by_status: Record<string, number>
  total: number
}

export interface SupportFilters {
  days?: number
  status?: TicketStatus
  category?: TicketCategory
  severity?: TicketSeverity
  reporterType?: TicketReporterType
  search?: string
}

export type ConversationStatus = 'open' | 'pending' | 'closed'

export interface SupportConversation {
  conversation_id: string
  teacher_id: string
  teacher_name: string
  subject: string
  status: ConversationStatus
  last_message_at: string | null
  last_message_preview: string
  message_count: number
  unread_admin: number
  unread_teacher: number
  linked_ticket_id: string | null
  created_at: string | null
}

export interface SupportMessage {
  message_id: string
  conversation_id: string
  author_role: 'teacher' | 'admin'
  author_name: string
  body: string
  at: string | null
}
