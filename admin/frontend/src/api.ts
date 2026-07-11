import type { AuthStatus, UsageFilters, UsageSummary } from './types'

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`API request failed with status ${status}`)
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...init.headers,
    },
  })
  if (!response.ok) throw new ApiError(response.status)
  return response.json() as Promise<T>
}

export function getAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  return apiFetch<AuthStatus>('/api/auth/status', { signal, cache: 'no-store' })
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new ApiError(response.status)
}

export function getUsageSummary(filters: UsageFilters, signal?: AbortSignal): Promise<UsageSummary> {
  const params = new URLSearchParams({ days: String(filters.days) })
  if (filters.actorId) params.set('actor_id', filters.actorId)
  if (filters.endpoint) params.set('endpoint', filters.endpoint)
  return apiFetch<UsageSummary>(`/api/ai-usage/summary?${params}`, {
    signal,
    cache: 'no-store',
  })
}
