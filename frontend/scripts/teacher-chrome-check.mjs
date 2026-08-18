/* The teacher portal's chrome: the dock fits, the faces wait, nothing floats.
 *
 *   cd frontend && node scripts/teacher-chrome-check.mjs
 *
 * All three are computed-layout facts — a grid column sized to its widest
 * item, a specificity collision, a component's absence — so none of them can
 * be checked by reading the source. */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = 'http://localhost:5173'
const shots = 'scripts/.chrome-shots'
await mkdir(shots, { recursive: true })
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const fail = []
const ok = (l) => console.log(`  ✔ ${l}`)
const bad = (l) => { fail.push(l); console.log(`  ✖ ${l}`) }

await page.goto(`${base}/`, { waitUntil: 'load' })
await page.waitForTimeout(1200)
await page.evaluate(async () => {
  await fetch('/api/auth/login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gal', password: 'Aa12345' }),
  })
})

/* ── 1 · the dock with a table in it ─────────────────────────────────────── */
await page.goto(`${base}/teacher/students`, { waitUntil: 'load' })
await page.waitForTimeout(2500)
const launcher = page.locator('.tch-dock__launcher')
if (await launcher.count()) { await launcher.first().click(); await page.waitForTimeout(800) }
await page.waitForSelector('.tch-dock__body', { timeout: 15000 })
const history = page.locator('.tch-dock__iconButton').first()
await history.click()
await page.waitForTimeout(1200)
const threads = page.locator('.tch-dock__threads button:not(.tch-dock__threadDelete)')
for (let i = 0; i < await threads.count(); i += 1) {
  await threads.nth(i).click()
  await page.waitForTimeout(1500)
  if (await page.locator('.tch-dock__body .sp-md-table').count()) break
  await history.click(); await page.waitForTimeout(800)
}
const dock = await page.evaluate(() => {
  const body = document.querySelector('.tch-dock__body')
  const rows = [...document.querySelectorAll('.tch-dock__row')]
  return {
    tables: document.querySelectorAll('.tch-dock__body .sp-md-table').length,
    scrollW: body.scrollWidth, clientW: body.clientWidth,
    widestRow: Math.max(...rows.map((r) => Math.round(r.getBoundingClientRect().width))),
    tableScrolls: [...document.querySelectorAll('.sp-md-tablewrap')]
      .every((w) => getComputedStyle(w).overflowX === 'auto'),
  }
})
console.log('  · dock:', JSON.stringify(dock))
dock.tables > 0 ? ok(`a table is on screen (${dock.tables})`) : bad('no table thread found — inconclusive')
dock.scrollW <= dock.clientW ? ok('the conversation does not scroll sideways')
  : bad(`the dock still scrolls: ${dock.scrollW} > ${dock.clientW}`)
dock.widestRow <= dock.clientW ? ok('no message row is wider than the dock')
  : bad(`widest row ${dock.widestRow} vs ${dock.clientW}`)
dock.tableScrolls ? ok('the table keeps its own scroll box') : bad('the table lost its scroll box')
await page.screenshot({ path: `${shots}/7-dock-table.png` })

/* ── 3 · the floating support button ─────────────────────────────────────── */
const support = await page.evaluate(() => ({
  launch: document.querySelectorAll('.sp-support-launch').length,
  panel: document.querySelectorAll('.sp-support').length,
}))
support.launch === 0 && support.panel === 0
  ? ok('the floating support button is gone from the teacher portal')
  : bad(`support still mounted: ${JSON.stringify(support)}`)

/* ── 2 · faces while the roster is still resolving ───────────────────────── */
const slow = await context.newPage()
await slow.route(/\/api\/teacher\/roster/, async (route) => {
  await new Promise((r) => setTimeout(r, 6000)); await route.continue()
})
await slow.goto(`${base}/teacher/students`, { waitUntil: 'commit' })
await slow.waitForSelector('.tch-avatar', { timeout: 20000 })
await slow.waitForTimeout(500)
const waiting = await slow.evaluate(() => {
  const all = [...document.querySelectorAll('.tch-avatar')]
  const pending = all.filter((n) => n.classList.contains('tch-avatar--pending'))
  const one = pending[0]
  return {
    total: all.length, pending: pending.length,
    letters: all.filter((n) => (n.textContent || '').trim().length).length,
    radius: one ? getComputedStyle(one).borderRadius : null,
    /* EVERY one, not the first: an idle card's dimming rule carries more
       specificity than the placeholder and once flattened it to a blank
       disc — visible only on the cards that happened to be idle. */
    animated: [...new Set(pending.map((n) => getComputedStyle(n).animationName))],
    box: one ? [Math.round(one.getBoundingClientRect().width),
                Math.round(one.getBoundingClientRect().height)] : null,
  }
})
console.log('  · faces waiting:', JSON.stringify(waiting))
await slow.screenshot({ path: `${shots}/8-avatars-waiting.png` })
waiting.pending > 0 ? ok(`${waiting.pending} faces wait as circles`) : bad('no pending avatars rendered')
waiting.radius === '50%' ? ok('and they are circles') : bad(`radius ${waiting.radius}`)
waiting.animated.length === 1 && waiting.animated[0] === 'sp-skeleton-sweep'
  ? ok('and every one of them pulses like the other placeholders')
  : bad(`animations across the pending faces: ${JSON.stringify(waiting.animated)}`)
waiting.box && waiting.box[0] === waiting.box[1] ? ok(`square box ${waiting.box.join('×')}`)
  : bad(`box ${JSON.stringify(waiting.box)}`)

await slow.waitForTimeout(7000)
const settled = await slow.evaluate(() => ({
  pending: document.querySelectorAll('.tch-avatar--pending').length,
  faces: document.querySelectorAll('.tch-avatar').length,
}))
console.log('  · settled:', JSON.stringify(settled))
settled.pending === 0 && settled.faces > 0
  ? ok('and every one resolves into a real face') : bad(`still pending: ${JSON.stringify(settled)}`)
await slow.screenshot({ path: `${shots}/9-avatars-settled.png` })

await browser.close()
console.log(fail.length ? `\n✖ ${fail.length} failed` : '\n✔ all good')
process.exit(fail.length ? 1 : 0)
