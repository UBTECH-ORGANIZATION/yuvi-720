import { chromium } from 'playwright'

/** Can a learner find and press the mic in Yuvi's chat?
 *  The button used to inherit the composer's blanket `button` rule and land
 *  exactly on top of the send arrow, so it was invisible in both themes. */

const out = []
const ok = (l, p, d = '') => { out.push(`${p ? 'PASS' : 'FAIL'}  ${l}${d ? ` — ${d}` : ''}`); return p }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1360, height: 950 } })

await page.goto('http://localhost:5173/', { waitUntil: 'load' })
await page.waitForTimeout(2500)
if ((await page.locator('#auth-username').count()) === 0) {
  await page.locator('.landing720-login-btn').first().dispatchEvent('click').catch(() => {})
  await page.waitForTimeout(1500)
}
await page.locator('#auth-username').fill('gal')
await page.locator('input[type=password]').first().fill('Aa12345')
await page.locator('input[type=password]').first().press('Enter')
await page.waitForTimeout(8000)

for (const theme of ['light', 'dark']) {
  await page.evaluate((v) => { document.cookie = `sp_theme=${v}|${Date.now()}; path=/` }, theme)
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(5000)
  await page.locator('.Yuvi-companion-dock__base').first().dispatchEvent('click')
  await page.waitForTimeout(3000)

  const geo = await page.evaluate(() => {
    const mic = document.querySelector('.sp-companion__voice-btn')
    const send = document.querySelector('.sp-companion__composer button:last-of-type')
    const input = document.querySelector('.sp-companion__composer input')
    if (!mic || !send || !input) return null
    const m = mic.getBoundingClientRect(), s = send.getBoundingClientRect(), i = input.getBoundingClientRect()
    return {
      overlap: !(m.right <= s.left || m.left >= s.right),
      insideInput: m.left >= i.left - 2 && m.right <= i.right + 2,
      coversText: m.left < i.left,
      w: Math.round(m.width),
    }
  })
  ok(`[${theme}] the mic sits beside send, not on it`, geo && !geo.overlap)
  ok(`[${theme}] the mic stays inside the input`, geo && geo.insideInput, `${geo?.w}px`)

  await page.locator('.sp-companion__voice-btn').dispatchEvent('click')
  await page.waitForTimeout(1500)
  const title = await page.locator('.vcall__title').innerText().catch(() => '')
  ok(`[${theme}] pressing it opens spoken practice`, title.length > 0, title)
  await page.screenshot({ path: `/tmp/mic-${theme}.png`, clip: { x: 880, y: 300, width: 480, height: 620 } })
  await page.locator('.sp-companion__voice-btn').dispatchEvent('click')
  await page.waitForTimeout(600)
}

console.log(out.join('\n'))
console.log(out.some((l) => l.startsWith('FAIL')) ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
await browser.close()
