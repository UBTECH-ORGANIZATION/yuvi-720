import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRoom } from '../src/features/Yuvi-studio/RoomDesign.ts'
import { FREE_ROOM_LAYOUTS, ROOM_LAYOUTS, isRoomLayoutId, reconcileItemsForLayout, reconcileStationsForLayout, wallAnchorAt, wallAnchorTransform, type RoomLayout } from '../src/features/Yuvi-studio/RoomLayouts.ts'

test('legacy rooms migrate to the unchanged Lab layout', () => {
  const room = normalizeRoom({ version: 1, items: [{ uid: 'desk', kind: 'desk', x: 2, z: -3, rot: 0.5 }] })
  assert.equal(room.version, 2)
  assert.equal(room.activeLayoutId, 'lab')
  assert.deepEqual(room.items, [{ uid: 'desk', kind: 'desk', x: 2, z: -3, rot: 0.5, tint: undefined }])
})

test('only supported layouts can be restored from learner state', () => {
  assert.equal(normalizeRoom({ activeLayoutId: 'dome' }).activeLayoutId, 'dome')
  assert.equal(normalizeRoom({ activeLayoutId: 'not-a-room' }).activeLayoutId, 'lab')
  assert.deepEqual(FREE_ROOM_LAYOUTS, ['lab', 'dome'])
  assert.equal(isRoomLayoutId('triangularObservatory'), true)
  assert.equal(ROOM_LAYOUTS.triangularObservatory.buildablePolygon.length, 3)
})

test('layout reconciliation preserves legal props and relocates only illegal props', () => {
  const result = reconcileItemsForLayout(
    ROOM_LAYOUTS.triangularObservatory,
    [
      { uid: 'legal', kind: 'plant', x: 0, z: 3, rot: 0.2 },
      { uid: 'outside', kind: 'desk', x: 12, z: -10, rot: 0.4 },
    ],
    [],
    { radiusFor: (item) => (item.kind === 'desk' ? 0.85 : 0.34), gridStep: 1 },
  )
  assert.deepEqual(result.items.find((item) => item.uid === 'legal'), { uid: 'legal', kind: 'plant', x: 0, z: 3, rot: 0.2 })
  assert.deepEqual(result.relocatedUids, ['outside'])
  assert.equal(result.storedItems.length, 0)
})

test('a prop with no legal target is retained in storage', () => {
  const blockedLayout: RoomLayout = {
    ...ROOM_LAYOUTS.lab,
    buildablePolygon: [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }],
    decorBlockers: [{ x: 0, z: 0, radius: 2 }],
  }
  const item = { uid: 'keep-me', kind: 'couch', x: 8, z: 8, rot: 0 }
  const result = reconcileItemsForLayout(blockedLayout, [item], [], { radiusFor: () => 1, gridStep: 1 })
  assert.deepEqual(result.items, [])
  assert.deepEqual(result.storedItems, [item])
  assert.deepEqual(result.relocatedUids, [])
  assert.deepEqual(result.hiddenItems, [item])
})

test('a temporarily hidden prop returns automatically when the next world has room', () => {
  const item = { uid: 'return-me', kind: 'plant', x: 0, z: 0, rot: 0 }
  const result = reconcileItemsForLayout(ROOM_LAYOUTS.lab, [], [item], { radiusFor: () => 0.4 })
  assert.deepEqual(result.items, [item])
  assert.deepEqual(result.storedItems, [])
  assert.deepEqual(result.hiddenItems, [])
})

test('wall-mounted props remain anchored to a valid wall at the same height', () => {
  const sourceAnchor = wallAnchorAt(ROOM_LAYOUTS.lab, { x: 2, z: -11 }, 0.35)
  const sourceItem = { uid: 'poster', kind: 'poster', x: 2, z: -11, rot: 0, wallAnchor: sourceAnchor }
  const result = reconcileItemsForLayout(ROOM_LAYOUTS.dome, [sourceItem], [], {
    radiusFor: () => 1,
    isWallItem: () => true,
    sourceLayout: ROOM_LAYOUTS.lab,
  })
  const item = result.items[0]
  assert.equal(result.storedItems.length, 0)
  assert.equal(item.wallAnchor?.height, 0.35)
  assert.equal(ROOM_LAYOUTS.dome.walls.some((wall) => wall.id === item.wallAnchor?.wallId), true)
  const transform = wallAnchorTransform(ROOM_LAYOUTS.dome, item.wallAnchor!)
  assert.equal(Math.abs(transform.x) <= 13.1 && Math.abs(transform.z) <= 13.1, true)
})

test('stations retain legal positions and relocate only when a shell excludes them', () => {
  const stations = {
    ...ROOM_LAYOUTS.lab.defaultStations,
    mission: { ...ROOM_LAYOUTS.lab.defaultStations.mission, x: 20, z: 20 },
  }
  const result = reconcileStationsForLayout(ROOM_LAYOUTS.dome, stations, [], {
    radiusFor: () => 1.6,
    itemRadiusFor: () => 1,
  })
  assert.equal(result.stations.avatar.x, stations.avatar.x)
  assert.notEqual(result.stations.mission.x, stations.mission.x)
  assert.deepEqual(result.relocatedStationIds, ['explore', 'mission'])
})