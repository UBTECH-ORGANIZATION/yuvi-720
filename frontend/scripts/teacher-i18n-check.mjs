/* The teacher portal in all three languages.
 *
 * Hebrew is the source language, so English and Arabic are where a missing key
 * actually shows: `t()` returns the key itself when a translation is absent,
 * which puts `tch.evidence.field.score_ewma` on a teacher's screen rather than
 * failing loudly. This walks every teacher surface in he/ar/en and asserts:
 *
 *   nothing on screen looks like a locale key (the leak signature is a
 *   dotted lowercase namespace: `tch.`, `notif.`, `companion.`, …);
 *   the document direction follows the language, not the build;
 *   evidence disclosures — the surfaces most likely to outpace the locale
 *   files — render sentences in the active language;
 *   no screen scrolls sideways in either direction.
 *
 * The language is set through the real preference endpoint, the same way a
 * teacher changes it, so this also exercises the round-trip.
 */

import { chromium } from 'playwright'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL || 'http://localhost:5199'
const OUT = 'artifacts'

/** A locale key that reached the screen. Deliberately narrow: it must have a
 *  known namespace and a dotted tail, so ordinary prose can never match. */
const KEY_LEAK = /\b(?:tch|notif|companion|sdash|adm|landing|auth|common|learning|reflect|mapping)\.[a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+/g

const LANGUAGES = [
  { code: 'he', dir: 'rtl' },
  { code: 'ar', dir: 'rtl' },
  { code: 'en', dir: 'ltr' },
]

const SCREENS = [
  { name: 'home', path: '/teacher', ready: '.tch-stat' },
  { name: 'students', path: '/teacher/students', ready: '.tch-studentCard, .sp-state' },
  { name: 'learnings', path: '/teacher/learnings', ready: '.tch-learning' },
  { name: 'goals', path: '/teacher/goals', ready: '.tch-goalsPage__inbox' },
  { name: 'messages', path: '/teacher/messages', ready: '.tch-messages__layout' },
]

let passed = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { failures.push(name); console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const browser = await chromium.launch()

try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'gal', password: 'Aa12345' },
  })
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`)
  const page = await context.newPage()

  for (const language of LANGUAGES) {
    console.log(`\n── ${language.code} ────────────────────────────────────`)
    const set = await context.request.patch(`${BASE}/api/auth/preferences`, {
      data: { language: language.code }, failOnStatusCode: false,
    })
    check(`${language.code}: the language preference is accepted`, set.ok(), `HTTP ${set.status()}`)

    for (const screen of SCREENS) {
      await page.goto(`${BASE}${screen.path}`, { waitUntil: 'domcontentloaded' })
      const ready = await page.waitForSelector(screen.ready, { timeout: 60000 })
        .then(() => true).catch(() => false)
      if (!ready) {
        check(`${language.code}/${screen.name}: renders`, false, 'timed out')
        continue
      }
      await dismissTourIfOpen(page)
      await page.waitForTimeout(500)

      // Open every "why?" on the page: evidence text is generated from backend
      // shapes and is the likeliest place for an untranslated key to appear.
      for (const toggle of await page.locator('.tch-evidence__toggle').all()) {
        await toggle.click().catch(() => {})
      }
      await page.waitForTimeout(300)

      const body = await page.locator('body').innerText()
      const leaks = [...new Set(body.match(KEY_LEAK) ?? [])]
      check(`${language.code}/${screen.name}: no locale key on screen`,
            leaks.length === 0, leaks.slice(0, 3).join(', '))

      const direction = await page.evaluate(() => ({
        dir: document.documentElement.getAttribute('dir'),
        lang: document.documentElement.getAttribute('lang'),
      }))
      check(`${language.code}/${screen.name}: direction follows the language`,
            direction.dir === language.dir, `dir=${direction.dir} lang=${direction.lang}`)

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check(`${language.code}/${screen.name}: no sideways scroll`, overflow <= 0, `${overflow}px`)
    }

    // One student profile per language — the deepest screen, one long page
    // of generated text now that the tabs are gone.
    await page.goto(`${BASE}/teacher/students`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.tch-studentCard', { timeout: 60000 }).catch(() => {})
    if (await page.locator('.tch-studentCard').count()) {
      await page.locator('.tch-studentCard').first().click()
      await page.waitForSelector('.tch-student__body', { timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(900)
      /* Open every <details> drawer — the lesson archive, the lessons inside
         it and the topic rows. innerText skips hidden text, and the generated
         words this sweep exists for live inside those drawers. */
      await page.$$eval('details', (els) => els.forEach((el) => { el.open = true }))
      for (const toggle of await page.locator('.tch-evidence__toggle').all()) {
        await toggle.click().catch(() => {})
      }
      await page.waitForTimeout(300)
      const text = await page.locator('body').innerText()
      const leaked = new Set(text.match(KEY_LEAK) ?? [])
      check(`${language.code}/profile: no locale key anywhere on the page`,
            leaked.size === 0, [...leaked].slice(0, 3).join(', '))
      await page.screenshot({ path: `${OUT}/i18n-${language.code}-profile.png` })
    }
  }

  // Leave the account where the rest of the suite expects it.
  await context.request.patch(`${BASE}/api/auth/preferences`,
    { data: { language: 'he' }, failOnStatusCode: false })
} finally {
  await browser.close()
}

console.log('')
if (failures.length) {
  console.log(`✘ ${failures.length} failure(s) / ${passed} passed`)
  for (const name of failures) console.log(`   - ${name}`)
  process.exit(1)
}
console.log(`✅ teacher i18n check passed (${passed} checks)`)
