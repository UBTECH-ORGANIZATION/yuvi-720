/* Coach stream client (F3). SSE from `/api/agent/coach/stream`: the first event
   carries the AI-use `disclosure`, then `text` chunks, then `[DONE]`. Reads/writes
   only through the backend — no `localStorage`. */

import { CURRENT_LEARNER_ID } from './xapi'

export interface CoachStreamHandlers {
  onDisclosure?: (text: string) => void
  onText: (chunk: string) => void
  signal?: AbortSignal
}

async function streamAgent(
  path: string,
  body: Record<string, unknown>,
  handlers: CoachStreamHandlers
): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })
  if (!response.ok || !response.body) throw new Error(`stream ${path} failed`)

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
        const parsed = JSON.parse(payload) as { text?: string; disclosure?: string }
        if (parsed.disclosure) handlers.onDisclosure?.(parsed.disclosure)
        if (parsed.text) handlers.onText(parsed.text)
      } catch {
        continue
      }
    }
  }
}

export function streamCoach(
  message: string,
  language: string,
  handlers: CoachStreamHandlers,
  learnerId: string = CURRENT_LEARNER_ID
): Promise<void> {
  return streamAgent('/api/agent/coach/stream', { learner_id: learnerId, message, language }, handlers)
}

export function streamProactive(
  trigger: string,
  language: string,
  handlers: CoachStreamHandlers,
  learnerId: string = CURRENT_LEARNER_ID
): Promise<void> {
  return streamAgent('/api/agent/coach/proactive', { learner_id: learnerId, trigger, language }, handlers)
}

export interface Trigger {
  type: 'idle' | 'misconception' | 'success' | '_heartbeat'
  objective_id?: string | null
  misconception?: string | null
}

/** Subscribe to proactive triggers via SSE (EventSource). Returns a closer. */
export function subscribeTriggers(
  onTrigger: (t: Trigger) => void,
  learnerId: string = CURRENT_LEARNER_ID
): () => void {
  const source = new EventSource(
    `/api/agent/triggers/subscribe?learner_id=${encodeURIComponent(learnerId)}`
  )
  source.onmessage = (e) => {
    try {
      const t = JSON.parse(e.data) as Trigger
      if (t.type && t.type !== '_heartbeat') onTrigger(t)
    } catch {
      /* ignore malformed */
    }
  }
  return () => source.close()
}

/** Report learner idle (absence isn't an event) so the trigger engine can nudge. */
export function reportIdle(objectiveId?: string, learnerId: string = CURRENT_LEARNER_ID): void {
  void fetch('/api/agent/triggers/idle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ learner_id: learnerId, objective_id: objectiveId }),
  }).catch(() => {})
}
