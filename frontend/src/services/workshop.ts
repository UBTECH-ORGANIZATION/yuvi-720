/** Workshop API client.
 *
 * The build endpoint streams, and every event on it is optional — a turn may end
 * with a question instead of an artifact, and the model may say nothing useful
 * at all. So handlers are callbacks rather than a resolved value, and the caller
 * decides what silence means.
 */

export interface WorkshopProject {
  id: string
  title: string
  kind: 'game' | 'site' | 'lomda'
  objectiveId: string | null
  language: string
  status: string
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export interface WorkshopVersion {
  version: number
  summary: string
  request: string
  createdAt: string
  safetyCodes: string[]
}

export interface PlanStep {
  title: string
  achieved: string
}

export interface BuildHandlers {
  onDisclosure?: (text: string) => void
  onBlocked?: (text: string) => void
  onQuestion?: (question: string, options: string[]) => void
  onTitle?: (title: string) => void
  onPlan?: (steps: PlanStep[]) => void
  onCode?: (chunk: string) => void
  onReady?: (version: number, url: string, publishable: boolean) => void
  onCards?: (cards: { know?: string; challenge?: string }) => void
  onError?: (code: string) => void
  onDone?: () => void
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(String(response.status))
  return response.json() as Promise<T>
}

export async function listProjects(): Promise<WorkshopProject[]> {
  const response = await fetch('/api/workshop/projects', { credentials: 'include' })
  const data = await json<{ projects: WorkshopProject[] }>(response)
  return data.projects
}

export async function createProject(input: {
  title?: string
  kind?: string
  language: string
  objectiveId?: string | null
}): Promise<WorkshopProject> {
  const response = await fetch('/api/workshop/projects', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await json<{ project: WorkshopProject }>(response)
  return data.project
}

export async function getProject(projectId: string): Promise<{
  project: WorkshopProject
  versions: WorkshopVersion[]
}> {
  const response = await fetch(`/api/workshop/projects/${projectId}`, {
    credentials: 'include',
  })
  return json(response)
}

export async function deleteProject(projectId: string): Promise<void> {
  await fetch(`/api/workshop/projects/${projectId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
}

export async function restoreVersion(projectId: string, version: number): Promise<number> {
  const response = await fetch(
    `/api/workshop/projects/${projectId}/versions/${version}/restore`,
    { method: 'POST', credentials: 'include' },
  )
  const data = await json<{ version: number }>(response)
  return data.version
}

export function artifactUrl(projectId: string, version: number): string {
  return `/api/workshop/projects/${projectId}/versions/${version}/artifact`
}

/** Run one build turn. The returned function aborts it. */
export function streamBuild(
  projectId: string,
  body: {
    message: string
    language: string
    objectiveTitle?: string | null
    history?: { role: string; content: string }[]
  },
  handlers: BuildHandlers,
): () => void {
  const controller = new AbortController()

  void (async () => {
    try {
      const response = await fetch(`/api/workshop/projects/${projectId}/build`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        handlers.onError?.('request_failed')
        handlers.onDone?.()
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // An SSE frame ends at a blank line; anything before that is a partial
        // JSON payload and parsing it would throw on every large code chunk.
        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')

          const line = frame.split('\n').find((item) => item.startsWith('data: '))
          if (!line) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') {
            handlers.onDone?.()
            return
          }

          let event: Record<string, unknown>
          try {
            event = JSON.parse(payload)
          } catch {
            continue
          }

          if (typeof event.disclosure === 'string') handlers.onDisclosure?.(event.disclosure)
          if (typeof event.blocked === 'string') handlers.onBlocked?.(event.blocked)
          if (typeof event.title === 'string') handlers.onTitle?.(event.title)
          if (typeof event.code === 'string') handlers.onCode?.(event.code)
          if (typeof event.error === 'string') handlers.onError?.(event.error)
          if (typeof event.question === 'string') {
            handlers.onQuestion?.(event.question, (event.options as string[]) || [])
          }
          if (Array.isArray(event.plan)) handlers.onPlan?.(event.plan as PlanStep[])
          if (event.cards) handlers.onCards?.(event.cards as { know?: string; challenge?: string })
          if (event.ready) {
            const ready = event.ready as { version: number; url: string; publishable: boolean }
            handlers.onReady?.(ready.version, ready.url, ready.publishable)
          }
        }
      }
      handlers.onDone?.()
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') handlers.onError?.('stream_failed')
      handlers.onDone?.()
    }
  })()

  return () => controller.abort()
}
