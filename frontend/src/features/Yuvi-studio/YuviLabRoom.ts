// @ts-nocheck
/* eslint-disable */
/**
 * Yuvi Lab — a reusable three.js upgrade room.
 *
 * The studio used to be a robot floating on a flat gradient. This builds a real
 * space around him: floor, walls, ceiling, a lit upgrade platform with LED
 * rings, a workbench, shelves of spare parts, volumetric hologram projectors, a
 * ceiling service arm and side consoles. It knows nothing about Yuvi himself,
 * so the same room can later host the shop, an achievement reveal, or any other
 * "step into Yuvi's world" screen — just add your own character on top of
 * `deckY`.
 *
 * Performance rules of the house:
 *  - one shadow-casting light, everything else is baked into emissive/additive
 *  - geometries and materials are shared between repeated props
 *  - `quality: 'low'` drops the props, the motes and the shadow map
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { createRoomKit, roomItemSpec } from './RoomCatalog'
import { DEFAULT_STATIONS, type MoodId, type RoomDesign, type RoomItem, type RoomStations, type RoomStyleId, type StationId, type WallStyleId } from './RoomDesign'
export type LabRoomQuality = 'high' | 'low'

export interface LabRoomOptions {
  quality?: LabRoomQuality
  reduceMotion?: boolean
  /** World Y of the platform deck — whatever stands in the room stands here. */
  deckY?: number
  /** Initial LED / hologram accent (usually the learner's glow colour). */
  accent?: THREE.ColorRepresentation
}

export interface LabRoomBounds {
  halfX: number
  backZ: number
  frontZ: number
  floorY: number
  ceilY: number
}

/** The stations a learner walks into to open a panel. */
export type LabRoomZoneId = 'avatar' | 'room'

export interface LabRoomZone {
  id: LabRoomZoneId
  x: number
  z: number
  radius: number
}

/** A circular footprint on the floor — used for both walking and building. */
export interface LabRoomCircle {
  x: number
  z: number
  radius: number
}

export interface LabRoom {
  group: THREE.Group
  quality: LabRoomQuality
  /** Y the platform deck sits at, so callers can plant a character on it. */
  deckY: number
  /** Interior extents — keep a free camera inside these and it never clips out. */
  bounds: LabRoomBounds
  /** The one light that casts a shadow — callers point it at their character. */
  keyLight: THREE.SpotLight
  update: (t: number, dt: number) => void
  /** Assembly flash: a light ring and a puff of energy motes at a world point. */
  burst: (position: THREE.Vector3) => void
  /** Retint the LEDs, hologram edges and floor bounce. */
  setAccent: (color: THREE.ColorRepresentation) => void
  /** Walk-in stations, in floor coordinates. */
  zones: LabRoomZone[]
  /** Light up the station the learner is standing on. */
  setZoneHighlight: (id: LabRoomZoneId | null) => void
  /** Reconcile the learner's placed props with the scene (moves are cheap). */
  setUserItems: (items: RoomItem[]) => void
  /** Hologram preview of the prop about to be dropped. `null` hides it. */
  setGhost: (kind: string | null, x?: number, z?: number, rot?: number, valid?: boolean, tint?: string) => void
  /** Lit patch of floor the walkthrough points at. `aim` adds a facing arrow. */
  setTarget: (spot: { x: number; z: number; radius: number; aim?: number } | null) => void
  /** Floor, wall and lighting mood. */
  setRoomStyle: (style: { floor: RoomStyleId; wall: WallStyleId; mood: MoodId }) => void
  /** Footprints Yuvi must walk around. */
  blockers: () => LabRoomCircle[]
  /** Footprints nothing may be built on, minus the station being carried. */
  noBuildZones: (exclude?: StationId) => LabRoomCircle[]
  /** Move the walk-in stations, and everything that belongs to them. */
  setStations: (stations: RoomStations) => void
  /** uid of the placed prop under a ray, for right-click menus. */
  pickItem: (raycaster: THREE.Raycaster) => string | null
  /** The station under a ray, for right-click menus. */
  pickStation: (raycaster: THREE.Raycaster) => StationId | null
  /** World point just above a placed prop, for anchoring UI to it. */
  itemAnchor: (uid: string) => THREE.Vector3 | null
  /** World point just above a station, for anchoring UI to it. */
  stationAnchor: (id: StationId) => THREE.Vector3
  dispose: () => void
}

/**
 * Spark palette. Colour has a hierarchy here, which is what stops the room
 * reading as "grey with neon stripes":
 *   INK / WALL   — the room itself, desaturated and dark, never competing
 *   CYAN         — functional trim: edges, rails, wayfinding
 *   VIOLET       — the accent that belongs to Yuvi and the platform
 *   AMBER        — the one warm note, reserved for the making/craft corner
 */
const INK = 0x05071a
const WALL = 0x151a42
const TRIM = 0x2a3170
const VIOLET = 0x7c5cff
const CYAN = 0x4eeef0
const AMBER = 0xff9d5c
const WOOD = 0x2e1d13

/** How far in front of the room bench the learner stands to use it. */
const STAND_OFFSET = 1.95

/** The spot a learner occupies to use the bench at `bench`. */
export function roomStandingSpot(bench: { x: number; z: number; rot?: number }): { x: number; z: number } {
  const rot = bench.rot ?? DEFAULT_STATIONS.room.rot
  return {
    x: bench.x + Math.sin(rot) * STAND_OFFSET,
    z: bench.z + Math.cos(rot) * STAND_OFFSET,
  }
}

/** Footprint each station needs clear around it. */
export const STATION_RADIUS: Record<StationId, number> = { avatar: 1.5, room: 1.4, explore: 1.4, mission: 1.0 }

/**
 * Placed props are built at catalog scale and then grown, so one number covers
 * the meshes, the contact blobs, the drop ghost and every collision radius.
 */
export const PROP_SCALE = 1.75

/**
 * Cheap capability probe. Weak machines get the reduced-effects room instead of
 * a slideshow; `prefers-reduced-motion` also implies "keep it calm".
 */
export function detectLabQuality(): LabRoomQuality {
  if (typeof window === 'undefined') return 'low'
  const nav = window.navigator as any
  if (nav?.deviceMemory && nav.deviceMemory <= 4) return 'low'
  if (nav?.hardwareConcurrency && nav.hardwareConcurrency <= 4) return 'low'
  if (window.matchMedia?.('(max-width: 720px)').matches) return 'low'
  return 'high'
}

export function createYuviLabRoom(scene: THREE.Scene, options: LabRoomOptions = {}): LabRoom {
  const quality: LabRoomQuality = options.quality ?? 'high'
  const rich = quality === 'high'
  const reduceMotion = options.reduceMotion ?? false
  const deckY = options.deckY ?? -0.92
  const accent = new THREE.Color(options.accent ?? VIOLET)

  // Room box. The side walls converge to the edges of a 30° frame right at the
  // back wall, which is what gives the shot its one-point-perspective depth.
  // The shell was authored at 12.2 × 19.5 × 5.5 m and then grown — twice as
  // wide, half again as deep, a storey taller — so a learner walking it reads
  // the studio as a hall rather than a booth. Everything anchored to the shell
  // below is moved out by the same factors.
  const FLOOR_Y = deckY - 0.13
  const HALF_X = 12.2
  const BACK_Z = -12.9
  const FRONT_Z = 16.35
  const CEIL_Y = FLOOR_Y + 7
  const DEPTH = FRONT_Z - BACK_Z
  const MID_Z = (FRONT_Z + BACK_Z) / 2
  const bounds: LabRoomBounds = { halfX: HALF_X, backZ: BACK_Z, frontZ: FRONT_Z, floorY: FLOOR_Y, ceilY: CEIL_Y }

  const group = new THREE.Group()
  scene.add(group)

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T>(...items: T[]): T => {
    for (const item of items) disposables.push(item as any)
    return items[0]
  }
  const updaters: Array<(t: number, dt: number) => void> = []

  // ────────────────────────────────────────────────────────────────────────
  // Texture helpers
  // ────────────────────────────────────────────────────────────────────────
  const canvasOf = (w: number, h: number) => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    return { canvas, ctx: canvas.getContext('2d')! }
  }
  const finish = (canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1) => {
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeatX, repeatY)
    texture.anisotropy = rich ? 4 : 1
    return track(texture)
  }
  const radialTexture = (inner: string, outer: string) => {
    const { canvas, ctx } = canvasOf(128, 128)
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    gradient.addColorStop(0, inner)
    gradient.addColorStop(1, outer)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 128, 128)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return track(texture)
  }

  /** Per-vertex alpha for additive meshes: black edges dissolve into the room. */
  const fadeVertically = (geo: THREE.BufferGeometry, halfHeight: number, power: number) => {
    const position = geo.attributes.position
    const colors = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) {
      const k = Math.pow(Math.max(0, 1 - Math.abs(position.getY(i)) / halfHeight), power)
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }
  const fadeRadially = (geo: THREE.BufferGeometry, maxRadius: number, power: number) => {
    const position = geo.attributes.position
    const colors = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) {
      const d = Math.hypot(position.getX(i), position.getY(i)) / maxRadius
      const k = Math.pow(Math.max(0, 1 - d), power)
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }

  // ────────────────────────────────────────────────────────────────────────
  // Shell: floor, walls, ceiling
  // ────────────────────────────────────────────────────────────────────────

  /** Bulkhead panelling — big seams plus a few brighter service hatches. */
  const wallTexture = (() => {
    const size = rich ? 512 : 256
    const { canvas, ctx } = canvasOf(size, size)
    ctx.fillStyle = '#141936'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = 'rgba(150, 178, 255, 0.10)'
    ctx.lineWidth = Math.max(1, size / 256)
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * size
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke()
    }
    ctx.fillStyle = 'rgba(120, 150, 255, 0.045)'
    ctx.fillRect(size * 0.06, size * 0.30, size * 0.38, size * 0.18)
    ctx.fillRect(size * 0.56, size * 0.62, size * 0.32, size * 0.14)
    ctx.fillStyle = 'rgba(126, 92, 255, 0.10)'
    ctx.fillRect(size * 0.06, size * 0.30, size * 0.38, size * 0.012)
    ctx.fillStyle = 'rgba(78, 238, 240, 0.10)'
    ctx.fillRect(size * 0.56, size * 0.62, size * 0.32, size * 0.012)
    return finish(canvas, 6, 2.6)
  })()

  const wallMat = track(new THREE.MeshStandardMaterial({
    map: wallTexture, color: 0x0e1230, roughness: 0.88, metalness: 0.18, envMapIntensity: 0.14,
  }))

  const addWall = (w: number, h: number, position: [number, number, number], rotY: number) => {
    const geo = track(new THREE.PlaneGeometry(w, h))
    const mesh = new THREE.Mesh(geo, wallMat)
    mesh.position.set(...position)
    mesh.rotation.y = rotY
    mesh.receiveShadow = rich
    group.add(mesh)
    return mesh
  }
  // The back wall is built as four segments around a panoramic opening rather
  // than one flat slab. That hole is the single most important decision in the
  // room: it turns the wall behind Yuvi from dead space into the view.
  const OPEN_HALF_X = 8.4
  const OPEN_Y0 = FLOOR_Y + 1.1
  const OPEN_Y1 = FLOOR_Y + 4.95
  addWall(HALF_X * 2, OPEN_Y0 - FLOOR_Y, [0, (OPEN_Y0 + FLOOR_Y) / 2, BACK_Z], 0)
  addWall(HALF_X * 2, CEIL_Y - OPEN_Y1, [0, (CEIL_Y + OPEN_Y1) / 2, BACK_Z], 0)
  for (const side of [-1, 1]) {
    addWall(HALF_X - OPEN_HALF_X, OPEN_Y1 - OPEN_Y0,
      [side * (OPEN_HALF_X + (HALF_X - OPEN_HALF_X) / 2), (OPEN_Y1 + OPEN_Y0) / 2, BACK_Z], 0)
  }
  addWall(DEPTH, CEIL_Y - FLOOR_Y, [-HALF_X, (CEIL_Y + FLOOR_Y) / 2, MID_Z], Math.PI / 2)
  addWall(DEPTH, CEIL_Y - FLOOR_Y, [HALF_X, (CEIL_Y + FLOOR_Y) / 2, MID_Z], -Math.PI / 2)

  // Polished floor. Deliberately unlit: any PBR deck under this rig picks up
  // the environment probe and the fills and settles into the flat mid-grey that
  // made the room read like a 3D viewport. Painting the deck instead gives
  // exact control — a near-black slab with a soft warm-to-cool falloff and a
  // wet sheen towards the window — and the additive pools, zone rings and
  // reflection smear supply the polish on top.
  const floorGeo = track(new THREE.PlaneGeometry(HALF_X * 2, DEPTH))
  const floorTexture = (() => {
    const { canvas, ctx } = canvasOf(256, 256)
    ctx.fillStyle = '#04060f'
    ctx.fillRect(0, 0, 256, 256)
    // v = 0 is the far edge (the window). A gentle sheen there reads as the
    // deck catching the daylight, and sells the surface as polished.
    const sheen = ctx.createLinearGradient(0, 0, 0, 256)
    sheen.addColorStop(0, 'rgba(140,164,235,0.55)')
    sheen.addColorStop(0.22, 'rgba(74,88,150,0.2)')
    sheen.addColorStop(0.55, 'rgba(30,35,78,0.1)')
    sheen.addColorStop(1, 'rgba(38,44,94,0.14)')
    ctx.fillStyle = sheen
    ctx.fillRect(0, 0, 256, 256)
    // Faint horizontal banding: polished slabs, not one endless surface.
    ctx.strokeStyle = 'rgba(150,170,235,0.07)'
    ctx.lineWidth = 1
    for (let i = 1; i < 8; i += 1) {
      ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(256, i * 32); ctx.stroke()
    }
    return finish(canvas, 1, 1)
  })()
  const floorMat = track(new THREE.MeshBasicMaterial({ map: floorTexture }))
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, FLOOR_Y, MID_Z)
  group.add(floor)

  // Shadow reception moves to its own catcher, since the painted deck cannot
  // receive one. This is what puts real contact shadows under Yuvi's platform.
  if (rich) {
    const shadowCatcher = new THREE.Mesh(floorGeo, track(new THREE.ShadowMaterial({ opacity: 0.6 })))
    shadowCatcher.rotation.x = -Math.PI / 2
    shadowCatcher.position.set(0, FLOOR_Y + 0.002, MID_Z)
    shadowCatcher.receiveShadow = true
    group.add(shadowCatcher)
  }

  // Inlaid floor grid, brightest around the platform and gone by the walls.
  const gridTexture = (() => {
    const { canvas, ctx } = canvasOf(128, 128)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.shadowColor = 'rgba(255,255,255,0.7)'
    ctx.shadowBlur = 5
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(1, 0); ctx.lineTo(1, 128)
    ctx.moveTo(0, 1); ctx.lineTo(128, 1)
    ctx.stroke()
    return finish(canvas, 22, 21)
  })()
  const gridGeo = track(new THREE.PlaneGeometry(HALF_X * 2, DEPTH, 24, 24))
  fadeRadially(gridGeo, HALF_X * 1.95, 1.5)
  // Barely there. The grid used to shout "3D software viewport"; now it is a
  // faint inlay you only notice near the platform.
  const gridMat = track(new THREE.MeshBasicMaterial({
    map: gridTexture, color: 0x5a4bd6, transparent: true, opacity: 0.11,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, vertexColors: true,
  }))
  const grid = new THREE.Mesh(gridGeo, gridMat)
  grid.rotation.x = -Math.PI / 2
  grid.position.set(0, FLOOR_Y + 0.004, MID_Z)
  group.add(grid)

  const ceilGeo = track(new THREE.PlaneGeometry(HALF_X * 2, DEPTH))
  // Low env intensity, like the walls: a default probe reflection turns the
  // ceiling into a blown-out grey sky, which first person looks straight at.
  const ceilMat = track(new THREE.MeshStandardMaterial({
    color: 0x0b0e28, roughness: 0.94, metalness: 0.08, envMapIntensity: 0.12,
  }))
  const ceiling = new THREE.Mesh(ceilGeo, ceilMat)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.set(0, CEIL_Y, MID_Z)
  group.add(ceiling)

  // ── Lit zones ────────────────────────────────────────────────────────────
  // Everything below is emissive geometry, not lights: it reads as architecture
  // that glows, and costs nothing per-frame.
  const stripGeo = track(new THREE.BoxGeometry(1, 1, 1))
  const accentStripMat = track(new THREE.MeshBasicMaterial({ color: accent.clone(), toneMapped: false }))
  const coolStripMat = track(new THREE.MeshBasicMaterial({ color: CYAN, toneMapped: false }))
  // Background-tier trim: present, but never bright enough to pull the eye.
  const dimStripMat = track(new THREE.MeshBasicMaterial({ color: 0x1b4f66, toneMapped: false }))
  const warmStripMat = track(new THREE.MeshBasicMaterial({ color: AMBER, toneMapped: false }))
  const addStrip = (mat: THREE.Material, scale: [number, number, number], position: [number, number, number]) => {
    const mesh = new THREE.Mesh(stripGeo, mat)
    mesh.scale.set(...scale)
    mesh.position.set(...position)
    group.add(mesh)
    return mesh
  }
  // Skirting light where each wall meets the floor — the classic "lab" read,
  // kept dim so it grounds the room instead of drawing attention to it.
  addStrip(dimStripMat, [HALF_X * 2 - 0.1, 0.03, 0.05], [0, FLOOR_Y + 0.09, BACK_Z + 0.05])
  addStrip(dimStripMat, [0.05, 0.03, DEPTH * 0.72], [-HALF_X + 0.05, FLOOR_Y + 0.09, MID_Z - 0.6])
  addStrip(dimStripMat, [0.05, 0.03, DEPTH * 0.72], [HALF_X - 0.05, FLOOR_Y + 0.09, MID_Z - 0.6])
  // Ceiling bars over the bay, hung low enough to appear when the camera lifts.
  const ceilBarMat = track(new THREE.MeshBasicMaterial({ color: 0xd7dcff, toneMapped: false }))
  const ceilBars: THREE.Mesh[] = []
  for (const z of rich ? [-9, -4.35, 0.75, 5.4] : [-4.35]) {
    ceilBars.push(addStrip(ceilBarMat, [HALF_X * 1.5, 0.06, 0.16], [0, CEIL_Y - 0.42, z]))
  }
  const ceilHaloGeo = track(new THREE.PlaneGeometry(HALF_X * 1.7, 1.5))
  const ceilHaloTex = radialTexture('rgba(180,196,255,0.5)', 'rgba(180,196,255,0)')
  const ceilHaloMat = track(new THREE.MeshBasicMaterial({
    map: ceilHaloTex, transparent: true, opacity: 0.2, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }))
  for (const bar of ceilBars) {
    const halo = new THREE.Mesh(ceilHaloGeo, ceilHaloMat)
    halo.rotation.x = Math.PI / 2
    halo.position.set(0, bar.position.y - 0.12, bar.position.z)
    group.add(halo)
  }

  // Approach lines inlaid in the floor, guiding the eye to the platform.
  for (const x of [-4.2, 4.2]) {
    addStrip(dimStripMat, [0.03, 0.012, 10.5], [x, FLOOR_Y + 0.012, 6.3])
  }

  // ────────────────────────────────────────────────────────────────────────
  // The upgrade platform
  // ────────────────────────────────────────────────────────────────────────
  // Everything the platform owns lives under one node, because the learner can
  // pick the whole station up and put it somewhere else.
  const platform = new THREE.Group()
  group.add(platform)
  const podium = new THREE.Group()
  podium.position.y = deckY
  platform.add(podium)

  const baseGeo = track(new THREE.CylinderGeometry(1.24, 1.34, 0.13, 56))
  const baseMat = track(new THREE.MeshPhysicalMaterial({
    color: 0x211f4e, roughness: 0.34, metalness: 0.62,
    clearcoat: 1, clearcoatRoughness: 0.22, envMapIntensity: 1,
  }))
  const base = new THREE.Mesh(baseGeo, baseMat)
  base.position.y = -0.075
  base.receiveShadow = rich
  podium.add(base)

  const deckGeo = track(new THREE.CylinderGeometry(1.16, 1.16, 0.05, 56))
  const deckMat = track(new THREE.MeshPhysicalMaterial({
    color: 0x171441, roughness: 0.05, metalness: 0.8,
    clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4,
  }))
  const deck = new THREE.Mesh(deckGeo, deckMat)
  deck.position.y = 0.005
  deck.receiveShadow = rich
  podium.add(deck)

  // Two LED rings: a fixed rim and an inner ring that slowly counter-rotates.
  const ledGeo = track(new THREE.TorusGeometry(1.19, 0.028, 10, 84))
  const ledMat = track(new THREE.MeshStandardMaterial({
    color: accent.clone(), emissive: accent.clone(), emissiveIntensity: 1.5,
    roughness: 0.3, toneMapped: false,
  }))
  const led = new THREE.Mesh(ledGeo, ledMat)
  led.rotation.x = Math.PI / 2
  led.position.y = 0.008
  podium.add(led)

  const innerRingGeo = track(new THREE.RingGeometry(0.74, 0.94, 64, 1, 0, Math.PI * 1.55))
  const innerRingMat = track(new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  }))
  const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat)
  innerRing.rotation.x = -Math.PI / 2
  innerRing.position.y = 0.038
  podium.add(innerRing)

  // Soft contact shadow. Even with a real shadow map this keeps the feet from
  // floating when the character drifts on its idle bob.
  const contactTex = radialTexture('rgba(6,4,26,0.72)', 'rgba(6,4,26,0)')
  const contactGeo = track(new THREE.PlaneGeometry(1.9, 1.9))
  const contactMat = track(new THREE.MeshBasicMaterial({
    map: contactTex, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false,
  }))
  const contactShadow = new THREE.Mesh(contactGeo, contactMat)
  contactShadow.rotation.x = -Math.PI / 2
  contactShadow.position.y = 0.034
  podium.add(contactShadow)

  // Faked reflection: a vertical smear of accent light on the deck in front of
  // the platform, which is what a polished floor does under a lit subject.
  const reflectTex = radialTexture('rgba(255,255,255,0.55)', 'rgba(255,255,255,0)')
  const reflectGeo = track(new THREE.PlaneGeometry(1.5, 3.4))
  const reflectMat = track(new THREE.MeshBasicMaterial({
    map: reflectTex, color: accent.clone(), transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }))
  const reflection = new THREE.Mesh(reflectGeo, reflectMat)
  reflection.rotation.x = -Math.PI / 2
  reflection.position.set(0, FLOOR_Y + 0.008, 2.1)
  platform.add(reflection)

  // Floor bloom pooling out from under the platform.
  const poolTex = radialTexture('rgba(255,255,255,0.5)', 'rgba(255,255,255,0)')
  const poolGeo = track(new THREE.PlaneGeometry(9.6, 9.6))
  const poolMat = track(new THREE.MeshBasicMaterial({
    map: poolTex, color: accent.clone(), transparent: true, opacity: 0.24, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }))
  const pool = new THREE.Mesh(poolGeo, poolMat)
  pool.rotation.x = -Math.PI / 2
  pool.position.set(0, FLOOR_Y + 0.006, 0)
  platform.add(pool)

  // Volumetric shaft from the ceiling bars down onto the deck.
  const coneGeo = track(new THREE.CylinderGeometry(0.95, 1.9, CEIL_Y - deckY - 0.5, 28, 1, true))
  fadeVertically(coneGeo, (CEIL_Y - deckY - 0.5) / 2, 1.25)
  const coneMat = track(new THREE.MeshBasicMaterial({
    color: 0xffe6cf, transparent: true, opacity: 0.042, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide, vertexColors: true,
  }))
  const cone = new THREE.Mesh(coneGeo, coneMat)
  cone.position.set(0, deckY + (CEIL_Y - deckY - 0.5) / 2, 0)
  platform.add(cone)

  // ────────────────────────────────────────────────────────────────────────
  // Props: workbench, shelves, consoles, holograms
  // ────────────────────────────────────────────────────────────────────────
  const metalMat = track(new THREE.MeshStandardMaterial({ color: 0x1d2350, roughness: 0.52, metalness: 0.62, envMapIntensity: 0.45 }))
  const darkMat = track(new THREE.MeshStandardMaterial({ color: 0x11142f, roughness: 0.68, metalness: 0.4, envMapIntensity: 0.35 }))
  // Four distinct surfaces instead of one plastic. Brushed steel, dark wood and
  // glass are what stop the props reading as untextured blockout geometry.
  const brushedMat = track(new THREE.MeshPhysicalMaterial({
    color: 0x39406e, roughness: 0.34, metalness: 0.95,
    clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.9,
  }))
  const woodMat = track(new THREE.MeshStandardMaterial({
    color: WOOD, roughness: 0.74, metalness: 0.04, envMapIntensity: 0.25,
  }))
  const glassMat = track(new THREE.MeshPhysicalMaterial({
    color: 0x9fd8ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.15,
    clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6, side: THREE.DoubleSide,
  }))
  const partMats = [
    track(new THREE.MeshStandardMaterial({ color: 0xe8eaff, roughness: 0.3, metalness: 0.2 })),
    track(new THREE.MeshStandardMaterial({ color: 0x6f5cff, roughness: 0.4, metalness: 0.45 })),
    track(new THREE.MeshStandardMaterial({ color: 0x2ec8d6, roughness: 0.35, metalness: 0.5 })),
  ]
  const boxGeo = track(new THREE.BoxGeometry(1, 1, 1))
  const cylGeo = track(new THREE.CylinderGeometry(0.5, 0.5, 1, 16))
  const sphereGeo = track(new THREE.SphereGeometry(0.5, 16, 12))
  const torusGeo = track(new THREE.TorusGeometry(0.4, 0.13, 10, 20))

  const addBox = (parent: THREE.Object3D, mat: THREE.Material, s: number[], p: number[], rotY = 0) => {
    const mesh = new THREE.Mesh(boxGeo, mat)
    mesh.scale.set(s[0], s[1], s[2])
    mesh.position.set(p[0], p[1], p[2])
    mesh.rotation.y = rotY
    mesh.castShadow = false
    mesh.receiveShadow = false
    parent.add(mesh)
    return mesh
  }

  /** Real thickness and softened corners — the cheapest cure for "blockout". */
  const roundedCache = new Map<string, THREE.BufferGeometry>()
  const roundedGeo = (w: number, h: number, d: number, r: number) => {
    const key = `${w}|${h}|${d}|${r}`
    let geo = roundedCache.get(key)
    if (!geo) {
      geo = track(new RoundedBoxGeometry(w, h, d, rich ? 3 : 1, r))
      roundedCache.set(key, geo)
    }
    return geo
  }
  const addRounded = (parent: THREE.Object3D, mat: THREE.Material, s: number[], p: number[], r = 0.05, rotY = 0) => {
    const mesh = new THREE.Mesh(roundedGeo(s[0], s[1], s[2], r), mat)
    mesh.position.set(p[0], p[1], p[2])
    mesh.rotation.y = rotY
    parent.add(mesh)
    return mesh
  }

  // Grounding. Props with no shadow float; a soft blob under each station is
  // far cheaper than putting them all in the shadow map.
  const propShadowTex = radialTexture('rgba(3,4,16,0.9)', 'rgba(3,4,16,0)')
  const propShadowMat = track(new THREE.MeshBasicMaterial({
    map: propShadowTex, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false,
  }))
  const addPropShadow = (w: number, d: number, x: number, z: number) => {
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(w, d)), propShadowMat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, FLOOR_Y + 0.006, z)
    group.add(mesh)
    return mesh
  }

  // A light ring inlaid in the floor under each station: wayfinding that says
  // "this is a place", and it breaks up the empty deck between zones.
  const zoneRingGeo = track(new THREE.RingGeometry(0.94, 1, 56))
  const addZoneRing = (color: THREE.ColorRepresentation, x: number, z: number, radius: number, opacity = 0.5) => {
    const mat = track(new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    }))
    const ring = new THREE.Mesh(zoneRingGeo, mat)
    ring.rotation.x = -Math.PI / 2
    ring.scale.setScalar(radius)
    ring.position.set(x, FLOOR_Y + 0.014, z)
    group.add(ring)
    return ring
  }

  // ────────────────────────────────────────────────────────────────────────
  // The room-design bench and the scenery around it
  // ────────────────────────────────────────────────────────────────────────
  // Every zone has to answer "what happens here?" — decoration that doesn't is
  // just clutter competing with Yuvi.
  //   front-left  → MAKE     : the room-design bench the learner walks up to
  //   right       → EXPLORE  : globe plinth, digital library, an artefact
  //   front-right → MISSION  : kiosk showing the active challenge
  // The lit platform in the middle of the room belongs to Yuvi himself; room
  // decorating happens at this bench, so there is only ever one platform.
  const EXPLORE_AT: [number, number] = [8.8, -7.5]
  const MISSION_AT: [number, number] = [5.6, -3.3]

  // Live station positions. `setStations` moves everything that hangs off them.
  const stations: RoomStations = {
    avatar: { ...DEFAULT_STATIONS.avatar },
    room: { ...DEFAULT_STATIONS.room },
    explore: { ...DEFAULT_STATIONS.explore },
    mission: { ...DEFAULT_STATIONS.mission },
  }
  // The bench and its floor shadow move as one.
  const bench = new THREE.Group()
  group.add(bench)
  let explore: THREE.Group | null = null
  let mission: THREE.Group | null = null
  let exploreShadow: THREE.Mesh | null = null
  let missionShadow: THREE.Mesh | null = null

  if (rich) {
    // ── MAKE ───────────────────────────────────────────────────────────────
    // The one warm corner in the room. Wood, amber under-light and physical
    // material pots exist to break the wall-to-wall violet/cyan.
    const make = bench
    const benchShadow = addPropShadow(3.4, 3.4, 0, 0)
    benchShadow.position.set(0, 0.006, 0)
    bench.add(benchShadow)

    addRounded(make, woodMat, [2.9, 0.13, 1.08], [0, 0.95, 0], 0.055)
    for (const sx of [-1.28, 1.28]) addRounded(make, brushedMat, [0.14, 0.9, 0.86], [sx, 0.45, 0], 0.04)
    addRounded(make, darkMat, [2.3, 0.52, 0.78], [0, 0.44, -0.08], 0.05)
    addBox(make, warmStripMat, [2.7, 0.018, 0.03], [0, 0.86, 0.52])

    // Tool rail — hung, not floating, with a shelf lip above it.
    addRounded(make, brushedMat, [2.6, 0.06, 0.08], [0, 1.94, -0.44], 0.03)
    for (let i = 0; i < 5; i++) {
      const tool = new THREE.Mesh(cylGeo, partMats[i % 3])
      tool.scale.set(0.055, 0.4, 0.055)
      tool.position.set(-0.98 + i * 0.49, 1.72, -0.44)
      tool.rotation.z = 0.1 - (i % 2) * 0.2
      make.add(tool)
    }

    // Material pots. Real objects carrying the palette beats painting the walls.
    const potColors = [AMBER, VIOLET, CYAN, 0xff6f9c, 0x8ef2b0]
    potColors.forEach((hex, i) => {
      const pot = new THREE.Mesh(cylGeo, brushedMat)
      pot.scale.set(0.15, 0.22, 0.15)
      pot.position.set(-1.06 + i * 0.3, 1.12, 0.3)
      make.add(pot)
      const fill = new THREE.Mesh(cylGeo, track(new THREE.MeshBasicMaterial({ color: hex, toneMapped: false })))
      fill.scale.set(0.125, 0.02, 0.125)
      fill.position.set(pot.position.x, 1.225, 0.3)
      make.add(fill)
    })

    // Small angled readout at the end of the bench.
    const benchScreen = new THREE.Mesh(track(new THREE.PlaneGeometry(0.86, 0.46)), consoleScreenMat())
    benchScreen.position.set(0.94, 1.32, -0.2)
    benchScreen.rotation.set(-0.3, -0.25, 0)
    make.add(benchScreen)
    addRounded(make, darkMat, [0.1, 0.32, 0.1], [0.94, 1.14, -0.22], 0.03)

    // ── EXPLORE ────────────────────────────────────────────────────────────
    explore = new THREE.Group()
    explore.position.set(EXPLORE_AT[0], FLOOR_Y, EXPLORE_AT[1])
    explore.rotation.y = -0.7
    group.add(explore)
    // No lit ring here: only the platform and the room bench are walk-in
    // stations, and a glowing pad under scenery reads as one.
    exploreShadow = addPropShadow(3.4, 2.6, EXPLORE_AT[0], EXPLORE_AT[1])

    // Plinth for the holo globe: heavy base, glass collar, inset trim.
    addRounded(explore, brushedMat, [1.5, 0.92, 1.5], [0, 0.46, 0], 0.09)
    addRounded(explore, darkMat, [1.32, 0.14, 1.32], [0, 1.0, 0], 0.05)
    addBox(explore, coolStripMat, [1.34, 0.02, 0.03], [0, 0.9, 0.76])
    const collar = new THREE.Mesh(cylGeo, glassMat)
    collar.scale.set(1.18, 0.1, 1.18)
    collar.position.y = 1.08
    explore.add(collar)

    // Digital library: glowing slabs racked at an angle behind the plinth.
    const library = new THREE.Group()
    library.position.set(0, 0, -1.15)
    explore.add(library)
    addRounded(library, darkMat, [2.1, 1.7, 0.5], [0, 0.85, 0], 0.06)
    addRounded(library, brushedMat, [2.0, 0.06, 0.46], [0, 1.02, 0.03], 0.02)
    const spineColors = [0x7fe4ff, 0xa896ff, 0xffb374, 0x8ef2b0, 0x7fe4ff, 0xff8fd0]
    spineColors.forEach((hex, i) => {
      const slab = new THREE.Mesh(roundedGeo(0.14, 0.66, 0.36, 0.03), darkMat)
      slab.position.set(-0.78 + i * 0.31, 1.38, 0.05)
      slab.rotation.z = (i % 2 ? 1 : -1) * 0.07
      library.add(slab)
      const spine = new THREE.Mesh(boxGeo, track(new THREE.MeshBasicMaterial({ color: hex, toneMapped: false })))
      spine.scale.set(0.03, 0.5, 0.02)
      spine.position.set(slab.position.x, 1.38, 0.24)
      spine.rotation.z = slab.rotation.z
      library.add(spine)
    })
    addBox(library, dimStripMat, [1.96, 0.018, 0.02], [0, 1.06, 0.24])

    // A found artefact under a glass dome — the "we discovered this" beat.
    // Parked on the outer edge of the plinth so it never floats in frame
    // beside Yuvi's head.
    const domeBase = new THREE.Mesh(cylGeo, brushedMat)
    domeBase.scale.set(0.3, 0.09, 0.3)
    domeBase.position.set(0.86, 1.12, 0.52)
    explore.add(domeBase)
    const artefact = new THREE.Mesh(torusGeo, partMats[2])
    artefact.scale.setScalar(0.26)
    artefact.position.set(0.86, 1.26, 0.52)
    artefact.rotation.x = 0.9
    explore.add(artefact)
    const dome = new THREE.Mesh(sphereGeo, glassMat)
    dome.scale.setScalar(0.42)
    dome.position.set(0.86, 1.24, 0.52)
    explore.add(dome)
    updaters.push((t) => { artefact.rotation.y = t * 0.35 })

    // ── MISSION ────────────────────────────────────────────────────────────
    // A kiosk angled at the platform, mid-ground on the right. It reads as the
    // secondary focus: something is waiting to be done.
    mission = new THREE.Group()
    mission.position.set(MISSION_AT[0], FLOOR_Y, MISSION_AT[1])
    mission.rotation.y = -0.72
    mission.scale.setScalar(0.82)
    group.add(mission)
    missionShadow = addPropShadow(2.4, 2.4, MISSION_AT[0], MISSION_AT[1])

    addRounded(mission, brushedMat, [1.4, 0.14, 0.92], [0, 0.07, 0], 0.05)
    addBox(mission, accentStripMat, [1.2, 0.018, 0.03], [0, 0.14, 0.44])
    const totem = new THREE.Group()
    totem.position.y = 0.12
    totem.rotation.x = -0.1
    mission.add(totem)
    addRounded(totem, darkMat, [1.24, 2.05, 0.2], [0, 1.02, 0], 0.09)
    addRounded(totem, brushedMat, [1.32, 0.12, 0.26], [0, 2.06, 0], 0.05)
    const missionScreen = missionScreenMat()
    const kiosk = new THREE.Mesh(track(new THREE.PlaneGeometry(1.04, 1.5)), missionScreen.material)
    kiosk.position.set(0, 1.16, 0.11)
    totem.add(kiosk)
    const kioskGlow = new THREE.Mesh(track(new THREE.PlaneGeometry(1.7, 2.2)), track(new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(150,180,255,0.35)', 'rgba(150,180,255,0)'),
      transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    })))
    kioskGlow.position.set(0, 1.16, 0.06)
    totem.add(kioskGlow)
    updaters.push(missionScreen.update)
  }

  // ────────────────────────────────────────────────────────────────────────
  // The window — the room's primary element
  // ────────────────────────────────────────────────────────────────────────
  // A dark empty wall behind the character wastes the most valuable surface in
  // the shot. Instead: a real opening with thickness, a vista sitting metres
  // further back, and a learning path arcing over Yuvi's head. Everything else
  // in the room is quieter than this.

  /** Painted once. Layered silhouettes + haze do the depth, not geometry. */
  const vistaTexture = (() => {
    const W = rich ? 1024 : 512
    const H = W / 2
    const { canvas, ctx } = canvasOf(W, H)

    const sky = ctx.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, '#070a24')
    sky.addColorStop(0.42, '#1b1c53')
    sky.addColorStop(0.68, '#3d2a6b')
    sky.addColorStop(0.86, '#7a4a86')
    sky.addColorStop(1, '#2a2358')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, W, H)

    // Stars, thinning out toward the horizon.
    for (let i = 0; i < (rich ? 260 : 110); i++) {
      const y = Math.pow(Math.random(), 1.7) * H * 0.62
      ctx.globalAlpha = 0.15 + Math.random() * 0.6
      ctx.fillStyle = '#e6edff'
      ctx.fillRect(Math.random() * W, y, 1.4, 1.4)
    }
    ctx.globalAlpha = 1

    // Low sun behind the ridge — the warm note that keeps the vista from being
    // one more violet gradient.
    const sunX = W * 0.68, sunY = H * 0.7
    const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, H * 0.42)
    sun.addColorStop(0, 'rgba(255,196,140,0.95)')
    sun.addColorStop(0.25, 'rgba(255,142,120,0.35)')
    sun.addColorStop(1, 'rgba(255,120,150,0)')
    ctx.fillStyle = sun
    ctx.fillRect(0, 0, W, H)

    // Three silhouette layers: distant ridge, mid skyline, near towers.
    const layer = (baseY: number, height: number, step: number, fill: string, lights: string | null) => {
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.moveTo(0, H)
      let x = 0
      let seed = baseY * 7.3
      while (x < W) {
        const w = step * (0.6 + ((Math.sin(seed) + 1) / 2) * 0.9)
        const h = height * (0.35 + ((Math.sin(seed * 2.7) + 1) / 2) * 0.85)
        ctx.lineTo(x, baseY - h)
        ctx.lineTo(x + w, baseY - h)
        if (lights && h > height * 0.5) {
          const saved = ctx.fillStyle
          ctx.fillStyle = lights
          for (let k = 0; k < 3; k++) {
            ctx.fillRect(x + w * 0.3, baseY - h + 8 + k * (h / 5), Math.max(2, w * 0.1), 2)
          }
          ctx.fillStyle = saved
        }
        x += w
        seed += 1.31
      }
      ctx.lineTo(W, H)
      ctx.closePath()
      ctx.fill()
    }
    layer(H * 0.80, H * 0.13, W * 0.11, 'rgba(52,44,104,0.75)', null)
    layer(H * 0.88, H * 0.20, W * 0.075, 'rgba(28,26,68,0.9)', 'rgba(160,220,255,0.5)')
    layer(H * 0.99, H * 0.26, W * 0.05, 'rgba(11,12,38,1)', 'rgba(126,220,255,0.55)')

    // Floating islands — the one storybook detail that says "Yuvi's world".
    const island = (cx: number, cy: number, r: number, alpha: number) => {
      ctx.globalAlpha = alpha
      ctx.fillStyle = '#241f57'
      ctx.beginPath()
      ctx.ellipse(cx, cy, r, r * 0.3, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(cx - r, cy)
      ctx.lineTo(cx, cy + r * 0.95)
      ctx.lineTo(cx + r, cy)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(126,220,255,0.6)'
      ctx.fillRect(cx - r * 0.15, cy - r * 0.22, r * 0.3, 3)
      ctx.globalAlpha = 1
    }
    island(W * 0.2, H * 0.42, W * 0.055, 0.85)
    island(W * 0.42, H * 0.3, W * 0.033, 0.6)
    island(W * 0.83, H * 0.38, W * 0.042, 0.7)

    // Horizon haze: aerial perspective baked in, so the vista sits far away.
    const haze = ctx.createLinearGradient(0, H * 0.6, 0, H)
    haze.addColorStop(0, 'rgba(110,120,220,0)')
    haze.addColorStop(0.6, 'rgba(96,104,200,0.28)')
    haze.addColorStop(1, 'rgba(60,64,150,0.45)')
    ctx.fillStyle = haze
    ctx.fillRect(0, H * 0.55, W, H * 0.45)

    return finish(canvas, 1, 1)
  })()

  const VISTA_Z = BACK_Z - 3.9
  const vistaMat = track(new THREE.MeshBasicMaterial({ map: vistaTexture, toneMapped: false, fog: false }))
  const vista = new THREE.Mesh(track(new THREE.PlaneGeometry(26, 8.3)), vistaMat)
  vista.position.set(0, OPEN_Y0 + 1.46, VISTA_Z)
  group.add(vista)

  // Reveal: the opening has real depth, so the wall reads as thick.
  const revealMat = track(new THREE.MeshStandardMaterial({ color: 0x0c1030, roughness: 0.85, metalness: 0.35 }))
  const REVEAL_D = 0.55
  const revealAt = (w: number, h: number, p: [number, number, number], rx: number, ry: number) => {
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), revealMat)
    mesh.position.set(...p)
    mesh.rotation.set(rx, ry, 0)
    mesh.receiveShadow = false
    group.add(mesh)
  }
  revealAt(OPEN_HALF_X * 2, REVEAL_D, [0, OPEN_Y1, BACK_Z - REVEAL_D / 2], Math.PI / 2, 0)
  revealAt(OPEN_HALF_X * 2, REVEAL_D, [0, OPEN_Y0, BACK_Z - REVEAL_D / 2], -Math.PI / 2, 0)
  for (const side of [-1, 1]) {
    revealAt(REVEAL_D, OPEN_Y1 - OPEN_Y0, [side * OPEN_HALF_X, (OPEN_Y0 + OPEN_Y1) / 2, BACK_Z - REVEAL_D / 2], 0, side * -Math.PI / 2)
  }

  // Bezel + mullions: architecture, and it gives the eye something structural
  // to read the window against instead of a floating rectangle of light.
  const frame = new THREE.Group()
  frame.position.z = BACK_Z + 0.05
  group.add(frame)
  addRounded(frame, brushedMat, [OPEN_HALF_X * 2 + 0.34, 0.17, 0.16], [0, OPEN_Y1 + 0.07, 0], 0.05)
  addRounded(frame, brushedMat, [OPEN_HALF_X * 2 + 0.34, 0.22, 0.22], [0, OPEN_Y0 - 0.1, 0], 0.06)
  for (const side of [-1, 1]) {
    addRounded(frame, brushedMat, [0.17, OPEN_Y1 - OPEN_Y0 + 0.3, 0.16], [side * (OPEN_HALF_X + 0.07), (OPEN_Y0 + OPEN_Y1) / 2, 0], 0.05)
  }
  for (const x of [-1.62, 1.62]) {
    addRounded(frame, brushedMat, [0.075, OPEN_Y1 - OPEN_Y0, 0.1], [x, (OPEN_Y0 + OPEN_Y1) / 2, -0.02], 0.03)
  }
  // Hairline LED tucked into the bezel — light as trim, not as a highlighter.
  const bezelLedMat = track(new THREE.MeshBasicMaterial({ color: 0x6f86d8, toneMapped: false }))
  const bezelLed = (s: [number, number, number], p: [number, number, number]) => {
    const mesh = new THREE.Mesh(stripGeo, bezelLedMat)
    mesh.scale.set(...s)
    mesh.position.set(...p)
    frame.add(mesh)
  }
  bezelLed([OPEN_HALF_X * 2, 0.016, 0.02], [0, OPEN_Y1 - 0.02, 0.075])
  bezelLed([OPEN_HALF_X * 2, 0.016, 0.02], [0, OPEN_Y0 + 0.02, 0.075])

  // Glass, with a single raking sheen. Enough to read as a pane, not a filter.
  const pane = new THREE.Mesh(track(new THREE.PlaneGeometry(OPEN_HALF_X * 2, OPEN_Y1 - OPEN_Y0)), glassMat)
  pane.position.set(0, (OPEN_Y0 + OPEN_Y1) / 2, BACK_Z + 0.02)
  group.add(pane)
  const sheenTex = (() => {
    const { canvas, ctx } = canvasOf(256, 128)
    const g = ctx.createLinearGradient(0, 128, 256, 0)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.44, 'rgba(255,255,255,0)')
    g.addColorStop(0.52, 'rgba(214,232,255,0.5)')
    g.addColorStop(0.6, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 128)
    return finish(canvas, 1, 1)
  })()
  const sheenMat = track(new THREE.MeshBasicMaterial({
    map: sheenTex, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  }))
  const sheen = new THREE.Mesh(track(new THREE.PlaneGeometry(OPEN_HALF_X * 2, OPEN_Y1 - OPEN_Y0)), sheenMat)
  sheen.position.set(0, (OPEN_Y0 + OPEN_Y1) / 2, BACK_Z + 0.06)
  group.add(sheen)

  // ── Learning path hologram ───────────────────────────────────────────────
  // An arc of waypoints that dips at the sides and crests above Yuvi's head, so
  // it frames him instead of fighting him. Abstract on purpose: this is
  // atmosphere, never a claim about the learner's progress.
  const pathCurve = (() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < 9; i++) {
      const k = i / 8
      const x = -5.56 + k * 11.12
      const t = x / 5.56
      const y = OPEN_Y0 + 0.64 + 2.06 * (1 - t * t) + Math.sin(i * 1.7) * 0.07
      pts.push(new THREE.Vector3(x, y, BACK_Z + 0.42 + Math.sin(i * 0.9) * 0.06))
    }
    return { curve: new THREE.CatmullRomCurve3(pts), pts }
  })()

  const pathMat = track(new THREE.LineBasicMaterial({
    color: 0x7fe4ff, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }))
  const pathGeo = track(new THREE.BufferGeometry().setFromPoints(pathCurve.curve.getPoints(140)))
  group.add(new THREE.Line(pathGeo, pathMat))

  const nodeGeo = track(new THREE.SphereGeometry(0.045, 10, 8))
  const nodeMat = track(new THREE.MeshBasicMaterial({
    color: 0xcdeaff, transparent: true, opacity: 0.85, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }))
  const nodeHaloTex = radialTexture('rgba(160,224,255,0.85)', 'rgba(160,224,255,0)')
  const nodeHaloMat = track(new THREE.MeshBasicMaterial({
    map: nodeHaloTex, transparent: true, opacity: 0.4, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }))
  const nodeHaloGeo = track(new THREE.PlaneGeometry(0.42, 0.42))
  pathCurve.pts.forEach((p, i) => {
    const node = new THREE.Mesh(nodeGeo, nodeMat)
    node.position.copy(p)
    group.add(node)
    if (i % 2 === 0) {
      const halo = new THREE.Mesh(nodeHaloGeo, nodeHaloMat)
      halo.position.copy(p)
      halo.position.z -= 0.01
      group.add(halo)
    }
  })
  // The far waypoint gets a ring: a destination, not just another dot.
  const goalRingGeo = track(new THREE.TorusGeometry(1, 0.03, 6, 40))
  const goalRing = new THREE.Mesh(goalRingGeo, track(new THREE.MeshBasicMaterial({
    color: 0x9fd0ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  })))
  goalRing.scale.setScalar(0.2)
  goalRing.position.copy(pathCurve.pts[pathCurve.pts.length - 1])
  group.add(goalRing)

  // Light travelling the path — slow, so it registers as ambience.
  const PULSES = rich ? 3 : 1
  const pulsePos = new Float32Array(PULSES * 3)
  const pulseGeo = track(new THREE.BufferGeometry())
  pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3))
  const pulseMat = track(new THREE.PointsMaterial({
    size: 0.17, map: radialTexture('rgba(240,250,255,1)', 'rgba(150,220,255,0)'),
    transparent: true, opacity: 0.9, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }))
  const pulses = new THREE.Points(pulseGeo, pulseMat)
  pulses.frustumCulled = false
  group.add(pulses)
  const pulseVec = new THREE.Vector3()
  updaters.push((t) => {
    for (let i = 0; i < PULSES; i++) {
      const u = ((t * 0.07 + i / PULSES) % 1)
      pathCurve.curve.getPointAt(u, pulseVec)
      pulsePos[i * 3] = pulseVec.x
      pulsePos[i * 3 + 1] = pulseVec.y
      pulsePos[i * 3 + 2] = pulseVec.z + 0.02
    }
    pulseGeo.attributes.position.needsUpdate = true
    goalRing.scale.setScalar(0.19 + Math.sin(t * 1.4) * 0.02)
  })

  // ── Light spilling in from the window ────────────────────────────────────
  const windowGlowMat = track(new THREE.MeshBasicMaterial({
    map: radialTexture('rgba(150,180,255,0.45)', 'rgba(120,150,255,0)'),
    transparent: true, opacity: 0.5, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }))
  const windowGlow = new THREE.Mesh(track(new THREE.PlaneGeometry(19, 6.4)), windowGlowMat)
  windowGlow.position.set(0, (OPEN_Y0 + OPEN_Y1) / 2, BACK_Z + 0.12)
  group.add(windowGlow)

  // Volumetric shafts raking from the window into the room. This is the single
  // strongest depth cue available without post-processing — but only while they
  // stay steep. Laid down flat they stop reading as beams and just paint the
  // whole deck a uniform grey.
  const shaftMat = track(new THREE.MeshBasicMaterial({
    color: 0xa8c0ff, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide, vertexColors: true,
  }))
  if (!reduceMotion || rich) {
    for (const [x, w, yaw] of [
      [-7.0, 1.8, 0.14], [-4.0, 2.3, 0.1], [0.7, 3.1, -0.04], [4.4, 2.0, -0.12], [7.2, 1.6, -0.16],
    ] as const) {
      const geo = track(new THREE.PlaneGeometry(w, 7.1, 1, 14))
      fadeVertically(geo, 3.55, 1.35)
      const shaft = new THREE.Mesh(geo, shaftMat)
      shaft.position.set(x, OPEN_Y0 + 0.95, BACK_Z + 1.15)
      shaft.rotation.set(-0.52, yaw, 0)
      group.add(shaft)
    }
  }

  // Note: an earlier pass framed the shot with two floor-to-ceiling pylons on
  // the near plane. They read as unexplained columns standing in front of Yuvi
  // and occluded him whenever the learner orbited, so the foreground depth now
  // comes from the light shafts and fog alone.

  // ── Ceiling service arm ───────────────────────────────────────────────────
  // A slim articulated arm parked beside the platform. Nothing says "upgrade
  // bay" like real robotics hanging over the deck, and it idles rather than
  // performing, so it never competes with the character.
  let gantry: {
    shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group; tipMat: THREE.MeshBasicMaterial
  } | null = null
  if (rich) {
    const mount = new THREE.Group()
    // Hung on a drop tube: the taller ceiling would otherwise park the arm out
    // of frame, so the shoulder stays at the height it was authored for.
    const MOUNT_Y = FLOOR_Y + 5.38
    mount.position.set(-5.8, MOUNT_Y, -3.75)
    group.add(mount)
    addBox(mount, metalMat, [0.18, CEIL_Y - MOUNT_Y, 0.18], [0, (CEIL_Y - MOUNT_Y) / 2, 0])
    addBox(mount, metalMat, [0.52, 0.14, 0.52], [0, -0.07, 0])

    const shoulder = new THREE.Group()
    shoulder.position.y = -0.14
    mount.add(shoulder)
    addBox(shoulder, metalMat, [0.15, 1.2, 0.15], [0, -0.6, 0])
    addBox(shoulder, coolStripMat, [0.03, 0.9, 0.17], [0, -0.6, 0])

    const elbow = new THREE.Group()
    elbow.position.y = -1.2
    shoulder.add(elbow)
    const elbowJoint = new THREE.Mesh(sphereGeo, darkMat)
    elbowJoint.scale.setScalar(0.26)
    elbow.add(elbowJoint)
    addBox(elbow, metalMat, [0.12, 0.95, 0.12], [0, -0.5, 0])

    const wrist = new THREE.Group()
    wrist.position.y = -0.95
    elbow.add(wrist)
    const wristJoint = new THREE.Mesh(sphereGeo, darkMat)
    wristJoint.scale.setScalar(0.2)
    wrist.add(wristJoint)
    const tipRing = new THREE.Mesh(torusGeo, accentStripMat)
    tipRing.scale.set(0.5, 0.5, 0.24)
    tipRing.rotation.x = Math.PI / 2
    tipRing.position.y = -0.18
    wrist.add(tipRing)
    const tipMat = track(new THREE.MeshBasicMaterial({
      color: 0xe6ecff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }))
    const tipGlow = new THREE.Mesh(sphereGeo, tipMat)
    tipGlow.scale.setScalar(0.18)
    tipGlow.position.y = -0.2
    wrist.add(tipGlow)

    gantry = { shoulder, elbow, wrist, tipMat }
  }

  /**
   * Console readout. Deliberately minimal — hairline rules, corner ticks and a
   * single soft trace. Chunky bar charts and thick chrome bezels are exactly
   * what makes a sci-fi screen look twenty years old.
   */
  function consoleScreenMat() {
    const W = 320, H = 176
    const { canvas, ctx } = canvasOf(W, H)
    ctx.fillStyle = 'rgba(8,11,34,1)'
    ctx.fillRect(0, 0, W, H)

    ctx.strokeStyle = 'rgba(150,180,255,0.10)'
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const y = (H / 4) * i
      ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(W - 20, y); ctx.stroke()
    }

    const points: Array<[number, number]> = []
    for (let x = 20; x <= W - 20; x += 4) {
      const p = (x - 20) / (W - 40)
      const v = 0.46 + Math.sin(p * 4.3) * 0.3 + Math.sin(p * 9.1 + 1.4) * 0.09
      points.push([x, H - 28 - v * (H - 74)])
    }
    const wash = ctx.createLinearGradient(0, 18, 0, H - 22)
    wash.addColorStop(0, 'rgba(126,220,255,0.30)')
    wash.addColorStop(1, 'rgba(126,220,255,0)')
    ctx.beginPath()
    ctx.moveTo(points[0][0], H - 24)
    for (const [x, y] of points) ctx.lineTo(x, y)
    ctx.lineTo(points[points.length - 1][0], H - 24)
    ctx.closePath()
    ctx.fillStyle = wash
    ctx.fill()
    ctx.beginPath()
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.strokeStyle = 'rgba(178,238,255,0.95)'
    ctx.lineWidth = 2
    ctx.shadowColor = 'rgba(126,220,255,0.9)'
    ctx.shadowBlur = 10
    ctx.stroke()
    ctx.shadowBlur = 0

    // Corner ticks instead of a frame — the current visual language.
    ctx.strokeStyle = 'rgba(160,188,255,0.4)'
    ctx.lineWidth = 1.5
    const arm = 11, inset = 12
    const corners: Array<[number, number, number, number]> = [
      [inset, inset, 1, 1], [W - inset, inset, -1, 1],
      [inset, H - inset, 1, -1], [W - inset, H - inset, -1, -1],
    ]
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath(); ctx.moveTo(x + sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * arm); ctx.stroke()
    }
    ctx.fillStyle = 'rgba(150,120,255,0.85)'
    for (let i = 0; i < 3; i++) ctx.fillRect(W - 58 + i * 13, 18, 5, 5)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    track(texture)
    return track(new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide,
    }))
  }

  /**
   * Mission kiosk readout: a target, a sweep, and three step markers. Purely
   * graphic — no glyphs, so the room never needs translating, and no numbers,
   * so it can never imply a score. Repainted at 12fps, not every frame.
   */
  function missionScreenMat() {
    const W = 220, H = 320
    const { canvas, ctx } = canvasOf(W, H)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    track(texture)
    const material = track(new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity: 0.94, toneMapped: false, side: THREE.DoubleSide,
    }))

    const cx = W / 2, cy = H * 0.42, r = W * 0.3
    const paint = (t: number) => {
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = 'rgba(7,10,30,0.96)'
      ctx.fillRect(0, 0, W, H)

      ctx.strokeStyle = 'rgba(150,180,255,0.16)'
      ctx.lineWidth = 1
      for (const k of [0.55, 0.78, 1]) {
        ctx.beginPath(); ctx.arc(cx, cy, r * k, 0, Math.PI * 2); ctx.stroke()
      }

      // Progress arc with a bright head — reads as "in motion".
      const p = 0.24 + (Math.sin(t * 0.35) * 0.5 + 0.5) * 0.5
      ctx.beginPath()
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2)
      ctx.strokeStyle = 'rgba(150,120,255,0.9)'
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.shadowColor = 'rgba(150,120,255,0.9)'
      ctx.shadowBlur = 12
      ctx.stroke()
      ctx.shadowBlur = 0

      // Slow radar sweep inside the target.
      const a = t * 0.8
      const sweep = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      sweep.addColorStop(0, 'rgba(126,220,255,0.35)')
      sweep.addColorStop(1, 'rgba(126,220,255,0)')
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, r * 0.78, a - 0.5, a)
      ctx.closePath()
      ctx.fillStyle = sweep
      ctx.fill()

      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(224,240,255,0.95)'
      ctx.fill()

      // Three step markers: two done, one live.
      for (let i = 0; i < 3; i++) {
        const x = cx - 42 + i * 42
        const y = H * 0.78
        ctx.beginPath()
        ctx.arc(x, y, 8, 0, Math.PI * 2)
        if (i < 2) {
          ctx.fillStyle = 'rgba(126,220,255,0.85)'
          ctx.fill()
        } else {
          ctx.strokeStyle = `rgba(255,180,120,${0.5 + Math.abs(Math.sin(t * 1.6)) * 0.5})`
          ctx.lineWidth = 3
          ctx.stroke()
        }
        if (i < 2) {
          ctx.strokeStyle = 'rgba(126,220,255,0.35)'
          ctx.lineWidth = 2
          ctx.beginPath(); ctx.moveTo(x + 10, y); ctx.lineTo(x + 32, y); ctx.stroke()
        }
      }

      // Corner ticks, same language as the bench readout.
      ctx.strokeStyle = 'rgba(160,188,255,0.35)'
      ctx.lineWidth = 1.5
      const arm = 12, inset = 12
      for (const [x, y, sx, sy] of [
        [inset, inset, 1, 1], [W - inset, inset, -1, 1],
        [inset, H - inset, 1, -1], [W - inset, H - inset, -1, -1],
      ] as Array<[number, number, number, number]>) {
        ctx.beginPath(); ctx.moveTo(x + sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * arm); ctx.stroke()
      }
      texture.needsUpdate = true
    }

    paint(0)
    let acc = 0
    const update = (t: number, dt: number) => {
      if (reduceMotion) return
      acc += dt
      if (acc < 1 / 12) return
      acc = 0
      paint(t)
    }
    return { material, update }
  }

  // ── Holographic projectors ───────────────────────────────────────────────
  // Not flat "HUD panels" pinned to the wall — that reads as a 2005 screensaver.
  // Each station is an emitter puck, a light column above it, and a real
  // volumetric wireframe turning inside the beam. Abstract geometry only: this
  // is ambience, never learner data.
  interface Projector {
    form: THREE.Group
    lines: THREE.LineSegments
    lineMat: THREE.LineBasicMaterial
    shellMat: THREE.MeshBasicMaterial
    ringA: THREE.Mesh
    ringB: THREE.Mesh
    columnMat: THREE.MeshBasicMaterial
    baseY: number
    phase: number
    spin: number
  }
  const projectors: Projector[] = []

  const emitterGeo = track(new THREE.CylinderGeometry(0.3, 0.36, 0.08, 28))
  const emitterRimGeo = track(new THREE.TorusGeometry(0.29, 0.012, 8, 40))
  const holoRingGeo = track(new THREE.TorusGeometry(1, 0.007, 6, 72))

  const buildProjector = (spec: {
    pos: [number, number, number]
    radius: number
    height: number
    color: number
    detail: number
    spin: number
    phase: number
    /** Parent, when the projector belongs to something that can be moved. */
    parent?: THREE.Object3D
  }) => {
    const station = new THREE.Group()
    station.position.set(spec.pos[0], spec.pos[1], spec.pos[2])
    ;(spec.parent ?? group).add(station)

    const puck = new THREE.Mesh(emitterGeo, metalMat)
    puck.position.y = 0.04
    station.add(puck)
    const rimMat = track(new THREE.MeshBasicMaterial({ color: spec.color, toneMapped: false }))
    const rim = new THREE.Mesh(emitterRimGeo, rimMat)
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.085
    station.add(rim)

    // The beam: a wide-open cone that fades out before it reaches the ceiling.
    const columnGeo = track(new THREE.CylinderGeometry(spec.radius * 1.5, spec.radius * 0.55, spec.height, 24, 1, true))
    fadeVertically(columnGeo, spec.height / 2, 1.15)
    const columnMat = track(new THREE.MeshBasicMaterial({
      color: spec.color, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide, vertexColors: true,
    }))
    const column = new THREE.Mesh(columnGeo, columnMat)
    column.position.y = 0.1 + spec.height / 2
    station.add(column)

    const formY = 0.1 + spec.height * 0.68
    const form = new THREE.Group()
    form.position.y = formY
    station.add(form)

    // Geodesic wireframe — the shape reads as "scanned volume", not "picture".
    const solidGeo = track(new THREE.IcosahedronGeometry(spec.radius, spec.detail))
    const wireGeo = track(new THREE.WireframeGeometry(solidGeo))
    const lineMat = track(new THREE.LineBasicMaterial({
      color: spec.color, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }))
    const lines = new THREE.LineSegments(wireGeo, lineMat)
    form.add(lines)

    // A whisper of surface so the wireframe has volume instead of floating hairs.
    const shellMat = track(new THREE.MeshBasicMaterial({
      color: spec.color, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    }))
    form.add(new THREE.Mesh(solidGeo, shellMat))

    // Two hairline gyroscope rings on different axes.
    const ringMat = track(new THREE.MeshBasicMaterial({
      color: spec.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }))
    const ringA = new THREE.Mesh(holoRingGeo, ringMat)
    ringA.scale.setScalar(spec.radius * 1.45)
    ringA.rotation.x = Math.PI / 2
    form.add(ringA)
    const ringB = new THREE.Mesh(holoRingGeo, ringMat)
    ringB.scale.setScalar(spec.radius * 1.72)
    ringB.rotation.set(0.9, 0, 0.5)
    form.add(ringB)

    projectors.push({
      form, lines, lineMat, shellMat, ringA, ringB, columnMat,
      baseY: formY, phase: spec.phase, spin: spec.spin,
    })
  }

  // The holograms belong to the stations now: a model on the making turntable,
  // a globe over the explore plinth. Free-floating holograms in the corners
  // were decoration; these are what the station is for.
  const projectorSpecs = rich
    ? [
        { pos: [0, 0.98, 0] as [number, number, number], radius: 0.26, height: 0.72, color: 0xffb374, detail: 0, spin: 0.3, phase: 0, parent: bench },
        { pos: [EXPLORE_AT[0], FLOOR_Y + 1.08, EXPLORE_AT[1]] as [number, number, number], radius: 0.34, height: 0.9, color: 0x7fe4ff, detail: 1, spin: -0.18, phase: 1.9 },
      ]
    : [
        { pos: [-6.1, FLOOR_Y, -6.68] as [number, number, number], radius: 0.5, height: 1.6, color: 0x7fe4ff, detail: 1, spin: 0.2, phase: 0 },
      ]
  for (const spec of projectorSpecs) buildProjector(spec)

  // ────────────────────────────────────────────────────────────────────────
  // Lighting — a portrait rig, not room illumination
  // ────────────────────────────────────────────────────────────────────────
  // Flat, even light is what made every surface read as the same plastic. The
  // rig now has intent: a soft warm key from above on the platform, a cool rim
  // behind Yuvi that cuts him out of the background, and two low fills that own
  // one zone each so the room is not violet-and-cyan wall to wall.
  const keyLight = new THREE.SpotLight(0xfff2e4, rich ? 26 : 20, 11, 0.42, 1, 1.9)
  keyLight.position.set(0.5, CEIL_Y - 0.35, 2.3)
  keyLight.target.position.set(0, deckY + 0.7, 0)
  group.add(keyLight)
  group.add(keyLight.target)
  if (rich) {
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.camera.near = 1
    keyLight.shadow.camera.far = 12
    keyLight.shadow.bias = -0.0012
    keyLight.shadow.radius = 5
  }

  // Rim from behind and above: the single change that stops the character from
  // melting into the back wall.
  const rimLight = new THREE.SpotLight(0xbed6ff, rich ? 26 : 16, 9.5, 0.72, 1, 1.6)
  rimLight.position.set(-0.5, deckY + 2.7, -3.3)
  rimLight.target.position.set(0, deckY + 0.95, 0)
  group.add(rimLight)
  group.add(rimLight.target)

  const accentLight = new THREE.PointLight(accent.clone(), rich ? 5 : 3, 7, 2)
  accentLight.position.set(0, deckY + 0.35, 1.1)
  group.add(accentLight)

  // Zone fills. Warm on the left, cool on the right.
  const warmLight = new THREE.PointLight(AMBER, rich ? 10 : 5, 6.5, 2)
  warmLight.position.set(0.25, 1.7, 0.55)
  bench.add(warmLight)

  const coolLight = new THREE.PointLight(CYAN, rich ? 6 : 3, 7, 2)
  coolLight.position.set(EXPLORE_AT[0] - 0.25, FLOOR_Y + 1.65, EXPLORE_AT[1] + 0.45)
  group.add(coolLight)

  // Daylight bounce from the window. Deliberately weak: it should tint the
  // window wall, not raise the whole room's black level.
  const windowLight = new THREE.PointLight(0x93a9ff, rich ? 7 : 4, 14, 2)
  windowLight.position.set(0, OPEN_Y0 + 1.35, BACK_Z + 1.0)
  group.add(windowLight)

  // ── Ambient motes ────────────────────────────────────────────────────────
  let motes: THREE.Points | null = null
  let moteSpeeds: Float32Array | null = null
  const MOTES = reduceMotion ? 0 : rich ? 170 : 60
  if (MOTES > 0) {
    const positions = new Float32Array(MOTES * 3)
    moteSpeeds = new Float32Array(MOTES)
    for (let i = 0; i < MOTES; i++) {
      positions[i * 3] = (Math.random() - 0.5) * HALF_X * 1.9
      positions[i * 3 + 1] = FLOOR_Y + Math.random() * (CEIL_Y - FLOOR_Y)
      positions[i * 3 + 2] = BACK_Z + Math.random() * (DEPTH * 0.72)
      moteSpeeds[i] = 0.1 + Math.random() * 0.22
    }
    const moteGeo = track(new THREE.BufferGeometry())
    moteGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const moteTex = radialTexture('rgba(224,236,255,1)', 'rgba(170,195,255,0)')
    const moteMat = track(new THREE.PointsMaterial({
      size: 0.05, map: moteTex, transparent: true, opacity: 0.6,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }))
    motes = new THREE.Points(moteGeo, moteMat)
    motes.frustumCulled = false
    group.add(motes)
  }

  // ── Assembly burst ───────────────────────────────────────────────────────
  // Equipping a part fires a ring of light and a puff of energy motes at the
  // slot, so an upgrade lands as an event instead of a silent swap.
  const BURST_N = rich ? 64 : 24
  const burstPositions = new Float32Array(BURST_N * 3)
  const burstVelocities = new Float32Array(BURST_N * 3)
  const burstGeo = track(new THREE.BufferGeometry())
  burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPositions, 3))
  const burstTex = radialTexture('rgba(255,255,255,1)', 'rgba(190,210,255,0)')
  const burstMat = track(new THREE.PointsMaterial({
    size: 0.1, map: burstTex, color: accent.clone(), transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }))
  const burstPoints = new THREE.Points(burstGeo, burstMat)
  burstPoints.frustumCulled = false
  burstPoints.visible = false
  group.add(burstPoints)

  const burstRingGeo = track(new THREE.TorusGeometry(0.3, 0.018, 8, 40))
  const burstRingMat = track(new THREE.MeshBasicMaterial({
    color: accent.clone(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  }))
  const burstRing = new THREE.Mesh(burstRingGeo, burstRingMat)
  burstRing.visible = false
  group.add(burstRing)

  const burstLight = new THREE.PointLight(accent.clone(), 0, 3.5, 2)
  group.add(burstLight)

  let burstT = -1
  const BURST_DURATION = 0.85

  const burst = (position: THREE.Vector3) => {
    if (reduceMotion) return
    burstT = 0
    burstPoints.visible = true
    burstRing.visible = true
    burstRing.position.copy(position)
    burstLight.position.copy(position)
    for (let i = 0; i < BURST_N; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const speed = 0.6 + Math.random() * 1.5
      burstPositions[i * 3] = position.x
      burstPositions[i * 3 + 1] = position.y
      burstPositions[i * 3 + 2] = position.z
      burstVelocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed
      burstVelocities[i * 3 + 1] = Math.cos(phi) * speed * 0.7 + 0.4
      burstVelocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed
    }
    burstGeo.attributes.position.needsUpdate = true
  }

  // ── Learner-owned room ───────────────────────────────────────────────────
  // Everything below belongs to the child rather than to the product: the two
  // stations they walk into, the floor they chose, and the props they placed.
  const { kit: itemKit, dispose: disposeItemKit } = createRoomKit(rich)
  disposables.push({ dispose: disposeItemKit })

  const ZONES: LabRoomZone[] = [
    { id: 'avatar', x: stations.avatar.x, z: stations.avatar.z, radius: 1.45 },
    { id: 'room', x: 0, z: 0, radius: 1.25 },
  ]

  // A station's pad is not always under the learner's feet: the room station is
  // the bench, so its ring and sign sit on the bench and the standing spot in
  // front of it stays bare floor.
  const ZONE_PADS: Record<LabRoomZoneId, { radius: number; color: number; markerY: number }> = {
    avatar: { radius: 1.45, color: VIOLET, markerY: FLOOR_Y + 2.1 },
    room: { radius: 1.75, color: AMBER, markerY: FLOOR_Y + 2.45 },
  }
  /** Where each station's ring and sign live — under the feet, or on the bench. */
  const padSpot = (id: LabRoomZoneId) => (id === 'avatar' ? stations.avatar : stations.room)

  const decorBlockers = (): LabRoomCircle[] => [
    { x: stations.explore.x, z: stations.explore.z, radius: STATION_RADIUS.explore },
    { x: stations.mission.x, z: stations.mission.z, radius: STATION_RADIUS.mission },
  ]

  const zonePads = new Map<LabRoomZoneId, {
    ring: THREE.Mesh
    ringMat: THREE.MeshBasicMaterial
    marker: THREE.Group
    glow: THREE.Mesh
    glowMat: THREE.MeshBasicMaterial
    color: THREE.Color
    radius: number
    markerY: number
  }>()

  const zoneGlowTex = radialTexture('rgba(255,255,255,0.75)', 'rgba(255,255,255,0)')
  for (const zone of ZONES) {
    const pad = ZONE_PADS[zone.id]
    const color = new THREE.Color(pad.color)
    const ring = addZoneRing(color, 0, 0, pad.radius, 0.34)
    const ringMat = ring.material as THREE.MeshBasicMaterial

    const glowMat = track(new THREE.MeshBasicMaterial({
      map: zoneGlowTex, color, transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }))
    const glow = new THREE.Mesh(track(new THREE.PlaneGeometry(pad.radius * 2.8, pad.radius * 2.8)), glowMat)
    glow.rotation.x = -Math.PI / 2
    glow.position.y = FLOOR_Y + 0.01
    group.add(glow)

    // A floating sign so the station reads as "somewhere to go" from anywhere
    // in the room, not just when you are standing on it.
    const marker = new THREE.Group()
    marker.position.y = pad.markerY
    group.add(marker)
    const markerMat = track(new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    }))
    if (zone.id === 'avatar') {
      // A head and a halo: "this is where you change Yuvi".
      const head = new THREE.Mesh(track(new THREE.SphereGeometry(0.16, 18, 12)), markerMat)
      head.position.y = 0.06
      marker.add(head)
      const halo = new THREE.Mesh(track(new THREE.TorusGeometry(0.3, 0.018, 8, 32)), markerMat)
      halo.rotation.x = Math.PI / 2
      halo.position.y = 0.3
      marker.add(halo)
    } else {
      // A little house: "this is where you change the room".
      const walls = new THREE.Mesh(track(new THREE.BoxGeometry(0.34, 0.26, 0.34)), markerMat)
      marker.add(walls)
      const roof = new THREE.Mesh(track(new THREE.ConeGeometry(0.3, 0.24, 4)), markerMat)
      roof.position.y = 0.25
      roof.rotation.y = Math.PI / 4
      marker.add(roof)
    }
    if (zone.id === 'avatar') {
      // The light column belongs to the platform; the bench is its own landmark.
      const beacon = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.32, 1.9, 16, 1, true)), track(new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      })))
      beacon.position.y = -1.05
      marker.add(beacon)
    }

    zonePads.set(zone.id, { ring, ringMat, marker, glow, glowMat, color, radius: pad.radius, markerY: pad.markerY })
  }

  /**
   * Move a station and everything that belongs to it: the object, its pad, its
   * sign, the zone the learner walks into, and the footprint others avoid.
   */
  const setStations = (next: RoomStations) => {
    stations.avatar = { ...next.avatar }
    stations.room = { ...next.room }
    stations.explore = { ...next.explore }
    stations.mission = { ...next.mission }
    platform.position.set(stations.avatar.x, 0, stations.avatar.z)
    platform.rotation.y = stations.avatar.rot
    platform.visible = stations.avatar.placed
    bench.position.set(stations.room.x, FLOOR_Y, stations.room.z)
    bench.rotation.y = stations.room.rot
    bench.visible = stations.room.placed
    explore?.position.set(stations.explore.x, FLOOR_Y, stations.explore.z)
    if (explore) explore.rotation.y = stations.explore.rot
    mission?.position.set(stations.mission.x, FLOOR_Y, stations.mission.z)
    if (mission) mission.rotation.y = stations.mission.rot
    exploreShadow?.position.set(stations.explore.x, FLOOR_Y + 0.006, stations.explore.z)
    missionShadow?.position.set(stations.mission.x, FLOOR_Y + 0.006, stations.mission.z)

    const stand = roomStandingSpot(stations.room)
    for (const zone of ZONES) {
      const spot = zone.id === 'avatar' ? stations.avatar : stand
      zone.x = spot.x
      zone.z = spot.z
      zone.radius = stations[zone.id].placed ? ZONE_PADS[zone.id].radius : 0
      const pad = zonePads.get(zone.id)!
      pad.ring.visible = stations[zone.id].placed
      pad.glow.visible = stations[zone.id].placed
      pad.marker.visible = stations[zone.id].placed
      const padAt = padSpot(zone.id)
      pad.ring.position.x = padAt.x
      pad.ring.position.z = padAt.z
      pad.glow.position.x = padAt.x
      pad.glow.position.z = padAt.z
      pad.marker.position.x = padAt.x
      pad.marker.position.z = padAt.z
    }
  }
  setStations(stations)

  let highlightedZone: LabRoomZoneId | null = null
  const setZoneHighlight = (id: LabRoomZoneId | null) => { highlightedZone = id }

  updaters.push((t) => {
    for (const zone of ZONES) {
      const pad = zonePads.get(zone.id)!
      const lit = highlightedZone === zone.id
      const pulse = reduceMotion ? 0 : Math.sin(t * 2.1 + (zone.id === 'room' ? 1.4 : 0)) * 0.5 + 0.5
      pad.ringMat.opacity += ((lit ? 0.85 : 0.28 + pulse * 0.1) - pad.ringMat.opacity) * 0.12
      pad.glowMat.opacity += ((lit ? 0.4 : 0.12) - pad.glowMat.opacity) * 0.12
      const targetScale = pad.radius * (lit ? 1.08 : 1)
      pad.ring.scale.setScalar(pad.ring.scale.x + (targetScale - pad.ring.scale.x) * 0.15)
      if (!reduceMotion) {
        pad.marker.rotation.y = t * 0.5
        pad.marker.position.y = pad.markerY + Math.sin(t * 0.9 + pad.ring.position.x) * 0.07
      }
    }
  })

  // ── Placed props ─────────────────────────────────────────────────────────
  const userGroup = new THREE.Group()
  group.add(userGroup)
  interface BuiltItem { kind: string; tint: string; object: THREE.Object3D; radius: number }
  const builtItems = new Map<string, BuiltItem>()
  const userBlockers: LabRoomCircle[] = []

  const buildItem = (kind: string, tint: string | undefined): { object: THREE.Object3D; radius: number } | null => {
    const spec = roomItemSpec(kind)
    if (!spec) return null
    const color = new THREE.Color(tint ?? spec.tint ?? '#ffffff')
    const object = new THREE.Group()
    object.add(spec.build(itemKit, color))
    // Nothing here is in the shadow map, so every prop gets a contact blob.
    const blob = itemKit.plane(spec.radius * 2.5, spec.radius * 2.5, propShadowMat)
    blob.rotation.x = -Math.PI / 2
    blob.position.y = 0.008
    object.add(blob)
    object.scale.setScalar(PROP_SCALE)
    return { object, radius: spec.radius * PROP_SCALE }
  }

  const setUserItems = (items: RoomItem[]) => {
    const seen = new Set<string>()
    for (const item of items) {
      seen.add(item.uid)
      const tint = item.tint ?? roomItemSpec(item.kind)?.tint ?? '#ffffff'
      let built = builtItems.get(item.uid)
      // Only a kind or colour change costs a rebuild; moving is just a transform.
      if (built && (built.kind !== item.kind || built.tint !== tint)) {
        userGroup.remove(built.object)
        builtItems.delete(item.uid)
        built = undefined
      }
      if (!built) {
        const made = buildItem(item.kind, tint)
        if (!made) continue
        built = { kind: item.kind, tint, object: made.object, radius: made.radius }
        builtItems.set(item.uid, built)
        userGroup.add(built.object)
      }
      built.object.position.set(item.x, FLOOR_Y, item.z)
      built.object.rotation.y = item.rot
    }
    for (const [uid, built] of builtItems) {
      if (seen.has(uid)) continue
      userGroup.remove(built.object)
      builtItems.delete(uid)
    }
    userBlockers.length = 0
    for (const item of items) {
      const built = builtItems.get(item.uid)
      if (built) userBlockers.push({ x: item.x, z: item.z, radius: built.radius })
    }
  }

  /** Circles Yuvi must walk around. Rebuilt whenever the layout changes. */
  const blockers = (): LabRoomCircle[] => [
    ...(stations.room.placed ? [{ x: stations.room.x, z: stations.room.z, radius: STATION_RADIUS.room }] : []),
    ...decorBlockers(),
    ...userBlockers,
  ]

  /** The station under this ray. Decorative light effects are never clickable. */
  const pickStation = (raycaster: THREE.Raycaster): StationId | null => {
    if (stations.avatar.placed && raycaster.intersectObject(podium, true).length) return 'avatar'
    if (stations.room.placed && raycaster.intersectObject(bench, true).length) return 'room'
    if (explore && raycaster.intersectObject(explore, true).length) return 'explore'
    if (mission && raycaster.intersectObject(mission, true).length) return 'mission'
    return null
  }

  /** A world point just above a station, so UI can be pinned to it. */
  const stationAnchor = (id: StationId): THREE.Vector3 => {
    const spot = stations[id]
    const height = id === 'avatar' ? 0.9 : id === 'room' ? 2.3 : id === 'explore' ? 2.1 : 1.8
    return new THREE.Vector3(spot.x, FLOOR_Y + height, spot.z)
  }

  /** The placed prop under this ray, nearest first. */
  const pickItem = (raycaster: THREE.Raycaster): string | null => {
    const hits = raycaster.intersectObject(userGroup, true)
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object
      while (node && node.parent !== userGroup) node = node.parent
      if (!node) continue
      for (const [uid, built] of builtItems) if (built.object === node) return uid
    }
    return null
  }

  /** A world point just above a prop, so UI can be pinned to it. */
  const itemAnchor = (uid: string): THREE.Vector3 | null => {
    const built = builtItems.get(uid)
    if (!built) return null
    const height = (roomItemSpec(built.kind)?.height ?? 0.8) * PROP_SCALE
    return new THREE.Vector3(built.object.position.x, FLOOR_Y + height + 0.3, built.object.position.z)
  }
  /**
   * Circles nothing may be built on. `exclude` drops the station being carried,
   * so a station is never blocked by the hole it just left.
   */
  const noBuildZones = (exclude?: StationId): LabRoomCircle[] => [
    ...(['avatar', 'room', 'explore', 'mission'] as StationId[])
      .filter((id) => id !== exclude && stations[id].placed)
      .map((id) => ({ x: stations[id].x, z: stations[id].z, radius: STATION_RADIUS[id] })),
    ...ZONES.filter((zone) => zone.id !== exclude).map((zone) => ({ x: zone.x, z: zone.z, radius: zone.radius + 0.2 })),
  ]

  // ── Placement ghost ──────────────────────────────────────────────────────
  // The preview is the real prop wearing a single hologram material, so what
  // the learner sees before dropping is exactly what lands.
  const ghostOkMat = track(new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0.42, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  }))
  const ghostBadMat = track(new THREE.MeshBasicMaterial({
    color: 0xff5d73, transparent: true, opacity: 0.32, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  }))
  const ghostGroup = new THREE.Group()
  ghostGroup.visible = false
  group.add(ghostGroup)
  const ghostBodyHolder = new THREE.Group()
  ghostBodyHolder.scale.setScalar(PROP_SCALE)
  ghostGroup.add(ghostBodyHolder)
  const ghostRing = new THREE.Mesh(zoneRingGeo, ghostOkMat)
  ghostRing.rotation.x = -Math.PI / 2
  ghostRing.position.y = 0.02
  ghostGroup.add(ghostRing)
  let ghostKind: string | null = null
  let ghostBody: THREE.Object3D | null = null

  const setGhost = (kind: string | null, x = 0, z = 0, rot = 0, valid = true, tint?: string) => {
    if (!kind) {
      ghostGroup.visible = false
      return
    }
    if (kind !== ghostKind) {
      if (ghostBody) ghostBodyHolder.remove(ghostBody)
      // A carried station shows only its footprint: dragging a translucent copy
      // of the whole platform around would bury the room it is landing in.
      const station = kind.startsWith('station:') ? (kind.slice(8) as StationId) : null
      const spec = station ? null : roomItemSpec(kind)
      ghostBody = spec ? spec.build(itemKit, new THREE.Color(tint ?? spec.tint ?? '#ffffff')) : null
      ghostKind = kind
      if (ghostBody) ghostBodyHolder.add(ghostBody)
      ghostRing.scale.setScalar(
        station ? STATION_RADIUS[station] : spec ? spec.radius * PROP_SCALE * 1.15 : 0.6,
      )
    }
    const mat = valid ? ghostOkMat : ghostBadMat
    ghostRing.material = mat
    ghostBody?.traverse((obj: any) => { if (obj.isMesh) obj.material = mat })
    ghostGroup.position.set(x, FLOOR_Y, z)
    ghostGroup.rotation.y = rot
    ghostGroup.visible = true
  }

  // ── Tutorial target ──────────────────────────────────────────────────────
  // A lit patch of floor the walkthrough can point at: "put it here". It is
  // deliberately loud — a ring, a pool, a column of light and, when the step is
  // about facing, an arrow showing which way is the right way round.
  const targetGroup = new THREE.Group()
  targetGroup.visible = false
  group.add(targetGroup)
  const targetColor = new THREE.Color(0x5ce7a8)
  const targetRingMat = track(new THREE.MeshBasicMaterial({
    color: targetColor, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  }))
  const targetRing = new THREE.Mesh(zoneRingGeo, targetRingMat)
  targetRing.rotation.x = -Math.PI / 2
  targetRing.position.y = FLOOR_Y + 0.016
  targetGroup.add(targetRing)
  const targetGlowMat = track(new THREE.MeshBasicMaterial({
    map: radialTexture('rgba(255,255,255,0.8)', 'rgba(255,255,255,0)'), color: targetColor,
    transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  }))
  const targetGlow = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), targetGlowMat)
  targetGlow.rotation.x = -Math.PI / 2
  targetGlow.position.y = FLOOR_Y + 0.012
  targetGroup.add(targetGlow)
  const targetBeacon = new THREE.Mesh(
    track(new THREE.CylinderGeometry(1, 1, 3.2, 20, 1, true)),
    track(new THREE.MeshBasicMaterial({
      color: targetColor, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    })),
  )
  targetBeacon.position.y = FLOOR_Y + 1.6
  targetGroup.add(targetBeacon)
  // The facing arrow rides its own node so the ring stays put while it swings.
  const targetAim = new THREE.Group()
  targetAim.position.y = FLOOR_Y + 0.018
  targetGroup.add(targetAim)
  const targetArrow = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.34, 0.8, 3)),
    track(new THREE.MeshBasicMaterial({
      color: targetColor, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    })),
  )
  targetArrow.rotation.x = Math.PI / 2
  targetAim.add(targetArrow)

  let targetRadius = 1
  const setTarget: LabRoom['setTarget'] = (spot) => {
    targetGroup.visible = Boolean(spot)
    if (!spot) return
    targetRadius = spot.radius
    targetGroup.position.set(spot.x, 0, spot.z)
    targetRing.scale.setScalar(spot.radius)
    targetGlow.scale.setScalar(spot.radius * 2.8)
    targetBeacon.scale.set(spot.radius * 0.92, 1, spot.radius * 0.92)
    targetAim.visible = spot.aim != null
    if (spot.aim != null) {
      targetAim.rotation.y = spot.aim
      targetArrow.position.set(0, 0, spot.radius * 0.62)
    }
  }
  updaters.push((t) => {
    if (!targetGroup.visible) return
    const pulse = reduceMotion ? 0 : Math.sin(t * 2.6) * 0.5 + 0.5
    targetRingMat.opacity = 0.55 + pulse * 0.4
    targetGlowMat.opacity = 0.14 + pulse * 0.14
    targetRing.scale.setScalar(targetRadius * (1 + pulse * 0.03))
  })

  // ── Floor, wall and mood styling ─────────────────────────────────────────
  const floorStyleTex = new Map<RoomStyleId, THREE.Texture>()
  const makeFloorTexture = (style: RoomStyleId): THREE.Texture | null => {
    if (style === 'lab') return null
    const cached = floorStyleTex.get(style)
    if (cached) return cached
    const { canvas, ctx } = canvasOf(256, 256)
    if (style === 'wood') {
      ctx.fillStyle = '#6b4526'
      ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(255,220,180,0.07)' : 'rgba(40,20,8,0.16)'
        ctx.fillRect(0, i * 32, 256, 32)
        ctx.strokeStyle = 'rgba(28,14,6,0.5)'
        ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(256, i * 32); ctx.stroke()
      }
    } else if (style === 'carpet') {
      ctx.fillStyle = '#3c2f6b'
      ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3)
      }
    } else if (style === 'meadow') {
      ctx.fillStyle = '#2f7a45'
      ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 500; i++) {
        ctx.strokeStyle = `rgba(${120 + Math.random() * 80 | 0},${200 + Math.random() * 40 | 0},130,0.28)`
        const x = Math.random() * 256
        const y = Math.random() * 256
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 2, y - 7); ctx.stroke()
      }
    } else {
      ctx.fillStyle = '#b5722f'
      ctx.fillRect(0, 0, 256, 256)
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'
      ctx.lineWidth = 4
      ctx.strokeRect(14, 14, 228, 228)
      ctx.beginPath(); ctx.arc(128, 128, 54, 0, Math.PI * 2); ctx.stroke()
    }
    const texture = finish(canvas, style === 'court' ? 1 : 6, style === 'court' ? 1 : 8)
    floorStyleTex.set(style, texture)
    return texture
  }

  const floorSkinMat = track(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, depthWrite: false }))
  const floorSkin = new THREE.Mesh(floorGeo, floorSkinMat)
  floorSkin.rotation.x = -Math.PI / 2
  floorSkin.position.set(0, FLOOR_Y + 0.003, MID_Z)
  floorSkin.visible = false
  group.add(floorSkin)

  const WALL_TINTS: Record<WallStyleId, number> = {
    lab: 0xffffff, warm: 0xffc79a, sky: 0x9fd0ff, forest: 0x9fe0b8, space: 0xa79bff,
  }
  const MOOD_SETTINGS: Record<MoodId, { fog: number; warm: number; accent: number; window: number }> = {
    studio: { fog: 0x05071a, warm: 1, accent: 1, window: 1 },
    sunset: { fog: 0x2a1024, warm: 1.5, accent: 0.75, window: 0.7 },
    night: { fog: 0x02030c, warm: 0.5, accent: 1.25, window: 0.35 },
    party: { fog: 0x160a34, warm: 0.8, accent: 1.7, window: 0.5 },
  }
  let moodWarm = 1
  let moodAccent = 1

  const setRoomStyle = (style: { floor: RoomStyleId; wall: WallStyleId; mood: MoodId }) => {
    const texture = makeFloorTexture(style.floor)
    floorSkinMat.map = texture
    floorSkinMat.needsUpdate = true
    floorSkin.visible = !!texture

    const tint = WALL_TINTS[style.wall] ?? WALL_TINTS.lab
    wallMat.color.setHex(tint)
    ceilMat.color.setHex(tint).multiplyScalar(0.32)

    const mood = MOOD_SETTINGS[style.mood] ?? MOOD_SETTINGS.studio
    moodWarm = mood.warm
    moodAccent = mood.accent
    windowLight.intensity = (rich ? 5 : 3) * mood.window
    if ((scene.fog as THREE.FogExp2 | null)?.color) (scene.fog as THREE.FogExp2).color.setHex(mood.fog)
  }

  // ────────────────────────────────────────────────────────────────────────
  const setAccent = (color: THREE.ColorRepresentation) => {
    accent.set(color)
    ledMat.color.copy(accent); ledMat.emissive.copy(accent)
    accentStripMat.color.copy(accent)
    poolMat.color.copy(accent)
    reflectMat.color.copy(accent)
    accentLight.color.copy(accent)
    burstMat.color.copy(accent)
    burstRingMat.color.copy(accent)
    burstLight.color.copy(accent)
  }

  const update = (t: number, dt: number) => {
    if (!reduceMotion) {
      // The bay breathes: LEDs, floor pool and the light shaft all pulse on
      // slightly different periods so nothing ever looks looped.
      ledMat.emissiveIntensity = 1.35 + Math.sin(t * 1.5) * 0.28
      innerRingMat.opacity = 0.2 + Math.abs(Math.sin(t * 1.05)) * 0.12
      innerRing.rotation.z = t * 0.24
      poolMat.opacity = 0.21 + Math.sin(t * 1.25) * 0.05
      coneMat.opacity = 0.036 + Math.sin(t * 0.6) * 0.01
      gridMat.opacity = 0.09 + Math.sin(t * 0.7) * 0.025
      accentLight.intensity = ((rich ? 4.6 : 2.8) + Math.sin(t * 1.5) * 0.6) * moodAccent
      // The bench light behaves like a real warm source: it breathes, it never
      // strobes.
      warmLight.intensity = ((rich ? 9.5 : 4.8) + Math.sin(t * 2.1) * 0.5) * moodWarm
      for (const p of projectors) {
        p.form.rotation.y = t * p.spin
        p.form.position.y = p.baseY + Math.sin(t * 0.55 + p.phase) * 0.07
        p.ringA.rotation.z = t * p.spin * -2.1
        p.ringB.rotation.y = t * p.spin * 1.6
        const breath = 0.5 + Math.abs(Math.sin(t * 0.7 + p.phase)) * 0.22
        p.lineMat.opacity = breath
        p.shellMat.opacity = 0.04 + breath * 0.03
        p.columnMat.opacity = 0.055 + Math.sin(t * 0.9 + p.phase) * 0.018
      }
      if (gantry) {
        gantry.shoulder.rotation.z = Math.sin(t * 0.23) * 0.14
        gantry.elbow.rotation.z = Math.sin(t * 0.29 + 1.1) * 0.26
        gantry.wrist.rotation.x = Math.sin(t * 0.37 + 2.2) * 0.22
        gantry.tipMat.opacity = 0.5 + Math.abs(Math.sin(t * 1.7)) * 0.4
      }
      if (motes && moteSpeeds) {
        const array = (motes.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
        for (let i = 0; i < moteSpeeds.length; i++) {
          array[i * 3 + 1] += moteSpeeds[i] * dt
          if (array[i * 3 + 1] > CEIL_Y) array[i * 3 + 1] = FLOOR_Y
        }
        motes.geometry.attributes.position.needsUpdate = true
      }
    }

    if (burstT >= 0) {
      burstT += dt
      const p = Math.min(1, burstT / BURST_DURATION)
      const fade = Math.pow(1 - p, 1.8)
      for (let i = 0; i < BURST_N; i++) {
        burstPositions[i * 3] += burstVelocities[i * 3] * dt
        burstPositions[i * 3 + 1] += (burstVelocities[i * 3 + 1] - p * 1.4) * dt
        burstPositions[i * 3 + 2] += burstVelocities[i * 3 + 2] * dt
      }
      burstGeo.attributes.position.needsUpdate = true
      burstMat.opacity = fade * 0.95
      burstMat.size = 0.1 * (1 - p * 0.45)
      burstRing.scale.setScalar(1 + p * 4.2)
      burstRingMat.opacity = fade * 0.8
      burstLight.intensity = fade * (rich ? 9 : 5)
      if (p >= 1) {
        burstT = -1
        burstPoints.visible = false
        burstRing.visible = false
        burstLight.intensity = 0
      }
    }

    for (const fn of updaters) fn(t, dt)
  }

  const dispose = () => {
    scene.remove(group)
    group.traverse((obj: any) => {
      if (obj.isMesh || obj.isPoints) {
        obj.geometry?.dispose?.()
      }
    })
    for (const item of disposables) item.dispose?.()
    if (keyLight.shadow?.map) keyLight.shadow.map.dispose()
  }

  return {
    group, quality, deckY, bounds, keyLight, update, burst, setAccent, dispose,
    zones: ZONES, setZoneHighlight, setUserItems, setGhost, setTarget, setRoomStyle, blockers, noBuildZones,
    setStations, pickItem, pickStation, itemAnchor, stationAnchor,
  }
}
