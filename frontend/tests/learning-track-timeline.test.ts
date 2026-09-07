/* The lessons of one goal are drawn as a timeline.
 *
 *   node --test frontend/tests/
 *
 * One spine, one stop per lesson. The state lives on the node beside the
 * card, the rail below a finished stop is solid, the rest is dashed, and the
 * horizon — where the route is still the server's to decide — is the last
 * stop rather than a footnote.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const view = read('../src/features/learning-portal/SimpleTrackView.tsx')
const css = read('../src/features/learning-portal/simple-track.css')

describe('the goal screen is a timeline', () => {
  it('puts the state on a node beside the card, not inside the button', () => {
    const stop = view.split('<li className={`lt-stop is-${state}`}')[1].split('</li>')[0]
    assert.ok(stop.indexOf('lt-stop__node') < stop.indexOf('<button'), 'node comes before the card')
    assert.equal(/lt-lesson__index/.test(view), false)
  })

  it('draws the rail solid as far as the learner has come and dashed beyond', () => {
    assert.match(css, /\.lt-stop::before \{[^}]*repeating-linear-gradient/)
    assert.match(css, /\.lt-stop\.is-completed::before \{ background: var\(--sp-success-600\); \}/)
    assert.match(css, /\.lt-stop:first-child::before \{ inset-block-start: 50%; \}/)
    assert.match(css, /\.lt-stop:last-child::before \{ inset-block-end: 50%; \}/)
  })

  it('makes the horizon the last stop', () => {
    assert.match(view, /<li className="lt-stop lt-stop--horizon">/)
    assert.match(view, /<p className="lt-horizon">\{t\('learning\.track\.horizon'\)\}<\/p>/)
  })

  it('keeps the beacon still for people who asked for less motion', () => {
    const reduced = css.split('@media (prefers-reduced-motion: reduce)')[1].split('}\n}')[0]
    assert.match(reduced, /\.lt-stop\.is-current \.lt-stop__node::after \{ animation: none; \}/)
  })
})
