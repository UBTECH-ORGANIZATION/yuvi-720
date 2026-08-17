/* Drives the two new question shapes through a real player, in a real browser.
 *
 * Everything here goes through the same launch, the same payload and the same
 * `/answer` round-trip a learner gets — the point is to prove the interactions
 * work end to end, not that the renderers produce the right DOM.
 *
 *   backend/.venv/bin/python scripts/mint_launches.py ENG.G7.FAMILY.VOCAB-02 ENG.G7.FAMILY.VOCAB-03
 *   node scripts/player-interactions.mjs
 */

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const urls = JSON.parse(readFileSync('/tmp/player_launches.json', 'utf8'))
const out = []
const ok = (label, pass, detail = '') => {
  out.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return pass
}

const browser = await chromium.launch({ channel: 'chrome' })

const report = (thrown) => {
  if (thrown) out.push(`FAIL  harness stopped — ${String(thrown).split('\n')[0]}`)
  console.log(out.join('\n'))
  const failed = out.filter((line) => !line.startsWith('PASS')).length
  console.log(failed ? `\n${failed} PROBLEM(S)` : '\nALL PASS')
  process.exit(failed ? 1 : 0)
}
process.on('uncaughtException', async (error) => {
  await browser.close().catch(() => {})
  report(error)
})

/** Walk forward until a selector shows up, or run out of screens.
 *
 *  A screen shows its questions one at a time and holds "continue" until the one
 *  on show is answered, so getting to a later question means answering the
 *  earlier ones. Any option will do — what is being reached for is the shape of
 *  the next question, not a score. */
async function advanceTo(page, selector, limit = 16) {
  for (let step = 0; step < limit; step += 1) {
    if (await page.locator(selector).count()) return true
    const next = page.locator('.lp-foot .lp-btn').last()
    if (!(await next.count())) return false
    if (await next.isDisabled()) {
      const option = page.locator('.lp-option:not(:disabled)').first()
      if (!(await option.count())) return false
      await option.click()
      // Wait for the grade to come back rather than for a guessed number of
      // milliseconds — a fixed sleep here is what makes a harness flaky.
      await next.waitFor({ state: 'attached' })
      await page.waitForFunction(
        () => !document.querySelector('.lp-foot .lp-btn:last-child')?.disabled,
        null, { timeout: 10000 },
      ).catch(() => {})
      continue
    }
    await next.click()
    await page.waitForTimeout(400)
  }
  return false
}

function watch(page, answered) {
  page.on('request', (request) => {
    if (!request.url().includes('/statements')) return
    try {
      const body = JSON.parse(request.postData())
      if (body.verb.id.endsWith('/answered')) answered.push(body.object.id)
    } catch { /* not ours */ }
  })
  page.on('console', (m) => { if (m.type() === 'error') out.push(`CONSOLE ERROR: ${m.text()}`) })
  page.on('pageerror', (e) => out.push(`PAGE ERROR: ${e.message}`))
}

/* ── matching ───────────────────────────────────────────────────────────── */
{
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
  const answered = []
  watch(page, answered)
  await page.goto(urls['ENG.G7.FAMILY.VOCAB-02'], { waitUntil: 'load' })
  await page.waitForSelector('.lp-card', { timeout: 15000 })

  ok('a matching screen is reachable', await advanceTo(page, '.lp-match'))
  const prompts = page.locator('.lp-match__prompt')
  const chips = page.locator('.lp-match__chip')
  ok('the board draws a row per prompt and a chip per answer',
    await prompts.count() === 4 && await chips.count() === 4,
    `${await prompts.count()} rows, ${await chips.count()} chips`)

  ok('nothing can be checked before every row is paired',
    await page.locator('.lp-match__check').isDisabled())

  // Tap-to-pair, in the order a learner would: the row, then the word.
  await prompts.nth(0).click()
  ok('a tapped row is announced as selected',
    await prompts.nth(0).getAttribute('aria-pressed') === 'true')
  await chips.filter({ hasText: 'uncle' }).first().click()
  ok('the pair lands in the row',
    (await prompts.nth(0).innerText()).includes('uncle'))
  ok('a used word leaves the pool',
    await chips.filter({ hasText: 'uncle' }).first().isDisabled())

  // Undo, then rebuild — a learner changing their mind must not be stuck.
  await prompts.nth(0).click()
  ok('tapping a filled row takes the pair back',
    !(await prompts.nth(0).innerText()).includes('uncle')
    && !(await chips.filter({ hasText: 'uncle' }).first().isDisabled()))

  // The other order — word first, then row — because kids do both.
  await chips.filter({ hasText: 'uncle' }).first().click()
  await prompts.nth(0).click()
  ok('pairing works word-first as well as row-first',
    (await prompts.nth(0).innerText()).includes('uncle'))

  // Keyboard only, for the remaining three.
  const pairByKeyboard = async (row, word) => {
    await prompts.nth(row).focus()
    await page.keyboard.press('Enter')
    await chips.filter({ hasText: word }).first().focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(120)
  }
  await pairByKeyboard(1, 'grandmother')
  await pairByKeyboard(2, 'cousin')
  await pairByKeyboard(3, 'aunt')
  ok('the board can be completed with the keyboard alone',
    (await prompts.nth(3).innerText()).includes('aunt'))
  ok('checking unlocks once every row is paired',
    !(await page.locator('.lp-match__check').isDisabled()))

  await page.locator('.lp-match__check').click()
  await page.waitForTimeout(700)
  ok('a correct board is marked correct',
    await page.locator('.lp-q[data-verdict="correct"]').count() === 1)
  ok('every row shows its own mark',
    await page.locator('.lp-match__prompt[data-verdict="correct"]').count() === 4)
  ok('the marked board is locked',
    await prompts.nth(0).isDisabled() && await chips.first().isDisabled())
  ok('the answer reaches the LRS as .../q1',
    answered.some((id) => /\/q\d+$/.test(id)), answered.join(' '))

  await page.screenshot({ path: '/tmp/match-correct.png' })

  // Walk away and come back: the board must still show what was answered.
  const back = page.locator('.lp-foot .lp-btn').first()
  await back.click(); await page.waitForTimeout(400)
  await page.locator('.lp-foot .lp-btn').last().click(); await page.waitForTimeout(500)
  ok('a revisited board keeps its pairs and its marks',
    (await page.locator('.lp-match__prompt').nth(0).innerText()).includes('uncle')
    && await page.locator('.lp-match__prompt[data-verdict]').count() === 4)

  ok('the screen never scrolls the page',
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1))

  // A marked board disables every control inside the card. If the card also
  // scrolls, a keyboard-only learner would have no way to reach the feedback —
  // so the card itself has to take the tab stop (WCAG 2.1.1).
  ok('a scrollable card with nothing focusable left in it is still keyboard-reachable',
    await page.evaluate(() => {
      const card = document.querySelector('.lp-card')
      const live = card.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled)')
      const scrolls = card.scrollHeight > card.clientHeight + 1
      if (!scrolls) return card.getAttribute('tabindex') === null
      if (live.length) return true               // reachable through its own controls
      card.focus()
      return card.getAttribute('tabindex') === '0' && document.activeElement === card
    }))
  await page.close()
}

/* ── typed answer ───────────────────────────────────────────────────────── */
{
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
  const answered = []
  watch(page, answered)
  await page.goto(urls['ENG.G7.FAMILY.VOCAB-03'], { waitUntil: 'load' })
  await page.waitForSelector('.lp-card', { timeout: 15000 })

  ok('a typed-answer question is reachable', await advanceTo(page, '.lp-text__input'))
  const field = page.locator('.lp-text__input')
  ok('the field types English left-to-right inside a Hebrew page',
    await field.getAttribute('dir') === 'ltr' && await field.getAttribute('lang') === 'en')
  ok('no options are offered', await page.locator('.lp-option').count() === 0)

  // An empty box is not a wrong answer. Counted from here, because getting to
  // this question meant answering the two before it.
  const before = answered.length
  await page.locator('.lp-text__row button').click()
  await page.waitForTimeout(400)
  ok('checking an empty box asks for an answer instead of marking one wrong',
    await page.locator('.lp-feedback:not([hidden])').count() === 1
    && await page.locator('.lp-q[data-verdict]').count() === 0
    && answered.length === before,
    `${answered.length - before} statement(s) sent`)

  // A wrong answer buys a second go, and the second go keeps what was typed.
  await field.fill('make')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  ok('a wrong answer is marked wrong and offers another try',
    await page.locator('.lp-q[data-verdict="incorrect"]').count() === 1
    && await page.locator('.lp-retry:not([hidden])').count() === 1)
  await page.locator('.lp-retry').click()
  await page.waitForTimeout(250)
  ok('trying again unlocks the field, clears the mark, and keeps what was written',
    !(await field.isDisabled())
    && await page.locator('.lp-q[data-verdict]').count() === 0
    && (await field.inputValue()) === 'make')

  // Presentation is forgiven; the word is not.
  await field.fill('  DOES.  ')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  ok('a right word typed with stray case and punctuation is accepted',
    await page.locator('.lp-q[data-verdict="correct"]').count() === 1)
  ok('after the second go there is no third',
    await page.locator('.lp-retry:not([hidden])').count() === 0)
  ok('both attempts reach the LRS, not just the last',
    answered.filter((id) => id.endsWith('/q3')).length === 2,
    `${answered.filter((id) => id.endsWith('/q3')).length} statement(s) for q3`)
  ok('the field locks after it is marked', await field.isDisabled())
  ok('the typed answer reaches the LRS as .../q3',
    answered.some((id) => id.endsWith('/q3')), answered.join(' '))
  await page.screenshot({ path: '/tmp/text-correct.png' })

  ok('the screen never scrolls the page',
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1))
  await page.close()
}

await browser.close()
report(null)
