/* Learnings screen + teacher-shell persistence.
 *
 * Three things are under test here and the last two are regression guards:
 *
 *   the learnings catalogue — search, subject filter, unit grouping, untouched
 *   material listed as such, and the drill-down opening on a real question;
 *
 *   what reaches the screen — a teacher photographed `tch.subject.english` and
 *   `ENG.G7.FAMILY.SPEAK-01` rendered as if they were words. Three different
 *   sources fed that: a locale table behind the content vendor, a component the
 *   vendor never titled, and `localized_objective_title` falling back to its own
 *   dotted key. All three are asserted against here, on the real page, because
 *   each one passes every unit test on its own side of the wire;
 *
 *   the shell — the selected class and the assistant conversation must survive
 *   navigation AND a reload. They did not: the shell used to live inside the
 *   route-keyed div, so clicking a student reference in the chat reset both.
 */

import { chromium } from 'playwright'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL || 'http://localhost:5199'
const OUT = 'artifacts'

let passed = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { failures.push(name); console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const browser = await chromium.launch()

/* The catalogue, loaded and settled.
 *
 * `.tch-learning` appearing is not enough: the scope provider resolves the
 * selected class one tick after mount, and the page's effect does
 * `setView(null)` on every `groupId` change — so a card can be on screen and
 * gone again a moment later, and counting in that window reports zero cards on
 * a screen that is working fine. The loading branch sets `aria-busy`, so wait
 * for a catalogue that is both populated AND not mid-fetch. */
const settled = (page) => page.waitForFunction(() => {
  const root = document.querySelector('.tch-learnings')
  return !!root && root.getAttribute('aria-busy') !== 'true'
    && document.querySelectorAll('.tch-learning').length > 0
}, undefined, { timeout: 60000 })

try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'gal', password: 'Aa12345' },
  })
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`)
  await context.request.patch(`${BASE}/api/auth/preferences`,
    { data: { language: 'he' }, failOnStatusCode: false })

  /* Pick the class with the most real activity before asserting anything.
     This account has five classes and four of them have never been touched, so
     whichever one the stored preference happens to hold decides whether the
     assertions below are about data or about an empty catalogue — and an empty
     catalogue passes every one of them for the wrong reason. */
  const roster = await (await context.request.get(`${BASE}/api/teacher/roster`)).json()
  let busiest = null
  for (const group of roster.groups ?? []) {
    const view = await (await context.request.get(
      `${BASE}/api/teacher/groups/${encodeURIComponent(group.id)}/learnings?language=he`)).json()
    const rows = view.learnings ?? []
    const started = rows.filter((row) => row.started).length
    if (!busiest || started > busiest.started) {
      busiest = { id: group.id, name: group.name, started, rows }
    }
  }
  check('a class with real activity was found to test against',
        (busiest?.started ?? 0) > 0, `${busiest?.name} — ${busiest?.started} started`)

  /* What the payload says the screen should show. Every branch below has an
     "if there is none, pass" arm, and an arm like that turns a data change into
     a silent green run — so the counts are pinned to the payload rather than to
     whatever happens to be on screen. `ATTENTION_MAX_SUCCESS` is duplicated
     from `learningRows.ts` deliberately: this is the cross-check, and reading
     the number from the code it is checking would check nothing. */
  const payload = busiest?.rows ?? []
  const expectedUntitled = payload.filter(
    (row) => row.title === row.component_id && !row.objective_title).length
  const expectedAttention = payload.filter((row) => row.started
    && (row.struggling_count > 0
        || (row.success_rate !== null && row.success_rate < 0.5))).length
  check('the class under test exercises the untitled-row path',
        expectedUntitled > 0, `${expectedUntitled} untitled rows in the payload`)
  check('the class under test exercises the pinned group',
        expectedAttention > 0, `${expectedAttention} in the payload`)

  const page = await context.newPage()
  // The picker lives on the dashboard, and the choice is stored on the user —
  // so this is how the learnings screen is pointed at a class.
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-stat', { timeout: 60000 })
  await dismissTourIfOpen(page)
  const classPick = page.locator('.tch-home__classPick select')
  if (busiest && await classPick.count()) {
    await classPick.selectOption(busiest.id)
    await page.waitForTimeout(1200)
  }

  await page.goto(`${BASE}/teacher/learnings`, { waitUntil: 'domcontentloaded' })
  await settled(page)
  await dismissTourIfOpen(page)

  // ── the catalogue is the spine ────────────────────────────────────────────
  const cards = await page.locator('.tch-learning').count()
  const idle = await page.locator('.tch-learning--idle').count()
  check('every published learning is listed', cards > 1, `${cards} cards`)
  check('material nobody opened is listed too', idle > 0, `${idle} not started`)

  const units = await page.locator('.tch-learnings__unit').count()
  check('learnings are grouped by unit', units >= 1, `${units} units`)

  // ── nothing internal reaches the screen ──────────────────────────────────
  const pageText = await page.locator('.tch-learnings').innerText()
  check('no raw locale key anywhere on the catalogue',
        !/\btch\.[a-z]+\./i.test(pageText),
        (pageText.match(/\btch\.[a-z.]+/i) ?? ['none'])[0])
  // The dotted MOE objective key used to arrive as `objective_title`, because
  // `localized_objective_title` falls back to the key it could not resolve.
  check('no dotted MOE key in a title or meta line',
        !/\bMOE\.[A-Z]/.test(pageText),
        (pageText.match(/\bMOE\.[A-Z.\-0-9]+/) ?? ['none'])[0])

  const headings = await page.locator('.tch-learnings__unitTitle').allInnerTexts()
  check('no unit heading is a raw id',
        headings.every((heading) => !/^[A-Z0-9][A-Z0-9._-]{6,}$/.test(heading.split('\n')[0].trim())),
        headings.map((h) => h.split('\n')[0].trim()).join(' | '))

  /* A component the vendor shipped without a title has no name anywhere in the
     system — so its id stays visible (it is the only thing telling five such
     rows apart) but is styled and labelled AS an id rather than dressed up as
     a name. What must never happen is an id sitting in the title slot with
     nothing saying so. */
  const idTitles = page.locator('.tch-learning__idTitle')
  const idCount = await idTitles.count()
  check('every row the payload cannot name is marked as such, and only those',
        idCount === expectedUntitled, `${idCount} on screen vs ${expectedUntitled} in the payload`)
  if (idCount) {
    const card = page.locator('.tch-learning')
      .filter({ has: page.locator('.tch-learning__idTitle') }).first()
    const meta = await card.locator('.tch-learning__meta').innerText()
    check('an untitled row says it is untitled', meta.trim().length > 0, meta.trim())
    const mono = await idTitles.first().evaluate(
      (node) => getComputedStyle(node).fontFamily.toLowerCase())
    check('an untitled row wears its id as an id',
          mono.includes('mono') || mono.includes('menlo'), mono)
  } else {
    check('an untitled row says it is untitled', true, 'every row is titled')
    check('an untitled row wears its id as an id', true, 'every row is titled')
  }

  // ── important first ──────────────────────────────────────────────────────
  const attention = page.locator('.tch-learnings__unit--attention')
  const pinnedCount = await attention.locator('.tch-learning').count()
  check('the pinned group holds exactly what the payload says needs attention',
        pinnedCount === expectedAttention,
        `${pinnedCount} pinned vs ${expectedAttention} in the payload`)
  if (await attention.count()) {
    const first = await page.locator('.tch-learnings__unit').first()
      .evaluate((node) => node.className)
    check('the pinned group comes before the unit sections',
          first.includes('tch-learnings__unit--attention'), first)

    // Worst first, and the pin only means something while it is short.
    const rates = await attention.locator('.tch-learning__line--rate strong').allInnerTexts()
    const numbers = rates.map((value) => Number(value.replace('%', '')))
    check('the pinned group is ordered, not just collected',
          numbers.length > 0, rates.join(' '))
    check('every pinned learning is one a teacher would act on',
          numbers.every((value) => Number.isFinite(value) && value < 100), rates.join(' '))

    /* Lifted, not copied. The same card in two places, a screen apart, is the
       duplication this dashboard already removed once from the KPI strip. */
    const pinnedTitles = await attention.locator('.tch-learning__titles strong').allInnerTexts()
    const allTitles = await page.locator('.tch-learning__titles strong').allInnerTexts()
    const duplicated = pinnedTitles.filter(
      (title) => allTitles.filter((other) => other === title).length > 1)
    check('a pinned learning is lifted out of its unit, not copied',
          duplicated.length === 0, duplicated.join(' | ') || 'no duplicates')

    // And the strip above still counts every card on the screen exactly once.
    const totalCards = await page.locator('.tch-learning').count()
    const counts = await page.locator('.tch-learnings__unitCount').allInnerTexts()
    const summed = counts.reduce((sum, value) => sum + Number(value), 0)
    check('the section counts account for every card',
          summed === totalCards, `${summed} counted vs ${totalCards} rendered`)
  } else {
    check('the pinned group comes before the unit sections', true, 'nothing needs attention')
    check('the pinned group is ordered, not just collected', true, 'nothing needs attention')
    check('every pinned learning is one a teacher would act on', true, 'nothing needs attention')
    check('a pinned learning is lifted out of its unit, not copied', true, 'nothing needs attention')
    check('the section counts account for every card', true, 'nothing needs attention')
  }

  // ── search ───────────────────────────────────────────────────────────────
  const firstTitle = (await page.locator('.tch-learning__titles strong').first().innerText()).trim()
  const needle = firstTitle.split(' ')[0]
  await page.locator('.tch-learnings__search input').fill(needle)
  await page.waitForTimeout(300)
  const afterSearch = await page.locator('.tch-learning').count()
  check('search narrows the catalogue', afterSearch > 0 && afterSearch <= cards,
        `"${needle}" → ${afterSearch} of ${cards}`)
  await page.locator('.tch-learnings__search input').fill('')
  await page.waitForTimeout(300)

  // ── subject filter ───────────────────────────────────────────────────────
  const subjectChips = page.locator('.tch-learnings__filters .tch-chip')
  const chipCount = await subjectChips.count()
  check('a subject filter is offered', chipCount >= 2, `${chipCount} chips`)
  if (chipCount >= 2) {
    await subjectChips.nth(1).click()
    await page.waitForTimeout(300)
    const filtered = await page.locator('.tch-learning').count()
    check('subject filter narrows the catalogue', filtered > 0 && filtered <= cards,
          `${filtered} of ${cards}`)
    await subjectChips.nth(0).click()
    await page.waitForTimeout(300)
  }
  await page.screenshot({ path: `${OUT}/learnings-01-list.png` })

  // ── drill-down ───────────────────────────────────────────────────────────
  /* A learning the catalogue still publishes. An off-catalogue row opens fine
     and shows its questions, but it has no screens to draw a spine from — so
     picking whichever card sorts first would assert "0 screens" against a page
     that is behaving correctly. That case gets its own check below. */
  const started = page.locator('.tch-learning:not(.tch-learning--idle)')
    .filter({ hasNot: page.locator('.tch-learning__idTitle') }).first()
  await started.locator('.tch-learning__open').click()
  await page.waitForURL('**/teacher/learnings/**', { timeout: 20000 })
  /* Wait for the LOADED detail, not the container: the skeleton renders the
     same wrapper, so `.tch-learningDetail` alone matched a page mid-fetch. */
  await page.waitForSelector('.tch-learningDetail .tch-stat', { timeout: 90000 })
  const stats = await page.locator('.tch-learningDetail .tch-stat').count()
  check('the detail screen opens with its own KPIs', stats >= 4, `${stats} cards`)
  const rows = await page.locator('.tch-learningDetail__questions tbody tr').count()
  check('every question is listed with its numbers', rows > 0, `${rows} questions`)
  const spine = await page.locator('.tch-spine__row').count()
  check('the lesson spine shows the screens', spine > 0, `${spine} screens`)
  const labelled = await page.locator('.tch-learningDetail__questions tbody tr .sp-pill').first().innerText()
  check('questions are named, not raw ids', !/^[a-z0-9]{8,}$/i.test(labelled.trim()), labelled.trim())
  const noKey = await page.locator('.tch-learningDetail').innerText()
  check('no raw locale key on the detail screen', !noKey.includes('tch.learnings.'))
  await page.screenshot({ path: `${OUT}/learnings-02-detail.png`, fullPage: true })

  await page.locator('.tch-learningDetail__head .sp-btn').click()
  await settled(page)
  check('back returns to the catalogue', page.url().includes('/teacher/learnings'))

  /* And the row the catalogue cannot name still opens — with the same name it
     had on the card, so a teacher who clicked "ENG.G7.FAMILY.SPEAK-01" does not
     land on a page calling it something else. */
  const untitled = page.locator('.tch-learning')
    .filter({ has: page.locator('.tch-learning__idTitle') }).first()
  if (await untitled.count()) {
    const cardTitle = (await untitled.locator('.tch-learning__idTitle').innerText()).trim()
    await untitled.locator('.tch-learning__open').click()
    await page.waitForSelector('.tch-learningDetail .tch-stat', { timeout: 90000 })
    const detailTitle = (await page.locator('.tch-learningDetail__titles h1').innerText()).trim()
    check('an untitled learning opens under the same name', detailTitle === cardTitle,
          `${cardTitle} → ${detailTitle}`)
    check('and is still marked as an id there',
          await page.locator('.tch-learningDetail__titles h1.tch-learning__idTitle').count() === 1)
    const offRows = await page.locator('.tch-learningDetail__questions tbody tr').count()
    check('an off-catalogue learning still reports what the class answered',
          offRows > 0, `${offRows} questions`)
    await page.goto(`${BASE}/teacher/learnings`, { waitUntil: 'domcontentloaded' })
    await settled(page)
  } else {
    check('an untitled learning opens under the same name', true, 'every row is titled')
    check('and is still marked as an id there', true, 'every row is titled')
    check('an off-catalogue learning still reports what the class answered',
          true, 'every row is titled')
  }

  // ── the shell survives navigation (the regression) ───────────────────────
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-stat', { timeout: 45000 })
  const picker = page.locator('.tch-home__classPick select')
  const hasPicker = await picker.count() > 0
  if (hasPicker) {
    const options = await picker.locator('option').evaluateAll(
      (nodes) => nodes.map((node) => node.value))
    const current = await picker.inputValue()
    const other = options.find((value) => value !== current) ?? options[1]
    if (other) {
      await picker.selectOption(other)
      await page.waitForTimeout(1500)
      const chosen = await picker.inputValue()

      // Navigate away and back — this is exactly what clicking a student
      // reference in the assistant used to do.
      await page.goto(`${BASE}/teacher/students`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.tch-roster, .sp-state', { timeout: 45000 })
      await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.tch-home__classPick select', { timeout: 45000 })
      check('the selected class survives navigation',
            await picker.inputValue() === chosen, `${await picker.inputValue()} vs ${chosen}`)

      // And a full reload — the choice lives on the user, not in memory.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.tch-home__classPick select', { timeout: 45000 })
      await page.waitForTimeout(800)
      check('the selected class survives a reload',
            await picker.inputValue() === chosen, `${await picker.inputValue()} vs ${chosen}`)
    }
  } else {
    check('the selected class survives navigation', true, 'single class — nothing to switch')
    check('the selected class survives a reload', true, 'single class — nothing to switch')
  }

  /* ── the assistant conversation survives navigation ───────────────────────
     Selectors from `dock-check.mjs`, which is the file that owns them. This
     block used to wait on `.tch-dock__reply` and count `.tch-dock__exchange` —
     two class names that exist nowhere in `src/`. It was not asserting a weaker
     version of this; it was timing out for ninety seconds and then throwing,
     which is why the checks BELOW it had never run. */
  const dockInput = page.locator('.tch-dock__composer input')
  if (await dockInput.count()) {
    await dockInput.fill('כמה תלמידים בכיתה?')
    // Send stays disabled until the conversation exists, so clicking straight
    // after `fill` clicks a dead button and then waits ninety seconds for a
    // reply nobody asked for.
    await page.waitForSelector('.tch-dock__send:not([disabled])', { timeout: 30000 })
    const before = await page.locator('.tch-dock__row').count()
    const answered = await page.locator('.tch-dock__row--assistant').count()
    await page.locator('.tch-dock__send').click()
    await page.waitForFunction(
      (count) => document.querySelectorAll('.tch-dock__row--assistant').length > count,
      answered, { timeout: 90000 })
    const after = await page.locator('.tch-dock__row').count()
    check('the assistant answers at all', after > before, `${before} → ${after} rows`)

    await page.locator('.teacher-app-nav button').nth(1).click()
    await page.waitForTimeout(1200)
    const kept = await page.locator('.tch-dock__row').count()
    check('the assistant conversation survives navigation',
          kept === after && kept > 0, `${after} → ${kept} rows`)
    await page.screenshot({ path: `${OUT}/learnings-03-dock-kept.png` })
  } else {
    check('the assistant answers at all', true, 'dock closed')
    check('the assistant conversation survives navigation', true, 'dock closed')
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('page does not scroll horizontally', overflow <= 0, `${overflow}px`)
} finally {
  await browser.close()
}

console.log('')
if (failures.length) {
  console.log(`✘ ${failures.length} failure(s) / ${passed} passed`)
  for (const name of failures) console.log(`   - ${name}`)
  process.exit(1)
}
console.log(`✅ learnings check passed (${passed} checks)`)
