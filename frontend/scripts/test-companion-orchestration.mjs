#!/usr/bin/env node
/**
 * E2E for the lesson-chat ↔ xAPI orchestration (the queue + `screen_change`
 * push + grace window). Drives the REAL React chat, real Coach SSE, real trigger
 * engine — nothing is mocked. Synthetic Kata-shaped xAPI statements are POSTed
 * to the live backend to simulate the learner working the iframe; the harness
 * then asserts what Yuvi says and when.
 *
 * Prereqs (the harness does NOT start servers):
 *   - backend on 127.0.0.1:8720, started with LESSON_IDLE_SECONDS=8..15 so the
 *     idle scenario doesn't wait 2.5 min, and with real LLM creds.
 *   - frontend dev server on localhost:5173.
 *   - backend venv resolvable at ../backend/.venv (used to mint a session token).
 * Env overrides: YUVI_E2E_LEARNER (default "gal" — a real learner so /me passes),
 *   YUVI_E2E_COMPONENT / YUVI_E2E_UNIT (default the mass-measure practice),
 *   YUVI_BASE_URL, YUVI_API (default http://127.0.0.1:8720).
 *
 * Run from frontend/:  npm run test:companion-orchestration [-- --headed]
 *
 * NOTE: it acts as the real learner, so synthetic wrong/right answers land in
 * that learner's dev brain/analytics. Use a throwaway learner if that matters.
 */

import { chromium } from 'playwright'
import { dismissCheckin } from './lib/checkin.mjs'
import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'

const args = new Map(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=')
  return [k, v.length ? v.join('=') : true]
}))
const BASE_URL = String(args.get('base-url') || process.env.YUVI_BASE_URL || 'http://localhost:5173')
const API = String(process.env.YUVI_API || 'http://127.0.0.1:8720')
const HEADLESS = !args.has('headed')
const LEARNER = String(process.env.YUVI_E2E_LEARNER || 'gal')
const COMPONENT = String(process.env.YUVI_E2E_COMPONENT || 'methodica-science-mass-measure-01-02')
const UNIT = String(process.env.YUVI_E2E_UNIT || 'methodica-science-mass-measure-01')
const SUBJECT = String(process.env.YUVI_E2E_SUBJECT || 'science')
// The learning objective must be present on the launch, else answer events carry
// no objective_id and the mistake/success/misconception triggers never fire.
const OBJECTIVE = String(process.env.YUVI_E2E_OBJECTIVE || 'MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL.MASS-PRACTICE')
const ARTIFACTS = path.resolve(process.cwd(), '..', 'artifacts', 'companion-orchestration')
const VERB = (slug) => `https://lxp.education.gov.il/xapi/moe/verbs/${slug}`
const OBJ = (tail) => `https://lomdot.education.gov.il/act/${tail}`

const timeline = []
const log = (msg) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`; console.log(line); timeline.push(line) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function invariant(cond, msg) { if (!cond) throw new Error(`ASSERT: ${msg}`) }

// ── Auth: mint a session-cookie token via the backend venv (no password) ──────
function mintToken() {
  const py = path.resolve(process.cwd(), '..', 'backend', '.venv', 'bin', 'python3')
  const code =
    'import sys; sys.path.insert(0, ".");' +
    'from dotenv import load_dotenv; load_dotenv();' +
    'from app.auth.tokens import create_session_token;' +
    `print(create_session_token(user_id="${LEARNER}", username="${LEARNER}", roles=["learner"], session_id="e2e-orch"))`
  return execFileSync(py, ['-c', code], {
    cwd: path.resolve(process.cwd(), '..', 'backend'),
  }).toString().trim().split('\n').pop().trim()
}

// ── Synthetic Kata event pump (Node-side, carries the session cookie) ─────────
async function mintLaunch(cookie) {
  const res = await fetch(`${API}/api/xapi/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `spark_session=${cookie}` },
    body: JSON.stringify({ component_id: COMPONENT, unit_id: UNIT, subject: SUBJECT, objective_id: OBJECTIVE }),
  })
  invariant(res.ok, `mintLaunch failed: ${res.status}`)
  return res.json()
}
async function postStatement(launch, actor, { verb, objectTail, result }) {
  const stmt = {
    id: crypto.randomUUID(),
    actor,
    verb: { id: VERB(verb) },
    object: { id: OBJ(objectTail) },
    ...(result ? { result } : {}),
  }
  const res = await fetch(`${API}/api/xapi/${launch}/statements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${launch}` },
    body: JSON.stringify(stmt),
  })
  invariant(res.ok, `postStatement(${verb} ${objectTail}) failed: ${res.status}`)
  const body = await res.json()
  const stored = body?.results?.[0]?.stored
  log(`  → ${verb} ${objectTail} ${result ? `success=${result.success}` : ''} (stored=${stored})`)
  return body
}
const navTo = (launch, actor, n) => postStatement(launch, actor, { verb: 'enter', objectTail: `${COMPONENT}-${n}` })
const answer = (launch, actor, n, success) => postStatement(launch, actor, {
  verb: 'answered', objectTail: `${COMPONENT}-${n}/q1`,
  result: { success, response: success ? 'correct' : 'wrong', duration: 'PT25S' },
})

// ── DOM helpers ───────────────────────────────────────────────────────────────
const ASSIST = '.sp-companion__message-row--assistant'
async function assistantCount(page) { return page.locator(ASSIST).count() }
async function lastAssistantText(page) {
  const loc = page.locator(`${ASSIST} .sp-companion__msg`).last()
  return (await loc.count()) ? (await loc.innerText()).trim() : ''
}
// Wait until there are > `since` assistant bubbles AND the newest is complete.
async function waitForNewBubble(page, since, label, timeout = 45_000) {
  await page.waitForFunction(
    (prev) => {
      const rows = document.querySelectorAll('.sp-companion__message-row--assistant')
      if (rows.length <= prev) return false
      const last = rows[rows.length - 1]
      return last.getAttribute('data-message-complete') === 'true' && (last.textContent || '').trim().length > 1
    },
    since, { timeout },
  ).catch(() => { throw new Error(`TIMEOUT waiting for new bubble: ${label}`) })
  const text = await lastAssistantText(page)
  log(`  ✓ ${label}: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`)
  return text
}

async function main() {
  await rm(ARTIFACTS, { recursive: true, force: true })
  await mkdir(ARTIFACTS, { recursive: true })
  const results = []
  const record = (name, ok, note) => { results.push({ name, ok, note }); log(`${ok ? 'PASS' : 'FAIL'} — ${name}${note ? ` (${note})` : ''}`) }

  log(`Minting session token for "${LEARNER}"…`)
  const cookie = mintToken()
  invariant(cookie.length > 40, 'token mint failed')
  const { launch, slxapi } = await mintLaunch(cookie)
  const actor = slxapi.actor
  log(`Launch minted; actor.account.name=${actor?.account?.name}`)

  const browser = await chromium.launch({ headless: HEADLESS })
  const context = await browser.newContext()
  await context.addCookies([{ name: 'spark_session', value: cookie, url: BASE_URL }])
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('[companion]')) log(`  [browser] ${m.text().slice(0, 160)}`) })
  // Surface which proactive trigger each stream carries + when it starts, so a
  // missing/dropped nudge is diagnosable from the timeline.
  page.on('request', (req) => {
    if (req.url().includes('/api/agent/coach/proactive')) {
      let trig = '?'
      try { trig = JSON.parse(req.postData() || '{}').trigger } catch { /* */ }
      log(`  [proactive→ ${trig}]`)
    }
  })
  // Block the real Kata iframe so it can't emit competing xAPI — the chat panel
  // runs off the URL surface + our synthetic events, fully deterministically.
  await context.route('**://*.cet.ac.il/**', (r) => r.abort())

  try {
    log(`Opening lesson: ${COMPONENT}`)
    await page.goto(`${BASE_URL}/learning/lesson?unit=${UNIT}&component=${COMPONENT}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await dismissCheckin(page)
    await page.locator('#Yuvi-companion-panel').waitFor({ state: 'visible', timeout: 30_000 })
    await sleep(3500)   // let the lesson session establish + reset current_state

    // This component has 2 catalog items (player screens -002→cat-001, -003→cat-002).
    // Scenarios are ordered so the regression's mistake is the FIRST mistake (the
    // mistake cooldown is 30s — a later one would be masked by cooldown, not a bug).

    // Scenario 1 — navigate → intro appears (near-instant via the screen_change push).
    let count = await assistantCount(page)
    const t0 = Date.now()
    await navTo(launch, actor, '002')
    await waitForNewBubble(page, count, 'intro on screen -002')
    record('1. navigate → intro', true, `${Date.now() - t0}ms to bubble`)

    // Scenario 2 (THE regression) — go idle, get the idle nudge, then answer WRONG
    // ~2s later. The mistake MUST still react (the old code dropped it → silence).
    log(`Going idle; waiting up to 30s for the idle nudge (LESSON_IDLE_SECONDS)…`)
    let before = await assistantCount(page)
    await waitForNewBubble(page, before, 'idle nudge', 30_000)
    before = await assistantCount(page)
    await sleep(1800)                     // learner comes back and answers ~2s later
    await answer(launch, actor, '002', false)
    await waitForNewBubble(page, before, 'mistake AFTER idle (regression)', 45_000)
    record('2. idle → wrong-answer STILL reacts (regression)', true)

    // Scenario 3 — a fresh screen gets its own intro (screen tracking follows xAPI).
    count = await assistantCount(page)
    await navTo(launch, actor, '003')
    await waitForNewBubble(page, count, 'intro on screen -003')
    record('3. new screen → fresh intro', true)

    // Scenario 4 — correct answer + immediate auto-advance back; the reaction is
    // still shown (grace window keeps it readable across the screen change).
    count = await assistantCount(page)
    await answer(launch, actor, '003', true)   // correct → success nudge
    await waitForNewBubble(page, count, 'success reaction on correct answer', 45_000)
    // Now advance the screen immediately; the success bubble must remain visible
    // (grace) rather than vanish behind the new screen's filter.
    const successText = await lastAssistantText(page)
    await navTo(launch, actor, '002')
    await sleep(1200)
    const stillThere = (await page.locator(`${ASSIST} .sp-companion__msg`).allInnerTexts())
      .some((t) => t.trim() === successText.trim())
    record('4. success stays visible across auto-advance (grace window)', stillThere, stillThere ? 'grace held' : 'success vanished')

    // Scenario 5 (THE stale-intro regression) — a learner who moves FAST. An
    // intro is triggered for one screen and the learner leaves before it can
    // finish writing. Observed in production: question 2's orientation landed
    // 34s later, while the learner was on question 4, reading as if the chat had
    // gone backwards. The intro for the abandoned screen must never appear.
    count = await assistantCount(page)
    await navTo(launch, actor, '002')
    await sleep(250)                       // barely enough to start the stream
    await navTo(launch, actor, '003')      // …and gone again
    const arrived = await waitForNewBubble(page, count, 'intro after fast navigation', 45_000)
    // Whatever landed must describe where the learner IS. The abandoned screen's
    // intro is identified by its section: it must not have opened one.
    const staleSections = await page.evaluate((abandoned) => {
      const rows = Array.from(document.querySelectorAll('.sp-companion__qsection'))
      return rows.filter((s) => (s.getAttribute('data-item') || '') === abandoned).length
    }, `${COMPONENT}-002`).catch(() => 0)
    record('5. fast navigation → no intro for the abandoned screen', staleSections === 0,
      staleSections === 0 ? `only the live screen spoke` : `${staleSections} stale section(s)`)
    invariant(arrived.length > 1, 'no bubble at all after fast navigation')

    // Scenario 6 — one question, ONE section. The chat groups by question_key,
    // which used to change under the same question the moment the learner
    // answered (`…|item|` → `…|item|q1`), splitting one question into two
    // threads and pushing the "שאלה N" heading out of step with the lesson.
    const sectionCount = await page.locator('.sp-companion__qsection').count()
    const distinctItems = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.sp-companion__qsection'))
        .map((s) => s.getAttribute('data-item') || '')
        .filter(Boolean)
      return new Set(items).size
    }).catch(() => 0)
    const introSections = sectionCount - distinctItems
    record('6. one question → one section', distinctItems > 0 && introSections <= 1,
      `${sectionCount} sections / ${distinctItems} distinct screens`)

    await page.screenshot({ path: path.join(ARTIFACTS, 'final.png'), fullPage: true }).catch(() => {})
  } finally {
    await writeFile(path.join(ARTIFACTS, 'timeline.json'), JSON.stringify({ results, timeline }, null, 2))
    await browser.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed. Artifacts: ${ARTIFACTS}`)
  if (failed.length) process.exit(1)
}

main().catch((err) => { console.error(`\nHARNESS ERROR: ${err.message}`); process.exit(1) })
