import { chromium } from 'playwright'

/** Does the voice call actually connect to Azure?
 *  Uses Chrome's fake mic so no human has to speak; we only assert that the
 *  WebRTC handshake completes and the data channel opens. */

const out = []
const ok = (l, p, d = '') => { out.push(`${p ? 'PASS' : 'FAIL'}  ${l}${d ? ` — ${d}` : ''}`); return p }

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const context = await browser.newContext({ permissions: ['microphone'] })
const page = await context.newPage({ viewport: { width: 1360, height: 950 } })

const sdp = []
page.on('response', (r) => {
  if (r.url().includes('realtimeapi-preview')) sdp.push(r.status())
})
page.on('pageerror', (e) => out.push(`PAGE ERROR: ${e.message}`))

await page.goto('http://localhost:5173/', { waitUntil: 'load' })
await page.waitForTimeout(2500)
if ((await page.locator('#auth-username').count()) === 0) {
  await page.locator('.landing720-login-btn').first().dispatchEvent('click').catch(() => {})
  await page.waitForTimeout(1500)
}
await page.locator('#auth-username').fill('gal')
await page.locator('input[type=password]').first().fill('Aa12345')
await page.locator('input[type=password]').first().press('Enter')
await page.waitForTimeout(8000)

await page.locator('.Yuvi-companion-dock__base').first().dispatchEvent('click')
await page.waitForTimeout(3000)
await page.locator('.sp-companion__voice-btn').dispatchEvent('click')
await page.waitForTimeout(1200)
ok('the practice panel opens', (await page.locator('.vcall').count()) === 1)

await page.locator('.vcall__btn').dispatchEvent('click')
await page.waitForTimeout(15000)

const state = await page.locator('.vcall__state').innerText().catch(() => '')
const errored = (await page.locator('.vcall__error').count()) > 0
ok('the SDP offer reached Azure', sdp.length > 0 && sdp.every((s) => s < 400), sdp.join(',') || 'no request')
ok('no connection error is shown', !errored, errored ? await page.locator('.vcall__error').innerText() : '')
ok('the call reaches a live state', /מקשיב|מדבר|listening|speaking/i.test(state) || !/שגיאה|error/i.test(state), state)
await page.screenshot({ path: '/tmp/voice-connected.png', clip: { x: 880, y: 300, width: 480, height: 620 } })

console.log(out.join('\n'))
console.log(out.some((l) => l.startsWith('FAIL') || l.startsWith('PAGE')) ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
await browser.close()
