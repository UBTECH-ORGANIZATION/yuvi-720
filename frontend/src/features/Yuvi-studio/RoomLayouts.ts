import type { RoomItem, RoomStations, StationId, WallAnchor } from './RoomDesign.ts'
import { PLAYGROUND_DECOR_BLOCKERS, PLAYGROUND_WALK_BLOCKERS, PLAYGROUND_WALK_SURFACES } from './PlaygroundLayout.ts'

export type RoomLayoutId = 'lab' | 'adventurePark' | 'sportsArena' | 'creatorLoft'

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

export interface RoomWalkSurface {
  x: number
  z: number
  width: number
  depth: number
  height: number
}

export interface RoomLayout {
  id: RoomLayoutId
  buildablePolygon: RoomLayoutPoint[]
  walls: RoomLayoutWall[]
  decorBlockers: Array<{ x: number; z: number; radius: number }>
  walkBlockers: Array<{ x: number; z: number; radius: number }>
  walkSurfaces: RoomWalkSurface[]
  defaultStations: RoomStations
  camera: { x: number; y: number; z: number; targetX: number; targetY: number; targetZ: number }
}

const LAB_STATIONS: RoomStations = {
  avatar: { x: 0, z: 0, rot: 0, placed: false },
  room: { x: -18, z: 7.8, rot: 1.2, placed: false },
  explore: { x: 17.6, z: -15, rot: -0.7, placed: true },
  mission: { x: 11.2, z: -6.6, rot: -0.72, placed: true },
}

const rectangleWalls = (halfX: number, backZ: number, frontZ: number): RoomLayoutWall[] => [
  { id: 'north', from: { x: -halfX, z: backZ }, to: { x: halfX, z: backZ } },
  { id: 'east', from: { x: halfX, z: backZ }, to: { x: halfX, z: frontZ } },
  { id: 'south', from: { x: halfX, z: frontZ }, to: { x: -halfX, z: frontZ } },
  { id: 'west', from: { x: -halfX, z: frontZ }, to: { x: -halfX, z: backZ } },
]

export function polygonArea(points: RoomLayoutPoint[]): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.z - next.x * point.z
  }, 0)) / 2
}

const LAB_POLYGON = [{ x: -24.4, z: -25.8 }, { x: 24.4, z: -25.8 }, { x: 24.4, z: 32.7 }, { x: -24.4, z: 32.7 }]
export const LAB_USABLE_AREA = polygonArea(LAB_POLYGON)
const LAB_WALLS = rectangleWalls(24.4, -25.8, 32.7)
const WORLD_CAMERA = { x: 0, y: 7.5, z: 22, targetX: 0, targetY: 0, targetZ: 0 }

const ADVENTURE_PARK_BLOCKERS = [
  { x: -7.2, z: -22.6, radius: 3.2 },
  { x: 0, z: -22.6, radius: 3.2 },
  { x: 7.2, z: -22.6, radius: 3.2 },
  { x: -20.2, z: 21.5, radius: 4.2 },
  { x: 21.2, z: 23.5, radius: 2.6 },
]

const ADVENTURE_PARK_WALK_BLOCKERS = [
  { x: -23, z: 25.4, radius: 1.15 },
  { x: 21.2, z: 23.5, radius: 2.6 },
]

const ADVENTURE_PARK_WALK_SURFACES: RoomWalkSurface[] = [
  { x: -7.2, z: -22.8, width: 6.5, depth: 4.4, height: 0.34 },
  { x: 0, z: -22.8, width: 6.5, depth: 4.4, height: 0.34 },
  { x: 7.2, z: -22.8, width: 6.5, depth: 4.4, height: 0.34 },
  { x: -20.1, z: 18.6, width: 7.6, depth: 1.75, height: 0.5 },
  { x: -20.1, z: 19.95, width: 6.95, depth: 1.75, height: 0.92 },
  { x: -20.1, z: 21.3, width: 6.3, depth: 1.75, height: 1.34 },
]

const SPORTS_ARENA_BLOCKERS = [
  { x: -21.5, z: -5, radius: 2.2 },
  { x: -21.5, z: 5, radius: 2.2 },
  { x: -21.5, z: 15, radius: 2.2 },
  { x: 21.5, z: -5, radius: 2.2 },
  { x: 21.5, z: 5, radius: 2.2 },
  { x: 21.5, z: 15, radius: 2.2 },
]

const SPORTS_ARENA_WALK_SURFACES: RoomWalkSurface[] = [-1, 1].flatMap((side) => [
  { x: side * 20.4, z: 5, width: 1.15, depth: 24, height: 0.32 },
  { x: side * 21.5, z: 5, width: 1.15, depth: 24, height: 0.64 },
  { x: side * 22.6, z: 5, width: 1.15, depth: 24, height: 0.96 },
])

const CREATOR_LOFT_BLOCKERS = [
  { x: -6, z: -21.8, radius: 3.15 },
  { x: 0, z: -21.8, radius: 3.15 },
  { x: 6, z: -21.8, radius: 3.15 },
]

const CREATOR_LOFT_WALK_SURFACES: RoomWalkSurface[] = [
  { x: 0, z: -21.8, width: 18, depth: 7, height: 0.8 },
]

const rectangularWorld = (
  id: RoomLayoutId,
  decorBlockers: RoomLayout['decorBlockers'] = [],
  walkBlockers: RoomLayout['walkBlockers'] = decorBlockers,
  walkSurfaces: RoomLayout['walkSurfaces'] = [],
): RoomLayout => ({
  id,
  buildablePolygon: LAB_POLYGON,
  walls: LAB_WALLS,
  decorBlockers,
  walkBlockers,
  walkSurfaces,
  defaultStations: LAB_STATIONS,
  camera: WORLD_CAMERA,
})

export const ROOM_LAYOUTS: Record<RoomLayoutId, RoomLayout> = {
  lab: rectangularWorld('lab'),
  adventurePark: rectangularWorld('adventurePark', PLAYGROUND_DECOR_BLOCKERS, PLAYGROUND_WALK_BLOCKERS, PLAYGROUND_WALK_SURFACES),
  sportsArena: rectangularWorld('sportsArena', SPORTS_ARENA_BLOCKERS, [], SPORTS_ARENA_WALK_SURFACES),
  creatorLoft: rectangularWorld('creatorLoft', CREATOR_LOFT_BLOCKERS, [], CREATOR_LOFT_WALK_SURFACES),
}

export const FREE_ROOM_LAYOUTS: RoomLayoutId[] = ['lab', 'adventurePark']

export function isRoomLayoutId(value: unknown): value is RoomLayoutId {
  return value === 'lab' || value === 'adventurePark' || value === 'sportsArena' || value === 'creatorLoft'
}

export function normalizeRoomLayoutId(value: unknown): RoomLayoutId {
  if (value === 'dome') return 'adventurePark'
  if (value === 'triangularObservatory') return 'creatorLoft'
  return isRoomLayoutId(value) ? value : 'lab'
}

export function roomLayout(id: RoomLayoutId): RoomLayout {
  return ROOM_LAYOUTS[id]
}

export function walkSurfaceHeightAt(layout: RoomLayout, point: RoomLayoutPoint): number {
  return layout.walkSurfaces.reduce((height, surface) => (
    Math.abs(point.x - surface.x) <= surface.width / 2 && Math.abs(point.z - surface.z) <= surface.depth / 2
      ? Math.max(height, surface.height)
      : height
  ), 0)
}

export function wallAnchorAt(layout: RoomLayout, point: RoomLayoutPoint, height = 0, clearance = 0): WallAnchor {
  const closest = layout.walls.reduce<{ wall: RoomLayoutWall; offset: number; distance: number } | null>((best, wall) => {
    const dx = wall.to.x - wall.from.x
    const dz = wall.to.z - wall.from.z
    const lengthSquared = dx * dx + dz * dz
    const length = Math.sqrt(lengthSquared)
    const edgeInset = length > 0 ? Math.min(0.49, clearance / length) : 0
    const rawOffset = lengthSquared ? ((point.x - wall.from.x) * dx + (point.z - wall.from.z) * dz) / lengthSquared : 0
    const offset = Math.max(edgeInset, Math.min(1 - edgeInset, rawOffset))
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

const WALL_CLEARANCE = 0.08

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
    return pointInLayout(layout, point, radius + WALL_CLEARANCE)
      && !blockers.some((blocker) => overlaps(point, radius, blocker, blocker.radius))
      && !accepted.some((other) => overlaps(point, radius, other, options.radiusFor(other)))
  }

  const previouslyHiddenUids = new Set(storedItems.map((item) => item.uid))
  for (const item of [...items, ...storedItems]) {
    if (isWallItem(item)) {
      const sourceLayout = options.sourceLayout ?? layout
      const sourceAnchor = item.wallAnchor ?? wallAnchorAt(sourceLayout, item)
      const sourcePoint = wallAnchorTransform(sourceLayout, sourceAnchor)
      accepted.push({ ...item, wallAnchor: wallAnchorAt(layout, sourcePoint, sourceAnchor.height, options.radiusFor(item) + WALL_CLEARANCE) })
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
    return pointInLayout(layout, point, radius + WALL_CLEARANCE)
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