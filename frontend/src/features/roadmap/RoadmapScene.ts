/* The roadmap's one WebGL scene: stations climbing through space, the
  learner's beacon, and rewards that rise when the camera settles on one.

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
import type { YuviDesign } from '../Yuvi-studio/YuviDesign'
import { createRoadmapYuvi } from './RoadmapYuvi'
import { createJungleStationAssets } from './RoadmapJungleStation'
import yuviBadgeUrl from '../../assets/yuvi-badge.webp'
import type { Theme } from '../../providers/ThemeProvider'
import { rewardItems, type RewardItem } from '../../services/levelRewards'
import type { ProgressionStatus, RoadmapLevel } from '../../services/progression'
import {
  anchorAt, createYuviFlight, isMilestone, itemSlots, levelState, positionIndex, yuviPosition, type LevelState,
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
  /** Projected footprint of Yuvi, used to keep the level card from hiding him. */
  yuviLeft: number
  yuviRight: number
  yuviTop: number
  yuviBottom: number
  yuviVisible: boolean
  /** False while the pad is behind the camera or off screen. */
  visible: boolean
}

export interface RoadmapSceneOptions {
  levels: RoadmapLevel[]
  status: ProgressionStatus
  design: YuviDesign
  theme: Theme
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
  setDesign(design: YuviDesign): void
  setTheme(theme: Theme): void
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
}
const SCENE_THEME = {
  dark: {
    fog: 0x070b24,
    dust: 0x9fd8ff, sky: 0xc9deff, ground: 0x243b35, key: 0xfff2e0, lamp: 0x77f4ff,
    current: 0x77f4ff, reached: 0xf4c95d, locked: 0x3a4066,
    exposure: 1.05, hemisphere: 1.32, keyIntensity: 1.6, lampIntensity: 34,
  },
  light: {
    fog: 0xd8eff8,
    dust: 0x4b82b5, sky: 0xffffff, ground: 0x9ec9dc, key: 0xfff3d8, lamp: 0x27b8cb,
    current: 0x087f96, reached: 0xa66a00, locked: 0x66738c,
    exposure: 1.12, hemisphere: 1.65, keyIntensity: 1.25, lampIntensity: 20,
  },
} as const
/** The part of a baked world frame that holds the projection: the strips
 *  leave a margin around the pad that a picker card needs and a sprite
 *  floating over a pad does not. */
const HOLOGRAM_CROP = { x: 26, y: 6, width: WORLD_HOLOGRAM_FRAME.width - 52, height: WORLD_HOLOGRAM_FRAME.height - 6 } as const
const CAMERA_BACK = 12.4
const CAMERA_UP = 4.7
const REST_SCALE = 0.55

function stateColor(state: LevelState, theme: Theme): THREE.Color {
  const palette = SCENE_THEME[theme]
  return new THREE.Color(state === 'current' ? palette.current : state === 'reached' ? palette.reached : palette.locked)
}

function rewardGlowColor(item: RewardItem, locked: boolean, theme: Theme): number {
  if (locked) return theme === 'light' ? 0x287191 : 0x77f4ff
  if (item.kind === 'sparks' || item.kind === 'frame') return theme === 'light' ? 0xb06b00 : 0xf4c95d
  if (item.kind === 'sound') return theme === 'light' ? 0xa83269 : 0xff8abc
  if (item.kind === 'world') return theme === 'light' ? 0x087f96 : 0x77f4ff
  return theme === 'light' ? 0x5c48ad : 0x9f7afe
}

function applyRewardGlow(glow: THREE.Sprite, item: RewardItem, locked: boolean, theme: Theme): void {
  glow.material.color.setHex(rewardGlowColor(item, locked, theme))
  glow.material.blending = theme === 'light' ? THREE.NormalBlending : THREE.AdditiveBlending
  glow.material.opacity = theme === 'light' ? 0.46 : Number(glow.userData.darkOpacity ?? 0.3)
  glow.material.needsUpdate = true
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
  let theme = options.theme
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
  const hemisphere = new THREE.HemisphereLight(0xbcd3ff, 0x1b1236, 1.15)
  scene.add(hemisphere)
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

  const anchors = levels.map((_, i) => { const a = anchorAt(i); return new THREE.Vector3(a.x, a.y, a.z) })

  // ── Jungle stations
  const jungleStations = createJungleStationAssets(theme, tier)
  const ringGeometry = track(new THREE.TorusGeometry(1.52, 0.05, 10, 64))
  const haloGeometry = track(new THREE.RingGeometry(1.5, 2.15, 64))

  const pads: PadNode[] = levels.map((row, i) => {
    const group = new THREE.Group()
    group.position.copy(anchors[i])
    const milestone = isMilestone(row.level)
    const state = levelState(row.level, status)
    group.add(jungleStations.create(row.level, milestone))
    const ringMaterial = track(new THREE.MeshBasicMaterial({ color: stateColor(state, theme) }))
    ringMaterial.toneMapped = false
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.15
    const haloMaterial = track(new THREE.MeshBasicMaterial({ color: stateColor(state, theme), transparent: true, opacity: state === 'locked' ? 0.06 : 0.22, blending: theme === 'light' ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    haloMaterial.toneMapped = false
    const halo = new THREE.Mesh(haloGeometry, haloMaterial)
    halo.rotation.x = -Math.PI / 2
    halo.position.y = 0.12
    group.add(ring, halo)
    if (milestone) {
      ring.scale.set(1.4, 1.4, 1)
      halo.scale.set(1.4, 1.4, 1)
    }
    const badge = sprite(track(canvasTexture(levelBadge(row.level, state, milestone))), { scale: 0.82 })
    badge.position.set(0, 0.58, milestone ? 2.2 : 1.62)
    group.add(badge)
    scene.add(group)
    return { group, ring: ringMaterial, halo: haloMaterial, badge, state, items: null }
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
        glow.userData.darkOpacity = glow.material.opacity
        applyRewardGlow(glow, item, locked, theme)
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
      restY + (node.slot.y - restY) * t + bob * t + (pad.state !== 'locked' ? 1.25 : 0),
      node.slot.z * t - (pad.state !== 'locked' ? 0.65 : 0),
    )
    node.group.visible = scale > 0.002
  }

  // Reached and current pads keep their rewards resting on them.
  pads.forEach((pad, i) => {
    if (pad.state !== 'locked') pad.items = buildItems(i)
  })

  // ── The beacon: the learner's current station.
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
    const a = anchorAt(Math.max(0, Math.min(count - 1, status.level - 1)))
    beacon.position.set(a.x, a.y, a.z)
  }
  let beaconFade = 1
  placeBeacon()

  let yuvi = createRoadmapYuvi(options.design)
  scene.add(yuvi.object)
  const yuviFlight = createYuviFlight(yuviPosition(status, count))
  let flightCount = 0
  let horizontalFlightCount = 0
  let horizontalFlight = false
  let forwardFlight = true
  let leadLeft = false
  let lastYuviIndex = status.level - 1
  let hovering = false
  const placeYuvi = () => {
    const position = yuviFlight.position
    yuvi.object.position.set(position.x, position.y, position.z)
  }
  const targetYuvi = (immediate = false, browsing = false) => {
    const index = focus < 0 ? status.level - 1 : focus
    const changedLevel = index !== lastYuviIndex
    hovering = index + 1 > status.level
    if (browsing && !immediate && changedLevel) {
      flightCount++
      forwardFlight = index > lastYuviIndex
      if (forwardFlight) {
        horizontalFlightCount++
        leadLeft = horizontalFlightCount % 2 === 0
      }
      horizontalFlight = forwardFlight
    } else if (!browsing || immediate) {
      horizontalFlight = false
    }
    lastYuviIndex = index
    const spin = browsing && flightCount % 3 === 0 ? (flightCount % 2 === 0 ? -1 : 1) : 0
    // Advancing is head-first and horizontal; retreating stays upright so
    // direction is immediately legible without an awkward backward pose.
    yuviFlight.retarget(yuviPosition(status, count, index, document.documentElement.dir === 'rtl'), spin, reduceMotion || immediate)
    placeYuvi()
  }
  placeYuvi()

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

  const applyTheme = (next: Theme) => {
    theme = next
    const palette = SCENE_THEME[next]
    jungleStations.setTheme(next)
    dustMaterial.color.setHex(palette.dust)
    pads.forEach((pad) => {
      const color = stateColor(pad.state, next)
      pad.ring.color.copy(color)
      pad.halo.color.copy(color)
      pad.halo.blending = next === 'light' ? THREE.NormalBlending : THREE.AdditiveBlending
      pad.halo.opacity = pad.state === 'locked' ? (next === 'light' ? 0.1 : 0.06) : (next === 'light' ? 0.3 : 0.22)
      pad.halo.needsUpdate = true
      for (const node of pad.items ?? []) if (node.glow) applyRewardGlow(node.glow, node.item, pad.state === 'locked', next)
    })
    hemisphere.color.setHex(palette.sky)
    hemisphere.groundColor.setHex(palette.ground)
    hemisphere.intensity = palette.hemisphere
    key.color.setHex(palette.key)
    key.intensity = palette.keyIntensity
    lamp.color.setHex(palette.lamp)
    lamp.intensity = palette.lampIntensity
    renderer.toneMappingExposure = palette.exposure
    scene.fog = settings.fog ? new THREE.FogExp2(palette.fog, 0.0135) : null
    container.dataset.theme = next
    dirty = true
  }

  const applyQuality = (next: RenderTier) => {
    tier = next
    settings = tierSettings(next, true)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatioCap))
    scene.fog = settings.fog ? new THREE.FogExp2(SCENE_THEME[theme].fog, 0.0135) : null
    const motes = next === 'high' ? DUST_MAX : next === 'medium' ? 300 : 0
    dust.visible = motes > 0
    jungleStations.setQuality(next)
    dustGeometry.setDrawRange(0, motes)
    for (const pad of pads) for (const node of pad.items ?? []) if (node.glow) node.glow.visible = next !== 'low'
    container.dataset.renderTier = next
    dirty = true
  }
  applyTheme(theme)
  applyQuality(tier)

  // ── Camera rig
  let goal = 0
  let progress = 0
  let focus = -1
  const pointer = new THREE.Vector2()
  const parallax = new THREE.Vector2()
  let lastX = 0
  let bank = 0
  let cameraSide = 0
  const cameraTarget = new THREE.Vector3()
  const cameraGoal = new THREE.Vector3()
  const lookGoal = new THREE.Vector3()
  const projected = new THREE.Vector3()
  const lastAnchor = {
    x: -1, y: -1, padX: -1, padY: -1, spanLeft: -1, spanRight: -1,
    yuviLeft: -1, yuviRight: -1, yuviTop: -1, yuviBottom: -1, yuviVisible: false,
    visible: false,
  }

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
    const rewardHeight = pad.state !== 'locked' ? 3 : 1.75
    const items = toScreen(new THREE.Vector3(0, rewardHeight, 0))
    const centre = toScreen(new THREE.Vector3(0, 0, 0))
    const reach = Math.min(-0.95, ...(pad.items ?? []).map((node) => node.slot.x - 0.95))
    const edgeA = toScreen(new THREE.Vector3(reach, rewardHeight, 0))
    const edgeB = toScreen(new THREE.Vector3(-reach, rewardHeight, 0))
    const yuviBounds = new THREE.Box3().setFromObject(yuvi.object)
    const yuviCorners = [
      new THREE.Vector3(yuviBounds.min.x, yuviBounds.min.y, yuviBounds.min.z),
      new THREE.Vector3(yuviBounds.min.x, yuviBounds.min.y, yuviBounds.max.z),
      new THREE.Vector3(yuviBounds.min.x, yuviBounds.max.y, yuviBounds.min.z),
      new THREE.Vector3(yuviBounds.min.x, yuviBounds.max.y, yuviBounds.max.z),
      new THREE.Vector3(yuviBounds.max.x, yuviBounds.min.y, yuviBounds.min.z),
      new THREE.Vector3(yuviBounds.max.x, yuviBounds.min.y, yuviBounds.max.z),
      new THREE.Vector3(yuviBounds.max.x, yuviBounds.max.y, yuviBounds.min.z),
      new THREE.Vector3(yuviBounds.max.x, yuviBounds.max.y, yuviBounds.max.z),
    ].map((corner) => {
      projected.copy(corner).project(camera)
      return { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height, inFront: projected.z < 1 }
    })
    const yuviVisible = yuviCorners.some((corner) => corner.inFront)
    const visible = items.inFront && items.x > -200 && items.x < width + 200 && items.y > -200 && items.y < height + 200
    const next = {
      x: items.x, y: items.y, padX: centre.x, padY: centre.y,
      spanLeft: Math.min(edgeA.x, edgeB.x), spanRight: Math.max(edgeA.x, edgeB.x), visible,
      yuviLeft: Math.min(...yuviCorners.map((corner) => corner.x)),
      yuviRight: Math.max(...yuviCorners.map((corner) => corner.x)),
      yuviTop: Math.min(...yuviCorners.map((corner) => corner.y)),
      yuviBottom: Math.max(...yuviCorners.map((corner) => corner.y)),
      yuviVisible,
    }
    if (!force
      && Math.abs(next.x - lastAnchor.x) < 0.5
      && Math.abs(next.y - lastAnchor.y) < 0.5
      && Math.abs(next.yuviLeft - lastAnchor.yuviLeft) < 0.5
      && Math.abs(next.yuviTop - lastAnchor.yuviTop) < 0.5
      && next.visible === lastAnchor.visible
      && next.yuviVisible === lastAnchor.yuviVisible) return
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
    const hoverFrameOffset = isMilestone(focus + 1) ? 2.8 : 1.55
    const sideGoal = portrait && hovering ? hoverFrameOffset * (document.documentElement.dir === 'rtl' ? -1 : 1) : 0
    cameraSide += (sideGoal - cameraSide) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 6.5))
    cameraGoal.set(here.x + cameraSide + parallax.x * 0.9, here.y + CAMERA_UP + (portrait ? 0.9 : 0) + parallax.y * 0.45, here.z + CAMERA_BACK + (portrait ? 1.5 : 0))
    camera.position.copy(cameraGoal)
    lookGoal.set(portrait ? here.x + cameraSide : ahead.x, ahead.y + (portrait ? -0.9 : 1.25), ahead.z)
    cameraTarget.copy(lookGoal)
    const dx = here.x - lastX
    lastX = here.x
    bank += ((reduceMotion ? 0 : -dx * 0.9) - bank) * (1 - Math.exp(-dt * 3))
    camera.up.set(Math.sin(bank), Math.cos(bank), 0)
    camera.lookAt(cameraTarget)
    lamp.position.set(here.x, here.y + 3.2, here.z + 1.5)
    // Keep the learner's beacon readable from any station. Yuvi
    // replaces it only while settled on the learner's current stage.
    const yuviFocus = focus < 0 ? status.level - 1 : focus
    const yuviStandingAtCurrent = !yuviFlight.active && yuviFocus === status.level - 1
    const beaconTarget = yuviStandingAtCurrent ? 0 : 1
    beaconFade += (beaconTarget - beaconFade) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 12))
    beacon.visible = beaconFade > 0.01
    beamMaterial.opacity = 0.55 * beaconFade
    coreMaterial.opacity = 0.9 * beaconFade
    mark.material.opacity = beaconFade
    // Far stations keep their rings but lose their numbers, or the route
    // reads as a cloud of white dots.
    for (let i = 0; i < count; i++) {
      const away = Math.abs(i - progress)
      const badgeFade = away < 6 ? 1 : Math.max(0, 1 - (away - 6) / 4)
      pads[i].badge.visible = badgeFade > 0.02
      pads[i].badge.material.opacity = badgeFade
    }

    if (continuous) {
      clock.t += dt
      jungleStations.update(clock.t)
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
    yuviFlight.update(dt)
    placeYuvi()
    if (hovering && !yuviFlight.active && !reduceMotion) yuvi.object.position.y += Math.sin(clock.t * 5.2) * 0.04
    yuvi.update(
      clock.t, reduceMotion, yuviFlight.active || hovering,
      horizontalFlight && yuviFlight.active, leadLeft, dt,
    )
    yuvi.object.rotation.set(yuvi.flightPitch, yuviFlight.yaw, yuviFlight.bank)
    // Items: bob while up, spin the spark, step the hologram.
    for (let i = Math.max(0, focus - 3); i <= Math.min(count - 1, focus + 3); i++) {
      const pad = pads[i]
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
    index = Math.max(0, Math.min(count - 1, Math.round(index)))
    if (index === focus) return
    const previous = focus
    focus = index
    targetYuvi(previous < 0, true)
    if (previous >= 0) popItems(previous, false)
    popItems(index, true)
    dirty = true
    reportAnchor(true)
  }

  const applyStatus = (next: ProgressionStatus) => {
    status = next
    placeBeacon()
    targetYuvi()
    pads.forEach((pad, i) => {
      const state = levelState(levels[i].level, status)
      if (state === pad.state) return
      pad.state = state
      pad.ring.color.copy(stateColor(state, theme))
      pad.halo.color.copy(stateColor(state, theme))
      pad.halo.opacity = state === 'locked' ? (theme === 'light' ? 0.1 : 0.06) : (theme === 'light' ? 0.3 : 0.22)
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
    setDesign(design) {
      yuvi.dispose()
      yuvi = createRoadmapYuvi(design)
      scene.add(yuvi.object)
      placeYuvi()
      dirty = true
    },
    setTheme: applyTheme,
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
      yuvi.dispose()
      jungleStations.dispose()
      for (const pad of pads) for (const node of pad.items ?? []) node.group.traverse((o) => { if (o instanceof THREE.Sprite) o.material.dispose() })
      for (const pad of pads) pad.badge.material.dispose()
      ;[beaconHalo, mark].forEach((s) => s.material.dispose())
      for (const d of disposables) d.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
