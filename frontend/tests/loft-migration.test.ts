import assert from 'node:assert/strict'
import test from 'node:test'
import { CREATOR_LOFT_NEW_MACHINES, DEFAULT_ROOM, normalizeRoom } from '../src/features/Yuvi-studio/RoomDesign.ts'

test('new machines are stored without moving a customized version-six loft', () => {
  const item = { uid: 'my-claw', kind: 'loftClawMachine', x: 6, z: 8, rot: 1.5 }
  const world = { floor: 'wood', wall: 'warm', mood: 'night', items: [item], storedItems: [] }
  const room = normalizeRoom({ version: 6, activeLayoutId: 'creatorLoft', ...world, worlds: { creatorLoft: world } })
  assert.equal(room.version, DEFAULT_ROOM.version)
  assert.equal(room.items.length, 1)
  assert.deepEqual({ x: room.items[0].x, z: room.items[0].z, rot: room.items[0].rot }, { x: 6, z: 8, rot: 1.5 })
  assert.deepEqual(room.storedItems.map((entry) => entry.kind), CREATOR_LOFT_NEW_MACHINES.map((entry) => entry.kind))
  assert.equal(room.floor, 'wood')
  assert.equal(room.wall, 'warm')
  assert.equal(room.mood, 'night')
  assert.equal(normalizeRoom(room).storedItems.length, 3)
  room.storedItems = []
  room.worlds.creatorLoft.storedItems = []
  assert.equal(normalizeRoom(room).storedItems.length, 0)
})