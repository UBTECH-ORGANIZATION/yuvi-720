/* Two things that only go wrong in the corner of a dialog.
 *
 *   node --test frontend/tests/
 *
 * A tooltip that is cropped by its own scroll container, and a caret that sits
 * on the far side of the field from the placeholder above it. Both are invisible
 * to every other test in this directory — they are layout, in RTL, inside a
 * modal — so they are pinned at the source and verified in a browser.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const tooltip = read('../src/components/primitives/Tooltip.tsx')
const primitives = read('../src/components/primitives/primitives.css')
const builder = read('../src/features/teacher-app/tasks/TeacherTasksPage.tsx')
const locales = {
  he: JSON.parse(read('../../locales/he.json')) as Record<string, string>,
  en: JSON.parse(read('../../locales/en.json')) as Record<string, string>,
  ar: JSON.parse(read('../../locales/ar.json')) as Record<string, string>,
}

describe('nothing can crop a tooltip', () => {
  it('renders the bubble outside every scroll container', () => {
    // The builder's step panel scrolls (that is what keeps the dialog's buttons
    // on screen), and an absolutely-positioned bubble inside it was cut in half
    // by its top edge.
    assert.match(tooltip, /createPortal\([\s\S]{0,700}document\.body\)/)
  })

  it('has one placement implementation, not one per component', () => {
    // `Tooltip` (a `?` beside a label) and `Hint` (wrapping a control that
    // already exists) are two affordances over the same bubble. The flipping,
    // clamping and portalling above is the part that must never exist twice.
    assert.match(tooltip, /export function Tooltip[\s\S]{0,300}useTip\(/)
    assert.match(tooltip, /export function Hint[\s\S]{0,300}useTip\(/)
  })

  it('puts the description on the control, not on the wrapper around it', () => {
    // A screen reader announces the focused button. `aria-describedby` on a
    // span wrapping it is read by nothing.
    assert.match(tooltip, /control\.setAttribute\('aria-describedby', id\)/)
  })

  it('positions it in viewport coordinates', () => {
    const rule = primitives.split('.sp-tip__bubble {')[1].split('}')[0]
    assert.match(rule, /position: fixed/)
    // The old absolute placement, which only worked while nothing clipped it.
    assert.equal(/inset-block-end: calc\(100%/.test(rule), false)
    assert.equal(/transform: translateX/.test(primitives.split('.sp-tip__bubble')[1] ?? ''), false)
  })

  it('flips below and clamps inside the window rather than mirroring by hand', () => {
    assert.match(tooltip, /const above = anchor\.top - bubble\.height - GAP/)
    assert.match(tooltip, /window\.innerWidth - bubble\.width - GAP/)
  })

  it('follows the panel it is anchored in', () => {
    // capture: true — a scrolling panel does not bubble its scroll event, and a
    // bubble left behind points at whatever moved into its place.
    assert.match(tooltip, /addEventListener\('scroll', place, true\)/)
  })

  it('still closes on a click elsewhere, now that the bubble is not inside it', () => {
    // `wrapRef.contains` alone would treat every click INSIDE the bubble as a
    // click elsewhere, so reading a long tooltip would dismiss it.
    const dismiss = tooltip.split('const onPointerDown')[1].split('}\n')[0]
    assert.match(dismiss, /bubbleRef\.current\?\.contains\(target\)/)
  })
})

describe('the caret starts on the side the language is written from', () => {
  it('gives an empty auto-direction field the page direction to fall back to', () => {
    const rule = primitives.split('input[dir="auto"]:placeholder-shown,')[1].split('}')[0]
    assert.match(rule, /textarea\[dir="auto"\]:placeholder-shown/)
    assert.match(rule, /direction: inherit/)
  })

  it('leaves the typed case to the bidi algorithm', () => {
    // `direction` is only the fallback for a paragraph with no strong
    // character; `unicode-bidi: plaintext` (which is what dir="auto" IS) still
    // decides per paragraph once anything is typed. So the rule must not set
    // `unicode-bidi` or a `dir` of its own.
    const rule = primitives.split('input[dir="auto"]:placeholder-shown,')[1].split('}')[0]
    assert.equal(/unicode-bidi/.test(rule), false)
    // And it stops applying the moment there is content to judge: a permanent
    // `direction` would right-align an English answer in a single-line field.
    assert.match(primitives, /input\[dir="auto"\]:placeholder-shown/)
  })
})

describe('the level says what it does', () => {
  it('is explained where it is set', () => {
    const field = builder.split('tch-task-difficulty')[0].slice(-800)
      + builder.split('tch-task-difficulty')[1].slice(0, 800)
    assert.match(field, /tch\.tasks\.difficulty\.help/)
    assert.match(builder, /tch\.tasks\.difficulty\.explain\.\$\{level\}|difficulty\.explain\./)
  })

  it('explains all three levels, in all three languages', () => {
    for (const [language, table] of Object.entries(locales)) {
      for (const level of ['easy', 'medium', 'hard']) {
        const key = `tch.tasks.difficulty.explain.${level}`
        assert.ok(table[key], `${language} is missing ${key}`)
        // "Harder questions" is not an explanation. The promise is specific:
        // steps, numbers, scaffolding, distractors, transfer.
        assert.ok(table[key].length > 120, `${language}.${key} explains nothing`)
      }
      assert.ok(table['tch.tasks.difficulty.explainSlides'], `${language}: slides`)
      assert.ok(table['tch.tasks.difficulty.help'], `${language}: help`)
    }
  })

  it('opens the select from a label, not from a wrapper the tooltip sits inside', () => {
    // A `<button>` inside a `<label>` also activates the labelled control, so
    // clicking the "?" would drop focus into the select behind it.
    assert.match(builder, /<label htmlFor="tch-task-difficulty">/)
    assert.match(builder, /<select id="tch-task-difficulty"/)
  })
})
