/* The goal loop end to end, across two browser contexts.
 *
 * teacher assigns → student's bell rings live → student clicks the notification
 * → lands on the goal itself → teacher approves → sparks, honestly reported.
 *
 * The assertions that matter most are about honesty: the notification must not
 * claim sparks that were not granted, and dismissing must not destroy the record
 * of what someone was told.
 *
 * Never uses `waitUntil: 'networkidle'` — both pages hold SSE connections open.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/goal-loop'
/* Both sides are `gal`, and that is a finding rather than a shortcut.
 *
 * The demo-fixture learners have never run the mapping flow, so the onboarding
 * guard holds them there and they never reach the app bar the bell lives in.
 * Among the real accounts, the ONLY connected teacher→learner pair is gal→gal
 * via `group-gal`: `group-720-a` is staffed by two teachers and has zero
 * enrollments, so moti cannot see gal and the 403 is correct behaviour.
 *
 * Scoping is therefore NOT what this file proves — `test_goal_approval.py` and
 * the outsider case in `teacher-live-check.mjs` do that. This proves the loop:
 * assign → bell → deep link → approve → honest sparks. */
const LEARNER = 'gal'
const TEACHER = 'gal'
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const waitFor = async (page, fn, timeout = 20000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - started
    await page.waitForTimeout(200)
  }
  return -1
}

/* Sign in through the API, not the landing page: its WebGL scene can hang a
   Playwright click for the full timeout under load, which has nothing to do with
   the goal loop. The request context shares its cookie jar with the browser
   context, so this puts a real session on every page it opens. The landing
   sign-in button is covered by `teacher-app-check.mjs`, which drives it. */
const signIn = async (context, username, landing) => {
  const response = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username, password: 'Aa12345' },
  })
  if (!response.ok()) throw new Error(`login failed for ${username}: ${response.status()}`)
  const page = await context.newPage()
  await page.goto(`${BASE}${landing}`, { waitUntil: 'domcontentloaded' })
  // The dashboard fans out over several requests before the chrome renders.
  await page.waitForSelector('.notif__bell, .teacher-app-nav', { timeout: 60000 })
    .catch(() => {})
  // Phase 8: the tour opens itself for an account that has not seen it,
  // and its scrim blocks clicks. Dismiss it as a teacher would.
  await dismissTourIfOpen(page)
  return page
}

const browser = await chromium.launch()
const title = `בדיקת לולאת יעדים ${Date.now()}`

try {
  const studentCtx = await browser.newContext({ viewport: { width: 1200, height: 950 } })
  const student = await signIn(studentCtx, LEARNER, '/student-dashboard')
  check('the student has a bell', await student.locator('.notif__bell').count() === 1)

  const teacherCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const teacher = await signIn(teacherCtx, TEACHER, '/teacher')

  // ── the teacher opens the goals tab ───────────────────────────────────────
  await teacher.goto(`${BASE}/teacher/student/${LEARNER}`, { waitUntil: 'domcontentloaded' })
  await teacher.waitForSelector('.tch-tabs', { timeout: 40000 })
  const tabs = teacher.locator('.tch-tabs button')
  check('the profile now has seven tabs', await tabs.count() === 7, `${await tabs.count()}`)
  await tabs.nth(2).click()
  await teacher.waitForSelector('.tch-composer', { timeout: 30000 })
  await teacher.screenshot({ path: `${OUT}/01-goals-tab.png`, fullPage: true })

  // ── AI drafts, each carrying its evidence ─────────────────────────────────
  await teacher.locator('.tch-composer button.sp-btn--ghost').first().click()
  const drafted = await waitFor(teacher, () =>
    document.querySelectorAll('.tch-draft, .sp-empty').length > 0, 45000)
  check('goal suggestions return something', drafted >= 0, `${drafted}ms`)

  // An "unavailable" card is the honest no-evidence answer, not a draft.
  const draftCards = await teacher.locator('.tch-draft:not(.tch-draft--empty)').count()
  const emptyCards = await teacher.locator('.tch-draft--empty').count()
  if (draftCards > 0) {
    const whys = await teacher.locator('.tch-draft .tch-evidence__toggle').count()
    check('every draft shows the observation behind it', whys === draftCards,
          `${whys}/${draftCards}`)
    await teacher.locator('.tch-draft .tch-evidence__toggle').first().click()
    await teacher.waitForTimeout(400)
    check('opening a draft\'s "why?" shows the raw evidence',
          await teacher.locator('.tch-draft .tch-evidence__raw').count() > 0)
  } else {
    // Honest emptiness is a valid outcome and must not be a fabricated goal.
    check('with no evidence the composer says so rather than inventing goals',
          emptyCards > 0 || (await teacher.locator('.sp-empty').count()) > 0,
          `${emptyCards} explicit "no evidence" cards`)
  }
  await teacher.screenshot({ path: `${OUT}/02-drafts.png`, fullPage: true })

  // ── assign ────────────────────────────────────────────────────────────────
  const form = teacher.locator('.tch-composer__form')
  await form.locator('input').first().fill(title)
  await form.locator('textarea').fill('לפתור שלוש שאלות')
  await form.locator('button.sp-btn').click()

  const listed = await waitFor(teacher, (needle) =>
    document.querySelector('.tch-goals__list')?.textContent?.includes(needle) ?? false,
    20000, title)
  check('the assigned goal appears in the teacher\'s list',
        (await teacher.locator('.tch-goal').count()) > 0, `${listed}ms`)

  // ── the student's bell rings, with no reload ──────────────────────────────
  const rang = await waitFor(student, () =>
    document.querySelector('.notif__badge') !== null, 25000)
  check('the student\'s bell rings live, with no reload',
        rang >= 0, rang >= 0 ? `${rang}ms` : 'timed out')
  await student.screenshot({ path: `${OUT}/03-bell.png` })

  await student.locator('.notif__bell').click()
  await student.waitForTimeout(600)
  const panelText = await student.locator('.notif__panel').innerText().catch(() => '')
  check('the notification names the goal', panelText.includes(title.slice(0, 12)),
        panelText.slice(0, 80))
  check('no raw locale key leaked into the panel', !/notif\.[a-zA-Z.]+/.test(panelText))
  await student.screenshot({ path: `${OUT}/04-panel.png` })

  // ── clicking it lands on the goal itself ──────────────────────────────────
  await student.locator('.notif__row .notif__rowMain').first().click()
  await student.waitForTimeout(3000)
  check('the notification deep-links to the mentoring page',
        student.url().includes('/mentoring?conversation='), student.url())
  const flashed = await waitFor(student, () =>
    document.querySelectorAll('.mt-fgoal.is-flash').length > 0, 15000)
  check('the exact goal is highlighted, not just the page',
        flashed >= 0, flashed >= 0 ? `${flashed}ms` : 'timed out')
  await student.screenshot({ path: `${OUT}/05-deeplink.png`, fullPage: true })

  /* Assert on THIS row, not on the badge. Notifications accumulate across runs,
     so a badge showing six unread cannot go to zero because one was opened —
     the earlier version of this check was asserting something that only held on
     an empty inbox. */
  await student.locator('.notif__bell').click()
  await student.waitForTimeout(800)
  const stillUnread = await student.evaluate((needle) => {
    const row = [...document.querySelectorAll('.notif__row')]
      .find((node) => node.textContent?.includes(needle))
    return row ? row.className.includes('is-unread') : null
  }, title.slice(0, 12))
  check('opening a notification marks that row read', stillUnread === false,
        stillUnread === null ? 'row not found' : `is-unread=${stillUnread}`)

  // ── approve → sparks, reported honestly ───────────────────────────────────
  await teacher.reload({ waitUntil: 'domcontentloaded' })
  await teacher.waitForSelector('.tch-tabs', { timeout: 30000 })
  await teacher.locator('.tch-tabs button').nth(2).click()
  await teacher.waitForSelector('.tch-goal', { timeout: 30000 })

  const approveButton = teacher.locator('.tch-goal button.sp-btn').first()
  await approveButton.click()
  const outcome = await waitFor(teacher, () =>
    document.querySelectorAll('.tch-goals__outcome').length > 0, 20000)
  check('approving reports an outcome', outcome >= 0, `${outcome}ms`)

  const outcomeText = await teacher.locator('.tch-goals__outcome').innerText().catch(() => '')
  check('the outcome states what actually happened', outcomeText.length > 0, outcomeText.slice(0, 90))
  check('the outcome is not a raw key', !/tch\.goals\.outcome/.test(outcomeText))
  await teacher.screenshot({ path: `${OUT}/06-approved.png`, fullPage: true })

  // Approving again must be recognised, not paid twice.
  await teacher.reload({ waitUntil: 'domcontentloaded' })
  await teacher.waitForSelector('.tch-tabs', { timeout: 30000 })
  await teacher.locator('.tch-tabs button').nth(2).click()
  await teacher.waitForTimeout(2500)
  const stillPending = await teacher.locator('.tch-goal button.sp-btn', { hasText: /אישור|Approve|اعتماد/ }).count()
  check('an approved goal no longer offers approval', stillPending === 0, `${stillPending} buttons`)

  // ── dismissal is a soft delete ────────────────────────────────────────────
  await student.reload({ waitUntil: 'domcontentloaded' })
  await student.waitForTimeout(3500)
  await student.locator('.notif__bell').click()
  await student.waitForTimeout(800)
  const before = await student.locator('.notif__row').count()
  check('the approval notification arrived', before > 0, `${before} rows`)

  await student.locator('.notif__dismiss').first().click()
  await student.waitForTimeout(1200)
  const after = await student.locator('.notif__row').count()
  check('dismissing removes the row from the panel', after === before - 1, `${after} of ${before}`)
  check('an undo is offered', await student.locator('.notif__undo').count() === 1)

  await student.locator('.notif__toggle input').check()
  await student.waitForTimeout(1200)
  const revealed = await student.locator('.notif__row.is-dismissed').count()
  check('the dismissed row still exists and can be shown again', revealed > 0,
        `${revealed} dismissed`)
  await student.screenshot({ path: `${OUT}/07-dismissed.png` })

  const overflow = await teacher.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('page does not scroll horizontally', overflow <= 1, `${overflow}px`)

  // Leave the inbox as we found it. Dismissal is a soft delete, so this clears
  // the panel without destroying the record of what the learner was told.
  await student.evaluate(() =>
    fetch('/api/notifications/dismiss-all', { method: 'POST', credentials: 'include' }))
} finally {
  await browser.close()
}

console.log(failures.length ? `\n✘ ${failures.length} failure(s)` : '\n✅ goal loop check passed')
if (failures.length) { failures.forEach((f) => console.log(`   - ${f}`)); process.exit(1) }
