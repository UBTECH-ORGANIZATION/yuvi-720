/* The ministry's xAPI test script, driven against a running Spark.
 *
 *   cd frontend && node scripts/lrs-test-script-run.mjs --phase all
 *   cd frontend && node scripts/lrs-test-script-run.mjs --base https://dev.spark.yuvilab.ai --api https://dev.spark.yuvilab.ai --phase session,dashboard
 *
 * Environment-agnostic: it signs in through POST /api/auth/login with the
 * seeded accounts (never a minted cookie — only a real login files `enter`,
 * and SECRET_KEY differs per environment), drives the product from the
 * browser, and writes a manifest the report generator reads:
 *
 *   <out>/run.json       started_at / finished_at, base, phases
 *   <out>/manifest.json  session ids per scenario (tab closed, killed,
 *                        re-login), per-phase notes, the source of each
 *                        action (ui | api | manual)
 *   <out>/*.png          screenshots at the interesting moments
 *
 * Data actions that have no UI-only path worth automating (the 31 agency
 * answers behind an animated ring, a teacher's mentoring write-up) are made
 * from INSIDE the page with the same calls the product's own screens make —
 * labelled `api` in the manifest. Content interactions inside the CET iframe
 * are cross-origin and vendor-owned: the lesson phase opens the lomda and,
 * with --manual, pauses for a person to click through it.
 *
 * Phases: session, onboarding, dashboard, lesson, assessment, teacher, mentoring,
 *         goals, relogin, tabclose, kill  (or `all`; the last three need the idle
 *         window: set LRS_SESSION_IDLE_MINUTES=2 on the server for the run).
 *         Two extras, not in `all`: `reflection` (the post-lesson reflection and
 *         the practice decision through the product's own API — for a run where
 *         the completion dialog never opened, e.g. the content resumed finished)
 *         and `explainer` (a lesson whose objective HAS an alternative
 *         representation, for item·selected; --component names it).
 *
 * The assessment phase (TC-ITM-10/11) opens an `isAssessment=true` component
 * ("שאלת שיא") twice — once to finish it with every answer WRONG, once RIGHT.
 * --assess-fail / --assess-pass name the components; when both are the same
 * one, the second visit takes the re-entry dialog's "start over" (Kata
 * resetState) so the attempt really begins again.
 *
 * Accounts: scripts/seed_lrs_test_accounts.py --fresh (backend). */

import { chromium } from 'playwright'
import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).map((arg, index, all) => {
    if (!arg.startsWith('--')) return []
    const key = arg.slice(2)
    const next = all[index + 1]
    return [key, next && !next.startsWith('--') ? next : 'true']
  }).filter((pair) => pair.length),
)

if (args.help === 'true') {
  console.log(`usage: node scripts/lrs-test-script-run.mjs [--base URL] [--api URL] [--out DIR] [--password P]
       [--student ID] [--teacher ID] [--headed] [--manual] [--idle-minutes N] [--unit ID] [--component ID]
       [--assess-fail COMPONENT] [--assess-pass COMPONENT]
       [--phase session,onboarding,dashboard,lesson,assessment,teacher,mentoring,goals,relogin,tabclose,kill]`)
  process.exit(0)
}

const BASE = args.base || process.env.YUVI_BASE_URL || 'http://localhost:5173'
const API = args.api || process.env.YUVI_API || BASE.replace(':5173', ':8720')
const OUT = path.resolve(args.out || `../artifacts/lrs-run-${new Date().toISOString().slice(0, 10)}-${/dev\.spark/.test(BASE) ? 'dev' : 'local'}`)
const PASSWORD = args.password || process.env.LRS_TEST_PASSWORD || 'Bodek720!'
const STUDENT = args.student || 'lrs-student'
const TEACHER = args.teacher || 'lrs-teacher'
const HEADED = args.headed === 'true' || args.manual === 'true'
const MANUAL = args.manual === 'true'
const IDLE_MINUTES = Number(args['idle-minutes'] || process.env.LRS_SESSION_IDLE_MINUTES || 2)
const UNIT = args.unit || 'methodica-science-mass-measure-01'
const COMPONENT = args.component || 'methodica-science-mass-measure-01-01'
// The catalog's assessment components in the methodica mass units (isAssessment=true).
const ASSESS_FAIL = args['assess-fail'] || 'methodica-science-mass-measure-01-05'
const ASSESS_PASS = args['assess-pass'] || 'methodica-science-mass-measure-02-05'
const unitOf = (componentId) => componentId.replace(/-\d+$/, '')
const PHASES = (args.phase || 'all') === 'all'
  ? ['session', 'onboarding', 'dashboard', 'lesson', 'assessment', 'teacher', 'mentoring', 'goals', 'relogin', 'tabclose', 'kill']
  : args.phase.split(',').map((p) => p.trim()).filter(Boolean)

const manifest = { base: BASE, api: API, sessions: {}, phases: {}, notes: [] }
const run = { started_at: new Date().toISOString(), base: BASE, phases: PHASES }
const log = (line) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const note = (phase, text, source = 'ui') => {
  ;(manifest.phases[phase] ||= []).push({ at: new Date().toISOString(), text, source })
  log(`  · ${text}`)
}
const rl = createInterface({ input: stdin, output: stdout })
let pauseCount = 0
const RUN_TAG = Date.now().toString(36)
async function pause(phase, instruction) {
  if (!MANUAL) { note(phase, `skipped (no --manual): ${instruction}`, 'manual'); return false }
  // Either Enter on this terminal, or a marker file (`continue-N` in the run
  // directory) when the driver runs detached from the tester's keyboard.
  // Per-process name: a marker left by an earlier invocation into the same
  // run folder must not release this one's pauses.
  const marker = path.join(OUT, `continue-${RUN_TAG}-${++pauseCount}`)
  log(`\n⏸  ${instruction}\n   press Enter here — or create ${marker} — when done…`)
  await Promise.race([
    rl.question('').catch(() => new Promise(() => undefined)),
    (async () => { while (!(await access(marker).then(() => true, () => false))) await sleep(2000) })(),
  ])
  note(phase, instruction, 'manual')
  return true
}

/* ── In-page API helpers: the same calls the product's screens make. ─────── */
async function call(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const response = await fetch(url, {
      method, credentials: 'include',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let data = null
    try { data = await response.json() } catch { /* no body */ }
    return { status: response.status, data }
  }, { method, url, body })
}

async function login(page, username, phase) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const result = await call(page, 'POST', '/api/auth/login', { username, password: PASSWORD })
  if (result.status !== 200) throw new Error(`login ${username} → ${result.status} ${JSON.stringify(result.data)}`)
  // The shell learns about the cookie on its next load — without it the
  // session beacons (suspend/resume/ping) and the viewed hooks never run.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
  // A first visit opens the guided tour over the whole app; skipping it is
  // what a tester does, and its completion is stored on the account.
  const tourSkip = page.locator('.sp-tour__skip').first()
  if (await tourSkip.count()) { await tourSkip.click().catch(() => undefined); await sleep(1000) }
  const me = await call(page, 'GET', '/api/auth/me')
  const sid = me.data?.session_id
  note(phase, `login ${username} → session ${sid}`, 'ui')
  // Every session this run opened: the results are scoped to them, so a
  // colleague using the same test account meanwhile cannot pollute a row.
  manifest.sessions.all = [...(manifest.sessions.all || []), sid]
  return sid
}

async function logout(page, phase) {
  const result = await call(page, 'POST', '/api/auth/logout', {})
  note(phase, `logout → ${result.status}`, 'ui')
}

async function visibility(page, state, phase) {
  // What the shell reads on a tab switch: `document.hidden` + `visibilitychange`.
  // (CDP's Page.setWebLifecycleState only knows frozen/active and does not
  // flip visibility in headless Chromium.)
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state === 'hidden')
  note(phase, `tab ${state === 'hidden' ? 'hidden (suspend)' : 'active (resume)'}`)
  await sleep(1500)
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false }).catch(() => undefined)
}

async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') log(`  [browser] ${message.text().slice(0, 140)}`)
  })
  return { context, page }
}

async function settle(page, ms = 4000) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
  await sleep(ms)
}

/* ── Phases ──────────────────────────────────────────────────────────────── */
async function phaseSession(browser) {
  const phase = 'session'
  const { context, page } = await newPage(browser)
  const sid = await login(page, STUDENT, phase)
  manifest.sessions.logout_session = sid
  await settle(page, 2000)
  await visibility(page, 'hidden', phase)       // TC-SES-02
  await sleep(2000)
  await visibility(page, 'active', phase)       // TC-SES-03
  await sleep(2000)
  await shot(page, 'session')
  await logout(page, phase)                     // TC-SES-04
  await context.close()
}

async function phaseOnboarding(browser) {
  const phase = 'onboarding'
  const { context, page } = await newPage(browser)
  await login(page, STUDENT, phase)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await settle(page, 3000)
  await shot(page, 'onboarding-landing')
  // The questionnaire load files agency `initialized` (once per journey).
  const questionnaire = await call(page, 'GET', '/api/questionnaire?lang=he')
  note(phase, `questionnaire loaded → ${questionnaire.status} (agency initialized)`, 'api')
  const parts = questionnaire.data?.parts || []
  const questions = parts.flatMap((part) => part.questions || [])
  const answers = {}
  for (const question of questions) {
    const optionIndex = Math.min(2, (question.options || []).length - 1)
    answers[question.id] = optionIndex
    const result = await call(page, 'POST', '/api/questionnaire/answer', { question_number: question.id, option_index: optionIndex })
    if (result.status !== 200) note(phase, `answer ${question.id} → ${result.status}`, 'api')
    await sleep(1200)  // one answer per second, like a child clicking through
  }
  note(phase, `${questions.length} answers reported one by one`, 'api')
  const submit = await call(page, 'POST', '/api/submit', { student_name: 'תלמיד בדיקות', gender: 'boy', answers, language: 'he', free_text: '' })
  note(phase, `submit → ${submit.status}`, 'api')
  await call(page, 'PATCH', '/api/learner-state', { mapping_progress: { completed: true } })
  await page.goto(`${BASE}/results`, { waitUntil: 'domcontentloaded' })
  await settle(page, 4000)
  await shot(page, 'onboarding-results')
  // Results approved → agency completed (the results screen's own transition).
  const done = await call(page, 'PATCH', '/api/learner-state', { profile_summary_progress: { completed: true } })
  note(phase, `results approved → ${done.status} (agency completed)`, 'api')
  await logout(page, phase)
  await context.close()
}

async function phaseDashboard(browser) {
  const phase = 'dashboard'
  const { context, page } = await newPage(browser)
  await login(page, STUDENT, phase)
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await settle(page, 6000)
  await shot(page, 'dashboard-student')
  note(phase, 'student dashboard open 6s')
  await page.goto(`${BASE}/learning`, { waitUntil: 'domcontentloaded' })  // leaving files student-personal viewed
  await settle(page, 2000)
  note(phase, 'left the dashboard (viewed filed with duration)')
  await logout(page, phase)
  await context.close()
}

async function phaseLesson(browser) {
  const phase = 'lesson'
  const { context, page } = await newPage(browser)
  await login(page, STUDENT, phase)
  await page.goto(`${BASE}/learning/lesson?unit=${encodeURIComponent(UNIT)}&component=${encodeURIComponent(COMPONENT)}`, { waitUntil: 'domcontentloaded' })
  await settle(page, 8000)
  await shot(page, 'lesson-open')
  note(phase, `lesson ${COMPONENT} opened (component initialized via the CET relay when the iframe loaded)`)
  await pause(phase, 'In the lomda: open the first screens, answer the SAME question WRONG twice (until Yuvi offers "בוא/י נראה אחרת" — stay on that question), then RIGHT; press the content\'s own hint button, play the video and pause it. (TC-CMP-01, TC-ITM-01/02/05/06/08, item·selected)')

  // v1.1 item·selected: the alternative explainer is offered after a repeated
  // wrong answer; opening it files selected(learning-type) on the ITEM.
  const alt = page.locator('.sp-companion__support-option--alt').first()
  if (await alt.count()) {
    await alt.click()
    note(phase, 'opened the alternative explainer → item selected (selectionType=learning-type, response=presentation)')
    await sleep(5000)
    await page.locator('.sp-explainer__close').first().click().catch(() => page.keyboard.press('Escape'))
    await sleep(1500)
  } else note(phase, 'alternative explainer not offered (needs a repeated wrong answer on one question)', 'ui')

  // Platform support: the hint and explanation buttons, then a typed chat turn and a rating.
  const hint = page.locator('.sp-companion__support-option', { hasText: /רמז|hint/i }).first()
  if (await hint.count()) { await hint.click(); note(phase, 'hint button → requested(platform, hint) + bot turn'); await sleep(8000) }
  else note(phase, 'hint button not visible (no open question yet)', 'ui')
  const explain = page.locator('.sp-companion__support-option', { hasText: /הסבר|explain/i }).first()
  if (await explain.count()) { await explain.click(); note(phase, 'explanation button → requested(platform, explanation) + bot turn'); await sleep(8000) }
  const input = page.locator('.sp-companion__composer input').first()
  if (await input.count()) {
    await input.fill('לא הבנתי את השאלה, אפשר לעזור לי?')
    await page.locator('.sp-companion__send').click()
    note(phase, 'typed a question → student turn + bot turn')
    await sleep(10000)
    const like = page.locator('.sp-companion__rate button').first()
    if (await like.count()) { await like.click(); note(phase, 'liked the reply → rated'); await sleep(1500) }
  }
  await shot(page, 'lesson-coach')
  note(phase, `idle nudge: waiting ${Number(process.env.LESSON_IDLE_SECONDS || 90) + 20}s without touching the page`)
  await sleep((Number(process.env.LESSON_IDLE_SECONDS || 90) + 20) * 1000)
  await shot(page, 'lesson-idle')
  // Answering the nudge: the student's turn keeps the bot's trigger (TC-CNV-03).
  const reply = page.locator('.sp-companion__composer input').first()
  if (await reply.count()) {
    await reply.fill('כן, אני כאן. תכף ממשיך')
    await page.locator('.sp-companion__send').click()
    note(phase, 'replied to the idle nudge → student turn with the bot\'s trigger')
    await sleep(8000)
  }
  await pause(phase, 'In the lomda: finish the component (complete every screen) so the completion dialog opens; then answer the reflection (rate + one text, skip one) and send. Then choose "continue". (TC-CMP-02, TC-ITM-03, TC-REF-*, practice-decision)')
  await shot(page, 'lesson-done')
  await logout(page, phase)
  await context.close()
}

// `pass`: the components named by --pass, each finished with every answer
// right — the repair round the route demands before an assessment opens.
async function phasePass(browser) {
  const phase = 'pass'
  const components = (args.pass || '').split(',').map((s) => s.trim()).filter(Boolean)
  const { context, page } = await newPage(browser)
  await login(page, STUDENT, phase)
  for (const component of components) {
    await page.goto(`${BASE}/learning/lesson?unit=${encodeURIComponent(unitOf(component))}&component=${encodeURIComponent(component)}`, { waitUntil: 'domcontentloaded' })
    await settle(page, 8000)
    const startOver = page.locator('.learning-reentry button', { hasText: /להתחיל מחדש|להתחיל מהתחלה|start over|redo/i }).first()
    if (await startOver.count()) { await startOver.click(); note(phase, `re-entry dialog → start over on ${component}`); await settle(page, 8000) }
    await shot(page, `pass-${component.slice(-5)}-open`)
    await pause(phase, `In the lomda (${component}): answer EVERY question RIGHT and finish the component. If the completion dialog opens, send or skip the reflection and choose "continue". If it opened already finished, say so.`)
    await shot(page, `pass-${component.slice(-5)}-done`)
  }
  await logout(page, phase)
  await context.close()
}

async function phaseAssessment(browser) {
  const phase = 'assessment'
  const { context, page } = await newPage(browser)
  await login(page, STUDENT, phase)
  const visits = [[ASSESS_FAIL, 'WRONG', 'TC-ITM-11 · completed success=false'], [ASSESS_PASS, 'RIGHT', 'TC-ITM-10 · completed success=true']]
  for (const [component, verdict, tc] of visits) {
    await page.goto(`${BASE}/learning/lesson?unit=${encodeURIComponent(unitOf(component))}&component=${encodeURIComponent(component)}`, { waitUntil: 'domcontentloaded' })
    await settle(page, 8000)
    // A component seen before (finished, or left mid-way) opens the §6 re-entry
    // dialog; take "start over" so the attempt is meant as a fresh one. Kata's
    // resetState did not clear the saved content state on 22/09/2026 (same
    // registrationId either way) — the lomda may still resume; noted per run.
    const startOver = page.locator('.learning-reentry button', { hasText: /להתחיל מחדש|להתחיל מהתחלה|start over|redo/i }).first()
    if (await startOver.count()) {
      await startOver.click()
      note(phase, `re-entry dialog → start over (resetState) on ${component}`)
      await settle(page, 8000)
    }
    await shot(page, `assessment-${verdict.toLowerCase()}-open`)
    note(phase, `assessment component ${component} opened (isAssessment=true)`)
    await pause(phase, `In the lomda (שאלת שיא ${component}): answer every question ${verdict} and finish the component. If it opened already FINISHED (Kata kept its state): click "לכל הפעילויות", wait 60s, open it again and choose "start over" in the dialog — repeat until it starts fresh. If the completion dialog opens, close the reflection (send or skip). (${tc})`)
    await shot(page, `assessment-${verdict.toLowerCase()}-done`)
  }
  await logout(page, phase)
  await context.close()
}

async function phaseReflection(browser) {
  const phase = 'reflection'
  const { context, page } = await newPage(browser)
  await login(page, STUDENT, phase)
  // The same calls ReflectionPanel makes, in the same order: start (initialized),
  // one rating + one text (answered), the rest skipped, then complete.
  const launch = await call(page, 'POST', '/api/learning/sessions', { component_id: COMPONENT, unit_id: UNIT, language: 'he', restart: false })
  note(phase, `learning session for ${COMPONENT} → ${launch.status}`, 'api')
  const start = await call(page, 'POST', '/api/agent/reflection/start', { component_id: COMPONENT, session_id: launch.data?.session_id || null, language: 'he' })
  const reflectionId = start.data?.reflection_id
  const questions = start.data?.questions || []
  note(phase, `reflection start → ${start.status} (${questions.length} questions; reflection initialized)`, 'api')
  let answered = 0
  for (const question of questions) {
    await sleep(1500)
    if (answered < 2) {
      const payload = question.kind === 'rating' ? { rating: 4 } : { answer: 'היה לי קשה בהתחלה אבל הבנתי בסוף.' }
      const r = await call(page, 'POST', `/api/agent/reflection/${reflectionId}/answer`, { question_number: question.number, ...payload })
      note(phase, `reflection q${question.number} (${question.kind}) answered → ${r.status}`, 'api')
      answered += 1
    } else {
      const r = await call(page, 'POST', `/api/agent/reflection/${reflectionId}/skip`, { question_number: question.number })
      note(phase, `reflection q${question.number} skipped → ${r.status}`, 'api')
    }
  }
  await sleep(1500)
  const done = await call(page, 'POST', `/api/agent/reflection/${reflectionId}/complete`, {})
  note(phase, `reflection complete → ${done.status}`, 'api')
  await sleep(1500)
  // The completion dialog's "continue" = the platform's practice decision.
  const choice = await call(page, 'POST', '/api/learning/path-choice', { component_id: COMPONENT, choice: 'continue' })
  note(phase, `path choice continue → ${choice.status} (component selected, practice-decision=false)`, 'api')
  await logout(page, phase)
  await context.close()
}

async function phaseExplainer(browser) {
  const phase = 'explainer'
  const { context, page } = await newPage(browser)
  await login(page, STUDENT, phase)
  await page.goto(`${BASE}/learning/lesson?unit=${encodeURIComponent(UNIT)}&component=${encodeURIComponent(COMPONENT)}`, { waitUntil: 'domcontentloaded' })
  await settle(page, 8000)
  const dialogButton = page.locator('.learning-reentry button', { hasText: /להמשיך מאיפה|continue where/i }).first()
  if (await dialogButton.count()) { await dialogButton.click(); note(phase, 're-entry dialog → continue'); await settle(page, 3000) }
  await shot(page, 'explainer-open')
  await pause(phase, `In the lomda (${COMPONENT}): on ONE question give three WRONG answers in a row, slowly (a few seconds each, no correct answer in between), until Yuvi offers "בוא/י נראה אחרת". Stay on that question.`)
  const alt = page.locator('.sp-companion__support-option--alt').first()
  if (await alt.count()) {
    await alt.click()
    note(phase, 'opened the alternative explainer → item selected (selectionType=learning-type, response=presentation)')
    await sleep(5000)
    await shot(page, 'explainer-panel')
    await page.locator('.sp-explainer__close').first().click().catch(() => page.keyboard.press('Escape'))
    await sleep(1500)
  } else note(phase, 'alternative explainer not offered', 'ui')
  await pause(phase, `In the lomda (${COMPONENT}): now finish the component — every remaining screen — so it completes (it unlocks the assessment). If the completion dialog opens, do the reflection (rating + text, skip one, send) and choose "continue".`)
  await shot(page, 'explainer-done')
  await logout(page, phase)
  await context.close()
}

async function phaseTeacher(browser) {
  const phase = 'teacher'
  const { context, page } = await newPage(browser)
  const sid = await login(page, TEACHER, phase)
  manifest.sessions.teacher_session = sid
  const screens = [
    ['/teacher', 'teacher home (learning-group)'],
    ['/teacher/students', 'live students (realtime-dashboard)'],
    ['/teacher/learnings', 'learnings (learning-group)'],
    [`/teacher/student/${STUDENT}`, 'student profile (student-view)'],
  ]
  for (const [route, label] of screens) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await settle(page, 5000)
    await shot(page, `teacher-${route.replace(/[^a-z]+/gi, '-')}`)
    note(phase, `${label} open 5s`)
  }
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await settle(page, 2000)
  note(phase, 'left the last board (viewed filed with duration)')
  await logout(page, phase)                     // TC-SES-08: the teacher's explicit logout
  manifest.sessions.teacher_logout_session = sid
  await context.close()
}

async function phaseMentoring(browser) {
  const phase = 'mentoring'
  const { context, page } = await newPage(browser)
  await login(page, TEACHER, phase)
  await page.goto(`${BASE}/teacher/student/${STUDENT}`, { waitUntil: 'domcontentloaded' })
  await settle(page, 3000)
  const record = await call(page, 'POST', `/api/teacher/students/${STUDENT}/mentoring`, {
    notes: 'שיחת מנטורינג: דיברנו על ההתקדמות במדעים ועל הרגלי הלמידה.',
    mentoring_phase: 'phase3',
    visibility: 'shared',
    language: 'he',
    draft_id: `lrs-run-${Date.now()}`,
    goals: [{ title: 'לתרגל מדידת מסה שלוש פעמים השבוע', next_steps: 'לפתוח את הלומדה מדי יום', deadline: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), action: { kind: 'practice', target: 3 } }],
  })
  note(phase, `teacher wrote up a talk with a goal → ${record.status} (meeting completed + goal initialized with instructor)`, 'api')
  manifest.mentoring = { conversation_id: record.data?.id, goal_id: record.data?.goals?.[0]?.id }
  await shot(page, 'mentoring-teacher')
  await context.close()
}

async function phaseGoals(browser) {
  const phase = 'goals'
  const { context, page } = await newPage(browser)
  await login(page, STUDENT, phase)
  await page.goto(`${BASE}/mentoring`, { waitUntil: 'domcontentloaded' })
  await settle(page, 3000)
  const created = await call(page, 'POST', '/api/mentoring', {
    notes: 'דיברתי עם המורה על מה שקשה לי במדעים.', meeting_stage: 'שמח', visibility: 'shared', author: 'learner',
    goals: [{ title: 'להיכנס ליובי חמישה ימים השבוע', next_steps: 'כל יום אחרי הצהריים', deadline: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), action: { kind: 'active_days', target: 5 } }],
  })
  const conversationId = created.data?.id
  const goalId = created.data?.goals?.[0]?.id
  note(phase, `learner wrote a goal → ${created.status} (goal initialized; no meeting)`, 'api')
  await sleep(1500)
  const edited = await call(page, 'PUT', `/api/mentoring/${conversationId}/goals/${goalId}`, { next_steps: 'כל יום אחרי הצהריים, חצי שעה' })
  note(phase, `edited the goal → ${edited.status} (updated)`, 'api')
  await sleep(1500)
  const started = await call(page, 'POST', `/api/mentoring/${conversationId}/goals/${goalId}/progress`, { progress_stage: 'started' })
  note(phase, `goal started → ${started.status} (updated)`, 'api')
  await sleep(1500)
  const summarized = await call(page, 'POST', `/api/mentoring/${conversationId}/goals/${goalId}/progress`, { progress_stage: 'summarized' })
  note(phase, `goal summarized → ${summarized.status} (completed)`, 'api')
  await shot(page, 'goals-student')
  await logout(page, phase)
  await context.close()

  // The teacher approves the summarized goal (completed with instructor).
  const teacher = await newPage(browser)
  await login(teacher.page, TEACHER, phase)
  const approved = await call(teacher.page, 'POST', `/api/teacher/students/${STUDENT}/goals/${goalId}/approve`, { conversation_id: conversationId, teacher_note: 'כל הכבוד', language: 'he' })
  note(phase, `teacher approved the goal → ${approved.status} (goal completed with instructor)`, 'api')
  if (manifest.mentoring?.goal_id) {
    const startedT = await call(teacher.page, 'POST', `/api/teacher/students/${STUDENT}/goals/${manifest.mentoring.goal_id}/approve`, { conversation_id: manifest.mentoring.conversation_id, language: 'he' })
    note(phase, `teacher approved the assigned goal → ${startedT.status}`, 'api')
  }
  await teacher.context.close()
}

async function phaseRelogin(browser) {
  const phase = 'relogin'
  const first = await newPage(browser)
  const previous = await login(first.page, STUDENT, phase)
  await settle(first.page, 2000)
  const second = await newPage(browser)
  const next = await login(second.page, STUDENT, phase)
  manifest.sessions.relogin_previous_session = previous
  manifest.sessions.relogin_next_session = next
  note(phase, `re-login: ${previous} exited, ${next} entered`)
  await first.context.close()
  await sleep(2000)
  await logout(second.page, phase)
  await second.context.close()
}

async function phaseTabClose(browser) {
  const phase = 'tabclose'
  const { context, page } = await newPage(browser)
  const sid = await login(page, STUDENT, phase)
  manifest.sessions.tab_closed_session = sid
  await settle(page, 3000)
  // Close the TAB the way a child does: pagehide fires and the suspend
  // beacon leaves; the browser (context) stays alive long enough to send it.
  await page.close({ runBeforeUnload: true })
  await sleep(3000)
  await context.close()
  note(phase, `tab closed on ${sid}; waiting ${IDLE_MINUTES + 1.5} min for the idle exit`)
  await sleep((IDLE_MINUTES + 1.5) * 60_000)
}

async function phaseKill(browser) {
  const phase = 'kill'
  // A browser server is the one Playwright object that exposes its OS process.
  const server = await chromium.launchServer({ headless: !HEADED })
  const separate = await chromium.connect(server.wsEndpoint())
  const { page } = await newPage(separate)
  const sid = await login(page, STUDENT, phase)
  manifest.sessions.killed_session = sid
  await settle(page, 3000)
  const pid = server.process().pid
  // No beacon, no unload — the browser is simply gone. The whole process
  // group: a surviving renderer or network service would keep pinging.
  try { process.kill(-pid, 'SIGKILL') } catch { process.kill(pid, 'SIGKILL') }
  note(phase, `browser killed on ${sid}; waiting ${IDLE_MINUTES + 1.5} min for the idle exit`)
  await sleep((IDLE_MINUTES + 1.5) * 60_000)
  await separate.close().catch(() => undefined)
  await server.close().catch(() => undefined)
}

/* ── Main ────────────────────────────────────────────────────────────────── */
const PHASE_FN = {
  session: phaseSession, onboarding: phaseOnboarding, dashboard: phaseDashboard, lesson: phaseLesson,
  assessment: phaseAssessment, pass: phasePass, reflection: phaseReflection, explainer: phaseExplainer, teacher: phaseTeacher, mentoring: phaseMentoring, goals: phaseGoals, relogin: phaseRelogin,
  tabclose: phaseTabClose, kill: phaseKill,
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const existing = await readFile(path.join(OUT, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null)
  if (existing) Object.assign(manifest, { ...existing, phases: { ...existing.phases }, sessions: { ...existing.sessions } })
  const priorRun = await readFile(path.join(OUT, 'run.json'), 'utf8').then(JSON.parse).catch(() => null)
  if (priorRun?.started_at) run.started_at = priorRun.started_at
  await writeFile(path.join(OUT, 'run.json'), JSON.stringify(run, null, 2))
  log(`base ${BASE} · api ${API} · out ${OUT} · phases ${PHASES.join(', ')}`)
  const browser = await chromium.launch({ headless: !HEADED })
  try {
    for (const name of PHASES) {
      const fn = PHASE_FN[name]
      if (!fn) { log(`unknown phase ${name}`); continue }
      log(`▶ ${name}`)
      try {
        await fn(browser)
      } catch (error) {
        note(name, `FAILED: ${error.message}`, 'ui')
        log(`  ✗ ${error.message}`)
      }
      manifest.started_at = run.started_at
      manifest.finished_at = new Date().toISOString()
      await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
    }
  } finally {
    await browser.close().catch(() => undefined)
    rl.close()
  }
  run.finished_at = new Date().toISOString()
  await writeFile(path.join(OUT, 'run.json'), JSON.stringify(run, null, 2))
  log(`done · read back with: cd backend && ./.venv/bin/python scripts/lrs_ledger.py --since ${run.started_at} --json ${path.join(OUT, 'ledger.json')} --validate`)
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1) })
