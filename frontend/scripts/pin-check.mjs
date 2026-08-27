/* The teacher's pin, end to end (#244).
 *
 * What unit tests cannot reach: the profile's focus card and the child's hero
 * reading the SAME pin through two real sessions, the panel opening from the
 * profile, the bulk route pinning exactly the roster, and the spent record
 * surfacing after an unpin.
 *
 * Expiry is deliberately NOT driven here: a pin born in the past is refused
 * by the API (as it should be), so lapsing one needs a direct DB write —
 * `test_pinned_next.py` covers the expired reading at every read site.
 *
 * Leaves no pins behind: every learner it touches is unpinned at the end.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dismissTourIfOpen } from './lib/tour.mjs'
import { dismissCheckin } from './lib/checkin.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/pin-check'
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const signIn = async (context, username, landing) => {
  const response = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username, password: 'Aa12345' },
  })
  if (!response.ok()) throw new Error(`login failed for ${username}: ${response.status()}`)
  const page = await context.newPage()
  await page.goto(`${BASE}${landing}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await dismissTourIfOpen(page)
  await dismissCheckin(page)
  return page
}

const LEARNER = 'demo-ari'
const browser = await chromium.launch()
const pinnedLearners = new Set()

try {
  const teacherCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const teacher = await signIn(teacherCtx, 'demo-teacher-1', `/teacher/student/${LEARNER}`)
  const api = (path, options) => teacher.evaluate(async ({ path, options }) => {
    const response = await fetch(path, {
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      ...options,
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  }, { path, options: options ?? {} })

  // A previous failed run may have left a pin standing — start clean.
  await api(`/api/teacher/students/${LEARNER}/pin-next`, { method: 'DELETE' })
  await teacher.reload({ waitUntil: 'domcontentloaded' })
  await teacher.waitForSelector('.tch-status__focus', { timeout: 40000 })

  // ── the profile opens the panel, and a pick becomes the card's fact ──────
  await teacher.waitForSelector('.tch-status__pinBar', { timeout: 20000 })
  check('the focus card carries the pin lane', true)
  await teacher.locator('.tch-status__pinBar button', { hasText: /שינוי|Change|تغيير/ }).click()
  await teacher.waitForSelector('.tch-focusModal .tch-focusPanel', { timeout: 20000 })
  check('the profile opens the same focus panel', true)
  check('no bulk lever anywhere — the dialog is about one child',
        await teacher.locator('.tch-focusPanel__scope').count() === 0)

  await teacher.waitForSelector('.tch-focusPanel__option', { timeout: 30000 })
  // Asserted after the shelf loads — the search row renders with the catalog.
  check('the panel offers the smart search and an end date',
        await teacher.locator('.tch-focusPanel__searchBox input').count() === 1
        && await teacher.locator('.tch-focusPanel__until input').count() === 1)
  /* Pin the child's CURRENT goal when the planner marks one — its allocation
     is non-empty by construction, so the hero must flip to pinned mode. An
     arbitrary goal might already be finished for this child, which the hero
     rightly treats as spent. */
  const fitting = teacher.locator('.tch-focusPanel__option.is-next')
  const option = (await fitting.count()) > 0
    ? fitting.first() : teacher.locator('.tch-focusPanel__option').first()
  const pickedTitle = (await option.innerText()).trim()
  await option.click()
  pinnedLearners.add(LEARNER)
  await teacher.waitForSelector('.tch-focusPanel__current .sp-btn', { timeout: 20000 })
  check('the panel confirms the standing pin', true, pickedTitle)
  await teacher.screenshot({ path: `${OUT}/panel-pinned.png` })

  // Close the modal; the card should now say the pin, not the planner.
  await teacher.keyboard.press('Escape')
  await teacher.waitForTimeout(1200)
  const cardSaysPin = await teacher.locator('.tch-status__focus .tch-status__focusMeta')
    .innerText().catch(() => '')
  check('the focus card says a person chose this',
        /הוצמד|Pinned by|بواسطة/.test(cardSaysPin), cardSaysPin.trim())

  // ── the child's hero honours the same pin ────────────────────────────────
  const pinRead = await api(`/api/teacher/students/${LEARNER}/pin-next?language=he`)
  check('the teacher read says the pin is active',
        pinRead.body?.pin_state === 'active', JSON.stringify(pinRead.body?.pinned))

  const learnerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const learnerLogin = await learnerCtx.request.post(`${BASE}/api/auth/login`, {
    data: { username: LEARNER, password: 'Aa12345' },
  })
  if (learnerLogin.ok()) {
    const hero = await (await learnerCtx.request.get(
      `${BASE}/api/brain/${LEARNER}/dashboard?lang=he`)).json().catch(() => null)
    check('the child\'s hero is in pinned mode',
          hero?.hero?.mode === 'pinned', hero?.hero?.mode)
    check('the hero carries the resume field (aside or null, never absent)',
          hero?.hero ? 'resume' in hero.hero : false)
  } else {
    console.log('  · learner login unavailable — hero asserted via teacher lane only')
  }

  // ── a task pin, when this learner has an open task ───────────────────────
  const tasks = pinRead.body?.tasks ?? []
  if (tasks.length > 0) {
    const launch = tasks[0].launch_id
    const taskPin = await api(`/api/teacher/students/${LEARNER}/pin-next`, {
      method: 'POST', body: JSON.stringify({ launch_id: launch }),
    })
    check('an open task pins by its launch id',
          taskPin.status === 200 && taskPin.body?.pinned?.kind === 'task',
          JSON.stringify(taskPin.body?.pinned))
    const heroNow = await api(`/api/teacher/students/${LEARNER}/pin-next?language=he`)
    check('the task pin carries its frozen title',
          Boolean(heroNow.body?.pinned_title), heroNow.body?.pinned_title)
  } else {
    console.log('  · no open tasks for this learner — task-pin scenario skipped')
  }

  // ── unpin leaves a readable ending ───────────────────────────────────────
  const unpin = await api(`/api/teacher/students/${LEARNER}/pin-next`, { method: 'DELETE' })
  check('unpin answers', unpin.status === 200)
  pinnedLearners.delete(LEARNER)
  const after = await api(`/api/teacher/students/${LEARNER}/pin-next?language=he`)
  check('the ending survives as the spent record',
        after.body?.pinned === null && after.body?.last?.outcome === 'unpinned',
        JSON.stringify(after.body?.last))

  // ── bulk: one action, the whole roster, nobody silently skipped ──────────
  const roster = await api('/api/teacher/roster')
  const group = roster.body?.groups?.[0]?.id
  const learnings = await api(`/api/teacher/groups/${group}/learnings?language=he`)
  const component = learnings.body?.learnings?.[0]?.component_id
  if (group && component) {
    const bulk = await api(`/api/teacher/groups/${group}/pin-next`, {
      method: 'POST',
      body: JSON.stringify({
        targets: [{ kind: 'group', id: group }],
        pin: { component_id: component },
      }),
    })
    const members = (roster.body?.students ?? [])
      .filter((row) => row.group_id === group).length
    check('bulk pins the whole class in one action',
          bulk.status === 200 && (bulk.body?.pinned?.length ?? 0) === members
          && (bulk.body?.skipped?.length ?? 0) === 0,
          `pinned ${bulk.body?.pinned?.length}/${members}`)
    for (const id of bulk.body?.pinned ?? []) pinnedLearners.add(id)

    const focus = await api(`/api/teacher/groups/${group}/focus?language=he`)
    const pinnedRows = (focus.body?.learners ?? []).filter((row) => row.pinned).length
    check('the class focus map shows every row pinned',
          pinnedRows === members, `${pinnedRows}/${members}`)
  } else {
    check('bulk scenario has a group and a learning to use', false,
          `group=${group} component=${component}`)
  }

  // ── the live view opens the same dialog, floating over the table ─────────
  await teacher.goto(`${BASE}/teacher/students`, { waitUntil: 'domcontentloaded' })
  await teacher.waitForSelector('.tch-liveRow', { timeout: 40000 })
  await teacher.locator('.tch-liveRow button', { hasText: /מיקוד|focus/i }).first()
    .click().catch(() => null)
  const liveDialog = await teacher.waitForSelector('.tch-focusModal .tch-focusPanel',
                                                   { timeout: 15000 })
    .then(() => true).catch(() => false)
  check('the live view opens the pin dialog as a popup', liveDialog)
  await teacher.screenshot({ path: `${OUT}/live-panel.png` })
} catch (error) {
  failures.push(`crash: ${error.message}`)
} finally {
  // Never leave a class pinned by a test run.
  try {
    const cleanupCtx = await browser.newContext()
    const login = await cleanupCtx.request.post(`${BASE}/api/auth/login`, {
      data: { username: 'demo-teacher-1', password: 'Aa12345' },
    })
    if (login.ok()) {
      for (const id of pinnedLearners) {
        await cleanupCtx.request.delete(`${BASE}/api/teacher/students/${id}/pin-next`)
      }
    }
  } catch { /* cleanup is best-effort */ }
  await browser.close()
}

console.log(failures.length ? `\nFAIL: ${failures.join('; ')}` : '\nall good')
process.exit(failures.length ? 1 : 0)
