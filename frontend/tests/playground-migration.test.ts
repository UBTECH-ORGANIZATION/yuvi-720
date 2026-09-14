import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ROOM_ITEMS, normalizeRoom, syncActiveWorld, switchRoomWorld } from '../src/features/Yuvi-studio/RoomDesign.ts'
import { PLAYGROUND_EDITABLE_DEFAULTS, PLAYGROUND_EQUIPMENT } from '../src/features/Yuvi-studio/PlaygroundItems.ts'

const options = { sportsArenaOwned: false, boundsFor: () => ({ radius: 1, height: 1, wall: false }) }
test('retired coaster is removed from placed, stored and inactive world items without changing other props', () => {
  const coaster = { uid: 'park-coaster', kind: 'parkCoaster', x: 17, z: 0, rot: 0 }
  const bench = { uid: 'keep', kind: 'parkBench', x: 0, z: 5, rot: 0 }
  const room = normalizeRoom({ version: 9, activeLayoutId: 'lab', items: [coaster, bench], storedItems: [{ ...coaster, uid: 'stored-coaster' }],
    worlds: { adventurePark: { items: [coaster, bench], storedItems: [coaster], playgroundVersion: 1 } },
  }, { sportsArenaOwned: false })
  assert.deepEqual(room.items.map((item) => item.uid), ['keep'])
  assert.deepEqual(room.storedItems, [])
  assert.deepEqual(room.worlds.adventurePark.items.map((item) => item.uid), ['keep'])
  assert.deepEqual(room.worlds.adventurePark.storedItems, [])
  const reloaded = normalizeRoom(JSON.parse(JSON.stringify(syncActiveWorld(room))), { sportsArenaOwned: false })
  assert.deepEqual(reloaded.items, room.items)
  assert.ok(Object.values(reloaded.worlds).every((world) => [...world.items, ...world.storedItems].every((item) => item.kind !== 'parkCoaster')))
})
test('optional rides survive saving, storage and world switching but are not defaults', () => {
  const kinds = ['parkSwings', 'parkBasketSwing', 'parkCarousel']
  const defaults = switchRoomWorld(normalizeRoom(null, options), 'adventurePark')
  assert.ok(defaults.items.every((item) => ![...kinds, 'parkCoaster'].includes(item.kind)))
  const items = kinds.map((kind, index) => ({ uid: `ride-${index}`, kind, x: -6 + index * 9, z: 23, rot: 0.5, tint: '#258b82' }))
  const room = normalizeRoom({ version: 9, activeLayoutId: 'adventurePark', items,
    storedItems: [{ ...items[2], uid: 'stored-carousel' }], worlds: { adventurePark: { playgroundVersion: 2 } },
  }, options)
  const reloaded = normalizeRoom(JSON.parse(JSON.stringify(syncActiveWorld(room))), options)
  const returned = switchRoomWorld(switchRoomWorld(reloaded, 'lab'), 'adventurePark')
  assert.deepEqual(returned.items, items)
  assert.deepEqual(returned.storedItems, [{ ...items[2], uid: 'stored-carousel' }])
})

test('editable equipment migration preserves furniture identities, rotation and storage', () => {
  const items = [{ uid: 'obstructed', kind: 'parkBench', x: -15, z: -13, rot: 0.7, tint: '#ffffff' }, { uid: 'legal', kind: 'parkBench', x: 0, z: 5, rot: 0 }]
  const storedItems = Array.from({ length: 100 }, (_, index) => ({ uid: `stored-${index}`, kind: 'parkBench', x: 0, z: 0, rot: 0 }))
  const migrated = normalizeRoom({ version: 9, activeLayoutId: 'adventurePark', items, storedItems }, options)
  assert.equal(migrated.worlds.adventurePark.playgroundVersion, 2)
  assert.equal(migrated.storedItems.length, 100)
  assert.equal(migrated.items.find((item) => item.uid === 'legal')?.z, 5)
  assert.equal(migrated.items.find((item) => item.uid === 'obstructed')?.x, -15)
  assert.equal(migrated.items.find((item) => item.uid === 'obstructed')?.rot, 0.7)
  assert.equal(migrated.items.filter((item) => item.uid.startsWith('park-editable-')).length, 7)
  assert.equal(migrated.items.find((item) => item.uid === 'obstructed')?.tint, '#ffffff')
  const saved = JSON.parse(JSON.stringify(syncActiveWorld(migrated)))
  const reloaded = normalizeRoom(saved, options)
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded)), saved)
  const returned = switchRoomWorld(switchRoomWorld(reloaded, 'lab'), 'adventurePark')
  assert.equal(returned.worlds.adventurePark.playgroundVersion, 2)
  assert.equal(returned.storedItems.length, 100)
})

test('inactive playground migrates without moving current world stations', () => {
  const baseline = normalizeRoom({ version: 9, activeLayoutId: 'lab', items: [] }, { sportsArenaOwned: false })
  const migrated = normalizeRoom(baseline, options)
  assert.deepEqual(migrated.stations, baseline.stations)
  assert.deepEqual(migrated.items, baseline.items)
})

test('rotated equipment and deleted defaults survive reload and world switching', () => {
  const room = normalizeRoom({ version: 9, activeLayoutId: 'adventurePark', items: [], worlds: { adventurePark: { playgroundVersion: 1 } } }, options)
  room.items = room.items.filter((item) => item.kind !== 'parkSpringRider').map((item) => ({ ...item, rot: Math.PI * 0.75 }))
  const saved = JSON.parse(JSON.stringify(syncActiveWorld(room)))
  const reloaded = normalizeRoom(saved, options)
  const returned = switchRoomWorld(switchRoomWorld(reloaded, 'lab'), 'adventurePark')
  assert.deepEqual(JSON.parse(JSON.stringify(returned.items)), saved.items)
  assert.ok(returned.items.every((item) => item.kind !== 'parkSpringRider' && item.rot === Math.PI * 0.75))
})

test('full rooms retain new equipment in storage without losing saved props', () => {
  const items = Array.from({ length: MAX_ROOM_ITEMS }, (_, index) => ({ uid: `existing-${index}`, kind: 'parkBench', x: -16 + index % 10 * 3.5, z: -12 + Math.floor(index / 10) * 3.5, rot: 0.25 }))
  const room = normalizeRoom({ version: 9, activeLayoutId: 'adventurePark', items, worlds: { adventurePark: { playgroundVersion: 1 } } }, options)
  assert.equal(room.items.length, MAX_ROOM_ITEMS)
  for (const item of PLAYGROUND_EDITABLE_DEFAULTS) assert.ok(room.storedItems.some((stored) => stored.uid === item.uid))
  assert.equal(new Set([...room.items, ...room.storedItems].map((item) => item.uid)).size, MAX_ROOM_ITEMS + PLAYGROUND_EDITABLE_DEFAULTS.length)
})

test('new playground defaults fit with their real catalog footprints', () => {
  const room = normalizeRoom({ version: 9, activeLayoutId: 'adventurePark', items: [] }, {
    sportsArenaOwned: false,
    boundsFor: (item) => ({ radius: (PLAYGROUND_EQUIPMENT[item.kind]?.radius ?? 1) * 1.75, height: 1, wall: false }),
  })
  assert.equal(room.items.length, PLAYGROUND_EDITABLE_DEFAULTS.length)
  assert.deepEqual(room.storedItems, [])
})