/* Reset puts the room back — and leaves the learner alone.
 *
 * "Reset" replaced the whole room record with `DEFAULT_ROOM`, and `tutorialDone`
 * lives in that record. So a reset un-finished the walkthrough, `sameRoom` saw a
 * change, and the next Save persisted `tutorialDone: false` — handing the child
 * the same three-step walkthrough again on their next visit, every single time
 * they pressed Reset. Nothing showed it in the moment: the walkthrough is armed
 * once per mount, so the damage only surfaced a session later.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ROOM, DEFAULT_STATIONS, cloneRoom, resetRoom, sameRoom,
  type RoomDesign,
} from '../src/features/Yuvi-studio/RoomDesign.ts'

/** A room a learner has actually lived in. */
function decorated(overrides: Partial<RoomDesign> = {}): RoomDesign {
  return {
    ...cloneRoom(DEFAULT_ROOM),
    floor: 'meadow',
    wall: 'space',
    mood: 'night',
    items: [
      { uid: 'it1', kind: 'couch', x: 2, z: -3, rot: 0.5, tint: '#ff5d73' },
      { uid: 'it2', kind: 'plant', x: -4, z: 1, rot: 0 },
    ],
    stations: { avatar: { x: 5, z: -2, rot: 1.1 }, room: { x: -8, z: -8, rot: 0.78 } },
    tutorialDone: true,
    ...overrides,
  }
}

test('a finished walkthrough stays finished', () => {
  // The bug, in one assertion.
  assert.equal(resetRoom(decorated()).tutorialDone, true)
})

test('a reset is not a way to finish the walkthrough either', () => {
  assert.equal(resetRoom(decorated({ tutorialDone: false })).tutorialDone, false)
})

test('everything the learner decorated goes back', () => {
  const fresh = resetRoom(decorated())
  assert.deepEqual(fresh.items, [])
  assert.equal(fresh.floor, DEFAULT_ROOM.floor)
  assert.equal(fresh.wall, DEFAULT_ROOM.wall)
  assert.equal(fresh.mood, DEFAULT_ROOM.mood)
  assert.deepEqual(fresh.stations, DEFAULT_STATIONS)
})

test('resetting an untouched room is not a change to save', () => {
  // Otherwise Reset would arm the unsaved-work guard over nothing, and the exit
  // dialog would interrogate a learner who changed nothing.
  const untouched = { ...cloneRoom(DEFAULT_ROOM), tutorialDone: true }
  assert.ok(sameRoom(resetRoom(untouched), untouched))
})

test('the reset room is a copy, not a view of the shared default', () => {
  const fresh = resetRoom(decorated())
  fresh.stations.avatar.x = 99
  fresh.items.push({ uid: 'x', kind: 'rug', x: 0, z: 0, rot: 0 })
  assert.equal(DEFAULT_ROOM.stations.avatar.x, DEFAULT_STATIONS.avatar.x)
  assert.equal(DEFAULT_ROOM.items.length, 0)
})
