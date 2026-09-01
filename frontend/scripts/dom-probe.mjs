/* One-off DOM grammar probe: open a lomda launch, dump the visible element
 * families of the first screen (tag, classes, role, rect, text head) so anchor
 * selectors can be grounded in the vendor's real markup. Throwaway tool. */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const url = process.argv[2]
const out = process.argv[3] || 'dom-probe.json'
const sizes = [[1850, 860], [1850, 640], [1024, 860]]

const browser = await chromium.launch()
const page = await (await browser.newContext({
  locale: 'he-IL', viewport: { width: 1280, height: 860 },
})).newPage()
await page.goto(url, { waitUntil: 'load', timeout: 45_000 })
await page.waitForTimeout(9_000)

const readingFrame = async () => {
  let best = page.mainFrame(); let bestLength = 0
  for (const frame of page.frames()) {
    const length = await frame.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0)
    if (length > bestLength) { best = frame; bestLength = length }
  }
  return best
}

const snapshot = (frame) => frame.evaluate(() => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width < 6 || rect.height < 6) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  const rows = []
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    const text = (el.childNodes.length && [...el.childNodes]
      .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ')) || ''
    rows.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className && String(el.className)).slice(0, 120) || '',
      role: el.getAttribute('role') || '',
      type: el.getAttribute('type') || '',
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      text: text.slice(0, 60),
      kids: el.children.length,
    })
  }
  return {
    scroll: {
      w: (document.scrollingElement || document.documentElement).scrollWidth,
      h: (document.scrollingElement || document.documentElement).scrollHeight,
      innerW: innerWidth, innerH: innerHeight,
    },
    rows,
  }
})

const result = {}
for (const [w, h] of sizes) {
  await page.setViewportSize({ width: w, height: h })
  await page.waitForTimeout(800)
  const frame = await readingFrame()
  result[`${w}x${h}`] = await snapshot(frame)
  console.log(`${w}x${h}: ${result[`${w}x${h}`].rows.length} elements`)
}
writeFileSync(out, JSON.stringify(result, null, 1))
await browser.close()
