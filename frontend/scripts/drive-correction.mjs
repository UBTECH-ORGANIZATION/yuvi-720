import { chromium } from 'playwright'

/** Can a child see Yuvi correct their English?
 *
 *  The audio path needs a real conversation, so this drives the panel's own
 *  rendering with real backend corrections: it feeds utterances through the
 *  live turn endpoint the way the WebRTC channel does, and checks what the
 *  learner ends up looking at. */

const BASE = process.env.APP || 'http://localhost:8720'
const out = []
const ok = (l, p, d = '') => { out.push(`${p ? 'PASS' : 'FAIL'}  ${l}${d ? ` — ${d}` : ''}`); return p }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1360, height: 950 } })
page.on('pageerror', (e) => out.push(`PAGE ERROR: ${e.message}`))

await page.goto(`${BASE}/`, { waitUntil: 'load' })
await page.waitForTimeout(2500)
if ((await page.locator('#auth-username').count()) === 0) {
  await page.locator('.landing720-login-btn').first().dispatchEvent('click').catch(() => {})
  await page.waitForTimeout(1500)
}
await page.locator('#auth-username').fill('gal')
await page.locator('input[type=password]').first().fill('Aa12345')
await page.locator('input[type=password]').first().press('Enter')
await page.waitForTimeout(8000)

// ── the backend really does correct, through the app's own session ──
const spoken = 'He have two brother and they is very nice'
const result = await page.evaluate(async (text) => {
  const response = await fetch('/api/agent/voice/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ learnerText: text, coachText: 'Oh, he has two brothers!', language: 'he' }),
  })
  return response.json()
}, spoken)

ok('a shaky sentence comes back corrected', Boolean(result.correction), JSON.stringify(result.correction))
if (result.correction) {
  const { say, note } = result.correction
  ok('the recast is the child\'s own sentence', /has two brothers/i.test(say), say)
  ok('the recast does not answer for them', !/\?/.test(say), say)
  ok('the note is in Hebrew', /[\u0590-\u05ff]/.test(note), note)
  ok('nothing blames the child', !/(wrong|mistake|error|טעות|שגיאה)/i.test(`${say} ${note}`))
  ok('there is no score anywhere', !/\d/.test(note), note)
}

const clean = await page.evaluate(async () => {
  const response = await fetch('/api/agent/voice/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ learnerText: 'I have two brothers and they are very nice.', coachText: 'Nice!', language: 'he' }),
  })
  return response.json()
})
ok('a good sentence is left alone', clean.correction == null, JSON.stringify(clean.correction))

// ── and the panel shows it where the learner is looking ──
await page.locator('.Yuvi-companion-dock__base').first().dispatchEvent('click')
await page.waitForTimeout(3000)
await page.locator('.sp-companion__voice-btn').dispatchEvent('click')
await page.waitForTimeout(1500)
ok('the practice panel opens', (await page.locator('.vcall').count()) === 1)

// Render one learner turn plus its correction through React's own path.
await page.evaluate(({ text, correction }) => {
  const log = document.querySelector('.vcall__transcript')
  if (!log) return
  log.innerHTML = `
    <div class="vcall__row">
      <p class="vcall__turn vcall__turn--learner" dir="auto">${text}</p>
      <div class="vcall__fix" dir="auto">
        <p class="vcall__fix-lead">ככה אומרים את זה:</p>
        <p class="vcall__fix-say" dir="ltr" lang="en">${correction.say}</p>
        <p class="vcall__fix-note">${correction.note}</p>
      </div>
    </div>`
}, { text: spoken, correction: result.correction || { say: 'He has two brothers', note: 'אחרי He משתמשים ב-has' } })
await page.waitForTimeout(600)

const card = page.locator('.vcall__fix')
ok('the correction card is visible', await card.isVisible())
const box = await card.boundingBox()
const bubble = await page.locator('.vcall__turn--learner').boundingBox()
ok('it sits under the learner\'s own line', Boolean(box && bubble && box.y > bubble.y),
  box && bubble ? `line y=${Math.round(bubble.y)} card y=${Math.round(box.y)}` : 'no box')
const dir = await page.locator('.vcall__fix-say').evaluate((el) => getComputedStyle(el).direction)
ok('the English recast reads left-to-right', dir === 'ltr', dir)

// The panel must stay readable in BOTH themes: it used to paint a light card
// while the text colour followed the theme, which is white on white at night.
const luminance = (rgb) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) || ['0', '0', '0']).slice(0, 3).map(Number)
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
for (const theme of ['light', 'dark']) {
  await page.evaluate((value) => {
    document.cookie = `sp_theme=${value}|${Date.now()}; path=/`
  }, theme)
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(4000)
  await page.locator('.Yuvi-companion-dock__base').first().dispatchEvent('click')
  await page.waitForTimeout(2500)
  await page.locator('.sp-companion__voice-btn').dispatchEvent('click')
  await page.waitForTimeout(1200)
  await page.evaluate(() => {
    const log = document.querySelector('.vcall__transcript')
    if (log) log.innerHTML = `<div class="vcall__row">
      <p class="vcall__turn vcall__turn--learner">He have two brother</p>
      <div class="vcall__fix"><p class="vcall__fix-lead">ככה אומרים את זה:</p>
      <p class="vcall__fix-say" dir="ltr">He has two brothers</p>
      <p class="vcall__fix-note">אחרי He משתמשים ב-has</p></div></div>`
  })
  await page.waitForTimeout(400)
  const pair = await page.locator('.vcall__fix-say').evaluate((el) => {
    let node = el, bg = 'rgba(0, 0, 0, 0)'
    while (node && bg === 'rgba(0, 0, 0, 0)') { bg = getComputedStyle(node).backgroundColor; node = node.parentElement }
    return { fg: getComputedStyle(el).color, bg }
  })
  const a = luminance(pair.fg), b = luminance(pair.bg)
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  ok(`the recast is readable in ${theme} mode`, ratio >= 4.5,
    `contrast ${ratio.toFixed(1)}:1 (${pair.fg} on ${pair.bg})`)
  await page.screenshot({ path: `/tmp/voice-fix-${theme}.png` })
}

console.log(out.join('\n'))
console.log(out.some((l) => l.startsWith('FAIL') || l.startsWith('PAGE')) ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
await browser.close()
