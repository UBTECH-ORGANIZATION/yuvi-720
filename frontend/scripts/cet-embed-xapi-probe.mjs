/* Framed vs top-level CET player: where does answer reporting go?
 *
 * Run the same launch URL twice — once inside a cross-site iframe, once as the
 * top-level page — answer question 1 in each, and log every non-GET request
 * plus anything that smells of xAPI. If top-level reports and the frame does
 * not, the frame silently loses tracking even though it renders and grades.
 */
import { chromium } from 'playwright'

const url = process.argv[2]
if (!url) { console.error('usage: node cet-embed-xapi-probe.mjs <player_url>'); process.exit(2) }

async function run(mode) {
  const b = await chromium.launch()
  const ctx = await b.newContext({ locale: 'he-IL' })
  const page = await ctx.newPage()
  const hits = []
  page.on('request', (r) => {
    const u = r.url()
    const interesting = r.method() !== 'GET' || /xapi|statement|lrs|AccessMng|logout/i.test(new URL(u).pathname + new URL(u).hostname)
    if (!interesting) return
    if (/google|gtm|clarity|facebook|doubleclick/i.test(u)) return
    hits.push(`${r.method()} ${u.slice(0, 140)}`)
  })

  if (mode === 'frame') {
    await page.setContent(`<!doctype html><iframe style="width:1280px;height:800px" src="${url.replace(/"/g, '&quot;')}"></iframe>`)
  } else {
    await page.goto(url, { waitUntil: 'load' }).catch(() => {})
  }
  await page.waitForTimeout(12_000)
  const scope = mode === 'frame' ? page.frames().find((f) => f !== page.mainFrame()) : page.mainFrame()
  const mark = hits.length
  await scope.getByText('כן', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(600)
  await scope.getByText('בדיקה', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(10_000)
  // navigating away is a classic flush point for batched beacons
  await scope.getByText('הבא', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(6_000)

  console.log(`=== ${mode}: ${hits.length} interesting requests (${hits.length - mark} after answering) ===`)
  for (const h of hits) console.log('  ' + h)
  await b.close()
}

await run('frame')
await run('top')
