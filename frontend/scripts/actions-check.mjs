/* The productive chat, and the authored hero.
 *
 *   cd frontend && node scripts/actions-check.mjs [--port 5173] [--headed]
 *
 * Proves the two things screenshots cannot: that an answer offers real buttons
 * which do something, and that the deterministic half of the hero renders
 * without waiting on a model.
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

await page.goto(`${base}/`, { waitUntil: 'load' })
await page.waitForTimeout(1500)
await page.evaluate(async () => {
  await fetch('/api/auth/login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gal', password: 'Aa12345' }),
  })
})

/** Ask, and wait for the answer to finish (the trace is the terminal marker). */
async function ask(question, timeout = 150_000) {
  await page.fill('.tch-dock__composer input', question)
  await page.waitForSelector('.tch-dock__send:not([disabled])', { timeout: 30_000 })
  await page.click('.tch-dock__send')
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const bubble = page.locator('.tch-dock__row--assistant .tch-dock__bubble').last()
    const thinking = await page.locator('.tch-dock .sp-thinking').count()
    if (!thinking && await bubble.locator('.tch-trace').count()) return true
    await page.waitForTimeout(250)
  }
  return false
}

// ── the hero, without waiting on a model ────────────────────────────────────
console.log('\n— the hero —')
await page.goto(`${base}/teacher`, { waitUntil: 'load' })

// The greeting is deterministic, so it must be on screen before the brief
// resolves. This is the property the whole "only infer what needs inferring"
// split buys, and the only way to catch it drifting back into the prompt.
await page.waitForSelector('.tch-brief', { timeout: 30_000 })
const earlyGreeting = await page.locator('.tch-brief__greeting').innerText().catch(() => '')
if (earlyGreeting.trim()) ok(`greeting renders before the brief: "${earlyGreeting.trim()}"`)
else bad('the greeting renders before the brief resolves')

await page.waitForSelector('.tch-brief:not(.is-loading)', { timeout: 120_000 })

// The class picker and the date line belong ABOVE the hero.
const order = await page.evaluate(() => {
  const head = document.querySelector('.tch-home__head')
  const hero = document.querySelector('.tch-brief:not(.is-loading)')
  if (!head || !hero) return 'missing'
  return (head.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING)
    ? 'head-first' : 'hero-first'
})
if (order === 'head-first') ok('the class picker and date sit above the hero')
else bad(`the class picker sits above the hero (got ${order})`)

const summary = await page.locator('.tch-brief__summary').innerText().catch(() => '')
if (summary.trim()) ok(`summary paragraph: "${summary.trim().slice(0, 60)}…"`)
else console.log('  · no summary (fallback brief — no provider or nothing grounded)')

// "למה?" must open prose, never `active in window: 10`.
const why = page.locator('.tch-brief__bullets .tch-evidence__toggle').first()
if (await why.count()) {
  await why.click()
  await page.waitForTimeout(400)
  const text = await page.locator('.tch-brief__why, .tch-evidence__sentence').first()
    .innerText().catch(() => '')
  if (!text.trim()) bad('the evidence disclosure shows something')
  else if (/[a-z]{2,}_[a-z]{2,}/.test(text)) bad(`"למה?" leaks an identifier: ${text.slice(0, 60)}`)
  else if (/^[\x00-\x7F]+$/.test(text.trim())) bad(`"למה?" is not in the teacher's language: ${text.slice(0, 60)}`)
  else ok(`"למה?" opens prose: "${text.trim().slice(0, 60)}…"`)
} else {
  console.log('  · no bullets to open')
}

/* The faces under a bullet must add up.
 *
 * The row shows four avatars and "+N more", both derived from the ids the
 * payload carries — so a server-side cap on that list rendered "+4" under a
 * sentence that said twelve, and a teacher read a smaller class than they
 * have. The invariant is arithmetic, so it is checked as arithmetic. */
{
  const groupId = await page.evaluate(() => {
    const select = document.querySelector('.tch-home__classPick select')
    return select ? select.value : null
  })
  const brief = await page.evaluate(async (id) => {
    const url = id ? `/api/teacher/brief?group_id=${encodeURIComponent(id)}&language=he`
                   : null
    if (!url) return null
    return (await fetch(url, { credentials: 'include' })).json()
  }, groupId)

  if (!brief?.bullets?.length) {
    console.log('  · no bullets to count faces under')
  } else {
    const rows = await page.locator('.tch-brief__bullet').all()
    let checked = 0
    for (let index = 0; index < rows.length && index < brief.bullets.length; index += 1) {
      const total = (brief.bullets[index].learner_ids ?? []).length
      const faces = await rows[index].locator('.tch-brief__person').count()
      const moreText = await rows[index].locator('.tch-brief__personMore')
        .innerText().catch(() => '')
      const more = Number((moreText.match(/\d+/) ?? [0])[0])
      if (faces + more !== total) {
        bad(`bullet ${index}: shows ${faces}+${more} of ${total} people`)
      } else checked += 1
    }
    ok(`${checked} bullet(s) account for every learner they are about`)
  }
}

await page.screenshot({ path: `${shots}/hero.png` })

// ── the chat offers buttons ─────────────────────────────────────────────────
console.log('\n— chat actions —')
if (!await ask('מי צריך תשומת לב עכשיו?')) bad('an answer arrived')
else {
  ok('an answer arrived')
  const chips = await page.locator('.tch-dock__action').count()
  if (chips) {
    ok(`${chips} action chip(s) offered`)
    const labels = await page.locator('.tch-dock__action').allInnerTexts()
    console.log(`  · ${JSON.stringify(labels.map((l) => l.trim()).slice(0, 5))}`)
    // A chip label is a locale key rendered client-side; an unresolved key
    // would render as the key itself.
    if (labels.some((label) => label.trim().startsWith('tch.'))) {
      bad('a chip rendered an unresolved locale key')
    } else ok('every chip label resolved')
  } else {
    console.log('  · no chips on this answer')
  }
}

// A goal request must open a form, not just describe one.
console.log('\n— the guided form —')
if (!await ask('תכין יעד לתלמידים שלא היו פעילים')) bad('an answer arrived for the goal request')
else {
  ok('an answer arrived for the goal request')
  /* The GOAL form specifically. Taking the first expandable chip meant this
     block silently ran against whichever offer happened to come first — on a
     real answer that was `draft_kudos`, a one-field form, and every assertion
     below was about the wrong thing. */
  const task = page.locator('.tch-dock__action[data-kind="draft_goal"]').first()
  if (await task.count()) {
    await task.click()
    await page.waitForTimeout(700)
    const fields = await page.locator('.tch-dock__form .sp-input').count()
    if (fields >= 3) ok(`the form opens with ${fields} fields`)
    else bad(`the form opens with its fields (got ${fields})`)

    /* Who the goal is for, ALWAYS — including when it is one child.
       This was hidden at `candidates.length <= 1`, which is how a goal drafted
       for one arbitrary student out of a described set reached a teacher who
       confirmed it without ever seeing whose name was on it. */
    const people = await page.locator('.tch-dock__form .tch-chip').count()
    if (people) ok(`the form names its ${people} student(s), whatever the count`)
    else bad('the form names who the goal is for')

    /* And the label reads like a language.
       "הצבה ל-1 תלמידים" is the exact string a teacher photographed: `t()` has
       no plural engine, so a shared {count} key renders broken Hebrew at one.
       At a count of one the label names the child instead. */
    const confirm = (await page.locator('.tch-dock__formFoot .sp-btn').first().innerText()).trim()
    console.log(`  · confirm reads: ${JSON.stringify(confirm)}`)
    if (/\bל-1\b|\bto 1 students\b|\bلـ 1\b/.test(confirm)) {
      bad('the confirm label says "1 students"')
    } else ok('no "1 students" anywhere in the confirm label')
    if (people === 1) {
      const chipName = (await page.locator('.tch-dock__form .tch-chip').first().innerText()).trim()
      if (confirm.includes(chipName)) ok(`a one-student label names them (${chipName})`)
      else bad(`a one-student label names them (label ${JSON.stringify(confirm)})`)
    }

    // Confirm is gated on the required field, which is what makes the flow
    // guided rather than a form dumped on the teacher.
    const title = page.locator('.tch-dock__form .sp-input').first()
    await title.fill('')
    await page.waitForTimeout(250)
    const blocked = await page.locator('.tch-dock__formFoot .sp-btn').first().isDisabled()
    if (blocked) ok('confirm is disabled while the title is empty')
    else bad('confirm is disabled while the title is empty')

    const goalTitle = `בדיקה אוטומטית ${process.pid}`
    await title.fill(goalTitle)
    await page.waitForTimeout(250)
    const enabled = !(await page.locator('.tch-dock__formFoot .sp-btn').first().isDisabled())
    if (enabled) ok('confirm enables once it is filled')
    else bad('confirm enables once it is filled')

    // ── it actually writes, and only once ────────────────────────────────────
    // The whole point of persisting an action is that a restored thread must
    // not re-offer a button that would assign the same goal a second time.
    if (enabled) {
      const posted = page.waitForResponse(
        (response) => /\/api\/teacher\/(students|groups)\/[^/]+\/goals/.test(response.url())
          && response.request().method() === 'POST',
        { timeout: 30_000 }
      ).catch(() => null)
      await page.locator('.tch-dock__formFoot .sp-btn').first().click()
      const response = await posted
      if (!response) bad('confirm posts to the goals endpoint')
      else if (!response.ok()) bad(`the goal write succeeded (got ${response.status()})`)
      else {
        ok(`confirm wrote the goal · ${response.status()} ${new URL(response.url()).pathname}`)

        /* Two endpoints, two shapes. A one-student goal posts to
           `/students/{id}/goals`; a sub-group posts to
           `/groups/{id}/goals/assign` and answers with the ids it assigned.
           Slicing the path blindly read back `/students/goals/goals`, which is
           a 404 the check then reported as "the goal is not there". */
        const path = new URL(response.url()).pathname
        const learnerId = path.includes('/groups/')
          ? ((await response.json().catch(() => ({}))).assigned || [])[0]
          : decodeURIComponent(path.split('/').slice(-2, -1)[0])
        if (!learnerId) bad('the write reported which learners it assigned')
        const found = await page.evaluate(async ([id, wanted]) => {
          const reply = await fetch(`/api/teacher/students/${encodeURIComponent(id)}/goals`,
            { credentials: 'include' })
          if (!reply.ok) return `http ${reply.status}`
          const body = await reply.json()
          const goals = (body.conversations || []).flatMap((row) => row.goals || [])
          return goals.some((goal) => (goal.title || '').includes(wanted))
        }, [learnerId, goalTitle])
        if (found === true) ok('the goal is readable back from the API')
        else bad(`the goal is readable back from the API (got ${JSON.stringify(found)})`)

        // The receipt, in this session…
        await page.waitForTimeout(800)
        if (await page.locator('.tch-dock__actionDone').count()) {
          ok('the action becomes a receipt once it is done')
        } else bad('the action becomes a receipt once it is done')

        // …and after a reload, which is the duplicate-write hazard. The dock
        // reopens the most recent thread on mount, so this is the same message.
        await page.reload({ waitUntil: 'load' })
        await page.waitForSelector('.tch-dock__row--assistant', { timeout: 60_000 })
        await page.waitForTimeout(1200)
        const receipts = await page.locator('.tch-dock__actionDone').count()
        const liveForms = await page.locator('.tch-dock__action[aria-expanded]').count()
        if (receipts) ok(`the restored thread shows ${receipts} receipt(s), not a live button`)
        else bad('the restored thread shows a receipt, not a live button')
        if (liveForms) {
          console.log(`  · ${liveForms} other task chip(s) still live — expected only if `
            + 'the answer offered more than one')
        }
      }
    }
  } else {
    console.log('  · the model did not offer a goal form on this turn')
  }
}

await page.screenshot({ path: `${shots}/actions.png` })
await browser.close()
console.log(fail.length ? `\n❌ ${fail.length} check(s) failed` : '\n✅ all checks passed')
process.exit(fail.length ? 1 : 0)
