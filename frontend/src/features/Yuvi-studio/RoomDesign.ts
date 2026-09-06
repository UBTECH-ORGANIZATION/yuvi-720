// Room design model — mirrors the persisted `learner_state.room` shape.
//
// The learner's room is non-identifying UI state: a floor, a wall, a lighting
// mood and a list of placed props. It is deliberately a flat, serialisable
// record with no three.js types in it, so the same layout can be rendered by
// the studio, a thumbnail, or a future shared space.

export type RoomStyleId = 'lab' | 'wood' | 'carpet' | 'meadow' | 'court'
export type WallStyleId = 'lab' | 'warm' | 'sky' | 'forest' | 'space'
export type MoodId = 'studio' | 'sunset' | 'night' | 'party'

export interface RoomItem {
  /** Stable per-instance id, so two identical plants can be moved apart. */
  uid: string
  /** Catalog entry id (see RoomCatalog). */
  kind: string
  x: number
  z: number
  /** Y rotation in radians. */
  rot: number
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

export interface RoomDesign {
  version: number
  floor: RoomStyleId
  wall: WallStyleId
  mood: MoodId
  items: RoomItem[]
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

export const DEFAULT_ROOM: RoomDesign = {
  version: 1,
  floor: 'lab',
  wall: 'lab',
  mood: 'studio',
  items: [],
  stations: DEFAULT_STATIONS,
  introDone: false,
  tutorialDone: false,
}

export function cloneRoom(room: RoomDesign): RoomDesign {
  return {
    version: room.version,
    floor: room.floor,
    wall: room.wall,
    mood: room.mood,
    items: room.items.map((item) => ({ ...item })),
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

/** Coerce whatever came back from the API into a safe, complete room. */
export function normalizeRoom(raw: unknown): RoomDesign {
  const base = cloneRoom(DEFAULT_ROOM)
  if (!raw || typeof raw !== 'object') return base
  const record = raw as Record<string, unknown>

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
      base.items.push({
        uid: typeof item.uid === 'string' && item.uid ? item.uid : newItemUid(),
        kind: item.kind,
        x: item.x,
        z: item.z,
        rot: isFinitePoint(item.rot) ? item.rot : 0,
        tint: typeof item.tint === 'string' ? item.tint : undefined,
      })
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
  return base
}

/** Layout equality, used for the unsaved-changes guard. */
export function sameRoom(a: RoomDesign, b: RoomDesign): boolean {
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
    // Sub-millimetre drift is not a change the learner made.
    if (Math.abs(x.x - y.x) > 0.001 || Math.abs(x.z - y.z) > 0.001 || Math.abs(x.rot - y.rot) > 0.001) return false
  }
  return true
}
