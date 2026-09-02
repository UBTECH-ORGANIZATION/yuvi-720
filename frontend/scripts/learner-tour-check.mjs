/* The learner's first-run tour in a real browser.
 *
 * What is only checkable here:
 *
 *   - **Yuvi actually flies.** The whole feature is that he travels between
 *     panels. A guide that renders once and never moves passes every unit test
 *     there is, so this compares his transform between steps and fails if it
 *     does not change.
 *   - **The sweep goes down the page.** The steps are ordered to read like the
 *     dashboard reads; if a target moves, the spotlight starts jumping around
 *     and nothing else notices.
 *   - **The studio is spotlit, never entered.** It is a lazy Three.js route
 *     behind an overlay that takes over the URL — a tour that walks into it
 *     hands its own navigation away mid-flight.
 *   - **There is only ever one Yuvi.** The dock stands its avatar down while
 *     the guide is up, and takes over again on the landing step.
 *   - **Completion persists server-side.** Reload and it must not reopen — the
 *     whole reason it is a preference and not localStorage.
 *
 * Never `waitUntil: 'networkidle'` — the learner shell holds an SSE connection.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dismissCheckin } from './lib/checkin.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/learner-tour'
const LEARNER = 'gal'
const TOUR = 'learner.v1'
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/* Put the account back to "has never seen the tour" so the run is repeatable.
   Out of band on purpose: the PATCH lane is union-only and must stay that way,
   so there is deliberately no endpoint that un-completes a tour.
   The venv interpreter, not whatever `python` happens to be on PATH — the
   script imports the backend's own packages. */
const resetTour = () => {
  execFileSync('./.venv/bin/python', ['scripts/reset_tour.py', LEARNER, TOUR],
               { cwd: '../backend', stdio: 'pipe' })
}

const guideTransform = (page) => page.evaluate(() => {
  const outer = document.querySelector('.sp-tour__guide')
  const lift = document.querySelector('.sp-tour__guide-lift')
  if (!outer || !lift) return null
  return `${getComputedStyle(outer).transform}|${getComputedStyle(lift).transform}`
})

/* Document position of the spotlit panel, and which panel it is.
   Document, not viewport: every step scrolls its target to the middle of the
   screen, so the cutout's own `y` is roughly the same number on every step and
   comparing those would "prove" the sweep whatever order the steps were in. */
const spotlight = (page) => page.evaluate(() => {
  const hole = document.querySelector('.sp-tour__hole')
  if (!hole) return null
  const x = Number(hole.getAttribute('x'))
  const y = Number(hole.getAttribute('y'))
  const hit = [...document.querySelectorAll('[data-tour]')].find((node) => {
    const box = node.getBoundingClientRect()
    return Math.abs(box.left - x) < 24 && Math.abs(box.top - y) < 24
  })
  return {
    name: hit?.getAttribute('data-tour') ?? null,
    top: (document.scrollingElement?.scrollTop ?? 0) + y,
  }
})

/* Only the panels that sit in the page's own flow. The app bar is fixed, so
   `scrollTop + y` says nothing about where it is in the document — including
   those readings was comparing two different coordinate systems. */
const IN_FLOW = ['learner.hero', 'learner.activeness', 'learner.subjects', 'learner.goals']

/* Wait for the spotlight to arrive AND stop moving. It is deliberately withheld
   until the page finishes scrolling to the section, so "no cutout yet" means
   still travelling, not finished — but the tour ending also means no cutout,
   hence the card check first. */
const settle = (page) => page.waitForFunction(() => {
  if (!document.querySelector('.sp-tour__card')) return true
  const hole = document.querySelector('.sp-tour__hole')
  if (!hole) return false
  const now = `${hole.getAttribute('x')},${hole.getAttribute('y')},${hole.getAttribute('width')}`
  const stable = window.__tourLast === now
  window.__tourLast = now
  return stable
}, undefined, { timeout: 20000, polling: 400 }).catch(() => {})

const next = async (page) => {
  await page.locator('.sp-tour__actions .sp-btn--primary').click()
  await page.waitForTimeout(700)
  await settle(page)
}

const browser = await chromium.launch()

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const login = await context.request.post(`${BASE}/api/auth/login`,
    { data: { username: LEARNER, password: 'Aa12345' } })
  if (!login.ok()) throw new Error(`login failed for ${LEARNER}: ${login.status()}`)
  /* Establish the language rather than assuming it: an aborted earlier run can
     leave the account in English, and the RTL assertion below would then fail
     for a reason that has nothing to do with the tour. */
  await context.request.patch(`${BASE}/api/auth/preferences`,
    { data: { language: 'he' }, failOnStatusCode: false })
  resetTour()

  const page = await context.newPage()
  await page.goto(`${BASE}/student-dashboard`, { waitUntil: 'domcontentloaded' })

  // ── auto-start on first arrival ───────────────────────────────────────────
  const opened = await page.waitForSelector('.sp-tour__card', { timeout: 45000 })
    .then(() => true).catch(() => false)
  check('the tour opens by itself on a first dashboard visit', opened)
  if (!opened) throw new Error('tour never opened — nothing else is meaningful')

  const welcome = await page.locator('.sp-tour__card').innerText()
  check('no raw locale key in the tour', !welcome.includes('tour.'))
  check('no unresolved name slot — Yuvi greets a real child',
        !welcome.includes('{name}'), welcome.split('\n')[0])
  check('the welcome step dims the whole screen',
        (await page.locator('.sp-tour__halo').count()) === 0)

  // ── a child cannot walk out of their first run ───────────────────────────
  check('there is no skip button', (await page.locator('.sp-tour__skip').count()) === 0)
  check('there is no close button', (await page.locator('.sp-tour__close').count()) === 0)

  /* The offer is what happens once, not the completion. Recorded here, while
     the tour is still on step one, so that a child who closes the tab is not
     greeted with it again on every login until they sit through the whole
     thing — which is the exact "it shows every time" failure this guards. */
  await page.waitForTimeout(1200)
  const atOpen = await context.request.get(`${BASE}/api/auth/me`).then((r) => r.json())
  check('it is recorded as seen the moment it opens, not when it ends',
        (atOpen.user?.preferences?.tours_completed ?? []).includes(TOUR),
        JSON.stringify(atOpen.user?.preferences?.tours_completed))

  /* And the hard one: a learner who abandons it mid-way must not be offered it
     again. A second context is a genuinely fresh session — new cookie jar, new
     memory — so nothing but the server can be answering. */
  const abandoned = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const relogin = await abandoned.request.post(`${BASE}/api/auth/login`,
    { data: { username: LEARNER, password: 'Aa12345' } })
  check('a second sign-in works', relogin.ok())
  const second = await abandoned.newPage()
  await second.goto(`${BASE}/student-dashboard`, { waitUntil: 'domcontentloaded' })
  await second.waitForSelector('.sd-page', { timeout: 45000 }).catch(() => {})
  await second.waitForTimeout(5000)
  check('signing in again does NOT reopen the tour, even though it was abandoned',
        (await second.locator('.sp-tour__card').count()) === 0)
  await abandoned.close()

  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check('escape does not close it',
        (await page.locator('.sp-tour__card').count()) === 1)

  // A click on the dimmed page is a stray click, not a decision to leave.
  await page.locator('.sp-tour__overlay').click({ position: { x: 8, y: 8 } }).catch(() => {})
  await page.waitForTimeout(500)
  check('clicking the scrim does not close it',
        (await page.locator('.sp-tour__card').count()) === 1)

  // ── Yuvi is on stage, and the dock has stood down ────────────────────────
  check('Yuvi is flying the tour', (await page.locator('.sp-tour__guide').count()) === 1)
  /* Asserted on the avatar, not on a class: the dock deliberately stays visible
     and pressable during a tour (the lesson tour spotlights it and asks the
     child to open the chat), so "stood down" means its 3D Yuvi is unmounted —
     not that the whole dock is hidden. */
  const dockHidden = await page.evaluate(() => {
    const dock = document.querySelector('.Yuvi-companion-dock')
    if (!dock) return true
    if (dock.classList.contains('is-away')) return true
    return dock.querySelectorAll('canvas').length === 0
  })
  check('the dock stands its own Yuvi down, so there is only ever one', dockHidden)
  check('and only one WebGL canvas is alive',
        (await page.locator('.Yuvi-companion-dock canvas').count()) === 0)
  await page.screenshot({ path: `${OUT}/01-welcome.png` })

  // ── he actually travels ──────────────────────────────────────────────────
  const atWelcome = await guideTransform(page)
  await next(page)
  const atFirstPanel = await guideTransform(page)
  check('Yuvi moves from the welcome pose to the first panel',
        Boolean(atWelcome) && atWelcome !== atFirstPanel)
  await page.screenshot({ path: `${OUT}/02-first-panel.png` })

  // ── the spotlight lands on a real element ────────────────────────────────
  const aligned = await page.evaluate(() => {
    const hole = document.querySelector('.sp-tour__hole')
    if (!hole) return { ok: false, why: 'no cutout rendered' }
    const x = Number(hole.getAttribute('x')), y = Number(hole.getAttribute('y'))
    const w = Number(hole.getAttribute('width')), h = Number(hole.getAttribute('height'))
    if (w < 40 || h < 20) return { ok: false, why: `cutout is ${w}x${h} — collapsed` }
    const hit = [...document.querySelectorAll('[data-tour]')].find((node) => {
      const box = node.getBoundingClientRect()
      return Math.abs(box.left - x) < 24 && Math.abs(box.top - y) < 24
           && Math.abs(box.width - w) < 48 && Math.abs(box.height - h) < 48
    })
    return hit
      ? { ok: true, why: `${hit.getAttribute('data-tour')} @ ${Math.round(w)}x${Math.round(h)}` }
      : { ok: false, why: `cutout ${Math.round(x)},${Math.round(y)} matches no element` }
  })
  check('the spotlight sits exactly on a real panel', aligned.ok, aligned.why)

  check('the scrim swallows clicks so a child cannot wander off mid-tour',
        await page.evaluate(() => {
          const overlay = document.querySelector('.sp-tour__overlay')
          return overlay ? getComputedStyle(overlay).pointerEvents !== 'none' : false
        }))

  // ── walk the rest, watching where it goes ────────────────────────────────
  const transforms = new Set([atWelcome, atFirstPanel])
  const routesSeen = new Set([new URL(page.url()).pathname])
  const dashboardTops = []
  const hidden = []
  let steps = 2

  /* Yuvi is one layer BELOW the card, so a step where the two boxes overlap is
     a step where he is simply not there. That is what happened near the bottom
     of the page: the card flips when it runs out of room, and he was parking
     opposite the side the step ASKED for rather than the side it took. */
  const guideState = () => page.evaluate(() => {
    const guide = document.querySelector('.sp-tour__guide-bob')
    const card = document.querySelector('.sp-tour__card')
    if (!guide || !card) return null
    const g = guide.getBoundingClientRect()
    const c = card.getBoundingClientRect()
    return {
      onScreen: g.left >= -1 && g.top >= -1
        && g.right <= window.innerWidth + 1 && g.bottom <= window.innerHeight + 1,
      behindCard: !(g.right < c.left || g.left > c.right
        || g.bottom < c.top || g.top > c.bottom),
    }
  })

  for (let i = 0; i < 30; i += 1) {
    if (!(await page.locator('.sp-tour__card').count())) break
    if (new URL(page.url()).pathname === '/student-dashboard') {
      const spot = await spotlight(page)
      if (spot && IN_FLOW.includes(spot.name)) dashboardTops.push(spot)
    }
    const state = await guideState()
    if (state && (!state.onScreen || state.behindCard)) {
      hidden.push(`step ${steps}${state.behindCard ? ' behind the card' : ' off screen'}`)
    }
    await next(page)
    routesSeen.add(new URL(page.url()).pathname)
    const now = await guideTransform(page)
    if (now) transforms.add(now)
    steps += 1
  }

  check('Yuvi stays visible on every step, never behind the card or off screen',
        hidden.length === 0, hidden.join(' · '))
  check('the tour finishes rather than getting stuck', steps < 30, `${steps} steps`)
  check('Yuvi holds a different position on each panel, not one parked pose',
        transforms.size >= 4, `${transforms.size} distinct positions`)
  check('it crosses to the badges', routesSeen.has('/badges'), [...routesSeen].join(' · '))
  check('it never walks into the studio',
        ![...routesSeen].some((path) => path.startsWith('/yuvi-studio')),
        [...routesSeen].join(' · '))
  check('the overlay is gone once it ends',
        (await page.locator('.sp-tour__overlay').count()) === 0)

  /* The in-flow dashboard steps are ordered to read like the page reads. The
     hero and the activeness map share a row, so equal positions are expected —
     what must never happen is going back UP the page. */
  const wentBackUp = dashboardTops.slice(0, -1)
    .filter((spot, i) => spot.top > dashboardTops[i + 1].top + 8)
  check('the dashboard sweep never doubles back up the page',
        dashboardTops.length >= 3 && wentBackUp.length === 0,
        dashboardTops.map((s) => `${s.name}@${Math.round(s.top)}`).join(' → '))

  // ── the dock takes Yuvi back at the end ──────────────────────────────────
  const dockBack = await page.evaluate(() => {
    const dock = document.querySelector('.Yuvi-companion-dock')
    return Boolean(dock) && !dock.classList.contains('is-away')
  })
  check('the dock has Yuvi back once the tour ends', dockBack)

  // ── completion is server-side ────────────────────────────────────────────
  const me = await context.request.get(`${BASE}/api/auth/me`).then((r) => r.json())
  check('completion is stored on the user, not in the browser',
        (me.user?.preferences?.tours_completed ?? []).includes(TOUR),
        JSON.stringify(me.user?.preferences?.tours_completed))

  await page.goto(`${BASE}/student-dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sd-page', { timeout: 45000 })
  await dismissCheckin(page)
  await page.waitForTimeout(2000)
  check('it does not reopen after a reload',
        (await page.locator('.sp-tour__card').count()) === 0)

  // A fresh tab is the real test of "not localStorage".
  const fresh = await context.newPage()
  await fresh.goto(`${BASE}/student-dashboard`, { waitUntil: 'domcontentloaded' })
  await fresh.waitForTimeout(4000)
  check('it does not reopen in a new tab either',
        (await fresh.locator('.sp-tour__card').count()) === 0)
  await fresh.close()

  // ── replay from the account menu ─────────────────────────────────────────
  await page.locator('.user-menu__trigger').click()
  await page.locator('.user-menu__pop [role="menuitem"]', { hasText: /סיור/ }).first().click()
  const replayed = await page.waitForSelector('.sp-tour__card', { timeout: 15000 })
    .then(() => true).catch(() => false)
  check('the account menu restarts it after it was completed', replayed)

  // ── keyboard, and RTL ────────────────────────────────────────────────────
  check('the learner app is RTL in Hebrew',
        (await page.evaluate(() => document.documentElement.dir)) === 'rtl')

  const firstTitle = await page.locator('.sp-tour__cardHead h2').innerText()
  // Derived, not assumed: the forward key points the way the text runs.
  const isRtl = (await page.evaluate(() => document.documentElement.dir)) === 'rtl'
  await page.keyboard.press(isRtl ? 'ArrowLeft' : 'ArrowRight')
  await page.waitForTimeout(900)
  check('the forward arrow follows reading direction',
        (await page.locator('.sp-tour__cardHead h2').innerText()) !== firstTitle)

  for (let i = 0; i < 3; i += 1) {
    const box = await page.locator('.sp-tour__card').boundingBox()
    const viewport = page.viewportSize()
    const inside = box && box.x >= -1 && box.y >= -1
      && box.x + box.width <= viewport.width + 1
      && box.y + box.height <= viewport.height + 1
    check(`step ${i + 2}: the card is fully on screen (RTL)`, Boolean(inside),
          box ? `${Math.round(box.x)},${Math.round(box.y)}` : 'no card')

    const guide = await page.locator('.sp-tour__guide-bob').boundingBox()
    const guideInside = !guide || (guide.x > -guide.width && guide.y > -guide.height
      && guide.x < viewport.width && guide.y < viewport.height)
    check(`step ${i + 2}: Yuvi is on screen, not parked off the edge`, guideInside)
    await next(page)
  }
  await page.screenshot({ path: `${OUT}/03-rtl.png` })

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('the tour does not push the page sideways', overflow <= 1, `${overflow}px`)

  // ── the door to the medals: the child clicks, the tour follows ───────────
  /* The badges live behind the avatar menu, so this step asks for a real
     navigation instead of teleporting. Two things have to hold: the step must
     not drag them back to the dashboard the instant they click, and reaching
     /badges must advance the tour on its own — without touching Next. */
  const onDoor = () => page.evaluate(() => {
    const hole = document.querySelector('.sp-tour__hole')
    const trigger = document.querySelector('[data-tour="learner.profileMenu"]')
    if (!hole || !trigger) return false
    const box = trigger.getBoundingClientRect()
    return Math.abs(box.left - Number(hole.getAttribute('x'))) < 24
        && Math.abs(box.top - Number(hole.getAttribute('y'))) < 24
  })

  let reachedDoor = false
  for (let i = 0; i < 20; i += 1) {
    if (!(await page.locator('.sp-tour__card').count())) break
    if (await onDoor()) { reachedDoor = true; break }
    await next(page)
  }
  check('the tour stops on the profile picture to hand over the click', reachedDoor)

  if (reachedDoor) {
    const titleAtDoor = await page.locator('.sp-tour__cardHead h2').innerText()
    await page.locator('[data-tour="learner.profileMenu"]').click()
    await page.waitForSelector('.user-menu__pop', { timeout: 8000 }).catch(() => {})
    check('the interactive step lets the click through to the menu',
          (await page.locator('.user-menu__pop').count()) === 1)

    await page.locator('.user-menu__pop [role="menuitem"]').first().click().catch(() => {})
    await page.waitForTimeout(1500)
    check('the child\'s own click reaches the badges',
          new URL(page.url()).pathname === '/badges', page.url())
    check('and the tour moved on by itself, without Next',
          (await page.locator('.sp-tour__cardHead h2').innerText()
            .catch(() => '')) !== titleAtDoor)
  }

  // Finish it properly: there is no way out but the end.
  for (let i = 0; i < 10; i += 1) {
    if (!(await page.locator('.sp-tour__card').count())) break
    await next(page)
  }
  check('the tour can be completed a second time',
        (await page.locator('.sp-tour__overlay').count()) === 0)
  check('and Yuvi goes back to his dock',
        await page.evaluate(() => {
          const dock = document.querySelector('.Yuvi-companion-dock')
          return Boolean(dock) && !dock.classList.contains('is-away')
        }))
} finally {
  await browser.close()
}

console.log(failures.length ? `\n✘ ${failures.length} failed` : '\n✔ all good')
process.exit(failures.length ? 1 : 0)
