/* Teacher-authored tasks, end to end, through the real UI.
 *
 *   cd frontend && node scripts/tasks-check.mjs [--port 5173] [--headed]
 *
 * The whole loop the plan asks for: build a task → Yuvi generates it → send it
 * → solve it as the student → the teacher sees the score, the per-question
 * breakdown, and **the exact feedback the student saw**.
 *
 * This calls a real model, so it takes a minute or two. That is the point:
 * every unit test in this feature stubs the provider, and the one thing they
 * cannot tell you is whether the generated payload survives normalization and
 * renders. This does.
 *
 * `gal` is both a teacher and a learner on this box, which is what makes a
 * single-session round trip possible.
 *
 * ⚠️ **Run this against a demo class only.** Sending a task is a real send: it
 * writes an activation and rings a real notification for every learner in the
 * group. The cleanup below closes the task, which stops it accepting work, but
 * there is no delete endpoint — closing is the product's own model, because a
 * closed task is still the evidence behind every grade it produced. Purging the
 * rows afterwards means going to the database directly.
 */

import { chromium } from 'playwright'

const args = process.argv.slice(2)
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '5173'
const base = `http://localhost:${port}`

const fail = []
const ok = (label) => console.log(`  ✔ ${label}`)
const bad = (label) => { fail.push(label); console.log(`  ✖ ${label}`) }

const TITLE = `בדיקה ${process.pid}`
/** Every task this run creates, so cleanup cannot miss one. */
const created = []

const browser = await chromium.launch({ headless: !args.includes('--headed') })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage()

const api = (path, init) => page.evaluate(
  async ([url, options]) => {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...(options ?? {}),
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  },
  [path, init],
)

/** Poll rather than sleep: generation is several model calls and its duration
 *  is not something a fixed wait can be right about. */
async function until(label, check, { timeout = 180_000, every = 3000 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return true
    await page.waitForTimeout(every)
  }
  bad(`${label} (timed out after ${Math.round(timeout / 1000)}s)`)
  return false
}

await page.goto(`${base}/`, { waitUntil: 'load' })
await page.evaluate(async () => {
  await fetch('/api/auth/login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gal', password: 'Aa12345' }),
  })
})

let taskId = null
/** What the launch dialog promised, checked against what the send did. */
let promisedReach = 0

try {
  // ── the teacher builds one ────────────────────────────────────────────────
  console.log('\n— building a task —')
  await page.goto(`${base}/teacher/tasks`, { waitUntil: 'load' })
  await page.waitForSelector('.tch-tasks', { timeout: 30_000 })
  ok('the tasks screen renders')

  await page.click('button:has-text("משימה חדשה")')
  // A centred dialog now, not a panel expanding inside the page.
  await page.waitForSelector('.tch-builder__modal .tch-builder', { timeout: 10_000 })
  ok('the builder opens as a centred dialog')

  /* Three sections, not one column of a dozen controls. The dots say where you
     are and walk back to anything already answered. */
  const dots = await page.locator('.tch-builder__dot').count()
  if (dots === 3) ok('the dialog is three sections with dots')
  else bad(`the dialog is three sections with dots (found ${dots})`)

  // The one sentence the teacher has to read: what they type IS the brief.
  const note = (await page.locator('.tch-builder__note').textContent().catch(() => ''))?.trim() ?? ''
  if (note.length > 40) ok('the first section explains why the description matters')
  else bad('the first section explains why the description matters')

  /* A section will not let you past it while it is unanswered, and it says
     which field is missing rather than leaving a grey button to be guessed at. */
  const nextButton = page.locator('.tch-builder__next')
  const needs = (await page.locator('.tch-builder__needs').textContent().catch(() => '')) ?? ''
  if (await nextButton.isDisabled() && needs.includes('שם המשימה')) {
    ok('continue is blocked, and names what is missing')
  } else {
    bad(`continue is blocked and names what is missing (got "${needs.slice(0, 60)}")`)
  }

  await page.fill('.tch-builder__field:has-text("שם המשימה") input', TITLE)

  /* The draft, and the reason the dialog can stop closing on a stray click:
     both exits are safe because neither loses the form. */
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.tch-tasks', { timeout: 30_000 })
  await page.click('button:has-text("משימה חדשה")')
  await page.waitForSelector('.tch-builder__restored', { timeout: 10_000 })
  const restoredTitle = await page.inputValue('.tch-builder__field:has-text("שם המשימה") input')
  if (restoredTitle === TITLE) ok('an abandoned draft comes back on reopening')
  else bad(`an abandoned draft comes back (got "${restoredTitle}")`)

  // A click on the backdrop used to throw the whole form away.
  await page.mouse.click(20, 20)
  await page.waitForTimeout(300)
  if (await page.locator('.tch-builder__modal').count()) ok('a click outside does not close the dialog')
  else bad('a click outside does not close the dialog')

  /* Subject is required, and it comes from the subjects the catalogue really
     has material for — it can never offer one with nothing behind it. */
  const subjectSelect = page.locator('.tch-builder__field:has-text("מקצוע") select')
  // Waited for, not sampled: the dialog was just reopened, so its catalogue
  // fetch is in flight and the select holds nothing but its placeholder for a
  // few hundred milliseconds. Counting at that instant is a coin toss.
  await page.waitForFunction(() => {
    const select = [...document.querySelectorAll('.tch-builder__field select')]
      .find((node) => (node.parentElement?.textContent ?? '').includes('מקצוע'))
    return (select?.options.length ?? 0) > 1
  }, null, { timeout: 15_000 }).catch(() => {})
  const subjectCount = await subjectSelect.locator('option').count()
  if (subjectCount > 1) ok(`the subject field offers ${subjectCount - 1} real subject(s)`)
  else bad('the subject field offers real subjects')
  await subjectSelect.selectOption(
    await subjectSelect.locator('option').nth(1).getAttribute('value'))

  /* Grounding: find a real lesson by typing, so the generator is told what
     this class actually studied rather than a topic string. */
  const lessonBox = page.locator('.tch-builder__field:has-text("שיעור מהקטלוג") input')
  await lessonBox.click()
  const options = page.locator('.tch-picker__row')
  await page.waitForSelector('.tch-picker__row', { timeout: 10_000 })
  const lessonLabel = (await options.first().locator('span').textContent())?.trim() ?? ''
  // The catalogue i18n fix, seen from the outside: a name, never the id.
  if (lessonLabel && !/^CET\.|^methodica-/.test(lessonLabel)) {
    ok(`the picker shows a name, not an id ("${lessonLabel.slice(0, 40)}")`)
  } else {
    bad(`the picker shows a name, not an id (got "${lessonLabel.slice(0, 60)}")`)
  }
  // And typing narrows it, which is the whole reason it stopped being a list.
  const allLessons = await options.count()
  await lessonBox.fill(lessonLabel.slice(-6))
  await page.waitForTimeout(150)
  const matching = await options.count()
  if (matching > 0 && matching < allLessons) {
    ok(`typing narrows the picker (${allLessons} → ${matching})`)
  } else {
    bad(`typing narrows the picker (${allLessons} → ${matching})`)
  }
  await options.first().click()
  const picked = (await page.locator('.tch-picker__picked').textContent()) ?? ''
  if (/\d/.test(picked)) ok(`the picked lesson reports its material (${picked.trim().slice(0, 50)})`)
  else bad('the picked lesson reports its material')

  await page.fill('.tch-builder__field:has-text("הנושא") input', 'חיבור וחיסור שברים פשוטים')

  // ── section two: what is in it ────────────────────────────────────────────
  if (!(await nextButton.isDisabled())) ok('continue unlocks once the section is answered')
  else bad('continue unlocks once the section is answered')
  await nextButton.click()
  await page.waitForSelector('.tch-builder__parts', { timeout: 10_000 })

  /* Three part types, not four. "פעילות" is gone: its scored blocks were
     practice questions with a widget name on them, so a teacher was choosing
     between two words for the same thing. The tooltip must explain all three —
     and must say what makes a מבחן different, which is the question the fourth
     chip's removal raises. */
  await page.click('.tch-builder__partsTip .sp-tip__trigger')
  await page.waitForSelector('.tch-builder__partsHelp', { timeout: 5000 })
  const explained = (await page.locator('.tch-builder__partsHelp').textContent()) ?? ''
  const partChips = await page.locator('.tch-builder__parts .tch-chip').count()
  if (partChips === 3 && ['מצגת', 'תרגול', 'מבחן'].every((word) => explained.includes(word))
      && /רמז/.test(explained)) {
    ok('three part types, and the tooltip says what makes a test a test')
  } else {
    bad(`three part types explained (chips ${partChips}, got "${explained.slice(0, 90)}")`)
  }
  await page.keyboard.press('Escape')

  // Practice only, and small: this is a contract check, not a load test.
  const chips = page.locator('.tch-builder__parts .tch-chip')
  for (const label of ['מצגת', 'מבחן', 'פעילות']) {
    const chip = chips.filter({ hasText: label })
    if (await chip.count() && await chip.first().getAttribute('aria-pressed') === 'true') {
      await chip.first().click()
    }
  }
  const practice = chips.filter({ hasText: 'תרגול' }).first()
  if (await practice.getAttribute('aria-pressed') !== 'true') await practice.click()
  await page.fill('.tch-builder__count input', '3')

  // ── section three: the brief ──────────────────────────────────────────────
  await page.click('.tch-builder__next')
  await page.waitForSelector('.tch-builder__summary', { timeout: 10_000 })
  const summary = (await page.locator('.tch-builder__summary').textContent()) ?? ''
  if (summary.includes(TITLE) && summary.includes('תרגול')) {
    ok('the last section says what is about to be built')
  } else {
    bad(`the last section says what is about to be built (got "${summary.slice(0, 80)}")`)
  }

  /* The suggestion can no longer be blocked here: the sections ahead of it will
     not let a teacher arrive with the fields it needs unfilled. That gating
     moved rather than disappearing — the check for it is on section one. */
  const suggest = page.locator('.tch-builder__suggest button')
  if (await suggest.getAttribute('aria-disabled') !== 'true') {
    ok('the AI suggestion is available by the time the notes field is on screen')
  } else {
    bad('the AI suggestion is available by the time the notes field is on screen')
  }

  const before = await api('/api/teacher/tasks')
  const knownIds = new Set((before.body?.tasks ?? []).map((task) => task.id))

  await page.click('.tch-builder__actions .sp-btn:not(.sp-btn--ghost)')
  await page.waitForSelector('.tch-builder__modal', { state: 'detached', timeout: 20_000 })
  ok('the task is created and generation starts')

  // Straight into review, not back to the list: what happens next is reading
  // what Yuvi wrote.
  await page.waitForSelector('.tch-review', { timeout: 15_000 })
  if (/\/teacher\/tasks\/[^/]+\/review$/.test(page.url())) ok('the builder lands on the review screen')
  else bad(`the builder lands on the review screen (at ${page.url()})`)

  const listed = await api('/api/teacher/tasks')
  const mine = (listed.body?.tasks ?? []).find((task) => !knownIds.has(task.id))
  if (!mine) throw new Error('the new task never appeared in the list')
  taskId = mine.id
  created.push(taskId)
  ok(`created ${taskId}`)

  // ── Yuvi generates it ─────────────────────────────────────────────────────
  console.log('\n— generation —')
  const ready = await until('generation finishes', async () => {
    const state = await api(`/api/teacher/tasks/${taskId}`)
    return state.body?.status === 'ready'
  })
  if (!ready) throw new Error('generation never finished')
  ok('the task reaches ready')

  const content = (await api(`/api/teacher/tasks/${taskId}`)).body?.content ?? {}
  const questions = content.practice?.questions ?? []
  if (questions.length) ok(`${questions.length} questions generated`)
  else bad('questions were generated')

  /* The normalizer's whole job, checked against a real payload: every question
     is answerable. A null answer index renders four options of which none is
     correct, and the child is marked wrong whatever they press. */
  const unanswerable = questions.filter((question) => {
    const answer = question.answer ?? {}
    if (question.type === 'mcq' || question.type === 'image_mcq') {
      return !Number.isInteger(answer.index)
        || !Array.isArray(question.options)
        || answer.index >= question.options.length
    }
    if (question.type === 'true_false') return typeof answer.value !== 'boolean'
    if (question.type === 'multiple_correct') return !(answer.indices ?? []).length
    if (question.type === 'ordering') return !(answer.order ?? []).length
    if (question.type === 'matching') return !(answer.pairs ?? []).length
    if (question.type === 'fill_blank') return !(answer.blanks ?? []).length
    return !(answer.rubric ?? []).length
  })
  if (!unanswerable.length) ok('every generated question is answerable')
  else bad(`${unanswerable.length} generated questions nobody could get right`)

  /* The Hebrew+math contract against real output: no LaTeX survived, and no
     segment glued words to a formula in one string. */
  const blob = JSON.stringify(questions)
  if (!/\\frac|\\sqrt|\$\$|\\text\{/.test(blob)) ok('no LaTeX survived the sanitizer')
  else bad('LaTeX reached the content')

  const everySegmented = questions.every((question) => Array.isArray(question.prompt))
  if (everySegmented) ok('every prompt is a segment array')
  else bad('a prompt arrived as a bare string')

  // ── review it, then send ──────────────────────────────────────────────────
  console.log('\n— the human in the loop —')
  await page.goto(`${base}/teacher/tasks`, { waitUntil: 'load' })
  await page.waitForSelector('.tch-tasks__list', { timeout: 30_000 })
  const row = page.locator('.tch-task').filter({ hasText: TITLE }).first()
  // The list's action on a ready task is review, not send — the one chance to
  // catch a wrong question is before thirty children have it.
  const reviewBtn = row.locator('button:has-text("תצוגה מקדימה")')
  if (await reviewBtn.count()) ok('a ready task offers review, not send')
  else bad('a ready task offers review, not send')
  await reviewBtn.click()
  await page.waitForSelector('.tch-review', { timeout: 30_000 })

  // The preview is the real player, in read-only.
  await page.waitForSelector('.tch-review__stage .yv-player', { timeout: 20_000 })
  ok('the preview renders through the student player')
  if (!await page.locator('.tch-review__stage .sp-btn--gradient').count()) {
    ok('the preview offers no submit button')
  } else {
    bad('the preview offers no submit button')
  }

  // The answer key is the teacher's material, and it is behind a toggle so the
  // preview stays a preview.
  if (!await page.locator('.tch-review__key').count()) ok('the answer key is hidden by default')
  else bad('the answer key is hidden by default')
  await page.click('.tch-review__switch input')
  await page.waitForSelector('.tch-review__key', { timeout: 5000 })
  const keyRows = await page.locator('.tch-review__key li').count()
  if (keyRows) ok(`${keyRows} answers listed for the teacher`)
  else bad('the answer key lists the answers')

  /* The rewriting controls are behind one button now — the review screen used
     to open with five stacked bands before the content they were about. They
     have to still be REACHABLE, which is what the click below checks. */
  if (await page.locator('.tch-review__part').count() === 0) {
    ok('the rewriting controls stay out of the way until asked for')
  } else {
    bad('the rewriting controls stay out of the way until asked for')
  }
  await page.click('.tch-review__toolbar button:has-text("עריכת התוכן")')
  await page.waitForSelector('.tch-review__part', { timeout: 5000 })

  // Every editable part is offered both ways of changing it.
  const parts = await page.locator('.tch-review__part').count()
  const regenerates = await page.locator('.tch-review__part button:has-text("בנייה מחדש")').count()
  const aiEdits = await page.locator('.tch-review__part button:has-text("עריכה עם יובי")').count()
  if (parts && regenerates === parts && aiEdits === parts) {
    ok(`${parts} part(s), each with regenerate and AI edit`)
  } else {
    bad(`each part offers both edits (parts ${parts}, regen ${regenerates}, ai ${aiEdits})`)
  }

  /* The teacher sitting their own task. Answering must work and nothing must
     be written — that is the whole promise of the mode. */
  await page.click('.tch-review__modes button:has-text("לפתור")')
  await page.waitForSelector('.yv-q', { timeout: 10_000 })
  const demoOption = page.locator('.tch-review__stage .yv-opt').first()
  if (await demoOption.count()) {
    await demoOption.click()
    await page.click('.yv-player__demo button')
    const marked = await page.locator('.tch-review__stage .yv-q.is-correct, '
      + '.tch-review__stage .yv-q.is-wrong').count()
    if (marked) ok(`the demo marks the teacher's answers (${marked} marked)`)
    else bad("the demo marks the teacher's answers")
  } else {
    bad('the demo renders answerable questions')
  }
  // Nothing may have reached the child's lane.
  const afterDemo = await api(`/api/teacher/tasks/${taskId}/launches`)
  if ((afterDemo.body?.launches ?? []).length === 0) ok('the demo wrote nothing')
  else bad('the demo wrote nothing')
  await page.click('.tch-review__modes button:has-text("צפייה")')

  console.log('\n— sending —')
  // The send button lives in the one header band now, not in a card of its own.
  await page.click('.tch-review__nav .sp-btn:not(.sp-btn--ghost)')
  await page.waitForSelector('.tch-launch', { timeout: 10_000 })
  ok('sending opens a dialog that asks who')
  /* Wait for the real number rather than reading the placeholder — and check
     it against what the send ACTUALLY assigns further down. A promise of 18
     recipients for a send that reaches 6 is worse than no promise. */
  // The send button is disabled until the class roster has actually landed,
  // which is a state, not a string — waiting on the text matched the "counting…"
  // placeholder and read a number that was never on screen.
  await page.waitForSelector(
    '.tch-launch__modal .tch-builder__actions .sp-btn:not(.sp-btn--ghost):not([disabled])',
    { timeout: 15_000 })
  const reach = (await page.locator('.tch-launch__count').textContent()) ?? ''
  promisedReach = Number((reach.match(/\d+/) ?? ['1'])[0])
  ok(`it says how many it will reach ("${reach.trim()}")`)
  await page.click('.tch-builder__actions .sp-btn:not(.sp-btn--ghost)')
  const sent = await until('the task goes live', async () => {
    const state = await api(`/api/teacher/tasks/${taskId}`)
    return state.body?.status === 'live'
  }, { timeout: 30_000, every: 1000 })
  if (sent) ok('the task is live')

  // And now editing is closed — the server refuses it, so the screen must not
  // still be offering it.
  await page.waitForSelector('.tch-review__sent', { timeout: 15_000 })
  if (!await page.locator('.tch-review__part').count()) ok('a sent task offers no more edits')
  else bad('a sent task offers no more edits')

  const opened = await api(`/api/teacher/tasks/${taskId}/launches`)
  const firstLaunch = (opened.body?.launches ?? [])[0]
  if (firstLaunch?.seq === 1) ok('the send created opening 1')
  else bad('the send created opening 1')

  const assigned = (await api(`/api/teacher/tasks/${taskId}/tracking`)).body
  if (assigned.learners.length === promisedReach) {
    ok(`${assigned.learners.length} learners were given it, exactly as promised`)
  } else {
    bad(`the dialog promised ${promisedReach} and the send reached ${assigned.learners.length}`)
  }

  // ── the student solves it ─────────────────────────────────────────────────
  console.log('\n— solving it as the student —')
  await page.goto(`${base}/tasks`, { waitUntil: 'load' })
  await page.waitForSelector('.st-list', { timeout: 30_000 })
  const listedForMe = await page.locator('.st-row').filter({ hasText: TITLE }).count()
  if (listedForMe) ok('it appears in the learner list')
  else bad('it appears in the learner list')

  /* By the OPENING, not by the task — a child may hold the same task twice
     and a task id cannot say which paper is meant. */
  const myRow = ((await api('/api/tasks')).body?.tasks ?? [])
    .find((row) => row.task_id === taskId)
  const launchId = myRow?.launch_id
  if (launchId) ok(`the learner's row carries its opening (${launchId})`)
  else bad("the learner's row carries its opening")

  await page.goto(`${base}/tasks/${encodeURIComponent(launchId)}`, { waitUntil: 'load' })
  await page.waitForSelector('.yv-q', { timeout: 30_000 })
  ok('the player renders the questions')

  /* The key must not have travelled. This is the assertion that the learner
     projection is doing its job — a leaked answer is invisible on screen and
     one devtools tab away from being the whole task. */
  const leaked = await api(`/api/tasks/${encodeURIComponent(launchId)}`)
  const learnerBlob = JSON.stringify(leaked.body?.content ?? {})
  if (!/"answer"|"rubric"|"correct_index"/.test(learnerBlob)) {
    ok('no answer key reaches the learner')
  } else {
    bad('the answer key was sent to the learner')
  }

  // Answer everything answerable, however it renders.
  const cards = page.locator('.yv-q')
  const count = await cards.count()
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index)
    const option = card.locator('.yv-opt').first()
    if (await option.count()) { await option.click(); continue }
    const blank = card.locator('.yv-blank').first()
    if (await blank.count()) { await blank.fill('2'); continue }
    const open = card.locator('.yv-open').first()
    if (await open.count()) await open.fill('צריך למצוא מכנה משותף ואז לחבר את המונים')
  }
  ok(`answered ${count} questions`)

  await page.click('.yv-player__foot .sp-btn--gradient')
  await page.waitForSelector('.yv-player__confirm', { timeout: 10_000 })
  await page.click('.yv-player__confirmBtns .sp-btn:not(.sp-btn--ghost)')
  await page.waitForSelector('.st-done', { timeout: 60_000 })
  ok('submitting produces a completion panel')

  const said = (await page.locator('.st-done__said').textContent())?.trim() ?? ''
  if (said) ok(`the child is told: "${said.slice(0, 60)}…"`)
  else bad('the child is told something')

  /* 5.6, asserted rather than assumed: verbal plus sparks, never a number. */
  const donePanel = (await page.locator('.st-done').textContent()) ?? ''
  const sparksText = (await page.locator('.st-done__sparks').textContent()) ?? ''
  const numbersOutsideSparks = donePanel.replace(sparksText, '').match(/\d+/g) ?? []
  if (!numbersOutsideSparks.length) ok('no score is shown to the child')
  else bad(`a number leaked into the child's panel: ${numbersOutsideSparks.join(', ')}`)

  // ── the teacher reads the result ──────────────────────────────────────────
  console.log('\n— what the teacher sees —')
  await page.goto(`${base}/teacher/tasks/${taskId}`, { waitUntil: 'load' })
  /* `:not([aria-busy])` matters: the page frame now wraps the loading
     skeletons too, so waiting on `.tch-track` alone returns while the tracking
     data is still in flight — and every count read straight after is zero. */
  await page.waitForSelector('.tch-track:not([aria-busy="true"])', { timeout: 30_000 })
  ok('the tracking screen renders')

  const stats = await page.locator('.tch-stat__value').allTextContents()
  ok(`stats: ${stats.join(' · ')}`)

  const perQuestion = await page.locator('.tch-track__q').count()
  if (perQuestion) ok(`${perQuestion} questions broken down`)
  else bad('the per-question breakdown renders')

  // Open the first question's buckets and check they name a child.
  await page.locator('.tch-track__qHead').first().click()
  await page.waitForSelector('.tch-track__qBuckets', { timeout: 5000 })
  const named = await page.locator('.tch-track__bucket button').count()
  if (named) ok('a bucket names the children in it, not just a count')
  else bad('a bucket names the children in it')

  /* The paper, and the sentence the child read.
   *
   * Explicitly the learner who submitted, not the first row: the list is
   * alphabetical and most of a class has not handed in yet, so `.first()`
   * opens an empty paper and the feedback assertion fails for a reason that
   * has nothing to do with feedback. */
  const withScore = page.locator('.tch-track__learner')
    .filter({ has: page.locator('.tch-track__score:not(:text("—"))') })
  if (await withScore.count()) ok(`${await withScore.count()} learner(s) have a mark`)
  else bad('at least one learner has a mark')
  await withScore.first().click()
  await page.waitForSelector('.tch-paper__panel', { timeout: 10_000 })
  ok("one child's paper opens")

  const teacherSaw = (await page.locator('.tch-paper__said').textContent().catch(() => ''))?.trim()
  if (teacherSaw && said && teacherSaw.includes(said.slice(0, 20))) {
    ok('the teacher sees the exact feedback the student saw')
  } else {
    bad(`the teacher sees the student's feedback (child read "${said.slice(0, 30)}", `
      + `teacher sees "${(teacherSaw ?? '').slice(0, 30)}")`)
  }

  const marks = await page.locator('.tch-paper__mark').count()
  if (marks) ok(`${marks} per-question marks shown to the teacher`)
  else bad('per-question marks are shown to the teacher')

  /* ── the retake ───────────────────────────────────────────────────────────
     The whole point of the re-key: open it a second time and the same child
     gets a second BLANK paper, while the first keeps its answers and its
     mark. Keyed by task, the second sitting would have written over the
     first — a score changing with no record of what it was. */
  console.log('\n— opening it again —')
  const firstMark = (await api(`/api/teacher/tasks/${taskId}/tracking`))
    .body?.learners?.find((row) => row.learner_id === 'gal')?.score ?? null

  await page.goto(`${base}/teacher/tasks/${taskId}/review`, { waitUntil: 'load' })
  /* Wait for the openings to LAND, not for the bar to paint. The bar renders
     immediately with the default subtitle and fills in when `listTaskLaunches`
     resolves, so reading it straight after the selector appeared was reading
     the placeholder — the same way of passing (or failing) for the wrong reason
     that the launch dialog's count already taught this file once. The send
     button's label only says "another opening" once there is one. */
  await page.waitForSelector(
    '.tch-review__nav .sp-btn:not(.sp-btn--ghost):has-text("פתיחה נוספת")',
    { timeout: 20_000 })
  // And the header states how many there already are.
  const again = (await page.locator('.tch-review__sub').textContent()) ?? ''
  if (/1/.test(again)) ok('the review screen offers opening 2')
  else bad(`the review screen offers opening 2 (got "${again.trim()}")`)
  await page.click('.tch-review__nav .sp-btn:not(.sp-btn--ghost)')
  await page.waitForSelector('.tch-launch', { timeout: 10_000 })
  // The dialog warns that everyone gets a fresh blank copy.
  const warned = (await page.locator('.tch-builder__note').textContent().catch(() => '')) ?? ''
  if (warned.trim().length > 20) ok('it says a second opening means fresh papers')
  else bad('it says a second opening means fresh papers')
  await page.click('.tch-builder__actions .sp-btn:not(.sp-btn--ghost)')

  const twice = await until('a second opening exists', async () => {
    const state = await api(`/api/teacher/tasks/${taskId}/launches`)
    return (state.body?.launches ?? []).length === 2
  }, { timeout: 30_000, every: 1000 })

  if (twice) {
    const launches = (await api(`/api/teacher/tasks/${taskId}/launches`)).body.launches
    const [one, two] = launches
    // The first opening keeps its result…
    const oldMark = (await api(
      `/api/teacher/tasks/${taskId}/tracking?launch_id=${encodeURIComponent(one.id)}`))
      .body?.learners?.find((row) => row.learner_id === 'gal')?.score ?? null
    if (oldMark === firstMark && firstMark !== null) {
      ok(`opening 1 keeps its mark (${oldMark}%)`)
    } else {
      bad(`opening 1 keeps its mark (was ${firstMark}, now ${oldMark})`)
    }
    // …and the second is a blank paper for the same child.
    const fresh = await api(`/api/tasks/${encodeURIComponent(two.id)}`)
    if (fresh.status === 200 && Object.keys(fresh.body?.answers ?? {}).length === 0) {
      ok('opening 2 is a blank paper for the same learner')
    } else {
      bad(`opening 2 is a blank paper (status ${fresh.status})`)
    }
    // The learner's list shows both sittings, not one.
    const mine = await api('/api/tasks')
    const rows = (mine.body?.tasks ?? []).filter((row) => row.task_id === taskId)
    if (rows.length === 2) ok('the student sees both sittings')
    else bad(`the student sees both sittings (saw ${rows.length})`)

    // Close one opening, reopen it — the answer to "she was away that day".
    await api(`/api/teacher/tasks/${taskId}/close`,
              { method: 'POST', body: JSON.stringify({ launch_id: two.id }) })
    const refused = await api(`/api/tasks/${encodeURIComponent(two.id)}/answers`,
                              { method: 'POST', body: JSON.stringify({ answers: {} }) })
    if (refused.status === 409) ok('a closed opening refuses work')
    else bad(`a closed opening refuses work (got ${refused.status})`)
    await api(`/api/teacher/tasks/${taskId}/reopen`,
              { method: 'POST', body: JSON.stringify({ launch_id: two.id }) })
    const accepted = await api(`/api/tasks/${encodeURIComponent(two.id)}/answers`,
                               { method: 'POST', body: JSON.stringify({ answers: {} }) })
    if (accepted.status === 200) ok('a reopened opening accepts work again')
    else bad(`a reopened opening accepts work again (got ${accepted.status})`)

    // And the tracking screen can switch between them.
    await page.goto(`${base}/teacher/tasks/${taskId}`, { waitUntil: 'load' })
    await page.waitForSelector('.tch-track:not([aria-busy="true"])', { timeout: 30_000 })
    const switcher = await page.locator('.tch-track__openings .tch-chip').count()
    if (switcher === 2) ok('the tracking screen switches between both openings')
    else bad(`the tracking screen switches between openings (found ${switcher})`)
  }

  await page.screenshot({ path: 'scripts/.tasks-check.png', fullPage: true })
} catch (error) {
  bad(`run threw: ${error.message}`)
} finally {
  // ── cleanup, even on failure ──────────────────────────────────────────────
  console.log('\n— cleanup —')
  for (const id of created) {
    const closed = await api(`/api/teacher/tasks/${id}/close`, { method: 'POST', body: '{}' })
      .catch(() => null)
    console.log(`  · closed ${id}: ${closed?.status ?? 'failed'}`)
  }
  await browser.close()
}

console.log(fail.length ? `\n❌ ${fail.length} check(s) failed` : '\n✅ all checks passed')
process.exit(fail.length ? 1 : 0)
