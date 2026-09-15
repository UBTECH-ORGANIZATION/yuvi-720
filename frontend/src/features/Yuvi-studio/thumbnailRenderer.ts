/* One shared offscreen renderer for every catalog thumbnail.
 *
 * Both catalogs used to open their own WebGL context and render the whole list
 * in one synchronous `toDataURL` burst at DPR 2 — 33 gear cards plus a room
 * category every time a tab switched, on the same frame the studio was trying
 * to draw. This keeps a single 140×140 low-power context, renders one item at
 * a time on request, reads the pixels back with `toBlob` (asynchronous), and
 * hands the context back after ten idle seconds so it never counts against
 * the browser's ~16 live contexts while the studio room is up.
 *
 * In production it is a fallback. Every catalogue item ships as a pre-rendered
 * WebP (`studioThumbs.ts`, produced by `scripts/render-studio-thumbs.mjs`
 * through this same code), so on a school PC no context is opened for the
 * cards at all; only an id without a file reaches `renderThumbnail`.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { resolveRenderTier } from './renderTier'

export type ThumbnailPreset = 'avatar' | 'room'

const SIZE = 140
const IDLE_RELEASE_MS = 10_000

interface Shared {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  environment: THREE.Texture
  lights: Record<ThumbnailPreset, THREE.Group>
}

let shared: Shared | null = null
let releaseTimer: number | undefined

/* The two lighting presets are the values each catalog rendered with before
   the renderer was shared, so the cards look exactly as they did. */
function buildLights(preset: ThumbnailPreset): THREE.Group {
  const group = new THREE.Group()
  if (preset === 'avatar') {
    group.add(new THREE.HemisphereLight(0xffffff, 0xd6e0f5, 1.0))
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(3, 6, 6); group.add(key)
    const fill = new THREE.DirectionalLight(0xbcd7ef, 0.5); fill.position.set(-4, 2, 3); group.add(fill)
  } else {
    group.add(new THREE.HemisphereLight(0xffffff, 0xd9ddff, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(4, 6, 5); group.add(key)
    const fill = new THREE.DirectionalLight(0xaebfff, 0.8); fill.position.set(-4, 3, 2); group.add(fill)
  }
  return group
}

function acquire(): Shared | null {
  if (shared) return shared
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: true })
    // `?perf=1`: the studio-perf check asserts this line never prints, i.e. the
    // pre-rendered files covered everything the panel asked for.
    if (/[?&]perf=1(?:&|$)/.test(window.location.search)) console.info('[studio] thumbnail WebGL context created')
    // Crisp cards on a good screen; a low device does not pay 4× the fragments
    // for a 140 px picture.
    renderer.setPixelRatio(resolveRenderTier().final === 'low' ? 1 : 2)
    renderer.setSize(SIZE, SIZE)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    const pmrem = new THREE.PMREMGenerator(renderer)
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture
    pmrem.dispose()
    shared = {
      renderer,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(30, 1, 0.1, 100),
      environment,
      lights: { avatar: buildLights('avatar'), room: buildLights('room') },
    }
    return shared
  } catch {
    // WebGL unavailable — cards fall back to their colour swatch.
    return null
  }
}

function release() {
  if (!shared) return
  shared.environment.dispose()
  shared.renderer.dispose()
  shared.renderer.forceContextLoss()
  shared = null
}

function scheduleRelease() {
  window.clearTimeout(releaseTimer)
  releaseTimer = window.setTimeout(release, IDLE_RELEASE_MS)
}

export interface ThumbnailEncoding {
  type: 'image/png' | 'image/webp'
  /** 0–1, lossy formats only. */
  quality?: number
}
/** Lossless: the live fallback is never the one that decides how a card looks. */
const LIVE_ENCODING: ThumbnailEncoding = { type: 'image/png' }

/** Render one built object to an image URL. The object is disposed afterwards.
 *  Resolves `null` when there is no WebGL to render with. */
export function renderThumbnail(
  preset: ThumbnailPreset,
  build: () => THREE.Object3D,
  encoding: ThumbnailEncoding = LIVE_ENCODING,
): Promise<string | null> {
  const ctx = acquire()
  if (!ctx) return Promise.resolve(null)
  const { renderer, scene, camera } = ctx
  const object = build()
  const bounds = new THREE.Box3().setFromObject(object)
  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  object.position.sub(center)
  const dimension = Math.max(size.x, size.y, size.z) || 1

  // Framing and exposure per preset — the numbers each catalog always used.
  if (preset === 'avatar') {
    const distance = dimension * 2.3
    camera.position.set(distance * 0.38, distance * 0.3, distance)
    renderer.toneMappingExposure = 1.0
    scene.environment = ctx.environment
  } else {
    const distance = dimension * 2.4
    camera.position.set(distance * 0.55, distance * 0.4, distance)
    renderer.toneMappingExposure = 1.05
    scene.environment = null
  }
  camera.lookAt(0, 0, 0)

  scene.add(ctx.lights[preset], object)
  renderer.render(scene, camera)
  scene.remove(ctx.lights[preset], object)
  object.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose() })
  scheduleRelease()

  // `toBlob` copies the bitmap synchronously and encodes off the main thread,
  // so the next render may reuse the canvas straight away.
  return new Promise((resolve) => {
    renderer.domElement.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), encoding.type, encoding.quality)
  })
}
