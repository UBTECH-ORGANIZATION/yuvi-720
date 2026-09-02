/* The first-lesson tour in a real browser.
 *
 * What only a browser can answer here:
 *
 *   - **It waits for a lesson, not a URL.** The tour is gated on the session
 *     event, so it must not fire over the loading state. Unit tests cannot see
 *     the difference between "on the lesson route" and "the lesson opened".
 *   - **The child's own press moves it on.** The `door` step hands over the
 *     click and advances on `awaitTarget` when the panel appears — the panel
 *     equivalent of the dashboard tour's badges door, and new engine code.
 *   - **There is still only one Yuvi.** The open chat panel renders its own
 *     3D avatar in lesson mode, so this tour can put two live WebGL robots on
 *     one screen in a way the dashboard tour never could.
 *   - **It never leaves the lesson.** The tour is not dismissible; a step that
 *     navigated away would strand the child outside the lesson they opened.
 *
 * Never `waitUntil: 'networkidle'` — the learner shell holds an SSE connection.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dismissCheckin } from './lib/checkin.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/lesson-tour'
const LEARNER = 'gal'
const TOUR = 'lesson.v1'
const UNIT = 'CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE'
const COMPONENT = `${UNIT}-00001`
const LESSON = `${BASE}/learning/lesson?unit=${UNIT}&component=${COMPONENT}`
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/* Out of band on purpose: the PATCH lane is union-only and must stay that way,
   so there is deliberately no endpoint that un-completes a tour. The venv
   interpreter, not PATH's `python` — the script imports backend packages. */
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

/** Which `data-tour` region the cutout is currently sitting on.
    Scored, not first-match: the raise-hand button lives *inside* the composer,
    so "first element within 28px" reported the composer for both and made the
    hand step look like it never ran. Size is part of the score for that reason. */
const spotlitName = (page) => page.evaluate(() => {
  const hole = document.querySelector('.sp-tour__hole')
  if (!hole) return null
  const x = Number(hole.getAttribute('x'))
  const y = Number(hole.getAttribute('y'))
  const w = Number(hole.getAttribute('width'))
  const h = Number(hole.getAttribute('height'))
  let best = null
  let bestScore = Infinity
  for (const node of document.querySelectorAll('[data-tour]')) {
    const b = node.getBoundingClientRect()
    if (!b.width && !b.height) continue
    const score = Math.abs(b.left - x) + Math.abs(b.top - y)
      + Math.abs(b.width - w) + Math.abs(b.height - h)
    if (score < bestScore) { bestScore = score; best = node }
  }
  // Loose enough for the cutout's padding, tight enough not to claim a
  // neighbour when the real target never mounted.
  return bestScore <= 80 ? best?.getAttribute('data-tour') ?? null : null
})

const settle = (page) => page.waitForFunction(() => {
  if (!document.querySelector('.sp-tour__card')) return true
  const hole = document.querySelector('.sp-tour__hole')
  if (!hole) return false
  const now = `${hole.getAttribute('x')},${hole.getAttribute('y')},${hole.getAttribute('width')}`
  const stable = window.__lessonTourLast === now
  window.__lessonTourLast = now
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
  await context.request.patch(`${BASE}/api/auth/preferences`,
    { data: { language: 'he' }, failOnStatusCode: false })
  resetTour()

  const page = await context.newPage()
  await page.goto(LESSON, { waitUntil: 'domcontentloaded' })
  await dismissCheckin(page).catch(() => {})

  // ── it waits for a lesson that actually opened ───────────────────────────
  const stageUp = await page.waitForSelector('[data-tour="learner.lessonStage"]',
                                             { timeout: 60000 })
    .then(() => true).catch(() => false)
  check('the lesson itself opened', stageUp)

  const opened = await page.waitForSelector('.sp-tour__card', { timeout: 45000 })
    .then(() => true).catch(() => false)
  check('the tour opens by itself on a first lesson', opened)
  if (!opened) throw new Error('tour never opened — nothing else is meaningful')

  const welcome = await page.locator('.sp-tour__card').innerText()
  check('no raw locale key in the tour', !welcome.includes('tour.'))
  check('no unresolved name slot — Yuvi greets a real child',
        !welcome.includes('{name}'), welcome.split('\n')[0])

  // ── a child cannot walk out of it ────────────────────────────────────────
  check('there is no skip button', (await page.locator('.sp-tour__skip').count()) === 0)
  check('there is no close button', (await page.locator('.sp-tour__close').count()) === 0)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check('Escape does not close it', (await page.locator('.sp-tour__card').count()) === 1)

  // ── recorded on offer, not on completion ─────────────────────────────────
  await page.waitForTimeout(1200)
  const atOpen = await context.request.get(`${BASE}/api/auth/me`).then((r) => r.json())
  check('it is recorded as seen the moment it opens, not when it ends',
        (atOpen.user?.preferences?.tours_completed ?? []).includes(TOUR),
        JSON.stringify(atOpen.user?.preferences?.tours_completed))

  /* The hard one: a child who abandons it must not be offered it again. A second
     context is a genuinely fresh session, so only the server can be answering. */
  const abandoned = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  await abandoned.request.post(`${BASE}/api/auth/login`,
    { data: { username: LEARNER, password: 'Aa12345' } })
  const second = await abandoned.newPage()
  await second.goto(LESSON, { waitUntil: 'domcontentloaded' })
  await dismissCheckin(second).catch(() => {})
  await second.waitForSelector('[data-tour="learner.lessonStage"]', { timeout: 60000 })
    .catch(() => {})
  await second.waitForTimeout(3500)
  check('a second, fresh sign-in does NOT reopen it',
        (await second.locator('.sp-tour__card').count()) === 0)
  await abandoned.close()

  // ── the walk ─────────────────────────────────────────────────────────────
  await settle(page)
  const seen = []
  const counter = []
  let moved = 0
  let before = await guideTransform(page)
  check('Yuvi is on screen as the guide', before !== null)

  for (let step = 0; step < 12; step += 1) {
    if ((await page.locator('.sp-tour__card').count()) === 0) break
    const name = await spotlitName(page)
    if (name) seen.push(name)

    /* The footer counts the steps the child is SHOWN, not the steps that were
       written. The `door` step skips itself on every normal run, so a raw index
       counted "1, 2, 4 … of 8" and promised a step that never came. */
    const progress = await page.locator('.sp-tour__progress').innerText()
      .then((raw) => raw.match(/(\d+).*?(\d+)/))
      .catch(() => null)
    if (progress) counter.push([Number(progress[1]), Number(progress[2])])

    // Never off screen, never hidden behind its own card. Measured on the
    // innermost element: the outer `.sp-tour__guide` is a 0×0 transform anchor,
    // so its own rect says nothing about where the robot actually is.
    const geometry = await page.evaluate(() => {
      const guide = document.querySelector('.sp-tour__guide-bob')
      const card = document.querySelector('.sp-tour__card')
      if (!guide || !card) return null
      const g = guide.getBoundingClientRect()
      const c = card.getBoundingClientRect()
      const onScreen = g.left >= -1 && g.top >= -1
        && g.right <= innerWidth + 1 && g.bottom <= innerHeight + 1
      const overlaps = !(g.right < c.left || g.left > c.right
        || g.bottom < c.top || g.top > c.bottom)
      return { onScreen, overlaps }
    })
    if (geometry) {
      check(`step ${step + 1}: Yuvi is on screen`, geometry.onScreen)
      check(`step ${step + 1}: Yuvi is not behind the card`, !geometry.overlaps)
    }

    check(`step ${step + 1}: still inside the lesson`,
          new URL(page.url()).pathname === '/learning/lesson')

    /* Only ever one live Yuvi. The dock stands down while the guide flies, and
       so must the chat panel's own stage once the panel is open. */
    const robots = await page.locator('.sp-tour__guide canvas, .Yuvi-companion-dock canvas, .sp-companion__yuvi-stage canvas').count()
    check(`step ${step + 1}: exactly one Yuvi is rendered`, robots <= 1, `${robots} canvases`)

    // The closed-panel fallback. Normally skipped, because the lesson coach
    // greets proactively and the chat is already open by the time the tour
    // arrives — so this is only exercised when the dock is actually visible.
    if (name === 'learner.companion') {
      await page.locator('.Yuvi-companion-dock').click({ timeout: 5000 }).catch(() => {})
      const advanced = await page.waitForSelector('[data-tour="learner.lessonAsk"]',
                                                  { timeout: 15000 })
        .then(() => true).catch(() => false)
      check('the child\'s own press opens the chat', advanced)
      await page.waitForTimeout(900)
      await settle(page)
      check('and the tour moved on by itself, without Next',
            (await spotlitName(page)) !== 'learner.companion')
      const after = await guideTransform(page)
      if (after !== before) moved += 1
      before = after
      continue
    }

    /* The whole point of the last step is that Yuvi arrives at the home he
       will stay in. A card parked on top of him says the opposite, and so does
       spotlighting a stage the panel has left invisible. */
    if (name === 'learner.lessonYuvi') {
      const landing = await page.evaluate(() => {
        const box = (s) => document.querySelector(s)?.getBoundingClientRect() ?? null
        const stage = document.querySelector('.sp-companion__yuvi-stage')
        const card = box('.sp-tour__card')
        const rect = stage?.getBoundingClientRect() ?? null
        if (!card || !rect) return null
        const w = Math.max(0, Math.min(card.right, rect.right) - Math.max(card.left, rect.left))
        const h = Math.max(0, Math.min(card.bottom, rect.bottom) - Math.max(card.top, rect.top))
        return {
          covered: Math.round(((w * h) / (rect.width * rect.height)) * 100),
          opacity: Number(getComputedStyle(stage).opacity),
        }
      })
      check('the last card does not cover the Yuvi it lands on',
            landing !== null && landing.covered < 10, `${landing?.covered}% covered`)
      check('and the Yuvi it lands on is actually visible',
            landing !== null && landing.opacity > 0.9, `opacity ${landing?.opacity}`)
    }

    const after = await guideTransform(page)
    if (after !== before && after !== null) moved += 1
    before = after
    await next(page)
  }

  const shown = counter.map(([current]) => current)
  check('the step counter never skips a number',
        shown.every((current, at) => current === at + 1), shown.join(','))
  check('the last card is the last step it promised',
        counter.length > 0 && counter[counter.length - 1][0] === counter[counter.length - 1][1],
        counter.map((pair) => pair.join('/')).join(' '))

  check('Yuvi travels between steps rather than sitting still', moved >= 2, `${moved} flights`)
  console.log(`    narrated: ${seen.filter(Boolean).join(', ')}`)

  /* The point of the whole tour: a child leaves it knowing the three ways out
     of being stuck. The help buttons are the one part that legitimately may not
     be there (an intro screen has nothing to hint about), so they are reported
     rather than required. */
  check('the tour visited the lesson stage', seen.includes('learner.lessonStage'))
  check('the tour explained the chat box', seen.includes('learner.lessonAsk'))
  check('the tour showed how to call a teacher', seen.includes('learner.lessonHand'))
  check('the tour showed where you are in the lesson', seen.includes('learner.lessonTabs'))
  console.log(`    help buttons narrated: ${seen.includes('learner.lessonHelp')}`
    + ' (absent on screens with nothing to hint about)')
  check('the tour never wandered off the lesson',
        new URL(page.url()).pathname === '/learning/lesson')

  await page.screenshot({ path: `${OUT}/lesson-tour-end.png` })
  await context.close()
} finally {
  await browser.close()
}

console.log(failures.length ? `\n✘ ${failures.length} failed` : '\n✔ all good')
process.exit(failures.length ? 1 : 0)
