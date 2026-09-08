import type { RoomItem, RoomStations, StationId, WallAnchor } from './RoomDesign.ts'

export type RoomLayoutId = 'lab' | 'dome' | 'triangularObservatory'

export interface RoomLayoutPoint {
  x: number
  z: number
}

export interface RoomLayoutWall {
  id: string
  from: RoomLayoutPoint
  to: RoomLayoutPoint
  openings?: Array<{ at: number; width: number }>
}

export interface RoomLayout {
  id: RoomLayoutId
  buildablePolygon: RoomLayoutPoint[]
  walls: RoomLayoutWall[]
  decorBlockers: Array<{ x: number; z: number; radius: number }>
  defaultStations: RoomStations
  camera: { x: number; y: number; z: number; targetX: number; targetY: number; targetZ: number }
}

const LAB_STATIONS: RoomStations = {
  avatar: { x: 0, z: 0, rot: 0, placed: false },
  room: { x: -9, z: 3.9, rot: 1.2, placed: false },
  explore: { x: 8.8, z: -7.5, rot: -0.7, placed: true },
  mission: { x: 5.6, z: -3.3, rot: -0.72, placed: true },
}

const DOME_STATIONS: RoomStations = {
  avatar: { x: 0, z: 1.5, rot: 0, placed: false },
  room: { x: -6.9, z: 2.8, rot: 1.2, placed: false },
  explore: { x: 6.8, z: -4.6, rot: -0.7, placed: true },
  mission: { x: 4.8, z: 2.4, rot: 2.5, placed: true },
}

const OBSERVATORY_STATIONS: RoomStations = {
  avatar: { x: 0, z: 3, rot: 0, placed: false },
  room: { x: -6.5, z: 4.8, rot: 1.1, placed: false },
  explore: { x: 6.3, z: 4.5, rot: -1.1, placed: true },
  mission: { x: 0, z: -6.6, rot: 0, placed: true },
}

const rectangleWalls = (halfX: number, backZ: number, frontZ: number): RoomLayoutWall[] => [
  { id: 'north', from: { x: -halfX, z: backZ }, to: { x: halfX, z: backZ } },
  { id: 'east', from: { x: halfX, z: backZ }, to: { x: halfX, z: frontZ } },
  { id: 'south', from: { x: halfX, z: frontZ }, to: { x: -halfX, z: frontZ } },
  { id: 'west', from: { x: -halfX, z: frontZ }, to: { x: -halfX, z: backZ } },
]

const polygonWalls = (points: RoomLayoutPoint[]): RoomLayoutWall[] => points.map((from, index) => ({
  id: `wall-${index + 1}`,
  from,
  to: points[(index + 1) % points.length],
}))

const DOME_POLYGON = [{ x: 0, z: -13 }, { x: 9.2, z: -9.2 }, { x: 13, z: 0 }, { x: 9.2, z: 9.2 }, { x: 0, z: 13 }, { x: -9.2, z: 9.2 }, { x: -13, z: 0 }, { x: -9.2, z: -9.2 }]
const OBSERVATORY_POLYGON = [{ x: 0, z: -13 }, { x: 13, z: 13 }, { x: -13, z: 13 }]

export const ROOM_LAYOUTS: Record<RoomLayoutId, RoomLayout> = {
  lab: {
    id: 'lab',
    buildablePolygon: [{ x: -12.2, z: -12.9 }, { x: 12.2, z: -12.9 }, { x: 12.2, z: 16.35 }, { x: -12.2, z: 16.35 }],
    walls: rectangleWalls(12.2, -12.9, 16.35),
    decorBlockers: [],
    defaultStations: LAB_STATIONS,
    camera: { x: 0, y: 7.5, z: 22, targetX: 0, targetY: 0, targetZ: 0 },
  },
  dome: {
    id: 'dome',
    buildablePolygon: DOME_POLYGON,
    walls: polygonWalls(DOME_POLYGON),
    decorBlockers: [{ x: 0, z: -11.2, radius: 1.4 }],
    defaultStations: DOME_STATIONS,
    camera: { x: 0, y: 8, z: 22, targetX: 0, targetY: 0, targetZ: 0 },
  },
  triangularObservatory: {
    id: 'triangularObservatory',
    buildablePolygon: OBSERVATORY_POLYGON,
    walls: polygonWalls(OBSERVATORY_POLYGON),
    decorBlockers: [{ x: 0, z: -10.4, radius: 1.6 }],
    defaultStations: OBSERVATORY_STATIONS,
    camera: { x: 0, y: 8.5, z: 23, targetX: 0, targetY: 0, targetZ: 1.5 },
  },
}

export const FREE_ROOM_LAYOUTS: RoomLayoutId[] = ['lab', 'dome']

export function isRoomLayoutId(value: unknown): value is RoomLayoutId {
  return value === 'lab' || value === 'dome' || value === 'triangularObservatory'
}

export function roomLayout(id: RoomLayoutId): RoomLayout {
  return ROOM_LAYOUTS[id]
}

export function wallAnchorAt(layout: RoomLayout, point: RoomLayoutPoint, height = 0): WallAnchor {
  const closest = layout.walls.reduce<{ wall: RoomLayoutWall; offset: number; distance: number } | null>((best, wall) => {
    const dx = wall.to.x - wall.from.x
    const dz = wall.to.z - wall.from.z
    const lengthSquared = dx * dx + dz * dz
    const offset = lengthSquared ? Math.max(0, Math.min(1, ((point.x - wall.from.x) * dx + (point.z - wall.from.z) * dz) / lengthSquared)) : 0
    const x = wall.from.x + dx * offset
    const z = wall.from.z + dz * offset
    const candidate = { wall, offset, distance: Math.hypot(point.x - x, point.z - z) }
    return !best || candidate.distance < best.distance ? candidate : best
  }, null)
  const wall = closest?.wall ?? layout.walls[0]
  return { wallId: wall.id, offset: closest?.offset ?? 0.5, height }
}

export function wallAnchorTransform(layout: RoomLayout, anchor: WallAnchor): { x: number; z: number; rot: number; height: number } {
  const wall = layout.walls.find((entry) => entry.id === anchor.wallId) ?? layout.walls[0]
  const offset = Math.max(0, Math.min(1, anchor.offset))
  const dx = wall.to.x - wall.from.x
  const dz = wall.to.z - wall.from.z
  const length = Math.hypot(dx, dz) || 1
  const inwardX = -dz / length
  const inwardZ = dx / length
  return {
    x: wall.from.x + dx * offset + inwardX * 0.06,
    z: wall.from.z + dz * offset + inwardZ * 0.06,
    rot: Math.atan2(inwardX, inwardZ),
    height: anchor.height,
  }
}

export function pointInLayout(layout: RoomLayout, point: RoomLayoutPoint, inset = 0): boolean {
  let inside = false
  const polygon = layout.buildablePolygon
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    const crosses = (currentPoint.z > point.z) !== (previousPoint.z > point.z)
      && point.x < ((previousPoint.x - currentPoint.x) * (point.z - currentPoint.z)) / (previousPoint.z - currentPoint.z) + currentPoint.x
    if (crosses) inside = !inside
  }
  if (!inside) return false
  if (!inset) return true
  return polygon.every((start, index) => {
    const end = polygon[(index + 1) % polygon.length]
    const length = Math.hypot(end.x - start.x, end.z - start.z)
    return length === 0 || Math.abs((end.x - start.x) * (start.z - point.z) - (start.x - point.x) * (end.z - start.z)) / length >= inset
  })
}

/** Moves an out-of-bounds floor point toward the layout centre until it is legal. */
export function projectPointIntoLayout(layout: RoomLayout, point: RoomLayoutPoint, inset = 0): RoomLayoutPoint {
  if (pointInLayout(layout, point, inset)) return point
  const centre = layout.buildablePolygon.reduce(
    (total, vertex) => ({ x: total.x + vertex.x / layout.buildablePolygon.length, z: total.z + vertex.z / layout.buildablePolygon.length }),
    { x: 0, z: 0 },
  )
  let low = 0
  let high = 1
  for (let index = 0; index < 20; index += 1) {
    const progress = (low + high) / 2
    const candidate = { x: point.x + (centre.x - point.x) * progress, z: point.z + (centre.z - point.z) * progress }
    if (pointInLayout(layout, candidate, inset)) high = progress
    else low = progress
  }
  return {
    x: point.x + (centre.x - point.x) * high,
    z: point.z + (centre.z - point.z) * high,
  }
}

export interface LayoutReconciliation {
  items: RoomItem[]
  storedItems: RoomItem[]
  relocatedUids: string[]
  /** Props from the visible room that still cannot fit in the destination. */
  hiddenItems: RoomItem[]
}

export interface StationReconciliation {
  stations: RoomStations
  relocatedStationIds: StationId[]
}

export interface ReconcileLayoutOptions {
  radiusFor: (item: RoomItem) => number
  /** Wall items are remapped between compatible wall segments. */
  isWallItem?: (item: RoomItem) => boolean
  sourceLayout?: RoomLayout
  gridStep?: number
}

const overlaps = (left: RoomLayoutPoint, leftRadius: number, right: RoomLayoutPoint, rightRadius: number) =>
  Math.hypot(left.x - right.x, left.z - right.z) < leftRadius + rightRadius

function layoutCandidates(layout: RoomLayout, step: number): RoomLayoutPoint[] {
  const xs = layout.buildablePolygon.map((point) => point.x)
  const zs = layout.buildablePolygon.map((point) => point.z)
  const candidates: RoomLayoutPoint[] = []
  for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) candidates.push({ x, z })
  }
  return candidates.sort((left, right) => Math.hypot(left.x, left.z) - Math.hypot(right.x, right.z))
}

/**
 * Projects one shared furniture collection into a different room shell.
 * Valid props are not touched; invalid floor props are placed on a stable grid
 * or retained in storage if the target layout cannot contain them all.
 */
export function reconcileItemsForLayout(
  layout: RoomLayout,
  items: RoomItem[],
  storedItems: RoomItem[],
  options: ReconcileLayoutOptions,
): LayoutReconciliation {
  const isWallItem = options.isWallItem ?? (() => false)
  const step = options.gridStep ?? 1.2
  const accepted: RoomItem[] = []
  const relocate: RoomItem[] = []
  const blockers = layout.decorBlockers
  const fits = (item: RoomItem, point: RoomLayoutPoint) => {
    const radius = options.radiusFor(item)
    return pointInLayout(layout, point, radius)
      && !blockers.some((blocker) => overlaps(point, radius, blocker, blocker.radius))
      && !accepted.some((other) => overlaps(point, radius, other, options.radiusFor(other)))
  }

  const previouslyHiddenUids = new Set(storedItems.map((item) => item.uid))
  for (const item of [...items, ...storedItems]) {
    if (isWallItem(item)) {
      const sourceLayout = options.sourceLayout ?? layout
      const sourceAnchor = item.wallAnchor ?? wallAnchorAt(sourceLayout, item)
      const sourcePoint = wallAnchorTransform(sourceLayout, sourceAnchor)
      accepted.push({ ...item, wallAnchor: wallAnchorAt(layout, sourcePoint, sourceAnchor.height) })
    } else if (fits(item, item)) accepted.push(item)
    else relocate.push(item)
  }

  const candidates = layoutCandidates(layout, step)
  const relocatedUids: string[] = []
  const returnedToStorage: RoomItem[] = []
  const hiddenItems: RoomItem[] = []
  for (const item of relocate.sort((left, right) => left.uid.localeCompare(right.uid))) {
    const candidate = candidates.find((point) => fits(item, point))
    if (!candidate) {
      returnedToStorage.push(item)
      if (!previouslyHiddenUids.has(item.uid)) hiddenItems.push(item)
      continue
    }
    accepted.push({ ...item, x: candidate.x, z: candidate.z })
    relocatedUids.push(item.uid)
  }
  return { items: accepted, storedItems: returnedToStorage, relocatedUids, hiddenItems }
}

/**
 * Stations travel with the shared room just like props. Their valid placements
 * remain exact; only a station outside the next shell moves to a legal spot.
 */
export function reconcileStationsForLayout(
  layout: RoomLayout,
  stations: RoomStations,
  items: RoomItem[],
  options: { radiusFor: (id: StationId) => number; itemRadiusFor: (item: RoomItem) => number; isWallItem?: (item: RoomItem) => boolean; gridStep?: number },
): StationReconciliation {
  const isWallItem = options.isWallItem ?? (() => false)
  const accepted: Array<{ id: StationId; x: number; z: number; radius: number }> = []
  const candidates = layoutCandidates(layout, options.gridStep ?? 1.2)
  const next = { ...stations }
  const relocatedStationIds: StationId[] = []
  const fits = (id: StationId, point: RoomLayoutPoint) => {
    const radius = options.radiusFor(id)
    return pointInLayout(layout, point, radius)
      && !layout.decorBlockers.some((blocker) => overlaps(point, radius, blocker, blocker.radius))
      && !items.some((item) => !isWallItem(item) && overlaps(point, radius, item, options.itemRadiusFor(item)))
      && !accepted.some((station) => overlaps(point, radius, station, station.radius))
  }
  for (const id of ['avatar', 'room', 'explore', 'mission'] as StationId[]) {
    const current = stations[id]
    const target = fits(id, current)
      ? current
      : [layout.defaultStations[id], ...candidates].find((candidate) => fits(id, candidate))
    if (!target) continue
    if (target !== current) relocatedStationIds.push(id)
    next[id] = { ...current, x: target.x, z: target.z, rot: target === current ? current.rot : layout.defaultStations[id].rot }
    accepted.push({ id, x: next[id].x, z: next[id].z, radius: options.radiusFor(id) })
  }
  return { stations: next, relocatedStationIds }
}