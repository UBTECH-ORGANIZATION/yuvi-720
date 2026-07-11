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
  total_tokens: number | null
  quantity: number | null
  cost_usd: number | null
  latency_ms: number
}

export interface UsageSummary {
  access_mode: 'public_preview' | 'authenticated_admin'
  period: { days: number; start: string; end: string }
  filters: { actor_id: string | null; endpoint: string | null }
  totals: UsageBucket
  by_actor: UsageBucket[]
  by_endpoint: UsageBucket[]
  by_operation: UsageBucket[]
  daily: UsageBucket[]
  recent: UsageEvent[]
}

export interface UsageFilters {
  days: number
  actorId?: string
  endpoint?: string
}
