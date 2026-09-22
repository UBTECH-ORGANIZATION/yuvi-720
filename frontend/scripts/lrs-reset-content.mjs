/* Clear the content-side progress of the LRS test student, the product way.
 *
 *   cd frontend && node scripts/lrs-reset-content.mjs --base https://dev.spark.yuvilab.ai \
 *        --components methodica-science-mass-measure-01-01,methodica-science-mass-measure-01-02
 *
 * Kata keeps the lomda's saved progress per student+component; our reset of
 * the learner (seed_lrs_test_accounts.py --fresh) never reaches it. The §6
 * "start over" launch (POST /api/learning/sessions, restart=true) asks Kata
 * for resetState — this sends exactly that, as the logged-in learner, for each
 * component; several times a few seconds apart because Kata applied the reset
 * unreliably on 22/09/2026 (same registrationId either way). Components the
 * route has not opened yet answer 409 and are skipped: nothing to clear there.
 * Costs one session enter/exit pair on the LRS. */
import { chromium } from 'playwright'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true'] : []).filter((p) => p.length))
const BASE = args.base || 'http://localhost:5173'
const STUDENT = args.student || 'lrs-student'
const PASSWORD = args.password || process.env.LRS_TEST_PASSWORD || 'Bodek720!'
const COMPONENTS = (args.components || '').split(',').map((s) => s.trim()).filter(Boolean)
const ROUNDS = Number(args.rounds || 3)
const GAP_MS = Number(args.gap || 8000)
if (!COMPONENTS.length) { console.error('--components a,b,c is required'); process.exit(2) }
const unitOf = (id) => id.replace(/-\d+$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
const call = (method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const r = await fetch(url, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  let data = null; try { data = await r.json() } catch {}
  return { status: r.status, data }
}, { method, url, body })
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const login = await call('POST', '/api/auth/login', { username: STUDENT, password: PASSWORD })
  if (login.status !== 200) throw new Error(`login → ${login.status}`)
  console.log(`logged in as ${STUDENT} on ${BASE}`)
  for (let round = 1; round <= ROUNDS; round += 1) {
    for (const component of COMPONENTS) {
      const r = await call('POST', '/api/learning/sessions', { component_id: component, unit_id: unitOf(component), language: 'he', restart: true })
      console.log(`round ${round} · ${component} → ${r.status}${r.status === 409 ? ' (locked by the route — skipped)' : r.status === 200 ? ' (resetState sent)' : ` ${JSON.stringify(r.data)?.slice(0, 120)}`}`)
    }
    if (round < ROUNDS) await sleep(GAP_MS)
  }
  await call('POST', '/api/auth/logout', {})
  console.log('logged out')
} finally {
  await browser.close()
}
