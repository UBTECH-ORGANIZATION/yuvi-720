/* Drive COMPL-00001 as a test learner and print an action timeline, so the
 * xAPI statements the CET player emits per interaction can be correlated
 * with what lands in the events store. Throwaway diagnostic. */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const COMPONENT = 'CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.COMPL-00001'
const UNIT = 'CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.COMPL'
const USER = process.env.PROBE_USER || 'moti'

const stamp = (label) => console.log(`${new Date().toISOString()} | ${label}`)

const browser = await chromium.launch()
const page = await (await browser.newContext({
  colorScheme: 'light', viewport: { width: 1600, height: 950 },
})).newPage()

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /התחברות|כניסה|Sign in/i }).first().click().catch(() => {})
await page.waitForTimeout(800)
const dialog = page.locator('[role="dialog"]')
await dialog.locator('input').first().fill(USER)
await dialog.locator('input[type="password"]').fill('Aa12345')
await dialog.locator('button[type="submit"]').click()
await page.waitForTimeout(3000)

stamp('opening lesson')
await page.goto(`${BASE}/learning/lesson?unit=${UNIT}&component=${COMPONENT}`, { waitUntil: 'load' })
await page.waitForSelector('iframe.learning-provider-frame', { timeout: 30000 })
await page.waitForTimeout(12000)
stamp('player loaded')

const playerFrame = async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let best = null; let bestLength = 0
    for (const frame of page.frames()) {
      const length = await frame.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0)
      if (frame !== page.mainFrame() && length > bestLength) { best = frame; bestLength = length }
    }
    if (best) return best
    await page.waitForTimeout(1000)
  }
  throw new Error('player frame never appeared')
}

const describeScreen = async (frame) => frame.evaluate(() => {
  const text = (document.body?.innerText || '').replace(/\s+/g, ' ')
  return text.slice(0, 110)
})

let frame = await playerFrame()
stamp(`screen: ${await describeScreen(frame)}`)

for (const target of ['2', '3']) {
  frame = await playerFrame()
  const nav = frame.locator(`button[class*="navigationBarItem"]:has-text("${target}")`).first()
  const moved = await nav.click({ force: true, timeout: 5000 })
    .then(() => true).catch((e) => { stamp(`nav click failed: ${e.message.slice(0, 60)}`); return false })
  stamp(moved ? `navigated → page ${target}` : `no nav control for page ${target}`)
  await page.waitForTimeout(9000)
  frame = await playerFrame()
  stamp(`screen: ${await describeScreen(frame)}`)
}

// The refresh scenario: reopen the lesson — the player resumes to the saved
// page. What (if anything) does it emit about WHERE it resumed?
stamp('reloading the lesson (resume probe)')
await page.goto(`${BASE}/learning/lesson?unit=${UNIT}&component=${COMPONENT}`, { waitUntil: 'load' })
await page.waitForTimeout(14000)
frame = await playerFrame()
stamp(`resumed screen: ${await describeScreen(frame)}`)

stamp('done, closing')
await browser.close()
