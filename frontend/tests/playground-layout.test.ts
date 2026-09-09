import test from 'node:test'
import assert from 'node:assert/strict'
import { PLAYGROUND_BOUNDS, PLAYGROUND_ZONES, PLAYGROUND_WALK_BLOCKERS, PLAYGROUND_GIFT_POSITION, playgroundGiftPosition } from '../src/features/Yuvi-studio/PlaygroundLayout.ts'
import { PLAYGROUND_EQUIPMENT, PLAYGROUND_EDITABLE_DEFAULTS } from '../src/features/Yuvi-studio/PlaygroundItems.ts'

test('every playground zone fits the unchanged room footprint', () => {
  for (const zone of PLAYGROUND_ZONES) {
    assert.ok(zone.x - zone.width / 2 >= PLAYGROUND_BOUNDS.left, zone.id)
    assert.ok(zone.x + zone.width / 2 <= PLAYGROUND_BOUNDS.right, zone.id)
    assert.ok(zone.z - zone.depth / 2 >= PLAYGROUND_BOUNDS.back, zone.id)
    assert.ok(zone.z + zone.depth / 2 <= PLAYGROUND_BOUNDS.front, zone.id)
  }
})

test('playground preserves the spawn and central approach', () => {
  for (let z = -18; z <= 14; z += 0.5) {
    assert.ok(PLAYGROUND_WALK_BLOCKERS.every((blocker) => Math.hypot(blocker.x, blocker.z - z) > blocker.radius + 0.7), `central route at ${z}`)
  }
})

test('zones have unique identities and nonoverlapping equipment envelopes', () => {
  assert.equal(new Set(PLAYGROUND_ZONES.map((zone) => zone.id)).size, PLAYGROUND_ZONES.length)
  for (const [index, zone] of PLAYGROUND_ZONES.entries()) {
    for (const other of PLAYGROUND_ZONES.slice(index + 1)) {
      assert.ok(Math.abs(zone.x - other.x) >= (zone.width + other.width) / 2
        || Math.abs(zone.z - other.z) >= (zone.depth + other.depth) / 2, `${zone.id}/${other.id}`)
    }
  }
})

test('removed fixed rides leave no reserved zones or walk blockers', () => {
  assert.ok(PLAYGROUND_ZONES.every((zone) => !['swings', 'train', 'roundabout', 'towers', 'zipline', 'ropes', 'sand'].includes(zone.id)))
  for (const [x, z] of [[-15.5, 8.7], [-2, 20], [9, 24.5]]) {
    assert.ok(PLAYGROUND_WALK_BLOCKERS.every((blocker) => Math.hypot(blocker.x - x, blocker.z - z) > blocker.radius))
  }
})

test('gift is clear of default equipment and moves when the preferred spot is occupied', () => {
  const obstacles = PLAYGROUND_EDITABLE_DEFAULTS.map((item) => ({ ...item, radius: PLAYGROUND_EQUIPMENT[item.kind].radius * 1.75 }))
  assert.deepEqual(playgroundGiftPosition(obstacles), PLAYGROUND_GIFT_POSITION)
  obstacles.push({ ...PLAYGROUND_GIFT_POSITION, uid: 'obstacle', kind: 'parkTree', radius: 4 })
  const relocated = playgroundGiftPosition(obstacles)
  assert.notDeepEqual(relocated, PLAYGROUND_GIFT_POSITION)
  assert.ok(obstacles.every((obstacle) => Math.hypot(relocated.x - obstacle.x, relocated.z - obstacle.z) >= obstacle.radius + 1.2))
})