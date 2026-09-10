import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeRoom, syncActiveWorld, switchRoomWorld, SPORTS_ARENA_STARTER_ITEMS } from '../src/features/Yuvi-studio/RoomDesign.ts'

const custom = { uid: 'custom-bench', kind: 'sportsBench', x: -13.5, z: 18.5, rot: 1.7, tint: '#cc8866' }
const rawRoom = () => {
  const world = { floor: 'wood', wall: 'warm', mood: 'night', items: [custom], storedItems: [] }
  return { version: 8, activeLayoutId: 'sportsArena', ...world, worlds: { sportsArena: world } }
}

test('initialized arenas relocate only the sign and two paintings once', () => {
  const room = normalizeRoom(rawRoom())
  room.worlds.sportsArena.sportsStarterVersion = 1
  const sign = room.items.find((item) => item.uid === 'arena-wall-scoreboard')!
  sign.wallAnchor = { wallId: 'north', offset: 0.5, height: 7.5 }
  sign.z = -25.74
  sign.tint = '#123456'
  for (const item of room.items.filter((item) => item.wallAnchor?.wallId === 'south')) {
    item.wallAnchor = { wallId: item.kind === 'sportsArtworkOlympic' ? 'west' : 'east', offset: 0.75, height: 2.8 }
  }
  const migrated = normalizeRoom(syncActiveWorld(room))
  assert.equal(migrated.items.length, room.items.length)
  assert.deepEqual(migrated.items.find((item) => item.uid === custom.uid), custom)
  const restoredSign = migrated.items.find((item) => item.uid === sign.uid)!
  assert.equal(restoredSign.wallAnchor?.wallId, 'south')
  assert.equal(restoredSign.tint, '#123456')
  restoredSign.wallAnchor!.offset = 0.55
  assert.equal(normalizeRoom(syncActiveWorld(migrated)).items.find((item) => item.uid === sign.uid)?.wallAnchor?.offset, 0.55)
})

test('migration preserves customization, places missing starters once and never grants paid upgrades', () => {
  const room = normalizeRoom(rawRoom())
  assert.deepEqual(room.items[0], custom)
  assert.equal(room.floor, 'wood')
  assert.equal(room.wall, 'warm')
  assert.equal(room.mood, 'night')
  const all = [...room.items, ...room.storedItems]
  for (const starter of SPORTS_ARENA_STARTER_ITEMS) assert.equal(all.filter((item) => item.uid === starter.uid).length, 1)
  assert.ok(room.items.length > 12)
  assert.ok(!all.some((item) => /CableMachine|LegPress|RacketCorner|JerseyDisplayAlt/.test(item.kind)))
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeRoom(syncActiveWorld(room)))), JSON.parse(JSON.stringify(syncActiveWorld(room))))
  const switched = switchRoomWorld(switchRoomWorld(room, 'lab'), 'sportsArena')
  assert.deepEqual(switched.items, room.items)
})

test('full rooms store only new items and do not duplicate already stored starters', () => {
  const raw = rawRoom()
  raw.items = Array.from({ length: 60 }, (_, index) => ({ ...custom, uid: `existing-${index}` }))
  const room = normalizeRoom(raw)
  assert.deepEqual(room.items, raw.items)
  assert.equal(room.storedItems.length, SPORTS_ARENA_STARTER_ITEMS.length)
  assert.equal(normalizeRoom(syncActiveWorld(room)).storedItems.length, room.storedItems.length)
})

test('deleted starters do not reappear after initialization; locked rooms defer initialization', () => {
  const locked = normalizeRoom(rawRoom(), { sportsArenaOwned: false })
  assert.equal(locked.items.length, 1)
  assert.equal(locked.worlds.sportsArena.sportsStarterVersion, undefined)
  const owned = normalizeRoom(syncActiveWorld(locked), { sportsArenaOwned: true })
  assert.equal(owned.worlds.sportsArena.sportsStarterVersion, 2)
  owned.items = [custom]
  owned.storedItems = []
  assert.deepEqual(normalizeRoom(syncActiveWorld(owned)).items, [custom])
})

test('artworks flank the south-wall sign, leave three per side and keep saved anchors through reload', () => {
  const room = normalizeRoom(rawRoom())
  const art = room.items.filter((item) => item.kind.startsWith('sportsArtwork'))
  assert.equal(art.length, 6)
  assert.equal(art.filter((item) => item.wallAnchor?.wallId === 'west').length, 2)
  assert.equal(art.filter((item) => item.wallAnchor?.wallId === 'east').length, 2)
  assert.deepEqual(art.filter((item) => item.wallAnchor?.wallId === 'south').map((item) => item.wallAnchor?.offset), [0.7, 0.3])
  assert.equal(room.items.find((item) => item.uid === 'arena-wall-scoreboard')?.wallAnchor?.wallId, 'south')
  art[0].wallAnchor!.height = 3.1
  art[0].wallAnchor!.offset = 0.77
  const restored = normalizeRoom(syncActiveWorld(room))
  assert.deepEqual(restored.items.find((item) => item.uid === art[0].uid)?.wallAnchor, art[0].wallAnchor)
})

test('full storage retains existing furniture and overflow starters through reload', () => {
  const raw = rawRoom()
  raw.items = Array.from({ length: 60 }, (_, index) => ({ ...custom, uid: `placed-${index}` }))
  const storedItems = Array.from({ length: 60 }, (_, index) => ({ ...custom, uid: `stored-${index}` }))
  const room = normalizeRoom({ ...raw, storedItems })
  assert.equal(room.storedItems.length, 60 + SPORTS_ARENA_STARTER_ITEMS.length)
  const restored = normalizeRoom(syncActiveWorld(room))
  assert.deepEqual(restored.items, room.items)
  assert.deepEqual(JSON.parse(JSON.stringify(restored.storedItems)), JSON.parse(JSON.stringify(room.storedItems)))
})