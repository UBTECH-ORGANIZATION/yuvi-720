/* The refactored teacher home (#450 v2), driven end to end.
 *
 * The page's promise: every student on ONE flat list wearing its band as its
 * face, movers marked, the whys one click away — plus the class book turning
 * its pages. Counts are pinned to the snapshot payload, not to whatever
 * happens to be on screen: the seeded class (יובי 720 · Gal) has students in
 * all three bands and six recent movers, and an empty page passes lazy
 * assertions for the wrong reason.
 */

import { chromium } from 'playwright'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL || 'http://localhost:5199'
const GROUP = process.env.GROUP_ID || 'group-gal'
const OUT = 'artifacts'

let passed = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { failures.push(name); console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const browser = await chromium.launch()

try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'gal', password: 'Aa12345' },
  })
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`)
  // The scope persists on the user document — point it at the seeded class
  // (and the whole class, so a leftover sub-group pick can't shrink the card).
  await context.request.patch(`${BASE}/api/auth/preferences`, {
    data: {
      language: 'he', teacher_group_id: GROUP, teacher_subgroup_id: null,
      // the unwrap ledger persists on the USER now — empty it so this run
      // meets the week's book gift-wrapped like a first sight
      teacher_book_seen: {},
    },
    failOnStatusCode: false,
  })

  /* What the payload says the screen should show. The first uncached snapshot
     walks every learner's trends, so give it time — the page's own request
     right after will hit the 60s cache. */
  const snapshot = await (await context.request.get(
    `${BASE}/api/teacher/groups/${encodeURIComponent(GROUP)}/snapshot?language=he`,
    { timeout: 120000 })).json()
  const students = snapshot.students ?? []
  const byBand = { red: 0, orange: 0, green: 0 }
  let expectedFresh = 0
  const freshWindow = Date.now() - 48 * 3600 * 1000
  for (const row of students) {
    const band = row.band?.band
    if (band in byBand) byBand[band] += 1
    if (row.band?.previous && row.band?.changed_at
        && Date.parse(row.band.changed_at) > freshWindow) expectedFresh += 1
  }
  const expectedRed = snapshot.trends?.needing_attention_red ?? -1
  check('the seeded class exercises all three bands',
        byBand.red > 0 && byBand.orange > 0 && byBand.green > 0,
        `red ${byBand.red} · orange ${byBand.orange} · green ${byBand.green}`)
  check('the payload carries recent movers', expectedFresh > 0, `${expectedFresh} fresh`)
  check('the red KPI and the red band are the same number',
        expectedRed === byBand.red, `${expectedRed} vs ${byBand.red}`)

  const page = await context.newPage()
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-home:not([aria-busy="true"]) .tch-bands', { timeout: 120000 })
  await dismissTourIfOpen(page)

  // ── a person saying hello, three numbers, nothing that was removed ────────
  const greeting = (await page.locator('.tch-home__head h1').innerText()).trim()
  check('the greeting is words, not a key',
        greeting.length > 0 && !greeting.includes('tch.'), greeting)
  check('exactly three KPIs', await page.locator('.tch-stat').count() === 3,
        `${await page.locator('.tch-stat').count()}`)
  const kpiValue = (await page.locator('.tch-stat--button .tch-stat__value').innerText()).trim()
  check('the attention KPI shows the payload count', Number(kpiValue) === expectedRed,
        `${kpiValue} vs ${expectedRed}`)
  check('the brief hero is gone', await page.locator('.tch-brief, .tch-home__brief').count() === 0)
  // v4: the KPIs sit on real cards, and the attention KPI lost its red side-bar
  const kpiLook = await page.locator('.tch-stat--button').evaluate((node) => {
    const style = getComputedStyle(node)
    return { bg: style.backgroundColor, accent: style.borderInlineStartWidth }
  })
  check('the KPIs sit on cards without the red side-bar',
        kpiLook.bg !== 'rgba(0, 0, 0, 0)' && kpiLook.accent === '1px',
        `bg ${kpiLook.bg} · accent ${kpiLook.accent}`)
  check('the live card is gone (v2)', await page.locator('.tch-liveCard').count() === 0)
  check('the recommendations block is gone (v2)',
        await page.locator('.tch-groupRecs').count() === 0)

  // ── every student, one flat list ──────────────────────────────────────────
  const bands = page.locator('.tch-bands')
  check('the live door is gone from the students card (v5)',
        await bands.locator('.tch-bands__live').count() === 0)
  check('the filters sit in the title row — three bands and the movers',
        await bands.locator('.tch-bands__bar .tch-bands__chip').count() === 4)
  const chipCounts = (await bands.locator('.tch-bands__chipCount').allInnerTexts()).slice(0, 3)
  check('band chips carry the payload counts',
        chipCounts.join(' ') === `${byBand.red} ${byBand.orange} ${byBand.green}`,
        `${chipCounts.join(' ')} vs ${byBand.red} ${byBand.orange} ${byBand.green}`)
  check('no per-band sections — one list',
        await bands.locator('.tch-bands__group').count() === 0
          && await bands.locator('.tch-bands__list').count() === 1)

  // Every row wears its band as its face — no letter avatars on this card.
  const rowCount = await bands.locator('.tch-bands__student').count()
  const faceCount = await bands.locator('.tch-bands__student .tch-bandFace').count()
  check('every row wears a band face', rowCount > 0 && faceCount === rowCount,
        `${faceCount}/${rowCount}`)
  check('no letter avatars on the band rows',
        await bands.locator('.tch-bands__student .sp-avatar, .tch-bands__student .tch-avatar').count() === 0)

  // Show everything, then pin the ordering to the payload.
  if (await bands.locator('.tch-bands__more').count()) {
    await bands.locator('.tch-bands__more').click()
    await page.waitForTimeout(200)
  }
  const rowBands = await bands.locator('.tch-bands__student').evaluateAll(
    (nodes) => nodes.map((node) => node.className.match(/is-(red|orange|green)/)?.[1]))
  check('all students render after "show more"', rowBands.length === students.length,
        `${rowBands.length} of ${students.length}`)
  const order = { red: 0, orange: 1, green: 2 }
  const sorted = rowBands.every((band, index) =>
    index === 0 || order[rowBands[index - 1]] <= order[band])
  check('the flat list runs red → orange → green', sorted, rowBands.join(' '))
  const arrows = await bands.locator('.tch-bands__move').count()
  check('recent movers wear a direction arrow — all of them',
        arrows === expectedFresh, `${arrows} vs ${expectedFresh}`)
  const upDown = {
    up: await bands.locator('.tch-bands__move.is-up').count(),
    down: await bands.locator('.tch-bands__move.is-down').count(),
  }
  check('every arrow points a real way', upDown.up + upDown.down === arrows,
        `${upDown.up} up · ${upDown.down} down`)
  // v5: the momentum mark is a trend CHART, not a bare chevron
  const trendPaths = await bands.locator('.tch-bands__move svg path').count()
  check('the momentum marks are trend charts', arrows === 0 || trendPaths >= arrows * 2,
        `${trendPaths} paths on ${arrows} marks`)
  // the movers filter narrows to exactly them
  await bands.locator('.tch-bands__chip.is-fresh').click()
  await page.waitForTimeout(200)
  check('the movers filter keeps only fresh changes',
        await bands.locator('.tch-bands__student').count() === expectedFresh,
        `${await bands.locator('.tch-bands__student').count()} rows`)
  await bands.locator('.tch-bands__chip.is-fresh').click()
  await page.waitForTimeout(200)
  // Movers float: within each band segment, fresh rows come first.
  const freshFirst = await bands.locator('.tch-bands__student').evaluateAll((nodes) => {
    const segments = {}
    for (const node of nodes) {
      const band = node.className.match(/is-(red|orange|green)/)?.[1]
      ;(segments[band] ??= []).push(Boolean(node.querySelector('.tch-bands__move')))
    }
    return Object.values(segments).every((marks) => {
      const lastFresh = marks.lastIndexOf(true)
      return lastFresh === -1 || marks.slice(0, lastFresh + 1).every(Boolean)
    })
  })
  check('movers sit on top of their band', freshFirst)
  await page.screenshot({ path: `${OUT}/home-01-top.png` })

  // ── the attention KPI drives the card ─────────────────────────────────────
  await page.locator('.tch-stat--button').click()
  await page.waitForTimeout(900) // smooth scroll
  check('the KPI presses the red chip',
        await bands.locator('.tch-bands__chip.is-red[aria-pressed="true"]').count() === 1)
  const filteredBands = await bands.locator('.tch-bands__student').evaluateAll(
    (nodes) => [...new Set(nodes.map((node) => node.className.match(/is-(red|orange|green)/)?.[1]))])
  check('and the card shows only red rows', filteredBands.join(' ') === 'red')
  const bandsTop = await bands.evaluate((node) => node.getBoundingClientRect().top)
  check('and scrolls the card into view', bandsTop > -60 && bandsTop < 400, `top ${Math.round(bandsTop)}px`)
  await page.screenshot({ path: `${OUT}/home-02-red-filter.png` })
  await bands.locator('.tch-bands__chip.is-red').click() // release the filter

  // ── the ? on the card explains the system ─────────────────────────────────
  await bands.locator('.tch-bands__help').click()
  await page.waitForSelector('.tch-bandHelp', { timeout: 10000 })
  await page.waitForTimeout(400)
  check('the ? opens the how-it-works dialog',
        await page.locator('.tch-bandHelp__band').count() === 3,
        `${await page.locator('.tch-bandHelp__band').count()} band sections`)
  const helpText = await page.locator('.tch-bandHelp').innerText()
  check('and it explains in words, not keys',
        helpText.length > 120 && !/\btch\.[a-z]+\./i.test(helpText), `${helpText.length} chars`)
  check('the momentum legend pairs each mark with its meaning',
        await page.locator('.tch-bandHelp__legend').count() === 2
          && await page.locator('.tch-bandHelp__legend .tch-bands__move').count() === 2)
  await page.screenshot({ path: `${OUT}/home-07-help.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // ── the why-dialog ────────────────────────────────────────────────────────
  await bands.locator('.tch-bands__student').first().click()
  await page.waitForSelector('.tch-bandDialog', { timeout: 10000 })
  await page.waitForTimeout(400) // let spModalIn finish before reading/shooting
  const reasons = await page.locator('.tch-bandDialog__reasons li').allInnerTexts()
  check('the dialog explains itself in sentences',
        reasons.length > 0 && reasons.every((line) => line.trim().length > 8),
        `${reasons.length} reasons`)
  const dialogText = await page.locator('.tch-bandDialog').innerText()
  check('no raw key in the dialog', !/\btch\.[a-z]+\./i.test(dialogText),
        (dialogText.match(/\btch\.[a-z.]+/i) ?? ['clean'])[0])
  check('the dialog opens a door to the profile',
        await page.locator('.tch-bandDialog__actions .sp-btn').count() === 1)
  await page.screenshot({ path: `${OUT}/home-03-dialog.png` })
  await page.locator('.tch-bandDialog__close').click()
  await page.waitForTimeout(300)

  // ── the class book: a pinned stage that opens with the scroll ─────────────
  const album = page.locator('.tch-album.tch-bookStage')
  check('the book is a stage, not a card',
        await album.count() === 1
          && await page.locator('.tch-bookStage.sp-panel').count() === 0)
  check('the gaps card sits above the book', await page.evaluate(() => {
    const gaps = document.querySelector('[data-tour="teacher.gaps"]')
    const stage = document.querySelector('.tch-bookStage')
    return Boolean(gaps && stage
      && (gaps.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING))
  }))

  // Reach the stage, then scroll INTO it: the cover should be closed first…
  // The stage mounts only once the moments fetch lands — wait for it.
  await page.waitForSelector('.tch-bookStage', { timeout: 30000 }).catch(() => {})
  await page.evaluate(() => {
    document.querySelector('.tch-bookStage')?.scrollIntoView({ block: 'start' })
  })
  // Wheel events land at the cursor — park it over the content first, or the
  // fixed app bar swallows them and the stage never opens.
  await page.mouse.move(550, 520)
  await page.waitForTimeout(400)

  // v7: a fresh browser has never seen this week's edition — it arrives as a
  // wrapped present, nudges a hesitant teacher, and pops open on click.
  check('the first sight of the week is a wrapped present',
        await page.locator('.tch-gift').count() === 1
          && await page.locator('.tch-gift .tch-gift__art').count() === 1)
  await page.waitForTimeout(4200) // the nudge waits ~3.5s of visibility
  check('the present nudges after a few seconds — tap cursor and all',
        await page.locator('.tch-gift.has-hint').count() === 1
          && await page.locator('.tch-gift .tch-gift__cursor').count() === 1,
        (await page.locator('.tch-gift__hint').innerText().catch(() => '')).trim())
  await page.locator('.tch-gift').click()
  await page.waitForTimeout(2200)
  const seenLedger = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'include' })
    const body = await response.json()
    return body?.user?.preferences?.teacher_book_seen ?? {}
  })
  check('clicking pops the present and records it on the TEACHER',
        await page.locator('.tch-gift').count() === 0
          && Object.values(seenLedger).some((weekOf) => /^\d{4}-\d{2}-\d{2}$/.test(weekOf)),
        JSON.stringify(seenLedger))
  // v8: the unwrap intro opens the cover by ITSELF — closed pose, flash, swing
  await page.waitForTimeout(1800)
  check('the unwrap opens the book by itself',
        await album.evaluate((node) => node.classList.contains('is-open')
          && parseFloat(node.style.getPropertyValue('--p') || '0') >= 0.99))
  // ride back up so the closed-cover states can be inspected
  for (let step = 0; step < 40; step += 1) {
    const progress = await album.evaluate(
      (node) => parseFloat(node.style.getPropertyValue('--p') || '1'))
    if (progress <= 0.02) break
    await page.mouse.wheel(0, -420)
    await page.waitForTimeout(90)
  }
  await page.waitForTimeout(400)

  check('the cover greets you closed', await album.locator('.tch-book__cover').count() === 1
          && !(await album.evaluate((node) => node.classList.contains('is-open'))))
  // v5: the cover wears a drawn artwork, and the title page a frontispiece
  const coverArt = await album.locator('.tch-book__coverArt img').evaluateAll(
    (imgs) => imgs.map((img) => img.complete && img.naturalWidth > 0))
  check('the cover wears its artwork', coverArt.length === 1 && coverArt[0],
        coverArt.length ? 'loaded' : 'no cover art element')
  // v7: no title page — the cover is stamped with its week instead
  const coverDates = (await album.locator('.tch-book__coverDates').innerText().catch(() => '')).trim()
  check('the cover names its week', /^\d{2}\/\d{2}-\d{2}\/\d{2}$/.test(coverDates), coverDates)
  check('the title page is gone — the cover opens onto content',
        await album.locator('.tch-book__about').count() === 0)
  check('and the pages take no input while closed',
        await album.locator('.tch-album__navBtn[disabled]').count() === 2)
  // v6: closed, the book IS only its cover — a point over the far half must
  // fall through the clip to the stage, and the cover hangs on the spine side
  // (left in Hebrew), swinging rightward like a real Hebrew book.
  const closedGeometry = await page.evaluate(() => {
    const book = document.querySelector('.tch-book')
    const cover = document.querySelector('.tch-book__cover')
    if (!book || !cover) return null
    const rect = book.getBoundingClientRect()
    const probe = document.elementFromPoint(rect.right - rect.width / 4, rect.top + rect.height / 2)
    return {
      farHalfHidden: !book.contains(probe),
      coverOnSpineSide: cover.getBoundingClientRect().left - rect.left < rect.width / 4,
    }
  })
  check('closed, the book is only its cover',
        closedGeometry?.farHalfHidden === true, JSON.stringify(closedGeometry))
  check('the cover hangs on the Hebrew side',
        closedGeometry?.coverOnSpineSide === true)
  // …half-way it is mid-turn…
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, 220)
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${OUT}/home-04a-cover.png` })
  // …and at the bottom of the stage it is open and interactive.
  for (let step = 0; step < 40; step += 1) {
    if (await album.evaluate((node) => node.classList.contains('is-open'))) break
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(80)
  }
  check('scrolling opens the book',
        await album.evaluate((node) => node.classList.contains('is-open')))

  const pageOf = (await album.locator('.tch-album__pageOf').innerText().catch(() => '')).trim()
  const totalSpreads = Number(pageOf.match(/(\d+)\s*$/)?.[1] ?? 0)
  check('the book is at most ten pages (five spreads)',
        totalSpreads >= 1 && totalSpreads <= 5, pageOf)
  // The plates: this moment's variant image, or the SVG fallback.
  const plates = await album.locator('.tch-book__plate').count()
  const plateSrcs = await album.locator('.tch-book__plate img').evaluateAll(
    (imgs) => imgs.map((img) => ({
      src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0,
    })))
  const loadedPlates = plateSrcs.filter((row) => row.ok).length
  const svgPlates = await album.locator('.tch-book__plate svg').count()
  check('every page carries a picture plate', loadedPlates + svgPlates === plates,
        `${loadedPlates} images + ${svgPlates} scenes of ${plates}`)
  check('the plates are per-moment variants',
        plateSrcs.every((row) => /\/moments\/[a-z_]+-[1-9]\.jpg$/.test(row.src ?? '')),
        plateSrcs.map((row) => row.src?.split('/').pop()).join(' · ') || 'none')
  // v5: within a kind every page wears a DIFFERENT plate (the preload block
  // lists the whole book's assignment)
  const bookPlan = await album.locator('.tch-book__preload img').evaluateAll(
    (imgs) => imgs.map((img) => img.getAttribute('src')?.split('/').pop() ?? ''))
  const perKind = {}
  for (const name of bookPlan) {
    const [, kind, variant] = name.match(/^([a-z_]+)-(\d)\.jpg$/) ?? []
    if (kind) (perKind[kind] ??= []).push(variant)
  }
  check('same-kind pages never repeat a picture',
        Object.values(perKind).every(
          (list) => new Set(list).size === Math.min(list.length, 6)),
        Object.entries(perKind).map(([k, list]) => `${k}:${list.join(',')}`).join(' · '))
  // Turning: the leaf flies, and the spread changes underneath it.
  const openingBefore = (await album.locator('.tch-album__sentence').first().innerText())
  const nextButton = album.locator('.tch-album__navBtn--next')
  if (totalSpreads > 1) {
    await nextButton.click()
    await page.waitForTimeout(250)
    // Mid-flight the leaf must be ANIMATING — a leaf that renders but never
    // rotates is exactly the "pops instead of turning" bug (the direction
    // class must sit on .tch-book itself for the animation rules to match).
    const leafState = await album.locator('.tch-book__leaf').evaluateAll(
      (leaves) => leaves.map((leaf) => {
        const style = getComputedStyle(leaf)
        return { name: style.animationName, transform: style.transform }
      }))
    await page.screenshot({ path: `${OUT}/home-04b-turn.png` })
    await page.waitForTimeout(700)
    const openingAfter = (await album.locator('.tch-album__sentence').first().innerText())
    check('the next button turns a real leaf', leafState.length === 1)
    check('and the leaf actually rotates mid-flight',
          leafState[0]?.name !== 'none' && leafState[0]?.transform !== 'none',
          `animation ${leafState[0]?.name} · transform ${leafState[0]?.transform?.slice(0, 40)}`)
    check('and lands on the next spread', openingAfter !== openingBefore)
  } else {
    check('the next button turns a real leaf', true, 'single spread — nothing to turn')
    check('and the leaf actually rotates mid-flight', true, 'single spread')
    check('and lands on the next spread', true, 'single spread')
  }
  check('a page offers good words',
        await album.locator('.tch-book__page .tch-album__meta .sp-btn').count() >= 1)
  // At the floor of the page, the wheel turns pages instead of scrolling away.
  if (totalSpreads > 2) {
    // First ride the scroll to the true floor (the turner only takes over at
    // --p ≈ 1), then one more wheel is a page turn. The cursor is parked over
    // the page first — the click above left it on the nav button, and wheels
    // land at the cursor.
    await page.mouse.move(550, 520)
    for (let step = 0; step < 20; step += 1) {
      const progress = await album.evaluate(
        (node) => parseFloat(node.style.getPropertyValue('--p') || '0'))
      if (progress >= 0.999) break
      await page.mouse.wheel(0, 300)
      await page.waitForTimeout(120)
    }
    // v5: the open book IS the floor — the scroller has nothing below it
    const floor = await page.evaluate(() => {
      const scroller = document.querySelector('.sp-teacher-shell__main')
      if (!scroller) return null
      return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    })
    check('the book is the bottom of the page', floor !== null && floor < 3,
          `${Math.round(floor ?? -1)}px left below the book`)
    // The ride itself may have fired a turn on its last wheel — let it land
    // (and its cooldown lapse) before reading the page number we turn FROM.
    await page.waitForTimeout(1100)
    const before = (await album.locator('.tch-album__pageOf').innerText()).trim()
    await page.mouse.wheel(0, 260)
    await page.waitForTimeout(1100)
    const after = (await album.locator('.tch-album__pageOf').innerText()).trim()
    check('at the bottom, scrolling turns the page', after !== before, `${before} → ${after}`)
    // v6: a trackpad's gentle deltas ACCUMULATE into a turn — no single event
    // clears a per-event threshold, the sum does.
    for (let step = 0; step < 6; step += 1) {
      await page.mouse.wheel(0, 12)
      await page.waitForTimeout(50)
    }
    await page.waitForTimeout(1100)
    const afterGentle = (await album.locator('.tch-album__pageOf').innerText()).trim()
    check('gentle trackpad scrolling turns the page too', afterGentle !== after,
          `${after} → ${afterGentle}`)
  } else {
    check('the book is the bottom of the page', true, 'book too short to test')
    check('at the bottom, scrolling turns the page', true, 'book too short to test')
    check('gentle trackpad scrolling turns the page too', true, 'book too short to test')
  }
  await page.screenshot({ path: `${OUT}/home-04-album.png` })

  // ── gaps with actions attached ────────────────────────────────────────────
  const gapsWrap = page.locator('[data-tour="teacher.gaps"] .tch-difficulties')
  check('the shared difficulties card renders the gaps', await gapsWrap.count() === 1)
  const gapRows = await gapsWrap.locator('.tch-difficulty').count()
  if (gapRows > 0) {
    const actions = await gapsWrap.locator('.tch-difficulty').first()
      .locator('.tch-difficulty__actions .sp-btn').count()
    check('a gap row offers its actions', actions >= 1 && actions <= 2, `${actions} actions`)
  } else {
    check('a gap row offers its actions', true, 'no open gaps this week')
  }

  // ── the sub-group narrows the card, and says so ───────────────────────────
  const subgroupSeg = page.locator('.tch-scope__seg').nth(1)
  if (await subgroupSeg.locator('button.tch-scope__trigger').count()) {
    await subgroupSeg.locator('.tch-scope__trigger').click()
    await page.locator('.tch-scope__option').nth(1).click()
    await page.waitForTimeout(800)
    const chipSum = (await bands.locator('.tch-bands__chipCount').allInnerTexts())
      .reduce((sum, value) => sum + Number(value), 0)
    check('picking a sub-group narrows the students card',
          chipSum > 0 && chipSum < students.length, `${chipSum} of ${students.length}`)
    const subtitle = (await bands.locator('.tch-bands__titles p').innerText().catch(() => '')).trim()
    check('and the card says it is narrowed', subtitle.length > 0
            && subtitle !== '' && (await bands.innerText()).length > 0,
          subtitle.slice(0, 60))
    await page.screenshot({ path: `${OUT}/home-05-subgroup.png` })
    await page.locator('.tch-scope__clear').first().click()
    await page.waitForTimeout(600)
  } else {
    check('picking a sub-group narrows the students card', false, 'no sub-group segment in the bar')
    check('and the card says it is narrowed', false, 'no sub-group segment in the bar')
  }

  // ── the whole page, in Arabic too ─────────────────────────────────────────
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('page does not scroll horizontally', overflow <= 0, `${overflow}px`)
  const pageText = await page.locator('.tch-home').innerText()
  check('no raw locale key anywhere on the page', !/\btch\.[a-z]+\./i.test(pageText),
        (pageText.match(/\btch\.[a-z.]+/i) ?? ['clean'])[0])

  // The UI language lives on learner-state (I18nProvider reads it from there),
  // not on auth preferences. Patch, VERIFY the server took it, then reload —
  // and reload once more if the page raced the write, rather than reading a
  // Hebrew page and calling it Arabic.
  await context.request.patch(`${BASE}/api/learner-state`,
    { data: { language: 'ar' }, failOnStatusCode: false })
  for (let tries = 0; tries < 10; tries += 1) {
    const state = await (await context.request.get(`${BASE}/api/learner-state`)).json()
    if (state.language === 'ar') break
    await context.request.patch(`${BASE}/api/learner-state`,
      { data: { language: 'ar' }, failOnStatusCode: false })
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.tch-home:not([aria-busy="true"]) .tch-bands', { timeout: 120000 })
    const flipped = await page.waitForFunction(
      () => document.documentElement.lang === 'ar', undefined, { timeout: 15000 },
    ).then(() => true).catch(() => false)
    if (flipped) break
  }
  // The flip refetches the snapshot in Arabic (uncached — it walks trends), so
  // wait for the loaded card again before reading the page.
  await page.waitForSelector('.tch-home:not([aria-busy="true"]) .tch-bands', { timeout: 120000 })
  await page.waitForTimeout(400)
  const arText = await page.locator('.tch-home').innerText()
  check('the page speaks Arabic', /[؀-ۿ]/.test(arText)
          && !/\btch\.[a-z]+\./i.test(arText),
        (arText.match(/\btch\.[a-z.]+/i) ?? [arText.slice(0, 24)])[0])
  await page.screenshot({ path: `${OUT}/home-06-arabic.png` })
  await context.request.patch(`${BASE}/api/learner-state`,
    { data: { language: 'he' }, failOnStatusCode: false })
} finally {
  await browser.close()
}

console.log('')
if (failures.length) {
  console.log(`✘ ${failures.length} failure(s) / ${passed} passed`)
  for (const name of failures) console.log(`   - ${name}`)
  process.exit(1)
}
console.log(`✅ home check passed (${passed} checks)`)
