// Room design model — mirrors the persisted `learner_state.room` shape.
//
// The learner's room is non-identifying UI state: a floor, a wall, a lighting
// mood and a list of placed props. It is deliberately a flat, serialisable
// record with no three.js types in it, so the same layout can be rendered by
// the studio, a thumbnail, or a future shared space.

import { normalizeRoomLayoutId, type RoomLayoutId } from './RoomLayouts.ts'

export type RoomStyleId = 'lab' | 'wood' | 'carpet' | 'meadow' | 'court'
export type WallStyleId = 'lab' | 'warm' | 'sky' | 'forest' | 'space'
export type MoodId = 'studio' | 'sunset' | 'night' | 'party'

export interface WallAnchor {
  wallId: string
  offset: number
  height: number
}

export interface RoomItem {
  /** Stable per-instance id, so two identical plants can be moved apart. */
  uid: string
  /** Catalog entry id (see RoomCatalog). */
  kind: string
  x: number
  z: number
  /** Y rotation in radians. */
  rot: number
  /** Wall identity and position for wall-mounted props. */
  wallAnchor?: WallAnchor
  /** Optional per-instance tint for tintable props. */
  tint?: string
}

export type StationId = 'avatar' | 'room' | 'explore' | 'mission'
export interface RoomStation {
  x: number
  z: number
  rot: number
  /** The two design stations arrive through the first-visit walkthrough. */
  placed: boolean
}

/**
 * Where the two walk-in stations stand, and which way they face. The room
 * station's coordinate is the bench itself; the spot the learner stands on is
 * derived from its position *and* its angle, so turning the bench takes its
 * doorway with it.
 */
export type RoomStations = Record<StationId, RoomStation>

export interface RoomWorldDesign {
  floor: RoomStyleId
  wall: WallStyleId
  mood: MoodId
  items: RoomItem[]
  storedItems: RoomItem[]
}

export interface RoomDesign {
  version: number
  /** The world currently rendered in the Studio. */
  activeLayoutId: RoomLayoutId
  /** Independent learner decoration for every world. */
  worlds: Record<RoomLayoutId, RoomWorldDesign>
  /** Active-world projection retained for existing Studio rendering/editing code. */
  floor: RoomStyleId
  wall: WallStyleId
  mood: MoodId
  items: RoomItem[]
  /** Temporarily hidden props that cannot currently be placed in the active room shell. */
  storedItems: RoomItem[]
  stations: RoomStations
  /** The learner has seen the studio's opening orientation. */
  introDone: boolean
  /** The learner has been walked through placing and turning the stations. */
  tutorialDone: boolean
}

export const ROOM_STYLES: RoomStyleId[] = ['lab', 'wood', 'carpet', 'meadow', 'court']
export const WALL_STYLES: WallStyleId[] = ['lab', 'warm', 'sky', 'forest', 'space']
export const MOODS: MoodId[] = ['studio', 'sunset', 'night', 'party']

/** Hard cap. A room full of 200 props is not a design, it is a frame-rate bug. */
export const MAX_ROOM_ITEMS = 60

/**
 * The angle the room bench was authored at. Rooms saved before stations could
 * turn have no angle of their own, so this is what they fall back to and the
 * layout they were designed in is preserved exactly.
 */
export const DEFAULT_BENCH_ROT = 1.2

export const DEFAULT_STATIONS: RoomStations = {
  avatar: { x: 0, z: 0, rot: 0, placed: false },
  room: { x: -9, z: 3.9, rot: DEFAULT_BENCH_ROT, placed: false },
  explore: { x: 8.8, z: -7.5, rot: -0.7, placed: true },
  mission: { x: 5.6, z: -3.3, rot: -0.72, placed: true },
}

export const ADVENTURE_PARK_DEFAULT_ITEMS: RoomItem[] = [
  { uid: 'park-bench-west', kind: 'parkBench', x: -20.2, z: -4.8, rot: Math.PI / 2 },
  { uid: 'park-bench-north', kind: 'parkBench', x: -9.8, z: -15.2, rot: 0 },
  { uid: 'park-sandbox', kind: 'parkSandbox', x: -15.5, z: -10.5, rot: 0 },
  { uid: 'park-coaster', kind: 'parkCoaster', x: 17, z: 0, rot: 0 },
]

export const SPORTS_ARENA_DEFAULT_ITEMS: RoomItem[] = [
  { uid: 'arena-bench', kind: 'sportsBench', x: -16.5, z: 15, rot: Math.PI / 2 },
  { uid: 'arena-ball-rack', kind: 'sportsBallRack', x: 16.5, z: 15, rot: -Math.PI / 2 },
  { uid: 'arena-training-box-low', kind: 'sportsTrainingBox', x: -11.5, z: 22, rot: 0 },
  { uid: 'arena-training-box-high', kind: 'sportsTrainingBox', x: -7.5, z: 22, rot: Math.PI / 2 },
  { uid: 'arena-mini-goal', kind: 'sportsMiniGoal', x: 13, z: 22, rot: Math.PI },
]

export const CREATOR_LOFT_DEFAULT_ITEMS: RoomItem[] = [
  { uid: 'loft-arcade-cyan', kind: 'loftArcadeCabinet', x: -18, z: -10, rot: Math.PI / 2 },
  { uid: 'loft-arcade-coral', kind: 'loftArcadeCabinet', x: -18, z: -5, rot: Math.PI / 2, tint: '#ff5f8f' },
  { uid: 'loft-claw-machine', kind: 'loftClawMachine', x: 18, z: -10, rot: -Math.PI / 2 },
  { uid: 'loft-token-pusher', kind: 'loftTokenPusher', x: 18, z: -4, rot: -Math.PI / 2 },
  { uid: 'loft-pinball', kind: 'loftPinball', x: -16, z: 15, rot: Math.PI / 2 },
  { uid: 'loft-basketball-arcade', kind: 'loftBasketballArcade', x: 14, z: 17, rot: -Math.PI / 2 },
  { uid: 'loft-prize-counter', kind: 'loftPrizeCounter', x: 0, z: 23, rot: Math.PI },
  { uid: 'loft-claw-machine-mini', kind: 'loftClawMachine', x: 18, z: 2, rot: -Math.PI / 2, tint: '#5de7ff' },
]

const DEFAULT_WORLD = (items: RoomItem[] = []): RoomWorldDesign => ({
  floor: 'lab',
  wall: 'lab',
  mood: 'studio',
  items: items.map((item) => ({ ...item })),
  storedItems: [],
})

export const DEFAULT_WORLDS: Record<RoomLayoutId, RoomWorldDesign> = {
  lab: DEFAULT_WORLD(),
  adventurePark: DEFAULT_WORLD(ADVENTURE_PARK_DEFAULT_ITEMS),
  sportsArena: DEFAULT_WORLD(SPORTS_ARENA_DEFAULT_ITEMS),
  creatorLoft: DEFAULT_WORLD(CREATOR_LOFT_DEFAULT_ITEMS),
}

export const DEFAULT_ROOM: RoomDesign = {
  version: 6,
  activeLayoutId: 'lab',
  worlds: DEFAULT_WORLDS,
  floor: 'lab',
  wall: 'lab',
  mood: 'studio',
  items: [],
  storedItems: [],
  stations: DEFAULT_STATIONS,
  introDone: false,
  tutorialDone: false,
}

export function cloneRoom(room: RoomDesign): RoomDesign {
  const cloneItem = (item: RoomItem): RoomItem => ({
    ...item,
    ...(item.wallAnchor ? { wallAnchor: { ...item.wallAnchor } } : {}),
  })
  return {
    version: room.version,
    activeLayoutId: room.activeLayoutId,
    worlds: Object.fromEntries(Object.entries(room.worlds).map(([id, world]) => [id, {
      floor: world.floor,
      wall: world.wall,
      mood: world.mood,
      items: world.items.map(cloneItem),
      storedItems: world.storedItems.map(cloneItem),
    }])) as Record<RoomLayoutId, RoomWorldDesign>,
    floor: room.floor,
    wall: room.wall,
    mood: room.mood,
    items: room.items.map(cloneItem),
    storedItems: room.storedItems.map(cloneItem),
    stations: {
      avatar: { ...room.stations.avatar },
      room: { ...room.stations.room },
      explore: { ...room.stations.explore },
      mission: { ...room.stations.mission },
    },
    introDone: room.introDone,
    tutorialDone: room.tutorialDone,
  }
}

export function isSharedWorldItem(item: RoomItem): boolean {
  return item.kind.startsWith('surprise_') || item.kind.startsWith('weekly_surprise_')
}

function activeWorldSnapshot(room: RoomDesign): RoomWorldDesign {
  return {
    floor: room.floor,
    wall: room.wall,
    mood: room.mood,
    items: room.items.filter((item) => !isSharedWorldItem(item)).map((item) => ({ ...item })),
    storedItems: room.storedItems.filter((item) => !isSharedWorldItem(item)).map((item) => ({ ...item })),
  }
}

export function syncActiveWorld(room: RoomDesign): RoomDesign {
  const next = cloneRoom(room)
  next.worlds[next.activeLayoutId] = activeWorldSnapshot(next)
  return next
}

/** Switches world without leaking ordinary furniture into the destination. */
export function switchRoomWorld(room: RoomDesign, activeLayoutId: RoomLayoutId): RoomDesign {
  const current = syncActiveWorld(room)
  if (current.activeLayoutId === activeLayoutId) return current
  const sharedItems = [...current.items, ...current.storedItems]
    .filter(isSharedWorldItem)
    .filter((item, index, all) => all.findIndex((candidate) => candidate.uid === item.uid) === index)
  const destination = current.worlds[activeLayoutId]
  return {
    ...current,
    activeLayoutId,
    floor: destination.floor,
    wall: destination.wall,
    mood: destination.mood,
    items: [...destination.items.map((item) => ({ ...item })), ...sharedItems.map((item) => ({ ...item }))],
    storedItems: destination.storedItems.map((item) => ({ ...item })),
  }
}

/**
 * The room as it shipped — except for the walkthrough, which is not decoration.
 *
 * `tutorialDone` records something about the learner, not about the room, and
 * resetting it through `DEFAULT_ROOM` meant a saved reset handed them the same
 * three-step walkthrough again on their next visit, every time.
 */
export function resetRoom(room: RoomDesign): RoomDesign {
  const reset = cloneRoom(DEFAULT_ROOM)
  reset.introDone = room.introDone
  reset.tutorialDone = room.tutorialDone
  if (room.introDone) {
    reset.stations.avatar.placed = true
    reset.stations.room.placed = true
  }
  return reset
}

let uidSeed = 0
export function newItemUid(): string {
  uidSeed += 1
  return `it${Date.now().toString(36)}${uidSeed.toString(36)}`
}

const isFinitePoint = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function isWallAnchor(value: unknown): value is WallAnchor {
  if (!value || typeof value !== 'object') return false
  const anchor = value as Record<string, unknown>
  return typeof anchor.wallId === 'string' && anchor.wallId.length > 0
    && isFinitePoint(anchor.offset) && isFinitePoint(anchor.height)
}

/** Coerce whatever came back from the API into a safe, complete room. */
export function normalizeRoom(raw: unknown): RoomDesign {
  const base = cloneRoom(DEFAULT_ROOM)
  if (!raw || typeof raw !== 'object') return base
  const record = raw as Record<string, unknown>
  const sourceVersion = isFinitePoint(record.version) ? record.version : 1

  base.activeLayoutId = normalizeRoomLayoutId(record.activeLayoutId)

  if (ROOM_STYLES.includes(record.floor as RoomStyleId)) base.floor = record.floor as RoomStyleId
  if (WALL_STYLES.includes(record.wall as WallStyleId)) base.wall = record.wall as WallStyleId
  if (MOODS.includes(record.mood as MoodId)) base.mood = record.mood as MoodId

  if (Array.isArray(record.items)) {
    for (const entry of record.items) {
      if (base.items.length >= MAX_ROOM_ITEMS) break
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      if (typeof item.kind !== 'string') continue
      if (!isFinitePoint(item.x) || !isFinitePoint(item.z)) continue
      const wallAnchor = isWallAnchor(item.wallAnchor) ? item.wallAnchor : undefined
      base.items.push({
        uid: typeof item.uid === 'string' && item.uid ? item.uid : newItemUid(),
        kind: item.kind,
        x: item.x,
        z: item.z,
        rot: isFinitePoint(item.rot) ? item.rot : 0,
        ...(wallAnchor ? { wallAnchor } : {}),
        tint: typeof item.tint === 'string' ? item.tint : undefined,
      })
    }
  }

  if (Array.isArray(record.storedItems)) {
    for (const entry of record.storedItems) {
      if (base.storedItems.length >= MAX_ROOM_ITEMS) break
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      if (typeof item.kind !== 'string') continue
      if (!isFinitePoint(item.x) || !isFinitePoint(item.z)) continue
      const wallAnchor = isWallAnchor(item.wallAnchor) ? item.wallAnchor : undefined
      base.storedItems.push({
        uid: typeof item.uid === 'string' && item.uid ? item.uid : newItemUid(),
        kind: item.kind,
        x: item.x,
        z: item.z,
        rot: isFinitePoint(item.rot) ? item.rot : 0,
        ...(wallAnchor ? { wallAnchor } : {}),
        tint: typeof item.tint === 'string' ? item.tint : undefined,
      })
    }
  }

  const rawWorlds = record.worlds as Record<string, unknown> | undefined
  if (rawWorlds && typeof rawWorlds === 'object') {
    for (const id of Object.keys(base.worlds) as RoomLayoutId[]) {
      const rawWorld = rawWorlds[id]
      if (!rawWorld || typeof rawWorld !== 'object') continue
      const normalized = normalizeRoom({ ...rawWorld, activeLayoutId: id, version: sourceVersion })
      base.worlds[id] = {
        floor: normalized.floor,
        wall: normalized.wall,
        mood: normalized.mood,
        items: normalized.items.filter((item) => !isSharedWorldItem(item)),
        storedItems: normalized.storedItems.filter((item) => !isSharedWorldItem(item)),
      }
    }
  }

  const introDone = record.introDone === true
  const rawStations = record.stations as Record<string, unknown> | undefined
  if (rawStations && typeof rawStations === 'object') {
    for (const id of ['avatar', 'room', 'explore', 'mission'] as StationId[]) {
      const spot = rawStations[id] as Record<string, unknown> | undefined
      if (!spot || typeof spot !== 'object') continue
      if (!isFinitePoint(spot.x) || !isFinitePoint(spot.z)) continue
      base.stations[id] = {
        x: spot.x,
        z: spot.z,
        rot: isFinitePoint(spot.rot) ? spot.rot : DEFAULT_STATIONS[id].rot,
        placed: typeof spot.placed === 'boolean' ? spot.placed : introDone,
      }
    }
  }
  // Designs saved before station placement existed had no `placed` field.
  // Completed introductions must keep both established design stations visible.
  if (introDone) {
    base.stations.avatar.placed = true
    base.stations.room.placed = true
  }
  base.introDone = introDone
  base.tutorialDone = record.tutorialDone === true
  if (sourceVersion < 4) {
    const appendDefaults = (items: RoomItem[]) => {
      const existing = new Set(items.map((item) => item.uid))
      return [...items, ...ADVENTURE_PARK_DEFAULT_ITEMS.filter((item) => !existing.has(item.uid)).map((item) => ({ ...item }))]
    }
    base.worlds.adventurePark.items = appendDefaults(base.worlds.adventurePark.items)
    if (base.activeLayoutId === 'adventurePark') base.items = appendDefaults(base.items)
  }
  if (sourceVersion < 5) {
    const appendDefaults = (items: RoomItem[]) => {
      const existing = new Set(items.map((item) => item.uid))
      return [...items, ...SPORTS_ARENA_DEFAULT_ITEMS.filter((item) => !existing.has(item.uid)).map((item) => ({ ...item }))]
    }
    base.worlds.sportsArena.items = appendDefaults(base.worlds.sportsArena.items)
    if (base.activeLayoutId === 'sportsArena') base.items = appendDefaults(base.items)
  }
  if (sourceVersion < 6) {
    const appendDefaults = (items: RoomItem[]) => {
      const existing = new Set(items.map((item) => item.uid))
      return [...items, ...CREATOR_LOFT_DEFAULT_ITEMS.filter((item) => !existing.has(item.uid)).map((item) => ({ ...item }))]
    }
    base.worlds.creatorLoft.items = appendDefaults(base.worlds.creatorLoft.items)
    if (base.activeLayoutId === 'creatorLoft') base.items = appendDefaults(base.items)
  }
  // Version 1/2 had one traveling design. Preserve it in the world where the
  // learner last used it; all other new worlds begin as clean canvases.
  if (!rawWorlds) base.worlds[base.activeLayoutId] = activeWorldSnapshot(base)
  base.version = 6
  return base
}

/** Layout equality, used for the unsaved-changes guard. */
export function sameRoom(a: RoomDesign, b: RoomDesign): boolean {
  if (a.activeLayoutId !== b.activeLayoutId) return false
  if (JSON.stringify(syncActiveWorld(a).worlds) !== JSON.stringify(syncActiveWorld(b).worlds)) return false
  if (a.floor !== b.floor || a.wall !== b.wall || a.mood !== b.mood) return false
  if (a.introDone !== b.introDone || a.tutorialDone !== b.tutorialDone) return false
  for (const id of ['avatar', 'room', 'explore', 'mission'] as StationId[]) {
    if (Math.abs(a.stations[id].x - b.stations[id].x) > 0.001) return false
    if (Math.abs(a.stations[id].z - b.stations[id].z) > 0.001) return false
    if (Math.abs(a.stations[id].rot - b.stations[id].rot) > 0.001) return false
    if (Math.abs(a.stations[id].rot - b.stations[id].rot) > 0.001) return false
    if (a.stations[id].placed !== b.stations[id].placed) return false
  }
  if (a.items.length !== b.items.length) return false
  for (let i = 0; i < a.items.length; i++) {
    const x = a.items[i]
    const y = b.items[i]
    if (x.uid !== y.uid || x.kind !== y.kind || x.tint !== y.tint) return false
    if (x.wallAnchor?.wallId !== y.wallAnchor?.wallId || x.wallAnchor?.offset !== y.wallAnchor?.offset || x.wallAnchor?.height !== y.wallAnchor?.height) return false
    // Sub-millimetre drift is not a change the learner made.
    if (Math.abs(x.x - y.x) > 0.001 || Math.abs(x.z - y.z) > 0.001 || Math.abs(x.rot - y.rot) > 0.001) return false
  }
  if (a.storedItems.length !== b.storedItems.length) return false
  for (let i = 0; i < a.storedItems.length; i++) {
    const x = a.storedItems[i]
    const y = b.storedItems[i]
    if (x.uid !== y.uid || x.kind !== y.kind || x.tint !== y.tint) return false
    if (x.wallAnchor?.wallId !== y.wallAnchor?.wallId || x.wallAnchor?.offset !== y.wallAnchor?.offset || x.wallAnchor?.height !== y.wallAnchor?.height) return false
    if (Math.abs(x.x - y.x) > 0.001 || Math.abs(x.z - y.z) > 0.001 || Math.abs(x.rot - y.rot) > 0.001) return false
  }
  return true
}
