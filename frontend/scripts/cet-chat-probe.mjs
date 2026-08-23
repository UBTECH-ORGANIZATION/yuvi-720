/* The chat flow on a real CET lesson: open the lesson page as gal, let the
 * framed player emit → Kata relay (tunnel) → local ingest → SSE re-key, then
 * open the companion and read its section captions — do the accordions name
 * the right question of the lesson? */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const OUT = 'artifacts'
const b = await chromium.launch()
const ctx = await b.newContext({ locale: 'he-IL', colorScheme: 'light', viewport: { width: 1500, height: 950 } })
const page = await ctx.newPage()

const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'gal', password: 'Aa12345' } })
if (!login.ok()) throw new Error('login failed')

await page.goto(`${BASE}/learning/lesson?unit=CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE&component=CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE-00001`, { waitUntil: 'load' })
// player boot + CET state restore + Kata relay round-trip + SSE push
await page.waitForTimeout(25000)

const frame = page.frames().find((f) => f.url().includes('learning.cet.ac.il'))
console.log('player frame:', frame ? 'embedded ✔' : 'MISSING')
if (frame) {
  const text = await frame.evaluate(() => document.body?.innerText?.slice(0, 60)).catch(() => '?')
  console.log('screen shows:', String(text).replace(/\n/g, ' '))
}

await page.screenshot({ path: `${OUT}/cet-chat-01-lesson.png` })

// The companion: find its opener among the page's buttons.
const labels = await page.$$eval('button', (all) =>
  all.map((el) => el.getAttribute('aria-label') || el.textContent?.trim() || '').filter(Boolean).slice(0, 40))
console.log('buttons:', JSON.stringify(labels))

// Try the usual suspects for opening the chat.
const candidates = [
  '[aria-label*="יובי"]', '[aria-label*="Yuvi"]', '[aria-label*="שיח"]',
  '[aria-label*="צ׳אט"]', '[aria-label*="chat"]', '.sp-companion-fab',
]
let opened = false
for (const sel of candidates) {
  const el = page.locator(sel).first()
  if (await el.count()) {
    await el.click().catch(() => {})
    await page.waitForTimeout(1500)
    if (await page.locator('.sp-companion-backdrop, .sp-companion').count()) { opened = true; console.log('opened via', sel); break }
  }
}
if (!opened && await page.locator('.sp-companion').count()) opened = true
console.log('companion open:', opened)
await page.waitForTimeout(8000) // give the intro turn a moment to stream

// Read the section (accordion) captions.
const captions = await page.$$eval(
  '.sp-companion [class*="section"] [class*="head"], .sp-companion summary, .sp-companion [class*="caption"]',
  (all) => all.map((el) => el.textContent?.trim() || '').filter(Boolean).slice(0, 12)
).catch(() => [])
console.log('section captions:', JSON.stringify(captions))
await page.screenshot({ path: `${OUT}/cet-chat-02-panel.png` })
await b.close()
