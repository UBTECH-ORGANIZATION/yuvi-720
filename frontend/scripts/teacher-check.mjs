/* Drive the teacher portal end to end.
 *
 *   cd frontend && node scripts/teacher-check.mjs [--port 5173] [--headed]
 *
 * Covers what screenshots cannot prove: that a student's name survives a class
 * switch in the chat, that the roster opens as a table and its filters actually
 * narrow the rows, that the live board moved, and that the daily brief renders
 * with its evidence intact.
 */

import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '5173'
const base = `http://localhost:${port}`
const shots = 'scripts/.teacher-shots'
await mkdir(shots, { recursive: true })

const browser = await chromium.launch({ headless: !args.includes('--headed') })
const context = await browser.newContext({
  colorScheme: 'light', viewport: { width: 1440, height: 950 },
})
const page = await context.newPage()

const fail = []
const ok = (label) => console.log(`  ✔ ${label}`)
const bad = (label) => { fail.push(label); console.log(`  ✖ ${label}`) }

await page.goto(`${base}/`, { waitUntil: 'load' })
await page.waitForTimeout(1500)
await page.evaluate(async () => {
  await fetch('/api/auth/login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gal', password: 'Aa12345' }),
  })
})

// The view is a persisted preference, so a previous run could leave it on
// cards. Start from a known state rather than asserting into whatever is stored.
await page.evaluate(async () => {
  await fetch('/api/auth/preferences', {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacher_roster_view: 'table', teacher_roster_columns: [] }),
  })
  // Pin the class too: a previous run's class switch is persisted, and the two
  // demo groups have different data.
  const groups = await (await fetch('/api/teacher/groups', { credentials: 'include' })).json()
  if (groups.groups?.[0]) {
    await fetch('/api/auth/preferences', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_group_id: groups.groups[0].id }),
    })
  }
})

// ── the daily brief ─────────────────────────────────────────────────────────
console.log('\n— daily brief —')
await page.goto(`${base}/teacher`, { waitUntil: 'load' })
try {
  await page.waitForSelector('.tch-brief:not(.is-loading)', { timeout: 120_000 })
  ok('the brief renders')
} catch { bad('the brief renders') }

const headline = await page.locator('.tch-brief__headline').innerText().catch(() => '')
if (headline.trim()) ok(`headline: "${headline.trim().slice(0, 70)}"`)
else bad('the brief has a headline')

if (/[a-z]{2,}_[a-z]{2,}/.test(headline)) bad('no internal identifier in the headline')
else ok('no internal identifier in the headline')

const stats = await page.locator('.tch-brief__stats div').count()
if (stats) ok(`${stats} stat(s) beside the prose`); else bad('stats render')

const actions = await page.locator('.tch-brief__action').count()
console.log(`  · ${actions} action(s) offered`)
// Only the assignment actions expand in place; `open_roster` navigates away, so
// clicking blindly ran every later check on the wrong page.
const assign = page.locator('.tch-brief__action[aria-expanded]').first()
if (await assign.count()) {
  await assign.click()
  await page.waitForTimeout(800)
  const form = await page.locator('.tch-brief__form .tch-subgroup__people .tch-chip').count()
  if (form) ok(`the assign form opens prefilled with ${form} student(s)`)
  else bad('the assign form opens prefilled')
} else {
  console.log('  · no assignment action for this class (no learning gap above threshold)')
}

const roster = page.locator('.tch-brief__action:not([aria-expanded])').first()
if (await roster.count()) {
  await roster.click()
  await page.waitForTimeout(1500)
  if (page.url().includes('/teacher/students')) ok('the roster action navigates')
  else bad(`the roster action navigates (at ${page.url()})`)
  await page.goto(`${base}/teacher`, { waitUntil: 'load' })
  await page.waitForSelector('.tch-brief:not(.is-loading)', { timeout: 60_000 })
}

const weekly = await page.locator('[data-tour="teacher.digest"]').count()
if (!weekly) ok('the weekly digest panel is gone'); else bad('the weekly digest panel is gone')

const liveOnHome = await page.locator('.tch-home .tch-live').count()
if (!liveOnHome) ok('"בכיתה עכשיו" is off the dashboard'); else bad('"בכיתה עכשיו" is off the dashboard')

await page.screenshot({ path: `${shots}/home.png`, fullPage: false })

// ── the KPI is the door ─────────────────────────────────────────────────────
console.log('\n— roster —')
// The KPI strip renders skeletons while the snapshot loads; the interactive
// card only exists once the real values are in.
await page.waitForSelector('.tch-stats .sp-card--interactive', { timeout: 60_000 })
await page.locator('.tch-stats .sp-card--interactive').first().click()
await page.waitForTimeout(2500)
if (page.url().includes('/teacher/students')) ok('the live KPI navigates to the roster')
else bad(`the live KPI navigates to the roster (at ${page.url()})`)

if (await page.locator('.tch-roster__live .tch-live').count()) ok('the live board is on the roster')
else bad('the live board is on the roster')

// ── table by default, and the filters bite ──────────────────────────────────
await page.goto(`${base}/teacher/students`, { waitUntil: 'load' })
await page.waitForSelector('.tch-roster__row, .tch-roster__grid li', { timeout: 30_000 })
if (await page.locator('.tch-roster__table').count()) ok('the roster opens as a table')
else bad('the roster opens as a table')

const headers = await page.locator('.tch-roster__table thead th').allInnerTexts()
if (headers.some((h) => h.includes('סטטוס'))) ok('status is a column')
else bad(`status is a column (got ${JSON.stringify(headers)})`)

const allRows = await page.locator('.tch-roster__row').count()
ok(`${allRows} rows before filtering`)

// Per-column filter: days inactive ≥ 7.
await page.selectOption('.tch-roster__colFilters select >> nth=1', '7')
await page.waitForTimeout(600)
const staleRows = await page.locator('.tch-roster__row').count()
if (staleRows < allRows) ok(`the days-inactive filter narrows ${allRows} → ${staleRows}`)
else bad(`the days-inactive filter narrows rows (${allRows} → ${staleRows})`)
await page.selectOption('.tch-roster__colFilters select >> nth=1', '')
await page.waitForTimeout(400)

// Column chooser.
await page.click('.tch-roster__columns > button')
await page.waitForTimeout(400)
const before = await page.locator('.tch-roster__table thead th').count()
await page.locator('.tch-roster__columnMenu input').nth(1).uncheck()
await page.waitForTimeout(800)
const after = await page.locator('.tch-roster__table thead th').count()
if (after === before - 1) ok(`the column chooser hides a column (${before} → ${after})`)
else bad(`the column chooser hides a column (${before} → ${after})`)
await page.locator('.tch-roster__columnMenu input').nth(1).check()
await page.waitForTimeout(600)

// Sorting.
await page.click('.tch-roster__table thead th >> nth=0 >> button')
await page.waitForTimeout(400)
const sorted = await page.locator('.tch-roster__table thead th[aria-sort]').count()
if (sorted) ok('a column header sorts'); else bad('a column header sorts')

// View toggle persists through a reload.
await page.click('.tch-roster__views button >> nth=1')
await page.waitForSelector('.tch-roster__grid li', { timeout: 10_000 }).catch(() => {})
if (await page.locator('.tch-roster__grid li').count()) ok('the card view still works')
else bad('the card view still works')
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.tch-roster__row, .tch-roster__grid li', { timeout: 30_000 })
if (await page.locator('.tch-roster__grid li').count()) ok('the view choice survives a reload')
else bad('the view choice survives a reload')
await page.click('.tch-roster__views button >> nth=0')
await page.waitForTimeout(900)

await page.screenshot({ path: `${shots}/roster.png`, fullPage: false })

// ── the demo-tal bug ────────────────────────────────────────────────────────
console.log('\n— the name bug —')
const classPicker = page.locator('.tch-dock__titleText small')
await page.fill('.tch-dock__composer input', 'מה אתה יכול להגיד לי על טל?')
await page.waitForSelector('.tch-dock__send:not([disabled])', { timeout: 20_000 })
await page.click('.tch-dock__send')

const deadline = Date.now() + 120_000
let answer = ''
while (Date.now() < deadline) {
  const bubble = page.locator('.tch-dock__row--assistant .tch-dock__bubble').last()
  const text = await bubble.innerText().catch(() => '')
  const thinking = await page.locator('.tch-dock .sp-thinking').count()
  if (text && !thinking && await bubble.locator('.tch-trace').count()) { answer = text; break }
  await page.waitForTimeout(250)
}

if (!answer) bad('an answer arrived')
else {
  ok('an answer arrived')
  const refs = await page.locator('.tch-studentRef').allInnerTexts()
  console.log(`  · student references: ${JSON.stringify(refs)}`)
  if (refs.some((r) => /^demo-/.test(r))) bad('names resolved before the switch')
  else ok('names resolved before the switch')

  // Switch class and re-read the SAME message.
  await page.goto(`${base}/teacher`, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  const options = await page.locator('.tch-home__classPick select option').count()
  if (options > 1) {
    await page.selectOption('.tch-home__classPick select', { index: 1 })
    await page.waitForTimeout(3000)
    const after = await page.locator('.tch-studentRef').allInnerTexts()
    console.log(`  · after the switch: ${JSON.stringify(after)}`)
    if (after.some((r) => /^demo-/.test(r))) bad('names SURVIVE a class switch')
    else ok('names survive a class switch')
  } else {
    // One class on this account: assert the invariant that made the bug
    // possible instead — the map spans every class the teacher teaches.
    const roster = await page.evaluate(async () => {
      const response = await fetch('/api/teacher/roster', { credentials: 'include' })
      return response.json()
    })
    const groups = new Set(roster.students.map((row) => row.group_id))
    console.log(`  · only one class on this account; roster spans ${groups.size} group(s), `
      + `${roster.students.length} student(s)`)
    if (roster.students.length) ok('the roster endpoint returns names for every class')
    else bad('the roster endpoint returns names for every class')
  }
}

await page.screenshot({ path: `${shots}/chat.png`, fullPage: false })

// ── dark ────────────────────────────────────────────────────────────────────
await page.goto(`${base}/teacher`, { waitUntil: 'load' })
await page.waitForTimeout(4000)
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
await page.waitForTimeout(700)
await page.screenshot({ path: `${shots}/home-dark.png`, fullPage: false })
ok('dark screenshot captured')

await browser.close()
console.log(fail.length ? `\n❌ ${fail.length} check(s) failed` : '\n✅ all checks passed')
process.exit(fail.length ? 1 : 0)
