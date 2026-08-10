/* Drive the teacher assistant dock end to end.
 *
 *   cd frontend && node scripts/dock-check.mjs [--port 5174] [--headed]
 *
 * Asserts the things this refactor promised and a screenshot cannot prove:
 * the answer arrives progressively rather than all at once, the thinking orbit
 * is on screen while it does, and a reload finds the thread still there.
 */

import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '5174'
const base = `http://localhost:${port}`
const shots = 'scripts/.dock-shots'
await mkdir(shots, { recursive: true })

const browser = await chromium.launch({ headless: !args.includes('--headed') })
const context = await browser.newContext({
  colorScheme: 'light', viewport: { width: 1440, height: 900 },
})
const page = await context.newPage()

const fail = []
const ok = (label) => console.log(`  ✔ ${label}`)
const bad = (label) => { fail.push(label); console.log(`  ✖ ${label}`) }

// ── sign in ────────────────────────────────────────────────────────────────
await page.goto(`${base}/`, { waitUntil: 'load' })
await page.waitForTimeout(1500)
await page.evaluate(async () => {
  await fetch('/api/auth/login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gal', password: 'Aa12345' }),
  })
})
await page.goto(`${base}/teacher`, { waitUntil: 'load' })
await page.waitForTimeout(3000)

const dock = page.locator('.tch-dock')
if (await dock.count()) ok('dock is mounted'); else bad('dock is mounted')

// ── ask, and watch it arrive ───────────────────────────────────────────────
await page.fill('.tch-dock__composer input', 'מה אתה יכול להגיד לי על טל?')
// The send button stays disabled until the thread has resolved — a question
// filed against the wrong thread is worse than a moment's wait.
await page.waitForSelector('.tch-dock__send:not([disabled])', { timeout: 20_000 })
const before = await page.locator('.tch-dock__row').count()
await page.click('.tch-dock__send')
await page.waitForFunction(
  (n) => document.querySelectorAll('.tch-dock__row').length > n, before, { timeout: 5000 }
)
ok('the question is posted immediately')

// The orbit must be up while the tool rounds run.
try {
  await page.waitForSelector('.tch-dock .sp-thinking__orbit', { timeout: 8000 })
  ok('thinking orbit renders while waiting')
} catch { bad('thinking orbit renders while waiting') }

if (await page.locator('.tch-dock__avatar.is-thinking').count()) ok('Yuvi head bobs while thinking')
else bad('Yuvi head bobs while thinking')

await page.screenshot({ path: `${shots}/thinking.png`, clip: await dock.boundingBox() })

// Sample the answer as it grows. Two different non-final lengths means the
// teacher is reading before the model has finished writing.
const lengths = new Set()
const deadline = Date.now() + 120_000
let settled = ''
// Done = the orbit is gone AND the trace has rendered under the reply. The send
// button is not a busy signal: it is also disabled whenever the draft is empty.
while (Date.now() < deadline) {
  const bubble = page.locator('.tch-dock__row--assistant .tch-dock__bubble').last()
  const text = await bubble.innerText().catch(() => '')
  if (text) lengths.add(text.length)
  const thinking = await page.locator('.tch-dock .sp-thinking').count()
  const traced = await bubble.locator('.tch-trace').count()
  if (text && !thinking && traced) { settled = text; break }
  await page.waitForTimeout(200)
}

if (!settled) bad('an answer arrived')
else {
  ok(`an answer arrived (${settled.split(/\s+/).length} words)`)
  if (lengths.size > 2) ok(`answer streamed in (${lengths.size} distinct lengths seen)`)
  else bad(`answer streamed in (only ${lengths.size} length(s) — looks blocking)`)

  if (/[a-z]{2,}_[a-z]{2,}/.test(settled)) bad(`no internal identifier in the prose: ${settled.match(/[a-z_]{6,}/)}`)
  else ok('no internal identifier in the prose')

  if (/UTC|\d{4}-\d{2}-\d{2}[T ]\d{2}:/.test(settled)) bad('no raw timestamp in the prose')
  else ok('no raw timestamp in the prose')

  if (settled.includes('{{student:')) bad('no template syntax on screen')
  else ok('no template syntax on screen')

  // The terminal SSE frame carries the WHOLE reply. If anything treats it as
  // one more fragment, the teacher reads the answer twice.
  const opening = settled.slice(0, 40)
  if (opening && settled.indexOf(opening) !== settled.lastIndexOf(opening)) {
    bad('the answer is not duplicated (terminal frame appended on top of the stream)')
  } else ok('the answer is not duplicated')
}

// ── chrome ─────────────────────────────────────────────────────────────────
const times = await page.locator('.tch-dock__time').count()
if (times >= 2) ok(`timestamps under both bubbles (${times})`); else bad(`timestamps under both bubbles (${times})`)

if (await page.locator('.tch-dock .tch-trace').count()) ok('the trace still renders')
else bad('the trace still renders')

const subtitle = await page.locator('.tch-dock__titleText small').innerText()
ok(`header context line: "${subtitle}"`)
const title = await page.locator('.tch-dock__titleText strong').innerText()
ok(`thread title: "${title}"`)

await page.screenshot({ path: `${shots}/answered.png`, clip: await dock.boundingBox() })

// ── it survives a reload ───────────────────────────────────────────────────
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(5000)
const restored = await page.locator('.tch-dock__row').count()
if (restored >= 2) ok(`thread restored after reload (${restored} messages)`)
else bad(`thread restored after reload (${restored} messages)`)

// The turn we just had must be in there — a reload that keeps *some* history
// but drops the last exchange is the failure worth catching.
const lastUser = await page.locator('.tch-dock__row--user .tch-dock__bubble').last().innerText()
if (lastUser.includes('טל')) ok('the last question survived the reload')
else bad(`the last question survived the reload (got "${lastUser}")`)

const restoredTitle = await page.locator('.tch-dock__titleText strong').innerText()
if (restoredTitle && restoredTitle !== 'עוזר ההוראה') ok(`title persisted: "${restoredTitle}"`)
else bad(`title persisted (got "${restoredTitle}")`)

await page.click('.tch-dock__head button[aria-label="שיחות קודמות"]')
await page.waitForTimeout(1200)
const threads = await page.locator('.tch-dock__threads li').count()
if (threads >= 1) ok(`thread list shows ${threads} conversation(s)`); else bad('thread list shows conversations')
await page.screenshot({ path: `${shots}/threads.png`, clip: await dock.boundingBox() })

// ── dark theme ─────────────────────────────────────────────────────────────
await page.emulateMedia({ colorScheme: 'dark' })
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
await page.waitForTimeout(600)
await page.screenshot({ path: `${shots}/dark.png`, clip: await dock.boundingBox() })
ok('dark screenshot captured')

await browser.close()
console.log(fail.length ? `\n❌ ${fail.length} check(s) failed` : '\n✅ all checks passed')
process.exit(fail.length ? 1 : 0)
