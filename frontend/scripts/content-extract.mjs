/* Read one lomda the way a learner sees it, screen by screen, into a JSON dump.
 *
 *   node scripts/content-extract.mjs --url <launchUrl> --out dump.json --max-screens 40
 *
 * The nightly content pipeline (backend/scripts/content_pipeline.py) runs this
 * against a sink-LRS launch, so nothing it does reaches any learner history.
 * Per screen it records the title, the visible text, the media inventory
 * (durations where the player exposes them, srcs as digests — CET urls can
 * carry tokens), and how the question renders. Lomdot keep every screen in the
 * DOM and toggle visibility, so every read filters to what is actually shown.
 *
 * Advancing: the lesson's own continue buttons first; a gated screen gets its
 * first visible option picked purely to move on (harmless against a sink,
 * recorded per screen as `advanced_by_answering`). Never backwards; the run
 * stops the moment a click changes nothing.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from 'playwright'

const argv = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  argv.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}
const url = argv.get('url')
const outPath = argv.get('out') || 'content-extract.json'
const maxScreens = Number(argv.get('max-screens') || 40)
if (!url) {
  console.error('usage: node scripts/content-extract.mjs --url <launchUrl> --out <dump.json>')
  process.exit(2)
}

const digest = (value) => `sha1:${createHash('sha1').update(String(value)).digest('hex').slice(0, 16)}`

const NEXT_BUTTONS = [
  'button:has-text("המשך")', 'button:has-text("הבא")', 'button:has-text("בחרתי")',
  'button:has-text("קדימה")', 'button:has-text("התחל")', 'button:has-text("נתחיל")',
  '.btn-continue', '[class*="continue" i]', '[aria-label*="הבא"]',
  '[aria-label*="Next"]', '.h5p-question-next-question',
  'button:has-text("Next")',
]
const COMMIT_BUTTONS = [
  'button:has-text("בדיקה")', 'button:has-text("בדוק")', 'button:has-text("שליחה")',
  '.h5p-question-check-answer',
]
const OPTION_TARGETS = [
  'label:has(input[type="radio"])', 'input[type="radio"]', '[role="radio"]',
  '.h5p-answer', '.h5p-alternative', '[class*="option" i]', '[class*="choice" i]',
  '[class*="answer" i]', '[class*="flip-card" i]', 'video',
]

const browser = await chromium.launch()
const page = await (await browser.newContext({
  locale: 'he-IL', viewport: { width: 1280, height: 860 },
})).newPage()

const finish = (payload) => {
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(payload, null, 1))
  return browser.close().then(() => process.exit(0))
}

try {
  await page.goto(url, { waitUntil: 'load', timeout: 45_000 })
} catch (error) {
  console.error(`navigation failed: ${error.message.split('\n')[0]}`)
  await finish({ frame_blocked: true, screens: [] })
}
await page.waitForTimeout(8_000) // players hydrate well after `load`

// The player may live on the page itself or inside a nested frame — read from
// whichever frame carries the most visible text.
const readingFrame = async () => {
  let best = page.mainFrame()
  let bestLength = 0
  for (const frame of page.frames()) {
    const length = await frame.evaluate(() => document.body?.innerText?.length || 0)
      .catch(() => 0)
    if (length > bestLength) { best = frame; bestLength = length }
  }
  return { frame: best, textLength: bestLength }
}

// Everything here runs inside the page; `visible` is the load-bearing filter —
// a lomda's whole deck lives in the DOM with all but one screen hidden.
const captureScreen = (frame) => frame.evaluate(() => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  const heading = [...document.querySelectorAll('h1, h2, h3, [class*="title" i]')]
    .find((el) => visible(el) && el.innerText?.trim())
  const media = []
  for (const video of document.querySelectorAll('video')) {
    if (!visible(video)) continue
    media.push({
      kind: 'video',
      duration_seconds: Number.isFinite(video.duration) && video.duration > 0
        ? Math.round(video.duration) : null,
      title: (video.getAttribute('title') || video.getAttribute('aria-label') || '').slice(0, 120),
      src: video.currentSrc || video.src || '',
    })
  }
  for (const audio of document.querySelectorAll('audio')) {
    if (!visible(audio) && !(audio.currentSrc || audio.src)) continue
    media.push({
      kind: 'audio',
      duration_seconds: Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.round(audio.duration) : null,
      title: (audio.getAttribute('title') || '').slice(0, 120),
      src: audio.currentSrc || audio.src || '',
    })
  }
  for (const img of document.querySelectorAll('img')) {
    const rect = img.getBoundingClientRect()
    if (!visible(img) || rect.width < 80 || rect.height < 80) continue
    media.push({
      kind: 'image',
      alt: (img.alt || '').slice(0, 120),
      src: img.currentSrc || img.src || '',
    })
  }
  const anyVisible = (selector) =>
    [...document.querySelectorAll(selector)].some(visible)
  const rendering = anyVisible('input[type="radio"], [role="radio"], label:has(input[type="radio"])') ? 'radio'
    : anyVisible('select, [role="listbox"]') ? 'dropdown'
      : anyVisible('[draggable="true"], .h5p-drag-draggable') ? 'drag'
        : anyVisible('input[type="text"], input[type="number"], textarea') ? 'input'
          : 'none'

  return {
    title: (heading?.innerText || document.title || '').trim().slice(0, 200),
    visible_text: (document.body?.innerText || '').trim().slice(0, 6000),
    media: media.slice(0, 12),
    question_rendering: rendering,
  }
})

/* Pointing anchors, measured in DOCUMENT PIXELS at the current viewport width.
 *
 * Pixels, not fractions of the scroll box, because vendors lay content out in
 * incompatible ways: methodica flows (positions follow text wrap), while the
 * CET player transform-SCALES a fixed design and centers it — and a transform
 * moves getBoundingClientRect without ever growing scrollHeight, so both the
 * old fractions and the old `no_internal_scroll` lied the moment the runtime
 * box differed from the capture. The capture instead measures the same screen
 * at several viewport WIDTHS (probed 2026-09-01: rects are width-determined
 * and height-independent for both vendors), and the runtime interpolates
 * between the two nearest breakpoints for its own live width. Content extent
 * comes from the union of visible element rects — the only measurement that
 * sees through a transform or an inner overflow scroller.
 *
 * Rects only, never element text or attributes (a world-readable repo must
 * not carry vendor markup, and player attributes can name answers). Region
 * names are the coach tool's static enum. `markShots` tags graphic surfaces
 * for element screenshots — only the primary-width pass does that.
 */
const measureAnchors = (frame, markShots) => frame.evaluate((withShotMarks) => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  const docRect = (el) => {
    const r = el.getBoundingClientRect()
    return {
      left: r.left + window.scrollX, top: r.top + window.scrollY,
      right: r.right + window.scrollX, bottom: r.bottom + window.scrollY,
    }
  }
  const round = (v) => Math.round(v * 10) / 10
  const toRect = (box) => ({
    x: round(box.left), y: round(box.top),
    w: round(box.right - box.left), h: round(box.bottom - box.top),
  })
  const unionBox = (elements) => {
    let box = null
    for (const el of elements) {
      if (!visible(el)) continue
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue
      const abs = docRect(el)
      box = box ? {
        left: Math.min(box.left, abs.left), top: Math.min(box.top, abs.top),
        right: Math.max(box.right, abs.right), bottom: Math.max(box.bottom, abs.bottom),
      } : abs
    }
    return box
  }
  // Matched elements nest (an option row contains its label, its input, its
  // text wrapper) — the learner-visible "parts" are the OUTERMOST rects.
  // Area-descending greedy keep: a rect mostly inside an already-kept one is
  // the same thing again, not another part.
  const outermost = (boxes) => {
    const kept = []
    for (const box of [...boxes].sort((a, b) =>
      ((b.right - b.left) * (b.bottom - b.top)) - ((a.right - a.left) * (a.bottom - a.top)))) {
      const area = Math.max(1, (box.right - box.left) * (box.bottom - box.top))
      const overlaps = kept.some((k) => {
        const w = Math.min(box.right, k.right) - Math.max(box.left, k.left)
        const h = Math.min(box.bottom, k.bottom) - Math.max(box.top, k.top)
        return w > 0 && h > 0 && (w * h) / area > 0.55
      })
      if (!overlaps) kept.push(box)
    }
    return kept.sort((a, b) => (a.top - b.top) || (a.left - b.left))
  }
  // Selector families are structural where the web gives us structure (inputs,
  // roles, tags) and class-substring where vendors only expose hashed CSS
  // modules (CET: `Question-module_label…`, `Answer-module_style…`,
  // `CustomSelect-module_comboboxTarget…`). Substrings, never exact hashes.
  const REGION_SELECTORS = {
    question: '.h5p-question-introduction, .h5p-question-content, '
      + '[class*="question-text" i], [class*="question" i][class*="label" i]',
    options: '.h5p-answer, .h5p-alternative, [role="option"], [role="radio"], '
      + 'label:has(input[type="radio"]), label:has(input[type="checkbox"]), '
      + 'input[type="radio"], input[type="checkbox"], '
      + '[class*="answer" i][class*="style" i]',
    // Fill-in controls: dropdowns, cloze blanks, free-text fields.
    input: 'select, [role="combobox"], [role="listbox"], textarea, '
      + 'input[type="text"], input[type="number"], '
      + '[class*="combobox" i], [class*="cloze" i]',
    image: 'img',
    video: 'video',
    // Interactive/graphic surfaces that are NOT <img>: a GeoGebra-style
    // applet, a plotted grid, a drawn diagram. The area floor below keeps
    // icon-sized svg/canvas out.
    diagram: 'canvas, svg, embed, object, iframe',
    table: 'table',
    instruction: '.h5p-question-introduction ~ p, [class*="instruction" i]',
  }
  // Content must OCCUPY the screen to be pointable — decorative art (the
  // mascot avatar, corner icons) passes a bare pixel floor and then gets a
  // highlight that means nothing. Area fractions of the viewport are what
  // separates a content image (~10%+) from a 90px avatar (<1%).
  const viewportArea = window.innerWidth * window.innerHeight
  const areaFraction = (el) => {
    const r = el.getBoundingClientRect()
    return (r.width * r.height) / (viewportArea || 1)
  }
  const REGION_MIN_AREA = { image: 0.02, video: 0.02, diagram: 0.03 }
  const anchors = []
  let shotMark = 0
  for (const [region, selector] of Object.entries(REGION_SELECTORS)) {
    let elements = [...document.querySelectorAll(selector)]
      .filter((el) => visible(el)
        && (typeof el.checkVisibility !== 'function' || el.checkVisibility()))
    const minArea = REGION_MIN_AREA[region]
    if (minArea) elements = elements.filter((el) => areaFraction(el) >= minArea)
    if (!elements.length) continue
    const box = unionBox(elements)
    if (!box) continue
    // Per-part rects so the coach can point at "אפשרות 2" or the second
    // image, not only the merged block. Reading order, bounded.
    const partBoxes = outermost(elements.map(docRect)).slice(0, 8)
    const rect = toRect(box)
    anchors.push(partBoxes.length > 1
      ? { region, rect, parts: partBoxes.map(toRect) }
      : { region, rect })
    // Mark the graphic surfaces for a Node-side element screenshot — the
    // vision pass turns those crops into Hebrew descriptions. Marks are
    // throwaway attributes on a throwaway browse session.
    if (withShotMarks && (region === 'image' || region === 'diagram')) {
      for (const el of elements.slice(0, 4)) {
        shotMark += 1
        el.setAttribute('data-yx-shot', String(shotMark))
      }
    }
  }
  // The real content extent: transforms and inner overflow scrollers move
  // rects without growing scrollHeight, so extent is the union of what is
  // actually painted, floored by the scroll box.
  const scrollBox = document.scrollingElement || document.documentElement
  let contentRight = 0
  let contentBottom = 0
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const abs = docRect(el)
    contentRight = Math.max(contentRight, abs.right)
    contentBottom = Math.max(contentBottom, abs.bottom)
  }
  const contentW = Math.max(scrollBox?.scrollWidth || 0, Math.round(contentRight))
  const contentH = Math.max(scrollBox?.scrollHeight || 0, Math.round(contentBottom))
  const shotMarks = !withShotMarks ? [] :
    [...document.querySelectorAll('[data-yx-shot]')].map((el) => ({
      mark: el.getAttribute('data-yx-shot'),
      kind: el.tagName === 'IMG' ? 'image' : 'diagram',
      src: el.tagName === 'IMG' ? (el.currentSrc || el.src || '') : '',
    }))
  return {
    w: window.innerWidth,
    h: window.innerHeight,
    content_w: contentW,
    content_h: contentH,
    anchors,
    shot_marks: shotMarks,
  }
}, markShots)

// Element screenshots for the marked graphic surfaces — small jpeg crops the
// nightly vision pass turns into Hebrew descriptions. Keyed back onto media
// entries by src digest (images) or in diagram order. Never committed: the
// pipeline strips the bytes after describing them.
const captureShots = async (frame, screen) => {
  const shots = []
  for (const mark of screen.shot_marks || []) {
    try {
      const el = frame.locator(`[data-yx-shot="${mark.mark}"]`).first()
      const buffer = await el.screenshot({ type: 'jpeg', quality: 55, timeout: 4000 })
      shots.push({
        kind: mark.kind,
        src_digest: mark.src ? digest(mark.src) : null,
        shot_b64: buffer.toString('base64'),
      })
    } catch { /* a crop is a bonus, never a failure */ }
  }
  delete screen.shot_marks
  return shots
}

const clickVisible = async (frame, selectors, { limit = 1 } = {}) => {
  let clicks = 0
  for (const selector of selectors) {
    const matches = frame.locator(selector)
    const count = await matches.count().catch(() => 0)
    for (let i = 0; i < count && clicks < limit; i += 1) {
      const target = matches.nth(i)
      if (!await target.isVisible().catch(() => false)) continue
      if (await target.click({ timeout: 1_500 }).then(() => true).catch(() => false)) {
        clicks += 1
      }
    }
    if (clicks >= limit) break
  }
  return clicks
}

const textHash = async (frame) =>
  digest(await frame.evaluate(() => document.body?.innerText || '').catch(() => ''))

/** Try to leave the current screen; true when the visible text changed. */
const advance = async (screen) => {
  let { frame } = await readingFrame()
  const before = await textHash(frame)
  const changed = async () => {
    await page.waitForTimeout(2_500)
    ;({ frame } = await readingFrame())
    return (await textHash(frame)) !== before
  }
  if (await clickVisible(frame, NEXT_BUTTONS) && await changed()) return true
  if (screen.media.some((m) => m.kind === 'video' || m.kind === 'audio')) {
    // Media-gated screens reveal their continue button on `ended` — seek there.
    await frame.evaluate(() => {
      for (const el of document.querySelectorAll('video, audio')) {
        const rect = el.getBoundingClientRect()
        if (rect.width < 2 && el.tagName === 'VIDEO') continue
        try {
          el.muted = true
          el.play?.()
          if (Number.isFinite(el.duration) && el.duration > 0) {
            el.currentTime = Math.max(0, el.duration - 0.2)
          }
        } catch { /* a player that refuses is just a screen we cannot pass */ }
      }
    }).catch(() => {})
    await page.waitForTimeout(3_000)
    if (await clickVisible(frame, NEXT_BUTTONS) && await changed()) return true
  }
  // Gated: engage what the screen offers (an option, a card to flip, a drag
  // pair), commit if the lesson asks, then continue.
  if (screen.question_rendering === 'drag') {
    const draggables = frame.locator('[draggable="true"], .h5p-drag-draggable')
    const zones = frame.locator('[class*="drop" i], [class*="dropzone" i], .h5p-drag-dropzone')
    const pairs = Math.min(await draggables.count(), await zones.count(), 6)
    for (let i = 0; i < pairs; i += 1) {
      await draggables.nth(i).dragTo(zones.nth(i), { timeout: 2_000 }).catch(() => {})
      await page.waitForTimeout(400)
    }
  }
  await clickVisible(frame, OPTION_TARGETS, { limit: 4 })
  await page.waitForTimeout(600)
  await clickVisible(frame, COMMIT_BUTTONS)
  await page.waitForTimeout(1_200)
  await clickVisible(frame, NEXT_BUTTONS)
  if (await changed()) {
    screen.advanced_by_answering = true
    return true
  }
  return false
}

const screens = []
const seenHashes = new Set()
const first = await readingFrame()
if (first.textLength < 40) {
  console.error('no readable content rendered — frame blocked or empty player')
  await finish({ frame_blocked: true, screens: [] })
}

// Anchor geometry is measured on a grid of viewport sizes: widths × heights.
// Width matters everywhere; height matters too — probed 2026-09-01: the CET
// player is height-independent (its two height samples come out identical, so
// runtime height-interpolation is a no-op), while methodica FITS the viewport
// (scale = min(width-fit, height-fit), content always exactly viewport-tall),
// so a 700px-tall lesson box renders smaller geometry than any fixed-height
// capture could describe. The runtime bilinear-interpolates its live box
// between the four surrounding samples — no vendor detection anywhere.
// 1280×860 is the primary capture size (screenshots, text, media read there).
const ANCHOR_WIDTHS = [820, 1024, 1280, 1440, 1680, 1920]
const ANCHOR_HEIGHTS = [640, 860]
const PRIMARY_WIDTH = 1280
const PRIMARY_HEIGHT = 860

for (let index = 0; index < maxScreens; index += 1) {
  const { frame } = await readingFrame()
  const captured = await captureScreen(frame).catch(() => null)
  if (!captured) break
  const hash = digest(captured.visible_text)
  if (seenHashes.has(hash)) break // a click that changed nothing means the end
  seenHashes.add(hash)
  // Geometry pass: primary width first (it also marks the graphic surfaces
  // for element screenshots), then the other widths, then restore — the
  // advance clicks below must land on the primary layout.
  const primary = await measureAnchors(frame, true).catch(() => null)
  captured.shot_marks = primary?.shot_marks || []
  // Diagram surfaces are not <img> and never made it into `media` — add them
  // so the vision description has a row to live on.
  for (const mark of captured.shot_marks) {
    if (mark.kind === 'diagram') captured.media.push({ kind: 'diagram', title: '', src: '' })
  }
  captured.media = captured.media.slice(0, 12)
  const shots = await captureShots(frame, captured)
  const breakpoints = []
  if (primary) {
    breakpoints.push({
      w: primary.w, h: primary.h, content_w: primary.content_w,
      content_h: primary.content_h, anchors: primary.anchors,
    })
    for (const width of ANCHOR_WIDTHS) {
      for (const height of ANCHOR_HEIGHTS) {
        if (width === PRIMARY_WIDTH && height === PRIMARY_HEIGHT) continue
        await page.setViewportSize({ width, height })
        await page.waitForTimeout(450)
        const measured = await measureAnchors(frame, false).catch(() => null)
        if (measured?.anchors?.length) {
          breakpoints.push({
            w: measured.w, h: measured.h, content_w: measured.content_w,
            content_h: measured.content_h, anchors: measured.anchors,
          })
        }
      }
    }
    await page.setViewportSize({ width: PRIMARY_WIDTH, height: PRIMARY_HEIGHT })
    await page.waitForTimeout(450)
  }
  breakpoints.sort((a, b) => (a.w - b.w) || (a.h - b.h))
  captured.anchors = primary?.anchors || []
  captured.anchor_breakpoints = breakpoints
  captured.capture_viewport = {
    w: PRIMARY_WIDTH, h: 860,
    scroll_w: primary?.content_w || 0, scroll_h: primary?.content_h || 0,
  }
  captured.no_internal_scroll = (primary?.content_h || 0) <= 860 * 1.05
  captured.media = captured.media.map(({ src, ...rest }) => ({
    ...rest, src_digest: src ? digest(src) : null,
  }))
  // Hand each crop to its media row: images by src digest, diagrams in order.
  const diagramShots = shots.filter((s) => s.kind === 'diagram')
  for (const entry of captured.media) {
    if (entry.kind === 'diagram') {
      const shot = diagramShots.shift()
      if (shot) entry.shot_b64 = shot.shot_b64
    } else if (entry.src_digest) {
      const shot = shots.find((s) => s.src_digest === entry.src_digest)
      if (shot) entry.shot_b64 = shot.shot_b64
    }
  }
  captured.index = index
  captured.advanced_by_answering = false
  screens.push(captured)
  console.log(`screen ${index}: "${captured.title.slice(0, 60)}" `
    + `(${captured.visible_text.length} chars, ${captured.media.length} media, `
    + `${captured.question_rendering})`)
  if (!await advance(captured)) break
}

console.log(`captured ${screens.length} screens`)
await finish({
  captured_at: new Date().toISOString(),
  url_host: new URL(url).host,
  screens,
})
