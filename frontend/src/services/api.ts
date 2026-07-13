export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}`)
  return response.json() as Promise<T>
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`POST ${path} failed with ${response.status}`)
  return response.json() as Promise<T>
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`PATCH ${path} failed with ${response.status}`)
  return response.json() as Promise<T>
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: 'DELETE' })
  if (!response.ok) throw new Error(`DELETE ${path} failed with ${response.status}`)
  return response.json() as Promise<T>
}

export interface LearnerState {
  learner_id: string
  language?: 'he' | 'en' | 'ar'
  mapping_results?: unknown
  mapping_progress?: unknown
  profile_summary_progress?: unknown
  profile_cache?: unknown
  dashboard_cache?: unknown
  game_progress?: Record<string, unknown>
  avatar?: unknown
  avatar_unlocks?: string[]
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

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