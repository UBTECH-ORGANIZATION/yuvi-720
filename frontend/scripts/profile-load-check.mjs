/* Does the profile stream in, and is the hero card gone?
 *
 *   cd frontend && node scripts/profile-load-check.mjs [--port 5173] [--headed]
 *
 * Each of the profile's requests is held for a different beat, so the
 * page has to be readable at every stage rather than only at the end.
 */

import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '5173'
const base = `http://localhost:${port}`
const shots = 'scripts/.profile-shots'
await mkdir(shots, { recursive: true })

const browser = await chromium.launch({ headless: !args.includes('--headed') })
const context = await browser.newContext({
  colorScheme: 'light', viewport: { width: 1440, height: 1000 },
})
const page = await context.newPage()

const fail = []
const ok = (label) => console.log(`  ✔ ${label}`)
const bad = (label) => { fail.push(label); console.log(`  ✖ ${label}`) }

await page.goto(`${base}/`, { waitUntil: 'load' })
await page.waitForTimeout(1200)
await page.evaluate(async () => {
  await fetch('/api/auth/login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gal', password: 'Aa12345' }),
  })
})

const learnerId = await page.evaluate(async () => {
  const roster = await (await fetch('/api/teacher/roster', { credentials: 'include' })).json()
  const groupId = roster.groups?.[0]?.id
  await fetch('/api/auth/preferences', {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacher_group_id: groupId }),
  })
  return (roster.students ?? []).find((s) => s.learner_id === 'gal')?.learner_id
    ?? roster.students?.[0]?.learner_id
})
console.log(`  · learner: ${learnerId}`)

/* Hold each request for its own beat. Real latencies differ by more than
   this; the point is only that the page must be legible in between. */
const holds = [
  [/\/api\/teacher\/students\/[^/?]+\?/, 2600, 'detail'],
  [/\/activity\?/, 4200, 'activity'],
  [/\/trends\?/, 5200, 'trends'],
  [/\/read\?/, 6200, 'read'],
  [/\/topics\/digest/, 6800, 'digest'],
]
for (const [pattern, delay] of holds) {
  await page.route(pattern, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delay))
    await route.continue()
  })
}

await page.goto(`${base}/teacher/student/${learnerId}`, { waitUntil: 'commit' })

/* ── the first frame: identity real, everything else shaped ─────────────── */
await page.waitForSelector('.tch-student__identity h1', { timeout: 8000 })
await page.waitForTimeout(700)
await page.screenshot({ path: `${shots}/1-first-frame.png` })

const early = await page.evaluate(() => {
  const head = document.querySelector('.tch-student__head')
  const style = getComputedStyle(head)
  const cells = document.querySelectorAll('.tch-status__cell')
  const kpiLabels = [...document.querySelectorAll('.tch-student__kpis .tch-stat__label')]
    .map((node) => node.textContent.trim())
  return {
    headBg: style.backgroundColor,
    headBorder: style.borderTopWidth,
    headShadow: style.boxShadow,
    headPadding: style.paddingTop,
    name: document.querySelector('.tch-student__identity h1')?.textContent?.trim(),
    cells: cells.length,
    cellHeads: [...document.querySelectorAll('.tch-status__cell h4')].map((n) => n.textContent.trim()),
    kpiLabels,
    skeletons: document.querySelectorAll('.sp-skeleton').length,
    recsTitle: document.querySelector('.tch-recsPanel .sp-sectionHead h3, .tch-recsPanel h3')?.textContent?.trim(),
    slotPills: [...document.querySelectorAll('.tch-rec .sp-pill')].map((n) => n.textContent.trim()),
    doors: document.querySelectorAll('.tch-student__more > *').length,
  }
})
console.log('  · first frame:', JSON.stringify(early, null, 1))

const transparent = (color) => color === 'rgba(0, 0, 0, 0)' || color === 'transparent'
transparent(early.headBg) ? ok('the hero has no card behind it') : bad(`hero background is ${early.headBg}`)
early.headShadow === 'none' ? ok('and no card shadow') : bad(`hero shadow is ${early.headShadow}`)
early.headPadding === '0px' ? ok('and no card padding') : bad(`hero padding is ${early.headPadding}`)
/* On a COLD load nobody knows this child's name yet — not even the roster,
   which is fetching too — so a placeholder here is honest. The claim being
   made is about the normal path, and that is tested at the end. */
console.log(`  · cold-load name: ${early.name ? early.name : '(placeholder)'}`)
early.cells >= 4 ? ok(`the dial row is already shaped (${early.cells} cells)`)
  : bad(`only ${early.cells} placeholder cells`)
early.cellHeads.length >= 2 ? ok(`headings printed while waiting: ${early.cellHeads.join(' · ')}`)
  : bad('placeholder cells carry no headings')
early.kpiLabels.length === 3 ? ok(`the KPI captions are real: ${early.kpiLabels.join(' · ')}`)
  : bad(`KPI captions: ${JSON.stringify(early.kpiLabels)}`)
early.slotPills.length === 3 ? ok(`the three recommendation slots are named: ${early.slotPills.join(' · ')}`)
  : bad(`slot pills: ${JSON.stringify(early.slotPills)}`)
early.skeletons > 6 ? ok(`${early.skeletons} placeholders in place`) : bad('too few placeholders')

/* ── mid-stream: the detail landed, the numbers have not ────────────────── */
await page.waitForFunction(
  () => document.querySelectorAll('.tch-status__cell .sp-ring, .tch-status__cell svg').length > 0,
  { timeout: 12000 },
).catch(() => {})
await page.waitForTimeout(400)
await page.screenshot({ path: `${shots}/2-detail-in.png` })

const mid = await page.evaluate(() => ({
  rings: document.querySelectorAll('.tch-status__cell svg').length,
  kpiValues: [...document.querySelectorAll('.tch-student__kpis .tch-stat__value')].map((n) => n.textContent.trim()),
  kpiSkeletons: document.querySelectorAll('.tch-student__kpis .sp-skeleton').length,
  topicsStillWaiting: Boolean(document.querySelector('[aria-busy="true"] .sp-skeleton')),
}))
console.log('  · mid stream:', JSON.stringify(mid))
mid.rings > 0 ? ok('the dials drew as soon as the detail answered') : bad('no dials after the detail landed')

/* ── everything home ──────────────────────────────────────────────────────
   The read is the slowest of the six and it is model-backed, so this waits
   on it rather than on a stopwatch. */
await page.waitForSelector('.tch-recs__overviewWait', { state: 'detached', timeout: 40000 })
  .catch(() => console.log('  · the read never answered'))
await page.waitForTimeout(1500)
await page.screenshot({ path: `${shots}/3-loaded.png`, fullPage: true })
const done = await page.evaluate(() => ({
  skeletons: document.querySelectorAll('.sp-skeleton').length,
  kpiValues: [...document.querySelectorAll('.tch-student__kpis .tch-stat__value')].map((n) => n.textContent.trim()),
  cells: document.querySelectorAll('.tch-status__cell').length,
  doors: document.querySelectorAll('.tch-student__more > *').length,
  busy: [...document.querySelectorAll('[aria-busy="true"]')].map((n) => n.className || n.tagName),
  leftover: [...document.querySelectorAll('.sp-skeleton')]
    .map((n) => n.parentElement?.className || n.parentElement?.tagName),
  name: document.querySelector('.tch-student__identity h1')?.textContent?.trim(),
}))
console.log('  · loaded:', JSON.stringify(done))
done.kpiValues.length === 3 ? ok(`the figures landed: ${done.kpiValues.join(' · ')}`)
  : bad(`KPI values: ${JSON.stringify(done.kpiValues)}`)
done.skeletons === 0 ? ok('no placeholder is left behind') : bad(`${done.skeletons} placeholders still on screen`)

/* ── the normal path: arriving from the roster ────────────────────────────
   This is how a teacher actually opens a profile, and the roster they came
   from already holds every name and face — so the header must be real on
   the very first frame, with nothing greyed. */
await page.goto(`${base}/teacher/students`, { waitUntil: 'load' })
/* Clicked, not navigated to: a `goto` would tear the app down and take the
   roster's answer with it, which is precisely the knowledge being tested. */
const row = page.locator('.tch-roster__row, .tch-studentCard').first()
await row.waitFor({ timeout: 20000 })
await page.waitForTimeout(1500)
await row.click()
await page.waitForSelector('.tch-student__identity h1', { timeout: 8000 })
const warm = await page.evaluate(() => ({
  name: document.querySelector('.tch-student__identity h1')?.textContent?.trim(),
  nameSkeleton: Boolean(document.querySelector('.tch-student__identity h1 .sp-skeleton')),
  avatar: Boolean(document.querySelector('.tch-student__identity .tch-avatar, .tch-student__identity img, .tch-student__identity svg')),
}))
await page.screenshot({ path: `${shots}/4-from-roster.png` })
console.log('  · from the roster:', JSON.stringify(warm))
warm.name && !warm.nameSkeleton
  ? ok(`the name is real on the first frame: ${warm.name}`)
  : bad('the name was still a placeholder when arriving from the roster')
warm.avatar ? ok('and so is the face') : bad('no avatar on the first frame')

await browser.close()
console.log(fail.length ? `\n✖ ${fail.length} failed` : '\n✔ all good')
process.exit(fail.length ? 1 : 0)
