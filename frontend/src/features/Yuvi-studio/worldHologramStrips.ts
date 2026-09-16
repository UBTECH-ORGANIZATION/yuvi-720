/* Pre-rendered world holograms for the Room panel's world picker.
 *
 * Each world's projection is baked once, by a developer on a real GPU, into a
 * vertical WebP sprite strip: `WORLD_HOLOGRAM_FRAMES` frames of one full turn,
 * top to bottom, at `WORLD_HOLOGRAM_FRAME` device pixels each, over a pad
 * still shared by all four. The picker shows one frame at a time and steps
 * through the strip in CSS, so the four spinning worlds cost the client no
 * WebGL context and no render loop — the same trade the catalogue thumbnails
 * made (`studioThumbs.ts`).
 *
 * `node scripts/render-world-holograms.mjs` re-bakes them when
 * `worldHolograms.ts` changes; `tests/world-holograms.test.ts` fails when a
 * world has no strip. No three.js import here: this is what the studio
 * chunk carries. */
import type { RoomLayoutId } from './RoomLayouts'

export const WORLD_HOLOGRAM_IDS: readonly RoomLayoutId[] = ['lab', 'adventurePark', 'sportsArena', 'creatorLoft']

/** Frames per turn. 7.5° apart: enough for the cross-faded steps to read as
 *  one slow rotation, few enough that four strips weigh what a handful of
 *  catalogue cards do. */
export const WORLD_HOLOGRAM_FRAMES = 48
/** One frame, in device pixels — 1.5× the 168×104 hologram box of a card. */
export const WORLD_HOLOGRAM_FRAME = { width: 252, height: 156 } as const

// Vite resolves the glob at build time; under plain node (the tests import
// the constants above) there is no glob and no files, which is fine.
function registry(): Record<string, string> {
  try {
    return import.meta.glob<string>('../../assets/world-holograms/*.webp', {
      eager: true,
      query: '?no-inline',
      import: 'default',
    })
  } catch {
    return {}
  }
}
const files = registry()

/** The hashed URL of a world's strip, or `undefined` before the script has
 *  been run for it (the card then shows no projection, only its name). */
export function worldHologramStrip(id: RoomLayoutId): string | undefined {
  return files[`../../assets/world-holograms/${id}.webp`]
}

/** The pad every projection stands on — beam, ring, scan rings — the same in
 *  every frame of a turn, so baked once and layered under the strip. */
export function worldHologramPad(): string | undefined {
  return files['../../assets/world-holograms/pad.webp']
}

/** The padlock overlay for a world the learner has not unlocked. */
export function worldHologramLock(): string | undefined {
  return files['../../assets/world-holograms/lock.webp']
}
