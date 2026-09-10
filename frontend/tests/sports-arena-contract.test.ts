import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { SPORTS_ARENA_STARTER_PROP_IDS, SPORTS_PAID_PROP_IDS, sportsPropLocked } from '../src/features/Yuvi-studio/SportsArenaCatalog.ts'
import { cloneRoom, DEFAULT_ROOM, moveOrRestoreRoomItem } from '../src/features/Yuvi-studio/RoomDesign.ts'

test('sports furniture fails closed without a shop response and permits permanent repeated placement', () => {
  for (const kind of SPORTS_PAID_PROP_IDS) {
    if (SPORTS_ARENA_STARTER_PROP_IDS.has(kind)) continue
    assert.equal(sportsPropLocked(kind, new Set()), true)
    assert.equal(sportsPropLocked(kind, new Set(['layout:sportsArena'])), true)
    assert.equal(sportsPropLocked(kind, new Set([kind])), false)
  }
  for (const kind of SPORTS_ARENA_STARTER_PROP_IDS) {
    assert.equal(sportsPropLocked(kind, new Set()), true)
    assert.equal(sportsPropLocked(kind, new Set(['layout:sportsArena'])), false)
  }
})

test('all sports types have Hebrew, Arabic and English labels and authoritative backend entries', () => {
  const server = readFileSync(new URL('../../backend/app/services/rewards/catalog.py', import.meta.url), 'utf8')
  for (const language of ['he', 'ar', 'en']) {
    const messages = JSON.parse(readFileSync(new URL(`../../locales/${language}.json`, import.meta.url), 'utf8'))
    for (const kind of [...SPORTS_ARENA_STARTER_PROP_IDS, ...SPORTS_PAID_PROP_IDS]) {
      assert.ok(messages[`YuviStudio.room.item.${kind}`], `${language}:${kind}`)
      assert.ok(server.includes(`"${kind}"`), `server:${kind}`)
    }
    assert.ok(messages['YuviStudio.room.storage'])
    assert.ok(messages['YuviStudio.unlock.sportsArena'])
  }
})

test('restoring a stored item preserves identity, tint and rotation and cannot duplicate it', () => {
  const room = cloneRoom(DEFAULT_ROOM)
  const item = { uid: 'stored-jersey', kind: 'sportsJerseyDisplay', x: 0, z: 0, rot: 0.7, tint: '#e4564f' }
  room.storedItems = [item]
  const patch = { x: 24.34, z: 4, wallAnchor: { wallId: 'east', offset: 0.5, height: 3 } }
  const restored = moveOrRestoreRoomItem(room, item.uid, patch)
  assert.deepEqual(restored.items, [{ ...item, ...patch }])
  assert.deepEqual(restored.storedItems, [])
  assert.equal(moveOrRestoreRoomItem(restored, item.uid, { x: 24.34, z: 8 }).items.length, 1)
  room.items = Array.from({ length: 60 }, (_, index) => ({ ...item, uid: `placed-${index}` }))
  assert.equal(moveOrRestoreRoomItem(room, item.uid, patch), room)
})