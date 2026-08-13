/* Two floating buttons, one corner, one stacking order.
 *
 * The teaching assistant's DOCK is pinned to the physical right in both text
 * directions. The support button used to be pinned there too, so once a teacher
 * opened the assistant the support button sat on top of its panel. Both
 * floating buttons now live in the physical bottom-LEFT, and support rides above
 * the assistant's launcher whenever that launcher is on screen — which is
 * exactly while the assistant panel is closed.
 *
 * The lift is a `:has()` selector reaching from the support feature at a class
 * owned by the teacher app. That is the whole coupling, and it fails silently:
 * rename `.tch-dock__launcher` and the two buttons quietly re-stack on top of
 * each other with no error anywhere. Hence this file.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const support = read('../src/features/support/support-chat.css')
const dock = read('../src/features/teacher-app/assistant/assistant-dock.css')
const dockSource = read('../src/features/teacher-app/assistant/AssistantDock.tsx')

/** The declaration block of a rule, by exact selector. */
function block(css: string, selector: string) {
  const at = css.indexOf(`\n${selector} {`)
  assert.notEqual(at, -1, `no rule for ${selector}`)
  return css.slice(at, css.indexOf('}', at))
}

describe('the class the lift depends on', () => {
  it('is still the one the assistant launcher renders', () => {
    // If this fails, the selector in support-chat.css is dead and the support
    // button will overlap the launcher instead of sitting above it.
    assert.match(dockSource, /className="tch-dock__launcher"/)
    assert.match(support, /:root:has\(\.tch-dock__launcher\)/)
  })

  it('is rendered only while the panel is closed, which is what the lift means', () => {
    // The launcher lives behind `if (!isOpen)`. That is why "launcher present"
    // is a faithful stand-in for "assistant panel closed".
    const guard = dockSource.indexOf('if (!isOpen)')
    assert.notEqual(guard, -1)
    const launcher = dockSource.indexOf('tch-dock__launcher')
    assert.ok(guard < launcher, 'the launcher must be inside the closed branch')
  })
})

describe('both buttons sit on the physical left', () => {
  it('the assistant launcher no longer follows the text direction', () => {
    const rule = block(dock, '.tch-dock__launcher')
    assert.match(rule, /left: var\(--sp-4\)/)
    assert.match(rule, /right: auto/)
    // A declaration, not the word — the comment above it explains the change
    // and naturally contains the property name.
    assert.doesNotMatch(rule, /^\s*inset-inline-end:/m)
  })

  it('the support button and its panel share that edge exactly', () => {
    for (const selector of ['.sp-support-launch', '.sp-support']) {
      const rule = block(support, selector)
      assert.match(rule, /left: var\(--sp-4\)/, selector)
      assert.match(rule, /right: auto/, selector)
    }
  })

  it('keeps the panel clear of the dock, which is physical right in both directions', () => {
    // The reason for all of the above: the dock does NOT flip with direction.
    assert.match(dock, /right: 0;/)
    assert.doesNotMatch(block(support, '.sp-support'), /right: \d/)
  })
})

describe('the lift', () => {
  it('raises the button and its panel together', () => {
    // A panel that does not ride with its button opens out from underneath it.
    assert.match(block(support, '.sp-support-launch'),
      /inset-block-end: calc\(20px \+ var\(--sp-support-lift, 0px\)\)/)
    assert.match(block(support, '.sp-support'),
      /inset-block-end: calc\(74px \+ var\(--sp-support-lift, 0px\)\)/)
  })

  it('is zero unless the launcher is mounted', () => {
    // The fallback in every `var()` is what makes the panel-open case correct
    // without a second selector.
    const uses = support.match(/var\(--sp-support-lift[^)]*\)/g) ?? []
    assert.ok(uses.length >= 3, 'expected the lift on the button, the panel and narrow screens')
    for (const use of uses) assert.match(use, /, 0px\)$/, use)
  })

  it('clears the launcher rather than overlapping it', () => {
    // Launcher: a ~37px pill at `inset-block-end: var(--sp-4)` → its top edge is
    // at ~53px. Support's base is 20px, so the lift has to exceed 33px for the
    // two to not touch at all.
    const lift = Number(/--sp-support-lift: (\d+)px/.exec(support)?.[1])
    assert.ok(lift > 33, `lift ${lift}px overlaps the launcher`)
    assert.ok(lift < 90, `lift ${lift}px leaves a hole between the two`)
  })

  it('animates the move, and the global reduced-motion rule can stop it', () => {
    // `--sp-dur-fast` is zeroed under `prefers-reduced-motion` in tokens.css,
    // so using the token is what makes this respect the setting.
    assert.match(block(support, '.sp-support-launch'),
      /transition: inset-block-end var\(--sp-dur-fast\)/)
  })
})

describe('narrow screens', () => {
  it('do not nudge one button off the shared edge', () => {
    // The old mobile branch pulled support to 12px while the launcher stayed at
    // 16px — invisible until the two were stacked, then plainly wrong.
    const narrow = support.slice(support.indexOf('@media (max-width: 640px)'))
    assert.doesNotMatch(narrow, /right: 12px/)
    assert.doesNotMatch(narrow, /left: 12px/)
  })

  it('still lift the panel by the same amount', () => {
    const narrow = support.slice(support.indexOf('@media (max-width: 640px)'))
    assert.match(narrow, /inset-block-end: calc\(68px \+ var\(--sp-support-lift, 0px\)\)/)
  })
})
