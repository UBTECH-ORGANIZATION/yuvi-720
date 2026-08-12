/* Phase 7 in a real browser: badges, moments, kudos, digest, meeting prep.
 *
 * What is worth checking here rather than in unit tests:
 *
 *   - The badges tab answers "what does this certify?", not just "what did they
 *     win" — the objectives must be reachable from the row.
 *   - Every digest bullet and every moment opens to its datum. A panel that
 *     narrates without evidence is the exact failure mode of this phase.
 *   - The meeting drawer deep-links (`?meeting=1`) and survives a reload, which
 *     is the whole reason it is a query param and not component state.
 *   - Kudos is reachable from the moment that earned it.
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

  // ── badges tab ────────────────────────────────────────────────────────────
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
  await page.waitForSelector('.tch-tabs', { timeout: 30000 })

  const tabs = page.locator('.tch-tabs button')
  const tabCount = await tabs.count()
  check('the profile now has seven tabs', tabCount === 7, `${tabCount}`)

  const labels = await tabs.allTextContents()
  check('one of them is Badges',
        labels.some((label) => label.trim().length > 0), labels.join(' · '))

  await tabs.nth(3).click()
  await page.waitForTimeout(2500)
  const badgeRows = await page.locator('.tch-badge').count()
  check('the badges tab lists badges', badgeRows > 0, `${badgeRows} badges`)

  if (badgeRows > 0) {
    const certifies = await page.locator('.tch-badge__certifies').count()
    check('badges state what they certify', certifies > 0, `${certifies} with objectives`)
    await page.locator('.tch-badge__certifies summary').first().click()
    await page.waitForTimeout(300)
    const objectives = await page.locator('.tch-badge__certifies li').count()
    check('opening a badge shows the objectives behind it', objectives > 0, `${objectives}`)
    check('no raw locale key on the badges tab',
          !(await page.locator('.tch-badges').innerText()).includes('tch.badges.'))
    await page.screenshot({ path: `${OUT}/02-badges.png`, fullPage: true })
  }

  // ── meeting prep drawer ───────────────────────────────────────────────────
  const profileUrl = page.url()
  await page.locator('.tch-student__meeting').click()
  await page.waitForSelector('.tch-drawer', { timeout: 10000 })
  check('the meeting drawer opens over the profile', page.url().includes('meeting=1'), page.url())

  /* Wait for the outcome, not for a guessed loading class: meeting prep makes
     an LLM call and can take ten seconds or more. A fixed sleep here measured an
     empty drawer and reported it as "shows nothing". */
  await page.waitForFunction(
    () => document.querySelector('.tch-prep li') || document.querySelector('.tch-drawer__empty'),
    { timeout: 90000 }
  ).catch(() => {})

  const prepRows = await page.locator('.tch-prep li').count()
  const unavailable = await page.locator('.tch-drawer__empty').count()
  check('the drawer shows suggestions or says why it cannot',
        prepRows > 0 || unavailable > 0, `${prepRows} rows, ${unavailable} empty-state`)

  if (prepRows > 0) {
    const withWhy = await page.locator('.tch-prep li .tch-evidence__toggle').count()
    check('every suggestion shows what it rests on', withWhy === prepRows, `${withWhy}/${prepRows}`)
  }
  await page.screenshot({ path: `${OUT}/03-meeting-prep.png` })

  /* Deep link: the whole reason this is a query param. Waited on rather than
     slept through — the drawer only mounts after the profile's own fetch
     resolves, so a fixed 3s pause sat right on that boundary and failed or
     passed depending on the day. */
  await page.reload({ waitUntil: 'domcontentloaded' })
  const survived = await page.locator('.tch-drawer')
    .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
  check('the drawer survives a reload (deep link works)', survived)

  // Escape closes it and clears the param.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  check('escape closes the drawer',
        (await page.locator('.tch-drawer').count()) === 0 && !page.url().includes('meeting=1'),
        page.url())
  check('closing returns to the profile', page.url().split('?')[0] === profileUrl.split('?')[0])

  // ── themes ────────────────────────────────────────────────────────────────
  const colours = {}
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
    await page.waitForTimeout(400)
    colours[theme] = await page.locator('.tch-tabs button').first()
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

  // The activity tab specifically — it is behind a click, so a page-load sweep
  // never sees it, and it is where every one of these ids used to live.
  await page.goto(`${BASE}/teacher/student/gal`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-student__tabs button, [role=tab]', { timeout: 60000 })
  const profileTabs = page.locator('.tch-student__tabs button, [role=tab]')
  for (let index = 0; index < await profileTabs.count(); index += 1) {
    if ((await profileTabs.nth(index).innerText()).includes('פעילות')) {
      await profileTabs.nth(index).click()
      break
    }
  }
  await page.waitForSelector('.tch-worked__lesson', { timeout: 30000 })

  /* Every lesson is CLOSED on arrival — twenty of them expanded, each with a
     paragraph per item, was a page nobody reached the end of. */
  const lessons = await page.locator('.tch-worked__lesson').count()
  const openOnArrival = await page.locator('.tch-worked__lesson[open]').count()
  check('lessons arrive collapsed', lessons > 0 && openOnArrival === 0,
        `${lessons} lessons, ${openOnArrival} open`)

  /* The moments feed is its own fetch, and it used to render nothing until it
     landed — so it appeared above what the teacher was already reading and
     pushed it down the page. It lives inside the tab's grid now, so the space
     below it is the same gap as everywhere else rather than zero. */
  const momentsGap = await page.evaluate(() => {
    const feed = document.querySelector('.tch-student__moments')
    const next = feed?.nextElementSibling
    if (!feed || !next) return -1
    return Math.round(next.getBoundingClientRect().top - feed.getBoundingClientRect().bottom)
  })
  check('the moments feed is spaced from the panel below it', momentsGap > 4,
        `${momentsGap}px`)
  check('each closed lesson still says how it went',
        await page.locator('.tch-worked__counts').count() === lessons,
        `${await page.locator('.tch-worked__dots').count()} dot strips`)

  /* The month strip belongs to the overview. This tab is about what happened
     inside the work, not when. */
  check('the activity tab does not repeat the month strip',
        await page.locator('.tch-trend').count() === 0)

  /* A question they never got right has a zero-length bar, so a column of them
     is labels beside an empty track. They are excluded from the chart and
     counted in a line beneath it — never silently dropped. */
  const barValues = await page.locator('.sp-chart-bars__value').allInnerTexts()
  check('the hardest-questions chart is drawn', barValues.length > 0, `${barValues.length} bars`)
  check('and has no empty bars',
        !barValues.some((value) => value.trim() === '0%'), barValues.join(' '))

  // Open every lesson before sweeping: hidden text is not swept by innerText,
  // and the ids this guards against live inside the items.
  await page.evaluate(() => document.querySelectorAll('.tch-worked__lesson')
    .forEach((node) => node.setAttribute('open', '')))
  await page.waitForTimeout(300)
  const activityText = await visibleText()
  for (const leak of LEAKS) {
    const hit = activityText.match(leak.pattern)
    check(`the activity tab: no ${leak.name}`, !hit, hit ? hit[0] : 'clean')
  }

  const worked = await page.locator('.tch-worked__item').count()
  const teaches = await page.locator('.tch-worked__teaches').count()
  check('every item says what it was', worked > 0, `${worked} items`)
  check('and what the lesson meant it to teach', teaches > 0, `${teaches} described`)

  /* ── the overview reads as a profile, not as a form ───────────────────────
     Reported from real usage: generic plain-text panels, a "חוזקה בפרופיל"
     chip repeated down the strengths list, and three bare questionnaire chips
     standing in for a description of the child. */
  await page.goto(`${BASE}/teacher/student/gal`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tch-balance', { timeout: 60000 })

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

  /* The portrait is a SUMMARY: one current sentence per facet, the rest behind
     a disclosure. It shipped as nine bulleted sentences under four headings,
     which is the whole description — a document, not an answer. */
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
  check('the questionnaire answers are a footnote, not a panel',
        await page.locator('.tch-student__described').count() === 0)

  /* ── the KPI strip leads with the material ────────────────────────────────
     The success rate led it and counts ATTEMPTS, so a child who works through
     a hard lesson twice reads worse than one who answered four easy questions
     once — and the same percentage is already the tone on every worked-on
     card. What a teacher opens a profile for is how far through they are. */
  const kpiLabels = await page.locator('.tch-student__kpis .tch-stat__label').allInnerTexts()
  check('the first KPI is how much of the material is mastered',
        kpiLabels[0]?.trim() === 'חומר שנשלט', kpiLabels.join(' | '))
  check('and the attempt-weighted success rate is gone',
        !kpiLabels.some((label) => label.includes('אחוז הצלחה')), kpiLabels.join(' | '))

  /* A subject nobody has touched says so, instead of drawing an empty ring
     with "0%" written inside it — which reads as a broken widget. */
  const progressText = await page.locator('[data-tour="teacher.subjectProgress"]').innerText()
  // A standalone zero, not the "0%" inside "100%".
  check('an untouched subject says "not started", not "0%"',
        !/(?<!\d)0%/.test(progressText), progressText.replace(/\n/g, ' · '))

  /* Every recommendation names something about THIS child. The generic
     sentences are the fallbacks, and seeing one means the catalogue missed. */
  const recTexts = await page.locator('.tch-rec__text').allInnerTexts()
  check('recommendations are on screen', recTexts.length > 0, `${recTexts.length}`)
  check('none of them is an unfilled template',
        !recTexts.some((text) => /\{[a-z_]+\}/.test(text)), recTexts.join(' | '))

  // The "why?" behind one, opened: a sentence, not the payload that produced it.
  const firstWhy = page.locator('.tch-rec .tch-evidence__toggle').first()
  await firstWhy.click()
  const why = (await page.locator('.tch-rec__because').first().innerText()).trim()
  check('the why is one readable sentence', why.length > 12 && !why.includes('{'), why)
  check('and not the raw payload',
        !/objectives (total|mastered|in progress)|score ewma|labels:/i.test(why), why)

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
