/* Where a provider's activity is painted — framed, or in a tab of its own.
 *
 *   node --test frontend/tests/
 *
 * The failure being guarded against is a player that cannot hold a session in a
 * cross-site frame: it bounces through its own logout/timeout redirect and
 * reloads several times a second, forever. Verified against CET's player on
 * 2026-08-02 (~6 document loads per 15s). The static methodica lomdot load once
 * and must keep behaving exactly as they always have — that is what most of
 * these cases are about.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  RELOAD_STORM_COUNT,
  isReloadStorm,
  noteLoad,
  playbackMode,
  recentLoads,
} from '../src/features/learning/embedGuard.ts'

const NOW = 1_754_000_000_000

describe('spotting a frame that is reloading itself', () => {
  it('leaves ordinary content alone — one load is one load', () => {
    assert.equal(isReloadStorm([NOW], NOW), false)
  })

  it('tolerates content that paginates by navigating its own frame', () => {
    // Three deliberate screen changes in fifteen seconds is a fast reader, not
    // a loop. Calling that broken would exile working content to a tab.
    const clicks = [NOW - 9000, NOW - 5000, NOW]
    assert.equal(isReloadStorm(clicks, NOW), false)
  })

  it('calls it a loop at the fourth load inside the window', () => {
    const loop = [NOW - 7500, NOW - 5000, NOW - 2500, NOW]
    assert.equal(loop.length, RELOAD_STORM_COUNT)
    assert.equal(isReloadStorm(loop, NOW), true)
  })

  it('matches what CET actually did: ~6 loads in 15s', () => {
    const observed = [0, 2500, 4900, 7400, 10_000, 12_600].map((offset) => NOW - 12_600 + offset)
    assert.equal(isReloadStorm(observed, NOW), true)
  })

  it('forgets loads older than the window, so a long lesson never trips', () => {
    // Four loads, but spread across half an hour of honest navigation.
    const spread = [NOW - 1_800_000, NOW - 900_000, NOW - 60_000, NOW]
    assert.equal(recentLoads(spread, NOW).length, 1)
    assert.equal(isReloadStorm(spread, NOW), false)
  })

  it('accumulates load by load, and reports the moment it tips', () => {
    let loads: number[] = []
    let storm = false
    for (let i = 0; i < 4; i += 1) {
      ({ loads, storm } = noteLoad(loads, NOW + i * 1000))
    }
    assert.equal(storm, true)
    assert.equal(loads.length, 4)
  })
})

describe('where the activity is opened', () => {
  it('frames content by default — the payload need not say anything', () => {
    assert.equal(playbackMode(undefined, false, false), 'frame')
  })

  it('frames content the server explicitly cleared', () => {
    assert.equal(playbackMode(true, false, false), 'frame')
  })

  it('hands a known-unframable player straight to a tab, with no flash of loop', () => {
    assert.equal(playbackMode(false, false, false), 'tab')
  })

  it('hands a player caught looping to a tab, even when nobody configured it', () => {
    assert.equal(playbackMode(true, true, false), 'tab')
  })

  it('lets the learner overrule OUR detection', () => {
    assert.equal(playbackMode(true, true, true), 'frame')
  })

  it('does not let them overrule the server — there the frame cannot work at all', () => {
    assert.equal(playbackMode(false, true, true), 'tab')
  })
})
