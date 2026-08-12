/* The visual half of the Hebrew+math contract.
 *
 *   cd frontend && node scripts/math-rtl-check.mjs [--headed]
 *
 * `math-segments.test.ts` proves the *splitting* is right. It cannot prove the
 * rendering is, because everything it checks is a string — and the failure here
 * is that a correct string is laid out wrongly by the bidi algorithm. A formula
 * whose operators have migrated to the far end still reads as a correct formula
 * in a test assertion.
 *
 * So this measures geometry in a real engine, at `dir=rtl`, against the exact
 * markup and CSS the player ships.
 *
 * ── choosing fixtures that can actually fail ────────────────────────────────
 *
 * The first version of this check used `x² - 5x + 6 = 0` and passed with the
 * isolation stripped out entirely. A formula beginning with a Latin letter is
 * anchored by that strong-LTR character and lays out correctly on its own —
 * it CANNOT demonstrate the bug. The expressions that break are the ones with
 * no letter at all: pure arithmetic, which is most of primary-school maths.
 *
 *     "3 + 4 = 7"  unisolated in a Hebrew line renders  7=4+3
 *     "-4"         renders                              4-
 *
 * So every fixture below is one of those, and the check ends by stripping the
 * isolation and asserting the layout DOES break — a check that cannot fail is
 * worse than no check, because it reports success.
 */

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const css = readFileSync(new URL('../src/features/tasks/tasks.css', import.meta.url), 'utf8')

const fail = []
const ok = (label) => console.log(`  ✔ ${label}`)
const bad = (label) => { fail.push(label); console.log(`  ✖ ${label}`) }

const browser = await chromium.launch({ headless: !args.includes('--headed') })
const page = await (await browser.newContext({ viewport: { width: 900, height: 640 } })).newPage()

/** Formulas with no strong-LTR letter — the ones bidi actually reverses. */
const FIXTURES = [
  { math: '3 + 4 = 7', punctuation: '.', prose: 'התרגיל הוא ' },
  { math: '-4', punctuation: '', prose: 'הערך הוא ' },
  { math: '(3 + 4) × 2', punctuation: '.', prose: 'חשבו ' },
  { math: '10 - 3 = 7', punctuation: '?', prose: 'נכון ש' },
]

/** Exactly what `MathText` renders for one line. */
const markup = (fixture, isolated) => `<p dir="auto" class="line">`
  + `<span>${fixture.prose}</span>`
  + `<span class="wrap"><span class="${isolated ? 'yv-math' : 'yv-bare'}"`
  + `${isolated ? ' dir="ltr"' : ''}>${fixture.math}</span>`
  + `<span class="punct">${fixture.punctuation}</span></span></p>`

async function render(isolated) {
  await page.setContent(`<!doctype html><html dir="rtl" lang="he"><head><style>
    body { font-family: system-ui, sans-serif; font-size: 26px; padding: 24px; }
    .line { margin: 0 0 18px; }
    ${css}
  </style></head><body>
    ${FIXTURES.map((fixture) => markup(fixture, isolated)).join('\n')}
  </body></html>`)
}

/** The characters of one formula, in the order they appear on screen. */
async function visualOrder(index) {
  return page.evaluate((at) => {
    const span = document.querySelectorAll('.wrap > span:first-child')[at]
    const text = span.textContent
    span.innerHTML = [...text]
      .map((char) => `<i style="font-style:normal">${char === ' ' ? '&nbsp;' : char}</i>`)
      .join('')
    const boxes = [...span.querySelectorAll('i')]
      .map((node, position) => ({ char: text[position], x: node.getBoundingClientRect().x }))
      .filter((entry) => entry.char !== ' ')
    return [...boxes].sort((a, b) => a.x - b.x).map((entry) => entry.char).join('')
  }, index)
}

// ── the isolate is in force ─────────────────────────────────────────────────
console.log('\n— the isolate is in force —')
await render(true)
const applied = await page.evaluate(() => {
  const style = getComputedStyle(document.querySelector('.yv-math'))
  return { bidi: style.unicodeBidi, direction: style.direction, wrap: style.whiteSpace }
})
if (applied.bidi === 'isolate') ok('unicode-bidi is isolate')
else bad(`unicode-bidi is isolate (got ${applied.bidi})`)
if (applied.direction === 'ltr') ok('the formula runs left to right')
else bad(`the formula runs left to right (got ${applied.direction})`)
if (applied.wrap === 'nowrap') ok('a formula never breaks across lines')
else bad(`a formula never breaks across lines (got ${applied.wrap})`)

// ── every formula reads correctly on screen ─────────────────────────────────
console.log('\n— the characters stay in order —')
const isolatedOrders = []
for (const [index, fixture] of FIXTURES.entries()) {
  await render(true)
  const onScreen = await visualOrder(index)
  isolatedOrders.push(onScreen)
  const expected = fixture.math.replace(/\s/g, '')
  if (onScreen === expected) ok(`"${fixture.math}" reads as "${onScreen}"`)
  else bad(`"${fixture.math}" reads as "${onScreen}" — expected "${expected}"`)
}

// ── the sentence's punctuation is not dragged into the formula ──────────────
console.log('\n— the punctuation stays with the sentence —')
await render(true)
const stops = await page.evaluate(() => [...document.querySelectorAll('.wrap')].map((wrap) => {
  const math = wrap.querySelector('span:first-child').getBoundingClientRect()
  const punct = wrap.querySelector('.punct').getBoundingClientRect()
  return { text: wrap.querySelector('.punct').textContent, mathX: math.x, punctX: punct.x }
}).filter((entry) => entry.text))
for (const stop of stops) {
  // An RTL line ends on the left, so its final mark belongs left of the formula.
  if (stop.punctX < stop.mathX) ok(`"${stop.text}" sits left of its formula, ending the line`)
  else bad(`"${stop.text}" sits left of its formula `
    + `(mark at ${Math.round(stop.punctX)}, formula at ${Math.round(stop.mathX)})`)
}

// ── and the isolation is what is doing it ───────────────────────────────────
console.log('\n— stripping the isolation must break it —')
/* Without this the whole check can pass on markup that is doing nothing, which
   is exactly what happened with the first set of fixtures. */
await render(false)
let broke = 0
for (const [index, fixture] of FIXTURES.entries()) {
  await render(false)
  const onScreen = await visualOrder(index)
  if (onScreen !== isolatedOrders[index]) {
    broke += 1
    console.log(`  · "${fixture.math}" unisolated reads "${onScreen}"`)
  }
}
if (broke === FIXTURES.length) {
  ok(`all ${broke} fixtures reverse without the isolate — the check has teeth`)
} else {
  bad(`every fixture must break unisolated (only ${broke} of ${FIXTURES.length} did) — `
    + 'the passing fixtures prove nothing')
}

await page.screenshot({ path: 'scripts/.math-rtl.png' })
await browser.close()
console.log(fail.length ? `\n❌ ${fail.length} check(s) failed` : '\n✅ all checks passed')
process.exit(fail.length ? 1 : 0)
