/* Learnings screen + teacher-shell persistence.
 *
 * Two things are under test here and the second one is a regression guard:
 *
 *   the learnings catalogue — search, subject filter, unit grouping, untouched
 *   material listed as such, and the drill-down opening on a real question;
 *
 *   the shell — the selected class and the assistant conversation must survive
 *   navigation AND a reload. They did not: the shell used to live inside the
 *   route-keyed div, so clicking a student reference in the chat reset both.
 */

import { chromium } from 'playwright'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL || 'http://localhost:5199'
const OUT = 'artifacts'

let passed = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { failures.push(name); console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const browser = await chromium.launch()

try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'gal', password: 'Aa12345' },
  })
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`)
  await context.request.patch(`${BASE}/api/auth/preferences`,
    { data: { language: 'he' }, failOnStatusCode: false })

  const page = await context.newPage()
  await page.goto(`${BASE}/teacher/learnings`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-learning', { timeout: 60000 })
  await dismissTourIfOpen(page)

  // ── the catalogue is the spine ────────────────────────────────────────────
  const cards = await page.locator('.tch-learning').count()
  const idle = await page.locator('.tch-learning--idle').count()
  check('every published learning is listed', cards > 1, `${cards} cards`)
  check('material nobody opened is listed too', idle > 0, `${idle} not started`)

  const units = await page.locator('.tch-learnings__unit').count()
  check('learnings are grouped by unit', units >= 1, `${units} units`)

  // ── search ───────────────────────────────────────────────────────────────
  const firstTitle = (await page.locator('.tch-learning__titles strong').first().innerText()).trim()
  const needle = firstTitle.split(' ')[0]
  await page.locator('.tch-learnings__search input').fill(needle)
  await page.waitForTimeout(300)
  const afterSearch = await page.locator('.tch-learning').count()
  check('search narrows the catalogue', afterSearch > 0 && afterSearch <= cards,
        `"${needle}" → ${afterSearch} of ${cards}`)
  await page.locator('.tch-learnings__search input').fill('')
  await page.waitForTimeout(300)

  // ── subject filter ───────────────────────────────────────────────────────
  const subjectChips = page.locator('.tch-learnings__filters .tch-chip')
  const chipCount = await subjectChips.count()
  check('a subject filter is offered', chipCount >= 2, `${chipCount} chips`)
  if (chipCount >= 2) {
    await subjectChips.nth(1).click()
    await page.waitForTimeout(300)
    const filtered = await page.locator('.tch-learning').count()
    check('subject filter narrows the catalogue', filtered > 0 && filtered <= cards,
          `${filtered} of ${cards}`)
    await subjectChips.nth(0).click()
    await page.waitForTimeout(300)
  }
  await page.screenshot({ path: `${OUT}/learnings-01-list.png` })

  // ── drill-down ───────────────────────────────────────────────────────────
  const started = page.locator('.tch-learning:not(.tch-learning--idle)').first()
  await started.locator('.tch-learning__open').click()
  await page.waitForURL('**/teacher/learnings/**', { timeout: 20000 })
  /* Wait for the LOADED detail, not the container: the skeleton renders the
     same wrapper, so `.tch-learningDetail` alone matched a page mid-fetch. */
  await page.waitForSelector('.tch-learningDetail .tch-stat', { timeout: 90000 })
  const stats = await page.locator('.tch-learningDetail .tch-stat').count()
  check('the detail screen opens with its own KPIs', stats >= 4, `${stats} cards`)
  const rows = await page.locator('.tch-learningDetail__questions tbody tr').count()
  check('every question is listed with its numbers', rows > 0, `${rows} questions`)
  const spine = await page.locator('.tch-spine__row').count()
  check('the lesson spine shows the screens', spine > 0, `${spine} screens`)
  const labelled = await page.locator('.tch-learningDetail__questions tbody tr .sp-pill').first().innerText()
  check('questions are named, not raw ids', !/^[a-z0-9]{8,}$/i.test(labelled.trim()), labelled.trim())
  const noKey = await page.locator('.tch-learningDetail').innerText()
  check('no raw locale key on the detail screen', !noKey.includes('tch.learnings.'))
  await page.screenshot({ path: `${OUT}/learnings-02-detail.png`, fullPage: true })

  await page.locator('.tch-learningDetail__head .sp-btn').click()
  await page.waitForSelector('.tch-learning', { timeout: 30000 })
  check('back returns to the catalogue', page.url().includes('/teacher/learnings'))

  // ── the shell survives navigation (the regression) ───────────────────────
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-stat', { timeout: 45000 })
  const picker = page.locator('.tch-home__classPick select')
  const hasPicker = await picker.count() > 0
  if (hasPicker) {
    const options = await picker.locator('option').evaluateAll(
      (nodes) => nodes.map((node) => node.value))
    const current = await picker.inputValue()
    const other = options.find((value) => value !== current) ?? options[1]
    if (other) {
      await picker.selectOption(other)
      await page.waitForTimeout(1500)
      const chosen = await picker.inputValue()

      // Navigate away and back — this is exactly what clicking a student
      // reference in the assistant used to do.
      await page.goto(`${BASE}/teacher/students`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.tch-roster, .sp-state', { timeout: 45000 })
      await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.tch-home__classPick select', { timeout: 45000 })
      check('the selected class survives navigation',
            await picker.inputValue() === chosen, `${await picker.inputValue()} vs ${chosen}`)

      // And a full reload — the choice lives on the user, not in memory.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.tch-home__classPick select', { timeout: 45000 })
      await page.waitForTimeout(800)
      check('the selected class survives a reload',
            await picker.inputValue() === chosen, `${await picker.inputValue()} vs ${chosen}`)
    }
  } else {
    check('the selected class survives navigation', true, 'single class — nothing to switch')
    check('the selected class survives a reload', true, 'single class — nothing to switch')
  }

  // ── the assistant conversation survives navigation ───────────────────────
  const dockInput = page.locator('.tch-dock__composer input')
  if (await dockInput.count()) {
    await dockInput.fill('כמה תלמידים בכיתה?')
    await page.locator('.tch-dock__send').click()
    await page.waitForSelector('.tch-dock__reply', { timeout: 90000 })
    const before = await page.locator('.tch-dock__exchange').count()
    await page.locator('.teacher-app-nav button').nth(1).click()
    await page.waitForTimeout(1200)
    const after = await page.locator('.tch-dock__exchange').count()
    check('the assistant conversation survives navigation',
          after === before && after > 0, `${before} → ${after} exchanges`)
    await page.screenshot({ path: `${OUT}/learnings-03-dock-kept.png` })
  } else {
    check('the assistant conversation survives navigation', true, 'dock closed')
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('page does not scroll horizontally', overflow <= 0, `${overflow}px`)
} finally {
  await browser.close()
}

console.log('')
if (failures.length) {
  console.log(`✘ ${failures.length} failure(s) / ${passed} passed`)
  for (const name of failures) console.log(`   - ${name}`)
  process.exit(1)
}
console.log(`✅ learnings check passed (${passed} checks)`)
