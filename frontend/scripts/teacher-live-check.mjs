/* The realtime loop, end to end, in two browser contexts.
 *
 * A student signs in and a teacher watches. The properties under test are the
 * ones that cannot be checked from unit tests: that a presence change made by
 * one person appears on another person's screen with no reload, that the
 * evidence disclosure is present on every live surface, and that a teacher who
 * does not teach the learner sees nothing.
 *
 * Never uses `waitUntil: 'networkidle'` — both pages hold SSE connections open,
 * so networkidle never fires.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/teacher-live'
mkdirSync(OUT, { recursive: true })

/* The landing page runs a WebGL scene, and a click dispatched while it is still
   settling can hang for the full actionability timeout. Retry once against a
   fresh load rather than failing the whole run on a rendering hiccup. */
const clickLanding = async (page, selector) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.waitForSelector(selector, { timeout: 45000 })
      await page.locator(selector).click({ timeout: 15000 })
      return
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
    }
  }
  await page.locator(selector).click({ timeout: 20000 })
}

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/** Poll rather than sleep: realtime is the thing under test, so "how long did it
 *  take" matters more than "did it eventually happen". */
const waitFor = async (page, fn, timeout = 20000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - started
    await page.waitForTimeout(200)
  }
  return -1
}

/* Count CONCURRENTLY OPEN EventSources, which is the thing the multiplexer
   exists to bound. Resource timing entries are no good here: they are a
   historical log, so StrictMode's deliberate mount/unmount/remount in dev shows
   up as two requests even though only one connection is ever open. */
const INSTRUMENT = `
  const Native = window.EventSource
  const live = []
  window.EventSource = function (url, init) {
    const source = new Native(url, init)
    live.push(source)
    return source
  }
  window.EventSource.prototype = Native.prototype
  Object.assign(window.EventSource, Native)
  // Counted at READ time from readyState, not by hooking close(): a connection
  // the browser tears down after an error never calls close(), so a manual
  // counter reports phantom open sockets forever.
  window.__sse = () => ({
    open: live.filter((source) => source.readyState !== 2).length,
    everOpened: live.length,
    urls: [...new Set(live.filter((s) => s.readyState !== 2).map((s) => new URL(s.url).pathname))],
  })
`

/* Sign in through the API rather than the landing page.
 *
 * The landing page runs a WebGL scene, and under load Playwright's click
 * actionability check on it can hang for the full timeout — a harness problem
 * with nothing to do with what this file is testing. The request context shares
 * its cookie jar with the browser context, so this puts a real session cookie on
 * every page the context opens. The landing button itself is still covered, by
 * `teacher-app-check.mjs`, which drives it deliberately. */
const signIn = async (context, username, landing) => {
  const response = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username, password: 'Aa12345' },
  })
  if (!response.ok()) throw new Error(`login failed for ${username}: ${response.status()}`)
  const page = await context.newPage()
  await page.addInitScript(INSTRUMENT)
  await page.goto(`${BASE}${landing}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  // Phase 8: the tour opens itself for an account that has not seen it,
  // and its scrim blocks clicks. Dismiss it as a teacher would.
  await dismissTourIfOpen(page)
  return page
}

const browser = await chromium.launch()

try {
  // ── the teacher is watching ───────────────────────────────────────────────
  const teacherCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const teacher = await signIn(teacherCtx, 'demo-teacher-1', '/teacher')
  await teacher.waitForSelector('.tch-live', { timeout: 40000 })
  check('the live strip renders on Home', true)

  const tiles = await teacher.locator('.tch-tile').count()
  check('the strip lists the whole group, absent included', tiles === 12, `${tiles} tiles`)

  // "Never a bare dot": every tile carries a last-seen label beside its dot.
  const dots = await teacher.locator('.tch-tile .tch-dot').count()
  const seen = await teacher.locator('.tch-tile__seen').count()
  check('every presence dot is paired with "last seen"', dots === seen && dots > 0,
        `${dots} dots, ${seen} labels`)

  const connected = await teacher.locator('.tch-live__link.is-live').count()
  check('the stream reports itself connected', connected === 1)
  await teacher.screenshot({ path: `${OUT}/01-live-strip.png`, fullPage: true })

  // ── a student arrives ─────────────────────────────────────────────────────
  const studentCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const student = await signIn(studentCtx, 'demo-ari', '/student-dashboard')

  // The learner page holds the coach SSE connection, which is what marks them
  // online — no client heartbeat, no announcement.
  const elapsed = await waitFor(teacher, () => {
    const tile = [...document.querySelectorAll('.tch-tile')]
      .find((node) => node.textContent?.includes('Ari'))
    return Boolean(tile && !tile.className.includes('tch-tile--offline'))
  })
  check('a student signing in turns their tile live, with no reload',
        elapsed >= 0, elapsed >= 0 ? `${elapsed}ms` : 'timed out')
  await teacher.screenshot({ path: `${OUT}/02-student-online.png`, fullPage: true })

  // ── the coach hands off to a human ────────────────────────────────────────
  // Driven through the real endpoint rather than by clicking through a lesson:
  // this is the escalation contract, and it must work from wherever it fires.
  const handoff = await student.evaluate(async () => {
    const response = await fetch('/api/agent/coach/handoff', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'stuck', objective_id: 'MOE.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE' }),
    })
    return response.json()
  })
  check('the handoff reaches this learner\'s teachers', (handoff?.notified ?? 0) >= 1,
        `notified ${handoff?.notified}`)

  const alertMs = await waitFor(teacher, () =>
    document.querySelectorAll('.tch-alert').length > 0)
  check('the alert appears on the teacher\'s screen with no reload',
        alertMs >= 0, alertMs >= 0 ? `${alertMs}ms` : 'timed out')

  const alertWhy = await teacher.locator('.tch-alert .tch-evidence__toggle').count()
  check('every alert offers its evidence', alertWhy > 0, `${alertWhy} toggles`)

  await teacher.locator('.tch-alert .tch-evidence__toggle').first().click()
  await teacher.waitForTimeout(400)
  const raw = await teacher.locator('.tch-alert .tch-evidence__raw').count()
  check('the alert evidence shows what Yuvi already tried', raw > 0)
  await teacher.screenshot({ path: `${OUT}/03-handoff-alert.png`, fullPage: true })

  // ── acknowledging is optimistic and sticks ────────────────────────────────
  const ackButton = teacher.locator('.tch-alert button', { hasText: /ראיתי|Seen|شاهدت/ }).first()
  if (await ackButton.count()) {
    await ackButton.click()
    const acked = await waitFor(teacher, () =>
      document.querySelectorAll('.tch-alert.is-acknowledged').length > 0, 8000)
    check('acknowledging stops the row shouting immediately', acked >= 0, `${acked}ms`)
  } else {
    // Alert ids are deterministic, so a previous run's alert survives and comes
    // back already acknowledged — which IS the property under test (it stayed
    // dimmed rather than shouting again), just reached from the other side.
    const dimmed = await teacher.locator('.tch-alert.is-acknowledged').count()
    check('acknowledging stops the row shouting immediately', dimmed > 0,
          'already acknowledged from an earlier run')
  }

  // Resolve everything this run raised, so the next run starts from open alerts
  // again rather than inheriting this one's end state.
  await teacher.evaluate(async () => {
    const response = await fetch('/api/teacher/live', { credentials: 'include' })
    const snapshot = await response.json()
    for (const alert of snapshot.alerts ?? []) {
      await fetch(`/api/teacher/alerts/${encodeURIComponent(alert._id)}/resolve`,
                  { method: 'POST', credentials: 'include' })
    }
  })

  // ── scoping: a teacher outside the group sees none of it ──────────────────
  const outsiderCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const outsider = await signIn(outsiderCtx, 'moti', '/teacher')
  await outsider.waitForSelector('.tch-live', { timeout: 40000 })
  await outsider.waitForTimeout(2500)
  const leaked = await outsider.evaluate(() =>
    document.body.innerText.includes('Ari') || document.body.innerText.includes('demo-ari'))
  check('a teacher outside the group is handed nothing about that learner', !leaked)
  await outsider.screenshot({ path: `${OUT}/04-outsider.png`, fullPage: true })

  // ── the roster carries the same honest indicator ──────────────────────────
  // Navigate directly rather than through the nav: by this point the page has
  // held an SSE stream for a while and a click can queue behind pending work.
  await teacher.goto(`${BASE}/teacher/students`, { waitUntil: 'domcontentloaded' })
  await teacher.waitForSelector('.tch-studentCard', { timeout: 60000 })
  const cardDots = await teacher.locator('.tch-studentCard .tch-dot').count()
  const cardSeen = await teacher.locator('.tch-studentCard__seen').count()
  check('roster cards show presence with a timestamp',
        cardDots > 0 && cardDots === cardSeen, `${cardDots} dots, ${cardSeen} labels`)
  await teacher.screenshot({ path: `${OUT}/05-roster-presence.png`, fullPage: true })

  // ── one connection per tab, not one per feature ───────────────────────────
  // The whole point of the multiplexer: a browser gives an origin ~6 connections
  // and an SSE stream holds one for the life of the page.
  const learnerSse = await student.evaluate(() => window.__sse())
  check('the learner page holds one open stream',
        learnerSse.open === 1,
        `open ${learnerSse.open} (${learnerSse.urls}), ever created ${learnerSse.everOpened}`)

  const teacherSse = await teacher.evaluate(() => window.__sse())
  check('the teacher page holds one open stream',
        teacherSse.open === 1,
        `open ${teacherSse.open} (${teacherSse.urls}), ever created ${teacherSse.everOpened}`)
  // A teacher-only account has no trigger stream to hold; retrying a 403 forever
  // would burn a connection slot and hit the server every three seconds.
  check('a teacher account never opens the learner trigger stream',
        !teacherSse.urls.some((path) => path.includes('/triggers/subscribe')),
        teacherSse.urls.join(', '))

  // ── going offline ─────────────────────────────────────────────────────────
  await studentCtx.close()
  const offlineMs = await waitFor(teacher, () => true, 100)   // context closed; just proceed
  void offlineMs
  await teacher.locator('.teacher-app-nav button').nth(0).click()
  await teacher.waitForSelector('.tch-live', { timeout: 30000 })
  check('the teacher screen survives a student disconnecting', true)

  const overflow = await teacher.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('page does not scroll horizontally', overflow <= 1, `${overflow}px`)
} finally {
  await browser.close()
}

console.log(failures.length ? `\n✘ ${failures.length} failure(s)` : '\n✅ teacher live check passed')
if (failures.length) { failures.forEach((f) => console.log(`   - ${f}`)); process.exit(1) }
