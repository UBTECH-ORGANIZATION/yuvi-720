import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRoom } from '../src/features/Yuvi-studio/RoomDesign.ts'
import { FREE_ROOM_LAYOUTS, LAB_USABLE_AREA, ROOM_LAYOUTS, isRoomLayoutId, pointInLayout, polygonArea, reconcileItemsForLayout, reconcileStationsForLayout, wallAnchorAt, wallAnchorTransform, type RoomLayout } from '../src/features/Yuvi-studio/RoomLayouts.ts'

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
  const domeRadius = Math.max(...ROOM_LAYOUTS.dome.buildablePolygon.map((point) => Math.hypot(point.x, point.z)))
  assert.equal(domeRadius > 30 && domeRadius < 30.3, true)
  assert.equal(ROOM_LAYOUTS.lab.buildablePolygon[1].x - ROOM_LAYOUTS.lab.buildablePolygon[0].x, 48.8)
})

test('all room layouts have the same usable floor area as the lab', () => {
  assert.equal(Math.abs(LAB_USABLE_AREA - 2854.8) < 0.001, true)
  for (const layout of Object.values(ROOM_LAYOUTS)) {
    assert.equal(Math.abs(polygonArea(layout.buildablePolygon) - LAB_USABLE_AREA) < 0.001, true, layout.id)
  }
})

test('large circular footprints cannot enter an observatory corner', () => {
  const layout = ROOM_LAYOUTS.triangularObservatory
  const corner = layout.buildablePolygon[0]
  assert.equal(pointInLayout(layout, { x: corner.x, z: corner.z + 1 }, 1.8), false)
  assert.equal(pointInLayout(layout, { x: 0, z: 4 }, 1.8), true)
})

test('layout reconciliation preserves legal props and relocates only illegal props', () => {
  const result = reconcileItemsForLayout(
    ROOM_LAYOUTS.triangularObservatory,
    [
      { uid: 'legal', kind: 'plant', x: 0, z: 3, rot: 0.2 },
      { uid: 'outside', kind: 'desk', x: 30, z: -20, rot: 0.4 },
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
  const domeRadius = Math.max(...ROOM_LAYOUTS.dome.buildablePolygon.map((point) => Math.hypot(point.x, point.z)))
  assert.equal(Math.hypot(transform.x, transform.z) <= domeRadius, true)
})

test('wall-mounted props keep their full width away from observatory corners', () => {
  const layout = ROOM_LAYOUTS.triangularObservatory
  const anchor = wallAnchorAt(layout, layout.buildablePolygon[0], 0.5, 2)
  const wall = layout.walls.find((candidate) => candidate.id === anchor.wallId)!
  const wallLength = Math.hypot(wall.to.x - wall.from.x, wall.to.z - wall.from.z)
  assert.equal(anchor.offset * wallLength >= 2 - 1e-9, true)
  assert.equal((1 - anchor.offset) * wallLength >= 2 - 1e-9, true)
})

test('stations retain legal positions and relocate only when a shell excludes them', () => {
  const stations = {
    ...ROOM_LAYOUTS.lab.defaultStations,
    mission: { ...ROOM_LAYOUTS.lab.defaultStations.mission, x: 31, z: 20 },
  }
  const result = reconcileStationsForLayout(ROOM_LAYOUTS.dome, stations, [], {
    radiusFor: () => 1.6,
    itemRadiusFor: () => 1,
  })
  assert.equal(result.stations.avatar.x, stations.avatar.x)
  assert.notEqual(result.stations.mission.x, stations.mission.x)
  assert.deepEqual(result.relocatedStationIds, ['mission'])
})