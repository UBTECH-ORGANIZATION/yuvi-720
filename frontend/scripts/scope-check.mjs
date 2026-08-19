/* The scope control after "never hide, never silently ignore". */
import { chromium } from 'playwright'
const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = '/private/tmp/claude-501/-Users-glswht-Desktop-yuvi-720-yuvi-720/c9c038b1-e822-4e65-995a-55d31eba6bcd/scratchpad/shots'
const fail = []
const check = (l, ok, d = '') => { console.log(`${ok ? '  ✔' : '  ✘'} ${l}${d ? ` — ${d}` : ''}`); if (!ok) fail.push(l) }
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1500, height: 950 } })
page.on('pageerror', (e) => fail.push(`pageerror: ${e.message}`))
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.landing720-login-btn.teacher', { timeout: 45000 })
  await page.locator('.landing720-login-btn.teacher').click({ timeout: 20000 })
  await page.waitForTimeout(700)
  const d = page.locator('[role="dialog"]')
  await d.locator('input').first().fill('demo-teacher-1')
  await d.locator('input[type="password"]').fill('Aa12345')
  await d.locator('button[type="submit"]').click()
  await page.waitForSelector('.tch-stat', { timeout: 40000 })
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(1200)

  // ── the control is on every screen, including the ones that ignore it ────
  const routes = ['/teacher', '/teacher/students', '/teacher/learnings', '/teacher/tasks',
                  '/teacher/calendar', '/teacher/messages', '/teacher/goals',
                  '/teacher/student/demo-ari']
  const present = {}
  for (const r of routes) {
    await page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1800)
    present[r] = await page.locator('.tch-scope').count()
  }
  check('the control is on every teacher screen', Object.values(present).every((n) => n === 1),
        JSON.stringify(present))

  // ── set a subject from Home, where Home cannot use it ───────────────────
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-stat', { timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.locator('.tch-scope__trigger').click()
  await page.waitForSelector('.tch-scope__pop')
  const legends = await page.locator('.tch-scope__legend').allInnerTexts()
  check('Home offers the subject even though Home ignores it', legends.includes('מקצוע'),
        legends.join(' | '))
  await page.locator('.tch-scope__option', { hasText: 'מתמטיקה' }).first().click()
  await page.waitForTimeout(1200)
  check('the chip is lit', await page.locator('.tch-scope__chip').count() === 1)
  const notice = await page.locator('.tch-scopeNotice').innerText().catch(() => '')
  check('and Home says it does not use it', notice.includes('מקצוע'), JSON.stringify(notice))
  await page.screenshot({ path: `${OUT}/V-home-notice.png`, clip: { x: 500, y: 0, width: 1000, height: 260 } })

  // ── the learnings chip is already lit when you arrive ────────────────────
  await page.goto(`${BASE}/teacher/learnings`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-learnings__filters .tch-chip', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const lit = await page.locator('.tch-learnings__filters .tch-chip.is-on').allInnerTexts()
  check('arriving at learnings lights the subject chip automatically',
        lit.includes('מתמטיקה'), lit.join(' | '))
  check('and learnings does NOT print a subject notice (it narrows by it)',
        !(await page.locator('.tch-scopeNotice').innerText().catch(() => '')).includes('מקצוע'))
  await page.screenshot({ path: `${OUT}/V-learnings.png`, clip: { x: 500, y: 0, width: 1000, height: 420 } })

  // clicking a chip on the page updates the bar
  await page.locator('.tch-learnings__filters .tch-chip', { hasText: 'מדעים' }).first().click()
  await page.waitForTimeout(900)
  check('and clicking a chip there updates the bar',
        (await page.locator('.tch-scope__chip').innerText()).includes('מדעים'),
        await page.locator('.tch-scope__chip').innerText())

  // ── the tasks row is the same filter ────────────────────────────────────
  await page.goto(`${BASE}/teacher/tasks`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  check('the tasks screen carries the same subject',
        (await page.locator('.tch-scope__chip').innerText().catch(() => '')).includes('מדעים'))

  // ── the profile: class shown, switching would leave for the roster ──────
  await page.goto(`${BASE}/teacher/student/demo-ari`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  check('the profile shows the class as well as the subject',
        (await page.locator('.tch-scope__class').innerText()).includes('כיתה'),
        await page.locator('.tch-scope').innerText())
  await page.screenshot({ path: `${OUT}/V-profile.png`, clip: { x: 500, y: 0, width: 1000, height: 200 } })

  check('no page errors', fail.filter((f) => f.startsWith('pageerror')).length === 0)
} catch (e) {
  fail.push(`threw: ${e.message}`)
} finally { await b.close() }
console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall good')
process.exit(fail.length ? 1 : 0)
