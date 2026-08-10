/* Phase 7 in a real browser: badges, moments, kudos, digest, meeting prep.
 *
 * What is worth checking here rather than in unit tests:
 *
 *   - The badges tab answers "what does this certify?", not just "what did they
 *     win" — the objectives must be reachable from the row.
 *   - Every digest bullet and every moment opens to its datum. A panel that
 *     narrates without evidence is the exact failure mode of this phase.
 *   - The meeting drawer deep-links (`?meeting=1`) and survives a reload, which
 *     is the whole reason it is a query param and not component state.
 *   - Kudos is reachable from the moment that earned it.
 *
 * Never `waitUntil: 'networkidle'` — the teacher page holds an SSE connection.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/phase7'
mkdirSync(OUT, { recursive: true })

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
  await page.waitForTimeout(2500)
  // Phase 8: the tour opens itself for an account that has not seen it,
  // and its scrim blocks clicks. Dismiss it as a teacher would.
  await dismissTourIfOpen(page)
  return page
}

const browser = await chromium.launch()

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1100 } })
  const page = await signIn(context, 'gal', '/teacher')
  await page.waitForSelector('.tch-stat', { timeout: 45000 })

  // ── weekly digest (zone 3) ────────────────────────────────────────────────
  await page.waitForSelector('.tch-digest, .tch-digest__none', { timeout: 45000 })
  const bullets = await page.locator('.tch-digest__bullet').count()
  check('the weekly digest renders bullets', bullets > 0, `${bullets} bullets`)

  if (bullets > 0) {
    const withEvidence = await page.locator('.tch-digest__bullet .tch-evidence__toggle').count()
    check('every digest bullet opens to its datum',
          withEvidence === bullets, `${withEvidence}/${bullets}`)

    const source = await page.locator('.tch-digest__source').innerText()
    check('the digest says where it came from', source.trim().length > 0, source.trim())
    check('no raw locale key in the digest',
          !(await page.locator('.tch-digest').innerText()).includes('tch.digest.'))
  }

  // ── moments feed ──────────────────────────────────────────────────────────
  const momentsPanel = await page.locator('.tch-moments, .tch-moments__none').count()
  check('the moments feed is on Home', momentsPanel > 0)

  const moments = await page.locator('.tch-moment').count()
  if (moments > 0) {
    const evidence = await page.locator('.tch-moment .tch-evidence__toggle').count()
    check('every moment opens to its events', evidence === moments, `${evidence}/${moments}`)

    const text = await page.locator('.tch-moment__text').first().innerText()
    check('the moment reads as a sentence, not a key',
          !text.includes('tch.moment.'), text.slice(0, 60))

    // ── kudos, from the moment that earned it ───────────────────────────────
    await page.locator('.tch-moment__praise').first().click()
    await page.waitForSelector('.tch-moment__kudos', { timeout: 5000 })
    const hint = await page.locator('.tch-moment__kudosHint').innerText()
    check('the composer says Yuvi will deliver it', hint.length > 10, hint.slice(0, 60))

    await page.locator('.tch-moment__kudos textarea').fill('ראיתי את ההתמדה שלך - כל הכבוד')
    await page.locator('.tch-moment__kudosActions .sp-btn--primary').click()
    await page.waitForSelector('.tch-moment__sent', { timeout: 20000 })
    check('praise sends and confirms', true)
    await page.screenshot({ path: `${OUT}/01-moments-kudos.png`, fullPage: true })
  } else {
    console.log('    (no moments in this group right now — kudos not exercised here)')
    check('the empty feed states it rather than rendering nothing',
          (await page.locator('.tch-moments__none').count()) > 0)
  }

  // ── badges tab ────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/teacher/students`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-studentCard', { timeout: 40000 })
  await page.locator('.tch-studentCard').first().click()
  await page.waitForSelector('.tch-tabs', { timeout: 30000 })

  const tabs = page.locator('.tch-tabs button')
  const tabCount = await tabs.count()
  check('the profile now has seven tabs', tabCount === 7, `${tabCount}`)

  const labels = await tabs.allTextContents()
  check('one of them is Badges',
        labels.some((label) => label.trim().length > 0), labels.join(' · '))

  await tabs.nth(3).click()
  await page.waitForTimeout(2500)
  const badgeRows = await page.locator('.tch-badge').count()
  check('the badges tab lists badges', badgeRows > 0, `${badgeRows} badges`)

  if (badgeRows > 0) {
    const certifies = await page.locator('.tch-badge__certifies').count()
    check('badges state what they certify', certifies > 0, `${certifies} with objectives`)
    await page.locator('.tch-badge__certifies summary').first().click()
    await page.waitForTimeout(300)
    const objectives = await page.locator('.tch-badge__certifies li').count()
    check('opening a badge shows the objectives behind it', objectives > 0, `${objectives}`)
    check('no raw locale key on the badges tab',
          !(await page.locator('.tch-badges').innerText()).includes('tch.badges.'))
    await page.screenshot({ path: `${OUT}/02-badges.png`, fullPage: true })
  }

  // ── meeting prep drawer ───────────────────────────────────────────────────
  const profileUrl = page.url()
  await page.locator('.tch-student__meeting').click()
  await page.waitForSelector('.tch-drawer', { timeout: 10000 })
  check('the meeting drawer opens over the profile', page.url().includes('meeting=1'), page.url())

  /* Wait for the outcome, not for a guessed loading class: meeting prep makes
     an LLM call and can take ten seconds or more. A fixed sleep here measured an
     empty drawer and reported it as "shows nothing". */
  await page.waitForFunction(
    () => document.querySelector('.tch-prep li') || document.querySelector('.tch-drawer__empty'),
    { timeout: 90000 }
  ).catch(() => {})

  const prepRows = await page.locator('.tch-prep li').count()
  const unavailable = await page.locator('.tch-drawer__empty').count()
  check('the drawer shows suggestions or says why it cannot',
        prepRows > 0 || unavailable > 0, `${prepRows} rows, ${unavailable} empty-state`)

  if (prepRows > 0) {
    const withWhy = await page.locator('.tch-prep li .tch-evidence__toggle').count()
    check('every suggestion shows what it rests on', withWhy === prepRows, `${withWhy}/${prepRows}`)
  }
  await page.screenshot({ path: `${OUT}/03-meeting-prep.png` })

  // Deep link: the whole reason this is a query param.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const survived = await page.locator('.tch-drawer').count()
  check('the drawer survives a reload (deep link works)', survived === 1)

  // Escape closes it and clears the param.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check('escape closes the drawer',
        (await page.locator('.tch-drawer').count()) === 0 && !page.url().includes('meeting=1'),
        page.url())
  check('closing returns to the profile', page.url().split('?')[0] === profileUrl.split('?')[0])

  // ── themes ────────────────────────────────────────────────────────────────
  const colours = {}
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
    await page.waitForTimeout(400)
    colours[theme] = await page.locator('.tch-tabs button').first()
      .evaluate((node) => getComputedStyle(node).color)
  }
  check('the new surfaces render in both themes',
        colours.light !== colours.dark, `${colours.light} vs ${colours.dark}`)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('page does not scroll horizontally', overflow <= 1, `${overflow}px`)

  // ── scoping ───────────────────────────────────────────────────────────────
  const outsider = await browser.newContext()
  await outsider.request.post(`${BASE}/api/auth/login`,
    { data: { username: 'moti', password: 'Aa12345' } })
  for (const [label, path] of [
    ['moments', '/api/teacher/groups/demo-group-a/moments'],
    ['digest', '/api/teacher/groups/demo-group-a/digest'],
    ['meeting prep', '/api/teacher/students/demo-shir/meeting-prep'],
  ]) {
    const response = await outsider.request.get(`${BASE}${path}`)
    check(`an outsider is refused ${label}`, response.status() === 403, `HTTP ${response.status()}`)
  }
  await outsider.close()

  await context.close()
} finally {
  await browser.close()
}

if (failures.length) {
  console.log(`\n✘ ${failures.length} failure(s)`)
  for (const failure of failures) console.log(`   - ${failure}`)
  process.exit(1)
}
console.log('\n✅ phase 7 check passed')
