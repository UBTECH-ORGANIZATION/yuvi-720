// E2E: Yuvi points at the lesson. Logs in, opens the anchored lomda, asks
// about the picture in the companion, and asserts the overlay renders AND
// actually covers the photo (Playwright composes cross-frame geometry into
// page coordinates, so misplacement is measurable) — then screenshots it.
// Run from frontend/: node scripts/pointer-e2e.mjs
// VIEWPORT=1920x1080 exercises a different window size (the interpolation).
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || '../backend/artifacts/pointer-e2e'
const COMPONENT = 'methodica-science-mass-measure-01-02'
const [VIEW_W, VIEW_H] = (process.env.VIEWPORT || '1440x900')
  .split('x').map((v) => Number(v) || 0)

const browser = await chromium.launch()
const context = await browser.newContext({
  colorScheme: 'light', viewport: { width: VIEW_W || 1440, height: VIEW_H || 900 },
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
// The question screen is recognizable by its ANSWER controls — a big image
// alone is not proof (the video cover carries a poster image too).
const questionOnScreen = (frame) => frame.evaluate(() =>
  [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], .h5p-answer')]
    .some((el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }))
for (let step = 0; step < 6; step += 1) {
  const frame = await playerFrame()
  if (!frame) break
  if (await questionOnScreen(frame).catch(() => false)) break
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

// Capture the actual pointer frame for diagnosis.
await page.evaluate(() => {
  window.addEventListener('yuvilab:coach-point', (e) => {
    window.__lastPointer = e.detail
  })
})

// The pointer frame should land before/with the first sentence.
const highlight = page.locator('.lesson-point-highlight, .lesson-point-glow')
await highlight.first().waitFor({ state: 'visible', timeout: 45000 })
  .catch(() => fail('no pointer overlay rendered'))
const kind = await page.locator('.lesson-point-highlight').count() ? 'highlight'
  : await page.locator('.lesson-point-edge').count() ? 'edge' : 'glow'
await page.screenshot({ path: `${OUT}/pointer-${kind}-${VIEW_W}.png` })
const detail = await page.evaluate(() => window.__lastPointer || null)
const wrapBox = await page.locator('.learning-player-frame-wrap').boundingBox().catch(() => null)
console.log('pointer frame:', JSON.stringify({
  region: detail?.region, question_key: detail?.question_key,
  breakpoints: detail?.breakpoints?.length,
}), '| wrap box:', JSON.stringify(wrapBox))

// A precise highlight must sit ON the thing it points at. The target lives
// in the cross-origin frame, but Playwright composes its box into page
// coordinates — so the overlay's rect and the pointed region's real elements
// are comparable, and a misplacement (capture geometry mapped onto the wrong
// window size) fails loudly instead of photographing nicely. Probed by the
// REGION the coach actually chose, not by assumption.
const REGION_PROBES = {
  image: 'img',
  video: 'video',
  diagram: 'canvas, svg[width], embed, object',
  options: 'input[type="radio"], input[type="checkbox"], .h5p-answer, [class*="answer" i][class*="style" i]',
  input: 'select, [role="combobox"], [class*="combobox" i], [class*="cloze" i]',
}
if (kind === 'highlight' && detail?.region && REGION_PROBES[detail.region]) {
  const frame = await playerFrame()
  const handles = frame
    ? await frame.locator(REGION_PROBES[detail.region]).elementHandles().catch(() => [])
    : []
  let union = null
  for (const handle of handles) {
    const box = await handle.boundingBox().catch(() => null)
    if (!box || box.width < 30 || box.height < 20) continue
    union = union ? {
      x: Math.min(union.x, box.x), y: Math.min(union.y, box.y),
      x2: Math.max(union.x2, box.x + box.width), y2: Math.max(union.y2, box.y + box.height),
    } : { x: box.x, y: box.y, x2: box.x + box.width, y2: box.y + box.height }
  }
  const markBox = await page.locator('.lesson-point-highlight').boundingBox()
  if (union && markBox) {
    const ix = Math.min(markBox.x + markBox.width, union.x2) - Math.max(markBox.x, union.x)
    const iy = Math.min(markBox.y + markBox.height, union.y2) - Math.max(markBox.y, union.y)
    const overlap = Math.max(0, ix) * Math.max(0, iy)
    const smaller = Math.min(
      markBox.width * markBox.height,
      (union.x2 - union.x) * (union.y2 - union.y))
    if (overlap / smaller < 0.4) {
      await fail(`highlight misses its ${detail.region}: mark ${JSON.stringify(markBox)} `
        + `vs region union ${JSON.stringify(union)}`)
    }
    console.log(`✓ highlight covers the real ${detail.region} `
      + `(overlap ${Math.round((overlap / smaller) * 100)}%)`)
  }
}

// It holds until dismissed — no clock. The chip closes it.
await page.waitForTimeout(8000)
if (!(await highlight.first().isVisible().catch(() => false))) {
  await fail('pointer overlay vanished without a dismiss')
}
await page.locator('.lesson-point-dismiss').click()
await page.waitForTimeout(500)
if (await highlight.first().isVisible().catch(() => false)) {
  await fail('dismiss chip did not close the pointer')
}

console.log(`✓ pointer overlay rendered (${kind}), held, and dismissed; screenshot in ${OUT}`)
await browser.close()
