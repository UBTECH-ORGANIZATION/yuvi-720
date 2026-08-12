/* The teaching assistant, in a real browser, against real data.
 *
 * Two things are worth checking here that unit tests cannot:
 *
 *   1. **A student's name never arrives from the server.** The backend tests
 *      assert the tools strip `display_name`; this asserts the *whole response
 *      body* the browser receives contains no roster name, by intercepting the
 *      network. That is the property that actually matters — a leak anywhere in
 *      the pipeline shows up here.
 *
 *   2. **The trace is visible.** An answer is only trustworthy because the
 *      teacher can see what it stands on. A rendered answer with no trace, or a
 *      trace showing tools that never ran, is the failure this phase exists to
 *      prevent.
 *
 * Signs in through the API: the landing page runs a WebGL scene that can hang
 * Playwright's click actionability under load. `teacher-app-check.mjs` still
 * drives the real landing button.
 *
 * Never `waitUntil: 'networkidle'` — the teacher page holds an SSE connection.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/assistant'
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const signIn = async (context, username, landing) => {
  const response = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username, password: 'Aa12345' },
  })
  if (!response.ok()) throw new Error(`login failed for ${username}: ${response.status()}`)
  const page = await context.newPage()
  await page.goto(`${BASE}${landing}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  // Phase 8: the tour opens itself for an account that has not seen it,
  // and its scrim blocks clicks. Dismiss it as a teacher would.
  await dismissTourIfOpen(page)
  return page
}

const browser = await chromium.launch()

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const page = await signIn(context, 'gal', '/teacher')

  /* Capture every assistant response body, so the PII assertion is made against
     what the browser actually received rather than what we hope was sent. */
  /* The dock streams: `/api/teacher/assistant/stream` is a text/event-stream of
     `data: {…}` frames, so `response.json()` throws and the capture used to end
     up as `{}`. Every assertion below then read an empty object — including the
     PII one, which "passed" by having nothing to look at. The frames are
     merged back into the one answer they describe: text concatenated, the
     terminal frame's fields (grounded, tools) kept. */
  const answers = []
  page.on('response', async (response) => {
    if (!response.url().includes('/api/teacher/assistant')) return
    if (response.request().method() !== 'POST') return
    let raw = ''
    try { raw = await response.text() } catch { return }
    if (!raw.trim()) return
    if (!raw.includes('data: ')) {
      try { answers.push(JSON.parse(raw)) } catch { /* not the one-shot shape */ }
      return
    }
    const merged = { text: '' }
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') continue
      let frame
      try { frame = JSON.parse(payload) } catch { continue }
      const { text, answer, ...rest } = frame
      if (typeof text === 'string') merged.text += text
      // The terminal frame nests the whole thing: `{"answer": {…grounded, tools}}`.
      if (answer && typeof answer === 'object') Object.assign(merged, answer)
      Object.assign(merged, rest)
    }
    answers.push(merged)
  })

  // ── the panel is present on every teacher screen ─────────────────────────
  /* Since the design pass the assistant opens by default on desktop widths —
     it is a workspace column, not a popup. Closed → the launcher. Accept
     either, and make sure it is OPEN before the conversation assertions. */
  const ensureOpen = async () => {
    if (await page.locator('.tch-dock').count()) return
    await page.locator('.tch-dock__launcher').click()
    await page.waitForSelector('.tch-dock', { timeout: 10000 })
  }
  await page.waitForSelector('.tch-dock, .tch-dock__launcher', { timeout: 40000 })
  check('the assistant rides on Home', true)

  await page.goto(`${BASE}/teacher/students`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const onRoster = await page.locator('.tch-dock, .tch-dock__launcher').count()
  check('it rides on the roster too', onRoster >= 1)

  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  // ── it is a surface, not a destination ───────────────────────────────────
  await ensureOpen()
  check('it opens into a panel, not a route', page.url().endsWith('/teacher'))

  // The intro is what an EMPTY dock says. An account that has talked to the
  // assistant before opens on its last thread instead — waiting 30s for a
  // paragraph that is correctly absent is the script being wrong, not the app.
  const introBox = page.locator('.tch-dock__intro')
  if (await introBox.count()) {
    const intro = (await introBox.textContent()) ?? ''
    check('the intro states the grounding promise up front', intro.length > 10, intro.slice(0, 60))
    check('no raw locale key leaked into the dock',
          !intro.includes('tch.assistant'), intro.slice(0, 40))
  } else {
    const body = (await page.locator('.tch-dock__body').textContent()) ?? ''
    check('no raw locale key leaked into the dock', !body.includes('tch.assistant'))
    console.log('    (this account has history — the intro is correctly absent)')
  }

  await page.screenshot({ path: `${OUT}/01-dock-open.png` })

  // ── a real question ──────────────────────────────────────────────────────
  const started = Date.now()
  await page.locator('.tch-dock__composer input').fill('מי צריך תשומת לב בקבוצה שלי?')
  await page.locator('.tch-dock__composer button[type=submit]').click()

  /* Wait for the ANSWER, not for the absence of a pending row: on an account
     with history the dock opens on its last thread, and the pending row takes a
     tick to render — so "no pending row on screen" is true a millisecond after
     the click, and the check used to declare the assistant silent while it was
     still thinking. The captured body is the thing every assertion below reads,
     so it is the thing to wait for. */
  for (let i = 0; i < 1200 && answers.length === 0; i += 1) await page.waitForTimeout(100)
  await page.waitForFunction(
    () => !document.querySelector('.tch-dock__answer--pending'),
    { timeout: 30000 }
  ).catch(() => {})
  const elapsed = Date.now() - started
  check('the assistant answers', answers.length === 1, `${elapsed}ms`)

  const answer = answers[0] ?? {}
  check('the answer is grounded in tool results', answer.grounded === true,
        `${(answer.tools ?? []).length} tools`)

  // ── the trace: this is the explainability surface ────────────────────────
  const traceRows = await page.locator('.tch-trace__row').count()
  check('every tool that ran is shown to the teacher',
        traceRows === (answer.tools ?? []).length && traceRows > 0,
        `${traceRows} rows`)

  const toolNames = await page.locator('.tch-trace__row code').allTextContents()
  check('the trace names the real tools',
        toolNames.every((name) => (answer.tools ?? []).some((t) => t.name === name)),
        toolNames.join(', '))

  // ── the PII boundary, asserted on the wire ───────────────────────────────
  const body = JSON.stringify(answer)
  check('the response carries no display_name field', !body.includes('display_name'))

  /* Every roster name this teacher can see — across ALL their groups, not a
     hardcoded one. `gal` is an admin and sees several, and checking only one
     would make the leak assertion pass vacuously on an empty list. */
  const rosterNames = await page.evaluate(async () => {
    const groupsResponse = await fetch('/api/groups', { credentials: 'include' })
    if (!groupsResponse.ok) return []
    const { groups = [] } = await groupsResponse.json()
    const names = []
    for (const group of groups) {
      const response = await fetch(
        `/api/teacher/groups/${encodeURIComponent(group.id)}/snapshot?lang=he`,
        { credentials: 'include' })
      if (!response.ok) continue
      const data = await response.json()
      for (const student of data.students ?? []) {
        if (student.display_name) names.push(student.display_name)
      }
    }
    return names
  })
  if (!rosterNames.length) throw new Error('no roster names found — the leak check would be vacuous')
  const leaked = rosterNames.filter((name) => body.includes(name))
  check('no student name reached the browser from the model',
        leaked.length === 0, `${rosterNames.length} names checked`)

  // ── and yet the teacher sees names ───────────────────────────────────────
  const refs = await page.locator('.tch-studentRef').count()
  if (refs > 0) {
    const labels = await page.locator('.tch-studentRef').allTextContents()
    const resolved = labels.filter((label) => rosterNames.includes(label.trim()))
    check('student references resolve to real names in the UI',
          resolved.length > 0, `${resolved.length}/${labels.length} resolved`)
    check('no raw marker is rendered',
          !(await page.locator('.tch-dock__body').textContent() ?? '').includes('{{student:'))
  } else {
    // A valid answer shape — the model may have spoken only in aggregates.
    check('no raw marker is rendered',
          !(await page.locator('.tch-dock__body').textContent() ?? '').includes('{{student:'))
    console.log('    (this answer used no student references)')
  }

  await page.screenshot({ path: `${OUT}/02-answer-with-trace.png` })

  // ── the gaps panel's action ──────────────────────────────────────────────
  await page.locator('.tch-dock__iconButton').last().click()
  await page.waitForTimeout(500)

  // A gap's answer is material, not a goal. The button used to open the
  // sub-group goal dialog — a title, next steps and a date, which is a note to
  // the teacher's future self rather than anything a child receives.
  const gapButtons = page.locator('.tch-gap__actions .sp-btn--ghost',
                                  { hasText: /משימה|task|مهمة/ })
  const gapPanels = await gapButtons.count()
  if (gapPanels > 0) {
    await gapButtons.first().click()
    await page.waitForSelector('.tch-builder__modal .tch-builder', { timeout: 10_000 })
    check('the gap opens the task builder, not a goal form',
          page.url().includes('/teacher/tasks'), page.url())

    const title = await page.locator('.tch-builder__step input.sp-input').first().inputValue()
    check('the task title is pre-filled from the gap and editable', title.length > 0, title)
    check('no raw locale key in the pre-filled title', !title.includes('tch.'))

    // The dialog opens already typed-in, so it has to say who typed it — and
    // how many children the send will arrive pre-ticked for.
    const notes = (await page.locator('.tch-builder__note').allTextContents()).join(' ')
    check('the builder says where this task came from',
          /פער|gap|فجوة/.test(notes), notes.slice(0, 80))

    // The lesson is looked up from the objective the gap names, so a teacher
    // does not hunt for material they have just been told the name of.
    const subject = await page.locator('.tch-builder__step select.sp-input').first().inputValue()
    check('the subject is resolved from the objective', subject.length > 0, subject || '(none)')

    await page.screenshot({ path: `${OUT}/03-gap-task.png` })
    await page.keyboard.press('Escape')
    await page.waitForSelector('.tch-builder__modal', { state: 'detached', timeout: 5000 })
    await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
  } else {
    console.log('    (no learning gaps in this group right now — panel not exercised)')
  }

  /* Themes. The app switches on a `data-theme` attribute, NOT on the media
     query — `emulateMedia` looks like it works and silently tests the same
     theme twice. Colours are compared to prove the switch actually happened. */
  const themeColours = {}
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
    await page.waitForTimeout(400)
    await ensureOpen()
    const colour = await page.locator('.tch-dock__title').evaluate(
      (node) => getComputedStyle(node).color)
    themeColours[theme] = colour
    check(`the dock renders in ${theme} mode`,
          Boolean(colour) && colour !== 'rgba(0, 0, 0, 0)', colour)
    await page.screenshot({ path: `${OUT}/04-${theme}.png` })
  }
  check('the two themes actually differ (the switch was exercised)',
        themeColours.light !== themeColours.dark,
        `${themeColours.light} vs ${themeColours.dark}`)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))

  const dir = await page.evaluate(() => document.documentElement.dir)
  check('the teacher app is RTL in Hebrew', dir === 'rtl', dir)

  await ensureOpen()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('the dock does not push the page sideways', overflow <= 0, `${overflow}px`)

  // ── a learner cannot reach the assistant ─────────────────────────────────
  const learnerCtx = await browser.newContext()
  await learnerCtx.request.post(`${BASE}/api/auth/login`,
    { data: { username: 'demo-shir', password: 'Aa12345' } })
  const forbidden = await learnerCtx.request.post(`${BASE}/api/teacher/assistant`,
    { data: { message: 'מי מתקשה בכיתה?', language: 'he' } })
  check('a learner is refused by the assistant endpoint',
        forbidden.status() === 403, `HTTP ${forbidden.status()}`)
  await learnerCtx.close()

  await context.close()
} finally {
  await browser.close()
}

if (failures.length) {
  console.log(`\n✘ ${failures.length} failure(s)`)
  for (const failure of failures) console.log(`   - ${failure}`)
  process.exit(1)
}
console.log('\n✅ assistant check passed')
