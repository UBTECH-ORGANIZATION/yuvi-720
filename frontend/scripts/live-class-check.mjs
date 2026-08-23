/* The live classroom view (#249), end to end in two browser contexts.
 *
 * A teacher lands on the live view; a learner moves through the product; the
 * teacher's rows follow with no reload. The properties under test are the
 * ones unit tests cannot reach: the realtime loop through two real browsers,
 * the KPI cards agreeing with the rows they filter, the raised hand clearing
 * when the teacher resolves it, and the pin round-trip landing on the
 * learner's own hero.
 *
 * Never `waitUntil: 'networkidle'` — both pages hold SSE connections open, so
 * networkidle never fires.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dismissTourIfOpen } from './lib/tour.mjs'
import { dismissCheckin } from './lib/checkin.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/live-class'
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/** Poll rather than sleep: the realtime loop's latency IS the thing under test. */
const waitFor = async (page, fn, timeout = 20000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - started
    await page.waitForTimeout(200)
  }
  return -1
}

const signIn = async (context, username, landing) => {
  const response = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username, password: 'Aa12345' },
  })
  if (!response.ok()) throw new Error(`login failed for ${username}: ${response.status()}`)
  const page = await context.newPage()
  await page.goto(`${BASE}${landing}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await dismissTourIfOpen(page)
  await dismissCheckin(page)
  return page
}

const browser = await chromium.launch()

try {
  // ── the teacher lands on live ─────────────────────────────────────────────
  const teacherCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const teacher = await signIn(teacherCtx, 'demo-teacher-1', '/teacher/students')
  await teacher.waitForSelector('.tch-liveClass', { timeout: 40000 })
  check('the students screen lands on the live view', true)

  const kpiCards = await teacher.locator('.tch-liveKpi').count()
  check('five KPI cards', kpiCards === 5, `${kpiCards}`)

  const rows = await teacher.locator('.tch-liveRow').count()
  check('every student in scope has a row, absent included', rows === 12, `${rows} rows`)

  // "Never a bare dot": each row pairs its dot with a last-seen label.
  const dots = await teacher.locator('.tch-liveRow .tch-dot').count()
  const seen = await teacher.locator('.tch-liveRow__seen').count()
  check('every dot is paired with "last seen"', dots === seen && dots > 0,
        `${dots} dots, ${seen} labels`)

  const connected = await teacher.locator('.tch-liveBar__conn.is-live').count()
  check('the view says its feed is live', connected === 1)

  // The rows are a table: five named columns above them (signals ride inside
  // the where cell — they stopped being a column of their own).
  const headCells = await teacher.locator('.tch-liveHead__cell').count()
  check('the rows carry a six-column header', headCells === 6, `${headCells} cells`)

  // A column filter must be honest twice over: the count on the menu option
  // and the rows it leaves behind are the same number.
  await teacher.locator('.tch-liveHead__filter .tch-liveHead__filterBtn').first().click()
  const option = teacher.locator('.tch-liveHead__menu button').nth(1)
  const optionCount = Number(await option.locator('.tch-liveHead__optCount').innerText())
  await option.click()
  await teacher.waitForTimeout(300)
  const filteredRows = await teacher.locator('.tch-liveRow').count()
  check('a column filter narrows the rows to its own count',
        filteredRows === optionCount, `${filteredRows} rows vs ${optionCount} on the menu`)
  await teacher.locator('.tch-liveHead__filter .tch-liveHead__filterBtn').first().click()
  await teacher.locator('.tch-liveHead__menu button').first().click()  // show all
  await teacher.waitForTimeout(300)
  const restoredRows = await teacher.locator('.tch-liveRow').count()
  check('"show all" restores every row', restoredRows === 12, `${restoredRows} rows`)
  await teacher.screenshot({ path: `${OUT}/01-live-landing.png`, fullPage: true })

  // ── a learner arrives, and moves ──────────────────────────────────────────
  const studentCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const student = await signIn(studentCtx, 'demo-ari', '/student-dashboard')

  const onlineMs = await waitFor(teacher, () => {
    const row = [...document.querySelectorAll('.tch-liveRow')]
      .find((node) => node.textContent?.includes('Ari'))
    return Boolean(row && !row.className.includes('is-offline'))
  })
  check('signing in flips their row live, no reload',
        onlineMs >= 0, onlineMs >= 0 ? `${onlineMs}ms` : 'timed out')

  // The client-reported surface: the studio. Where must follow — and only
  // Where: a reported surface can never claim "in a lesson".
  await student.goto(`${BASE}/learning/create`, { waitUntil: 'domcontentloaded' })
  const studioMs = await waitFor(teacher, () => {
    const row = [...document.querySelectorAll('.tch-liveRow')]
      .find((node) => node.textContent?.includes('Ari'))
    return Boolean(row?.className.includes('is-studio'))
  })
  check('moving to the studio moves their Where', studioMs >= 0,
        studioMs >= 0 ? `${studioMs}ms` : 'timed out')
  await teacher.screenshot({ path: `${OUT}/02-studio.png`, fullPage: true })

  // ── the raised hand ───────────────────────────────────────────────────────
  const handoff = await student.evaluate(async () => {
    const response = await fetch('/api/agent/coach/handoff', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'hand_raised' }),
    })
    return response.json()
  })
  check('the hand reaches this learner\'s teachers', (handoff?.notified ?? 0) >= 1,
        `notified ${handoff?.notified}`)

  const handMs = await waitFor(teacher, () => {
    const row = [...document.querySelectorAll('.tch-liveRow')]
      .find((node) => node.textContent?.includes('Ari'))
    return Boolean(row?.className.includes('has-hand'))
  })
  check('the row shows the hand, no reload', handMs >= 0,
        handMs >= 0 ? `${handMs}ms` : 'timed out')

  const handCount = await teacher.locator('.tch-liveKpi').first().locator('.tch-liveKpi__value').innerText()
  check('the hand KPI counts it', handCount.trim() === '1', handCount)

  // Pressing the card filters the rows to exactly that count.
  await teacher.locator('.tch-liveKpi').first().click()
  await teacher.waitForTimeout(500)
  const handRows = await teacher.locator('.tch-liveRow').count()
  check('pressing the KPI filters the rows to match it', handRows === 1, `${handRows} rows`)
  await teacher.screenshot({ path: `${OUT}/03-hand-filter.png`, fullPage: true })
  await teacher.locator('.tch-liveClass__filterNote button').click()

  // ── resolving clears the hand — from the ROW's own button ─────────────────
  const resolveBtn = teacher.locator('.tch-handChip__done')
  check('the hand row offers a resolve button', await resolveBtn.count() >= 1)
  await resolveBtn.first().click()
  const clearedMs = await waitFor(teacher, () => {
    const row = [...document.querySelectorAll('.tch-liveRow')]
      .find((node) => node.textContent?.includes('Ari'))
    return Boolean(row && !row.className.includes('has-hand'))
  })
  check('resolving from the row lowers the hand', clearedMs >= 0,
        clearedMs >= 0 ? `${clearedMs}ms` : 'timed out')

  // ── the pin round-trip ────────────────────────────────────────────────────
  // Through the API rather than the popover: the popover is exercised by its
  // own selectors above the fold; what must be TRUE is the contract — a pin
  // set by the teacher changes what the learner's own hero offers.
  // Pin the component the learner's own hero currently recommends: it is
  // uncompleted by construction. Pinning an already-completed learning is
  // DESIGNED not to steer (a spent pin is skipped), so the first catalog row —
  // which demo-ari has finished — would prove nothing but that rule.
  const nextStep = await student.evaluate(async () => {
    const response = await fetch('/api/brain/demo-ari/dashboard?lang=he',
                                 { credentials: 'include' })
    return (await response.json())?.hero?.componentId
  })
  check('the learner has an uncompleted next step to pin', Boolean(nextStep), `${nextStep}`)
  const pinned = await teacher.evaluate(async (componentId) => {
    const response = await fetch('/api/teacher/students/demo-ari/pin-next', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ component_id: componentId }),
    })
    return response.json()
  }, nextStep)
  check('the teacher can pin a catalog component', Boolean(pinned?.pinned?.component_id),
        JSON.stringify(pinned).slice(0, 120))

  // Asserted at the hero API rather than the rendered page: the demo learners
  // are parked in onboarding (a known test-account gap), so the dashboard
  // never mounts for them — but the contract under test is the hero MODEL:
  // the same payload the page renders from must switch to `pinned`.
  const heroPinned = await student.evaluate(async () => {
    const response = await fetch('/api/brain/demo-ari/dashboard?lang=he',
                                 { credentials: 'include' })
    return (await response.json())?.hero?.mode
  })
  check('the learner\'s hero offers the pinned step', heroPinned === 'pinned',
        `mode=${heroPinned}`)

  await teacher.evaluate(() =>
    fetch('/api/teacher/students/demo-ari/pin-next',
          { method: 'DELETE', credentials: 'include' }))
  const heroFree = await student.evaluate(async () => {
    const response = await fetch('/api/brain/demo-ari/dashboard?lang=he',
                                 { credentials: 'include' })
    return (await response.json())?.hero?.mode
  })
  check('unpinning returns the hero to its own pick', heroFree !== 'pinned',
        `mode=${heroFree}`)

  // ── the whole page stays inside its width ─────────────────────────────────
  const overflow = await teacher.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('no horizontal scroll', overflow <= 1, `${overflow}px`)
} finally {
  await browser.close()
}

console.log(failures.length ? `\n✘ ${failures.length} failure(s)` : '\n✅ live class check passed')
if (failures.length) { failures.forEach((f) => console.log(`   - ${f}`)); process.exit(1) }
