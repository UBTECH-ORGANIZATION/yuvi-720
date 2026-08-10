import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const url = readFileSync('/tmp/player_url.txt', 'utf8').trim()
const out = []
const ok = (l, p, d = '') => { out.push(`${p ? 'PASS' : 'FAIL'}  ${l}${d ? ` — ${d}` : ''}`); return p }

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-fake-ui-for-media-capture', '--use-fake-device-for-media-stream'],
})
const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1100, height: 980 } })
const page = await context.newPage()
page.on('pageerror', (e) => out.push(`PAGE ERROR: ${e.message}`))
await page.goto(url, { waitUntil: 'load' })
await page.waitForSelector('.lp-card', { timeout: 15000 })

// walk to the first speaking screen
let found = false
for (let i = 0; i < 8; i += 1) {
  if (await page.locator('.lp-mic').count()) { found = true; break }
  // Answer whatever this screen asks, then move on — the speaking item sits
  // behind a listening item that gates the Continue button.
  for (let guard = 0; guard < 10; guard += 1) {
    const open = page.locator('.lp-option:not([disabled])')
    if ((await open.count()) === 0) break
    await open.first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(500)
  }
  const next = page.locator('.lp-foot .lp-btn').last()
  if (await next.isDisabled()) break
  await next.click(); await page.waitForTimeout(600)
}
ok('a speaking screen exists in the authored unit', found)
if (found) {
  ok('the model sentence can be played', (await page.locator('.lp-line').count()) > 0,
    (await page.locator('.lp-line').first().innerText()).slice(0, 60))
  ok('a microphone button is offered', (await page.locator('.lp-mic').count()) === 1,
    await page.locator('.lp-mic').innerText())
  await page.screenshot({ path: '/tmp/speaking-1.png' })

  await page.locator('.lp-mic').click()
  await page.waitForTimeout(9000)
  const status = (await page.locator('.lp-mic').innerText()) + ' ' + (await page.locator('.lp-q .lp-note').last().innerText().catch(() => ''))
  ok('the SDK loaded and a real attempt ran', !/PAGE ERROR/.test(out.join('')), status.replace(/\s+/g, ' ').slice(0, 90))
  ok('a silent microphone does not dead-end the learner',
    !(await page.locator('.lp-foot .lp-btn').last().isDisabled()))
  await page.screenshot({ path: '/tmp/speaking-2.png' })
}
console.log(out.join('\n'))
console.log(out.some((l) => l.startsWith('FAIL') || l.startsWith('PAGE')) ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
await browser.close()
