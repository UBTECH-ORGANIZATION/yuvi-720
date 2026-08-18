/* Three rules in the teacher portal's chrome that fail quietly.
 *
 *   node --test frontend/tests/
 *
 * `scripts/teacher-chrome-check.mjs` proves these in a real layout. These
 * pin the declarations themselves, because each one is a single token that
 * a tidy-looking edit removes without any visible cause and effect.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const dock = read('../src/features/teacher-app/assistant/assistant-dock.css')
const shared = read('../src/features/teacher-app/shared/teacher-shared.css')
const avatar = read('../src/features/teacher-app/shared/StudentAvatar.tsx')
const app = read('../src/app/App.tsx')

/** The declaration block of a rule, by exact selector. */
function block(css: string, selector: string) {
  const at = css.indexOf(`\n${selector} {`)
  assert.notEqual(at, -1, `no rule for ${selector}`)
  return css.slice(at, css.indexOf('}', at))
}

describe('the assistant dock holds its width', () => {

  it('gives its conversation a column that cannot be stretched', () => {
    /* An implicit `auto` column is sized to its widest item's max-content, so
       one table answer widened the column, every row stretched to match, and
       the whole conversation scrolled sideways with the timestamps off the
       edge. The 0 minimum is the entire fix. */
    assert.match(block(dock, '.tch-dock__body'),
                 /grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  })

  it('keeps a wide table scrolling inside its own box', () => {
    // Which is only reachable if the column above refuses to grow for it.
    assert.match(block(dock, '.tch-dock__bubble .sp-md-tablewrap'), /overflow-x:\s*auto/)
  })
})

describe('a face that is not known yet', () => {

  it('renders as a placeholder rather than a letter cut from the id', () => {
    assert.match(avatar, /if \(!active && isLoading\)/)
    assert.match(avatar, /tch-avatar--pending/)
  })

  it('keeps its sweep on a dimmed card', () => {
    /* `.tch-studentCard.is-idle .tch-avatar:not(...)` carries four classes and
       out-specifies the one-class placeholder, which flattened it to a
       near-white disc with no animation — the avatar looked missing, and only
       on the cards that happened to be idle. */
    const idle = shared.match(/\.tch-studentCard\.is-idle \.tch-avatar[^{]*/)?.[0] ?? ''
    assert.match(idle, /:not\(\.tch-avatar--pending\)/,
                 `the idle rule out-specifies the placeholder again: ${idle.trim()}`)
    assert.match(block(shared, '.tch-avatar--pending'), /animation:\s*sp-skeleton-sweep/)
  })
})

describe('the teacher portal floats nothing over the page', () => {

  it('no longer mounts the support chat', () => {
    // It shared the bottom-left corner with the assistant's launcher, two
    // floating buttons stacked on each other over the teacher's own screen.
    assert.doesNotMatch(app, /SupportChatPanel/)
  })

  it('still lets a teacher report a fault', () => {
    // Removing the floating chat must not remove the way out of a problem.
    assert.match(app, /<ReportIssueDialog \/>/)
  })
})
