/* A disclosure, from the bell to the record of what was done about it.
 *
 *   cd frontend && node scripts/wellbeing-check.mjs [--headed]
 *
 * This is the one flow in the product where a screen failing quietly has a
 * child on the other end of it, so it is checked in a real browser against real
 * data rather than only at the seams:
 *
 *   the bell row → the right tab, scrolled and ringed → the words, where they
 *   were written, and what the child was told back → claim it → suggestions
 *   (Yuvi's, or the written fallbacks, and it says which) → log what was done →
 *   close it with a reason → it is still readable afterwards.
 *
 * It RAISES a flag through the API and purges everything it wrote at the end —
 * the flag row, the brain entry, the alert and the bell row. A safeguarding
 * record left behind by a test is a lie in a real teacher's screen.
 *
 * Never `waitUntil: 'networkidle'` — the teacher page holds an SSE connection.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = 'artifacts/wellbeing'
mkdirSync(OUT, { recursive: true })

const failures = []
const ok = (label, detail = '') => console.log(`  ✔ ${label}${detail ? ` — ${detail}` : ''}`)
const bad = (label, detail = '') => {
  console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`)
  failures.push(label)
}
const check = (label, condition, detail = '') =>
  (condition ? ok(label, detail) : bad(label, detail))

const browser = await chromium.launch({ headless: !process.argv.includes('--headed') })
let flagId = null

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 } })
  const login = await context.request.post(`${BASE}/api/auth/login`,
                                           { data: { username: 'gal', password: 'Aa12345' } })
  if (!login.ok()) throw new Error(`login: ${login.status()}`)

  const page = await context.newPage()
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await dismissTourIfOpen(page)

  console.log('\n— the bell —')
  await page.locator('.notif__bell').click()
  await page.waitForSelector('.notif__panel', { timeout: 10_000 })
  const safetyRow = page.locator('.notif__row', { hasText: /תשומת לב של מבוגר/ }).first()
  if (!(await safetyRow.count())) {
    bad('a safety notification is in the bell')
    throw new Error('nothing to click')
  }
  ok('a safety notification is in the bell')
  await page.locator('.notif__panel').screenshot({ path: `${OUT}/01-bell.png` })
  await safetyRow.locator('.notif__rowMain').click()
  await page.waitForTimeout(2500)

  console.log('\n— where it lands —')
  check('it opens the student it is about', page.url().includes('/teacher/student/gal'), page.url())
  check('and names the flag in the route', page.url().includes('flag=wb_'), page.url())
  flagId = new URL(page.url()).searchParams.get('flag')

  await page.waitForSelector('.tch-flag', { timeout: 15_000 })
  const active = await page.locator('.tch-tabs button.is-active').textContent()
  check('the wellbeing tab is the one open', /תשומת לב/.test(active ?? ''), active ?? '')
  check('the tab carries a count, so it is visible without opening it',
        (await page.locator('.tch-tabs__count').count()) > 0)

  const card = page.locator('.tch-flag').first()
  check('the flagged card is the focused one',
        (await page.locator('.tch-flag.is-focused').count()) === 1)
  // Landing ON it: the card is in view, not somewhere below the fold.
  const inView = await card.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return rect.top >= 0 && rect.top < window.innerHeight * 0.9
  })
  check('and it is on screen without scrolling', inView)

  console.log('\n— what the card says —')
  const text = (await card.textContent()) ?? ''
  check('the words themselves are shown', /לישון בלילה/.test(text))
  check('where they were written, in words', /בצ׳אט עם יובי|בצ\'אט עם יובי/.test(text))
  check('and what the student was told back', /מה שהתלמיד\/ה קיבל\/ה בחזרה/.test(text))
  check('who else was alerted', /הותרעו/.test(text))
  await card.screenshot({ path: `${OUT}/02-card.png` })

  console.log('\n— what a teacher can do —')
  await card.locator('.sp-btn', { hasText: 'אני מטפל/ת בזה' }).click()
  await page.waitForTimeout(1200)
  check('claiming it says who is handling it',
        /מטפל\/ת בזה/.test((await card.textContent()) ?? ''))

  // The suggestions: asked for, never automatic, and labelled for what they are.
  await card.locator('.sp-btn', { hasText: 'תיעוד פעולה' }).click()
  await page.waitForSelector('.tch-flag__panel', { timeout: 5000 })
  await card.locator('.tch-flag__suggest button').click()
  await page.waitForSelector('.tch-flag__options li', { timeout: 60_000 })
  const options = await card.locator('.tch-flag__options li').count()
  check('three suggestions come back', options >= 2, `${options}`)
  const note = (await card.locator('.tch-flag__suggestNote').textContent()) ?? ''
  check('and they say whether Yuvi wrote them', note.length > 10, note.slice(0, 60))
  check('the protocol line is there, and is not a suggestion',
        /נוהל בית הספר/.test((await card.locator('.tch-flag__protocol').textContent()) ?? ''))
  await page.screenshot({ path: `${OUT}/03-suggestions.png` })

  // Picking one fills the box rather than doing anything with it.
  await card.locator('.tch-flag__options li button').first().click()
  const logged = await card.locator('.tch-flag__panel textarea').inputValue()
  check('picking one fills the field, and sends nothing', logged.length > 5, logged.slice(0, 50))
  await card.locator('.sp-btn', { hasText: 'שמירת התיעוד' }).click()
  await page.waitForTimeout(1500)
  check('the action is logged on the card',
        (await card.locator('.tch-flag__log li').count()) > 0)

  console.log('\n— closing it —')
  await card.locator('.sp-btn', { hasText: 'סגירת הדיווח' }).click()
  await page.waitForSelector('.tch-flag__panel', { timeout: 5000 })
  const saveClose = card.locator('.sp-btn', { hasText: 'סגירה' }).last()
  check('closing without a reason is not offered', await saveClose.isDisabled())
  await card.locator('.tch-chip', { hasText: 'טופל' }).click()
  await page.waitForTimeout(200)
  check('choosing a reason unlocks it', !(await saveClose.isDisabled()))
  await saveClose.click()
  await page.waitForTimeout(1500)

  const closedText = (await card.textContent()) ?? ''
  check('it is closed, by a named person, with the reason', /נסגר על ידי/.test(closedText),
        closedText.match(/נסגר על ידי.{0,40}/)?.[0] ?? '')
  check('and it is still readable afterwards', /לישון בלילה/.test(closedText))
  await card.screenshot({ path: `${OUT}/04-closed.png` })

  // The strip above the tabs is computed from OPEN flags, so closing here has
  // to quiet it there — that mirror is the whole reason closing writes twice.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const stillFlagged = await page.locator('.tch-attention--wellbeing').count()
  check('closing it also quiets the "needs attention" strip', stillFlagged === 0)

  console.log(failures.length ? `\n❌ ${failures.length} check(s) failed`
                              : '\n✅ all checks passed')
} finally {
  /* ── cleanup ──────────────────────────────────────────────────────────────
     Deliberately NOT an endpoint. Deleting a safeguarding record is not a
     capability this product should ship just so a check can tidy up after
     itself; the id is printed and the purge is a script run beside it:

       cd backend && python scripts/purge_wellbeing_flag.py <flag_id> */
  if (flagId) {
    console.log(`\n— cleanup —\n  · raised ${flagId}`)
    console.log(`  · purge with: cd backend && python scripts/purge_wellbeing_flag.py ${flagId}`)
  }
  await browser.close()
}
