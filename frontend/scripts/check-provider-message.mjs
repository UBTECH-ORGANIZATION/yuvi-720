/* Regression check: the native player's completion postMessage must reach a host
 * that gates on the PROVIDER shape.
 *
 * The player used to post `{type: 'yuvilab:component-complete'}`, but
 * `LessonPage.handleProviderMessage` only accepts
 * `{source: 'content-provider', event: 'component-completed'}` — so the message
 * was dropped and completion arrived only via the SSE trigger and the 5s catalog
 * poll. This asserts the shapes match, using the same guard the host applies.
 *
 *   cd backend && ./.venv/bin/python scripts/mint_player_launch.py ENG.G7.FAMILY.SPEAK-01
 *   cd frontend && node scripts/check-provider-message.mjs
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const url = readFileSync('/tmp/player_url.txt', 'utf8').trim()
const origin = new URL(url).origin

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })

// A host page on the player's own origin, so the origin check is meaningful.
await page.goto(`${origin}/content/player-assets/player.css`, { waitUntil: 'load' })
await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">
  <iframe id="f" src="${url}" style="width:1160px;height:900px;border:0"
   sandbox="allow-scripts allow-same-origin" allow="autoplay"></iframe></body>`)

await page.evaluate((providerOrigin) => {
  window.__got = []
  window.addEventListener('message', (event) => {
    if (event.origin !== providerOrigin) return
    const data = event.data
    if (typeof data !== 'object' || data === null) return
    if (data.source !== 'content-provider') return
    if (data.event === 'component-completed' || data.verb === 'completed') window.__got.push(data)
  })
}, origin)

const frame = page.frameLocator('#f')
await frame.locator('.lp-card').waitFor({ timeout: 15000 })

const forward = () => frame.locator('.lp-foot .lp-btn').last()

for (let screen = 0; screen < 12; screen += 1) {
  for (let guard = 0; guard < 12; guard += 1) {
    const open = frame.locator('.lp-option:not([disabled])')
    if ((await open.count()) === 0) break
    await open.first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(450)
  }
  if (await forward().isDisabled().catch(() => true)) { await page.waitForTimeout(300); continue }
  await forward().click({ timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(500)
  if (await page.evaluate(() => window.__got.length)) break
}
await page.waitForTimeout(1200)

const got = await page.evaluate(() => window.__got)
const pass = got.length > 0
console.log(pass
  ? `PASS  host received provider completion — ${JSON.stringify(got[0])}`
  : 'FAIL  host received no provider completion message')
await browser.close()
process.exit(pass ? 0 : 1)
