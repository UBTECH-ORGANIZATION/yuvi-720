/* Shared browser harness for the instructor-guide screenshots.
   
   Two rules this file exists to enforce:

   1. NEVER `waitUntil: 'networkidle'`. The coach holds an SSE connection open,
      so the learner surfaces never go idle and the navigation hangs until the
      timeout. Every wait here is either `domcontentloaded` or an explicit
      element wait.
   2. A screenshot that differs between two identical runs is a screenshot that
      will spam the auto-PR forever. Everything below — fixed viewport, fixed
      locale and timezone, frozen clock, animations off, caret off, check-in and
      tour dismissed — is in service of a byte-identical re-run. */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { dismissCheckin } from '../lib/checkin.mjs'
import { dismissTourIfOpen } from '../lib/tour.mjs'

export const VIEWPORT = { width: 1440, height: 900 }

// Must match TOUR_SLUGS in backend/app/auth/repository.py — unknown slugs are
// dropped server-side, so a rename here fails silently as a re-opening tour.
const TOUR_SLUGS = ['teacher', 'learner.v1', 'lesson.v1']

/* Kills every source of a one-pixel diff that is not the UI itself. */
const STILL_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
  * { caret-color: transparent !important; }
  ::-webkit-scrollbar { display: none !important; }
`

export async function launch() {
  return chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] })
}

/** Today at 09:00 Asia/Jerusalem.

    Deliberately *today* and not a hardcoded date: the seed data is written
    relative to the real current day, so pinning the clock to a fixed calendar
    date would put every dashboard out of range. Pinning the time-of-day is
    enough to stop "לפני 3 דקות" from drifting mid-run. */
function frozenNow() {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now)
  const get = (t) => parts.find((p) => p.type === t).value
  return new Date(`${get('year')}-${get('month')}-${get('day')}T09:00:00+03:00`)
}

/** A signed-in, visually still page for one chapter.

    `account` is `null` for the anonymous shots (the landing page); otherwise it
    is an entry from `accounts` in docs-map.json. */
export async function openSession(browser, { base, account, language = 'he' }) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    colorScheme: 'light',
    reducedMotion: 'reduce'
  })
  await context.addInitScript(() => {
    // The tour and the studio intro both look at these; a guide screenshot must
    // show the surface, not the first-run overlay on top of it.
    try { window.localStorage.setItem('yuvi.docs-capture', '1') } catch { /* sandboxed */ }
  })

  if (account) {
    const res = await context.request.post(`${base}/api/auth/login`, {
      data: { username: account.username, password: account.password }
    })
    if (!res.ok()) {
      throw new Error(`login failed for ${account.username}: ${res.status()} ${await res.text()}`)
    }
    // Language lives in the learner's saved state, not in a URL param — set it
    // through the same API the UI uses so the capture matches what a real user
    // with that preference sees.
    await context.request.patch(`${base}/api/learner-state`, { data: { language } }).catch(() => {})
    /* The product tours auto-open on first arrival and their scrim swallows
       every click underneath it. Dismissing them in the browser is a race we
       lose; marking them seen server-side means they never open at all. */
    await context.request.patch(`${base}/api/auth/preferences`, {
      data: { tours_completed: TOUR_SLUGS }
    }).catch(() => {})
    if (account.onboarded) {
      // Onboarding is gated on the learner's *saved* state (see
      // OnboardingProvider): an un-mapped learner is bounced to
      // /learner-mapping from every other route, which would silently turn
      // eight chapters into eight copies of the questionnaire.
      await context.request.patch(`${base}/api/learner-state`, {
        data: {
          mapping_progress: { completed: true },
          profile_summary_progress: { completed: true }
        }
      }).catch(() => {})
    }
  }

  const page = await context.newPage()
  await page.clock.setFixedTime(frozenNow())
  await page.addStyleTag({ content: STILL_CSS }).catch(() => {})
  page.on('pageerror', (err) => console.warn(`   ⚠️ page error: ${err.message}`))

  return { context, page }
}

/** Navigate without ever waiting for the network to go quiet. */
export async function goto(page, base, path) {
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
  await page.addStyleTag({ content: STILL_CSS }).catch(() => {})
  await settle(page)
}

/** Clear the two overlays that can cover any learner surface, then let layout
    and fonts finish. Cheap enough to call before every shot. */
export async function settle(page, { patience = 500 } = {}) {
  await dismissCheckin(page).catch(() => {})
  await dismissTourIfOpen(page).catch(() => {})
  // A tour can mount a frame after the dismissal ran; its scrim covers the
  // whole viewport, so anything clicked next would time out on an intercepted
  // pointer rather than on a missing element.
  await page.locator('.sp-tour__overlay').first()
    .waitFor({ state: 'detached', timeout: 4000 }).catch(() => {})
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  await page.waitForTimeout(patience)
}

/** Wait for a surface to actually be there before shooting it.
    Returns false instead of throwing: a missing optional panel should downgrade
    the screenshot, not fail the whole guide build. */
export async function waitFor(page, selector, timeout = 15000) {
  try {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout })
    return true
  } catch {
    console.warn(`   ⚠️ selector never appeared: ${selector}`)
    return false
  }
}

/** A numbered screenshot writer bound to one chapter's output folder.

    The numbering is positional, which is why scenario order is part of the
    contract with the markdown: `shoot('landing')` as the first call writes
    `01-landing.png`, and the chapter references exactly that name. */
export function shooter(outDir) {
  let n = 0
  /* `selector` may be a string or a list of candidates. The list matters: this
     codebase has no data-testid convention, so a class name is only as stable
     as the next refactor. Falling back to the viewport keeps the guide building
     with a slightly wider crop instead of failing the run. */
  return async function shoot(page, slug, { selector = null, fullPage = false } = {}) {
    n += 1
    const path = `${outDir}/${String(n).padStart(2, '0')}-${slug}.png`
    mkdirSync(dirname(path), { recursive: true })
    await settle(page, { patience: 250 })

    let target = null
    for (const candidate of [].concat(selector ?? [])) {
      const locator = page.locator(candidate).first()
      if (await locator.count() && await locator.isVisible().catch(() => false)) {
        await locator.scrollIntoViewIfNeeded().catch(() => {})
        await page.waitForTimeout(150)
        target = locator
        break
      }
    }
    if (selector && !target) console.warn(`   ⚠️ ${slug}: no candidate selector matched, shooting the viewport`)

    if (target) {
      /* An element screenshot waits for the box to stop moving, and rAF-driven
         motion survives the animation-killing stylesheet. Rather than lose the
         chapter to it, crop wider. */
      try {
        await target.screenshot({ path, timeout: 10000 })
      } catch (err) {
        console.warn(`   ⚠️ ${slug}: element never settled (${err.message.split('\n')[0]}), shooting the viewport`)
        await page.screenshot({ path })
      }
    } else {
      await page.screenshot({ path, fullPage })
    }
    console.log(`   📸 ${path.split('/docs/guide/')[1] ?? path}`)
    return path
  }
}
