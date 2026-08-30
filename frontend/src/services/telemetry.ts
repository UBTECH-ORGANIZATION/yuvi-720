/* Browser telemetry — Application Insights for the Spark web app.

   Why this exists: "the system is slow" is currently a sentence, not a number.
   Server-side monitoring can only ever prove the server was fast; it cannot see
   the 2.9MB bundle being parsed on a school laptop, the 3G-class uplink, or the
   moment the learner gives up. This module measures the browser, on the actual
   devices, and tags every measurement with what that device is capable of — so
   "it won't run in schools" becomes a query we can answer.

   Three deliberate constraints:

   1. The SDK is loaded with a *dynamic* import, after first paint, on idle. It
      must never enter the main chunk: making the page slower in order to
      measure how slow the page is would be self-defeating.
   2. Its configuration comes from the backend at runtime, not from a build-time
      env var — one image is promoted across dev/english/production slots.
   3. No personal data. Pseudonymous learner ids only, never a name, an email,
      a prompt or a model reply. Paths are stripped of ids before they are sent.
      (See the privacy rules in the project instructions.) */

import type { ApplicationInsights } from '@microsoft/applicationinsights-web'

interface BrowserTelemetryConfig {
  enabled: boolean
  connectionString: string | null
  roleName: string
  environment: string
  release: string
  samplingPercentage: number
}

let client: ApplicationInsights | null = null
let starting = false

/* Calls made before the SDK finishes loading are not lost — the first seconds
   of a session are precisely the slow part we care about. Bounded so a failed
   init can never grow without limit. */
type PendingEvent = { kind: 'metric'; name: string; value: number; props: Record<string, unknown> }
const pending: PendingEvent[] = []
const PENDING_LIMIT = 100

/** `/api/brain/9f3c…` → `/api/brain/{id}`; drops the query string entirely.
 *
 * Two reasons, and the privacy one is the important one: a raw path can carry a
 * learner id or a search term into telemetry, and a per-learner URL also makes
 * the metric useless — a thousand rows of one request each instead of one
 * endpoint you can take a p95 of. */
export function sanitizePath(path: string): string {
  const [withoutQuery] = path.split('?')
  return withoutQuery
    .split('/')
    .map((segment) => {
      if (!segment) return segment
      if (/^\d+$/.test(segment)) return '{id}'
      if (/^[0-9a-f]{8,}$/i.test(segment)) return '{id}'
      if (/^[0-9a-f-]{16,}$/i.test(segment)) return '{id}'
      return segment
    })
    .join('/')
}

/** What kind of machine is this, in one word we can group by.
 *
 * The whole question the client raised is whether the app is usable on school
 * hardware. A p95 across all devices cannot answer it; a p95 split by device
 * class can. */
function deviceClass(memory: number | undefined, cores: number | undefined): string {
  if (memory === undefined && cores === undefined) return 'unknown'
  if ((memory ?? 8) <= 4 || (cores ?? 8) <= 2) return 'low'
  if ((memory ?? 8) <= 8 || (cores ?? 8) <= 4) return 'mid'
  return 'high'
}

function deviceContext(): Record<string, unknown> {
  const nav = navigator as Navigator & {
    deviceMemory?: number
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean }
  }
  const connection = nav.connection
  return {
    'spark.deviceMemoryGB': nav.deviceMemory ?? null,
    'spark.cpuCores': nav.hardwareConcurrency ?? null,
    'spark.deviceClass': deviceClass(nav.deviceMemory, nav.hardwareConcurrency),
    'spark.networkType': connection?.effectiveType ?? null,
    'spark.downlinkMbps': connection?.downlink ?? null,
    'spark.rttMs': connection?.rtt ?? null,
    'spark.saveData': connection?.saveData ?? false,
    'spark.viewport': `${window.innerWidth}x${window.innerHeight}`,
    'spark.dpr': window.devicePixelRatio,
    'spark.lang': document.documentElement.lang || null,
    'spark.dir': document.documentElement.dir || null,
  }
}

function flushPending() {
  if (!client) return
  while (pending.length) {
    const event = pending.shift()!
    client.trackMetric({ name: event.name, average: event.value }, event.props)
  }
}

function record(name: string, value: number, props: Record<string, unknown> = {}) {
  if (client) {
    client.trackMetric({ name, average: value }, props)
    return
  }
  if (pending.length < PENDING_LIMIT) pending.push({ kind: 'metric', name, value, props })
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/** Time one backend call, as the browser experienced it.
 *
 * Deliberately different from the server's own number: the gap between them is
 * the network, and on a school line that gap is the story. */
export function trackApiCall(method: string, path: string, ms: number, status: number) {
  record('spark.api.duration', ms, {
    'spark.endpoint': `${method} ${sanitizePath(path)}`,
    'spark.status': status,
    'spark.ok': status >= 200 && status < 400,
  })
}

/** Time anything else worth naming: a 3D scene mounting, a lesson opening. */
export function trackTiming(name: string, ms: number, props: Record<string, unknown> = {}) {
  record(`spark.timing.${name}`, ms, props)
}

/** Report a handled failure without leaking its message.
 *
 * Only the error's *class* and a caller-chosen label are sent: an exception
 * message can contain a prompt, a learner's answer, or a URL with an id in it. */
export function trackFailure(label: string, error: unknown) {
  const kind = error instanceof Error ? error.name : typeof error
  client?.trackEvent({ name: 'spark.failure' }, { 'spark.label': label, 'spark.errorKind': kind })
}

/** Associate telemetry with a pseudonymous learner/teacher id.
 *
 * Never call this with a name, an email or a username: App Insights stores the
 * authenticated id in the clear and it is not ours to store. */
export function setTelemetryUser(pseudonymousId: string | null, role?: string) {
  if (!client) return
  if (pseudonymousId) client.setAuthenticatedUserContext(pseudonymousId, undefined, false)
  else client.clearAuthenticatedUserContext()
  if (role) client.addTelemetryInitializer((item) => { (item.data ||= {})['spark.role'] = role })
}

/* ── Web Vitals ─────────────────────────────────────────────────────────── */

/** The three metrics that describe how the app *feels*, plus the one that
 *  describes how fast the server answered.
 *
 *  Measured with PerformanceObserver rather than the `web-vitals` package so we
 *  add zero bytes to the main chunk for it. Each observer is wrapped: an entry
 *  type an older school browser doesn't support must not take the others down
 *  with it. */
function observeWebVitals() {
  const observe = (type: string, handler: (entries: PerformanceEntryList) => void) => {
    try {
      const observer = new PerformanceObserver((list) => handler(list.getEntries()))
      observer.observe({ type, buffered: true } as PerformanceObserverInit)
      return observer
    } catch {
      return null
    }
  }

  // Largest Contentful Paint — when the page looked ready.
  let lcp = 0
  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1]
    if (last) lcp = last.startTime
  })

  // Cumulative Layout Shift — how much the page moved under the reader.
  let cls = 0
  observe('layout-shift', (entries) => {
    for (const entry of entries as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
      if (!entry.hadRecentInput) cls += entry.value
    }
  })

  // Interaction to Next Paint (worst interaction) — the "I tapped and nothing
  // happened" number. On a low-end device this is usually the real complaint.
  let inp = 0
  observe('event', (entries) => {
    for (const entry of entries as (PerformanceEntry & { duration: number })[]) {
      if (entry.duration > inp) inp = entry.duration
    }
  })

  // Long tasks — every one is a frame the UI could not respond in. This is what
  // parsing a 2.9MB bundle looks like from the inside.
  let longTasks = 0
  let longTaskMs = 0
  observe('longtask', (entries) => {
    longTasks += entries.length
    for (const entry of entries) longTaskMs += entry.duration
  })

  const report = () => {
    const context = deviceContext()
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (navigation) {
      record('spark.vitals.ttfb', navigation.responseStart, context)
      record('spark.vitals.domContentLoaded', navigation.domContentLoadedEventEnd, context)
      record('spark.vitals.transferKB', navigation.transferSize / 1024, context)
    }
    const paint = performance.getEntriesByName('first-contentful-paint')[0]
    if (paint) record('spark.vitals.fcp', paint.startTime, context)
    if (lcp) record('spark.vitals.lcp', lcp, context)
    record('spark.vitals.cls', cls, context)
    if (inp) record('spark.vitals.inp', inp, context)
    record('spark.vitals.longTasks', longTasks, context)
    record('spark.vitals.longTaskMs', longTaskMs, context)
    client?.flush()
  }

  // Reported when the page is hidden, not on `unload`: `unload` is unreliable
  // on mobile and never fires when a tab is backgrounded, which on a school
  // tablet is how most sessions end.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') report()
  })
  // Also report once the page has settled, so a session that never goes hidden
  // still tells us how the load went.
  window.setTimeout(report, 10_000)
}

/* ── Page views ─────────────────────────────────────────────────────────── */

/** The app has a hand-rolled router (`app/router.tsx`) that dispatches
 *  `popstate` on every navigation, so the SDK's `enableAutoRouteTracking` —
 *  which listens for History API calls it monkey-patches itself — would
 *  double-count some routes and miss others. Listening to the same event the
 *  app's own `useRoute` listens to keeps the two in step by construction. */
function trackRoutes() {
  let lastPath = ''
  let enteredAt = performance.now()

  const send = () => {
    const path = sanitizePath(window.location.pathname)
    if (path === lastPath) return
    const now = performance.now()
    if (lastPath) {
      record('spark.route.dwellMs', now - enteredAt, { 'spark.route': lastPath })
    }
    lastPath = path
    enteredAt = now
    client?.trackPageView({ name: path, uri: path })
  }

  send()
  window.addEventListener('popstate', send)
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

async function start() {
  const response = await fetch('/api/telemetry/config', { credentials: 'omit' })
  if (!response.ok) return
  const config: BrowserTelemetryConfig = await response.json()
  if (!config.enabled || !config.connectionString) return

  const { ApplicationInsights } = await import('@microsoft/applicationinsights-web')
  const instance = new ApplicationInsights({
    config: {
      connectionString: config.connectionString,
      // W3C trace headers on our own API calls, so a slow page view can be
      // opened up into the exact backend request — and its Mongo and APIM
      // calls — that made it slow. Without the correlation header allow-list
      // the browser and server halves stay two unrelated piles of data.
      distributedTracingMode: 2 /* AI_AND_W3C */,
      enableCorsCorrelation: true,
      enableRequestHeaderTracking: false,
      enableResponseHeaderTracking: false,
      // Fetch/XHR are auto-tracked; route tracking is manual (see trackRoutes).
      disableFetchTracking: false,
      enableAutoRouteTracking: false,
      // Unhandled exceptions, which today are invisible unless a user reports
      // them.
      disableExceptionTracking: false,
      samplingPercentage: config.samplingPercentage,
      // No cookies: the app is used by children and the project forbids
      // browser-side persistence of anything learner-shaped. It costs us
      // cross-session user counts, which we do not need to find slowness.
      isCookieUseDisabled: true,
    },
  })
  instance.loadAppInsights()

  instance.addTelemetryInitializer((item) => {
    item.tags = item.tags || {}
    item.tags['ai.cloud.role'] = config.roleName
    const data = (item.data ||= {})
    data['spark.environment'] = config.environment
    data['spark.release'] = config.release
    Object.assign(data, deviceContext())
  })

  client = instance
  flushPending()
  trackRoutes()
  instance.trackPageView()
}

/** Start browser telemetry. Safe to call once; never throws.
 *
 * Deferred to idle after first paint on purpose: the SDK download and its first
 * beacon must not compete with rendering the app the learner is waiting for. */
export function initTelemetry() {
  if (starting || client) return
  starting = true

  // Vitals collection starts immediately even though the SDK has not loaded —
  // LCP and the load-time long tasks happen in the first seconds, long before
  // any beacon can be sent. `record()` buffers until the client is ready.
  observeWebVitals()

  const boot = () => {
    start().catch(() => {
      // A telemetry outage is not an app outage. Stay silent and keep serving
      // the learner.
      starting = false
    })
  }
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback
  if (idle) idle(boot, { timeout: 5000 })
  else window.setTimeout(boot, 2000)
}
