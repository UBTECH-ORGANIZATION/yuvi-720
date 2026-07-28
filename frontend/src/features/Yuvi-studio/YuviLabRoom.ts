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
  dispose: () => void
}

/** Spark palette: deep navy room, violet key, cyan trim. */
const INK = 0x090c26
const WALL = 0x151a42
const TRIM = 0x2a3170
const VIOLET = 0x7c5cff
const CYAN = 0x4eeef0

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
  const FLOOR_Y = deckY - 0.13
  const HALF_X = 4.7
  const BACK_Z = -6.6
  const FRONT_Z = 8.4
  const CEIL_Y = FLOOR_Y + 4.7
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
    return finish(canvas, 3, 2)
  })()

  const wallMat = track(new THREE.MeshStandardMaterial({
    map: wallTexture, color: WALL, roughness: 0.82, metalness: 0.2, envMapIntensity: 0.3,
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
  addWall(HALF_X * 2, CEIL_Y - FLOOR_Y, [0, (CEIL_Y + FLOOR_Y) / 2, BACK_Z], 0)
  addWall(DEPTH, CEIL_Y - FLOOR_Y, [-HALF_X, (CEIL_Y + FLOOR_Y) / 2, MID_Z], Math.PI / 2)
  addWall(DEPTH, CEIL_Y - FLOOR_Y, [HALF_X, (CEIL_Y + FLOOR_Y) / 2, MID_Z], -Math.PI / 2)

  // Polished floor: dark and metallic so it mirrors the room's light instead of
  // becoming a bright slab that competes with the character.
  const floorGeo = track(new THREE.PlaneGeometry(HALF_X * 2, DEPTH))
  const floorMat = track(new THREE.MeshStandardMaterial({
    color: INK, roughness: 0.24, metalness: 0.74, envMapIntensity: 0.18,
  }))
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, FLOOR_Y, MID_Z)
  floor.receiveShadow = rich
  group.add(floor)

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
    return finish(canvas, 11, 14)
  })()
  const gridGeo = track(new THREE.PlaneGeometry(HALF_X * 2, DEPTH, 24, 24))
  fadeRadially(gridGeo, HALF_X * 1.55, 1.8)
  const gridMat = track(new THREE.MeshBasicMaterial({
    map: gridTexture, color: 0x6f5cff, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, vertexColors: true,
  }))
  const grid = new THREE.Mesh(gridGeo, gridMat)
  grid.rotation.x = -Math.PI / 2
  grid.position.set(0, FLOOR_Y + 0.004, MID_Z)
  group.add(grid)

  const ceilGeo = track(new THREE.PlaneGeometry(HALF_X * 2, DEPTH))
  const ceilMat = track(new THREE.MeshStandardMaterial({ color: 0x0d1130, roughness: 0.92, metalness: 0.1 }))
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
  const addStrip = (mat: THREE.Material, scale: [number, number, number], position: [number, number, number]) => {
    const mesh = new THREE.Mesh(stripGeo, mat)
    mesh.scale.set(...scale)
    mesh.position.set(...position)
    group.add(mesh)
    return mesh
  }
  // Skirting light where each wall meets the floor — the classic "lab" read.
  addStrip(accentStripMat, [HALF_X * 2 - 0.1, 0.035, 0.05], [0, FLOOR_Y + 0.09, BACK_Z + 0.05])
  addStrip(coolStripMat, [0.05, 0.035, DEPTH * 0.72], [-HALF_X + 0.05, FLOOR_Y + 0.09, MID_Z - 0.6])
  addStrip(coolStripMat, [0.05, 0.035, DEPTH * 0.72], [HALF_X - 0.05, FLOOR_Y + 0.09, MID_Z - 0.6])
  // Ceiling bars over the bay, hung low enough to appear when the camera lifts.
  const ceilBarMat = track(new THREE.MeshBasicMaterial({ color: 0xd7dcff, toneMapped: false }))
  const ceilBars: THREE.Mesh[] = []
  for (const z of rich ? [-4.6, -2.2, 0.4] : [-2.2]) {
    ceilBars.push(addStrip(ceilBarMat, [HALF_X * 1.5, 0.06, 0.16], [0, CEIL_Y - 0.42, z]))
  }
  const ceilHaloGeo = track(new THREE.PlaneGeometry(HALF_X * 1.7, 1.5))
  const ceilHaloTex = radialTexture('rgba(180,196,255,0.5)', 'rgba(180,196,255,0)')
  const ceilHaloMat = track(new THREE.MeshBasicMaterial({
    map: ceilHaloTex, transparent: true, opacity: 0.35, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }))
  for (const bar of ceilBars) {
    const halo = new THREE.Mesh(ceilHaloGeo, ceilHaloMat)
    halo.rotation.x = Math.PI / 2
    halo.position.set(0, bar.position.y - 0.12, bar.position.z)
    group.add(halo)
  }

  // Recessed channels cut into the back wall. Light as architecture reads far
  // more current than decals or screens bolted onto a flat surface.
  const channelMat = track(new THREE.MeshBasicMaterial({ color: 0x93a8ff, toneMapped: false }))
  for (const x of rich ? [-3.35, -1.2, 1.2, 3.35] : [-2.2, 2.2]) {
    addStrip(channelMat, [0.035, 2.15, 0.04], [x, FLOOR_Y + 1.6, BACK_Z + 0.06])
  }
  addStrip(coolStripMat, [HALF_X * 1.42, 0.028, 0.04], [0, FLOOR_Y + 2.95, BACK_Z + 0.06])
  // Approach lines inlaid in the floor, guiding the eye to the platform.
  for (const x of [-1.62, 1.62]) {
    addStrip(coolStripMat, [0.03, 0.012, 5.4], [x, FLOOR_Y + 0.012, 3.2])
  }

  // ────────────────────────────────────────────────────────────────────────
  // The upgrade platform
  // ────────────────────────────────────────────────────────────────────────
  const podium = new THREE.Group()
  podium.position.y = deckY
  group.add(podium)

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
    color: accent.clone(), emissive: accent.clone(), emissiveIntensity: 2.3,
    roughness: 0.3, toneMapped: false,
  }))
  const led = new THREE.Mesh(ledGeo, ledMat)
  led.rotation.x = Math.PI / 2
  led.position.y = 0.008
  podium.add(led)

  const innerRingGeo = track(new THREE.RingGeometry(0.74, 0.94, 64, 1, 0, Math.PI * 1.55))
  const innerRingMat = track(new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending,
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
  group.add(reflection)

  // Floor bloom pooling out from under the platform.
  const poolTex = radialTexture('rgba(255,255,255,0.5)', 'rgba(255,255,255,0)')
  const poolGeo = track(new THREE.PlaneGeometry(6.4, 6.4))
  const poolMat = track(new THREE.MeshBasicMaterial({
    map: poolTex, color: accent.clone(), transparent: true, opacity: 0.42, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }))
  const pool = new THREE.Mesh(poolGeo, poolMat)
  pool.rotation.x = -Math.PI / 2
  pool.position.set(0, FLOOR_Y + 0.006, 0)
  group.add(pool)

  // Volumetric shaft from the ceiling bars down onto the deck.
  const coneGeo = track(new THREE.CylinderGeometry(0.95, 1.9, CEIL_Y - deckY - 0.5, 28, 1, true))
  fadeVertically(coneGeo, (CEIL_Y - deckY - 0.5) / 2, 1.25)
  const coneMat = track(new THREE.MeshBasicMaterial({
    color: 0xa9b6ff, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide, vertexColors: true,
  }))
  const cone = new THREE.Mesh(coneGeo, coneMat)
  cone.position.set(0, deckY + (CEIL_Y - deckY - 0.5) / 2, 0)
  group.add(cone)

  // ────────────────────────────────────────────────────────────────────────
  // Props: workbench, shelves, consoles, holograms
  // ────────────────────────────────────────────────────────────────────────
  const metalMat = track(new THREE.MeshStandardMaterial({ color: 0x1d2350, roughness: 0.52, metalness: 0.62, envMapIntensity: 0.45 }))
  const darkMat = track(new THREE.MeshStandardMaterial({ color: 0x11142f, roughness: 0.68, metalness: 0.4, envMapIntensity: 0.35 }))
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

  if (rich) {
    // Workbench along the left wall, angled toward the platform.
    const bench = new THREE.Group()
    bench.position.set(-3.35, FLOOR_Y, -2.9)
    bench.rotation.y = 0.66
    group.add(bench)
    addBox(bench, metalMat, [2.9, 0.1, 1.05], [0, 0.94, 0])
    addBox(bench, darkMat, [2.7, 0.72, 0.9], [0, 0.55, -0.02])
    addBox(bench, accentStripMat, [2.72, 0.028, 0.03], [0, 0.87, 0.53])
    // Back panel with pegged tools.
    addBox(bench, darkMat, [2.9, 1.5, 0.08], [0, 1.72, -0.5])
    for (let i = 0; i < 5; i++) {
      const tool = new THREE.Mesh(cylGeo, partMats[i % 3])
      tool.scale.set(0.06, 0.42, 0.06)
      tool.position.set(-1.05 + i * 0.52, 1.72, -0.4)
      tool.rotation.z = 0.12 - (i % 2) * 0.24
      bench.add(tool)
    }
    // Spare parts scattered on the bench top.
    const partA = new THREE.Mesh(sphereGeo, partMats[0]); partA.scale.setScalar(0.34); partA.position.set(-0.95, 1.16, 0.1); bench.add(partA)
    const partB = new THREE.Mesh(torusGeo, partMats[2]); partB.scale.setScalar(0.5); partB.rotation.x = Math.PI / 2; partB.position.set(0.2, 1.06, 0.12); bench.add(partB)
    addBox(bench, partMats[1], [0.34, 0.2, 0.28], [0.95, 1.09, 0.02])

    // Shelf rack on the right wall, stocked with accessory crates.
    const rack = new THREE.Group()
    rack.position.set(3.5, FLOOR_Y, -3.2)
    rack.rotation.y = -0.62
    group.add(rack)
    addBox(rack, darkMat, [0.1, 2.6, 1.0], [-1.35, 1.3, 0])
    addBox(rack, darkMat, [0.1, 2.6, 1.0], [1.35, 1.3, 0])
    const shelfLevels = [0.55, 1.32, 2.09]
    shelfLevels.forEach((y, level) => {
      addBox(rack, metalMat, [2.8, 0.07, 1.0], [0, y, 0])
      addBox(rack, level % 2 ? coolStripMat : accentStripMat, [2.7, 0.02, 0.03], [0, y + 0.05, 0.5])
      for (let i = 0; i < 3; i++) {
        const kind = (level + i) % 3
        const mat = partMats[(level + i) % 3]
        let mesh: THREE.Mesh
        if (kind === 0) { mesh = new THREE.Mesh(boxGeo, mat); mesh.scale.set(0.42, 0.34, 0.42) }
        else if (kind === 1) { mesh = new THREE.Mesh(sphereGeo, mat); mesh.scale.setScalar(0.36) }
        else { mesh = new THREE.Mesh(torusGeo, mat); mesh.scale.setScalar(0.5); mesh.rotation.x = Math.PI / 2 }
        mesh.position.set(-0.85 + i * 0.85, y + 0.22, 0)
        rack.add(mesh)
      }
    })

    // Two angled consoles in the back corners — the "tech stations".
    for (const side of [-1, 1]) {
      const console3d = new THREE.Group()
      console3d.position.set(side * 3.5, FLOOR_Y, -5.5)
      console3d.rotation.y = side * -0.62
      group.add(console3d)
      addBox(console3d, darkMat, [1.7, 0.95, 0.7], [0, 0.48, 0])
      addBox(console3d, metalMat, [1.75, 0.09, 0.8], [0, 0.98, 0.02])
      addBox(console3d, side < 0 ? accentStripMat : coolStripMat, [1.6, 0.025, 0.03], [0, 0.42, 0.36])
      const screen = new THREE.Mesh(track(new THREE.PlaneGeometry(1.35, 0.72)), consoleScreenMat())
      screen.position.set(0, 1.42, -0.12)
      screen.rotation.x = -0.28
      console3d.add(screen)
      addBox(console3d, darkMat, [0.08, 0.55, 0.08], [0, 1.15, -0.14])
    }
  }

  // ── Ceiling service arm ───────────────────────────────────────────────────
  // A slim articulated arm parked beside the platform. Nothing says "upgrade
  // bay" like real robotics hanging over the deck, and it idles rather than
  // performing, so it never competes with the character.
  let gantry: {
    shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group; tipMat: THREE.MeshBasicMaterial
  } | null = null
  if (rich) {
    const mount = new THREE.Group()
    mount.position.set(-2.0, CEIL_Y - 0.12, -1.2)
    group.add(mount)
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
  }) => {
    const station = new THREE.Group()
    station.position.set(spec.pos[0], spec.pos[1], spec.pos[2])
    group.add(station)

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

  const projectorSpecs = [
    { pos: [-3.05, FLOOR_Y, -4.45] as [number, number, number], radius: 0.52, height: 1.75, color: 0x7fe4ff, detail: 1, spin: 0.22, phase: 0 },
    { pos: [2.35, FLOOR_Y, -4.2] as [number, number, number], radius: 0.4, height: 1.35, color: 0xa896ff, detail: 0, spin: -0.31, phase: 1.9 },
  ].slice(0, rich ? 2 : 1)
  for (const spec of projectorSpecs) buildProjector(spec)

  // ────────────────────────────────────────────────────────────────────────
  // Lighting — one shadow caster plus two cheap accent fills
  // ────────────────────────────────────────────────────────────────────────
  const keyLight = new THREE.SpotLight(0xf2f4ff, rich ? 34 : 26, 14, 0.62, 0.92, 1.6)
  keyLight.position.set(0.6, CEIL_Y - 0.5, 2.0)
  keyLight.target.position.set(0, deckY + 0.7, 0)
  group.add(keyLight)
  group.add(keyLight.target)
  if (rich) {
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.camera.near = 1
    keyLight.shadow.camera.far = 12
    keyLight.shadow.bias = -0.0012
    keyLight.shadow.radius = 4
  }

  const accentLight = new THREE.PointLight(accent.clone(), rich ? 7 : 4, 7.5, 2)
  accentLight.position.set(0, deckY + 0.35, 1.1)
  group.add(accentLight)

  const wallLight = new THREE.PointLight(CYAN, rich ? 5 : 3, 9, 2)
  wallLight.position.set(-2.6, 1.5, -4.4)
  group.add(wallLight)

  // ── Ambient motes ────────────────────────────────────────────────────────
  let motes: THREE.Points | null = null
  let moteSpeeds: Float32Array | null = null
  const MOTES = reduceMotion ? 0 : rich ? 110 : 40
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
      ledMat.emissiveIntensity = 2.05 + Math.sin(t * 1.5) * 0.45
      innerRingMat.opacity = 0.3 + Math.abs(Math.sin(t * 1.05)) * 0.18
      innerRing.rotation.z = t * 0.24
      poolMat.opacity = 0.36 + Math.sin(t * 1.25) * 0.08
      coneMat.opacity = 0.045 + Math.sin(t * 0.6) * 0.015
      gridMat.opacity = 0.27 + Math.sin(t * 0.7) * 0.05
      accentLight.intensity = (rich ? 6.4 : 3.6) + Math.sin(t * 1.5) * 0.9
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

  return { group, quality, deckY, bounds, keyLight, update, burst, setAccent, dispose }
}
