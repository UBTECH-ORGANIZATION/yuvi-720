import test from 'node:test'
import assert from 'node:assert/strict'
import { trafficPhase, canActivatePlayground } from '../src/features/Yuvi-studio/PlaygroundInteractions.ts'

test('crossing sequence includes clearance both before and after pedestrian green', () => {
  assert.deepEqual([-1, 0, 3, 5, 10, 11, 13].map(trafficPhase), ['vehicles', 'amber', 'clearance', 'pedestrians', 'pedestrians', 'clearance', 'vehicles'])
})

test('equipment actions never consume placement or camera gestures', () => {
  const tap = { placing: false, locked: false, consumed: false, distance: 2, slop: 6, duration: 120 }
  assert.equal(canActivatePlayground(tap), true)
  for (const patch of [{ placing: true }, { locked: true }, { consumed: true }, { distance: 12 }, { duration: 600 }]) {
    assert.equal(canActivatePlayground({ ...tap, ...patch }), false)
  }
})