/* The no-scroll invariant, checked mechanically.
 *
 * The player runs inside someone else's iframe, where a scrollbar on our own
 * document is either invisible or fights the host's scrolling — and a learner
 * who has to scroll to find "continue" concludes the screen is broken. So the
 * page itself must never scroll: `document.scrollHeight <= innerHeight`.
 *
 * The card is allowed to scroll internally as an overflow fallback (a 320px
 * phone in landscape, or 200% zoom, where WCAG 1.4.4 requires reflow to keep
 * working). That is reported, not failed — it is the designed escape hatch, but
 * a screen that needs it at a normal size is a screen to redesign.
 *
 *   cd backend && ./.venv/bin/python scripts/mint_player_launch.py <componentId>
 *   cd frontend && node scripts/player-viewports.mjs [--shots]
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = readFileSync('/tmp/player_url.txt', 'utf8').trim()
const shots = process.argv.includes('--shots')
const outDir = '/tmp/player-viewports'
if (shots) mkdirSync(outDir, { recursive: true })

const VIEWPORTS = [
  { name: 'phone', width: 360, height: 640 },
  { name: 'phone-landscape', width: 640, height: 360 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
]
const THEMES = ['light', 'dark']
const LANGS = ['he', 'ar', 'en']

const withParams = (url, params) => {
  const next = new URL(url)
  Object.entries(params).forEach(([k, v]) => next.searchParams.set(k, v))
  return next.toString()
}

const browser = await chromium.launch({ channel: 'chrome' })
const rows = []
let failures = 0
let overflows = 0

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    for (const lang of LANGS) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
      await page.goto(withParams(base, { theme, lang }), { waitUntil: 'load' })
      await page.waitForSelector('.lp-card', { timeout: 15000 })

      // Walk every screen: each one has to hold the invariant, not just the first.
      const screens = await page.locator('.lp-step').count()
      for (let index = 0; index < Math.max(screens, 1); index += 1) {
        if (index > 0) {
          const step = page.locator('.lp-step').nth(index)
          if (await step.isDisabled().catch(() => true)) break
          await step.click().catch(() => {})
          await page.waitForTimeout(250)
        }
        const probe = await page.evaluate(() => {
          const doc = document.documentElement
          const card = document.querySelector('.lp-card')
          const foot = document.querySelector('.lp-foot')
          return {
            pageScrolls: doc.scrollHeight > window.innerHeight + 1,
            cardScrolls: card ? card.scrollHeight > card.clientHeight + 1 : false,
            // The footer must be inside the viewport, not merely present.
            footVisible: foot ? foot.getBoundingClientRect().bottom <= window.innerHeight + 1 : false,
            // Only elements that actually render text of their own: an icon or a
            // layout wrapper inherits a font-size it never paints, and failing on
            // those would be noise that trains everyone to ignore this check.
            minFont: (() => {
              const sizes = [...document.querySelectorAll('.lp-card *, .lp-foot *, .lp-head *')]
                .filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()))
                .filter((n) => n.getClientRects().length)
                .map((n) => parseFloat(getComputedStyle(n).fontSize))
                .filter((n) => Number.isFinite(n) && n > 0)
              return sizes.length ? Math.min(...sizes) : Infinity
            })(),
          }
        })
        const label = `${viewport.name}/${theme}/${lang} screen ${index + 1}`
        const bad = probe.pageScrolls || !probe.footVisible || probe.minFont < 14.5
        if (bad) failures += 1
        if (probe.cardScrolls) overflows += 1
        if (bad || probe.cardScrolls) {
          rows.push(`${bad ? 'FAIL' : 'note'}  ${label}` +
            `${probe.pageScrolls ? ' — PAGE SCROLLS' : ''}` +
            `${probe.footVisible ? '' : ' — footer off screen'}` +
            `${probe.minFont < 14.5 ? ` — text ${probe.minFont.toFixed(1)}px below 15px floor` : ''}` +
            `${probe.cardScrolls ? ' — card scrolls internally (overflow fallback)' : ''}`)
        }
        if (errors.length) { rows.push(`FAIL  ${label} — JS: ${errors[0]}`); failures += 1; errors.length = 0 }
      }
      if (shots) {
        await page.screenshot({ path: `${outDir}/${viewport.name}-${theme}-${lang}.png` })
      }
      await page.close()
    }
  }
}
await browser.close()

rows.forEach((row) => console.log(row))
console.log(`\n${VIEWPORTS.length * THEMES.length * LANGS.length} combinations · ` +
  `${failures} failures · ${overflows} internal-overflow screens`)
if (shots) console.log(`screenshots in ${outDir}`)
process.exit(failures ? 1 : 0)
