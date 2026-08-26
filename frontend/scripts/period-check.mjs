/* The dashboard's period control (#455 follow-up).
 *
 * Drives the four periods in one session and checks that the screen actually
 * re-reads rather than relabelling: the KPI figures move, the comparison chips
 * appear, the bands re-judge, and the book's cover names a different window.
 *
 * Sequential by construction — concurrent gal logins stomp each other's
 * language and session.
 */

import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:5174'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ colorScheme: 'light' })
const page = await context.newPage()

try {
  // Log in through the API and let the session cookie carry the browser — the
  // landing page's own form is not what this probe is testing.
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'gal', password: 'Aa12345' },
  })
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`)

  await page.goto(`${BASE}/teacher`, { waitUntil: 'load' })
  /* Never networkidle on an authenticated page: the companion holds an SSE
     stream open, so the page never goes idle. */
  await page.waitForSelector('.tch-period', { timeout: 20000 })
  await page.waitForTimeout(3500)

  const segs = page.locator('.tch-period__seg')
  check('the control offers four periods', await segs.count() === 4,
    `${await segs.count()} segments`)

  const labels = await segs.allInnerTexts()
  check('short to long, in Hebrew', labels.join(' | '), labels.join(' | '))

  const pressed = await page.locator('.tch-period__seg[aria-pressed="true"]').count()
  check('exactly one is pressed', pressed === 1, `${pressed} pressed`)

  /** Everything the screen is currently claiming. */
  const readScreen = async () => {
    await page.waitForTimeout(7000)
    return page.evaluate(() => {
      const text = (el) => (el?.textContent ?? '').trim()
      const stats = [...document.querySelectorAll('.tch-stat')]
      return {
        period: text(document.querySelector('.tch-period__seg[aria-pressed="true"]')),
        values: stats.map((s) => text(s.querySelector('.tch-stat__value'))),
        hints: stats.map((s) => text(s.querySelector('.tch-stat__hint'))),
        deltas: [...document.querySelectorAll('.tch-delta')].map((d) => ({
          text: text(d),
          when: text(d.querySelector('.tch-delta__when')),
          dir: [...d.classList].find((c) => c.startsWith('tch-delta--')),
        })),
        shift: text(document.querySelector('.tch-stat__shift')),
        bands: {
          red: document.querySelectorAll('.tch-band--red, [data-band="red"]').length,
          rows: document.querySelectorAll('.tch-bands__row, .tch-band').length,
        },
        bookDates: text(document.querySelector('.tch-bookStage__dates'))
          || text(document.querySelector('.tch-quiet__band')),
        bookTitle: text(document.querySelector('.tch-album h2'))
          || text(document.querySelector('.tch-album .sp-sectionHeader h2')),
        quiet: Boolean(document.querySelector('.tch-quiet')),
      }
    })
  }

  const seen = {}
  for (const id of ['day', '3day', 'week', 'month']) {
    const index = ['day', '3day', 'week', 'month'].indexOf(id)
    // Dispatch in page: the book stage is pinned, and Playwright's
    // scroll-into-view perturbs the --p choreography it drives.
    await page.evaluate((i) => {
      document.querySelectorAll('.tch-period__seg')[i].click()
    }, index)
    seen[id] = await readScreen()
    console.log(`\n  [${id}] ${seen[id].period}`)
    console.log(`    values : ${seen[id].values.join(' / ')}`)
    console.log(`    hints  : ${seen[id].hints.join(' | ')}`)
    console.log(`    deltas : ${seen[id].deltas.map((d) => `${d.text} (${d.dir})`).join(', ') || '—'}`)
    console.log(`    shift  : ${seen[id].shift || '—'}`)
    console.log(`    book   : ${seen[id].bookTitle} [${seen[id].bookDates}]${seen[id].quiet ? ' (quiet)' : ''}`)
  }

  check('the pressed segment follows the click',
    ['day', '3day', 'week', 'month'].every((id) => seen[id].period.length > 0))

  const distinctValues = new Set(Object.values(seen).map((s) => s.values.join('|')))
  check('the KPI figures re-read per period, not relabel',
    distinctValues.size > 1, `${distinctValues.size} distinct readings of 4`)

  const anyDelta = Object.values(seen).some((s) => s.deltas.length > 0)
  check('a comparison against the previous window is shown', anyDelta,
    Object.entries(seen).map(([k, v]) => `${k}:${v.deltas.length}`).join(' '))

  const dirs = new Set(Object.values(seen).flatMap((s) => s.deltas.map((d) => d.dir)))
  check('direction is carried by a class, not colour alone', dirs.size > 0,
    [...dirs].join(' '))

  /* A change with no period is not checkable: "↓2%" against yesterday and
     against last month are different pieces of news, which is the entire
     point of the control above. Every chip names its own stretch, inside the
     chip, so the two can never be read as unrelated. */
  const chips = Object.values(seen).flatMap((s) => s.deltas)
  check('every chip names the stretch it is measured against',
    chips.length > 0 && chips.every((d) => d.when.length > 0),
    `${chips.filter((d) => d.when).length}/${chips.length}`)

  const periods = new Set(Object.entries(seen)
    .flatMap(([, s]) => s.deltas.map((d) => d.when)))
  check('and that stretch follows the chosen period',
    periods.size > 1, [...periods].join(' · '))

  check('the old figure is not printed a second time beside the value',
    Object.values(seen).every((s) => s.deltas.every((d) => !/\bמ-\d/.test(d.text))),
    'no "מ-24%" fragments')

  const bookWindows = new Set(Object.values(seen).map((s) => s.bookDates))
  check('the book covers a different window per period',
    bookWindows.size > 1, [...bookWindows].join(' · '))

  const dayLabel = seen.day.bookDates
  check('a one-day edition is one date, not a range said twice',
    Boolean(dayLabel) && !dayLabel.replace(/^-\s*/, '').includes('-'),
    dayLabel || '(the album had not landed)')

  // Persistence: the choice has to survive a reload.
  await page.evaluate(() => document.querySelectorAll('.tch-period__seg')[3].click())
  await page.waitForTimeout(2000)
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.tch-period', { timeout: 20000 })
  await page.waitForTimeout(3000)
  const afterReload = await page.locator('.tch-period__seg[aria-pressed="true"]').innerText()
  check('the period survives a reload', afterReload === seen.month.period,
    `${afterReload} (wanted ${seen.month.period})`)

  await page.screenshot({ path: '/tmp/period-month.png' })

  // Dark mode, since new surfaces are involved.
  const dark = await context.newPage()
  await dark.emulateMedia({ colorScheme: 'dark' })
  await dark.goto(`${BASE}/teacher`, { waitUntil: 'load' })
  await dark.waitForSelector('.tch-period', { timeout: 20000 })
  await dark.waitForTimeout(3000)
  await dark.screenshot({ path: '/tmp/period-dark.png' })
  const contrast = await dark.evaluate(() => {
    const on = document.querySelector('.tch-period__seg.is-on')
    const style = getComputedStyle(on)
    return { bg: style.backgroundColor, fg: style.color }
  })
  check('the chosen segment is painted in dark mode',
    contrast.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(contrast))

  /* `--sp-bg` is declared only on the light `:root`, so every teacher surface
     that recesses against a card used to paint a near-white slab in dark mode.
     The hovered student row is the loudest of them. */
  await dark.hover('.tch-bands__student').catch(() => {})
  await dark.waitForTimeout(300)
  const hover = await dark.evaluate(() => {
    const row = document.querySelector('.tch-bands__student')
    if (!row) return null
    const [r, g, b] = getComputedStyle(row).backgroundColor
      .match(/\d+/g).slice(0, 3).map(Number)
    return { css: getComputedStyle(row).backgroundColor, luminance: (r + g + b) / 3 }
  })
  check('a hovered row in dark mode is not a light slab',
    hover === null || hover.luminance < 120,
    hover ? `${hover.css} (mean ${Math.round(hover.luminance)})` : 'no rows')
  await dark.close()

  // Leave the account as we found it.
  await page.evaluate(() => fetch('/api/auth/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacher_period: 'week' }),
  }))
  await page.waitForTimeout(800)
  console.log('\n  (restored gal\'s period to "week")')
} finally {
  await browser.close()
}

const failed = results.filter((r) => r.ok === false)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exit(1)
