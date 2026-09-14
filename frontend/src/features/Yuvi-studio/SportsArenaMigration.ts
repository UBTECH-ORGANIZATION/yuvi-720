import type { RoomItem, RoomStations, RoomWorldDesign } from './RoomDesign.ts'
import { pointInLayout, roomLayout, wallAnchorAt, wallAnchorTransform } from './RoomLayouts.ts'

export type ItemBounds = { radius: number; height: number; wall: boolean }
export type BoundsFor = (item: RoomItem) => ItemBounds

export function addMissingSportsStarters(world: Pick<RoomWorldDesign, 'items' | 'storedItems'>, starters: RoomItem[], stations: RoomStations, boundsFor: BoundsFor, cap: number) {
  const layout = roomLayout('sportsArena')
  const existing = new Set([...world.items, ...world.storedItems].map((item) => item.uid))
  const floorFits = (item: RoomItem) => {
    const { radius } = boundsFor(item)
    return pointInLayout(layout, item, radius + 0.08)
      && !layout.decorBlockers.some((blocker) => Math.hypot(item.x - blocker.x, item.z - blocker.z) < radius + blocker.radius)
      && !Object.values(stations).some((station) => station.placed && Math.hypot(item.x - station.x, item.z - station.z) < radius + 2)
      && !world.items.some((other) => !boundsFor(other).wall && Math.hypot(item.x - other.x, item.z - other.z) < radius + boundsFor(other).radius + 0.3)
  }
  const wallFits = (item: RoomItem) => {
    const anchor = item.wallAnchor!
    const bounds = boundsFor(item)
    const wall = layout.walls.find((wall) => wall.id === anchor.wallId)!
    const length = Math.hypot(wall.to.x - wall.from.x, wall.to.z - wall.from.z)
    return anchor.offset * length >= bounds.radius && (1 - anchor.offset) * length >= bounds.radius
      && !world.items.some((other) => {
        if (!boundsFor(other).wall) return false
        const otherAnchor = other.wallAnchor ?? wallAnchorAt(layout, other)
        const otherBounds = boundsFor(other)
        return anchor.wallId === otherAnchor.wallId
          && Math.abs(anchor.offset - otherAnchor.offset) * length < bounds.radius + otherBounds.radius + 0.2
          && anchor.height < otherAnchor.height + otherBounds.height + 0.2
          && anchor.height + bounds.height + 0.2 > otherAnchor.height
      })
  }
  for (const starter of starters) {
    if (existing.has(starter.uid)) continue
    const item = { ...starter, ...(starter.wallAnchor ? { wallAnchor: { ...starter.wallAnchor } } : {}) }
    if (world.items.length >= cap) { world.storedItems.push(item); continue }
    if (boundsFor(item).wall) {
      item.wallAnchor ??= wallAnchorAt(layout, item, 2.8)
      let target: RoomItem | undefined = wallFits(item) ? item : undefined
      for (let step = 1; !target && step < 20; step++) {
        const candidate = { ...item, wallAnchor: { ...item.wallAnchor, offset: step / 20 } }
        if (wallFits(candidate)) target = candidate
      }
      if (target) {
        const transform = wallAnchorTransform(layout, target.wallAnchor!)
        world.items.push({ ...target, x: transform.x, z: transform.z, rot: transform.rot })
      } else world.storedItems.push(item)
    } else {
      let target: RoomItem | undefined = floorFits(item) ? item : undefined
      const candidates: RoomItem[] = []
      for (let z = -21; z <= 28; z += 2) for (const x of [-16, -12, 12, 16]) candidates.push({ ...item, x, z })
      candidates.sort((left, right) => Math.hypot(left.x - item.x, left.z - item.z) - Math.hypot(right.x - item.x, right.z - item.z))
      target ??= candidates.find(floorFits)
      if (target) world.items.push(target)
      else world.storedItems.push(item)
    }
  }
}