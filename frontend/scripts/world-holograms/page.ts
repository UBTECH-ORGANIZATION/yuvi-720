/* The page `render-world-holograms.mjs` drives. It builds each world's
 * projection with the real builders, poses it frame by frame through one
 * full turn and stacks the frames into a vertical strip, so the shipped WebP
 * is what the live picker used to draw — only the encoding differs. */
import * as THREE from 'three'
import {
  buildLockHologram, buildPadHologram, buildWorldHologram, disposeWorldHologram, poseWorldFrame, worldHologramCamera,
} from '../../src/features/Yuvi-studio/worldHolograms'
import { WORLD_HOLOGRAM_FRAME, WORLD_HOLOGRAM_FRAMES, WORLD_HOLOGRAM_IDS } from '../../src/features/Yuvi-studio/worldHologramStrips'
import { probeGpu } from '../../src/features/Yuvi-studio/renderTier'
import type { RoomLayoutId } from '../../src/features/Yuvi-studio/RoomLayouts'

interface Rendered { dataUrl: string; width: number; height: number }

const { width: W, height: H } = WORLD_HOLOGRAM_FRAME

let shared: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null
function acquire() {
  if (shared) return shared
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(W, H, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const camera = worldHologramCamera(W / H)
  shared = { renderer, scene, camera }
  return shared
}

async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Rendered> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
  if (!blob) throw new Error('toBlob returned nothing')
  if (blob.type !== 'image/webp') throw new Error(`browser encoded ${blob.type}, not image/webp`)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  const image = new Image()
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = dataUrl })
  return { dataUrl, width: image.naturalWidth, height: image.naturalHeight }
}

/** One world: `WORLD_HOLOGRAM_FRAMES` frames of a full turn, stacked. */
async function renderStrip(id: RoomLayoutId, quality: number): Promise<Rendered> {
  if (!WORLD_HOLOGRAM_IDS.includes(id)) throw new Error(`no world ${id}`)
  const { renderer, scene, camera } = acquire()
  const world = buildWorldHologram(id)
  scene.add(world.group)
  const strip = document.createElement('canvas')
  strip.width = W
  strip.height = H * WORLD_HOLOGRAM_FRAMES
  const context = strip.getContext('2d')!
  try {
    for (let frame = 0; frame < WORLD_HOLOGRAM_FRAMES; frame++) {
      poseWorldFrame(world, frame, WORLD_HOLOGRAM_FRAMES)
      renderer.render(scene, camera)
      context.drawImage(renderer.domElement, 0, frame * H)
    }
  } finally {
    scene.remove(world.group)
    disposeWorldHologram(world.group)
  }
  return encode(strip, quality)
}

/** One still of `root` through the picker's camera. */
async function renderStill(root: THREE.Object3D, quality: number): Promise<Rendered> {
  const { renderer, scene, camera } = acquire()
  scene.add(root)
  const frame = document.createElement('canvas')
  frame.width = W
  frame.height = H
  try {
    renderer.render(scene, camera)
    frame.getContext('2d')!.drawImage(renderer.domElement, 0, 0)
  } finally {
    scene.remove(root)
    disposeWorldHologram(root)
  }
  return encode(frame, quality)
}

/** The two stills: the pad under every world (beam, ring and scan rings)
 *  and the padlock where it hung over a locked projection. */
function renderNamedStill(name: 'pad' | 'lock', quality: number): Promise<Rendered> {
  if (name === 'pad') return renderStill(buildPadHologram(), quality)
  const lock = buildLockHologram()
  // Same rise as the projection it floated over.
  lock.position.y += -2.45 + 2.78
  return renderStill(lock, quality)
}

declare global {
  interface Window {
    __worldIds: () => readonly string[]
    __geometry: () => { frames: number; width: number; height: number }
    __renderStrip: typeof renderStrip
    __renderStill: typeof renderNamedStill
    __gpu: () => string | null
  }
}
window.__worldIds = () => WORLD_HOLOGRAM_IDS
window.__geometry = () => ({ frames: WORLD_HOLOGRAM_FRAMES, width: W, height: H })
window.__renderStrip = renderStrip
window.__renderStill = renderNamedStill
window.__gpu = probeGpu
