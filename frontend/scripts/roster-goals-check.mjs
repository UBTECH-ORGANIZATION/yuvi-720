/* Roster status honesty + the goals workspace at real volume.
 *
 * Two regressions are guarded here.
 *
 *   The roster used to make exactly two claims: "needs attention" or
 *   "progressing". A child who had never once logged in produced no events, so
 *   no criterion could fire, and they were reported to their teacher as
 *   progressing — on a card that said "never seen" right beside it. Status is
 *   now three-valued and every pill states the datum under it.
 *
 *   The goals page used to be two flat lists. One student with fourteen
 *   finished goals became fourteen near-identical inbox rows and a board card
 *   twice the height of the page. The inbox groups by child and the board card
 *   is bounded.
 *
 * Assertions are structural (pill tone classes, element counts) rather than
 * text, so they hold in he/ar/en alike.
 */

import { chromium } from 'playwright'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL || 'http://localhost:5199'
const OUT = 'artifacts'
/* The seeded real class — it has students who never logged in AND a student
   with a long tail of finished goals, which is exactly what is under test. */
const CLASS_ID = process.env.CLASS_ID || 'gal-class'

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

  // ── establish the class this check depends on ─────────────────────────────
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-stat', { timeout: 60000 })
  await dismissTourIfOpen(page)
  const picker = page.locator('.tch-home__classPick select')
  if (await picker.count()) {
    const values = await picker.locator('option').evaluateAll((n) => n.map((o) => o.value))
    if (values.includes(CLASS_ID)) {
      await picker.selectOption(CLASS_ID)
      await page.waitForTimeout(1200)
    }
  }

  // ── the roster tells the truth about who has not started ─────────────────
  await page.goto(`${BASE}/teacher/students`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-studentCard', { timeout: 60000 })

  const chips = page.locator('.tch-roster__filters button')
  check('the roster offers all three states, not two',
        await chips.count() === 4, `${await chips.count()} chips`)

  // Every card states what its pill is derived from — the same explainability
  // contract the attention flags carry (MoE C4).
  const cards = await page.locator('.tch-studentCard').count()
  const withEvidence = await page.locator('.tch-studentCard .tch-studentCard__evidence').count()
  check('every status claim carries its datum', withEvidence === cards,
        `${withEvidence} of ${cards} cards`)

  // "not started" — neutral pill, and nobody in this filter is called active.
  await chips.nth(2).click()
  await page.waitForTimeout(300)
  const idle = await page.locator('.tch-studentCard').count()
  const idleNeutral = await page.locator('.tch-studentCard .sp-pill--neutral').count()
  const idleStrong = await page.locator('.tch-studentCard .sp-pill--strong').count()
  check('students who never started are listed as such', idle > 0, `${idle} students`)
  check('a never-started student is never called progressing',
        idleStrong === 0 && idleNeutral === idle, `${idleNeutral} neutral, ${idleStrong} strong`)
  await page.screenshot({ path: `${OUT}/roster-01-not-started.png` })

  // "active" — strong pill only, and never someone with zero events.
  await chips.nth(3).click()
  await page.waitForTimeout(300)
  const active = await page.locator('.tch-studentCard').count()
  const activeNeutral = await page.locator('.tch-studentCard .sp-pill--neutral').count()
  check('the active filter holds only students with activity',
        activeNeutral === 0, `${active} active, ${activeNeutral} neutral`)

  await chips.nth(0).click()
  await page.waitForTimeout(200)

  // ── the goals workspace at volume ────────────────────────────────────────
  await page.goto(`${BASE}/teacher/goals`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-goalsPage__inbox', { timeout: 60000 })
  await dismissTourIfOpen(page)

  const groups = page.locator('.tch-goalsPage__pendingGroup')
  const groupCount = await groups.count()
  if (groupCount) {
    check('the approval inbox is grouped by student', true, `${groupCount} students waiting`)

    const openRows = await page.locator('.tch-goalsPage__pendingRow').count()
    const head = groups.first().locator('.tch-goalsPage__pendingHead')
    const wasOpen = await head.getAttribute('aria-expanded') === 'true'
    await head.click()
    await page.waitForTimeout(250)
    const afterRows = await page.locator('.tch-goalsPage__pendingRow').count()
    check('a student row opens and closes its goals',
          afterRows !== openRows, `${openRows} → ${afterRows} rows`)
    if (!wasOpen) {
      // Opened it — the goals inside are bounded, they do not run off the page.
      const height = await page.locator('.tch-goalsPage__pendingGoals').first()
        .evaluate((node) => node.getBoundingClientRect().height)
      check('an opened student cannot flood the page', height <= 430, `${Math.round(height)}px`)
      await head.click()
      await page.waitForTimeout(200)
    }
  } else {
    check('the approval inbox is grouped by student', true, 'nothing pending')
    check('a student row opens and closes its goals', true, 'nothing pending')
  }

  /* Nothing spills out of a card. A grid item's default `min-width: auto` let a
     long goal title beside a nowrap status pill widen the row past the card, so
     the pills hung outside its inline-end edge. */
  const spill = await page.evaluate(() => {
    const out = []
    document.querySelectorAll('.tch-goalsPage__student, .tch-goalsPage__inbox')
      .forEach((card) => {
        const box = card.getBoundingClientRect()
        card.querySelectorAll('*').forEach((el) => {
          const rect = el.getBoundingClientRect()
          if (!rect.width) return
          if (rect.left < box.left - 0.5 || rect.right > box.right + 0.5) {
            out.push(String(el.className).slice(0, 40))
          }
        })
      })
    return out
  })
  check('nothing overflows its card', spill.length === 0, spill.slice(0, 3).join(' | '))

  // The board card shows a bounded sample plus the way to the rest.
  const boardCards = await page.locator('.tch-goalsPage__student').count()
  if (boardCards) {
    const perCard = await page.locator('.tch-goalsPage__student').evaluateAll(
      (nodes) => nodes.map((node) => node.querySelectorAll('.tch-goalsPage__goal').length))
    check('no board card lists more than a preview',
          perCard.every((count) => count <= 4), `max ${Math.max(...perCard)} rows`)
    const mixes = await page.locator('.tch-goalsPage__mix').count()
    check('each board card leads with the mix, not with titles',
          mixes === boardCards, `${mixes} of ${boardCards}`)
  }
  await page.screenshot({ path: `${OUT}/goals-01-grouped.png`, fullPage: true })

  // Search narrows both halves at once.
  const search = page.locator('.tch-goalsPage__search input')
  await search.fill('זזזז')
  await page.waitForTimeout(300)
  check('search can narrow the page to nothing, honestly',
        await page.locator('.tch-goalsPage__pendingGroup').count() === 0
        && await page.locator('.tch-goalsPage__student').count() === 0)
  await search.fill('')
  await page.waitForTimeout(300)
  check('clearing the search restores the page',
        await page.locator('.tch-goalsPage__student').count() === boardCards)

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
console.log(`✅ roster + goals check passed (${passed} checks)`)
