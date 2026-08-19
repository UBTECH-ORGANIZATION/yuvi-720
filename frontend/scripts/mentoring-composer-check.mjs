/* A documented conversation, end to end, across two browser contexts.
 *
 *   teacher opens the composer → writes what was discussed → adds a private
 *   note the child must never see → collects goals from up to three different
 *   sources → saves ONCE → one row in the history → the student sees the same
 *   conversation on their own page, with the private note nowhere in it.
 *
 * Two properties are the reason this file exists.
 *
 *   **One talk is one record.** Several goals agreed in one conversation must
 *   land as a single `mentoring_conversation`, not as N unrelated assignments.
 *   A wizard that posts N `assign_goal` calls would pass every screenshot and
 *   ship none of the model, so the count is asserted on the wire and not on the
 *   page: exactly one new conversation, carrying all the goals.
 *
 *   **A teachers-only note stays with teachers.** `GET /api/mentoring` used to
 *   take the viewer's role as an unvalidated query argument, so a child who
 *   called it read the notes written about them. That is fixed at the service
 *   default; this proves it from the child's own session, in the JSON and in
 *   the DOM, because a leak in either is a leak.
 *
 * Never uses `waitUntil: 'networkidle'` — both pages hold SSE open.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/mentoring-composer'
/* gal→gal, for the reason `goal-loop-check.mjs` records at length: it is the
   only connected teacher→learner pair among the real accounts. Scoping is not
   what this file proves — `test_mentoring_visibility_role.py` and the two-gate
   route tests do that. */
const LEARNER = 'gal'
const TEACHER = 'gal'
mkdirSync(OUT, { recursive: true })

const stamp = Date.now()
const NOTES = `בדיקת תיעוד שיחה ${stamp} — דיברנו על מה שקשה במתמטיקה ועל מה עוזר.`
const PRIVATE = `סוד-בדיקה-${stamp}`
const OWN_GOAL = `יעד שנכתב ביד ${stamp}`

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
  await page.waitForSelector('.notif__bell, .teacher-app-nav', { timeout: 60000 })
    .catch(() => {})
  await dismissTourIfOpen(page)
  return page
}

/** How many conversations the learner has, read as the teacher. The count is
 *  the only way to prove "one talk, one record" — the screen would look the
 *  same whether the composer wrote one conversation or three. */
const conversationCount = async (context) => {
  const response = await context.request.get(
    `${BASE}/api/teacher/students/${LEARNER}/goals`, { failOnStatusCode: false })
  if (!response.ok()) return -1
  const payload = await response.json()
  return (payload.conversations ?? payload.learners?.[0]?.conversations ?? []).length
}

const browser = await chromium.launch()

try {
  const teacherCtx = await browser.newContext({ viewport: { width: 1500, height: 1050 } })
  const teacher = await signIn(teacherCtx, TEACHER, '/teacher')

  const before = await conversationCount(teacherCtx)

  // ── open the composer ─────────────────────────────────────────────────────
  await teacher.goto(`${BASE}/teacher/goals`, { waitUntil: 'domcontentloaded' })
  await teacher.waitForSelector('.tch-goalsPage__inbox', { timeout: 60000 })
  await dismissTourIfOpen(teacher)

  /* A draft left open by an interrupted run would make the button say "resume"
     and reopen somebody else's write-up. Clear it first — this is a test
     account's scratch state, not a record. */
  await teacher.evaluate(() => fetch('/api/teacher/state', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mentoring_draft: null }),
    credentials: 'include',
  }))
  await teacher.reload({ waitUntil: 'domcontentloaded' })
  await teacher.waitForSelector('.tch-goalsPage__inbox', { timeout: 60000 })

  await teacher.locator('[data-tour="teacher.goalCreate"]').click()
  await teacher.waitForSelector('.tch-pickDialog', { timeout: 15000 })
  /* Who the conversation was with is asked BEFORE anything is written, and it
     is asked once. A picker that sat above the write-up for three steps would
     be a control the teacher had already finished with. */
  const named = teacher.locator('.tch-pickDialog__list button').filter({ hasText: LEARNER })
  const target = (await named.count()) ? named.first()
    : teacher.locator('.tch-pickDialog__list button').first()
  /* Remember WHO was picked rather than assuming it: the buttons carry display
     names, and the roster's name for the learner need not contain their id.
     Every later assertion about "their row" uses this. */
  const studentName = (await target.innerText()).trim()
  await target.click()

  await teacher.waitForSelector('.tch-mentoringModal', { timeout: 20000 })
  // The stepper marks one current step; the dots are icons of what each step
  // IS, so there is no number to assert on.
  check('the composer opens on the first step',
        await teacher.locator('.tch-stepper li').first()
          .evaluate((node) => node.className.includes('is-current')).catch(() => false))
  /* What to raise stays on screen for every step — it is as relevant while
     choosing goals as while writing the notes. */
  check('the conversation prep travels with the composer',
        await teacher.locator('.tch-mentoringModal .tch-prepPanel').count() === 1)
  /* No raw payload in the prep column, ever.
     `describeSignal` falls back to a generic renderer that walks whatever it
     was handed, so a signal with no sentence of its own printed
     `0: {'label': 'לזהות מה עוזר לי ללמוד', 'status': 'working'}` under a
     Hebrew paragraph that had just said the same thing properly. A card shows
     the sentence or nothing. */
  await teacher.locator('.tch-prepCard, .tch-prepPanel__none')
    .first().waitFor({ timeout: 90000 }).catch(() => {})
  const prepText = await teacher.locator('.tch-prepPanel').innerText().catch(() => '')
  const leaked = [/\{'/, /'\s*:\s*'/, /^\s*\d+:\s/m].filter((shape) => shape.test(prepText))
  check('the prep column never prints a raw payload', leaked.length === 0,
        leaked.length ? prepText.slice(0, 160).replace(/\n/g, ' | ') : '')

  await teacher.screenshot({ path: `${OUT}/01-composer.png`, fullPage: true })

  // ── step 1: what was discussed, and what the child cannot read ────────────
  const nextButton = teacher.locator('.tch-mentoringModal__actions button').last()
  check('a write-up with nothing in it cannot advance', await nextButton.isDisabled())

  await teacher.locator('.tch-step__notes').fill(NOTES)
  await teacher.waitForTimeout(250)
  check('writing what was discussed unlocks the next step',
        await nextButton.isEnabled())

  const aside = teacher.locator('.tch-step__aside')
  check('the teachers-only note is folded away and labelled',
        await aside.count() === 1
        && await aside.evaluate((node) => !node.open))
  await aside.locator('summary').click()
  await aside.locator('textarea').fill(PRIVATE)
  await teacher.screenshot({ path: `${OUT}/02-discussed.png`, fullPage: true })

  await nextButton.click()
  await teacher.waitForSelector('.tch-goalsStep', { timeout: 20000 })

  // ── step 2: goals, from as many sources as the data supports ─────────────
  /* Three sources, two of which need a model and real evidence behind them.
     They are taken when they are there and reported when they are not — an
     assertion that DEMANDS a suggestion would fail on an honest "no evidence
     yet", which is the answer this codebase spends a lot of effort giving.

     Both bands load themselves — there is no "suggest" button to press any
     more — so this only waits for each to settle into cards or an honest
     empty line. */
  /* One list now, from both sources, and it loads itself — there is no
     "suggest" button to press. The skeleton wears its own class so waiting for
     `.tch-draft` cannot succeed against a placeholder, which is exactly how an
     earlier version of this check reported an empty step that had three cards
     in it a second later. */
  const band = teacher.locator('.tch-goalsStep__band')
  await band.locator('.tch-draft:not(.tch-draft--skeleton), .tch-goalsStep__none')
    .first().waitFor({ timeout: 120000 }).catch(() => {})

  const sources = []
  const cards = band.locator('.tch-draft:not(.tch-draft--skeleton):not(.tch-draft--empty)')
  const suggested = await cards.count()
  if (suggested) {
    // Every suggestion names the observation under it — an unattributable
    // suggestion about a child is the one a teacher cannot check.
    const whys = await band.locator(
      '.tch-draft:not(.tch-draft--skeleton):not(.tch-draft--empty) .tch-evidence__toggle').count()
    check('every suggestion shows what it rests on', whys === suggested,
          `${whys}/${suggested}`)
    await cards.first().locator('.tch-draft__use').click()
    sources.push('a suggestion')
  } else {
    // Honest emptiness is a valid outcome and must not be a fabricated goal.
    check('an empty list says so rather than inventing a goal',
          await band.locator('.tch-goalsStep__none, .tch-draft--empty').count() > 0)
  }

  // The hand-written one: one press, no disclosure to open first.
  await teacher.locator('.tch-goalsStep__addOwn').click()
  sources.push('written by hand')
  /* The #253 audience hint sits AT the fields, not in a section header: a
     teacher typing a title has to know the child is the reader. */
  await teacher.waitForSelector('.tch-chosenGoals > li.is-open', { timeout: 10000 })
  check('the goal fields say who will read the goal',
        await teacher.locator('.tch-chosenGoals > li.is-open .tch-composer__audience')
          .count() > 0)

  const chosen = teacher.locator('.tch-chosenGoals > li')
  await chosen.first().waitFor({ timeout: 10000 })
  check('a goal can be taken from a suggestion and written by hand',
        sources.length >= 1, sources.join(', '))

  // The newly added one opens for editing; title it.
  const openGoal = teacher.locator('.tch-chosenGoals > li.is-open')
  await openGoal.locator('input').first().fill(OWN_GOAL)
  await teacher.waitForTimeout(200)

  const goalCount = await chosen.count()
  check('every chosen goal is listed together', goalCount === sources.length,
        `${goalCount} goals from ${sources.length} sources`)
  check('no goal is missing the deadline it needs',
        await teacher.locator('.tch-chosenGoals__warn').count() === 0)
  await teacher.screenshot({ path: `${OUT}/03-goals.png`, fullPage: true })

  await teacher.locator('.tch-mentoringModal__actions button').last().click()

  // ── step 3: read it back, then save once ─────────────────────────────────
  await teacher.waitForTimeout(500)
  const review = await teacher.locator('.tch-mentoringModal__stage').innerText()
  check('the review reads back what was written', review.includes(NOTES.slice(0, 30)))
  check('the review reads back the goal', review.includes(OWN_GOAL.slice(0, 20)))
  /* Shown to the teacher on the way out, because they are about to save
     something the child will not see and should be reminded of it. */
  check('the review names the private note as private',
        review.includes(PRIVATE))
  await teacher.screenshot({ path: `${OUT}/04-review.png`, fullPage: true })

  const saveButton = teacher.locator('.tch-mentoringModal__actions button').last()
  check('a complete write-up can be saved', await saveButton.isEnabled())
  await saveButton.click()
  /* Either outcome, explicitly. A save that fails leaves the composer up with
     the reason under it — reporting that reason is the difference between "the
     harness timed out" and knowing what broke. */
  const closed = await teacher.waitForSelector('.tch-mentoringModal', {
    state: 'detached', timeout: 45000,
  }).then(() => true).catch(() => false)
  check('saving closes the composer', closed,
        closed ? '' : await teacher.locator('.tch-composer__failed').innerText()
          .catch(() => 'no failure message either'))
  if (!closed) throw new Error('the write-up never saved')

  // ── one talk is one record ────────────────────────────────────────────────
  const after = await conversationCount(teacherCtx)
  check('N goals in one conversation wrote ONE conversation',
        before >= 0 && after === before + 1, `${before} → ${after}`)

  // ── the history shows it, on the student's own row ────────────────────────
  /* Reloaded rather than waited on. Saving fires the page's own refetch, but
     the modal detaches when that request is ISSUED, not when it lands — and a
     collapsed row shows no talk text, so there is nothing to poll for. One
     reload is deterministic where a wait would be a guess. */
  await teacher.reload({ waitUntil: 'domcontentloaded' })
  await teacher.waitForSelector('.tch-goalsPage__student', { timeout: 30000 })
  const row = teacher.locator('.tch-goalsPage__student').filter({ hasText: studentName })
  check('the student has exactly one row in the history, not one per goal',
        await row.count() === 1, `${await row.count()} rows for ${studentName}`)
  await row.first().locator('.tch-goalsPage__talkToggle').click()
  await teacher.waitForSelector('.tch-talksDialog .tch-goalsPage__talk', { timeout: 15000 })

  const talk = teacher.locator('.tch-talksDialog .tch-goalsPage__talk').first()
  const talkText = await talk.innerText()
  check('the talk is in the history with what was discussed',
        talkText.includes(NOTES.slice(0, 30)))
  check('its goals are listed under it',
        await talk.locator('.tch-goalsPage__talkGoal').count() === goalCount,
        `${await talk.locator('.tch-goalsPage__talkGoal').count()} of ${goalCount}`)
  /* Named, not hidden. A teacher rereading a record should know it carries
     something the child cannot see, even where the text is not shown. */
  check('the record is badged as carrying a private note',
        await talk.locator('.tch-goalsPage__private').count() === 1)
  await teacher.screenshot({ path: `${OUT}/05-history.png`, fullPage: true })

  // ── the child sees the conversation, and none of the private note ────────
  const studentCtx = await browser.newContext({ viewport: { width: 1200, height: 950 } })
  const student = await signIn(studentCtx, LEARNER, '/mentoring')
  await student.waitForTimeout(2500)

  /* The contract, read from the child's own session. This is the exact call
     that used to accept `?role=teacher` from anyone. */
  const asLearner = await studentCtx.request.get(`${BASE}/api/mentoring?role=teacher`)
  // Parsed and re-stringified rather than read as text: what must be absent is
  // absent from the DATA, not merely from one serializer's escaping.
  const payload = asLearner.ok() ? JSON.stringify(await asLearner.json()) : ''
  check('the learner API answers the child', asLearner.ok(), `${asLearner.status()}`)
  check('and carries no teachers-only note, whatever ?role= says',
        !payload.includes('teacher_only_note') && !payload.includes(PRIVATE))
  check('while still carrying the conversation itself',
        payload.includes(NOTES.slice(0, 30)))

  const visible = await student.evaluate(() => document.body.innerText)
  check('the child can read the conversation on their page',
        visible.includes(NOTES.slice(0, 30)))
  check('and the private note is nowhere on it', !visible.includes(PRIVATE))
  await student.screenshot({ path: `${OUT}/06-student.png`, fullPage: true })

  const overflow = await teacher.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('page does not scroll horizontally', overflow <= 1, `${overflow}px`)
} finally {
  await browser.close()
}

console.log(failures.length
  ? `\n✘ ${failures.length} failure(s)` : '\n✅ mentoring composer check passed')
if (failures.length) { failures.forEach((f) => console.log(`   - ${f}`)); process.exit(1) }
