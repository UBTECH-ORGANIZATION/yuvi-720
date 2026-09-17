/* The roadmap's one WebGL scene: a road that climbs through space, a pad per
   level, the learner's beacon, and the rewards that rise off a pad when the
   camera settles on it.

   Rules it keeps, from the studio's performance work (`renderTier.ts`):
   one WebGL context on the page (the page mounts nothing else that draws),
   pixel ratio and effects by tier, two lights plus a hemisphere, no shadow
   map, and a scene that costs the same on every tier apart from the dust,
   the fog and the glows. Pictures are the studio's pre-rendered thumbnails
   and world strips, so nothing here builds catalogue geometry. Reduced
   motion turns the idle animation off and renders only while something is
   actually changing. */
import * as THREE from 'three'
import gsap from 'gsap'
import { tierSettings, type RenderTier } from '../Yuvi-studio/renderTier'
import { preRenderedThumb } from '../Yuvi-studio/studioThumbs'
import { WORLD_HOLOGRAM_FRAME, WORLD_HOLOGRAM_FRAMES, worldHologramPad, worldHologramStrip } from '../Yuvi-studio/worldHologramStrips'
import type { RoomLayoutId } from '../Yuvi-studio/RoomLayouts'
import yuviBadgeUrl from '../../assets/yuvi-badge.webp'
import { rewardItems, type RewardItem } from '../../services/levelRewards'
import type { ProgressionStatus, RoadmapLevel } from '../../services/progression'
import {
  anchorAt, isMilestone, itemSlots, levelState, litFraction, positionIndex, type LevelState,
} from './roadmapModel'
import { beamGradient, glowDot, levelBadge, rewardGlyph, sparkGlyph } from './roadmapGlyphs'

export interface SceneAnchor {
  /** Where the focused pad's items hover, in CSS pixels of the canvas. */
  x: number
  y: number
  /** The pad itself. */
  padX: number
  padY: number
  /** Screen x of the raised cluster's outer edges, so a card can sit beside
   *  it rather than over it. */
  spanLeft: number
  spanRight: number
  /** False while the pad is behind the camera or off screen. */
  visible: boolean
}

export interface RoadmapSceneOptions {
  levels: RoadmapLevel[]
  status: ProgressionStatus
  tier: RenderTier
  reduceMotion: boolean
  onAnchor: (anchor: SceneAnchor) => void
  /** Every rendered frame: its cost and timestamp, for the FPS governor. */
  onFrame?: (frameMs: number, now: number) => void
}

export interface RoadmapScene {
  /** Continuous level index the camera eases toward (scroll drives this). */
  setTarget(progress: number): void
  /** Same, with no easing — first placement. */
  jumpTo(progress: number): void
  /** The pad whose rewards are up. */
  setFocus(index: number): void
  setStatus(status: ProgressionStatus): void
  setQuality(tier: RenderTier): void
  /** Stop drawing (the studio overlay is up over the page) without losing
   *  the context; drawing resumes where it left off. */
  setPaused(paused: boolean): void
  dispose(): void
}

const COLOR = {
  cyan: new THREE.Color(0x77f4ff),
  purple: new THREE.Color(0x9f7afe),
  gold: new THREE.Color(0xf4c95d),
  pink: new THREE.Color(0xff8abc),
  slate: new THREE.Color(0x3a4066),
  slateDeep: new THREE.Color(0x1c2144),
  road: new THREE.Color(0x161b3f),
  fog: new THREE.Color(0x070b24),
  pad: new THREE.Color(0x9ca3bf),
}
const ROAD_WIDTH = 1.5
/** The part of a baked world frame that holds the projection: the strips
 *  leave a margin around the pad that a picker card needs and a sprite
 *  floating over a pad does not. */
const HOLOGRAM_CROP = { x: 26, y: 6, width: WORLD_HOLOGRAM_FRAME.width - 52, height: WORLD_HOLOGRAM_FRAME.height - 6 } as const
const CAMERA_BACK = 12.4
const CAMERA_UP = 4.7
const REST_SCALE = 0.55

function stateColor(state: LevelState): THREE.Color {
  return state === 'current' ? COLOR.cyan : state === 'reached' ? COLOR.gold : COLOR.slate
}

/* ── Road ribbon ─────────────────────────────────────────────────────────── */

/** A flat strip along the curve: `segments` quads, u across (0..1), v along. */
function ribbon(curve: THREE.CatmullRomCurve3, segments: number, width: number, lift: number): THREE.BufferGeometry {
  const positions = new Float32Array((segments + 1) * 2 * 3)
  const uvs = new Float32Array((segments + 1) * 2 * 2)
  const indices: number[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const side = new THREE.Vector3()
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const p = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t)
    side.crossVectors(tangent, up).normalize().multiplyScalar(width / 2)
    const o = i * 6
    positions[o] = p.x - side.x; positions[o + 1] = p.y + lift; positions[o + 2] = p.z - side.z
    positions[o + 3] = p.x + side.x; positions[o + 4] = p.y + lift; positions[o + 5] = p.z + side.z
    uvs[i * 4] = 0; uvs[i * 4 + 1] = t
    uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = t
    if (i < segments) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Edge lines, a dashed centre line and a pulse that runs up the lit part.
 *  `uLit` is how far along (0..1) the road has been travelled. */
const ROAD_GLOW = {
  vertex: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragment: /* glsl */ `
    uniform float uLit;
    uniform float uTime;
    uniform float uDashes;
    uniform vec3 uLitColor;
    uniform vec3 uDimColor;
    varying vec2 vUv;
    void main() {
      float across = abs(vUv.x - 0.5) * 2.0;
      float edge = smoothstep(0.84, 0.97, across) * (1.0 - smoothstep(0.985, 1.0, across));
      float centre = 1.0 - smoothstep(0.0, 0.07, across);
      float dash = smoothstep(0.42, 0.5, fract(vUv.y * uDashes - uTime * 0.35)) * (1.0 - smoothstep(0.9, 0.98, fract(vUv.y * uDashes - uTime * 0.35)));
      float lit = 1.0 - smoothstep(uLit - 0.002, uLit + 0.002, vUv.y);
      vec3 base = mix(uDimColor, uLitColor, lit);
      float head = fract(uTime * 0.07) * uLit;
      float pulse = exp(-pow((head - vUv.y) * 90.0, 2.0)) * lit;
      float alpha = edge * (0.55 + 0.45 * lit) + centre * dash * (0.25 + 0.55 * lit) + pulse * 0.9;
      vec3 colour = base * (edge + centre * dash) + vec3(0.75, 1.0, 1.0) * pulse;
      gl_FragColor = vec4(colour, alpha);
    }`,
}

/* ── Textures ────────────────────────────────────────────────────────────── */

function canvasTexture(source: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(source)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 1
  return texture
}

function sprite(map: THREE.Texture, options: { scale: number; aspect?: number; additive?: boolean; opacity?: number; color?: THREE.Color; depth?: boolean }): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map,
    transparent: true,
    opacity: options.opacity ?? 1,
    depthWrite: false,
    depthTest: options.depth ?? true,
    blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    color: options.color ?? new THREE.Color(0xffffff),
  })
  material.toneMapped = false
  const object = new THREE.Sprite(material)
  object.scale.set(options.scale * (options.aspect ?? 1), options.scale, 1)
  return object
}

/* ── The scene ───────────────────────────────────────────────────────────── */

interface PadNode {
  group: THREE.Group
  ring: THREE.MeshBasicMaterial
  halo: THREE.MeshBasicMaterial
  gate: THREE.MeshBasicMaterial | null
  /** The standing ring of a milestone, turned slowly like a coin. */
  gateGroup: THREE.Group | null
  badge: THREE.Sprite
  state: LevelState
  items: ItemNode[] | null
}

interface ItemNode {
  group: THREE.Group
  item: RewardItem
  /** 0 = resting on the pad (or hidden when locked), 1 = fully up. */
  pop: { t: number }
  slot: { x: number; y: number; z: number }
  spin: THREE.Sprite | null
  hologram: { canvas: CanvasRenderingContext2D; image: HTMLImageElement; pad: HTMLImageElement; texture: THREE.CanvasTexture; frame: number; at: number } | null
  glow: THREE.Sprite | null
}

export function createRoadmapScene(container: HTMLElement, options: RoadmapSceneOptions): RoadmapScene | null {
  const { levels, reduceMotion, onAnchor, onFrame } = options
  const count = levels.length
  let status = options.status
  let tier = options.tier
  let settings = tierSettings(tier, true)
  // Render-on-demand flag (reduced motion) and the context-lost latch. Up
  // here because texture loads and the quality pass below set them.
  let dirty = true
  let live = true
  let paused = false

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: settings.antialias, alpha: true, powerPreference: settings.powerPreference })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatioCap))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  container.appendChild(renderer.domElement)
  container.dataset.renderTier = tier

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 170)
  const disposables: Array<{ dispose(): void }> = []
  const track = <T extends { dispose(): void }>(value: T): T => { disposables.push(value); return value }
  const g = gsap.context(() => {})

  // ── Light: a cool sky, one warm key, and a cyan lamp that rides with the
  //    focus so the pad in front of the camera is the bright one.
  scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x1b1236, 1.15))
  const key = new THREE.DirectionalLight(0xfff2e0, 1.6)
  key.position.set(6, 12, 8)
  scene.add(key)
  const lamp = new THREE.PointLight(0x77f4ff, 34, 16, 2)
  scene.add(lamp)

  // ── Shared textures
  const dotTexture = track(canvasTexture(glowDot()))
  const sparkTexture = track(canvasTexture(sparkGlyph()))
  const glyphTextures = new Map<string, THREE.CanvasTexture>()
  const glyph = (kind: Parameters<typeof rewardGlyph>[0], level?: number) => {
    const id = `${kind}:${level ?? ''}`
    let texture = glyphTextures.get(id)
    if (!texture) { texture = track(canvasTexture(rewardGlyph(kind, level))); glyphTextures.set(id, texture) }
    return texture
  }
  const loader = new THREE.TextureLoader()
  const imageTextures = new Map<string, THREE.Texture>()
  const imageTexture = (url: string) => {
    let texture = imageTextures.get(url)
    if (!texture) {
      texture = track(loader.load(url, () => { dirty = true }))
      texture.colorSpace = THREE.SRGBColorSpace
      imageTextures.set(url, texture)
    }
    return texture
  }

  // ── The road
  const anchors = levels.map((_, i) => { const a = anchorAt(i); return new THREE.Vector3(a.x, a.y, a.z) })
  const curve = new THREE.CatmullRomCurve3(anchors, false, 'catmullrom', 0.5)
  const segments = Math.max(24, (count - 1) * 14)
  const roadBase = new THREE.Mesh(
    track(ribbon(curve, segments, ROAD_WIDTH, 0)),
    track(new THREE.MeshStandardMaterial({ color: COLOR.road, roughness: 0.62, metalness: 0.22, side: THREE.DoubleSide })),
  )
  scene.add(roadBase)
  const roadGlowMaterial = track(new THREE.ShaderMaterial({
    uniforms: {
      uLit: { value: litFraction(status, count) },
      uTime: { value: 0 },
      uDashes: { value: (count - 1) * 6 },
      uLitColor: { value: COLOR.cyan.clone() },
      uDimColor: { value: COLOR.purple.clone().multiplyScalar(0.55) },
    },
    vertexShader: ROAD_GLOW.vertex,
    fragmentShader: ROAD_GLOW.fragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }))
  scene.add(new THREE.Mesh(track(ribbon(curve, segments, ROAD_WIDTH * 1.02, 0.025)), roadGlowMaterial))

  // ── Pads
  const padGeometry = track(new THREE.CylinderGeometry(1.6, 1.8, 0.36, 8))
  const padMaterial = track(new THREE.MeshStandardMaterial({ color: COLOR.pad, roughness: 0.3, metalness: 0.2, flatShading: true }))
  const stemGeometry = track(new THREE.CylinderGeometry(0.22, 0.42, 2.6, 6))
  const stemMaterial = track(new THREE.MeshStandardMaterial({ color: COLOR.slateDeep, roughness: 0.7, metalness: 0.3, flatShading: true }))
  const ringGeometry = track(new THREE.TorusGeometry(1.52, 0.05, 10, 64))
  const haloGeometry = track(new THREE.RingGeometry(1.5, 2.15, 64))
  const gateGeometry = track(new THREE.TorusGeometry(2.55, 0.075, 12, 80))
  const gateFieldGeometry = track(new THREE.CircleGeometry(2.48, 64))

  const pads: PadNode[] = levels.map((row, i) => {
    const group = new THREE.Group()
    group.position.copy(anchors[i])
    const milestone = isMilestone(row.level)
    const state = levelState(row.level, status)
    const base = new THREE.Mesh(padGeometry, padMaterial)
    base.position.y = -0.2
    base.rotation.y = Math.PI / 8
    const stem = new THREE.Mesh(stemGeometry, stemMaterial)
    stem.position.y = -1.65
    const ringMaterial = track(new THREE.MeshBasicMaterial({ color: stateColor(state) }))
    ringMaterial.toneMapped = false
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = Math.PI / 2
    ring.position.y = -0.01
    const haloMaterial = track(new THREE.MeshBasicMaterial({ color: stateColor(state), transparent: true, opacity: state === 'locked' ? 0.06 : 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    haloMaterial.toneMapped = false
    const halo = new THREE.Mesh(haloGeometry, haloMaterial)
    halo.rotation.x = -Math.PI / 2
    halo.position.y = -0.03
    group.add(base, stem, ring, halo)
    if (milestone) {
      base.scale.set(1.4, 1, 1.4)
      ring.scale.set(1.4, 1.4, 1)
      halo.scale.set(1.4, 1.4, 1)
    }
    let gate: THREE.MeshBasicMaterial | null = null
    let gateSpinner: THREE.Group | null = null
    if (milestone) {
      // A standing ring the road passes through, facing along the road.
      const gateGroup = new THREE.Group()
      const t = i / Math.max(1, count - 1)
      const tangent = curve.getTangentAt(t)
      gateGroup.lookAt(tangent.clone().add(gateGroup.position))
      gateGroup.position.y = 2.45
      gate = track(new THREE.MeshBasicMaterial({ color: stateColor(state) }))
      gate.toneMapped = false
      const fieldMaterial = track(new THREE.MeshBasicMaterial({ color: stateColor(state), transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
      fieldMaterial.toneMapped = false
      // The ring itself turns inside the oriented group, so the slow coin
      // spin in the frame loop never fights the orientation set here.
      const gateSpin = new THREE.Group()
      gateSpin.add(new THREE.Mesh(gateGeometry, gate), new THREE.Mesh(gateFieldGeometry, fieldMaterial))
      gateGroup.add(gateSpin)
      group.add(gateGroup)
      gateSpinner = gateSpin
    }
    const badge = sprite(track(canvasTexture(levelBadge(row.level, state, milestone))), { scale: 0.82 })
    badge.position.set(0, 0.58, milestone ? 2.2 : 1.62)
    group.add(badge)
    scene.add(group)
    return { group, ring: ringMaterial, halo: haloMaterial, gate, gateGroup: gateSpinner, badge, state, items: null }
  })

  // ── Items on a pad: built the first time they are needed.
  const buildItems = (index: number): ItemNode[] => {
    const row = levels[index]
    const pad = pads[index]
    const items = rewardItems(row.reward)
    const slots = itemSlots(items.length, items[0]?.kind === 'world')
    return items.map((item, i) => {
      const group = new THREE.Group()
      let spin: THREE.Sprite | null = null
      let hologram: ItemNode['hologram'] = null
      let glow: THREE.Sprite | null = null
      const locked = pad.state === 'locked'
      const tint = locked ? new THREE.Color(0x9fdcff) : new THREE.Color(0xffffff)
      if (item.kind === 'world' && item.world) {
        // The studio picker's projection, frame by frame: the shared pad still
        // under one frame of the world's baked turn, composited on a canvas
        // the size of a frame. The strip itself never becomes a GPU texture
        // (7488 px tall is over what a school GPU may upload).
        const url = worldHologramStrip(item.world as RoomLayoutId)
        const ctx = document.createElement('canvas').getContext('2d')
        if (url && ctx) {
          ctx.canvas.width = HOLOGRAM_CROP.width
          ctx.canvas.height = HOLOGRAM_CROP.height
          const image = new Image()
          const padStill = new Image()
          const texture = track(canvasTexture(ctx.canvas))
          image.onload = () => { drawHologramFrame(hologram!, 0); dirty = true }
          padStill.onload = () => { if (hologram) { drawHologramFrame(hologram, hologram.frame); dirty = true } }
          image.src = url
          const padUrl = worldHologramPad()
          if (padUrl) padStill.src = padUrl
          hologram = { canvas: ctx, image, pad: padStill, texture, frame: 0, at: 0 }
          const plane = sprite(texture, { scale: 2.4, aspect: HOLOGRAM_CROP.width / HOLOGRAM_CROP.height })
          plane.position.y = 0.5
          group.add(plane)
        }
        glow = sprite(dotTexture, { scale: 3.2, additive: true, opacity: 0.32, color: COLOR.cyan.clone(), depth: false })
      } else if (item.kind === 'sparks') {
        spin = sprite(sparkTexture, { scale: 1.35 })
        group.add(spin)
        glow = sprite(dotTexture, { scale: 2.6, additive: true, opacity: 0.4, color: COLOR.gold.clone(), depth: false })
      } else if (item.kind === 'hint' || item.kind === 'frame' || item.kind === 'mood' || item.kind === 'sound') {
        const level = item.kind === 'frame' ? Number(item.id.match(/(\d+)$/)?.[1]) || undefined : undefined
        const tile = sprite(glyph(item.kind, level), { scale: 1.3, color: tint })
        group.add(tile)
        glow = sprite(dotTexture, { scale: 2.4, additive: true, opacity: 0.3, color: (item.kind === 'frame' ? COLOR.gold : item.kind === 'sound' ? COLOR.pink : COLOR.purple).clone(), depth: false })
      } else {
        const url = preRenderedThumb(item.kind === 'avatar' ? 'avatar' : 'room', item.id)
        const picture = url
          ? sprite(imageTexture(url), { scale: 1.5, color: tint, opacity: locked ? 0.82 : 1 })
          : sprite(glyph('mood'), { scale: 1.3, color: tint })
        group.add(picture)
        glow = sprite(dotTexture, { scale: 2.6, additive: true, opacity: 0.3, color: (locked ? COLOR.cyan : COLOR.purple).clone(), depth: false })
      }
      if (glow) {
        glow.position.z = -0.05
        glow.visible = tier !== 'low'
        group.add(glow)
      }
      if (locked) {
        const lock = sprite(glyph('lock'), { scale: 0.5 })
        lock.position.set(0.55, -0.5, 0.2)
        group.add(lock)
      }
      pad.group.add(group)
      const node: ItemNode = { group, item, pop: { t: 0 }, slot: slots[i], spin, hologram, glow }
      placeItem(node, pad, 0)
      return node
    })
  }

  const drawHologramFrame = (h: NonNullable<ItemNode['hologram']>, frame: number) => {
    if (!h.image.complete || !h.image.naturalWidth) return
    const { x, y, width, height } = HOLOGRAM_CROP
    h.canvas.clearRect(0, 0, width, height)
    if (h.pad.complete && h.pad.naturalWidth) h.canvas.drawImage(h.pad, x, y, width, height, 0, 0, width, height)
    h.canvas.drawImage(h.image, x, frame * WORLD_HOLOGRAM_FRAME.height + y, width, height, 0, 0, width, height)
    h.texture.needsUpdate = true
    h.frame = frame
  }

  /** Where an item is for a pop amount `t`: resting on the pad at 0 (hidden
   *  there when the level is locked), hovering in its slot at 1. */
  const placeItem = (node: ItemNode, pad: PadNode, bob: number) => {
    const t = node.pop.t
    const rest = pad.state === 'locked' ? 0 : REST_SCALE
    const scale = Math.max(0.001, rest + (1 - rest) * t)
    node.group.scale.setScalar(scale)
    const restY = 0.52
    node.group.position.set(
      node.slot.x * (0.6 + 0.4 * t),
      restY + (node.slot.y - restY) * t + bob * t,
      node.slot.z * t,
    )
    node.group.visible = scale > 0.002
  }

  // Reached and current pads keep their rewards resting on them.
  pads.forEach((pad, i) => {
    if (pad.state !== 'locked') pad.items = buildItems(i)
  })

  // ── The beacon: where the learner stands on the road.
  const beacon = new THREE.Group()
  const beamMaterial = track(new THREE.MeshBasicMaterial({ map: track(canvasTexture(beamGradient())), color: COLOR.cyan, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  beamMaterial.toneMapped = false
  const beam = new THREE.Mesh(track(new THREE.CylinderGeometry(0.4, 0.78, 9, 20, 1, true)), beamMaterial)
  beam.position.y = 4.2
  const coreMaterial = track(new THREE.MeshBasicMaterial({ map: beamMaterial.map, color: 0xd9fbff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  coreMaterial.toneMapped = false
  const core = new THREE.Mesh(track(new THREE.CylinderGeometry(0.1, 0.22, 9, 12, 1, true)), coreMaterial)
  core.position.y = 4.2
  const beaconHalo = sprite(dotTexture, { scale: 4.4, additive: true, opacity: 0.55, color: COLOR.cyan.clone(), depth: false })
  beaconHalo.position.y = 0.25
  const pulseMaterial = track(new THREE.MeshBasicMaterial({ color: COLOR.cyan, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  pulseMaterial.toneMapped = false
  const pulse = new THREE.Mesh(track(new THREE.RingGeometry(0.86, 1.0, 56)), pulseMaterial)
  pulse.rotation.x = -Math.PI / 2
  pulse.position.y = 0.06
  const mark = sprite(imageTexture(yuviBadgeUrl), { scale: 1.9 })
  mark.position.y = 3.3
  beacon.add(beam, core, beaconHalo, pulse, mark)
  scene.add(beacon)
  const placeBeacon = () => {
    const a = anchorAt(positionIndex(status, count))
    beacon.position.set(a.x, a.y, a.z)
  }
  placeBeacon()

  // ── Dust: static points in a box around the whole road, drifting upward.
  const DUST_MAX = 700
  const dustPositions = new Float32Array(DUST_MAX * 3)
  const last = anchors[anchors.length - 1]
  for (let i = 0; i < DUST_MAX; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 60
    dustPositions[i * 3 + 1] = -6 + Math.random() * (last.y + 22)
    dustPositions[i * 3 + 2] = 12 - Math.random() * (Math.abs(last.z) + 26)
  }
  const dustGeometry = track(new THREE.BufferGeometry())
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
  const dustMaterial = track(new THREE.PointsMaterial({ map: dotTexture, size: 0.22, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x9fd8ff, sizeAttenuation: true }))
  dustMaterial.toneMapped = false
  const dust = new THREE.Points(dustGeometry, dustMaterial)
  scene.add(dust)

  const applyQuality = (next: RenderTier) => {
    tier = next
    settings = tierSettings(next, true)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatioCap))
    scene.fog = settings.fog ? new THREE.FogExp2(COLOR.fog.getHex(), 0.0135) : null
    const motes = next === 'high' ? DUST_MAX : next === 'medium' ? 300 : 0
    dust.visible = motes > 0
    dustGeometry.setDrawRange(0, motes)
    for (const pad of pads) for (const node of pad.items ?? []) if (node.glow) node.glow.visible = next !== 'low'
    container.dataset.renderTier = next
    dirty = true
  }
  applyQuality(tier)

  // ── Camera rig
  let goal = 0
  let progress = 0
  let focus = -1
  const pointer = new THREE.Vector2()
  const parallax = new THREE.Vector2()
  let lastX = 0
  let bank = 0
  const cameraTarget = new THREE.Vector3()
  const cameraGoal = new THREE.Vector3()
  const lookGoal = new THREE.Vector3()
  const projected = new THREE.Vector3()
  const lastAnchor = { x: -1, y: -1, padX: -1, padY: -1, spanLeft: -1, spanRight: -1, visible: false }

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    const rect = container.getBoundingClientRect()
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1))
  }
  const onPointerLeave = () => pointer.set(0, 0)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerleave', onPointerLeave)

  const popItems = (index: number, up: boolean) => {
    const pad = pads[index]
    if (!pad) return
    if (up && !pad.items) pad.items = buildItems(index)
    if (!pad.items) return
    pad.items.forEach((node, i) => {
      g.add(() => {
        gsap.killTweensOf(node.pop)
        gsap.to(node.pop, {
          t: up ? 1 : 0,
          duration: reduceMotion ? 0.18 : up ? 0.62 : 0.32,
          delay: reduceMotion ? 0 : up ? i * 0.07 : (pad.items!.length - 1 - i) * 0.03,
          ease: reduceMotion ? 'power1.out' : up ? 'back.out(1.6)' : 'power2.in',
          onUpdate: () => { dirty = true },
        })
      })
    })
  }

  // ── Frame loop
  let frame = 0
  let lastNow = performance.now()
  const clock = { t: 0 }

  const resize = () => {
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    dirty = true
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()

  const reportAnchor = (force: boolean) => {
    const pad = pads[focus]
    if (!pad) return
    const width = container.clientWidth
    const height = container.clientHeight
    const toScreen = (local: THREE.Vector3) => {
      projected.copy(local).applyMatrix4(pad.group.matrixWorld).project(camera)
      return { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height, inFront: projected.z < 1 }
    }
    const items = toScreen(new THREE.Vector3(0, 1.75, 0))
    const centre = toScreen(new THREE.Vector3(0, 0, 0))
    const reach = Math.min(-0.95, ...(pad.items ?? []).map((node) => node.slot.x - 0.95))
    const edgeA = toScreen(new THREE.Vector3(reach, 1.75, 0))
    const edgeB = toScreen(new THREE.Vector3(-reach, 1.75, 0))
    const visible = items.inFront && items.x > -200 && items.x < width + 200 && items.y > -200 && items.y < height + 200
    const next = {
      x: items.x, y: items.y, padX: centre.x, padY: centre.y,
      spanLeft: Math.min(edgeA.x, edgeB.x), spanRight: Math.max(edgeA.x, edgeB.x), visible,
    }
    if (!force && Math.abs(next.x - lastAnchor.x) < 0.5 && Math.abs(next.y - lastAnchor.y) < 0.5 && next.visible === lastAnchor.visible) return
    Object.assign(lastAnchor, next)
    onAnchor(next)
  }

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick)
    if (!live || paused || document.hidden) { lastNow = now; return }
    const dt = Math.min(0.05, (now - lastNow) / 1000)
    lastNow = now

    const moving = Math.abs(goal - progress) > 0.0004 || parallax.distanceToSquared(pointer) > 0.00001
    const continuous = !reduceMotion
    if (!continuous && !moving && !dirty) return
    dirty = false
    const started = performance.now()

    // Camera: ease to the scroll goal, lean into the sway, drift with the mouse.
    progress += (goal - progress) * (1 - Math.exp(-dt * 6.5))
    if (Math.abs(goal - progress) < 0.0004) progress = goal
    parallax.lerp(pointer, 1 - Math.exp(-dt * 4))
    const here = anchorAt(progress)
    const ahead = anchorAt(progress + 0.38)
    // Portrait screens dock the card over the bottom third, so the pad is
    // framed higher there: the camera sits a little higher and looks lower.
    const portrait = camera.aspect < 0.9
    cameraGoal.set(here.x + parallax.x * 0.9, here.y + CAMERA_UP + (portrait ? 0.9 : 0) + parallax.y * 0.45, here.z + CAMERA_BACK + (portrait ? 1.5 : 0))
    camera.position.copy(cameraGoal)
    lookGoal.set(ahead.x, ahead.y + (portrait ? -0.9 : 1.25), ahead.z)
    cameraTarget.copy(lookGoal)
    const dx = here.x - lastX
    lastX = here.x
    bank += ((reduceMotion ? 0 : -dx * 0.9) - bank) * (1 - Math.exp(-dt * 3))
    camera.up.set(Math.sin(bank), Math.cos(bank), 0)
    camera.lookAt(cameraTarget)
    lamp.position.set(here.x, here.y + 3.2, here.z + 1.5)
    // The beacon is a seven-unit beam: seen from the pad next to it, it is
    // the whole screen. It fades out as the camera comes within reach.
    const beaconDistance = camera.position.distanceTo(beacon.position)
    const beaconFade = Math.max(0, Math.min(1, (beaconDistance - 4.5) / 6))
    beacon.visible = beaconFade > 0.01
    beamMaterial.opacity = 0.55 * beaconFade
    coreMaterial.opacity = 0.9 * beaconFade
    mark.material.opacity = beaconFade
    // Far pads keep their rings but lose their numbers, or the road ahead
    // reads as a cloud of white dots.
    for (let i = 0; i < count; i++) {
      const away = Math.abs(i - progress)
      const badgeFade = away < 6 ? 1 : Math.max(0, 1 - (away - 6) / 4)
      pads[i].badge.visible = badgeFade > 0.02
      pads[i].badge.material.opacity = badgeFade
    }

    if (continuous) {
      clock.t += dt
      roadGlowMaterial.uniforms.uTime.value = clock.t
      // Beacon breath and pulse ring.
      const breath = 0.5 + 0.5 * Math.sin(clock.t * 2.2)
      mark.position.y = 3.3 + Math.sin(clock.t * 1.7) * 0.14
      beaconHalo.material.opacity = (0.42 + breath * 0.25) * beaconFade
      const ripple = (clock.t * 0.55) % 1
      pulse.scale.setScalar(1 + ripple * 1.5)
      pulseMaterial.opacity = (1 - ripple) * 0.6 * beaconFade
      // Dust drifts up and wraps.
      if (dust.visible) {
        const n = dustGeometry.drawRange.count
        for (let i = 0; i < n; i++) {
          dustPositions[i * 3 + 1] += dt * 0.35
          if (dustPositions[i * 3 + 1] > last.y + 16) dustPositions[i * 3 + 1] = -6
        }
        dustGeometry.attributes.position.needsUpdate = true
      }
    }
    // Items: bob while up, spin the spark, step the hologram.
    for (let i = Math.max(0, focus - 3); i <= Math.min(count - 1, focus + 3); i++) {
      const pad = pads[i]
      if (pad.gateGroup && continuous) pad.gateGroup.rotation.y = Math.sin(clock.t * 0.45 + i) * 0.32
      if (!pad.items) continue
      pad.items.forEach((node, k) => {
        const bob = continuous ? Math.sin(clock.t * 1.6 + k * 1.3 + i) * 0.07 : 0
        placeItem(node, pad, bob)
        if (node.spin && continuous) node.spin.material.rotation = clock.t * 0.6 + k
        if (node.hologram && node.pop.t > 0.05) {
          const h = node.hologram
          if (continuous && now - h.at > 250) {
            h.at = now
            drawHologramFrame(h, (h.frame + 1) % WORLD_HOLOGRAM_FRAMES)
          }
        }
      })
    }
    // Pads far from the camera are skipped by the frustum; resting items on
    // reached pads still need their bob only near the focus, done above.
    renderer.render(scene, camera)
    reportAnchor(false)
    onFrame?.(performance.now() - started, now)
  }
  frame = requestAnimationFrame(tick)

  const onContextLost = (event: Event) => { event.preventDefault(); live = false }
  const onContextRestored = () => { live = true; dirty = true }
  renderer.domElement.addEventListener('webglcontextlost', onContextLost, false)
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false)

  const setFocus = (index: number) => {
    if (index === focus) return
    const previous = focus
    focus = index
    if (previous >= 0) popItems(previous, false)
    popItems(index, true)
    dirty = true
    reportAnchor(true)
  }

  const applyStatus = (next: ProgressionStatus) => {
    status = next
    roadGlowMaterial.uniforms.uLit.value = litFraction(status, count)
    placeBeacon()
    pads.forEach((pad, i) => {
      const state = levelState(levels[i].level, status)
      if (state === pad.state) return
      pad.state = state
      pad.ring.color.copy(stateColor(state))
      pad.halo.color.copy(stateColor(state))
      pad.halo.opacity = state === 'locked' ? 0.06 : 0.22
      if (pad.gate) pad.gate.color.copy(stateColor(state))
      const badge = pad.badge.material.map
      pad.badge.material.map = track(canvasTexture(levelBadge(levels[i].level, state, isMilestone(levels[i].level))))
      badge?.dispose()
      // Items were tinted for the old state; rebuild them on the next focus,
      // and right away when the level has just been reached so its rewards
      // come to rest on the pad.
      if (pad.items) { for (const node of pad.items) pad.group.remove(node.group); pad.items = null }
      if (state !== 'locked' || i === focus) pad.items = buildItems(i)
      if (i === focus) for (const node of pad.items ?? []) node.pop.t = 1
    })
    dirty = true
  }

  return {
    setTarget(next) { goal = Math.max(0, Math.min(count - 1, next)); dirty = true },
    jumpTo(next) { goal = progress = Math.max(0, Math.min(count - 1, next)); lastX = anchorAt(progress).x; dirty = true },
    setFocus,
    setStatus: applyStatus,
    setQuality: applyQuality,
    setPaused(next) { paused = next; if (!next) dirty = true },
    dispose() {
      live = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored)
      g.revert()
      for (const pad of pads) for (const node of pad.items ?? []) node.group.traverse((o) => { if (o instanceof THREE.Sprite) o.material.dispose() })
      for (const pad of pads) pad.badge.material.dispose()
      ;[beaconHalo, mark].forEach((s) => s.material.dispose())
      for (const d of disposables) d.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
