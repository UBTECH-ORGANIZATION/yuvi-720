import type { ProgressionStatus, RoadmapLevel } from '../../services/progression'

/* The roadmap's geometry and arithmetic, with no DOM and no Three.js: where
   each level sits on the road, how far the road is lit, which level the
   scroll position is looking at. `tests/roadmap.test.ts` exercises this
   directly; the scene and the page only draw what it says. */

/** Scroll pixels between two neighbouring levels. One wheel notch is about
 *  a sixth of a level, so a flick travels a few pads and the snap settles on
 *  one; the whole fifty-level road is about thirty screens. */
export const SEGMENT_PX = 640
/** World units the road travels forward (−z) per level. */
export const LEVEL_SPACING = 5.6
/** World units the road climbs per level: a long, steady ascent rather than
 *  a staircase, so the camera looks slightly up the road at all times. */
export const CLIMB_PER_LEVEL = 1.1
/** Half-width of the serpentine. Wide enough that the road visibly sweeps
 *  under the camera as it scrolls, narrow enough that the next pad is always
 *  in frame. */
export const SWAY = 4.4
/** Levels per full left-right-left cycle of the serpentine. */
export const SWAY_PERIOD = 7

export interface Vec3 { x: number; y: number; z: number }

/** Where level `index` (0-based; fractions land between two pads) sits. */
export function anchorAt(index: number): Vec3 {
  const phase = (index / SWAY_PERIOD) * Math.PI * 2
  return { x: Math.sin(phase) * SWAY, y: index * CLIMB_PER_LEVEL, z: index * -LEVEL_SPACING + 0 }
}

/** Every tenth level is a larger milestone station. World unlocks (10, 20)
 *  matter most; the prestige tens keep the rhythm going to the cap. */
export const isMilestone = (level: number) => level % 10 === 0

export type LevelState = 'reached' | 'current' | 'locked'

export function levelState(level: number, status: ProgressionStatus): LevelState {
  if (level < status.level) return 'reached'
  if (level === status.level) return 'current'
  return 'locked'
}

/** XP still missing before `row` opens; 0 once it has. */
export function xpAway(row: RoadmapLevel, status: ProgressionStatus): number {
  return Math.max(0, row.startXp - status.totalXp)
}

/** The learner's place on the road as a continuous level index: the current
 *  pad plus the fraction of the way to the next one. The cap has no next pad. */
export function positionIndex(status: ProgressionStatus, levelCount: number): number {
  const fraction = status.nextLevel ? Math.max(0, Math.min(1, status.progress)) : 0
  return Math.max(0, Math.min(levelCount - 1, status.level - 1 + fraction))
}

/** CSS block position for the vertical rail: the first level grows from the
 *  bottom (100%) and the final level finishes at the top (0%). */
export function railVisualPosition(index: number, levelCount: number): number {
  const clamped = Math.max(0, Math.min(levelCount - 1, index))
  return 1 - clamped / Math.max(1, levelCount - 1)
}

export function yuviPosition(status: ProgressionStatus, levelCount: number, focus = status.level - 1, rtl = false): Vec3 {
  const index = focusedIndex(focus, levelCount)
  const anchor = anchorAt(index)
  const locked = index + 1 > status.level
  const beside = isMilestone(index + 1) ? 3.1 : 2.35
  return {
    x: anchor.x + (locked ? beside * (rtl ? -1 : 1) : 0),
    y: anchor.y + (locked ? 0.65 : 0.07),
    z: anchor.z + 0.8,
  }
}

export function createYuviFlight(initial: Vec3) {
  const position = { ...initial }
  const velocity = { x: 0, y: 0, z: 0 }
  let origin = { ...initial }
  let destination = { ...initial }
  let initialVelocity = { ...velocity }
  let elapsed = 0
  let duration = 1
  let height = 0
  let yaw = 0
  let startYaw = 0
  let endYaw = 0
  let bank = 0
  let startBank = 0
  let active = false
  return {
    position,
    get active() { return active },
    get yaw() { return yaw },
    get bank() { return bank },
    retarget(next: Vec3, spin = 0, reduceMotion = false) {
      if (reduceMotion) {
        Object.assign(position, next)
        Object.assign(velocity, { x: 0, y: 0, z: 0 })
        destination = { ...next }
        yaw = bank = 0
        active = false
        return
      }
      if (next.x === destination.x && next.y === destination.y && next.z === destination.z) return
      origin = { ...position }
      destination = { ...next }
      initialVelocity = { ...velocity }
      const distance = Math.hypot(next.x - origin.x, next.y - origin.y, next.z - origin.z)
      duration = Math.min(1.5, 0.65 + distance * 0.045)
      height = Math.min(2, 0.65 + distance * 0.08)
      startYaw = yaw
      endYaw = Math.round(yaw / (Math.PI * 2)) * Math.PI * 2 + spin * Math.PI * 2
      startBank = bank
      elapsed = 0
      active = true
    },
    update(dt: number) {
      if (!active) return
      elapsed = Math.min(duration, elapsed + Math.max(0, dt))
      const progress = elapsed / duration
      const eased = progress * progress * (3 - 2 * progress)
      const tangent = progress * (1 - progress) ** 2
      const arch = 16 * progress ** 2 * (1 - progress) ** 2
      for (const axis of ['x', 'y', 'z'] as const) {
        const delta = destination[axis] - origin[axis]
        position[axis] = origin[axis] + delta * eased + initialVelocity[axis] * duration * tangent
          + (axis === 'y' ? height * arch : 0)
        velocity[axis] = delta * 6 * progress * (1 - progress) / duration
          + initialVelocity[axis] * (1 - 4 * progress + 3 * progress ** 2)
          + (axis === 'y' ? height * 32 * progress * (1 - progress) * (1 - 2 * progress) / duration : 0)
      }
      yaw = startYaw + (endYaw - startYaw) * eased
      bank = startBank * (1 - eased) - Math.tanh((destination.x - origin.x) / 5) * arch * 0.18
      if (elapsed === duration) {
        Object.assign(position, destination)
        Object.assign(velocity, { x: 0, y: 0, z: 0 })
        yaw = bank = 0
        active = false
      }
    },
  }
}

export function idleBreakerPose(seconds: number, reduceMotion = false) {
  const phase = Math.max(0, seconds) % 18
  const envelope = (start: number, duration: number) => {
    const progress = (phase - start) / duration
    return progress > 0 && progress < 1 ? Math.sin(Math.PI * progress) ** 2 : 0
  }
  const look = reduceMotion ? 0 : envelope(1, 4)
  const wave = reduceMotion ? 0 : envelope(7, 3)
  const stretch = reduceMotion ? 0 : envelope(12, 4)
  return {
    headYaw: look ? look * Math.sin((phase - 1) * Math.PI / 2) * 0.4 : 0,
    headPitch: stretch ? -stretch * 0.12 : 0,
    headRoll: wave * 0.09,
    leftArm: -0.095 - stretch * 2.4,
    rightArm: 0.095 + stretch * 2.4 + wave * (2.2 + Math.sin(phase * 8) * 0.18),
  }
}

/** How much of the road, start to finish, is lit: everything travelled plus
 *  the part-way to the next level. */
export function litFraction(status: ProgressionStatus, levelCount: number): number {
  return levelCount > 1 ? positionIndex(status, levelCount) / (levelCount - 1) : 1
}

/** Height of the scrollable track: one segment per gap between levels, plus
 *  a viewport so the last pad can be scrolled to the same place as the rest. */
export function trackHeight(levelCount: number, viewportHeight: number): number {
  return Math.max(0, levelCount - 1) * SEGMENT_PX + viewportHeight
}

/** Scroll offset → continuous level index. */
export function progressForScroll(scrollTop: number, maxScroll: number, levelCount: number): number {
  if (maxScroll <= 0 || levelCount <= 1) return 0
  return Math.max(0, Math.min(1, scrollTop / maxScroll)) * (levelCount - 1)
}

/** Continuous level index → scroll offset. */
export function scrollForIndex(index: number, maxScroll: number, levelCount: number): number {
  if (levelCount <= 1) return 0
  return (Math.max(0, Math.min(levelCount - 1, index)) / (levelCount - 1)) * maxScroll
}

/** The pad the camera is nearest to — the one whose items are up. */
export function focusedIndex(progress: number, levelCount: number): number {
  return Math.max(0, Math.min(levelCount - 1, Math.round(progress)))
}

/** Where a pad's items hover once they have popped up, as offsets from the
 *  pad centre: side by side across the road, the outer ones a touch further
 *  back so four of them read as an arc rather than a fence. A headline (a
 *  whole world) takes the crown above the row instead of a place in it. */
export function itemSlots(count: number, headline = false): Vec3[] {
  const row = headline ? count - 1 : count
  const spacing = row > 3 ? 1.12 : 1.3
  const slots = Array.from({ length: row }, (_, i) => {
    const across = (i - (row - 1) / 2) * spacing
    return { x: across, y: 1.55 + Math.abs(across) * 0.05, z: -Math.abs(across) * 0.22 }
  })
  return headline ? [{ x: 0, y: 2.75, z: -0.35 }, ...slots] : slots
}
