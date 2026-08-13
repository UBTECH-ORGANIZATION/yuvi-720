/* The two floating buttons, measured rather than eyeballed.
 *
 *   cd frontend && node scripts/support-stack-check.mjs [--port 5173] [--headed]
 *
 * What a screenshot cannot prove:
 *   the support button clears the assistant dock when the dock is OPEN;
 *   it sits above the assistant launcher when the dock is CLOSED, with a real
 *     gap rather than a one-pixel kiss or an overlap;
 *   the two share a left edge exactly, in RTL and in LTR alike;
 *   and it drops back down when the dock reopens.
 *
 * Writes nothing: the direction is set the same way `I18nProvider` sets it —
 * `document.documentElement.dir` — rather than through the language preference.
 * That is deliberate. Driving it through `/api/learner-state` meant writing to
 * a real account to test a stylesheet, and it was flaky besides: the preference
 * lands after first paint, and in dev the provider loses its own bootstrap race
 * often enough that the English pass silently measured an RTL page and passed.
 */

import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '5173'
const BASE = `http://localhost:${port}`
const shots = 'scripts/.support-stack-shots'
await mkdir(shots, { recursive: true })

let passed = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { failures.push(name); console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const box = async (page, selector) => {
  const element = page.locator(selector)
  if (!(await element.count())) return null
  return element.first().boundingBox()
}

const browser = await chromium.launch({ headless: !args.includes('--headed') })

try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'gal', password: 'Aa12345' },
  })
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`)
  const page = await context.newPage()

  for (const { code, dir } of [{ code: 'he', dir: 'rtl' }, { code: 'en', dir: 'ltr' }]) {
    console.log(`\n── ${code} (${dir}) ───────────────────────────────────`)
    await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.sp-support-launch', { timeout: 60_000 })
    await page.waitForFunction(() => document.fonts.status === 'loaded').catch(() => {})

    // The one line `applyDocumentLanguage` runs. `.tch-dock` keys its side off
    // `[dir='rtl']` on this element, so this is the real switch for layout.
    await page.evaluate((want) => { document.documentElement.dir = want }, dir)
    await page.waitForTimeout(400)
    const direction = await page.evaluate(() => document.documentElement.dir)
    check(`${code}: the page really is ${dir}`, direction === dir, `dir=${direction}`)

    // ── dock OPEN (the default on a 1500px viewport) ───────────────────────
    const dock = await box(page, '.tch-dock')
    check(`${code}: the assistant dock is open to begin with`, Boolean(dock))
    const launcherWhileOpen = await box(page, '.tch-dock__launcher')
    check(`${code}: no launcher while the panel is open`, launcherWhileOpen === null)

    const seated = await box(page, '.sp-support-launch')
    check(`${code}: support sits on the LEFT edge`,
      seated.x < 24, `x=${Math.round(seated.x)}px`)
    if (dock) {
      check(`${code}: support does not overlap the open dock`,
        seated.x + seated.width <= dock.x + 1,
        `support ends at ${Math.round(seated.x + seated.width)}px, dock starts at ${Math.round(dock.x)}px`)
    }
    await page.screenshot({ path: `${shots}/${code}-dock-open.png` })

    // ── dock CLOSED → the launcher appears and support lifts ───────────────
    await page.locator('.tch-dock__head .tch-dock__iconButton').last().click()
    await page.waitForSelector('.tch-dock__launcher', { timeout: 10_000 })
    await page.waitForTimeout(400) // let the transition settle before measuring

    const launcher = await box(page, '.tch-dock__launcher')
    const lifted = await box(page, '.sp-support-launch')

    check(`${code}: the launcher is on the left too`,
      launcher.x < 24, `x=${Math.round(launcher.x)}px`)
    check(`${code}: the two share a left edge exactly`,
      Math.abs(launcher.x - lifted.x) < 1,
      `launcher ${Math.round(launcher.x)}px vs support ${Math.round(lifted.x)}px`)

    const gap = launcher.y - (lifted.y + lifted.height)
    check(`${code}: support sits ABOVE the launcher, clear of it`,
      gap > 4 && gap < 40, `gap=${Math.round(gap)}px`)
    check(`${code}: support actually moved up`,
      lifted.y < seated.y - 20,
      `${Math.round(seated.y)}px → ${Math.round(lifted.y)}px`)
    await page.screenshot({ path: `${shots}/${code}-dock-closed.png` })

    // ── the panel opens from the button, not out from under it ─────────────
    await page.locator('.sp-support-launch').click()
    await page.waitForSelector('.sp-support', { timeout: 10_000 })
    await page.waitForTimeout(300)
    const panel = await box(page, '.sp-support')
    check(`${code}: the panel clears the launcher below it`,
      panel.y + panel.height <= launcher.y + 1,
      `panel ends at ${Math.round(panel.y + panel.height)}px, launcher starts at ${Math.round(launcher.y)}px`)
    check(`${code}: the panel shares the buttons' left edge`,
      Math.abs(panel.x - lifted.x) < 1,
      `panel ${Math.round(panel.x)}px vs button ${Math.round(lifted.x)}px`)
    await page.screenshot({ path: `${shots}/${code}-panel-open.png` })
    await page.locator('.sp-support__close').click()

    // ── reopen the dock → the launcher goes, support settles back ──────────
    await page.locator('.tch-dock__launcher').click()
    await page.waitForSelector('.tch-dock', { timeout: 10_000 })
    await page.waitForTimeout(400)
    const settled = await box(page, '.sp-support-launch')
    check(`${code}: support drops back down when the panel reopens`,
      Math.abs(settled.y - seated.y) < 1,
      `${Math.round(settled.y)}px vs ${Math.round(seated.y)}px at rest`)
  }

  // ── narrow screen: the shared edge must survive the breakpoint ───────────
  console.log('\n── 380px ─────────────────────────────────────────')
  await page.setViewportSize({ width: 380, height: 780 })
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sp-support-launch', { timeout: 60_000 })
  await page.waitForTimeout(600)
  const narrowLauncher = await box(page, '.tch-dock__launcher')
  const narrowSupport = await box(page, '.sp-support-launch')
  check('380px: the launcher is showing (the dock is a drawer here)', Boolean(narrowLauncher))
  if (narrowLauncher) {
    check('380px: still one shared left edge',
      Math.abs(narrowLauncher.x - narrowSupport.x) < 1,
      `launcher ${Math.round(narrowLauncher.x)}px vs support ${Math.round(narrowSupport.x)}px`)
    const gap = narrowLauncher.y - (narrowSupport.y + narrowSupport.height)
    check('380px: still stacked, not overlapping', gap > 4 && gap < 40, `gap=${Math.round(gap)}px`)
  }
  await page.screenshot({ path: `${shots}/narrow.png` })

  console.log(`\n${failures.length ? '✘' : '✓'} ${passed} passed, ${failures.length} failed`)
  for (const name of failures) console.log(`   - ${name}`)
  console.log(`screenshots → ${shots}`)
  process.exitCode = failures.length ? 1 : 0
} finally {
  await browser.close()
}
