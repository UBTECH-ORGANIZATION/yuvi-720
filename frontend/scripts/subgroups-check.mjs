/* Sub-groups, end to end.
 *
 *   cd frontend && node scripts/subgroups-check.mjs [--port 5173] [--headed]
 *
 * Creates a real sub-group through the UI, checks the scope actually narrows
 * the table, then cleans up after itself — including on failure, so a crashed
 * run does not leave a test group on the class forever.
 */

import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '5173'
const base = `http://localhost:${port}`
const shots = 'scripts/.teacher-shots'
await mkdir(shots, { recursive: true })

const browser = await chromium.launch({ headless: !args.includes('--headed') })
const page = await (await browser.newContext({
  colorScheme: 'light', viewport: { width: 1440, height: 950 },
})).newPage()

const fail = []
const ok = (label) => console.log(`  ✔ ${label}`)
const bad = (label) => { fail.push(label); console.log(`  ✖ ${label}`) }

const NAME = `בדיקה ${process.pid}`
/* Every id this run creates, so the cleanup below cannot miss one. An
 * earlier version tracked a single id and hardcoded a class for the
 * duplicate-name probe — which created a second sub-group in a class it
 * then never cleaned up. */
const created = []
let pinnedGroup = null
let pickedIds = []

await page.goto(`${base}/`, { waitUntil: 'load' })
await page.evaluate(async () => {
  await fetch('/api/auth/login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gal', password: 'Aa12345' }),
  })
})

try {
  // ── the switcher replaces the caption ─────────────────────────────────────
  console.log('\n— the switcher —')
  await page.goto(`${base}/teacher/students`, { waitUntil: 'load' })
  await page.waitForSelector('.tch-roster__table', { timeout: 60_000 })

  if (await page.locator('.tch-subgroups').count()) ok('the class subtitle is a switcher')
  else bad('the class subtitle is a switcher')

  const totalRows = await page.locator('.tch-roster__row').count()
  ok(`${totalRows} students in the class`)

  // ── name it, pick who, save ───────────────────────────────────────────────
  /* Creation moved into a dialog. As a mode on the table it replaced the status
     and last-seen columns with checkboxes — taking away the very columns a
     teacher picks a group ON — so the roster stays readable behind it. */
  console.log('\n— building one —')
  await page.click('.tch-subgroup--new')
  await page.waitForSelector('.tch-subgroupDialog', { timeout: 10_000 })
  ok('the create dialog opens over the roster, which stays readable')

  await page.fill('.tch-subgroupDialog .tch-builder__field input.sp-input', NAME)

  const boxes = page.locator('.tch-subgroupDialog .tch-launch__row input')
  const wanted = Math.min(2, await boxes.count())
  for (let index = 0; index < wanted; index += 1) await boxes.nth(index).check()

  const saveButton = page.locator('.tch-subgroupDialog .tch-builder__actions .sp-btn:not(.sp-btn--ghost)')
  if (!(await saveButton.isDisabled())) ok(`save enables with ${wanted} picked`)
  else bad('save enables once students are picked')

  const posted = page.waitForResponse(
    (response) => response.url().includes('/subgroups')
      && response.request().method() === 'POST',
    { timeout: 30_000 }
  ).catch(() => null)
  await saveButton.click()

  const response = await posted
  if (!response) bad('saving posts to the subgroups endpoint')
  else if (!response.ok()) bad(`the sub-group was created (got ${response.status()})`)
  else {
    const body = await response.json()
    created.push(body.id)
    pinnedGroup = body.group_id
    pickedIds = body.learner_ids
    ok(`created "${NAME}" in ${pinnedGroup} · ${response.status()}`)
  }

  // ── it becomes a scope ────────────────────────────────────────────────────
  console.log('\n— it narrows the roster —')
  await page.waitForTimeout(900)
  const card = page.locator('.tch-subgroup--named', { hasText: NAME })
  if (await card.count()) ok('the new sub-group appears as a card')
  else bad('the new sub-group appears as a card')

  // Both actions in the open, on the card itself — the answer to "where do I
  // edit my groups", which used to be a caret menu nobody opened.
  const actions = await card.locator('.tch-subgroup__action').count()
  if (actions === 2) ok('the card carries edit and delete in the open')
  else bad(`the card carries edit and delete (found ${actions})`)

  const scopedRows = await page.locator('.tch-roster__row').count()
  if (scopedRows === wanted) ok(`the table narrows to exactly ${scopedRows}`)
  else bad(`the table narrows to the ${wanted} picked (showed ${scopedRows})`)

  // The four numbers describe whoever is selected. Counted over every row, a
  // card could read "0 דורשים תשומת לב" above a list showing a flagged child.
  const scopedHint = await page.evaluate(() =>
    [...document.querySelectorAll('.tch-stat__hint')].pop()?.textContent?.trim() ?? '')
  if (scopedHint.includes(String(wanted))) ok(`the KPI strip counts the ${wanted} in the group`)
  else bad(`the KPI strip still counts the class ("${scopedHint}")`)

  // A sub-group is a scope, not a filter: pressing a KPI must not silently
  // widen the teacher back out to the whole class.
  await page.locator('.tch-roster .tch-stat').nth(2).click()
  await page.waitForTimeout(700)
  const afterKpi = await page.locator('.tch-roster__row').count()
  if (afterKpi <= scopedRows) ok('a KPI narrows within the sub-group, never past it')
  else bad(`a KPI escaped the sub-group scope (${scopedRows} → ${afterKpi})`)

  // Clear the KPI's filter first: "כל הכיתה" widens the SCOPE, it does not
  // undo the filters — that is what the empty state's "ניקוי המסננים" is for.
  await page.locator('.tch-roster__filters button').first().click()
  await page.waitForTimeout(400)
  await page.locator('.tch-subgroup').first().click()
  await page.waitForTimeout(700)
  const backToAll = await page.locator('.tch-roster__row').count()
  if (backToAll === totalRows) ok('"כל הכיתה" restores every row')
  else bad(`"כל הכיתה" restores every row (${backToAll} of ${totalRows})`)

  // ── the column ────────────────────────────────────────────────────────────
  console.log('\n— the column —')
  await page.click('.tch-roster__more > button')
  await page.waitForTimeout(400)
  const columnToggle = page.locator('.tch-roster__columnMenu label', { hasText: 'תת-קבוצות' })
  if (await columnToggle.count()) {
    await columnToggle.locator('input').check()
    await page.waitForTimeout(900)
    const tagged = await page.locator('.tch-roster__subgroupTag').count()
    if (tagged >= wanted) ok(`${tagged} row(s) show their sub-group`)
    else bad(`the sub-group column names the members (found ${tagged})`)
  } else bad('the sub-group column is offered in the column chooser')

  await page.screenshot({ path: `${shots}/subgroups.png` })

  // ── the server refuses what it should ─────────────────────────────────────
  console.log('\n— the boundary —')
  const outside = await page.evaluate(async () => {
    const reply = await fetch('/api/teacher/groups/not-a-real-group/subgroups', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', learner_ids: ['kid-a'] }),
    })
    return reply.status
  })
  if (outside === 403) ok('a group this teacher does not teach is refused')
  else bad(`a group this teacher does not teach is refused (got ${outside})`)

  /* Against the class the page is actually pinned to (taken from the created
     sub-group, not guessed), with the SAME learners. Both matter: names are
     unique per class, so a hardcoded class proves nothing; and an empty learner
     list is refused with 400 for a different reason entirely, which would let
     this pass without the duplicate rule existing at all. */
  const duplicate = await page.evaluate(async ([groupId, name, learnerIds]) => {
    const reply = await fetch(`/api/teacher/groups/${groupId}/subgroups`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, learner_ids: learnerIds }),
    })
    return { status: reply.status, body: await reply.json().catch(() => null) }
  }, [pinnedGroup, NAME, pickedIds])
  if (duplicate.body?.id) created.push(duplicate.body.id)
  if (duplicate.status === 400 && duplicate.body?.error === 'name_taken') {
    ok(`the same name twice in ${pinnedGroup} is refused as name_taken`)
  } else {
    bad(`the same name twice is refused as name_taken `
      + `(got ${duplicate.status} ${JSON.stringify(duplicate.body)})`)
  }

  // And a different name with the same members is fine — sub-groups overlap.
  const overlapping = await page.evaluate(async ([groupId, name, learnerIds]) => {
    const reply = await fetch(`/api/teacher/groups/${groupId}/subgroups`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${name} ב`, learner_ids: learnerIds }),
    })
    return { status: reply.status, body: await reply.json().catch(() => null) }
  }, [pinnedGroup, NAME, pickedIds])
  if (overlapping.body?.id) created.push(overlapping.body.id)
  if (overlapping.status === 200) ok('two sub-groups may share members')
  else bad(`two sub-groups may share members (got ${overlapping.status})`)
} finally {
  // Always, so a failed assertion does not leave a test sub-group behind.
  for (const id of created) {
    const status = await page.evaluate(async (target) => (await fetch(
      `/api/teacher/subgroups/${target}`, { method: 'DELETE', credentials: 'include' }
    )).status, id)
    console.log(status === 200 ? `\n  · cleaned up ${id}` : `\n  ⚠️ cleanup of ${id} got ${status}`)
  }
  await browser.close()
}

console.log(fail.length ? `\n❌ ${fail.length} check(s) failed` : '\n✅ all checks passed')
process.exit(fail.length ? 1 : 0)
