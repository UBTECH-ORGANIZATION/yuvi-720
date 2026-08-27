/* PBI 451 verification: the two habit scores on the teacher student profile.
 * Drives :5199 (vite.config.check.mts → backend :8721). Never networkidle —
 * the app holds SSE open. */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/score-cards'
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const browser = await chromium.launch()

async function run(lang, theme, learner = 'tamar') {
  const tag = `${lang}-${theme}-${learner}`
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()

  // Login via the API and land straight on the profile.
  await page.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'gal', password: 'Aa12345' },
  })
  await page.goto(`${BASE}/teacher/student/${learner}`, { waitUntil: 'load' })
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t)
  }, theme)
  await page.waitForSelector('.tch-status__grid', { timeout: 30000 })
  // The scores fetch resolves after the band mounts; wait for a card dial
  // (or the gated "not enough evidence" sentence).
  await page.waitForSelector(
    '.tch-status__cell--score .sp-chart-ring--half, .tch-status__cell--score .tch-status__none',
    { timeout: 30000 })
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
  await page.waitForTimeout(800)

  const cards = page.locator('.tch-status__cell--score')
  check(`${tag}: two score cards render`, await cards.count() === 2,
        `count=${await cards.count()}`)
  // The headline is the same half-dial as the subject cells (Gal, 2026-08-27).
  const dials = await cards.locator('.sp-chart-ring--half').count()
  check(`${tag}: each measured score draws the half-dial`, dials >= 1,
        `dials=${dials}`)

  await page.screenshot({ path: `${OUT}/band-${tag}.png`, fullPage: false })

  // Open the concentration dialog (first score card is concentration).
  await cards.first().locator('.tch-status__cellOpen').click()
  const dialog = page.locator('[role="dialog"].tch-scoreDialog, .tch-scoreDialog')
  await dialog.waitFor({ state: 'visible', timeout: 10000 })
  // One component: drag/strength groups of sentences and nothing else — no
  // footnote, no session panel, no weights, no gauges, no toggles.
  const lines = await dialog.locator('.tch-scoreDialog__group li').count()
  check(`${tag}: every measured signal is one sentence line`, lines >= 3,
        `lines=${lines}`)
  check(`${tag}: no unmeasured footnote`,
        await dialog.locator('.tch-scoreDialog__unmeasured').count() === 0)
  check(`${tag}: no weight labels`,
        await dialog.locator('.tch-scoreDialog__weight').count() === 0)
  check(`${tag}: no per-signal gauges in the dialog`,
        await dialog.locator('.sp-chart-ring').count() === 0)
  check(`${tag}: no evidence toggles`,
        await dialog.locator('.tch-evidence__toggle').count() === 0)
  check(`${tag}: no session-shape context panel`,
        await dialog.locator('.tch-scoreDialog__session').count() === 0)
  await page.screenshot({ path: `${OUT}/dialog-concentration-${tag}.png` })
  await page.keyboard.press('Escape')

  // Independence dialog: same shape, no session panel.
  await cards.nth(1).locator('.tch-status__cellOpen').click()
  await dialog.waitFor({ state: 'visible', timeout: 10000 })
  check(`${tag}: independence dialog has sentence lines`,
        await dialog.locator('.tch-scoreDialog__group li').count() >= 4)
  check(`${tag}: no session panel on independence`,
        await dialog.locator('.tch-scoreDialog__session').count() === 0)
  await page.screenshot({ path: `${OUT}/dialog-independence-${tag}.png` })
  await page.keyboard.press('Escape')

  // Removals: no general prose points in the read block, no recs overview.
  check(`${tag}: AI-analysis general prose lines are gone`,
        await page.locator('.tch-read__points').count() === 0)
  check(`${tag}: recommendations overview paragraph is gone`,
        await page.locator('.tch-recs__overview').count() === 0)

  await ctx.close()
}

try {
  await run('he', 'light')
  await run('en', 'dark')
} catch (error) {
  failures.push(`fatal: ${error.message}`)
} finally {
  await browser.close()
}

console.log(failures.length
  ? `\nFAILED: ${failures.length}\n${failures.map((f) => `  - ${f}`).join('\n')}`
  : '\nALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
