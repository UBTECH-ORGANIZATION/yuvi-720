/* Transport for every backend call.

   The session lives in an httpOnly cookie, so every request must be credentialed
   — there is no token for JS to attach (and localStorage is off-limits in this
   app; learner state belongs in the backend).

   A 401 is broadcast as a window event rather than handled here: the transport
   must not know about routing. AuthProvider listens and clears the session. */

export const UNAUTHORIZED_EVENT = 'spark:unauthorized'

export class UnauthorizedError extends Error {
  constructor(path: string) {
    super(`${path} requires authentication`)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(path: string) {
    super(`${path} is not permitted for this account`)
    this.name = 'ForbiddenError'
  }
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    method,
    credentials: 'include',
    headers: body === undefined
      ? init?.headers
      : { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    throw new UnauthorizedError(path)
  }
  if (response.status === 403) throw new ForbiddenError(path)
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}`)
  return response.json() as Promise<T>
}

export function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>('GET', path, undefined, init)
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>('POST', path, body)
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>('PATCH', path, body)
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>('DELETE', path)
}

export interface LearnerState {
  learner_id: string
  language?: 'he' | 'en' | 'ar'
  theme?: 'light' | 'dark'
  mapping_results?: unknown
  mapping_progress?: unknown
  profile_summary_progress?: unknown
  profile_cache?: unknown
  dashboard_cache?: unknown
  game_progress?: Record<string, unknown>
  avatar?: unknown
  avatar_unlocks?: string[]
  activeness_map?: {
    positions?: Record<string, number>
    focus?: string | null
    goal?: { domain: string; behavior: string; context: string; text: string; id?: string } | null
  } | null
}

export function getLearnerState(signal?: AbortSignal) {
  return apiGet<LearnerState>('/api/learner-state', signal ? { signal } : undefined)
}

export function updateLearnerState(updates: Partial<LearnerState>) {
  return apiPatch<LearnerState>('/api/learner-state', updates)
}

export async function streamPost(
  path: string,
  body: unknown,
  onText: (chunk: string) => void
): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    throw new UnauthorizedError(path)
  }
  if (!response.ok || !response.body) throw new Error(`POST ${path} stream failed`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') return
      try {
        const parsed = JSON.parse(payload) as { text?: string }
        if (parsed.text) onText(parsed.text)
      } catch {
        continue
      }
    }
  }
}