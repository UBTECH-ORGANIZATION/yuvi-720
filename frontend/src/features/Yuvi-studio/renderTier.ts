/* Render tiers for the Yuvi avatar and the lab room.
 *
 * The old probe (`detectLabQuality`) looked at RAM and cores only, so an 8 GB
 * school PC with an Intel UHD 620 was told it was "high" and asked to shade
 * fourteen realtime lights through physical materials at DPR 2. The GPU is
 * the thing that decides frame time; this asks it by name, then lets an FPS
 * governor correct the guess from what the frames actually cost.
 *
 * Three tiers, one rule: `high` is exactly today's look. Only `medium` and
 * `low` change anything.
 *
 * No Three.js import here on purpose: the companion dock (main chunk) asks
 * for the tier to decide whether to mount a WebGL avatar at all.
 */
import { useSyncExternalStore } from 'react'

export type RenderTier = 'low' | 'medium' | 'high'
/** What a caller may ask for: a fixed tier, or "work it out". */
export type RenderTierChoice = RenderTier | 'auto'

const ORDER: RenderTier[] = ['low', 'medium', 'high']
const rank = (tier: RenderTier) => ORDER.indexOf(tier)
export const lowerTier = (a: RenderTier, b: RenderTier): RenderTier => (rank(a) <= rank(b) ? a : b)

/* ── localStorage: a device-capability cache, not learner state ──────────
   The app-wide rule (see ThemeProvider) is that nothing learner-shaped lives in
   the browser: preferences, progress, identity all go through the backend.
   These two keys are about the MACHINE, not the child. The same learner uses
   a school PC in the morning and a home laptop at night, and the school PC's
   "this GPU cannot keep 30 fps with shadows" must not follow them home — so it
   is stored where the GPU is. Clearing site data costs one governor warm-up. */
const STORED_KEY = 'spark.renderTier.v1'      // governor-confirmed tier for this device
// Developer override only (the thumbnail render page sets it). The toolbar
// toggle that used to write the old key is gone: a forced 'low' hid the
// room's props and read as "things don't render". New key so a value left
// behind by that toggle is ignored.
const FORCED_KEY = 'spark.renderTier.override'

const isTier = (value: unknown): value is RenderTier =>
  value === 'low' || value === 'medium' || value === 'high'

function readKey(key: string): RenderTier | null {
  try {
    const value = window.localStorage.getItem(key)
    return isTier(value) ? value : null
  } catch {
    return null
  }
}
function writeKey(key: string, tier: RenderTier | null) {
  try {
    if (tier) window.localStorage.setItem(key, tier)
    else window.localStorage.removeItem(key)
  } catch {
    // Private mode / storage disabled: the session just re-detects next time.
  }
  notify()
}

export const readStoredTier = () => readKey(STORED_KEY)
export const storeTier = (tier: RenderTier) => writeKey(STORED_KEY, tier)
export const readForcedTier = () => readKey(FORCED_KEY)
export const storeForcedTier = (tier: RenderTier | null) => writeKey(FORCED_KEY, tier)

/* ── GPU probe ───────────────────────────────────────────────────────────── */

let probedGpu: string | null | undefined

/** The unmasked renderer string ("ANGLE (Intel, Intel(R) UHD Graphics 620 …)"),
 *  from a throwaway context that is handed back immediately — browsers cap
 *  live contexts at ~16 and the studio needs its own. Probed once per page. */
export function probeGpu(): string | null {
  if (probedGpu !== undefined) return probedGpu
  probedGpu = null
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return null
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    probedGpu = typeof name === 'string' ? name.slice(0, 80) : null
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    probedGpu = null
  }
  return probedGpu
}

/** Software rasterisers and the integrated parts that ship in school PCs. */
const LOW_GPUS: RegExp[] = [
  /swiftshader/i,
  /llvmpipe|softpipe|mesa offscreen/i,
  /microsoft basic render/i,
  // Intel HD 4000–630 and every "UHD Graphics" that is not 7xx / Xe. The bare
  // "Intel(R) UHD Graphics" string is the 620/630 family under a newer driver.
  /intel(?:\(r\))?\s+(?:hd|uhd)\s+graphics(?!.*\b(?:7\d\d|xe)\b)/i,
  /\bmali-(?:4\d\d|t\d{3})\b/i,
  /\badreno\s*(?:\(tm\))?\s*[1-5]\d\d\b/i,
  /\bgeforce\s+(?:gts?\s+|gtx\s+)?[2-9]\d\d(?!\d)/i,
]

/** Capable, but not what the high tier was tuned on. */
const MID_GPUS: RegExp[] = [
  /\biris\b/i,                       // Iris Plus / Iris Xe
  /\bvega\b/i,
  /intel(?:\(r\))?\s+uhd\s+graphics\s+7\d\d/i,
]

export interface TierDetection {
  tier: RenderTier
  /** Why, in one token — grouped on in telemetry to tune the lists above. */
  reason: string
  gpu: string | null
  deviceMemory: number | null
  cores: number | null
}

let detected: TierDetection | undefined

/** Decide a tier from what the device says about itself. Cached: the GPU does
 *  not change during a session, and the probe opens a WebGL context. */
export function detectRenderTier(): TierDetection {
  if (detected) return detected
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number }
  const deviceMemory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null
  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null
  const gpu = probeGpu()
  const base = { gpu, deviceMemory, cores }
  const pick = (tier: RenderTier, reason: string): TierDetection => (detected = { tier, reason, ...base })

  if (typeof window === 'undefined') return pick('low', 'ssr')
  if (!gpu && !supportsWebGL()) return pick('low', 'no-webgl')
  if (gpu && LOW_GPUS.some((re) => re.test(gpu))) return pick('low', 'gpu-low')
  if (deviceMemory !== null && deviceMemory <= 4) return pick('low', 'memory')
  if (cores !== null && cores <= 2) return pick('low', 'cores')
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return pick('medium', 'reduced-motion')
  if (gpu && MID_GPUS.some((re) => re.test(gpu))) return pick('medium', 'gpu-mid')
  if (cores !== null && cores <= 4) return pick('medium', 'cores')
  return pick('high', 'default')
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export interface ResolvedTier {
  /** What the avatar mounts with. */
  final: RenderTier
  /** The governor may never raise above this. */
  ceiling: RenderTier
  detected: RenderTier
  stored: RenderTier | null
  forced: RenderTier | null
  reason: string
  gpu: string | null
  deviceMemory: number | null
  cores: number | null
}

/** forced prop > developer override > governor-stored tier > detection. A
 *  `performanceMode === 'low'` caller (the learning track's mascot) is clamped
 *  to low whatever the device — that prop meant "cheap" before tiers existed. */
export function resolveRenderTier(choice: RenderTierChoice = 'auto', clampLow = false): ResolvedTier {
  const detection = detectRenderTier()
  const stored = readStoredTier()
  const forced = choice !== 'auto' ? choice : readForcedTier()
  let final: RenderTier = forced ?? stored ?? detection.tier
  let reason = forced ? 'forced' : stored ? 'stored' : detection.reason
  if (clampLow) { final = 'low'; reason = 'performance-mode' }
  return {
    final,
    // A forced tier is the learner's word; otherwise never climb past the probe.
    ceiling: forced ?? detection.tier,
    detected: detection.tier,
    stored,
    forced,
    reason,
    gpu: detection.gpu,
    deviceMemory: detection.deviceMemory,
    cores: detection.cores,
  }
}

/* ── React: the tier as an external store ────────────────────────────────── */

const listeners = new Set<() => void>()
function notify() { for (const fn of listeners) fn() }
function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
const snapshot = () => resolveRenderTier().final

/** The tier the page's avatars should mount with. Re-renders when the governor
 *  stores a new tier or the studio toggle changes, so the companion dock can
 *  swap to its 2D fallback the moment a device turns out to be low. */
export function useRenderTier(): RenderTier {
  return useSyncExternalStore(subscribe, snapshot, () => 'high')
}

/* ── What each tier renders ──────────────────────────────────────────────── */

export interface TierSettings {
  /** `renderer.setPixelRatio(min(devicePixelRatio, cap))`. */
  pixelRatioCap: number
  antialias: boolean
  /** The room's one shadow map. */
  shadows: boolean
  fog: boolean
  /** Ambient dust motes in the room. */
  motes: number
  /** `MeshPhysicalMaterial` (clearcoat, sheen) vs plain `MeshStandardMaterial`. */
  physicalMaterials: boolean
  powerPreference: WebGLPowerPreference
}

/** `mainContent` = the avatar IS the page (the studio). Everything else — the
 *  dock, the track mascot, the tour guide — asks for the low-power GPU so a
 *  dual-GPU laptop does not spin up its discrete card for a 96 px robot. */
export function tierSettings(tier: RenderTier, mainContent: boolean): TierSettings {
  const powerPreference: WebGLPowerPreference = mainContent ? 'high-performance' : 'low-power'
  if (tier === 'low') {
    return { pixelRatioCap: 1, antialias: false, shadows: false, fog: false, motes: 0, physicalMaterials: false, powerPreference }
  }
  if (tier === 'medium') {
    return { pixelRatioCap: 1.5, antialias: true, shadows: false, fog: true, motes: 60, physicalMaterials: true, powerPreference }
  }
  // Today's values, exactly.
  return { pixelRatioCap: 2, antialias: true, shadows: true, fog: true, motes: 170, physicalMaterials: true, powerPreference }
}

/* ── FPS governor ────────────────────────────────────────────────────────── */

export interface FpsGovernor {
  /** Feed every rendered frame: its cost in ms and the frame timestamp. */
  sample: (frameMs: number, now: number) => void
  readonly tier: RenderTier
}

const WARMUP_MS = 1500        // shader compiles and first-frame uploads are not the steady state
const IGNORE_ABOVE_MS = 250   // a tab switch, a GC pause, a debugger — not a frame
const WINDOW = 60
const EVAL_EVERY_MS = 500
const SLOW_MEDIAN_MS = 24     // under ~40 fps for…
const SLOW_FOR_MS = 2000      // …two seconds: drop a tier
const FAST_MEDIAN_MS = 12     // over ~80 fps for…
const FAST_FOR_MS = 10000     // …ten seconds: try one tier up, once

/** Watches the median frame time and moves the tier when the guess was wrong.
 *  Drops are quick (a slideshow is the complaint); a raise happens once, one
 *  step, never above `ceiling` — three recompiles every program when the light
 *  count changes, so the governor must decide, not flap. */
export function createFpsGovernor({ initial, ceiling, onChange }: {
  initial: RenderTier
  ceiling: RenderTier
  onChange: (next: RenderTier, previous: RenderTier, medianMs: number) => void
}): FpsGovernor {
  let tier = initial
  let startedAt = -1
  let lastEval = 0
  let slowSince = -1
  let fastSince = -1
  let raised = false
  const frames: number[] = []

  const reset = () => { frames.length = 0; slowSince = -1; fastSince = -1 }
  const move = (next: RenderTier, median: number) => {
    const previous = tier
    tier = next
    reset()
    startedAt = -1   // a tier change recompiles programs: warm up again
    onChange(next, previous, median)
  }

  return {
    get tier() { return tier },
    sample(frameMs, now) {
      if (typeof document !== 'undefined' && document.hidden) { reset(); return }
      if (frameMs > IGNORE_ABOVE_MS) return
      if (startedAt < 0) { startedAt = now; return }
      if (now - startedAt < WARMUP_MS) return
      frames.push(frameMs)
      if (frames.length > WINDOW) frames.shift()
      if (now - lastEval < EVAL_EVERY_MS || frames.length < WINDOW / 2) return
      lastEval = now
      const sorted = [...frames].sort((a, b) => a - b)
      const median = sorted[sorted.length >> 1]
      if (median > SLOW_MEDIAN_MS) {
        fastSince = -1
        if (slowSince < 0) slowSince = now
        else if (now - slowSince >= SLOW_FOR_MS && tier !== 'low') move(ORDER[rank(tier) - 1], median)
      } else if (median < FAST_MEDIAN_MS) {
        slowSince = -1
        if (fastSince < 0) fastSince = now
        else if (now - fastSince >= FAST_FOR_MS && !raised && rank(tier) < rank(ceiling)) {
          raised = true
          move(ORDER[rank(tier) + 1], median)
        }
      } else {
        slowSince = -1
        fastSince = -1
      }
    },
  }
}
