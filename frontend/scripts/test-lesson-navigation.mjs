#!/usr/bin/env node
/**
 * Integrity suite for "where is the learner, and does the chat agree?"
 *
 * Drives the FIRST lesson — מדידה מעשית של מסה בשלושה מצבי צבירה /
 * פתיחה, הקנייה ותרגול סטנדרטי א — with Kata-shaped xAPI, then checks two
 * things after every move:
 *
 *   A. SERVER truth — `/api/agent/coach/support/state` must name the screen the
 *      learner is really on. Deterministic, no LLM involved.
 *   B. CHAT truth — the accordion marked current (`.is-current`) must be the one
 *      for that screen, it must be the expanded one, and its heading number must
 *      be the question number from the catalog.
 *
 * Cases are the ones kids actually produce: paging BACK, re-answering a screen
 * they returned to, watching the video, and Kata's relay delivering a batch of
 * statements out of order and duplicated (real, observed — that batch is
 * replayed here verbatim).
 *
 * Part D switches lessons to `…-01-04`, the only component of this unit with a
 * screen that TEACHES and never asks (`…-006`, a video): it must still get its
 * own thread, captioned for what it is, with no hint/explanation buttons.
 *
 * Prereqs (does NOT start servers): backend on 127.0.0.1:8720, frontend on
 * :5173, backend venv at ../backend/.venv.
 * Env: YUVI_NAV_LEARNER (default "e2e-bot" — a throwaway; never use a real kid),
 *      YUVI_BASE_URL, YUVI_API.
 *
 * Run from frontend/:  node scripts/test-lesson-navigation.mjs [--headed]
 */

import { chromium } from 'playwright'
import { dismissCheckin } from './lib/checkin.mjs'
import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'

const args = new Set(process.argv.slice(2).map((a) => a.replace(/^--/, '')))
const BASE_URL = String(process.env.YUVI_BASE_URL || 'http://localhost:5173')
const API = String(process.env.YUVI_API || 'http://127.0.0.1:8720')
const HEADLESS = !args.has('headed')
const LEARNER = String(process.env.YUVI_NAV_LEARNER || 'e2e-bot')
const UNIT = 'methodica-science-mass-measure-01'
const COMPONENT = 'methodica-science-mass-measure-01-01'
// The only component of this unit that carries a screen with NO question:
// `…-006` is a video (פריט העשרה). Part D drives it.
const TEACH_COMPONENT = 'methodica-science-mass-measure-01-04'
const SUBJECT = 'science'
const OBJECTIVE = 'MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL.MASS-PRACTICE'
const ARTIFACTS = path.resolve(process.cwd(), '..', 'artifacts', 'lesson-navigation')
const VERB = (slug) => `https://lxp.education.gov.il/xapi/moe/verbs/${slug}`
const OBJ = (tail) => `https://lomdot.education.gov.il/act/${tail}`
const item = (n) => `${COMPONENT}-${n}`

const ASSIST = '.sp-companion__message-row--assistant'
const timeline = []
const log = (m) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${m}`; console.log(line); timeline.push(line) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function check(name, ok, note) {
  results.push({ name, ok, note })
  log(`${ok ? 'PASS' : 'FAIL'} — ${name}${note ? ` (${note})` : ''}`)
}

function mintToken() {
  const py = path.resolve(process.cwd(), '..', 'backend', '.venv', 'bin', 'python3')
  const code =
    'import sys; sys.path.insert(0, ".");' +
    'from dotenv import load_dotenv; load_dotenv();' +
    'from app.auth.tokens import create_session_token;' +
    `print(create_session_token(user_id="${LEARNER}", username="${LEARNER}", roles=["learner"], session_id="e2e-nav"))`
  return execFileSync(py, ['-c', code], { cwd: path.resolve(process.cwd(), '..', 'backend') })
    .toString().trim().split('\n').pop().trim()
}

async function mintLaunch(cookie, componentId = COMPONENT) {
  const res = await fetch(`${API}/api/xapi/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `spark_session=${cookie}` },
    body: JSON.stringify({ component_id: componentId, unit_id: UNIT, subject: SUBJECT, objective_id: OBJECTIVE }),
  })
  if (!res.ok) throw new Error(`mintLaunch failed: ${res.status}`)
  return res.json()
}

// `at` is the statement's OWN timestamp — the whole point of the ordering cases.
async function post(launch, actor, { verb, objectTail, at, result }) {
  const res = await fetch(`${API}/api/xapi/${launch}/statements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${launch}` },
    body: JSON.stringify({
      id: crypto.randomUUID(), actor, verb: { id: VERB(verb) }, object: { id: OBJ(objectTail) },
      ...(at ? { timestamp: at } : {}), ...(result ? { result } : {}),
    }),
  })
  if (!res.ok) throw new Error(`post(${verb} ${objectTail}) failed: ${res.status}`)
  return res.json()
}

// A synthetic but ordered clock, so "older/newer" is explicit in every case.
let clock = Date.parse('2026-07-28T09:00:00.000Z')
const tick = (seconds = 5) => new Date(clock += seconds * 1000).toISOString()
const at = (offsetSeconds) => new Date(clock + offsetSeconds * 1000).toISOString()

const enter = (l, a, n, when) => post(l, a, { verb: 'initialized', objectTail: item(n), at: when || tick() })
const answer = (l, a, n, success, when) => post(l, a, {
  verb: 'answered', objectTail: `${item(n)}/q1`, at: when || tick(),
  result: { success, response: success ? 'correct' : 'wrong', duration: 'PT20S' },
})
const finish = (l, a, n, success, when) => post(l, a, { verb: 'completed', objectTail: item(n), at: when || tick(), result: { success } })
const video = (l, a, verb, when) => post(l, a, { verb, objectTail: COMPONENT, at: when || tick(2) })

async function serverPosition(cookie, componentId = COMPONENT) {
  const res = await fetch(`${API}/api/agent/coach/support/state?component_id=${componentId}`, {
    headers: { Cookie: `spark_session=${cookie}` },
  })
  const body = await res.json()
  const parts = String(body.question_key || '').split('|')
  return {
    item: parts[1] || '',
    question: parts[2] || '',
    ordinals: body.question_ordinals || {},
    items: body.items || [],
    teaching: body.teaching_items || [],
  }
}

// ── DOM: which accordion does the chat consider current, and is it open? ──────
async function chatPosition(page) {
  return page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll('.sp-companion__qsection'))
    const current = sections.find((s) => s.classList.contains('is-current'))
    return {
      sections: sections.map((s) => ({
        item: s.getAttribute('data-item') || '',
        number: s.getAttribute('data-question-number') || '',
        kind: s.getAttribute('data-kind') || '',
        current: s.classList.contains('is-current'),
        collapsed: s.classList.contains('is-collapsed'),
      })),
      currentItem: current?.getAttribute('data-item') || '',
      currentNumber: current?.getAttribute('data-question-number') || '',
      currentCollapsed: current ? current.classList.contains('is-collapsed') : null,
    }
  })
}

async function waitForServerPosition(cookie, expectedItem, label, timeout = 15000, componentId = COMPONENT) {
  const deadline = Date.now() + timeout
  let seen = {}
  while (Date.now() < deadline) {
    seen = await serverPosition(cookie, componentId)
    if (seen.item === expectedItem) return seen
    await sleep(400)
  }
  log(`  ✗ ${label}: expected ${expectedItem.slice(-3)}, server says ${seen.item.slice(-3) || '(none)'}`)
  return seen
}

async function main() {
  await rm(ARTIFACTS, { recursive: true, force: true })
  await mkdir(ARTIFACTS, { recursive: true })

  log(`Learner "${LEARNER}" — lesson ${COMPONENT}`)
  const cookie = mintToken()
  const { launch, slxapi } = await mintLaunch(cookie)
  const actor = slxapi.actor

  const browser = await chromium.launch({ headless: HEADLESS })
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } })
  await context.addCookies([{ name: 'spark_session', value: cookie, url: BASE_URL }])
  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().includes('[companion]')) log(`  [browser] ${m.text().slice(0, 150)}`)
  })
  // Block the real Kata iframe: this suite IS the content, deterministically.
  await context.route('**://*.cet.ac.il/**', (r) => r.abort())

  try {
    await page.goto(`${BASE_URL}/learning/lesson?unit=${UNIT}&component=${COMPONENT}`, {
      waitUntil: 'domcontentloaded', timeout: 30_000,
    })
    await dismissCheckin(page)
    await page.locator('#Yuvi-companion-panel').waitFor({ state: 'visible', timeout: 30_000 })
    await sleep(3000)

    // ── PART A — server truth under every navigation shape ──────────────────

    // 1. Straight forward progress.
    await enter(launch, actor, '001')
    let pos = await waitForServerPosition(cookie, item('001'), 'forward to 001')
    check('A1. forward navigation tracks the screen', pos.item === item('001'), `q=${pos.question}`)
    check('A1b. the screen\'s question resolves on arrival (no answer needed)',
      pos.question === 'q1', `question=${pos.question || '(none)'}`)

    await answer(launch, actor, '001', false)
    await finish(launch, actor, '001', false)
    await enter(launch, actor, '002')
    await answer(launch, actor, '002', true)
    await finish(launch, actor, '002', true)
    await enter(launch, actor, '003')
    pos = await waitForServerPosition(cookie, item('003'), 'forward to 003')
    check('A2. answering does not re-key the same question', pos.item === item('003') && pos.question === 'q1')

    // 2. Watching the video — component-level events, no screen. The learner has
    //    not moved; the pointer must not drift to the component root.
    await video(launch, actor, 'played')
    await video(launch, actor, 'paused')
    await video(launch, actor, 'played')
    await sleep(1200)
    pos = await serverPosition(cookie)
    check('A3. watching the video does not move the learner', pos.item === item('003'), `still ${pos.item.slice(-3)}`)

    // 2b. …but playback on a screen that has NO media of its own is the only
    //     signal that the video screen started: Kata reports `played` against the
    //     component and its `initialized` for that screen arrives late or never
    //     (observed 29/07: 90s of playback on -003 with no `initialized` at all,
    //     leaving the chat marked on the question the learner had just finished).
    await enter(launch, actor, '002')
    await waitForServerPosition(cookie, item('002'), 'step back to 002 before playback')
    await video(launch, actor, 'played')
    pos = await waitForServerPosition(cookie, item('003'), 'playback attributes the video screen')
    check('A3b. playback on a silent screen lands the learner on the video screen',
      pos.item === item('003'), `server says ${pos.item.slice(-3)}`)

    // 3. Paging BACK — reported by Kata, must move the pointer back.
    await enter(launch, actor, '004')
    await waitForServerPosition(cookie, item('004'), 'forward to 004')
    await enter(launch, actor, '003')
    pos = await waitForServerPosition(cookie, item('003'), 'back to 003')
    check('A4. paging BACK moves the learner back', pos.item === item('003'))

    await enter(launch, actor, '002')
    pos = await waitForServerPosition(cookie, item('002'), 'back to 002')
    check('A5. paging back twice keeps following', pos.item === item('002'))

    // 4. Re-answering a screen they returned to.
    await answer(launch, actor, '002', true)
    await sleep(1200)
    pos = await serverPosition(cookie)
    check('A6. re-answering on a revisited screen stays put', pos.item === item('002') && pos.question === 'q1')

    // 5. THE relay batch — real shape: out of order, duplicated, all at once.
    //    Truth is the newest statement (-005). Nothing may rewind the learner.
    await enter(launch, actor, '005', at(60))            // newest: learner is on 005
    await waitForServerPosition(cookie, item('005'), 'forward to 005')
    await Promise.all([
      enter(launch, actor, '003', at(20)),               // older, arrives late
      enter(launch, actor, '004', at(30)),               // older, arrives late
      enter(launch, actor, '003', at(20)),               // duplicate replay
      answer(launch, actor, '004', false, at(35)),       // older answer
    ])
    await sleep(2000)
    pos = await serverPosition(cookie)
    check('A7. an out-of-order, duplicated relay batch cannot rewind the learner',
      pos.item === item('005'), `server says ${pos.item.slice(-3)}`)

    // 6. …and a genuine move after the batch still works.
    await enter(launch, actor, '004', at(90))
    pos = await waitForServerPosition(cookie, item('004'), 'deliberate move back after the batch')
    check('A8. a real move after a stale batch still lands', pos.item === item('004'))

    const ordinals = pos.ordinals || {}
    check('A9. the catalog numbers the questions for the chat',
      ordinals[item('004')] === 4, `004 → ${ordinals[item('004')]}`)

    // ── PART B — the chat agrees with the server ────────────────────────────
    // A thread only exists where Yuvi has actually spoken, so this half moves at
    // a learner's pace: arrive, let the intro finish, then move. (Part A's fast
    // navigation deliberately drops those intros as stale — which is why these
    // checks would otherwise run against an empty panel and pass on nothing.)
    // Fresh launch: per-question intros fire once per launch, and Part A just
    // spent them (deliberately — it moves too fast for any to survive). Reload,
    // exactly as a learner opening the lesson does, so this half starts clean.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.locator('#Yuvi-companion-panel').waitFor({ state: 'visible', timeout: 30_000 })
    await sleep(3500)

    const sectionCount = () => page.locator('.sp-companion__qsection[data-item]').count()
    async function settleOn(n, label) {
      await enter(launch, actor, n, at(200 + Number(n) * 30))
      await waitForServerPosition(cookie, item(n), label)
      // A thread only counts once Yuvi has actually WRITTEN in it: the bubble
      // exists while the stream is still empty, and is dropped if the learner
      // moves on first. Counting sections instead let the next arrival start
      // before this one had said anything, which then dropped it as stale.
      await page.waitForFunction(
        (id) => {
          const section = document.querySelector(`.sp-companion__qsection[data-item="${id}"]`)
          return !!section && (section.textContent || '').trim().length > 40
        },
        item(n), { timeout: 90_000 },
      ).catch(() => log(`  (no thread formed for ${n})`))
      await sleep(1500)
    }

    log('Building real question threads (waiting for each intro)…')
    await settleOn('001', 'settle on 001')
    await settleOn('002', 'settle on 002')

    let chat = await chatPosition(page)
    log(`  chat sections: ${JSON.stringify(chat.sections)}`)
    check('B0. the chat actually built per-question threads',
      chat.sections.filter((s) => s.item).length >= 2,
      `${chat.sections.filter((s) => s.item).length} threads`)

    const server = await serverPosition(cookie)
    // Yuvi may not have spoken about the live screen (already introduced earlier,
    // or dropped as stale). Then NO thread may claim to be current — marking the
    // newest one would tell the learner they are somewhere they are not.
    const hasThreadForLive = chat.sections.some((s) => s.item === server.item)
    check('B1. the marked accordion is the screen the learner is on — or none at all',
      hasThreadForLive ? chat.currentItem === server.item : chat.currentItem === '',
      `chat=${chat.currentItem.slice(-3) || '(none)'} server=${server.item.slice(-3)} thread=${hasThreadForLive}`)
    check('B2. a marked accordion is always the expanded one',
      chat.currentCollapsed === false || chat.currentItem === '',
      `collapsed=${chat.currentCollapsed}`)
    const items = chat.sections.filter((s) => s.item).map((s) => s.item)
    check('B3. one accordion per question (no duplicate threads)',
      new Set(items).size === items.length, `${items.length} threads, ${new Set(items).size} distinct`)
    const numbered = chat.sections.filter((s) => s.item && s.number)
    check('B4. thread headings use the lesson\'s own question numbers',
      numbered.length > 0 && numbered.every((s) => s.number === String(ordinals[s.item])),
      numbered.map((s) => `${s.item.slice(-3)}→${s.number} (catalog ${ordinals[s.item]})`).join(' '))

    // The case you hit: page BACK with the panel open. The marker and the open
    // accordion must follow the learner backwards, not stay pinned to the
    // furthest question reached.
    await enter(launch, actor, '001', at(400))
    await waitForServerPosition(cookie, item('001'), 'back to 001 with the chat open')
    await sleep(2500)
    chat = await chatPosition(page)
    check('B5. going back re-marks the earlier thread',
      chat.currentItem === item('001'),
      `chat=${chat.currentItem.slice(-3) || '(none)'}`)
    check('B6. …and re-opens it, collapsing the later one',
      chat.currentCollapsed === false
        && chat.sections.filter((s) => s.item && s.item !== item('001')).every((s) => s.collapsed),
      JSON.stringify(chat.sections.map((s) => `${s.item.slice(-3)}${s.collapsed ? ':closed' : ':open'}`)))

    // ── PART C — answer, move on immediately, then get the next one wrong ────
    // The reported failure: the reaction to the answer has not been written yet
    // when the learner advances, and from then on nothing reacts — a mistake on
    // the NEXT question produces only the arrival, as if the chat had lost the
    // thread. One serial worker owns Yuvi's voice, so anything that holds it
    // strands every turn behind it.
    log('Fast answer → advance → mistake on the next question…')
    const beforeFast = await sectionCount()
    const bubblesBefore = await page.locator(ASSIST).count()
    await answer(launch, actor, '002', true, at(500))      // correct
    await enter(launch, actor, '003', at(501))             // …advance one second later
    await answer(launch, actor, '003', false, at(505))     // …and get this one wrong
    await waitForServerPosition(cookie, item('003'), 'fast-advance lands on 003')

    // Something must react to the wrong answer within a reasonable window.
    const reacted = await page.waitForFunction(
      (prev) => document.querySelectorAll('.sp-companion__message-row--assistant').length > prev,
      bubblesBefore, { timeout: 90_000 },
    ).then(() => true).catch(() => false)
    check('C1. the chat still reacts after a fast answer-and-advance', reacted,
      reacted ? 'a turn was produced' : 'silence — the queue is stranded')

    const afterFast = await chatPosition(page)
    check('C2. the queue kept following the learner (no stranded position)',
      afterFast.sections.some((s) => s.item === item('003')) || afterFast.currentItem === '',
      `sections=${afterFast.sections.map((s) => s.item.slice(-3)).join(',') || '(none)'} (was ${beforeFast})`)

    // Clicking fast used to produce TWO threads captioned "שאלה 3": one numbered
    // from the catalog and one numbered by its position on screen. A caption is
    // a claim about which question the thread is — two threads may never make
    // the same claim, and a number must always be the catalog's.
    const numberedNow = afterFast.sections.filter((s) => s.item && s.number)
    const captions = numberedNow.map((s) => s.number)
    check('C3. no two threads claim the same question number',
      new Set(captions).size === captions.length, `captions=[${captions.join(',')}]`)
    check('C4. every number shown is the catalog\'s own',
      numberedNow.every((s) => s.number === String(ordinals[s.item])),
      numberedNow.map((s) => `${s.item.slice(-3)}→${s.number} (catalog ${ordinals[s.item]})`).join(' ') || 'none numbered')

    // Racing forward: answer and jump two screens before anything can be written.
    // The reaction to the answer must NOT surface two questions later, and the
    // learner's position must still be followed exactly.
    log('Racing forward two screens mid-reaction…')
    await answer(launch, actor, '003', true, at(600))
    await enter(launch, actor, '004', at(601))
    await enter(launch, actor, '005', at(602))
    const racedPos = await waitForServerPosition(cookie, item('005'), 'raced to 005')
    check('C5. racing two screens ahead still tracks the learner', racedPos.item === item('005'))
    await sleep(6000)
    const raced = await chatPosition(page)
    check('C6. a reaction two screens behind does not open a thread there',
      !raced.sections.some((s) => s.item === item('003') && s.current),
      `sections=${raced.sections.map((s) => `${s.item.slice(-3)}${s.current ? '*' : ''}`).join(',')}`)

    await page.screenshot({ path: path.join(ARTIFACTS, 'final.png'), fullPage: true }).catch(() => {})

    // ── PART D — screens that TEACH instead of asking ───────────────────────
    // A component is a sequence of פריטים and only some of them ask something.
    // `…-01-04-006` is a video with no question: `question_intro` is gated silent
    // there, so it used to produce no message and therefore NO thread in the
    // chat at all. It must now get its own thread, captioned for what it is, and
    // no hint/explanation buttons — there is no question to be hinted at.
    log(`Teaching screen — ${TEACH_COMPONENT}-006 (video, no question)…`)
    const launch2 = (await mintLaunch(cookie, TEACH_COMPONENT)).launch
    const tenter = (n, when) => post(launch2, actor, {
      verb: 'initialized', objectTail: `${TEACH_COMPONENT}-${n}`, at: when || tick(),
    })

    await page.goto(`${BASE_URL}/learning/lesson?unit=${UNIT}&component=${TEACH_COMPONENT}`, {
      waitUntil: 'domcontentloaded', timeout: 30_000,
    })
    await dismissCheckin(page)
    await page.locator('#Yuvi-companion-panel').waitFor({ state: 'visible', timeout: 30_000 })
    await sleep(3500)

    const spine = await serverPosition(cookie, TEACH_COMPONENT)
    const videoRow = (spine.items || []).find((r) => r.id === `${TEACH_COMPONENT}-006`)
    check('D1. the server knows the video screen is not a question',
      videoRow?.kind === 'watch' && videoRow?.media_format === 'video',
      `kind=${videoRow?.kind || '(missing)'} media=${videoRow?.media_format || '—'}`)
    check('D2. …and every other screen of that component still is a question',
      (spine.items || []).filter((r) => r.kind === 'question').length === 5,
      `${(spine.items || []).map((r) => `${r.id.slice(-3)}:${r.kind}`).join(' ')}`)

    await tenter('006')
    const teachPos = await waitForServerPosition(
      cookie, `${TEACH_COMPONENT}-006`, 'arrive at the video screen', 15000, TEACH_COMPONENT,
    )
    check('D3. the learner is tracked onto the teaching screen',
      teachPos.item === `${TEACH_COMPONENT}-006` && teachPos.question === '',
      `item=${teachPos.item.slice(-3)} q=${teachPos.question || '(none)'}`)

    const gotThread = await page.waitForFunction(
      (id) => Array.from(document.querySelectorAll('.sp-companion__qsection'))
        .some((s) => s.getAttribute('data-item') === id),
      `${TEACH_COMPONENT}-006`, { timeout: 90_000 },
    ).then(() => true).catch(() => false)
    check('D4. the video screen gets its own thread in the chat', gotThread,
      gotThread ? 'Yuvi opened the step' : 'silence — no section for the screen')

    await sleep(1500)
    const teachChat = await chatPosition(page)
    const videoSection = teachChat.sections.find((s) => s.item === `${TEACH_COMPONENT}-006`)
    check('D5. it is captioned for what it is, not "question N"',
      videoSection?.kind === 'watch' && !videoSection?.number,
      `kind=${videoSection?.kind || '(none)'} number=${videoSection?.number || '(none)'}`)
    const supportButtons = await page.locator('.sp-companion__support-option').count()
    check('D6. no hint/explanation buttons on a screen with no question',
      supportButtons === 0, `${supportButtons} buttons offered`)

    await page.screenshot({ path: path.join(ARTIFACTS, 'teaching-screen.png'), fullPage: true }).catch(() => {})
  } finally {
    await writeFile(path.join(ARTIFACTS, 'timeline.json'), JSON.stringify({ results, timeline }, null, 2))
    await browser.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Artifacts: ${ARTIFACTS}`)
  if (failed.length) process.exit(1)
}

main().catch((err) => { console.error(`\nHARNESS ERROR: ${err.message}`); process.exit(1) })
