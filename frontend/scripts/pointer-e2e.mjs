// E2E: Yuvi points at the lesson. Logs in, opens the anchored lomda, asks
// about the picture in the companion, and asserts the overlay renders — then
// screenshots it. Run from frontend/: node scripts/pointer-e2e.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || '../backend/artifacts/pointer-e2e'
const COMPONENT = 'methodica-science-mass-measure-01-02'

const browser = await chromium.launch()
const context = await browser.newContext({
  colorScheme: 'light', viewport: { width: 1440, height: 900 },
})
const page = await context.newPage()

const fail = async (reason) => {
  await page.screenshot({ path: `${OUT}/fail.png`, fullPage: false }).catch(() => {})
  console.error(`✗ ${reason}`)
  await browser.close()
  process.exit(1)
}

// Login (dialog-scoped selectors — the landing page has its own form).
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /התחברות|כניסה|Sign in/i }).first().click().catch(() => {})
await page.waitForTimeout(800)
const dialog = page.locator('[role="dialog"]')
if (await dialog.count()) {
  await dialog.locator('input').first().fill('gal')
  await dialog.locator('input[type="password"]').fill('Aa12345')
  await dialog.locator('button[type="submit"]').click()
} else {
  // Already a login page form
  await page.locator('input').first().fill('gal')
  await page.locator('input[type="password"]').fill('Aa12345')
  await page.locator('button[type="submit"]').first().click()
}
await page.waitForTimeout(3000)

// Straight to the anchored lomda.
await page.goto(`${BASE}/learning/lesson?component=${COMPONENT}`, { waitUntil: 'load' })
await page.waitForSelector('iframe.learning-provider-frame', { timeout: 30000 })
  .catch(() => fail('lesson iframe never appeared'))
await page.waitForTimeout(8000) // player hydration + welcome turn settling

// Advance the PLAYER off the cover onto the question screen (the one with the
// photo + options) — the coach grounds on where the learner actually is.
const playerFrame = async () => {
  let best = null; let bestLength = 0
  for (const frame of page.frames()) {
    const length = await frame.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0)
    if (frame !== page.mainFrame() && length > bestLength) { best = frame; bestLength = length }
  }
  return best
}
const ADVANCE = ['אפשר להתחיל', 'המשך', 'הבא', 'התחל']
for (let step = 0; step < 3; step += 1) {
  const frame = await playerFrame()
  if (!frame) break
  const hasPhoto = await frame.evaluate(() => [...document.querySelectorAll('img')].some((img) => {
    const rect = img.getBoundingClientRect()
    return rect.width >= 120 && rect.height >= 120
  })).catch(() => false)
  if (hasPhoto) break
  let clicked = false
  for (const label of ADVANCE) {
    const buttons = frame.locator(`button:has-text("${label}"), [role="button"]:has-text("${label}")`)
    const count = await buttons.count().catch(() => 0)
    for (let i = 0; i < count; i += 1) {
      if (await buttons.nth(i).isVisible().catch(() => false)) {
        await buttons.nth(i).click().catch(() => {})
        clicked = true
        break
      }
    }
    if (clicked) break
  }
  if (!clicked) break
  await page.waitForTimeout(4000)
}
// Let the screen's xAPI reach the brain through the relay before asking.
await page.waitForTimeout(10000)

// Ask about the picture.
const input = page.locator('.sp-companion__composer input')
await input.waitFor({ timeout: 15000 }).catch(() => fail('companion composer missing'))
await input.fill('מה רואים בתמונה שעל המסך?')
// The send button disables while a proactive turn streams — wait it out.
const send = page.locator('.sp-companion__send')
await page.waitForFunction(
  () => !document.querySelector('.sp-companion__send')?.disabled,
  { timeout: 45000 },
).catch(() => fail('send button never enabled'))
await send.click()

// The pointer frame should land before/with the first sentence.
const highlight = page.locator('.lesson-point-highlight, .lesson-point-glow')
await highlight.first().waitFor({ state: 'visible', timeout: 45000 })
  .catch(() => fail('no pointer overlay rendered'))
const kind = await page.locator('.lesson-point-highlight').count() ? 'highlight' : 'glow'
await page.screenshot({ path: `${OUT}/pointer-${kind}.png` })

// It must not outlive its moment.
await page.waitForTimeout(8000)
if (await highlight.first().isVisible().catch(() => false)) {
  await fail('pointer overlay did not expire')
}

console.log(`✓ pointer overlay rendered (${kind}) and expired; screenshot in ${OUT}`)
await browser.close()
