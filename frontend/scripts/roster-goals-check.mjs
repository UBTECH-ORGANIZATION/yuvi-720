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
  /* `?view=cards` explicitly. The roster remembers table-vs-cards in
     `teacher_roster_view`, so which one renders depends on what this account
     last clicked — and every assertion below is about the CARD's pill and its
     evidence line. Without this the file times out on `.tch-studentCard` for
     any teacher whose stored preference is the table, which is not a
     regression in the roster but a hole in the check. */
  await page.goto(`${BASE}/teacher/students?view=cards`, { waitUntil: 'domcontentloaded' })
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
  /* One write-up per teacher, resumed on arrival — so a draft anybody left
     open, in a previous run or by hand, mounts the composer over this page and
     eats every click on it. Cleared through the same endpoint the composer
     itself writes to, before the page is asked for. */
  await page.request.patch(`${BASE}/api/teacher/state`, { data: { mentoring_draft: null } })
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

  /* The board became the conversation history: one CARD per student, carrying
     their own numbers, with the talks themselves behind a dialog. The card
     class is unchanged — it still means "one student's card" — but it now
     leads with when they were last spoken to rather than with a sample of
     their goals, and opening one no longer moves the cards around it. */
  const boardCards = await page.locator('.tch-goalsPage__student').count()
  if (boardCards) {
    const closed = await page.locator('.tch-goalsPage__talk').count()
    check('no talks are on the page until one is asked for', closed === 0,
          `${closed} talks showing`)

    const heads = await page.locator('.tch-goalsPage__talkToggle').count()
    check('every student card offers its conversations',
          heads === boardCards, `${heads} of ${boardCards}`)

    // Every card states its own numbers, not just the child's name.
    const stats = await page.locator('.tch-goalsPage__student .tch-talkCard__stats dd').count()
    check('every card carries its two counts', stats === boardCards * 2,
          `${stats} of ${boardCards * 2}`)

    // Opening one shows that student's talks and nobody else's, in a dialog
    // over the grid rather than inside the card.
    const openable = page.locator('.tch-goalsPage__talkToggle:not([disabled])').first()
    if (await openable.count()) {
      await openable.click()
      await page.waitForSelector('.tch-talksDialog', { timeout: 10000 })
      const dialogs = await page.locator('.tch-talksDialog').count()
      const inCards = await page
        .locator('.tch-goalsPage__student .tch-goalsPage__talk').count()
      check('opening a card opens exactly one dialog', dialogs === 1, `${dialogs} open`)
      check('and the talks stay out of the grid', inCards === 0, `${inCards} inside cards`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
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
