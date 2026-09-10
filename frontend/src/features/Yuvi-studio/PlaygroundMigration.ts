import { MAX_ROOM_ITEMS, type RoomDesign, type RoomItem } from './RoomDesign.ts'
import { reconcileItemsForLayout, reconcileStationsForLayout, roomLayout } from './RoomLayouts.ts'
import { PLAYGROUND_EDITABLE_DEFAULTS } from './PlaygroundItems.ts'

export function reconcilePlayground(room: RoomDesign, boundsFor: (item: RoomItem) => { radius: number; wall: boolean }) {
  if ((room.worlds.adventurePark.playgroundVersion ?? 0) >= 2) return
  const active = room.activeLayoutId === 'adventurePark'
  const target = active ? room : room.worlds.adventurePark
  const layout = roomLayout('adventurePark')
  const existingStorage = target.storedItems.map((item) => ({ ...item }))
  const existingIds = new Set([...target.items, ...existingStorage].map((item) => item.uid))
  const additions = PLAYGROUND_EDITABLE_DEFAULTS.filter((item) => !existingIds.has(item.uid)).map((item) => ({ ...item }))
  const availableSlots = Math.max(0, MAX_ROOM_ITEMS - target.items.length)
  existingStorage.push(...additions.slice(availableSlots))
  const reconciled = reconcileItemsForLayout(layout, [...target.items, ...additions.slice(0, availableSlots)], [], {
    radiusFor: (item) => boundsFor(item).radius,
    isWallItem: (item) => boundsFor(item).wall,
    sourceLayout: layout,
  })
  target.items = reconciled.items
  const storage = new Map([...existingStorage, ...reconciled.storedItems].map((item) => [item.uid, item]))
  target.storedItems = [...storage.values()]
  if (active) {
    room.stations = reconcileStationsForLayout(layout, room.stations, target.items, {
      radiusFor: () => 1.6,
      itemRadiusFor: (item) => boundsFor(item).radius,
      isWallItem: (item) => boundsFor(item).wall,
    }).stations
    room.worlds.adventurePark.items = target.items.map((item) => ({ ...item }))
    room.worlds.adventurePark.storedItems = target.storedItems.map((item) => ({ ...item }))
  }
  room.worlds.adventurePark.playgroundVersion = 2
}