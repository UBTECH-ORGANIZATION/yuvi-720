/* The raise-hand gate, pinned at the source.
 *
 *   node --test frontend/tests/
 *
 * Three things a green backend cannot see:
 *
 *   1. The locked button must stay in the tab order with its tooltip — so it is
 *      `aria-disabled`, never native `disabled` (#517). A `disabled={` creeping
 *      back would silently drop the "why" a child needs.
 *   2. The activation and raised cues animate transform/opacity only — the old
 *      `spHandGlow` pulsed box-shadow, which repaints the whole row on cheap
 *      school laptops (`.claude/skills/fluid-motion/SKILL.md`).
 *   3. The three locale files carry the new copy, gender-free in Hebrew.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const chat = read('../src/components/CompanionChat.tsx')
const css = read('../src/components/companion.css')
const provider = read('../src/providers/CompanionProvider.tsx')

const handButton = (() => {
  const start = chat.indexOf('data-tour="learner.lessonHand"')
  assert.ok(start > 0, 'the hand button is tagged for the tour')
  const open = chat.lastIndexOf('<button', start)
  const close = chat.indexOf('>', chat.indexOf('data-tooltip', start))
  return chat.slice(open, close + 1)
})()

describe('the hand button is gated, not disabled', () => {
  it('uses aria-disabled and never native disabled', () => {
    assert.match(handButton, /aria-disabled=\{handBlocked \|\| undefined\}/)
    assert.doesNotMatch(handButton, /\sdisabled=\{/)
  })
  it('carries the locked, blocked, raised and unlocking states', () => {
    for (const cls of ['is-locked', 'is-blocked', 'is-raised', 'is-unlocking', 'is-armed']) {
      assert.ok(handButton.includes(cls), `button renders ${cls}`)
    }
  })
  it('locks in a lesson until the provider says the hand is open', () => {
    assert.match(chat, /const handLocked = isTaskMode && !handRaised && !handUnlock/)
    assert.match(chat, /const handBlocked = .*\|\| handLocked/)
  })
  it('re-locks on a 409 from the handoff route', () => {
    assert.match(chat, /status === 409\)\s*\{\s*relockHand\(\)/)
  })
  it('clears the unlock when the question changes, keeping the same question', () => {
    assert.match(provider, /unlock\.questionKey === currentQuestionKey\) return unlock/)
  })
})

describe('the hand motion obeys the transform/opacity rule', () => {
  const keyframes = [...css.matchAll(/@keyframes (sp-companion-hand-[\w-]+)\s*\{([\s\S]*?)\n\}/g)]
  it('has no leftover spHandGlow', () => {
    assert.doesNotMatch(css, /spHandGlow/)
    assert.doesNotMatch(chat, /spHandGlow/)
  })
  it('names its keyframes sp-companion-hand-*', () => {
    assert.deepEqual(
      keyframes.map((m) => m[1]).sort(),
      ['sp-companion-hand-pop', 'sp-companion-hand-pulse', 'sp-companion-hand-ring'],
    )
  })
  it('animates only transform and opacity', () => {
    for (const [, name, body] of keyframes) {
      assert.doesNotMatch(body, /box-shadow|filter|background|border|width|height/, name)
      assert.match(body, /transform|opacity/, name)
    }
  })
  it('keeps the colour transition under reduced motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .sp-companion__handBtn'))
    assert.match(reduced, /animation: none/)
    assert.doesNotMatch(reduced.slice(0, reduced.indexOf('\n}\n')), /transition: none/)
  })
})

describe('the hand copy exists in every locale', () => {
  const locales = {
    he: JSON.parse(read('../../locales/he.json')) as Record<string, string>,
    en: JSON.parse(read('../../locales/en.json')) as Record<string, string>,
    ar: JSON.parse(read('../../locales/ar.json')) as Record<string, string>,
  }
  const keys = ['companion.hand.lockedTooltip', 'companion.hand.unlocked', 'companion.hand.locked']
  it('has the three keys in he/en/ar', () => {
    for (const [lang, bundle] of Object.entries(locales)) {
      for (const key of keys) assert.ok(bundle[key], `${lang} ${key}`)
    }
  })
  it('keeps the Hebrew free of bare apostrophes', () => {
    for (const key of keys) assert.doesNotMatch(locales.he[key], /'/, key)
  })
})
