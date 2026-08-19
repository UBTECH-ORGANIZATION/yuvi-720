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
  /* A previous run may have died mid-way with a filter persisted — this whole
     script asserts from a quiet bar, so it starts by saying so. */
  await page.evaluate(async () => {
    await fetch('/api/auth/preferences', { method: 'PATCH', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teacher_subject: null, teacher_subgroup_id: null }) })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
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
  const segs = await page.locator('.tch-scope__value').allInnerTexts()
  check('every dimension is visible on the bar without opening anything',
        segs.some((v) => v.includes('כל המקצועות')), segs.join(' | '))
  await page.keyboard.press('Escape')
  await page.locator('.tch-scope__seg', { hasText: 'כל המקצועות' })
    .locator('.tch-scope__trigger').click()
  await page.waitForSelector('.tch-scope__pop')
  await page.locator('.tch-scope__option', { hasText: 'מתמטיקה' }).first().click()
  await page.waitForTimeout(1200)
  check('the subject segment now reads the subject, on the bar itself',
        (await page.locator('.tch-scope__seg.is-narrowed .tch-scope__value').innerText())
          .includes('מתמטיקה'))
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
        (await page.locator('.tch-scope__seg.is-narrowed .tch-scope__value').innerText())
          .includes('מדעים'))

  // ── the tasks row is the same filter ────────────────────────────────────
  await page.goto(`${BASE}/teacher/tasks`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  check('the tasks screen carries the same subject',
        (await page.locator('.tch-scope__seg.is-narrowed .tch-scope__value').innerText()
           .catch(() => '')).includes('מדעים'))

  // ── the profile: class shown, switching would leave for the roster ──────
  await page.goto(`${BASE}/teacher/student/demo-ari`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  check('the profile shows the class as well as the subject',
        (await page.locator('.tch-scope__value').first().innerText()).includes('כיתה'),
        await page.locator('.tch-scope').innerText())
  await page.screenshot({ path: `${OUT}/V-profile.png`, clip: { x: 500, y: 0, width: 1000, height: 200 } })

  // ── the sub-group, end to end ────────────────────────────────────────────
  await page.evaluate(async () => {
    const r = await fetch('/api/teacher/groups/demo-group-a/subgroups', { credentials: 'include' })
    if (!((await r.json()).subgroups || []).length) {
      await fetch('/api/teacher/groups/demo-group-a/subgroups', { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'קבוצת חיזוק', learner_ids: ['demo-shir', 'demo-tal'] }) })
    }
  })
  await page.goto(`${BASE}/teacher/students`, { waitUntil: 'domcontentloaded' })
  // wait for DATA, not chrome: the subgroup cards render before the snapshot.
  await page.waitForSelector('.tch-roster__table tbody tr', { timeout: 30000 })
  const allRows = await page.locator('.tch-roster__table tbody tr').count()
  // pick the sub-group FROM THE BAR, not from the page's cards
  await page.locator('.tch-scope__seg', { hasText: 'כל הכיתה' }).locator('.tch-scope__trigger').click()
  await page.waitForSelector('.tch-scope__pop')
  await page.locator('.tch-scope__option', { hasText: 'חיזוק' }).first().click()
  await page.waitForTimeout(1200)
  const narrowedRows = await page.locator('.tch-roster__table tbody tr').count()
  check('the bar narrows the roster', narrowedRows === 2 && allRows > 2,
        `${allRows} → ${narrowedRows}`)
  check('and the page card lights to match',
        (await page.locator('.tch-subgroup.is-active .tch-subgroup__name').innerText()
          .catch(() => '')).includes('חיזוק'))

  await page.goto(`${BASE}/teacher/goals`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const goalCards = await page.locator('.tch-goalsBoard > *, .tch-goalsPage [class*=card i]').count()
  check('goals narrows to the members', goalCards <= 4, `${goalCards} cards`)

  await page.goto(`${BASE}/teacher/messages`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const rail = await page.locator('.tch-messages__person:not(.tch-messages__person--group)').count()
  check('the messages rail lists only the sub-group', rail === 2, `${rail} people`)

  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-stat', { timeout: 30000 })
  await page.waitForTimeout(800)
  check('Home announces the sub-group it does not apply',
        (await page.locator('.tch-scopeNotice').innerText().catch(() => '')).includes('תת-קבוצה'))

  await page.goto(`${BASE}/teacher/tasks`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  check('the task list announces it too',
        (await page.locator('.tch-scopeNotice').innerText().catch(() => '')).includes('תת-קבוצה'))

  // clear from the bar, roster whole again
  await page.locator('.tch-scope__seg.is-narrowed .tch-scope__clear').first().click()
  await page.waitForTimeout(900)
  await page.goto(`${BASE}/teacher/students`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-roster__table tbody tr', { timeout: 30000 })
  await page.waitForTimeout(600)
  check('clearing restores the whole class',
        (await page.locator('.tch-roster__table tbody tr').count()) === allRows,
        `${await page.locator('.tch-roster__table tbody tr').count()} vs ${allRows}`)

  await page.evaluate(async () => {
    const r = await fetch('/api/teacher/groups/demo-group-a/subgroups', { credentials: 'include' })
    for (const row of (await r.json()).subgroups ?? []) {
      if (row.name === 'קבוצת חיזוק') {
        await fetch(`/api/teacher/subgroups/${row.id}`, { method: 'DELETE', credentials: 'include' })
      }
    }
    await fetch('/api/auth/preferences', { method: 'PATCH', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teacher_subject: null, teacher_subgroup_id: null }) })
  })

  check('no page errors', fail.filter((f) => f.startsWith('pageerror')).length === 0)
} catch (e) {
  fail.push(`threw: ${e.message}`)
} finally { await b.close() }
console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall good')
process.exit(fail.length ? 1 : 0)
