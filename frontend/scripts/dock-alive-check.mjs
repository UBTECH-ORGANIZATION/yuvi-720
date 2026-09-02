/* The companion dock, in a real browser.
 *
 * What only a browser can answer here:
 *
 *   - **Where Yuvi actually is.** He is drawn by WebGL, so his position is not
 *     in any CSS box. He is keyed against a flat colour and measured, which is
 *     how the original report's premise ("he renders left of his tooltip") was
 *     shown to be the wrong way round: he is centred, and the tooltip was not.
 *   - **The orbit inherits the scroll fade.** That is a claim about ancestry
 *     plus computed opacity, not about a rule existing.
 *   - **The label fits its ring.** Bent text on a shorter radius either fits or
 *     collides, and only layout knows which.
 *
 * Never `waitUntil: 'networkidle'` — the learner shell holds an SSE connection.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/dock-alive'
const LEARNER = 'gal'
const DASHBOARD = `${BASE}/student-dashboard`
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const signIn = async (context) => {
  const response = await context.request.post(`${BASE}/api/auth/login`,
    { data: { username: LEARNER, password: 'Aa12345' } })
  if (!response.ok()) throw new Error(`login failed: ${response.status()}`)
}

/** Yuvi's drawn centre, as a fraction of his canvas. */
const inkCentre = async (page) => {
  await page.addStyleTag({ content: `
    .Yuvi-companion-dock__robot { background: #f0f !important; filter: none !important; }
    .Yuvi-companion-dock__base, .Yuvi-companion-dock__thrusters { visibility: hidden !important; }
  ` })
  await page.waitForTimeout(400)
  const shot = (await page.locator('.Yuvi-companion-dock__robot').screenshot()).toString('base64')
  return page.evaluate(async (data) => {
    const img = new Image()
    img.src = `data:image/png;base64,${data}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, c.width, c.height).data
    let min = Infinity
    let max = -Infinity
    for (let y = 0; y < c.height; y += 1) {
      for (let x = 0; x < c.width; x += 1) {
        const i = (y * c.width + x) * 4
        if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] > 200) continue
        if (x < min) min = x
        if (x > max) max = x
      }
    }
    const box = document.querySelector('.Yuvi-companion-dock__robot').getBoundingClientRect()
    return max < 0 ? null : box.x + ((min + max) / 2 / c.width) * box.width
  }, shot)
}

const browser = await chromium.launch()

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  await signIn(context)
  await context.request.patch(`${BASE}/api/auth/preferences`,
    { data: { language: 'he' }, failOnStatusCode: false })
  const page = await context.newPage()
  await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.Yuvi-companion-dock__robot canvas', { timeout: 60000 })
  await page.waitForTimeout(5000)

  // ── the orbit is back, and smaller than the 174px original ───────────────
  const rings = await page.evaluate(() => {
    const outer = document.querySelector('.Yuvi-companion-dock__ring--outer')
    const inner = document.querySelector('.Yuvi-companion-dock__ring--inner')
    const dock = document.querySelector('.Yuvi-companion-dock')
    if (!outer || !inner || !dock) return null
    // `offsetWidth`, not the bounding box: the ring is mid-spin, and a rotated
    // square's bounding box is up to 1.41x its layout size.
    return {
      outer: outer.offsetWidth,
      inner: inner.offsetWidth,
      dock: dock.offsetWidth,
      nodes: outer.querySelectorAll('.Yuvi-companion-dock__orbit-node').length,
      spins: getComputedStyle(outer).animationName !== 'none',
    }
  })
  check('an orbit renders behind Yuvi', rings !== null && rings.outer > 0,
        rings ? `${rings.outer}px outer, ${rings.inner}px inner` : '')
  check('it is noticeably smaller than the 174px original',
        rings !== null && rings.outer <= 130, `${rings?.outer}px`)
  check('it fits inside the dock', rings !== null && rings.outer < rings.dock,
        `dock ${rings?.dock}px`)
  check('the orbit nodes ride the ring', rings?.nodes === 2, `${rings?.nodes} nodes`)
  check('the ring turns', rings?.spins === true)

  /* Ancestry, not a rule: nesting is the whole point — the scroll fade already
     exists on the dock and must not be re-implemented for the orbit. */
  const nested = await page.evaluate(() => {
    const dock = document.querySelector('.Yuvi-companion-dock')
    const ring = document.querySelector('.Yuvi-companion-dock__ring--outer')
    const label = document.querySelector('.Yuvi-companion-dock__orbit-label')
    return Boolean(dock && ring && label && dock.contains(ring) && dock.contains(label))
  })
  check('the orbit lives inside the dock, so the scroll fade covers it', nested)

  // ── Yuvi agrees with his own tooltip ─────────────────────────────────────
  await page.hover('.Yuvi-companion-dock__robot')
  await page.waitForTimeout(600)
  const tooltipUp = await page.evaluate(() =>
    Number(getComputedStyle(document.querySelector('.Yuvi-companion-dock__tooltip')).opacity))
  check('the tooltip appears on hover', tooltipUp > 0.9, `opacity ${tooltipUp}`)

  const labelUp = await page.evaluate(() =>
    Number(getComputedStyle(document.querySelector('.Yuvi-companion-dock__orbit-label')).opacity))
  check('the circled text appears on hover', labelUp > 0.9, `opacity ${labelUp}`)

  const labelFits = await page.evaluate(() => {
    const glyphs = [...document.querySelectorAll('.Yuvi-companion-dock__orbit-label > span > span')]
    if (!glyphs.length) return null
    const boxes = glyphs.map((g) => g.getBoundingClientRect())
    const onScreen = boxes.every((b) => b.left >= 0 && b.top >= 0
      && b.right <= innerWidth && b.bottom <= innerHeight)
    let overlaps = 0
    for (let i = 1; i < boxes.length; i += 1) {
      const a = boxes[i - 1]
      const b = boxes[i]
      const dx = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      const dy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
      if (dx * dy > 6) overlaps += 1
    }
    return { count: glyphs.length, onScreen, overlaps }
  })
  check('every glyph of the circled text is on screen', labelFits?.onScreen === true,
        `${labelFits?.count} glyphs`)
  check('the circled text does not collide with itself', labelFits?.overlaps === 0,
        `${labelFits?.overlaps} overlaps`)

  /* Both are revealed by the same hover, so they share a moment as well as a
     corner. Bent text hiding behind the bubble is worse than no bent text. */
  const versusTooltip = await page.evaluate(() => {
    const tip = document.querySelector('.Yuvi-companion-dock__tooltip').getBoundingClientRect()
    const glyphs = [...document.querySelectorAll('.Yuvi-companion-dock__orbit-label > span > span')]
    let hidden = 0
    for (const glyph of glyphs) {
      const b = glyph.getBoundingClientRect()
      const dx = Math.max(0, Math.min(tip.right, b.right) - Math.max(tip.left, b.left))
      const dy = Math.max(0, Math.min(tip.bottom, b.bottom) - Math.max(tip.top, b.top))
      if (dx * dy > 4) hidden += 1
    }
    return hidden
  })
  check('the circled text is not hidden behind the tooltip', versusTooltip === 0,
        `${versusTooltip} glyphs behind it`)

  const framed = await page.locator('.Yuvi-companion-dock').boundingBox()
  await page.screenshot({ path: `${OUT}/dock-hover.png`,
    clip: { x: framed.x - 150, y: framed.y - 90, width: framed.width + 200, height: framed.height + 110 } })

  const yuviX = await inkCentre(page)
  const arrow = await page.evaluate(() => {
    const tip = document.querySelector('.Yuvi-companion-dock__tooltip').getBoundingClientRect()
    const after = getComputedStyle(document.querySelector('.Yuvi-companion-dock__tooltip'), '::after')
    // Centred on the bubble now, so the arrow's centre is the bubble's centre.
    return after.left === 'auto' ? tip.right - 26 : tip.x + tip.width / 2
  })
  check('Yuvi sits where his tooltip points',
        yuviX !== null && Math.abs(arrow - yuviX) <= 8,
        `${Math.round(Math.abs(arrow - yuviX))}px apart`)

  const corner = await page.evaluate(() => {
    const b = document.querySelector('.Yuvi-companion-dock').getBoundingClientRect()
    return { right: Math.round(innerWidth - b.right), bottom: Math.round(innerHeight - b.bottom) }
  })
  check('he is nearer the corner than the old 16px', corner.right < 16 && corner.bottom < 16,
        `${corner.right}px / ${corner.bottom}px`)

  // ── he notices a cursor coming near ──────────────────────────────────────
  await page.mouse.move(200, 200)
  await page.waitForTimeout(400)
  const far = await page.evaluate(() =>
    document.querySelector('.Yuvi-companion-dock').classList.contains('is-near'))
  await page.mouse.move(1250, 880)
  await page.waitForTimeout(400)
  const near = await page.evaluate(() =>
    document.querySelector('.Yuvi-companion-dock').classList.contains('is-near'))
  check('he does not react to a cursor across the page', far === false)
  check('he reacts when the cursor comes near', near === true)

  // ── the scroll fade still covers the whole assembly ──────────────────────
  await page.mouse.move(200, 200)
  await page.evaluate(() => window.scrollBy(0, 300))
  /* Inside the window on purpose: the fade takes 220ms to land and the class
     clears 650ms after scrolling stops, so both ends miss it. */
  await page.waitForTimeout(400)
  const faded = await page.evaluate(() => {
    const dock = document.querySelector('.Yuvi-companion-dock')
    return { faded: dock.classList.contains('is-scrolling'),
             opacity: Number(getComputedStyle(dock).opacity) }
  })
  check('the whole assembly fades on scroll', faded.faded && faded.opacity < 0.5,
        `opacity ${faded.opacity}`)
  await page.waitForTimeout(900)

  // ── the dock still gets out of the way ───────────────────────────────────
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await page.locator('.Yuvi-companion-dock__portal').click()
  await page.waitForTimeout(2200)
  const hidden = await page.evaluate(() => {
    const dock = document.querySelector('.Yuvi-companion-dock')
    return Number(getComputedStyle(dock).opacity)
  })
  check('the dock hides once the chat is open', hidden < 0.1, `opacity ${hidden}`)

  // ── the corner is physical in every language ─────────────────────────────
  for (const language of ['he', 'ar', 'en']) {
    const languageContext = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
    await signIn(languageContext)
    await languageContext.request.patch(`${BASE}/api/auth/preferences`,
      { data: { language }, failOnStatusCode: false })
    const languagePage = await languageContext.newPage()
    await languagePage.goto(DASHBOARD, { waitUntil: 'domcontentloaded' })
    await languagePage.waitForSelector('.Yuvi-companion-dock', { timeout: 60000 })
    await languagePage.waitForTimeout(2500)
    await languagePage.hover('.Yuvi-companion-dock__robot').catch(() => {})
    await languagePage.waitForTimeout(500)
    const shape = await languagePage.evaluate(() => {
      const dock = document.querySelector('.Yuvi-companion-dock').getBoundingClientRect()
      const tip = document.querySelector('.Yuvi-companion-dock__tooltip').getBoundingClientRect()
      return {
        dir: document.documentElement.getAttribute('dir'),
        onRight: dock.x > innerWidth / 2,
        tipInside: tip.left >= 0 && tip.right <= innerWidth,
        tipRight: Math.round(innerWidth - tip.right),
      }
    })
    check(`${language}: Yuvi keeps the physical right corner`, shape.onRight, shape.dir)
    check(`${language}: the tooltip stays on screen`, shape.tipInside,
          `${shape.tipRight}px from the edge`)
    await languageContext.close()
  }

  // ── reduced motion ───────────────────────────────────────────────────────
  const calm = await browser.newContext({ viewport: { width: 1400, height: 1000 },
                                          reducedMotion: 'reduce' })
  await signIn(calm)
  const calmPage = await calm.newPage()
  await calmPage.goto(DASHBOARD, { waitUntil: 'domcontentloaded' })
  await calmPage.waitForSelector('.Yuvi-companion-dock__ring--outer', { timeout: 60000 })
  await calmPage.waitForTimeout(1500)
  const still = await calmPage.evaluate(() => ({
    outer: getComputedStyle(document.querySelector('.Yuvi-companion-dock__ring--outer')).animationName,
    inner: getComputedStyle(document.querySelector('.Yuvi-companion-dock__ring--inner')).animationName,
  }))
  check('the rings do not spin when less motion was asked for',
        still.outer === 'none' && still.inner === 'none', JSON.stringify(still))
  await calm.close()
  await context.close()
} finally {
  await browser.close()
}

console.log(failures.length ? `\n✘ ${failures.length} failed` : '\n✔ all good')
process.exitCode = failures.length ? 1 : 0
