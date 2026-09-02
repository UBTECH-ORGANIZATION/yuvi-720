/* Walks the first-lesson tour and photographs every step, for review by a
 * human rather than by assertions. `lesson-tour-check.mjs` decides whether the
 * tour is correct; this one only shows what a child actually sees.
 *
 * Never `waitUntil: 'networkidle'` — the learner shell holds an SSE connection.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dismissCheckin } from './lib/checkin.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/lesson-tour-walk'
const LEARNER = 'gal'
const TOUR = 'lesson.v1'
const UNIT = 'CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE'
const COMPONENT = `${UNIT}-00001`
const LESSON = `${BASE}/learning/lesson?unit=${UNIT}&component=${COMPONENT}`
mkdirSync(OUT, { recursive: true })

const resetTour = () => {
  execFileSync('./.venv/bin/python', ['scripts/reset_tour.py', LEARNER, TOUR],
               { cwd: '../backend', stdio: 'pipe' })
}

const settle = (page) => page.waitForFunction(() => {
  if (!document.querySelector('.sp-tour__card')) return true
  const hole = document.querySelector('.sp-tour__hole')
  if (!hole) return false
  const now = `${hole.getAttribute('x')},${hole.getAttribute('y')},${hole.getAttribute('width')}`
  const stable = window.__walkLast === now
  window.__walkLast = now
  return stable
}, undefined, { timeout: 20000, polling: 400 }).catch(() => {})

/** Scored, not first-match: the raise-hand button lives inside the composer. */
const spotlitName = (page) => page.evaluate(() => {
  const hole = document.querySelector('.sp-tour__hole')
  if (!hole) return null
  const x = Number(hole.getAttribute('x'))
  const y = Number(hole.getAttribute('y'))
  const w = Number(hole.getAttribute('width'))
  const h = Number(hole.getAttribute('height'))
  let best = null
  let bestScore = Infinity
  for (const node of document.querySelectorAll('[data-tour]')) {
    const b = node.getBoundingClientRect()
    if (!b.width && !b.height) continue
    const score = Math.abs(b.left - x) + Math.abs(b.top - y)
      + Math.abs(b.width - w) + Math.abs(b.height - h)
    if (score < bestScore) { bestScore = score; best = node }
  }
  return bestScore <= 80 ? best?.getAttribute('data-tour') ?? null : null
})

const browser = await chromium.launch()

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const login = await context.request.post(`${BASE}/api/auth/login`,
    { data: { username: LEARNER, password: 'Aa12345' } })
  if (!login.ok()) throw new Error(`login failed for ${LEARNER}: ${login.status()}`)
  await context.request.patch(`${BASE}/api/auth/preferences`,
    { data: { language: 'he' }, failOnStatusCode: false })
  resetTour()

  const page = await context.newPage()
  await page.goto(LESSON, { waitUntil: 'domcontentloaded' })
  await dismissCheckin(page).catch(() => {})
  await page.waitForSelector('[data-tour="learner.lessonStage"]', { timeout: 60000 })
  await page.waitForSelector('.sp-tour__card', { timeout: 45000 })
  await settle(page)

  for (let step = 1; step <= 12; step += 1) {
    if ((await page.locator('.sp-tour__card').count()) === 0) break
    const name = await spotlitName(page)
    const text = (await page.locator('.sp-tour__card').innerText()).split('\n')
    const label = String(step).padStart(2, '0')
    await page.screenshot({ path: `${OUT}/step-${label}.png` })
    console.log(`\n── step ${step} ${name ? `→ ${name}` : '(no spotlight — centred)'}`)
    console.log(text.filter(Boolean).map((l) => `   ${l}`).join('\n'))

    if (name === 'learner.companion') {
      await page.locator('.Yuvi-companion-dock').click({ timeout: 5000 }).catch(() => {})
      await page.waitForSelector('[data-tour="learner.lessonAsk"]', { timeout: 15000 })
        .catch(() => {})
      await page.waitForTimeout(900)
      await settle(page)
      continue
    }
    await page.locator('.sp-tour__actions .sp-btn--primary').click()
    await page.waitForTimeout(700)
    await settle(page)
  }

  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/step-after.png` })
  console.log('\n── tour closed; lesson left open')
  await context.close()
} finally {
  await browser.close()
}
