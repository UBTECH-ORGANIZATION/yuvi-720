// Room design model — mirrors the persisted `learner_state.room` shape.
//
// The learner's room is non-identifying UI state: a floor, a wall, a lighting
// mood and a list of placed props. It is deliberately a flat, serialisable
// record with no three.js types in it, so the same layout can be rendered by
// the studio, a thumbnail, or a future shared space.

import { normalizeRoomLayoutId, type RoomLayoutId } from './RoomLayouts.ts'
import { SPORTS_ARTWORK_KINDS } from './SportsArenaCatalog.ts'
import { addMissingSportsStarters, type BoundsFor } from './SportsArenaMigration.ts'
import { reconcilePlayground } from './PlaygroundMigration.ts'
import { PLAYGROUND_EDITABLE_DEFAULTS } from './PlaygroundItems.ts'

export type RoomStyleId = 'lab' | 'wood' | 'carpet' | 'meadow' | 'court'
export type WallStyleId = 'lab' | 'warm' | 'sky' | 'forest' | 'space'
export type MoodId = 'studio' | 'sunset' | 'night' | 'party'
export type GamingRoomTitleId = 'gaming' | 'babylon' | 'playground'
export const GAMING_ROOM_TITLE_IDS: GamingRoomTitleId[] = ['gaming', 'babylon', 'playground']

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
  /** The title the learner chose after entering Yubi's Gaming Room. */
  gamingRoomTitle?: GamingRoomTitleId
  sportsStarterVersion?: number
  playgroundVersion?: number
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
  { uid: 'park-bench-west', kind: 'parkBench', x: -19, z: 8, rot: Math.PI / 2 },
  ...PLAYGROUND_EDITABLE_DEFAULTS,
]

export const SPORTS_ARENA_DEFAULT_ITEMS: RoomItem[] = [
  { uid: 'arena-bench', kind: 'sportsBench', x: -16.5, z: 15, rot: Math.PI / 2 },
  { uid: 'arena-ball-rack', kind: 'sportsBallRack', x: 16.5, z: 15, rot: -Math.PI / 2 },
  { uid: 'arena-mini-goal', kind: 'sportsMiniGoal', x: 13, z: 22, rot: Math.PI },
]

export const SPORTS_ARENA_STARTER_ITEMS: RoomItem[] = [
  { uid: 'arena-dumbbell-rack', kind: 'sportsDumbbellRack', x: 12.5, z: -16.5, rot: -Math.PI / 2 },
  { uid: 'arena-squat-rack', kind: 'sportsSquatRack', x: -14.5, z: -15.5, rot: Math.PI / 2 },
  { uid: 'arena-jersey-home', kind: 'sportsJerseyDisplay', x: -24.34, z: -20, rot: Math.PI / 2, wallAnchor: { wallId: 'west', offset: (32.7 + 20) / 58.5, height: 2.6 } },
  { uid: 'arena-jersey-away', kind: 'sportsJerseyDisplay', x: 24.34, z: 27, rot: -Math.PI / 2, tint: '#287f83', wallAnchor: { wallId: 'east', offset: (27 + 25.8) / 58.5, height: 2.6 } },
  { uid: 'arena-basketball-hoop', kind: 'sportsBasketballHoop', x: 0, z: -22, rot: 0 },
  { uid: 'arena-wall-scoreboard', kind: 'sportsWallScoreboard', x: 0, z: 32.64, rot: Math.PI, wallAnchor: { wallId: 'south', offset: 0.5, height: 3 } },
  ...Object.keys(SPORTS_ARTWORK_KINDS).map((kind, index): RoomItem | null => {
    if (kind === 'sportsArtworkRunners' || kind === 'sportsArtworkStrength') return null
    const west = index < 4
    const z = [-12, -3, 8, 19][index % 4]
    if (index === 3 || index === 7) return {
      uid: `arena-art-${kind}`, kind, x: west ? -9.76 : 9.76, z: 32.64, rot: Math.PI,
      wallAnchor: { wallId: 'south', offset: west ? 0.7 : 0.3, height: 3 },
    }
    return {
      uid: `arena-art-${kind}`, kind, x: west ? -24.34 : 24.34, z, rot: west ? Math.PI / 2 : -Math.PI / 2,
      wallAnchor: { wallId: west ? 'west' : 'east', offset: west ? (32.7 - z) / 58.5 : (z + 25.8) / 58.5, height: 2.8 },
    }
  }).filter((item): item is RoomItem => item !== null),
]

export const CREATOR_LOFT_NEW_MACHINES: RoomItem[] = [
  { uid: 'loft-racing-simulator', kind: 'loftRacingSimulator', x: -8, z: -10, rot: 0 },
  { uid: 'loft-air-hockey', kind: 'loftAirHockey', x: 0, z: 13, rot: 0 },
]

export const CREATOR_LOFT_DEFAULT_ITEMS: RoomItem[] = [
  { uid: 'loft-arcade-cyan', kind: 'loftArcadeCabinet', x: -18, z: -10, rot: Math.PI / 2 },
  { uid: 'loft-claw-machine', kind: 'loftClawMachine', x: 18, z: -10, rot: -Math.PI / 2 },
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
  sportsArena: DEFAULT_WORLD([...SPORTS_ARENA_DEFAULT_ITEMS, ...SPORTS_ARENA_STARTER_ITEMS]),
  creatorLoft: DEFAULT_WORLD([...CREATOR_LOFT_DEFAULT_ITEMS, ...CREATOR_LOFT_NEW_MACHINES]),
}

export const DEFAULT_ROOM: RoomDesign = {
  version: 10,
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
      ...(world.gamingRoomTitle ? { gamingRoomTitle: world.gamingRoomTitle } : {}),
      ...(world.sportsStarterVersion ? { sportsStarterVersion: world.sportsStarterVersion } : {}),
      ...(world.playgroundVersion ? { playgroundVersion: world.playgroundVersion } : {}),
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
    ...(room.worlds[room.activeLayoutId].gamingRoomTitle ? { gamingRoomTitle: room.worlds[room.activeLayoutId].gamingRoomTitle } : {}),
    ...(room.worlds[room.activeLayoutId].sportsStarterVersion ? { sportsStarterVersion: room.worlds[room.activeLayoutId].sportsStarterVersion } : {}),
    ...(room.worlds[room.activeLayoutId].playgroundVersion ? { playgroundVersion: room.worlds[room.activeLayoutId].playgroundVersion } : {}),
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

export function moveOrRestoreRoomItem(room: RoomDesign, uid: string, patch: Partial<RoomItem>): RoomDesign {
  const stored = room.storedItems.find((item) => item.uid === uid)
  if (stored && room.items.length >= MAX_ROOM_ITEMS) return room
  return {
    ...room,
    items: stored
      ? [...room.items, { ...stored, ...patch, uid }]
      : room.items.map((item) => item.uid === uid ? { ...item, ...patch, uid } : item),
    storedItems: stored ? room.storedItems.filter((item) => item.uid !== uid) : room.storedItems,
  }
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
export function normalizeRoom(raw: unknown, options: { sportsArenaOwned?: boolean; boundsFor?: BoundsFor; nested?: boolean } = {}): RoomDesign {
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
      if (typeof item.kind !== 'string' || item.kind === 'parkCoaster') continue
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
      if (base.activeLayoutId !== 'adventurePark' && base.storedItems.length >= MAX_ROOM_ITEMS + SPORTS_ARENA_STARTER_ITEMS.length) break
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      if (typeof item.kind !== 'string' || item.kind === 'parkCoaster') continue
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
      const normalized = normalizeRoom({ ...rawWorld, activeLayoutId: id, version: sourceVersion }, { ...options, nested: true })
      base.worlds[id] = {
        floor: normalized.floor,
        wall: normalized.wall,
        mood: normalized.mood,
        items: normalized.items.filter((item) => !isSharedWorldItem(item)),
        storedItems: normalized.storedItems.filter((item) => !isSharedWorldItem(item)),
        ...([1, 2].includes((rawWorld as Record<string, unknown>).sportsStarterVersion as number)
          ? { sportsStarterVersion: (rawWorld as Record<string, unknown>).sportsStarterVersion as number } : {}),
        ...([1, 2].includes(Number((rawWorld as Record<string, unknown>).playgroundVersion))
          ? { playgroundVersion: Number((rawWorld as Record<string, unknown>).playgroundVersion) } : {}),
        ...(GAMING_ROOM_TITLE_IDS.includes((rawWorld as Record<string, unknown>).gamingRoomTitle as GamingRoomTitleId)
          ? { gamingRoomTitle: (rawWorld as Record<string, unknown>).gamingRoomTitle as GamingRoomTitleId }
          : {}),
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
  if (sourceVersion < 7) {
    const addStoredMachines = (world: Pick<RoomWorldDesign, 'items' | 'storedItems'>) => {
      const existing = new Set([...world.items, ...world.storedItems].map((item) => item.uid))
      world.storedItems = [...world.storedItems, ...CREATOR_LOFT_NEW_MACHINES.filter((item) => !existing.has(item.uid)).map((item) => ({ ...item }))]
    }
    addStoredMachines(base.worlds.creatorLoft)
    if (base.activeLayoutId === 'creatorLoft') addStoredMachines(base)
  }
  // Version 1/2 had one traveling design. Preserve it in the world where the
  // learner last used it; all other new worlds begin as clean canvases.
  if (!rawWorlds) base.worlds[base.activeLayoutId] = activeWorldSnapshot(base)
  if (!options.nested && options.sportsArenaOwned !== false && !base.worlds.sportsArena.sportsStarterVersion) {
    const boundsFor: BoundsFor = options.boundsFor ?? ((item) => ({
      radius: item.kind.startsWith('sportsArtwork') ? 3.15 : 3.7,
      height: item.kind.startsWith('sportsArtwork') ? 4.725 : 3.4,
      wall: Boolean(item.wallAnchor) || item.kind.startsWith('sportsArtwork') || item.kind.includes('JerseyDisplay') || item.kind === 'sportsWallScoreboard',
    }))
    const target = base.activeLayoutId === 'sportsArena' ? base : base.worlds.sportsArena
    addMissingSportsStarters(target, SPORTS_ARENA_STARTER_ITEMS, base.stations, boundsFor, MAX_ROOM_ITEMS)
    base.worlds.sportsArena.sportsStarterVersion = 1
    if (base.activeLayoutId === 'sportsArena') base.worlds.sportsArena = activeWorldSnapshot(base)
  }
  if (!options.nested && options.sportsArenaOwned !== false && base.worlds.sportsArena.sportsStarterVersion !== 2) {
    const target = base.activeLayoutId === 'sportsArena' ? base : base.worlds.sportsArena
    const relocated = SPORTS_ARENA_STARTER_ITEMS.filter((item) => item.wallAnchor?.wallId === 'south')
    for (const item of [...target.items, ...target.storedItems]) {
      const destination = relocated.find((starter) => starter.uid === item.uid)
      if (destination) Object.assign(item, {
        x: destination.x, z: destination.z, rot: destination.rot, wallAnchor: { ...destination.wallAnchor! },
      })
    }
    base.worlds.sportsArena.sportsStarterVersion = 2
    if (base.activeLayoutId === 'sportsArena') base.worlds.sportsArena = activeWorldSnapshot(base)
  }
  if (sourceVersion < 10) {
    const removedDefaultUids = new Set([
      'arena-training-box-low', 'arena-training-box-high',
      'arena-park-bench-west', 'arena-park-bench-east',
      'arena-art-sportsArtworkRunners', 'arena-art-sportsArtworkStrength',
      'loft-arcade-coral', 'loft-token-pusher', 'loft-vr-station',
    ])
    const removeRetiredDefaults = (world: Pick<RoomWorldDesign, 'items' | 'storedItems'>) => {
      world.items = world.items.filter((item) => !removedDefaultUids.has(item.uid))
      world.storedItems = world.storedItems.filter((item) => !removedDefaultUids.has(item.uid))
    }
    removeRetiredDefaults(base.worlds.sportsArena)
    removeRetiredDefaults(base.worlds.creatorLoft)
    if (base.activeLayoutId === 'sportsArena' || base.activeLayoutId === 'creatorLoft') removeRetiredDefaults(base)
  }
  base.version = 10
  if (!options.nested && options.boundsFor) reconcilePlayground(base, options.boundsFor)
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
