/* axe-core audit of the lomda player itself, in both themes and all three
 * locales — on EVERY screen of the component, not just the one it opens on.
 *
 * `audit-a11y.mjs` audits the live environment behind a login; this one audits
 * the standalone player from a launch token, which is the surface a 720 platform
 * actually embeds — and the one whose dark palette has no other check on it.
 *
 * Auditing only the opening card was close to auditing nothing: a matching board
 * and a typed answer are where the interesting accessibility questions live, and
 * neither of them is on screen one.
 *
 *   cd backend && ./.venv/bin/python scripts/mint_launches.py <componentId>
 *   cd frontend && node scripts/player-a11y.mjs [componentId]
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const launches = JSON.parse(readFileSync('/tmp/player_launches.json', 'utf8'))
const base = launches[process.argv[2]] || Object.values(launches)[0]
const AXE = 'https://unpkg.com/axe-core@4.10.2/axe.min.js'

const withParams = (url, params) => {
  const next = new URL(url)
  Object.entries(params).forEach(([k, v]) => next.searchParams.set(k, v))
  return next.toString()
}

const browser = await chromium.launch({ channel: 'chrome' })
let total = 0

for (const theme of ['light', 'dark']) {
  for (const lang of ['he', 'ar', 'en']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(withParams(base, { theme, lang }), { waitUntil: 'load' })
    await page.waitForSelector('.lp-card', { timeout: 15000 })

    try {
      await page.addScriptTag({ url: AXE })
    } catch {
      console.error('could not load axe-core (offline?) — skipping')
      await browser.close()
      process.exit(2)
    }

    const audit = async (where) => {
      const results = await page.evaluate(async () =>
        window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }))
      const violations = results.violations.filter((v) => v.impact !== 'minor')
      violations.forEach((v) => {
        console.log(`  ${theme}/${lang} ${where} [${v.impact}] ${v.id} — ${v.help}`)
        v.nodes.slice(0, 3).forEach((n) => console.log(`      ${n.target.join(' ')} :: ${n.failureSummary?.split('\n')[1] || ''}`))
      })
      return violations.length
    }

    // Walk the whole component. Where "continue" is held back by an unanswered
    // question, answer it — the state AFTER marking (locked options, per-pair
    // marks, the feedback box) is as much a screen as the state before it.
    let combo = 0
    for (let screen = 0; screen < 16; screen += 1) {
      const kind = await page.evaluate(() =>
        document.querySelector('.lp-match') ? 'match'
          : document.querySelector('.lp-text__input') ? 'text'
            : document.querySelector('.lp-option') ? 'choice' : 'body')
      combo += await audit(`screen ${screen} (${kind})`)

      const next = page.locator('.lp-foot .lp-btn').last()
      if (!(await next.count())) break
      if (await next.isDisabled()) {
        if (kind === 'match') {
          // Any complete board will do — this is an audit, not a score.
          const rows = await page.locator('.lp-match__prompt').count()
          for (let row = 0; row < rows; row += 1) {
            await page.locator('.lp-match__prompt').nth(row).click()
            await page.locator('.lp-match__chip:not(:disabled)').first().click()
          }
          await page.locator('.lp-match__check').click()
        } else if (kind === 'text') {
          await page.locator('.lp-text__input').fill('does')
          await page.locator('.lp-text button').click()
        } else if (await page.locator('.lp-option:not(:disabled)').count()) {
          await page.locator('.lp-option:not(:disabled)').first().click()
        } else break
        await page.waitForTimeout(700)
        combo += await audit(`screen ${screen} (${kind}, marked)`)
        if (await next.isDisabled()) break
      }
      await next.click()
      await page.waitForTimeout(450)
    }

    total += combo
    console.log(`${theme}/${lang}: ${combo ? `${combo} violation(s)` : 'clean across every screen'}`)
    await page.close()
  }
}
await browser.close()
console.log(`\n${total} violation(s) above minor across 6 theme/locale combinations`)
process.exit(total ? 1 : 0)
