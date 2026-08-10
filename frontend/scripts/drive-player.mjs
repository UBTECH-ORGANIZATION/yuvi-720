import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const url = readFileSync('/tmp/player_url.txt', 'utf8').trim()
const shot = (n) => `/tmp/player-${n}.png`
const out = []
const ok = (label, pass, detail = '') => {
  out.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return pass
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
const posted = []
page.on('request', (r) => {
  if (r.url().includes('/statements')) {
    try { posted.push(JSON.parse(r.postData()).verb.id.split('/').pop()) } catch { /* noop */ }
  }
})
page.on('console', (m) => { if (m.type() === 'error') out.push(`CONSOLE ERROR: ${m.text()}`) })
page.on('pageerror', (e) => out.push(`PAGE ERROR: ${e.message}`))

await page.goto(url, { waitUntil: 'load' })
await page.waitForSelector('.lp-card', { timeout: 15000 })

ok('player renders content-only (no app chrome)',
  (await page.locator('.lp-head').count()) === 1 && (await page.locator('nav, .app-bar').count()) === 0)
ok('progress strip shows every screen',
  (await page.locator('.lp-step').count()) > 1, `${await page.locator('.lp-step').count()} steps`)
ok('opens on the opening card (720 §1.4)',
  (await page.locator('.lp-prompt').first().innerText()).length > 5,
  (await page.locator('.lp-prompt').first().innerText()).slice(0, 60))
ok('RTL for a Hebrew learner', await page.evaluate(() => document.documentElement.dir) === 'rtl')
await page.screenshot({ path: shot('1-intro') })

// accessibility toolbar
await page.locator('.lp-tool').nth(1).click()
await page.locator('.lp-tool').nth(2).click()
ok('accessibility toolbar changes the surface',
  await page.evaluate(() => document.getElementById('root').dataset.scale) === 'large'
  && await page.evaluate(() => document.getElementById('root').dataset.contrast) === 'high')
await page.screenshot({ path: shot('2-a11y') })
await page.locator('.lp-tool').nth(2).click()
await page.locator('.lp-tool').nth(1).click()
await page.locator('.lp-tool').nth(1).click()

// forward to the first screen that asks something
const advance = async () => {
  const next = page.locator('.lp-foot .lp-btn').last()
  if (await next.isDisabled()) return false
  await next.click()
  await page.waitForTimeout(450)
  return true
}
await advance()
ok('audio screen offers play + slower', (await page.locator('.lp-play').count()) === 1
  && (await page.locator('.lp-chip').count()) >= 1)
const questionCount = await page.locator('.lp-q__text').count()
ok('questions render', questionCount > 0, `${questionCount} questions`)
ok('continue is blocked until the questions are answered (§1.5 pacing)',
  await page.locator('.lp-foot .lp-btn').last().isDisabled())
await page.screenshot({ path: shot('3-listening') })

// answer the first question, then read the feedback
const firstQ = page.locator('.lp-q').filter({ has: page.locator('.lp-options') }).last()
await firstQ.locator('.lp-option').first().click({ timeout: 10000 })
await page.waitForTimeout(900)
const verdict = await firstQ.locator('.lp-option[data-verdict]').first().getAttribute('data-verdict')
const feedback = await firstQ.locator('.lp-feedback').first().innerText()
ok('an answer is graded on the server', verdict !== null, verdict)
ok('feedback explains and points forward, with no score', feedback.length > 15 && !/\d+%|\b\d+\/\d+\b/.test(feedback),
  feedback.slice(0, 80))
ok('options lock after answering', await firstQ.locator('.lp-option').first().isDisabled())
await page.screenshot({ path: shot('4-feedback') })

// answer the rest so we can move on
for (let guard = 0; guard < 12; guard += 1) {
  const open = page.locator('.lp-option:not([disabled])')
  if ((await open.count()) === 0) break
  await open.first().click({ timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(500)
}
await page.waitForTimeout(400)
ok('continue unlocks once every question is answered',
  !(await page.locator('.lp-foot .lp-btn').last().isDisabled()))

// back navigation (§1.5)
await page.locator('.lp-foot .lp-btn').first().click()
await page.waitForTimeout(400)
ok('learner can go back to earlier content (§1.5)',
  (await page.locator('.lp-prompt').first().innerText()).length > 5)
await page.locator('.lp-step').nth(1).click()
await page.waitForTimeout(400)
ok('answers survive going back and forward',
  (await page.locator('.lp-option[data-verdict]').count()) >= 1)

// walk to the end
for (let screen = 0; screen < 10; screen += 1) {
  for (let guard = 0; guard < 12; guard += 1) {
    const open = page.locator('.lp-option:not([disabled])')
    if ((await open.count()) === 0) break
    await open.first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(500)
  }
  const at = await page.evaluate(() =>
    [...document.querySelectorAll('.lp-step')].findIndex((s) => s.dataset.state === 'current'))
  const label = await page.locator('.lp-foot .lp-btn').last().innerText()
  const stuck = await page.locator('.lp-foot .lp-btn').last().isDisabled()
  out.push(`  walk: step ${at + 1}, next="${label}"${stuck ? ' (disabled)' : ''}`)
  if (!(await advance())) break
}
await page.waitForTimeout(1800)
await page.screenshot({ path: shot('5-end') })

ok('reports xAPI with MoE verbs', posted.length > 0, posted.join(', '))
ok('reports the component-level completion', posted.includes('completed'))
ok('reports per-screen initialized (this is what makes resume work)', posted.includes('initialized'))
ok('reports answered', posted.includes('answered'))

// resume: reopen the same launch
const page2 = await browser.newPage({ viewport: { width: 1100, height: 900 } })
await page2.goto(url, { waitUntil: 'load' })
await page2.waitForSelector('.lp-card', { timeout: 15000 })
await page2.waitForTimeout(600)
const resumedStep = await page2.evaluate(() =>
  [...document.querySelectorAll('.lp-step')].findIndex((s) => s.dataset.state === 'current'))
ok('reopening resumes past the first screen (720 §1.7)', resumedStep > 0, `landed on step ${resumedStep + 1}`)
await page2.screenshot({ path: shot('6-resume') })

console.log(out.join('\n'))
console.log(out.some((l) => l.startsWith('FAIL') || l.startsWith('CONSOLE')) ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
await browser.close()
