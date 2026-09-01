/* The intro animation's timing, split out from `YuviRobot3D` so the mapping
   page can await it without importing the renderer — and with it, all of
   Three.js — into the entry chunk. */

const INTRO_ENTRANCE_DURATION = 5.7
const INTRO_TURN_DELAY = 0.5
const INTRO_TURN_DURATION = 0.9
const INTRO_READY_BUFFER = 0.12

export const Yuvi_INTRO_READY_DELAY_MS = Math.ceil(
  (INTRO_ENTRANCE_DURATION + INTRO_TURN_DELAY + INTRO_TURN_DURATION + INTRO_READY_BUFFER) * 1000
)
