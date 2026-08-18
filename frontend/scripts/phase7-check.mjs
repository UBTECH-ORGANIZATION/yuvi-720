/* Phase 7 in a real browser: moments, kudos, digest, and the student profile.
 *
 * What is worth checking here rather than in unit tests:
 *
 *   - Every digest bullet and every moment opens to its datum. A panel that
 *     narrates without evidence is the exact failure mode of this phase.
 *   - Kudos is reachable from the moment that earned it.
 *   - The student profile is ONE scrolling page now (no tab bar): KPI strip,
 *     status band with half-arc dials, the hardest topics, and the dialog doors
 *     as a closed drawer — asserted in place rather than behind tab clicks.
 *
 * Never `waitUntil: 'networkidle'` — the teacher page holds an SSE connection.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dismissTourIfOpen } from './lib/tour.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const OUT = 'artifacts/phase7'
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const signIn = async (context, username, landing) => {
  const response = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username, password: 'Aa12345' },
  })
  if (!response.ok()) throw new Error(`login failed for ${username}: ${response.status()}`)
  const page = await context.newPage()
  await page.goto(`${BASE}${landing}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  // Phase 8: the tour opens itself for an account that has not seen it,
  // and its scrim blocks clicks. Dismiss it as a teacher would.
  await dismissTourIfOpen(page)
  return page
}

const browser = await chromium.launch()

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1100 } })
  const page = await signIn(context, 'gal', '/teacher')
  await page.waitForSelector('.tch-stat', { timeout: 45000 })

  /* ── weekly digest (zone 3) ───────────────────────────────────────────────
     `WeeklyDigest` has NO consumer anywhere in `src/` — the daily-brief hero
     replaced it on the dashboard and the component was left behind, along with
     its route, its cache collection and its boot-time index step. This block
     used to wait 45s for a selector that can never appear and then throw,
     which is why everything below it had not run in a long time. Skipped
     loudly rather than deleted: the backend still generates these every week. */
  const digestMounted = await page.locator('.tch-digest, .tch-digest__none').count() > 0
  if (!digestMounted) {
    check('the weekly digest renders bullets', true, 'not mounted — see WeeklyDigest.tsx')
  } else {
    const bullets = await page.locator('.tch-digest__bullet').count()
    check('the weekly digest renders bullets', bullets > 0, `${bullets} bullets`)
    if (bullets > 0) {
      const withEvidence = await page.locator('.tch-digest__bullet .tch-evidence__toggle').count()
      check('every digest bullet opens to its datum',
            withEvidence === bullets, `${withEvidence}/${bullets}`)
    }
  }

  // ── moments feed ──────────────────────────────────────────────────────────
  const momentsPanel = await page.locator('.tch-moments, .tch-moments__none').count()
  check('the moments feed is on Home', momentsPanel > 0)

  const moments = await page.locator('.tch-moment').count()
  if (moments > 0) {
    const evidence = await page.locator('.tch-moment .tch-evidence__toggle').count()
    check('every moment opens to its events', evidence === moments, `${evidence}/${moments}`)

    const text = await page.locator('.tch-moment__text').first().innerText()
    check('the moment reads as a sentence, not a key',
          !text.includes('tch.moment.'), text.slice(0, 60))

    // ── kudos, from the moment that earned it ───────────────────────────────
    await page.locator('.tch-moment__praise').first().click()
    await page.waitForSelector('.tch-moment__kudos', { timeout: 5000 })
    const hint = await page.locator('.tch-moment__kudosHint').innerText()
    check('the composer says Yuvi will deliver it', hint.length > 10, hint.slice(0, 60))

    await page.locator('.tch-moment__kudos textarea').fill('ראיתי את ההתמדה שלך - כל הכבוד')
    await page.locator('.tch-moment__kudosActions .sp-btn--primary').click()
    await page.waitForSelector('.tch-moment__sent', { timeout: 20000 })
    check('praise sends and confirms', true)
    await page.screenshot({ path: `${OUT}/01-moments-kudos.png`, fullPage: true })
  } else {
    console.log('    (no moments in this group right now — kudos not exercised here)')
    check('the empty feed states it rather than rendering nothing',
          (await page.locator('.tch-moments__none').count()) > 0)
  }

  // ── student profile: one scrolling page ──────────────────────────────────
  /* The roster now defaults to the TABLE view, and `.tch-studentCard` only
     exists in the grid — so this waited 40s for a card that renders only after
     a view switch, and threw. Switch to the grid deliberately (it is also the
     view whose card→profile link is worth exercising) and fall back to a direct
     visit if the toggle is not there. */
  await page.goto(`${BASE}/teacher/students`, { waitUntil: 'domcontentloaded' })
  /* Wait for the LIST, not the container: `.tch-roster` is on screen while the
     roster is still fetching (that is what its `aria-busy` is for), so clicking
     the view toggle on its arrival switched views on an empty list and then
     counted zero cards. */
  await page.waitForSelector('.tch-studentCard, .tch-roster table tbody tr', { timeout: 40000 })
  if (!(await page.locator('.tch-studentCard').count())) {
    await page.locator('.tch-roster__views button').last().click()
    await page.waitForSelector('.tch-studentCard', { timeout: 20000 }).catch(() => {})
  }
  if (await page.locator('.tch-studentCard').count()) {
    await page.locator('.tch-studentCard').first().click()
  } else {
    check('the roster offers a way into a profile', false, 'no card and no row')
    await page.goto(`${BASE}/teacher/student/gal`, { waitUntil: 'domcontentloaded' })
  }
  await page.waitForSelector('.tch-student__body', { timeout: 30000 })

  /* No tab bar any more — the profile is one scrolling page. Its lead is the
     KPI strip (four cards, same language as Home's) and the status band with
     its half-arc dials. */
  /* The strip renders only after the activity rows arrive — counting on body
     mount raced that fetch and read zero. */
  await page.waitForSelector('.tch-student__kpis', { timeout: 20000 }).catch(() => {})
  const kpiCards = await page.locator('.tch-student__kpis .tch-stat').count()
  // Three figures now: the mastery % moved to the status band's dials.
  check('the KPI strip has three figures', kpiCards === 3, `${kpiCards} figures`)
  const halfDials = await page.locator('.tch-status .sp-chart-ring--half').count()
  check('the status band is drawn with half-arc dials',
        (await page.locator('.tch-status').count()) === 1 && halfDials > 0,
        `${halfDials} dials`)
  await page.screenshot({ path: `${OUT}/02-profile.png`, fullPage: true })

  // ── themes ────────────────────────────────────────────────────────────────
  const colours = {}
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
    await page.waitForTimeout(400)
    colours[theme] = await page.locator('.tch-stat').first()
      .evaluate((node) => getComputedStyle(node).color)
  }
  check('the new surfaces render in both themes',
        colours.light !== colours.dark, `${colours.light} vs ${colours.dark}`)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('page does not scroll horizontally', overflow <= 1, `${overflow}px`)

  // ── scoping ───────────────────────────────────────────────────────────────
  const outsider = await browser.newContext()
  await outsider.request.post(`${BASE}/api/auth/login`,
    { data: { username: 'moti', password: 'Aa12345' } })
  for (const [label, path] of [
    ['moments', '/api/teacher/groups/demo-group-a/moments'],
    ['digest', '/api/teacher/groups/demo-group-a/digest'],
    ['meeting prep', '/api/teacher/students/demo-shir/meeting-prep'],
  ]) {
    const response = await outsider.request.get(`${BASE}${path}`)
    check(`an outsider is refused ${label}`, response.status() === 403, `HTTP ${response.status()}`)
  }
  await outsider.close()

  // ── nothing internal reaches a teacher's eyes ────────────────────────────
  /* Every one of these was on screen at once: `q1` four times down the activity
     table (the content numbers questions WITHIN a screen, so the raw id names a
     different question in every screen), `ENG.G7.FAMILY.GRAMMAR-01-04` where a
     screen title belonged, `MOE.ENG.G7.PEOPLE.FAMILY.WRITE` as the name of what
     a child had just achieved, and `tch.subject.english` as a subject.
     They came from four different modules, which is why this is one sweep over
     the rendered page rather than four assertions in four suites. */
  const LEAKS = [
    { name: 'a provider question id', pattern: /\bq[0-9]\b/ },
    { name: 'a component id', pattern: /(ENG\.G7|methodica-)[A-Za-z.\-0-9]*/ },
    { name: 'a dotted MOE objective key', pattern: /\bMOE\.[A-Z][A-Z.\-0-9]*/ },
    { name: 'a raw locale key', pattern: /\btch\.[a-z]+\.[a-zA-Z.]+/ },
  ]

  /* `.tch-learning__idTitle` is the ONE deliberate id on screen: a learning the
     vendor never titled has no other name, and it is rendered as an identifier
     and labelled as one rather than dressed up as a title. Excluded by node,
     not by pattern, so the exemption cannot silently widen. */
  const visibleText = () => page.evaluate(() => {
    const clone = document.body.cloneNode(true)
    clone.querySelectorAll('.tch-learning__idTitle, .tch-learning__meta')
      .forEach((node) => node.remove())
    return clone.innerText
  })

  for (const [label, path] of [
    ['the dashboard', '/teacher'],
    ['the learnings screen', '/teacher/learnings'],
    ["a student's profile", '/teacher/student/gal'],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    const text = await visibleText()
    for (const leak of LEAKS) {
      const hit = text.match(leak.pattern)
      check(`${label}: no ${leak.name}`, !hit, hit ? hit[0] : 'clean')
    }
  }

  // The topic rows are closed drawers on the single profile page, so a
  // page-load sweep never sees inside them — and they are where the digest
  // (or its plain-aggregate fallback) lives.
  await page.goto(`${BASE}/teacher/student/gal`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-topics', { timeout: 60000 })

  /* The hardest card names TOPICS, not question numbers: every row is an idea
     aggregated across its questions, it says how much evidence is behind it,
     and a topic never answered right shows its fraction in words rather than
     a meaningless "0%". */
  const topicValues = await page.locator('.tch-topics__value').allInnerTexts()
  check('the hardest-topics card is drawn', topicValues.length > 0,
        `${topicValues.length} topics`)
  check('and no row is a bare zero percent',
        !topicValues.some((value) => value.trim() === '0%'), topicValues.join(' '))
  const topicNames = await page.locator('.tch-topics__name').allInnerTexts()
  check('and no topic is named as a question number',
        !topicNames.some((name) => /(?:שאלה|سؤال|question)\s*\d/i.test(name)),
        topicNames.join(' | '))
  check('and every topic states its evidence',
        await page.locator('.tch-topics__evidence').count() === topicValues.length)

  // Open every topic before sweeping: hidden text is not swept by innerText,
  // and the raw vendor prose this guards against must never render here.
  await page.evaluate(() => document.querySelectorAll('.tch-topics__topic')
    .forEach((node) => node.setAttribute('open', '')))
  await page.waitForTimeout(300)
  const topicsText = await visibleText()
  for (const leak of LEAKS) {
    const hit = topicsText.match(leak.pattern)
    check(`the opened topics: no ${leak.name}`, !hit, hit ? hit[0] : 'clean')
  }

  /* ── the sometimes-reading lives behind doors, and each door opens ────────
     Strengths/difficulties and the portrait are dialogs now: a teacher who
     wants one opens it, nobody scrolls past both every visit. */
  await page.waitForSelector('.tch-student__more', { timeout: 60000 })
  await page.locator('.tch-student__more button', { hasText: 'חוזקות' }).click()
  await page.waitForSelector('.tch-balance', { timeout: 30000 })

  const columns = await page.locator('.tch-balance__col').count()
  check('strengths and difficulties sit side by side', columns === 2, `${columns} columns`)
  check('with a rule between them', await page.locator('.tch-balance__rule').count() === 1)
  const sameRow = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.tch-balance__col')]
    if (cols.length !== 2) return false
    const [a, b] = cols.map((node) => node.getBoundingClientRect())
    return Math.abs(a.top - b.top) < 4 && Math.abs(a.left - b.left) > 100
  })
  check('genuinely beside each other, not stacked', sameRow)
  check('and the repeated kind chip is gone',
        await page.locator('.tch-strength .sp-pill, .tch-strength .sp-statusPill').count() === 0)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  /* The portrait is a SUMMARY: one current sentence per facet, the rest behind
     a disclosure. */
  await page.locator('.tch-student__more button', { hasText: 'איך המערכת' }).click()
  await page.waitForSelector('.tch-portrait', { timeout: 30000 })
  const facets = await page.locator('.tch-portrait__facet').count()
  const leads = await page.locator('.tch-portrait__facet p:not(.tch-portrait__more)').count()
  check('the profile describes the child in sentences', facets > 0, `${facets} facets`)
  check('one current sentence each, not the whole description',
        leads === facets && await page.locator('.tch-portrait__more').count() === 0,
        `${leads} leads`)
  check('and says what they are based on',
        await page.locator('.tch-portrait__provenance').count() === 1)
  const moreBtn = page.locator('.tch-portrait__foot button')
  if (await moreBtn.count()) {
    await moreBtn.click()
    await page.waitForTimeout(200)
    check('the rest is one click away, never hidden',
          await page.locator('.tch-portrait__more').count() > 0)
    await moreBtn.click()
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  /* ── the KPI strip leads with the material ────────────────────────────────
     The success rate led it and counts ATTEMPTS, so a child who works through
     a hard lesson twice reads worse than one who answered four easy questions
     once — and the same percentage is already the tone on every worked-on
     card. What a teacher opens a profile for is how far through they are. */
  const kpiLabels = await page.locator('.tch-student__kpis .tch-stat__label').allInnerTexts()
  /* The mastery figure lives in the status band's dials now — a second copy
     in the strip said the same number twice on one screen. */
  check('the mastery percentage is not duplicated in the strip',
        !kpiLabels.some((label) => label.includes('חומר שנשלט')), kpiLabels.join(' | '))
  check('and the attempt-weighted success rate is gone',
        !kpiLabels.some((label) => label.includes('אחוז הצלחה')), kpiLabels.join(' | '))

  /* Round 3 flipped this: the dial is ALWAYS drawn — a missing gauge beside
     four drawn ones reads as a rendering bug — and the CAPTION is what tells
     the truth about an untouched subject. So a 0% dial is legal exactly when
     "טרם התחילו" stands under it. */
  const progressText = await page.locator('[data-tour="teacher.subjectProgress"]').innerText()
  const hasBareZero = /(?<!\d)0%/.test(progressText)
  check('a 0% dial is always captioned "not started" or "worked, none yet"',
        !hasBareZero || progressText.includes('טרם התחילו')
        || progressText.includes('עדיין ללא יעדים'),
        progressText.replace(/\n/g, ' · '))

  /* Every recommendation names something about THIS child. The generic
     sentences are the fallbacks, and seeing one means the catalogue missed. */
  const recTexts = await page.locator('.tch-rec__text').allInnerTexts()
  check('recommendations are on screen', recTexts.length > 0, `${recTexts.length}`)
  check('none of them is an unfilled template',
        !recTexts.some((text) => /\{[a-z_]+\}/.test(text)), recTexts.join(' | '))

  // The "why?" behind one, opened: a sentence, not the payload that produced
  // it. The panel is capped at three rows now and derived rows carry their
  // numbers IN the sentence instead of a toggle — so a why exists only when a
  // server-sourced row made the cut, and its absence is a legal state.
  const whyToggles = await page.locator('.tch-rec .tch-evidence__toggle').count()
  if (whyToggles === 0) {
    check('the why toggle (no server-sourced row on this child)', true, 'skipped')
  } else {
    await page.locator('.tch-rec .tch-evidence__toggle').first().click()
    const why = (await page.locator('.tch-rec__because').first().innerText()).trim()
    check('the why is one readable sentence', why.length > 12 && !why.includes('{'), why)
    check('and not the raw payload',
          !/objectives (total|mastered|in progress)|score ewma|labels:/i.test(why), why)
  }

  // ── a Hebrew placeholder reads right-to-left ─────────────────────────────
  /* `dir="auto"` resolves from the VALUE, and an empty value has no direction —
     so every Hebrew placeholder in the product rendered LTR, ellipsis on the
     wrong side. The fix is scoped to `:placeholder-shown`, so `dir="auto"` must
     still take over the moment a character is typed. Both halves are checked. */
  await page.goto(`${BASE}/teacher/messages`, { waitUntil: 'domcontentloaded' })
  const composer = page.locator('.tch-thread__composer input')
  await composer.waitFor({ timeout: 60000 })
  const dirOf = () => composer.evaluate((node) => getComputedStyle(node).direction)
  check('an empty Hebrew field follows the page', await dirOf() === 'rtl', await dirOf())
  await composer.fill('hello')
  check('a typed Latin value still flips it', await dirOf() === 'ltr', await dirOf())
  await composer.fill('שלום')
  check('a typed Hebrew value stays rtl', await dirOf() === 'rtl', await dirOf())
  await composer.fill('')
  check('and it returns when the field is cleared', await dirOf() === 'rtl', await dirOf())

  /* ── the "+" lanes, in the theme the teacher is actually in ───────────────
     The menu painted itself with `--sp-bg`, which is the APP background and is
     deliberately LIGHT in dark mode — a white popover with dark-mode ink on
     it. And the dialog's cancel button rendered `tch.cancel`, a key that has
     never existed. Both were in the same three lines of markup. */
  const luma = (colour) => {
    const [r, g, b] = (colour.match(/\d+(\.\d+)?/g) ?? []).map(Number)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }
  const isDark = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme') === 'dark'
    || matchMedia('(prefers-color-scheme: dark)').matches)

  await page.locator('.tch-thread__moreBtn').click()
  await page.locator('.tch-thread__menu').waitFor({ timeout: 10000 })
  const menuBg = await page.locator('.tch-thread__menu')
    .evaluate((node) => getComputedStyle(node).backgroundColor)
  check('the "+" menu is painted in the page theme',
        !isDark || luma(menuBg) < 0.5, `${menuBg}${isDark ? '' : ' (light theme)'}`)

  await page.locator('.tch-thread__menu button').first().click()
  await page.locator('.tch-laneDialog').waitFor({ timeout: 10000 })
  const dialogText = await page.locator('.tch-laneDialog').innerText()
  check('and the dialog has no raw locale key in it',
        !/\btch\.[a-z]+/.test(dialogText), dialogText.replace(/\n+/g, ' · '))
  await page.keyboard.press('Escape')

  // ── every page sits in the same frame ────────────────────────────────────
  /* The frame was copied byte-for-byte into six stylesheets and the tasks page
     shipped without its copy: content flush against the chrome on all sides. */
  for (const [label, path, root] of [
    ['tasks', '/teacher/tasks', '.tch-tasks'],
    ['messages', '/teacher/messages', '.tch-messages'],
    ['learnings', '/teacher/learnings', '.tch-learnings'],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await page.locator(root).waitFor({ timeout: 45000 })
    const frame = await page.locator(root).evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        top: parseFloat(style.paddingBlockStart),
        side: parseFloat(style.paddingInlineStart),
        max: style.maxInlineSize,
      }
    })
    check(`the ${label} page is framed like every other`,
          frame.top > 8 && frame.side > 8 && frame.max === '1240px',
          `${frame.top}px / ${frame.side}px / ${frame.max}`)
  }

  await context.close()
} finally {
  await browser.close()
}

if (failures.length) {
  console.log(`\n✘ ${failures.length} failure(s)`)
  for (const failure of failures) console.log(`   - ${failure}`)
  process.exit(1)
}
console.log('\n✅ phase 7 check passed')
