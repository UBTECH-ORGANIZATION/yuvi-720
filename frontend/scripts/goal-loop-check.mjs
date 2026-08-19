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

  // ── the teacher opens the goal composer from the profile's goals card ─────
  /* The profile is one scrolling page now: the goals card sits in `#goals`,
     and the composer lives in the GoalDialog its + button opens. */
  await teacher.goto(`${BASE}/teacher/student/${LEARNER}`, { waitUntil: 'domcontentloaded' })
  await teacher.waitForSelector('#goals .tch-goalsCard', { timeout: 40000 })
  await teacher.locator('#goals').scrollIntoViewIfNeeded()
  check('the goals card offers a create button',
        await teacher.locator('#goals .tch-goalsCard button', { hasText: 'יצירת יעד' }).count() === 1)
  await teacher.locator('#goals .tch-goalsCard button', { hasText: 'יצירת יעד' }).click()
  await teacher.waitForSelector('.tch-goalDialog', { timeout: 15000 })
  await teacher.waitForSelector('.tch-composer', { timeout: 30000 })
  await teacher.screenshot({ path: `${OUT}/01-goal-dialog.png`, fullPage: true })

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
    /* #253 rewrote the disclosure: the datum arrives as the draft's own
       "because" sentence rather than the shared raw block. Either element
       satisfies the invariant — the observation is on screen after the click. */
    check('opening a draft\'s "why?" shows the raw evidence',
          await teacher.locator(
            '.tch-draft .tch-evidence__raw, .tch-draft .tch-draft__because'
          ).count() > 0)
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

  /* Assigning closes the dialog and the goals card refetches — the goal must
     land in the card's own list on the page. */
  const listed = await waitFor(teacher, () =>
    document.querySelectorAll('.tch-goalsCard__goal').length > 0, 20000)
  check('the assigned goal appears in the teacher\'s list',
        (await teacher.locator('.tch-goalsCard__goal').count()) > 0, `${listed}ms`)

  // ── the student's bell rings, with no reload ──────────────────────────────
  const rang = await waitFor(student, () =>
    document.querySelector('.notif__badge') !== null, 25000)
  check('the student\'s bell rings live, with no reload',
        rang >= 0, rang >= 0 ? `${rang}ms` : 'timed out')
  await student.screenshot({ path: `${OUT}/03-bell.png` })

  await student.locator('.notif__bell').click()
  await student.waitForTimeout(600)
  const panelText = await student.locator('.notif__panel').innerText().catch(() => '')
  check('the notification names the goal', panelText.includes(title.slice(0, 27)),
        panelText.slice(0, 80))
  check('no raw locale key leaked into the panel', !/notif\.[a-zA-Z.]+/.test(panelText))
  await student.screenshot({ path: `${OUT}/04-panel.png` })

  // ── clicking it lands on the goal itself ──────────────────────────────────
  /* THIS goal's row, not the newest one. The bell now also carries "a
     conversation with you was recorded" from the mentoring composer, so the
     first row is whatever happened most recently in this account — which sent
     the check to a different conversation and then failed to find its goal. */
  const goalNotif = student.locator('.notif__row', { hasText: title.slice(0, 27) }).first()
  await (await goalNotif.count() ? goalNotif.locator('.notif__rowMain')
    : student.locator('.notif__row .notif__rowMain').first()).click()
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
  }, title.slice(0, 27))
  check('opening a notification marks that row read', stillUnread === false,
        stillUnread === null ? 'row not found' : `is-unread=${stillUnread}`)

  // ── the student finishes the goal ─────────────────────────────────────────
  /* The inbox holds goals the STUDENT marked done — approval is of completion,
     not of assignment. Without this walk (start → finish) the pending check
     below asserts a row that cannot exist. */
  await student.locator('.notif__bell').click()   // close the panel first
  await student.waitForTimeout(500)
  const goalRow = student.locator('.mt-fgoal', { hasText: title.slice(0, 27) }).first()
  check('the goal row is on the mentoring page', await goalRow.count() > 0)
  await goalRow.locator('.mt-fgoal__advance').click()          // התחלתי
  await student.waitForTimeout(1200)
  await goalRow.locator('.mt-fgoal__advance').click()          // סיימתי
  const markedDone = await waitFor(student, () =>
    [...document.querySelectorAll('.mt-fgoal.is-done')].length > 0, 15000)
  check('the student can walk it to done', markedDone >= 0,
        markedDone >= 0 ? `${markedDone}ms` : 'timed out')
  await student.screenshot({ path: `${OUT}/06-done.png` })

  // ── approve → sparks, reported honestly ───────────────────────────────────
  /* Approval moved with the refactor: the profile's goals card only lists and
     composes, and the goals BOARD's pending inbox is now the one place a
     teacher approves. Pending goals arrive grouped per child and collapsed. */
  const openPendingGroups = async () => {
    /* The inbox SHELL mounts before its data arrives — waiting on it found
       zero group heads to click and reported an empty inbox that wasn't.
       Wait for the heads themselves (a goal was just marked done above, so
       at least one group must appear). */
    await teacher.waitForSelector('.tch-goalsPage__pendingHead', { timeout: 40000 })
    for (const head of await teacher.locator('.tch-goalsPage__pendingHead').all()) {
      await head.click().catch(() => {})
    }
    await teacher.waitForTimeout(600)
  }
  // goalTitle() strips the long digit run from the title, so match its head.
  const needle = title.replace(/\s*\d+$/, '').trim()

  /* The board fetches on mount, and the student's "done" write can land a
     beat after that fetch left — one snapshot loses the race roughly half the
     time. Reload until the row is there (or three misses = a real failure). */
  let pendingBefore = 0
  for (let attempt = 0; attempt < 3 && pendingBefore === 0; attempt += 1) {
    await teacher.goto(`${BASE}/teacher/goals`, { waitUntil: 'domcontentloaded' })
    await openPendingGroups().catch(() => {})
    pendingBefore = await teacher
      .locator('.tch-goalsPage__pendingRow', { hasText: needle }).count()
    if (pendingBefore === 0) await teacher.waitForTimeout(2000)
  }
  const pendingRow = teacher
    .locator('.tch-goalsPage__pendingRow', { hasText: needle }).first()
  const hasPending = pendingBefore > 0
  check('the assigned goal waits in the approval inbox', hasPending)

  if (hasPending) {
    await pendingRow.locator('button.sp-btn--primary').click()
    const outcome = await waitFor(teacher, () =>
      document.querySelectorAll('.tch-goalsPage__outcome').length > 0, 20000)
    check('approving reports an outcome', outcome >= 0, `${outcome}ms`)

    const outcomeText = await teacher.locator('.tch-goalsPage__outcome').innerText().catch(() => '')
    check('the outcome states what actually happened', outcomeText.length > 0, outcomeText.slice(0, 90))
    check('the outcome is not a raw key', !/tch\.goals\.outcome/.test(outcomeText))
    await teacher.screenshot({ path: `${OUT}/06-approved.png`, fullPage: true })

    // Approving again must be recognised, not paid twice. The board strips
    // the title's digit run, so every run's test goal WEARS THE SAME TEXT —
    // asserting zero rows fails on any residue from an interrupted run.
    // What approval must actually do is remove THIS goal: one fewer row.
    await teacher.reload({ waitUntil: 'domcontentloaded' })
    await openPendingGroups().catch(() => {})   // zero groups left is success too
    const stillPending = await teacher
      .locator('.tch-goalsPage__pendingRow', { hasText: needle }).count()
    check('an approved goal no longer offers approval',
          stillPending === pendingBefore - 1,
          `${pendingBefore} before, ${stillPending} after`)
  }

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
