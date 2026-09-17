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

/** Every tenth level is a gate: a wider pad under a standing ring. The world
 *  unlocks (10, 20) are the ones that matter most; the prestige tens keep the
 *  rhythm going to the cap. */
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
