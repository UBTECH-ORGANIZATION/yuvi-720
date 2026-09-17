/* The viewing clock behind `dashboard/viewed` durations.
 *
 *   node --test frontend/tests/
 *
 * Only visible time counts: a board left open in a background tab for an hour
 * was not looked at for an hour.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { elapsedSeconds, startClock, visibilityChanged } from '../src/hooks/viewedClock.ts'

describe('viewed clock', () => {
  it('counts a plain visible stretch', () => {
    const clock = startClock(0, true)
    assert.equal(elapsedSeconds(clock, 12_400), 12)
  })

  it('pauses while hidden and resumes on return', () => {
    let clock = startClock(0, true)
    clock = visibilityChanged(clock, 5_000, false)   // tab switched away
    clock = visibilityChanged(clock, 65_000, true)   // back a minute later
    assert.equal(elapsedSeconds(clock, 70_000), 10)
  })

  it('a mount while hidden starts counting only once visible', () => {
    let clock = startClock(0, false)
    assert.equal(elapsedSeconds(clock, 30_000), 0)
    clock = visibilityChanged(clock, 30_000, true)
    assert.equal(elapsedSeconds(clock, 33_000), 3)
  })

  it('repeated events do not double count', () => {
    let clock = startClock(0, true)
    clock = visibilityChanged(clock, 1_000, true)
    clock = visibilityChanged(clock, 4_000, false)
    clock = visibilityChanged(clock, 5_000, false)
    assert.equal(elapsedSeconds(clock, 9_000), 4)
  })

  it('caps at the server window', () => {
    const clock = startClock(0, true)
    assert.equal(elapsedSeconds(clock, 100 * 3_600 * 1_000), 28_800)
  })
})
