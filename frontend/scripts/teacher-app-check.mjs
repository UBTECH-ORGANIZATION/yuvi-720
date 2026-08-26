/* Drive the teacher app end-to-end against the demo fixture.
 *
 * Never uses `waitUntil: 'networkidle'` — the app holds an SSE connection open,
 * so networkidle never fires.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/teacher-app'
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

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`))
// A teacher-only account has no learner brain/wallet, so the learner providers
// legitimately get 401/403. Those are not failures of the teacher app.
page.on('console', (message) => {
  const text = message.text()
  if (message.type() !== 'error') return
  if (/Failed to load resource|401|403/.test(text)) return
  if (/React does not recognize/.test(text)) return   // pre-existing landing-page warning
  failures.push(`console: ${text}`)
})

try {
  // ── landing: the teacher button must now exist ────────────────────────────
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  /* Wait for the button rather than sleeping a fixed 1200ms. The landing page
     mounts a WebGL scene and lazy images, and under load it can take several
     seconds — a fixed sleep turns that into a "the button is missing" failure
     when the button is merely late. */
  const teacherBtn = page.locator('.landing720-login-btn.teacher')
  const appeared = await teacherBtn.waitFor({ state: 'attached', timeout: 45000 })
    .then(() => true).catch(() => false)
  check('landing shows a teacher sign-in button', appeared && await teacherBtn.count() === 1)
  await page.screenshot({ path: `${OUT}/01-landing.png` })

  // ── login as a fixture teacher ────────────────────────────────────────────
  await clickLanding(page, '.landing720-login-btn.teacher')
  await page.waitForTimeout(600)
  const dialog = page.locator('[role="dialog"]')
  await dialog.locator('input').first().fill('demo-teacher-1')
  await dialog.locator('input[type="password"]').fill('Aa12345')
  await page.screenshot({ path: `${OUT}/02-login.png` })
  await dialog.locator('button[type="submit"]').click()
  await page.waitForTimeout(3500)

  check('landed on the teacher app', page.url().includes('/teacher'), page.url())

  // ── home ──────────────────────────────────────────────────────────────────
  // Home fans out over every learner in the group, so wait for the content
  // rather than guessing a duration.
  await page.waitForSelector('.tch-stat', { timeout: 30000 })
  /* Phase 8: the tour opens itself for an account that has not seen it, and its
     scrim blocks clicks. Dismissed *here* rather than straight after login —
     signing in through the landing dialog is slow enough that the tour had not
     appeared yet, and it then opened on top of the first evidence click. */
  await dismissTourIfOpen(page)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/03-home.png`, fullPage: true })

  /* The attention inbox this used to assert was removed in #450: one
     deterministic band per student replaced the separate flagged-list, so the
     question "who needs me" is answered in the students card instead. */
  const bandCards = await page.locator('.tch-bands').count()
  check('the students card groups the class by band', bandCards > 0, `${bandCards} cards`)

  /* The why-toggles on Home hang off the difficulties rows, and those are now
     read over the dashboard's PERIOD rather than over all time. A fixture class
     that has not opened anything for a week therefore has no rows — correctly,
     because the alternative is telling a teacher to reteach a topic nobody has
     touched. So the assertion is conditional on there being a claim to explain,
     the same way the hard-topic panel below already is. What must never happen
     is a row WITHOUT its evidence. */
  const gapRows = await page.locator('.tch-difficulty').count()
  const whyButtons = await page.locator('.tch-evidence__toggle').count()
  if (gapRows === 0 && whyButtons === 0) {
    console.log('    (no in-period difficulties for this class — nothing to explain)')
  } else {
    check('every surface offers a "why?" disclosure', whyButtons > 0, `${whyButtons} toggles`)
  }

  if (whyButtons > 0) {
    await page.locator('.tch-evidence__toggle').first().click()
    await page.waitForTimeout(400)
    /* Three surfaces answer "why?" and each renders its own element: the
       shared evidence block, the brief's own one-line reason, and a
       recommendation's signal sentence. Pinning to `.tch-evidence__raw` alone
       failed on whichever one happened to be first on the page — the datum was
       there, under a different class.
       What actually matters is asserted below: that it reads as words. */
    const revealed = page.locator(
      '.tch-evidence__raw, .tch-brief__why, .tch-rec__because').first()
    const shown = await revealed.count() > 0
    check('expanding "why?" reveals the datum', shown)
    if (shown) {
      const text = (await revealed.innerText()).trim()
      check('and it reads as a sentence, not a payload',
            text.length > 8 && !/[{}[\]]/.test(text), text)
    }
    await page.screenshot({ path: `${OUT}/04-evidence.png` })
  }

  const stats = await page.locator('.tch-stat').count()
  check('class pulse renders stat cards', stats >= 3, `${stats} cards`)

  const gapsText = await page.locator('[data-tour="teacher.gaps"]').innerText().catch(() => '')
  check('learning gaps zone present', gapsText.length > 0)

  /* ── scope lives in the chrome ─────────────────────────────────────────────
     This used to read "class switching is a dashboard act", and the picker was
     the Home page title. It is one control in the bar now, because a teacher
     reads the roster, the tasks and the calendar of a class too — and from any
     of those, changing class meant going back to Home first. Exactly one
     anchor, wherever it lives: two would make the tour spotlight a coin toss. */
  check('there is exactly one scope control',
        await page.locator('[data-tour="teacher.scope"]').count() === 1)
  check('and it is in the app bar, beside the logo',
        await page.locator('.app-bar-left [data-tour="teacher.scope"]').count() === 1)
  check('Home no longer carries a picker of its own',
        await page.locator('.tch-home__classPick').count() === 0)

  // ── roster ────────────────────────────────────────────────────────────────
  /* The roster has two views and remembers which one this teacher chose, so a
     check pinned to `.tch-studentCard` only ever ran for an account whose
     stored preference happened to be `cards` — and the default is `table`.
     This waited 30s for a node that cannot exist and then threw, taking every
     assertion below it with it. One selector spanning both views. */
  const ROW = '.tch-studentCard, .tch-roster__row'
  await page.locator('.teacher-app-nav button').nth(1).click()
  /* The screen lands on the LIVE view now (#249); the table/cards this block
     asserts live behind the manage button. Clicking through it is deliberate —
     it also proves the live→manage door exists. */
  await page.waitForSelector('.tch-liveBar__manage', { timeout: 30000 })
  await page.locator('.tch-liveBar__manage').click()
  await page.waitForSelector(ROW, { timeout: 30000 })
  const cards = await page.locator(ROW).count()
  check('roster lists the class', cards > 0, `${cards} students`)
  await page.screenshot({ path: `${OUT}/05-roster.png`, fullPage: true })

  // filter to "needs attention"
  await page.locator('.tch-roster__filters button').nth(1).click()
  await page.waitForTimeout(600)
  const flagged = await page.locator(ROW).count()
  check('attention filter narrows the roster', flagged > 0 && flagged <= cards,
        `${flagged} of ${cards}`)
  await page.screenshot({ path: `${OUT}/06-roster-filtered.png` })

  // ── student profile: one scrolling page, no tabs ──────────────────────────
  await page.locator(ROW).first().click()
  await page.waitForSelector('.tch-student__body', { timeout: 30000 })
  check('opened a student profile', page.url().includes('/teacher/student/'), page.url())
  await page.screenshot({ path: `${OUT}/07-student-overview.png`, fullPage: true })

  const progressCells = await page.locator('.tch-status__cell').count()
  check('progress vs objectives rendered in the status band', progressCells > 0,
        `${progressCells} cells`)

  const recs = await page.locator('.tch-rec').count()
  check('tailored recommendations rendered', recs > 0, `${recs} recommendations`)

  /* The sections replace the old seven tabs — each is asserted in place, in
     reading order, instead of behind a click. */
  const kpiCards = await page.locator('.tch-student__kpis .tch-stat').count()
  // Three figures now: the mastery % moved to the status band's dials.
  check('the KPI strip has three figures', kpiCards === 3, `${kpiCards} figures`)
  check('the status band grid is present',
        await page.locator('.tch-status__grid').count() === 1)

  // Topics are data-dependent — assert the panel only when it has rows.
  const topicRows = await page.locator('.tch-topics__topic').count()
  if (topicRows > 0) {
    check('the hardest-topics panel is drawn',
          await page.locator('.tch-topics').count() === 1, `${topicRows} topics`)
  } else {
    console.log('    (no hard-topic rows for this student — panel legitimately absent)')
  }

  check('the goals card is on the page',
        await page.locator('#goals .tch-goalsCard').count() === 1)
  /* The profile arrives in pieces now — six requests, each section revealed as
     its own answers. So wait for the section rather than for a duration: the
     fixed wait above measured the page mid-stream and reported the wellbeing
     block and the doors as missing when they were merely still loading. */
  await page.waitForSelector('#wellbeing', { timeout: 20000 }).catch(() => {})
  await page.waitForSelector('.tch-student__more button', { timeout: 20000 }).catch(() => {})
  check('the wellbeing section is always mounted',
        await page.locator('#wellbeing').count() === 1)
  check('the work sits in two columns',
        await page.locator('.tch-student__columns').count() === 1)
  // The month chart, the portrait and the balance wait behind doors now.
  check('the sometimes-reading is behind doors',
        await page.locator('.tch-student__more button').count() >= 1)
  await page.screenshot({ path: `${OUT}/08-profile-sections.png`, fullPage: true })

  // ── dark mode + RTL sanity ────────────────────────────────────────────────
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/11-dark.png`, fullPage: true })

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  check('page does not scroll horizontally', overflow <= 1, `${overflow}px`)
} finally {
  await browser.close()
}

console.log(failures.length ? `\n✘ ${failures.length} failure(s)` : '\n✅ teacher app check passed')
if (failures.length) { failures.forEach((f) => console.log(`   - ${f}`)); process.exit(1) }
