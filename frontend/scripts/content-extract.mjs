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
 *
 * Capture v8 adds the OBJECT census (`atoms`): every thing on the screen a
 * coach could mean — each answer row, input, picture, video, table (+ rows,
 * columns), formula, text block and the inner parts of an SVG drawing —
 * measured, clip-aware, at every grid size. Atom TEXT lives only in this dump
 * (a local/runner temp file): the pipeline matches it against the catalog
 * and writes ids, kinds and roles to the shard, never the vendor's words.
 *
 *   --audit-dir <dir>   also save, per screen, a clean screenshot and one with
 *                       every atom's number drawn on it (local review only)
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'
import { classifyLayout, gridRows, sameRect } from './lib/content-geometry.mjs'

const argv = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  argv.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}
const url = argv.get('url')
const outPath = argv.get('out') || 'content-extract.json'
const maxScreens = Number(argv.get('max-screens') || 40)
const auditDir = argv.get('audit-dir') || ''
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

// The player narrates its own position over the wire, and the page id it
// uses appears NOWHERE in the DOM — the wire is the only place to learn it.
// CET posts `{"eventType":"page","verb":"viewed",…,"pageContentId":"…"}` to
// its own /api/xapi-events/ (Kata later turns these into the `initialized`
// statements a live learner's relay carries, object `…/{pageContentId}`);
// other vendors may post real xAPI statements. Recording which ids fire
// between screen advances pairs each captured screen with the exact id the
// runtime will see in navigation/resume events. Ids only — bodies are never
// persisted.
const xapiObjectTails = []
const PAGE_CONTENT_ID = /"pageContentId"\s*:\s*"([^"]+)"/g
const XAPI_OBJECT_ID = /"object"\s*:\s*\{[^}]*?"id"\s*:\s*"([^"]+)"/g
page.on('request', (request) => {
  if (request.method() !== 'POST' && request.method() !== 'PUT') return
  if (!/statements|xapi-events/i.test(request.url())) return
  const body = request.postData() || ''
  for (const match of body.matchAll(PAGE_CONTENT_ID)) {
    if (match[1]) xapiObjectTails.push(match[1])
  }
  for (const match of body.matchAll(XAPI_OBJECT_ID)) {
    const tail = match[1].replace(/\/+$/, '').split('/').pop() || ''
    if (tail) xapiObjectTails.push(tail)
  }
})
const drainObjectTails = () => xapiObjectTails.splice(0, xapiObjectTails.length)

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
// Embedded media players are never the lesson: a CET video page embeds
// YouTube, whose frame can out-text the player and then every "next" click
// lands inside YouTube (PLOT-00001 stopped at page 3 of 9 on 2026-09-24).
const MEDIA_EMBED = /(^|\.)(youtube(-nocookie)?\.com|youtu\.be|vimeo\.com|ytimg\.com)$/i
const readingFrame = async () => {
  let best = page.mainFrame()
  let bestLength = 0
  for (const frame of page.frames()) {
    let host = ''
    try { host = new URL(frame.url()).host } catch { /* about:blank etc. */ }
    if (host && MEDIA_EMBED.test(host)) continue
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

/* The object census (capture v8), measured in DOCUMENT PIXELS.
 *
 * `tag: true` (the primary size) enumerates the atoms and tags each element
 * `data-yx-obj=<n>`; every later call re-measures the SAME elements by tag, so
 * an atom's rect at 820px and at 1920px are provably the same thing.
 *
 * Visibility is clip-aware: an element counts only when ≥60% of it survives
 * every overflow-clipping ancestor and CSS says it is visible (opacity and
 * visibility included). That is what kept inactive tabs, collapsed feedback
 * panels and off-canvas slides out — they produced the negative coordinates
 * and the 177%-of-the-viewport "image" unions of capture v7.
 */
const measureObjects = (frame, tag) => frame.evaluate((withTags) => {
  const root = document.scrollingElement || document.documentElement
  const vw = window.innerWidth
  const vh = window.innerHeight
  const sx = window.scrollX
  const sy = window.scrollY
  const intersect = (a, b) => {
    const box = {
      left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
    }
    return box.right > box.left && box.bottom > box.top ? box : null
  }
  const area = (b) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top)
  const clipped = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return null
    let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    for (let node = el.parentElement; node && node !== document.body && node !== root;
      node = node.parentElement) {
      const style = getComputedStyle(node)
      if (/(hidden|clip|auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY)) {
        box = intersect(box, node.getBoundingClientRect())
        if (!box) return null
      }
    }
    return { box, raw: r.width * r.height }
  }
  const shown = (el) => {
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') return null
    if (typeof el.checkVisibility === 'function'
      && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null
    const c = clipped(el)
    if (!c || area(c.box) < 0.6 * c.raw) return null
    return c.box
  }
  const docRect = (box) => ({
    x: Math.round((box.left + sx) * 10) / 10, y: Math.round((box.top + sy) * 10) / 10,
    w: Math.round((box.right - box.left) * 10) / 10,
    h: Math.round((box.bottom - box.top) * 10) / 10,
  })
  // Honest extent: what is painted and not fixed to the viewport, with no
  // floor at the viewport height (v7 floored it and invented overflow).
  const extent = () => {
    let right = 0
    let bottom = 0
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el)
      if (style.position === 'fixed' || style.display === 'none'
        || style.visibility === 'hidden') continue
      const c = clipped(el)
      if (!c) continue
      right = Math.max(right, c.box.right + sx)
      bottom = Math.max(bottom, c.box.bottom + sy)
    }
    return { content_w: Math.round(Math.max(right, Math.min(root.scrollWidth, vw))),
      content_h: Math.round(bottom) }
  }

  if (!withTags) {
    const rects = {}
    for (const el of document.querySelectorAll('[data-yx-obj]')) {
      const box = shown(el)
      rects[el.getAttribute('data-yx-obj')] = box ? docRect(box) : null
    }
    return { w: vw, h: vh, ...extent(), rects,
      inner_scroll: Math.max(0, root.scrollHeight - vh) }
  }

  // A new screen re-tags from scratch: lomdot keep earlier screens in the
  // DOM, and their stale numbers would collide with this screen's.
  for (const el of document.querySelectorAll('[data-yx-obj]')) el.removeAttribute('data-yx-obj')
  const OPTION = '.h5p-answer, .h5p-alternative, [role="option"], [role="radio"], '
    + 'label:has(input[type="radio"]), label:has(input[type="checkbox"]), '
    + '[class*="answer" i][class*="style" i]'
  const INPUT = 'select, [role="combobox"], textarea, input[type="text"], '
    + 'input[type="number"], [class*="combobox" i], [class*="cloze" i]'
  const TEXT = 'p, li, h1, h2, h3, h4, blockquote, legend, figcaption, label, '
    + '[class*="question" i], [class*="instruction" i]'
  const FAMILIES = [
    ['option', OPTION], ['input', INPUT], ['image', 'img'], ['video', 'video'],
    ['diagram', 'canvas, svg, embed, object, iframe'], ['table', 'table'],
    ['formula', 'mjx-container, .katex, math'], ['text', TEXT],
  ]
  // Area floors (fraction of the viewport) keep icons and the mascot out.
  const FLOOR = { image: 0.015, video: 0.02, diagram: 0.03 }
  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  // Occlusion: a flip card's back face is "visible" to CSS while the picture
  // on its front covers it (measured on mass-measure-02-01: three hidden
  // captions sat on the photos). What is on top at the atom's centre must be
  // the atom itself, something inside it, or something it sits inside.
  const onTop = (el, box) => {
    const cx = (box.left + box.right) / 2
    const cy = (box.top + box.bottom) / 2
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) return true // cannot test off-screen
    const hit = document.elementFromPoint(cx, cy)
    return !hit || hit === el || el.contains(hit) || hit.contains(el)
  }
  const OCCLUDABLE = new Set(['text', 'formula', 'table', 'table_row', 'table_col',
    'table_cell'])
  const atoms = []
  const claimed = new Set()
  const add = (el, kind, extra = {}) => {
    if (claimed.has(el) || atoms.length >= 60) return null
    const box = shown(el)
    if (!box) return null
    if (OCCLUDABLE.has(kind) && !onTop(el, box)) return null
    claimed.add(el)
    const atom = { n: atoms.length + 1, kind, el, rect: docRect(box),
      text: textOf(el).slice(0, 300), ...extra }
    atoms.push(atom)
    return atom
  }
  for (const [kind, selector] of FAMILIES) {
    let elements = [...document.querySelectorAll(selector)]
    if (FLOOR[kind]) {
      elements = elements.filter((el) => {
        const r = el.getBoundingClientRect()
        return (r.width * r.height) / (vw * vh || 1) >= FLOOR[kind]
      })
    }
    // Svgs nested in a bigger svg are parts, handled below.
    if (kind === 'diagram') elements = elements.filter((el) => !el.parentElement?.closest('svg'))
    if (kind === 'option' || kind === 'input') {
      // outermost only: an option row contains its label, input, text span
      elements = elements.filter((el) => !elements.some((o) => o !== el && o.contains(el)))
    }
    if (kind === 'text') {
      // leaf text blocks (plus question/instruction containers), never text
      // that already belongs to an option row
      elements = elements.filter((el) => {
        const t = textOf(el)
        if (t.length < 3 || t.length > 600) return false
        if ([...claimed].some((c) => c.contains(el))) return false
        const named = /question|instruction/i.test(el.className?.baseVal ?? el.className ?? '')
        return named || !el.querySelector(TEXT)
      })
    }
    for (const el of elements) {
      const extra = {}
      if (kind === 'image') extra.src = el.currentSrc || el.src || ''
      if (kind === 'option' || kind === 'input') extra.interactive = true
      add(el, kind, extra)
    }
  }
  // Tables: rows (≤12) and, when the grid is regular, columns (≤8).
  for (const table of atoms.filter((a) => a.kind === 'table').map((a) => a.el)) {
    const rows = [...table.querySelectorAll('tr')].slice(0, 12)
    for (const row of rows) add(row, 'table_row')
    const regular = rows.length > 1 && rows.every((r) =>
      [...r.children].every((c) => (c.colSpan || 1) === 1 && (c.rowSpan || 1) === 1)
      && r.children.length === rows[0].children.length)
    if (regular) {
      for (let k = 0; k < Math.min(rows[0].children.length, 8); k += 1) {
        // A column is not one element: tag its header cell, carry the member
        // cells so the pipeline can union them per size.
        const cells = rows.map((r) => r.children[k]).filter(Boolean)
        const head = add(cells[0], 'table_col')
        if (head) {
          head.members = cells.slice(1).map((cell) => {
            const member = add(cell, 'table_cell')
            return member ? member.n : null
          }).filter(Boolean)
        }
      }
    }
  }
  // SVG drawings: labelled points, texts and small groups (≤40 per drawing).
  for (const svg of atoms.filter((a) => a.kind === 'diagram' && a.el.tagName.toLowerCase() === 'svg')
    .map((a) => a.el)) {
    const parts = [...svg.querySelectorAll('circle, ellipse, text, g')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width * r.height < 0.25 * vw * vh
      }).slice(0, 40)
    for (const el of parts) {
      const style = getComputedStyle(el)
      add(el, 'svg_part', { tag: el.tagName.toLowerCase(),
        interactive: style.cursor === 'pointer' || el.hasAttribute('onclick') })
    }
  }
  // Parent = the smallest other atom that contains this one in the DOM.
  for (const atom of atoms) {
    let best = null
    for (const other of atoms) {
      if (other === atom || !other.el.contains(atom.el)) continue
      if (!best || best.el.contains(other.el)) best = other
    }
    atom.parent = best ? best.n : null
    atom.el.setAttribute('data-yx-obj', String(atom.n))
  }
  const order = [...document.querySelectorAll('[data-yx-obj]')]
  return {
    w: vw, h: vh, ...extent(), inner_scroll: Math.max(0, root.scrollHeight - vh),
    atoms: atoms.map(({ el, ...rest }) => ({
      ...rest, order: order.indexOf(el), tag: rest.tag || el.tagName.toLowerCase(),
      draggable: el.getAttribute('draggable') === 'true',
    })),
  }
}, tag)

// Local review only: draw every atom's number where it sits, screenshot,
// remove. Never runs in CI — the flag is only passed by content_audit.py.
const auditShots = async (frame, index, atoms) => {
  if (!auditDir) return null
  mkdirSync(auditDir, { recursive: true })
  const stem = join(auditDir, `screen-${String(index).padStart(2, '0')}`)
  let offset = { x: 0, y: 0 }
  if (frame !== page.mainFrame()) {
    const handle = await frame.frameElement().catch(() => null)
    const box = handle ? await handle.boundingBox().catch(() => null) : null
    if (box) offset = { x: box.x, y: box.y }
  }
  const scroll = await frame.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
    .catch(() => ({ x: 0, y: 0 }))
  await page.screenshot({ path: `${stem}-clean.png` }).catch(() => {})
  await frame.evaluate((list) => {
    const layer = document.createElement('div')
    layer.id = '__yx_audit'
    layer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:2147483647'
    for (const a of list) {
      const box = document.createElement('div')
      box.style.cssText = `position:absolute;left:${a.rect.x}px;top:${a.rect.y}px;`
        + `width:${a.rect.w}px;height:${a.rect.h}px;outline:2px solid rgba(220,30,90,.8)`
      const label = document.createElement('span')
      label.textContent = String(a.n)
      label.style.cssText = 'position:absolute;left:0;top:0;background:#dc1e5a;color:#fff;'
        + 'font:bold 11px/14px sans-serif;padding:0 3px;border-radius:3px'
      box.appendChild(label)
      layer.appendChild(box)
    }
    document.body.appendChild(layer)
  }, atoms.map((a) => ({ n: a.n, rect: a.rect }))).catch(() => {})
  await page.screenshot({ path: `${stem}-marks.png` }).catch(() => {})
  await frame.evaluate(() => document.getElementById('__yx_audit')?.remove()).catch(() => {})
  return { offset, scroll, clean: `${stem}-clean.png`, marks: `${stem}-marks.png` }
}

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

/** Answer every visible dropdown so a gated screen lets the walk move on
 *  (CET gates pages behind `CustomSelect` comboboxes — measured 2026-09-24:
 *  PLOT-00001 stopped at page 2 of 9 because only radios were ever clicked).
 *  Native <select>: pick the first real option. Custom combobox: open it, then
 *  click the first option its listbox shows. Any answer will do — the launch
 *  is a sink, nothing is graded against a learner. */
const fillDropdowns = async (frame) => {
  const natives = frame.locator('select')
  for (let i = 0; i < Math.min(await natives.count().catch(() => 0), 8); i += 1) {
    const select = natives.nth(i)
    if (!await select.isVisible().catch(() => false)) continue
    const value = await select.evaluate((el) =>
      [...el.options].find((o) => o.value && !o.disabled)?.value || '').catch(() => '')
    if (value) await select.selectOption(value).catch(() => {})
  }
  const customs = frame.locator('[role="combobox"], [class*="combobox" i]')
  for (let i = 0; i < Math.min(await customs.count().catch(() => 0), 8); i += 1) {
    const box = customs.nth(i)
    if (!await box.isVisible().catch(() => false)) continue
    if (!await box.click({ timeout: 1_500 }).then(() => true).catch(() => false)) continue
    await page.waitForTimeout(300)
    const options = frame.locator('[role="option"], [role="listbox"] li, [class*="option" i]')
    for (let k = 0; k < Math.min(await options.count().catch(() => 0), 12); k += 1) {
      const option = options.nth(k)
      if (await option.isVisible().catch(() => false)
        && await option.click({ timeout: 1_000 }).then(() => true).catch(() => false)) break
    }
    await page.waitForTimeout(250)
  }
}

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
  await fillDropdowns(frame)
  await clickVisible(frame, OPTION_TARGETS, { limit: 4 })
  await page.waitForTimeout(600)
  await clickVisible(frame, COMMIT_BUTTONS)
  await page.waitForTimeout(1_200)
  await clickVisible(frame, NEXT_BUTTONS)
  if (await changed()) {
    screen.advanced_by_answering = true
    return true
  }
  // Explore-gated: "לחצו על התמונות" pages unlock their continue button only
  // after each card/picture was opened (mass-measure-02-01 stopped at screen
  // 4 of 14 on 2026-09-24). Open every large picture, close what pops up,
  // then continue.
  const pictures = frame.locator('img, figure, [class*="card" i]')
  const count = Math.min(await pictures.count().catch(() => 0), 12)
  let opened = 0
  for (let i = 0; i < count && opened < 6; i += 1) {
    const picture = pictures.nth(i)
    const box = await picture.boundingBox().catch(() => null)
    if (!box || box.width * box.height < 0.02 * 1280 * 860) continue
    if (await picture.click({ timeout: 1_500 }).then(() => true).catch(() => false)) {
      opened += 1
      await page.waitForTimeout(700)
      await page.keyboard.press('Escape').catch(() => {})
      await clickVisible(frame, ['[aria-label*="סגור"]', '[aria-label*="Close" i]',
        'button:has-text("סגירה")', 'button:has-text("×")'])
    }
  }
  if (opened) {
    await clickVisible(frame, NEXT_BUTTONS)
    if (await changed()) {
      screen.advanced_by_answering = true
      return true
    }
  }
  if (process.env.DEBUG_ADVANCE) {
    const controls = await frame.evaluate(() => [...document.querySelectorAll(
      'button, [role="button"], a, [class*="card" i], img')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'
    }).slice(0, 40).map((el) => `${el.tagName}.${String(el.className?.baseVal ?? el.className).slice(0, 60)}`
      + ` "${(el.innerText || el.alt || '').trim().slice(0, 30)}"`
      + `${el.disabled || el.getAttribute('aria-disabled') === 'true' ? ' [disabled]' : ''}`))
      .catch(() => [])
    console.error(`stuck on screen "${screen.title.slice(0, 40)}":\n  ${controls.join('\n  ')}`)
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
// 480: a Chromebook lesson box with the chat open is ~890×475, below 640's
// interpolation tolerance — every mark there fell back to a whole-frame glow.
const ANCHOR_HEIGHTS = [480, 640, 860]
// Tall probes for height-independent screens: does a frame as tall as the
// content show the same geometry with no inner scroll? (The tall-frame
// experiment needs a yes per slide before it may size the frame.)
const TALL_WIDTHS = [1024, 1440]
const TALL_MAX = 2400
const PRIMARY_WIDTH = 1280
const PRIMARY_HEIGHT = 860

for (let index = 0; index < maxScreens; index += 1) {
  const { frame } = await readingFrame()
  // A gate the walker just filled (a dropdown, a combobox) can leave its list
  // OPEN: that popup is not the screen, and measuring it recorded transient
  // "options" over the inputs (09-24 audit, CET PLOT-00001 page 2). Close it.
  await page.keyboard.press('Escape').catch(() => {})
  await frame.evaluate(() => {
    const active = document.activeElement
    if (active && active !== document.body && typeof active.blur === 'function') active.blur()
  }).catch(() => {})
  await page.waitForTimeout(150)
  const captured = await captureScreen(frame).catch(() => null)
  if (!captured) break
  const hash = digest(captured.visible_text)
  if (seenHashes.has(hash)) break // a click that changed nothing means the end
  seenHashes.add(hash)
  // The object ids the player announced while ARRIVING at this screen —
  // everything since the previous screen's capture. The pipeline pairs the
  // page-shaped one with this slide.
  captured.vendor_page_ids = [...new Set(drainObjectTails())]
    .filter((tail) => tail.length >= 6 && !/^q\d+$/i.test(tail))
  // Geometry pass: primary width first (it also marks the graphic surfaces
  // for element screenshots), then the other widths, then restore — the
  // advance clicks below must land on the primary layout.
  const primary = await measureAnchors(frame, true).catch(() => null)
  const census = await measureObjects(frame, true).catch(() => null)
  const samples = []
  if (census) {
    captured.atoms = census.atoms.map(({ src, ...atom }) => ({
      ...atom, src_digest: src ? digest(src) : null,
    }))
    samples.push({ w: census.w, h: census.h, content_w: census.content_w,
      content_h: census.content_h, inner_scroll: census.inner_scroll,
      rects: Object.fromEntries(census.atoms.map((a) => [String(a.n), a.rect])) })
    captured.audit = await auditShots(frame, index, census.atoms)
  }
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
        if (measured?.anchors?.length && height !== 480) {
          // v7 anchors keep their 640/860 grid (older runtimes read it)
          breakpoints.push({
            w: measured.w, h: measured.h, content_w: measured.content_w,
            content_h: measured.content_h, anchors: measured.anchors,
          })
        }
        if (census) {
          const sample = await measureObjects(frame, false).catch(() => null)
          if (sample) samples.push(sample)
        }
      }
    }
    await page.setViewportSize({ width: PRIMARY_WIDTH, height: PRIMARY_HEIGHT })
    await page.waitForTimeout(450)
  }
  if (census) {
    const layout = classifyLayout(samples)
    captured.layout = { kind: layout.kind, natural_h: layout.natural_h, tall: [] }
    if (layout.kind === 'height_independent') {
      for (const width of TALL_WIDTHS) {
        const natural = (layout.natural_h || []).find(([w]) => w === width)?.[1]
        const base = samples.find((s) => s.w === width)
        if (!natural || !base || natural <= base.h) continue
        const height = Math.min(TALL_MAX, natural + 40)
        await page.setViewportSize({ width, height })
        await page.waitForTimeout(600)
        const tall = await measureObjects(frame, false).catch(() => null)
        if (tall) {
          const same = Object.entries(base.rects).every(([id, rect]) =>
            sameRect(rect || null, tall.rects[id] || null))
          captured.layout.tall.push({ w: width, h: height, same_geometry: same,
            inner_scroll: tall.inner_scroll > 2 })
        }
      }
      await page.setViewportSize({ width: PRIMARY_WIDTH, height: PRIMARY_HEIGHT })
      await page.waitForTimeout(450)
    }
    captured.object_samples = samples.map(({ w, h, content_w, content_h, rects }) =>
      ({ w, h, content_w, content_h, rects }))
    captured.grid = gridRows(samples, layout.kind)
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
