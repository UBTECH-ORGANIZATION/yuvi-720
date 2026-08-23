/* Drive the teacher lomda-preview end to end: the corner button on a learnings
 * card and the header button on the detail page, each opening the iframe
 * dialog, and closing lands back where we were. */
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = 'artifacts'
const b = await chromium.launch()
const ctx = await b.newContext({ locale: 'he-IL', colorScheme: 'light', viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const login = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { username: 'gal', password: 'Aa12345' },
})
if (!login.ok()) throw new Error('login failed')

// ── the list: every card carries the corner preview button ──────────────────
await page.goto(`${BASE}/teacher/learnings`, { waitUntil: 'load' })
await page.waitForSelector('.tch-learning', { timeout: 20000 })
const buttons = await page.locator('.tch-learning__preview').count()
const cards = await page.locator('.tch-learning').count()
console.log(`cards: ${cards}, preview buttons: ${buttons}`)

await page.locator('.tch-learning__preview').first().click()
await page.waitForSelector('.tch-preview__modal', { timeout: 10000 })
await page.waitForSelector('.tch-preview__frame', { timeout: 20000 })
await page.waitForTimeout(4000) // let the lomda paint inside the frame
await page.screenshot({ path: `${OUT}/preview-01-card.png` })
console.log('card dialog: frame present')

// closing returns to the list exactly as it was
await page.locator('.tch-preview__modal .sp-btn').first().click()
await page.waitForTimeout(300)
console.log('closed, still on list:', page.url().includes('/teacher/learnings'),
  '| cards still rendered:', await page.locator('.tch-learning').count())

// ── the detail page: the header button at the far corner ───────────────────
await page.locator('.tch-learning__open').first().click()
await page.waitForSelector('.tch-learningDetail__topRow', { timeout: 20000 })
const headerButtons = await page.locator('.tch-learningDetail__topRow .sp-btn').count()
console.log(`detail header buttons (back + preview): ${headerButtons}`)
await page.locator('.tch-learningDetail__topRow .sp-btn').nth(1).click()
await page.waitForSelector('.tch-preview__frame', { timeout: 20000 })
await page.waitForTimeout(4000)
await page.screenshot({ path: `${OUT}/preview-02-detail.png` })
console.log('detail dialog: frame present')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
console.log('escape closed it:', (await page.locator('.tch-preview__modal').count()) === 0,
  '| still on detail:', await page.locator('.tch-learningDetail').count() === 1)

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
console.log(errors.length ? `PAGE ERRORS: ${errors}` : 'no page errors')
await b.close()
