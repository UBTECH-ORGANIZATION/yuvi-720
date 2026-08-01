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

export interface RoomDesign {
  version: number
  floor: RoomStyleId
  wall: WallStyleId
  mood: MoodId
  items: RoomItem[]
}

export const ROOM_STYLES: RoomStyleId[] = ['lab', 'wood', 'carpet', 'meadow', 'court']
export const WALL_STYLES: WallStyleId[] = ['lab', 'warm', 'sky', 'forest', 'space']
export const MOODS: MoodId[] = ['studio', 'sunset', 'night', 'party']

/** Hard cap. A room full of 200 props is not a design, it is a frame-rate bug. */
export const MAX_ROOM_ITEMS = 60

export const DEFAULT_ROOM: RoomDesign = {
  version: 1,
  floor: 'lab',
  wall: 'lab',
  mood: 'studio',
  items: [],
}

export function cloneRoom(room: RoomDesign): RoomDesign {
  return {
    version: room.version,
    floor: room.floor,
    wall: room.wall,
    mood: room.mood,
    items: room.items.map((item) => ({ ...item })),
  }
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
  return base
}

/** Layout equality, used for the unsaved-changes guard. */
export function sameRoom(a: RoomDesign, b: RoomDesign): boolean {
  if (a.floor !== b.floor || a.wall !== b.wall || a.mood !== b.mood) return false
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
