/**
 * Everything the supporter needs to understand the fault, and nothing that identifies
 * the learner. No name, no username, no e-mail, no free text from the page: only the
 * route, the build, the device and how the app itself has been behaving.
 */

interface RecentError {
  at: string
  where: string
  kind: string
}

const MAX_RECENT = 8

const recentErrors: RecentError[] = []
const slowCalls: { at: string; path: string; ms: number }[] = []
const failedCalls: { at: string; path: string; status: number }[] = []
const correlationIds: string[] = []

let installed = false

function remember<T>(bucket: T[], entry: T): void {
  bucket.push(entry)
  if (bucket.length > MAX_RECENT) bucket.shift()
}

/** Strip query strings and ids so a route never leaks a learner identifier. */
export function safePath(input: string, origin?: string): string {
  const base =
    origin ?? (typeof window === 'undefined' ? 'https://spark.local' : window.location.origin)
  try {
    const url = new URL(input, base)
    return url.pathname.replace(/\/[0-9a-f]{8,}/gi, '/:id').replace(/\/\d{3,}/g, '/:id')
  } catch {
    return 'unknown'
  }
}

/**
 * Installs passive listeners once. Everything is kept in memory and only ever leaves
 * the browser inside an open support session the learner started.
 */
export function installContextProbes(): void {
  if (installed) return
  installed = true

  window.addEventListener('error', (event) => {
    remember(recentErrors, {
      at: new Date().toISOString(),
      where: safePath(window.location.pathname),
      kind: event.error instanceof Error ? event.error.name : 'error',
    })
  })

  window.addEventListener('unhandledrejection', () => {
    remember(recentErrors, {
      at: new Date().toISOString(),
      where: safePath(window.location.pathname),
      kind: 'unhandled_rejection',
    })
  })

  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const started = performance.now()
    const path = safePath(typeof input === 'string' ? input : (input as Request).url ?? '')
    try {
      const response = await originalFetch(input as RequestInfo, init)
      const ms = Math.round(performance.now() - started)
      if (ms > 2500) remember(slowCalls, { at: new Date().toISOString(), path, ms })
      if (!response.ok) {
        remember(failedCalls, { at: new Date().toISOString(), path, status: response.status })
      }
      const correlation = response.headers.get('x-correlation-id') ?? response.headers.get('request-id')
      if (correlation && !correlationIds.includes(correlation)) remember(correlationIds, correlation)
      return response
    } catch (error) {
      remember(failedCalls, { at: new Date().toISOString(), path, status: 0 })
      throw error
    }
  }
}

function connectionInfo(): { network: string; downlink: number | null; rtt: number | null } {
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number; rtt?: number }
    }
  ).connection
  return {
    network: connection?.effectiveType ?? 'unknown',
    downlink: connection?.downlink ?? null,
    rtt: connection?.rtt ?? null,
  }
}

export function collectSessionContext(language: string, appVersion: string): Record<string, unknown> {
  const connection = connectionInfo()
  return {
    route: safePath(window.location.pathname),
    app_version: appVersion,
    environment: window.location.hostname,
    browser: navigator.userAgent.slice(0, 180),
    os: navigator.platform,
    device: window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop',
    screen: `${window.innerWidth}x${window.innerHeight}`,
    language,
    network: connection.network,
    downlink_mbps: connection.downlink,
    rtt_ms: connection.rtt,
    // The service stores these as plain lines, so they are readable in the supporter's
    // panel without a renderer for every shape.
    recent_errors: recentErrors.map((error) => `${error.at} ${error.kind} @ ${error.where}`),
    slow_calls: [...slowCalls],
    failed_calls: [...failedCalls],
    correlation_ids: [...correlationIds],
    last_activity_at: new Date().toISOString(),
  }
}
