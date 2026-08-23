/* Does the CET player still reload-loop inside a cross-site iframe?
 *
 * Reproduces the exact production situation: our page on localhost frames
 * learning.cet.ac.il with the real launch URL (passed as argv — it carries a
 * live launch token, never hard-code it). The 2026-08-02 loop ran ~6 loads
 * per 15s through auth.cet.ac.il/v2/logout; embedGuard trips at 4 in 15s.
 * We watch every frame navigation for 35s and report the verdict.
 */
import { chromium } from 'playwright'

const url = process.argv[2]
if (!url) { console.error('usage: node cet-embed-probe.mjs <player_url>'); process.exit(2) }

const b = await chromium.launch()
const ctx = await b.newContext({ locale: 'he-IL' })
const page = await ctx.newPage()

const navs = []
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) return
  navs.push({ at: Date.now(), url: frame.url() })
  console.log(`  nav ${navs.length}: ${frame.url().slice(0, 110)}`)
})

await page.setContent(`<!doctype html><iframe id="f" style="width:1200px;height:800px" src="${url.replace(/"/g, '&quot;')}"></iframe>`)
await page.waitForTimeout(35_000)

const frame = page.frames().find((f) => f !== page.mainFrame())
const finalUrl = frame ? frame.url() : '(no frame)'
const bounced = navs.filter((n) => /logout|timeout|auth\.cet/.test(n.url)).length
const windowed = navs.filter((n) => n.at > Date.now() - 15_000).length

console.log('---')
console.log(`total child-frame navigations in 35s: ${navs.length}`)
console.log(`navigations through logout/timeout: ${bounced}`)
console.log(`navigations in the final 15s window: ${windowed} (embedGuard storm threshold: 4)`)
console.log(`final frame URL: ${finalUrl.slice(0, 160)}`)
if (frame) {
  const text = await frame.evaluate(() => document.body?.innerText?.slice(0, 300)).catch(() => '(cross-origin, cannot read)')
  console.log(`frame body text: ${JSON.stringify(text)}`)
}
await page.screenshot({ path: process.env.SHOT || '/tmp/cet-embed-probe.png' })
console.log(navs.length >= 4 && windowed >= 4 ? 'VERDICT: still storming' : navs.length <= 3 ? 'VERDICT: stable — loaded and stayed' : 'VERDICT: settled after initial bounces')
await b.close()
