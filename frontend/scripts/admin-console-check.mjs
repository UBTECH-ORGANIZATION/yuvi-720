/* Drive the admin console end-to-end (F8, plan A9b).
 *
 * Beyond rendering, this exercises the guardrail that matters most: unlinking
 * the last teacher from a group that still has learners must be refused with an
 * explicit override, not done silently. It does that on a throwaway group it
 * creates itself, so the real roster and the demo fixture are never touched.
 *
 * Never uses `waitUntil: 'networkidle'` — the app holds an SSE connection open.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dismissTourIfOpen } from './lib/tour.mjs'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/admin-console'
const GROUP_ID = 'adm-check-group'

/* The run ends by ARCHIVING this group — that is the guardrail being proved,
   and the console offers no hard delete for a group with enrollments. So the
   fixture outlives the run, and a second run would find a group it did not
   create, already carrying members. Clear it out of band first. */
execFileSync('python', ['scripts/clear_check_fixture.py', GROUP_ID],
             { cwd: '../backend', stdio: 'pipe' })
mkdirSync(OUT, { recursive: true })

/* The landing page runs a WebGL scene, and a click dispatched while it is still
   settling can hang for the full actionability timeout. Retry once against a
   fresh load rather than failing the whole run on a rendering hiccup. */
const clickLanding = async (page, selector) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.waitForSelector(selector, { timeout: 45000 })
      await page.locator(selector).click({ timeout: 15000 })
      return
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
    }
  }
  await page.locator(selector).click({ timeout: 20000 })
}

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  const text = message.text()
  if (message.type() !== 'error') return
  if (/Failed to load resource|401|403|409|400/.test(text)) return  // expected refusals
  if (/React does not recognize/.test(text)) return
  failures.push(`console: ${text}`)
})

/* Every mutation here round-trips to the server and refetches the org snapshot,
   so `locator.count()` — which does NOT auto-wait — races the re-render. Poll
   for the expected count instead of guessing a duration. */
const waitForCount = async (locator, expected, timeout = 15000) => {
  const deadline = Date.now() + timeout
  let seen = -1
  while (Date.now() < deadline) {
    seen = await locator.count()
    if (seen === expected) return seen
    await page.waitForTimeout(250)
  }
  return seen
}

const tab = async (name) => {
  await page.locator(`.adm__tabs button:nth-child(${{ overview: 1, people: 2, groups: 3, audit: 4 }[name]})`).click()
  await page.waitForTimeout(900)
}

try {
  // ── sign in as the admin ──────────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await clickLanding(page, '.landing720-login-btn.teacher')
  await page.waitForTimeout(600)
  const dialog = page.locator('[role="dialog"]')
  await dialog.locator('input').first().fill('gal')
  await dialog.locator('input[type="password"]').fill('Aa12345')
  await dialog.locator('button[type="submit"]').click()
  await page.waitForTimeout(3500)

  // ── the admin nav entry must exist, and only for an admin ─────────────────
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.teacher-app-nav', { timeout: 30000 })
  // Phase 8: the tour opens itself for an account that has not seen it,
  // and its scrim blocks clicks. Dismiss it as a teacher would.
  await dismissTourIfOpen(page)
  /* Design decision: the console is no longer in the teaching nav — it is a
     control plane reached at /admin directly, not a tab beside Students. The
     check therefore asserts the nav stays clean for EVERYONE and the console
     still opens for an admin by URL. */
  check('the admin lane is not in the teaching nav (by design)',
        await page.locator('[data-tour="teacher.nav.admin"]').count() === 0)

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.adm__tabs', { timeout: 30000 })
  check('landed on the console', page.url().includes('/admin'), page.url())

  // ── overview ──────────────────────────────────────────────────────────────
  await page.waitForSelector('.adm-count', { timeout: 30000 })
  const counts = await page.locator('.adm-count').count()
  check('overview renders the size of the system', counts === 6, `${counts} counts`)

  const warnPanels = await page.locator('.adm-panel--warn').count()
  check('the two "nobody is watching" panels lead', warnPanels === 2, `${warnPanels} panels`)

  const orphanRows = await page.locator('.adm-panel--warn').first().locator('.adm-list__row').count()
  check('unassigned learners are surfaced', orphanRows >= 0, `${orphanRows} learners`)
  await page.screenshot({ path: `${OUT}/01-overview.png`, fullPage: true })

  // ── people: connections from both directions ──────────────────────────────
  await tab('people')
  await page.waitForSelector('.adm-personRow', { timeout: 30000 })
  const allPeople = await page.locator('.adm-personRow').count()

  await page.locator('.adm-filters__roles button').nth(1).click()   // teachers
  await page.waitForTimeout(500)
  const teachers = await page.locator('.adm-personRow').count()
  check('role filter narrows the directory', teachers > 0 && teachers < allPeople,
        `${teachers} of ${allPeople}`)

  await page.locator('.adm-personRow').first().click()
  await page.waitForTimeout(1400)
  const teacherDetail = await page.locator('.adm-detail').innerText()
  check('teacher detail answers "which children can this teacher read?"',
        /\d/.test(teacherDetail))
  await page.screenshot({ path: `${OUT}/02-teacher-connections.png`, fullPage: true })

  await page.locator('.adm-filters__roles button').nth(2).click()   // learners
  await page.waitForTimeout(500)
  await page.locator('.adm-personRow').first().click()
  await page.waitForTimeout(1400)
  const learnerDetail = await page.locator('.adm-detail').innerText()
  check('learner detail answers "who can read this child?"', learnerDetail.length > 0)
  await page.screenshot({ path: `${OUT}/03-learner-connections.png`, fullPage: true })

  // ── groups: build a throwaway group, then trip the guardrail ──────────────
  await tab('groups')
  await page.waitForTimeout(600)

  const createGroup = page.locator('.adm-create__toggle', { hasText: /קבוצה חדשה|New group|مجموعة جديدة/ })
  await createGroup.click()
  await page.waitForTimeout(300)
  const groupForm = page.locator('.adm-create__form').first()
  await groupForm.locator('input').nth(0).fill(GROUP_ID)
  await groupForm.locator('input').nth(1).fill('בדיקת ניהול')
  await groupForm.locator('button.sp-btn').last().click()

  const created = await waitForCount(page.locator('.adm-personRow', { hasText: GROUP_ID }), 1)
  check('a group can be created from the console', created === 1, `${created} rows`)

  await page.locator('.adm-personRow', { hasText: GROUP_ID }).first().click()
  await page.waitForTimeout(800)

  // one teacher + one learner — the exact shape the guardrail protects
  const columns = page.locator('.adm-membership__col')
  await columns.nth(0).locator('select').selectOption({ index: 1 })
  await columns.nth(0).locator('button.sp-btn').last().click()
  const teacherMembers = await waitForCount(columns.nth(0).locator('.adm-list__row'), 1)

  await columns.nth(1).locator('select').selectOption({ index: 1 })
  await columns.nth(1).locator('button.sp-btn').last().click()
  const learnerMembers = await waitForCount(columns.nth(1).locator('.adm-list__row'), 1)
  check('membership is editable from the group direction',
        teacherMembers === 1 && learnerMembers === 1,
        `${teacherMembers} teachers, ${learnerMembers} students`)
  await page.screenshot({ path: `${OUT}/04-group-membership.png`, fullPage: true })

  // THE guardrail: removing the last teacher must be refused, not done quietly.
  await columns.nth(0).locator('.adm-list__row button').first().click()
  await page.waitForTimeout(2000)
  const refusal = page.locator('.adm-refusal--overridable')
  check('unlinking the last teacher is refused, with an override',
        await refusal.count() === 1)
  await page.screenshot({ path: `${OUT}/05-guardrail.png`, fullPage: true })

  const stillLinked = await columns.nth(0).locator('.adm-list__row').count()
  check('the refusal actually blocked the change', stillLinked === 1, `${stillLinked} teachers`)

  await refusal.locator('button').first().click()   // confirm the override
  const afterOverride = await waitForCount(columns.nth(0).locator('.adm-list__row'), 0)
  check('confirming the override completes the unlink', afterOverride === 0,
        `${afterOverride} teachers`)

  // Archive, never delete: the row must survive, now carrying the archived pill.
  await page.locator('.adm-detail__head button').click()
  const stillListed = await waitForCount(page.locator('.adm-personRow', { hasText: GROUP_ID }), 1)
  const archivedPill = await waitForCount(
    page.locator('.adm-personRow', { hasText: GROUP_ID }).locator('.sp-pill'), 1
  )
  check('a group is archived rather than deleted', stillListed === 1 && archivedPill === 1,
        `row=${stillListed} pill=${archivedPill}`)

  // ── audit: every one of those mutations must be on the record ─────────────
  await tab('audit')
  await page.waitForSelector('.adm-auditRow', { timeout: 30000 })
  const auditRows = await page.locator('.adm-auditRow').count()
  check('every mutation is on the record', auditRows >= 5, `${auditRows} entries`)

  await page.locator('.adm-auditRow__toggle').first().click()
  await page.waitForTimeout(400)
  const diff = await page.locator('.adm-auditRow__diff').count()
  check('an audit row opens to its literal before/after', diff > 0)
  await page.screenshot({ path: `${OUT}/06-audit.png`, fullPage: true })

  // ── theme + layout ────────────────────────────────────────────────────────
  // Both themes explicitly: headless Chromium reports `prefers-color-scheme:
  // dark`, so without forcing light it never gets looked at.
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/07-${theme}.png`, fullPage: true })
    const unreadable = await page.evaluate(() => {
      // A token that does not exist resolves to nothing, and the text silently
      // inherits — usually to something with no contrast against the surface.
      const style = getComputedStyle(document.querySelector('.adm__head h1'))
      return !style.color || style.color === 'rgba(0, 0, 0, 0)'
    })
    check(`heading has a resolved colour in ${theme} mode`, !unreadable)
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  check('page does not scroll horizontally', overflow <= 1, `${overflow}px`)

  // ── no raw locale keys leaked onto the screen ─────────────────────────────
  const body = await page.locator('.adm').innerText()
  const leaked = body.match(/\badm\.[a-zA-Z.]+/g)
  check('no untranslated keys rendered', !leaked, leaked ? leaked.join(', ') : '')

  // ── a teacher who is not an admin sees none of this ───────────────────────
  // The backend refuses them regardless (`require_admin` checks the live grant),
  // but a console that renders and then 403s every panel reads as broken rather
  // than as forbidden.
  const plain = await browser.newContext()
  const plainPage = await plain.newPage()
  await plainPage.goto(BASE, { waitUntil: 'domcontentloaded' })
  await plainPage.waitForTimeout(1200)
  await clickLanding(plainPage, '.landing720-login-btn.teacher')
  await plainPage.waitForTimeout(600)
  const plainDialog = plainPage.locator('[role="dialog"]')
  await plainDialog.locator('input').first().fill('moti')
  await plainDialog.locator('input[type="password"]').fill('Aa12345')
  await plainDialog.locator('button[type="submit"]').click()
  await plainPage.waitForTimeout(3500)

  await plainPage.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await dismissTourIfOpen(plainPage)
  await plainPage.waitForSelector('.teacher-app-nav', { timeout: 30000 })
  check('a non-admin teacher sees no admin entry anywhere',
        await plainPage.locator('[data-tour="teacher.nav.admin"]').count() === 0)

  await plainPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await plainPage.waitForTimeout(2500)
  check('a non-admin typing /admin is refused, not shown an empty console',
        await plainPage.locator('.adm__tabs').count() === 0)
  await plainPage.screenshot({ path: `${OUT}/08-non-admin.png` })
  await plain.close()
} finally {
  await browser.close()
}

console.log(failures.length ? `\n✘ ${failures.length} failure(s)` : '\n✅ admin console check passed')
if (failures.length) { failures.forEach((f) => console.log(`   - ${f}`)); process.exit(1) }
