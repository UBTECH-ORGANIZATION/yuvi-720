/* Frame-only CET probe: does the ANSWERED event leave the iframe, and are the
 * xapi-events POSTs accepted? Logs each learning-api request's verb(s) and the
 * response status. Answers whatever question the restored state shows: radio
 * questions ("כן"/"לא") or the dropdown kind (every "בחרו" select). */
import { chromium } from 'playwright'

const url = process.argv[2]
const b = await chromium.launch()
const page = await (await b.newContext({ locale: 'he-IL' })).newPage()

const verbsSeen = []
page.on('requestfinished', async (r) => {
  if (!/learning-api\.cet\.ac\.il/.test(r.url())) return
  const res = await r.response()
  let verbs = ''
  const body = r.postData()
  if (body) {
    try {
      const d = JSON.parse(body)
      const list = Array.isArray(d) ? d : d.statements || [d]
      verbs = list.map((s) => (s?.verb?.id || '').split('/').pop()).filter(Boolean).join(',')
      verbsSeen.push(...verbs.split(',').filter(Boolean))
    } catch { verbs = '(unparsed)' }
  }
  console.log(`  ${r.method()} ${new URL(r.url()).pathname} → ${res?.status()} ${verbs ? `[${verbs}]` : ''}`)
})

await page.setContent(`<!doctype html><iframe style="width:1280px;height:800px" src="${url.replace(/"/g, '&quot;')}"></iframe>`)
await page.waitForTimeout(12_000)
const f = page.frames().find((fr) => fr !== page.mainFrame())

console.log('--- answering whatever this screen asks')
const radios = await f.locator('input[type="radio"]').count()
if (radios > 0) {
  await f.locator('input[type="radio"]').first().click({ force: true })
} else {
  // the dropdown kind: open each "בחרו" and take its first real option
  const pickers = f.getByText('בחרו', { exact: true })
  const n = await pickers.count()
  for (let i = 0; i < n; i += 1) {
    await pickers.first().click() // list shrinks as answers replace the placeholder
    await page.waitForTimeout(400)
    await f.locator('[role="option"], li').filter({ hasText: /^\d+$/ }).first().click()
      .catch((e) => console.log('  option pick failed: ' + e.message.split('\n')[0]))
    await page.waitForTimeout(400)
  }
}
await page.waitForTimeout(500)
await f.getByText('בדיקה', { exact: true }).first().click()
  .catch((e) => console.log('  בדיקה: ' + e.message.split('\n')[0]))
await page.waitForTimeout(10_000)
await page.screenshot({ path: process.env.SHOT || '/tmp/cet-frame2.png' })

console.log('---')
console.log(`verbs observed: ${[...new Set(verbsSeen)].join(', ') || '(none)'}`)
console.log(verbsSeen.includes('answered')
  ? 'VERDICT: answered statements leave the frame'
  : 'VERDICT: no answered statement observed')
await b.close()
