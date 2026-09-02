/* Phase 8 in a real browser: the spotlight tour.
 *
 * What is only checkable here:
 *
 *   - The **cutout actually lands on the target**. Every unit test in the world
 *     will pass while the mask rect sits at 0,0 because the panel measured 0×0
 *     mid-mount. So: compare the mask rect to the target's real bounding box.
 *   - **It crosses routes.** The tour navigates from Home to the roster to a
 *     student profile; a step whose route never resolves must be skipped, not
 *     hang.
 *   - **Completion persists server-side.** Reload and the tour must not reopen —
 *     that is the whole reason it is a preference and not localStorage.
 *   - **RTL.** The card must stay on screen in Hebrew, not slide off the edge.
 *
 * Never `waitUntil: 'networkidle'` — the teacher page holds an SSE connection.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/tour'
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/* Put the account back to "has never seen the tour" so the run is repeatable.
   Out of band on purpose: the PATCH lane is union-only and must stay that way,
   so there is deliberately no endpoint that un-completes a tour.
   The venv interpreter, not PATH's `python` — the script imports backend
   packages, and on a machine without a global `python` this threw ENOENT
   before the check had run a single assertion. */
const resetTour = () => {
  execFileSync('./.venv/bin/python', ['scripts/reset_tour.py', 'gal', 'teacher'],
               { cwd: '../backend', stdio: 'pipe' })
}

const signIn = async (context, username) => {
  const response = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username, password: 'Aa12345' },
  })
  if (!response.ok()) throw new Error(`login failed for ${username}: ${response.status()}`)
}

const browser = await chromium.launch()

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1100 } })
  await signIn(context, 'gal')
  /* Set the language rather than assuming it. The locale sweep at the end of
     this file leaves the account wherever it finished, and an aborted run
     leaves it in English — which then failed the RTL assertions here for a
     reason that had nothing to do with the tour. A check must establish the
     state it depends on. */
  await context.request.patch(`${BASE}/api/auth/preferences`,
    { data: { language: 'he' }, failOnStatusCode: false })
  resetTour()

  const page = await context.newPage()
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })

  // ── auto-start on first arrival ───────────────────────────────────────────
  const opened = await page.waitForSelector('.sp-tour__card', { timeout: 30000 })
    .then(() => true).catch(() => false)
  check('the tour opens by itself on a first teacher visit', opened)
  if (!opened) throw new Error('tour never opened — nothing else is meaningful')

  const title = await page.locator('.sp-tour__cardHead h2').innerText()
  check('it opens on the welcome card, not a data panel', title.length > 0, title)
  check('no raw locale key in the tour',
        !(await page.locator('.sp-tour__card').innerText()).includes('tour.'))
  check('Yuvi presents it', (await page.locator('.sp-tour__yuvi').count()) === 1)

  const total = (await page.locator('.sp-tour__progress').innerText()).trim()
  check('the card says where you are in the tour', /\d/.test(total), total)
  await page.screenshot({ path: `${OUT}/01-welcome.png` })

  // The welcome step is centred, so there must be no cutout yet.
  check('the welcome step dims the whole screen',
        (await page.locator('.sp-tour__halo').count()) === 0)

  // ── the cutout lands on the real element ─────────────────────────────────
  await page.locator('.sp-tour__actions .sp-btn--primary').click()
  /* Wait for the cutout, not for a guessed interval: the card shows immediately
     and the spotlight arrives when the panel finishes fetching. A fixed sleep
     here measured the un-spotlit card and reported "no cutout rendered". */
  await page.waitForSelector('.sp-tour__hole', { timeout: 20000 }).catch(() => {})
  /* And wait for it to stop moving. The cutout transitions between targets and
     re-measures after a smooth scroll settles, so a comparison taken mid-flight
     matches nothing — which is a flaky failure, not a real one. */
  await page.waitForFunction(() => {
    const hole = document.querySelector('.sp-tour__hole')
    if (!hole) return false
    const now = `${hole.getAttribute('x')},${hole.getAttribute('y')},${hole.getAttribute('width')}`
    const stable = window.__tourLast === now
    window.__tourLast = now
    return stable
  }, undefined, { timeout: 20000, polling: 500 }).catch(() => {})

  const aligned = await page.evaluate(() => {
    const hole = document.querySelector('.sp-tour__hole')
    if (!hole) return { ok: false, why: 'no cutout rendered' }
    const x = Number(hole.getAttribute('x')), y = Number(hole.getAttribute('y'))
    const w = Number(hole.getAttribute('width')), h = Number(hole.getAttribute('height'))
    if (w < 40 || h < 20) return { ok: false, why: `cutout is ${w}x${h} — collapsed` }
    // Find whichever spotlit panel it covers and compare centres.
    const targets = [...document.querySelectorAll('[data-tour]')]
    const hit = targets.find((node) => {
      const box = node.getBoundingClientRect()
      return Math.abs(box.left - x) < 24 && Math.abs(box.top - y) < 24
           && Math.abs(box.width - w) < 48 && Math.abs(box.height - h) < 48
    })
    return hit
      ? { ok: true, why: `${hit.getAttribute('data-tour')} @ ${Math.round(w)}x${Math.round(h)}` }
      : { ok: false, why: `cutout ${Math.round(x)},${Math.round(y)} ${Math.round(w)}x${Math.round(h)} matches no element` }
  })
  check('the spotlight sits exactly on a real panel', aligned.ok, aligned.why)
  await page.screenshot({ path: `${OUT}/02-spotlight.png` })

  // ── the overlay blocks the page underneath ───────────────────────────────
  const blocked = await page.evaluate(() => {
    const overlay = document.querySelector('.sp-tour__overlay')
    return overlay ? getComputedStyle(overlay).pointerEvents !== 'none' : false
  })
  check('the scrim swallows clicks so you cannot wander off mid-tour', blocked)

  // ── walk the whole tour ──────────────────────────────────────────────────
  let steps = 1
  const routesSeen = new Set([new URL(page.url()).pathname])
  for (let i = 0; i < 30; i += 1) {
    const card = await page.locator('.sp-tour__card').count()
    if (!card) break
    // A cross-route step navigates and re-measures; give it room.
    await page.locator('.sp-tour__actions .sp-btn--primary').click()
    await page.waitForTimeout(900)
    routesSeen.add(new URL(page.url()).pathname)
    steps += 1
  }
  check('the tour finishes rather than getting stuck', steps < 30, `${steps} steps`)
  check('the tour crosses routes', routesSeen.size >= 2, [...routesSeen].join(' · '))
  check('it reached a student profile',
        [...routesSeen].some((path) => path.startsWith('/teacher/student/')),
        [...routesSeen].join(' · '))
  check('the overlay is gone once it ends',
        (await page.locator('.sp-tour__overlay').count()) === 0)

  // ── completion is server-side ────────────────────────────────────────────
  const me = await context.request.get(`${BASE}/api/auth/me`).then((r) => r.json())
  check('completion is stored on the user, not in the browser',
        (me.user?.preferences?.tours_completed ?? []).includes('teacher'),
        JSON.stringify(me.user?.preferences?.tours_completed))

  // The tour ends on a student profile, so go back to Home before reloading —
  // that is where a returning teacher lands, and where a re-opened tour would
  // be most obvious.
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-stat', { timeout: 45000 })
  await page.waitForTimeout(1500)
  check('it does not reopen after a reload',
        (await page.locator('.sp-tour__card').count()) === 0)

  // A fresh tab is the real test of "not localStorage".
  const fresh = await context.newPage()
  await fresh.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await fresh.waitForTimeout(3000)
  check('it does not reopen in a new tab either',
        (await fresh.locator('.sp-tour__card').count()) === 0)
  await fresh.close()

  // ── restart it by hand ───────────────────────────────────────────────────
  await page.locator('.sp-tour__button').click()
  await page.waitForSelector('.sp-tour__card', { timeout: 10000 })
  check('the app-bar button restarts it after it was completed', true)

  // ── keyboard ─────────────────────────────────────────────────────────────
  const firstTitle = await page.locator('.sp-tour__cardHead h2').innerText()
  // Derived, not assumed: the forward key is the one that points the way the
  // text runs, so it flips with the document direction.
  const isRtl = (await page.evaluate(() => document.documentElement.dir)) === 'rtl'
  await page.keyboard.press(isRtl ? 'ArrowLeft' : 'ArrowRight')
  await page.waitForTimeout(900)
  const secondTitle = await page.locator('.sp-tour__cardHead h2').innerText()
  check('the forward arrow follows reading direction',
        secondTitle !== firstTitle, `${firstTitle} → ${secondTitle}`)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check('escape closes the tour', (await page.locator('.sp-tour__card').count()) === 0)

  // ── RTL: the card must stay on screen ────────────────────────────────────
  resetTour()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sp-tour__card', { timeout: 30000 })
  check('the teacher app is RTL in Hebrew',
        (await page.evaluate(() => document.documentElement.dir)) === 'rtl')

  for (let i = 0; i < 4; i += 1) {
    const box = await page.locator('.sp-tour__card').boundingBox()
    const viewport = page.viewportSize()
    const inside = box && box.x >= -1 && box.y >= -1
      && box.x + box.width <= viewport.width + 1
      && box.y + box.height <= viewport.height + 1
    check(`step ${i + 1}: the card is fully on screen (RTL)`, Boolean(inside),
          box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}` : 'no card')
    await page.locator('.sp-tour__actions .sp-btn--primary').click()
    await page.waitForTimeout(900)
  }
  await page.screenshot({ path: `${OUT}/03-rtl.png` })

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('the tour does not push the page sideways', overflow <= 1, `${overflow}px`)

  // ── themes ───────────────────────────────────────────────────────────────
  const colours = {}
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
    await page.waitForTimeout(400)
    colours[theme] = await page.locator('.sp-tour__card')
      .evaluate((node) => getComputedStyle(node).backgroundColor)
  }
  check('the card renders in both themes', colours.light !== colours.dark,
        `${colours.light} vs ${colours.dark}`)

  // ── every locale, not just the source one ────────────────────────────────
  /* Hebrew is the source language, so it is the one least likely to be wrong.
     Arabic shares its direction but not its text metrics, and English flips the
     layout entirely — a card positioned with `start`/`end` that only ever ran in
     he would hide a mirroring bug in both. */
  for (const [language, expectedDir] of [['ar', 'rtl'], ['en', 'ltr']]) {
    await context.request.patch(`${BASE}/api/auth/preferences`,
      { data: { language }, failOnStatusCode: false })
    resetTour()
    await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
    /* Wait for the language to actually land, not for the card. The app boots in
       Hebrew (the bundled default) and switches once the locale file resolves,
       so reading immediately after the card appears measured the old language
       and reported "en is rtl". `dir` alone cannot tell he from ar — both are
       rtl — so key off `lang`. */
    await page.waitForFunction(
      (expected) => document.documentElement.lang === expected, language, { timeout: 30000 })
    await page.waitForSelector('.sp-tour__card', { timeout: 30000 })

    const dir = await page.evaluate(() => document.documentElement.dir)
    check(`${language}: the app direction is ${expectedDir}`, dir === expectedDir, dir)

    const text = await page.locator('.sp-tour__card').innerText()
    check(`${language}: the tour is translated, not falling back to keys`,
          !text.includes('tour.') && text.trim().length > 20, text.slice(0, 40).replace(/\n/g, ' '))

    // Walk a few steps and keep asserting the card is inside the viewport.
    for (let i = 0; i < 4; i += 1) {
      const box = await page.locator('.sp-tour__card').boundingBox()
      const viewport = page.viewportSize()
      const inside = box && box.x >= -1 && box.y >= -1
        && box.x + box.width <= viewport.width + 1
        && box.y + box.height <= viewport.height + 1
      check(`${language}: step ${i + 1} card is on screen`, Boolean(inside),
            box ? `${Math.round(box.x)},${Math.round(box.y)}` : 'no card')
      const next = page.locator('.sp-tour__actions .sp-btn--primary')
      if (!(await next.count())) break
      await next.click()
      await page.waitForTimeout(900)
    }
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`${language}: no horizontal overflow`, sideways <= 1, `${sideways}px`)
    await page.screenshot({ path: `${OUT}/04-${language}.png` })
  }

  // Back to the source language so the next check starts where it expects to.
  await context.request.patch(`${BASE}/api/auth/preferences`,
    { data: { language: 'he' }, failOnStatusCode: false })

  // ── the server rejects a made-up tour ────────────────────────────────────
  const bogus = await context.request.patch(`${BASE}/api/auth/preferences`, {
    data: { tours_completed: ['not-a-real-tour'] }, failOnStatusCode: false,
  })
  check('an unknown tour slug is refused', bogus.status() === 400, `HTTP ${bogus.status()}`)

  // Leave the account as a teacher who has seen the tour, so the other browser
  // checks are not blocked by an overlay they know nothing about.
  await context.request.patch(`${BASE}/api/auth/preferences`,
    { data: { tours_completed: ['teacher'] }, failOnStatusCode: false })

  await context.close()
} finally {
  await browser.close()
}

if (failures.length) {
  console.log(`\n✘ ${failures.length} failure(s)`)
  for (const failure of failures) console.log(`   - ${failure}`)
  process.exit(1)
}
console.log('\n✅ tour check passed')
