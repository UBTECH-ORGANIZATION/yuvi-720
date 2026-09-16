/* The four world holograms of the Room panel's world picker, as three.js
 * scenes — for the developer script that bakes them, not for the client.
 *
 * `HolographicWorldSelector` used to build these live, on a second
 * WebGLRenderer with its own animation loop, and re-render four viewports
 * every frame for as long as the Room panel was open. That is the same GPU
 * cost the catalogue thumbnails paid before they were pre-rendered, and the
 * studio's rule is one WebGL context per page. So the geometry lives here,
 * `scripts/render-world-holograms.mjs` turns each world's full turn into a
 * WebP sprite strip under `src/assets/world-holograms/`, and the picker
 * animates the strip in CSS (`worldHologramStrips.ts`).
 *
 * The builders are liad's, unchanged: the strips must look like the live
 * projection did. Only `poseWorldFrame` is new — it puts every animated part
 * where the live loop would have had it, at a phase that closes after one
 * turn so the strip loops without a seam. */
import * as THREE from 'three'
import type { RoomLayoutId } from './RoomLayouts'
import { WORLD_HOLOGRAM_IDS } from './worldHologramStrips'

export interface WorldHologram {
  id: RoomLayoutId
  group: THREE.Group
  glowMaterials: THREE.Material[]
  particles: THREE.Points
}

/* Where the live loop settled once the projection had risen: `stagger` 1,
   hover scale 1, the compact 1.02. */
const OPEN_Y = -2.45 + 2.78
const OPEN_SCALE = 1.02

const material = (color: number, opacity: number, wireframe = false) => new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  wireframe,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
})

/* A seeded generator (mulberry32) instead of Math.random: the cloud was
   random on every mount; baked, it must come out the same on every run so a
   re-render changes no file that did not change. */
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/* three.js sizes a point by the renderer's drawing-buffer height, and the
   live picker drew all four worlds on one 359 px canvas while the bake draws
   one 156 px frame shown at 104 px. Scaled by 359/104 the dots are the size
   they were on a plain 1× screen. */
const PARTICLE_SIZE = 0.045 * (359 / 104)

function particleCloud(count: number, radius: number, color: number, random: () => number) {
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index++) {
    const angle = random() * Math.PI * 2
    const distance = radius * (0.35 + random() * 0.65)
    positions[index * 3] = Math.cos(angle) * distance
    positions[index * 3 + 1] = (random() - 0.5) * radius * 1.2
    positions[index * 3 + 2] = Math.sin(angle) * distance
  }
  return new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)),
    new THREE.PointsMaterial({ color, size: PARTICLE_SIZE, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  )
}

/* The pad every world stands on: the beam, the ring and the scan rings. All
   of it is rotationally symmetric, so it looks the same in every frame of a
   turn — it is baked once (`pad.webp`) and left out of the strips, whose
   alpha plane (compressed losslessly by the browser's encoder) would
   otherwise carry the beam's soft gradient forty-eight times over. */
function projectionBase() {
  const group = new THREE.Group()
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.7, 32, 1, true), material(0x55eaff, 0.08))
  beam.position.y = -1.45
  beam.rotation.x = Math.PI
  beam.userData.pad = true
  group.add(beam)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.025, 8, 48), material(0x7cf7ff, 0.72))
  ring.rotation.x = Math.PI / 2
  ring.position.y = -0.12
  ring.userData.pad = true
  group.add(ring)
  for (let index = 0; index < 5; index++) {
    const scan = new THREE.Mesh(new THREE.TorusGeometry(0.72 + index * 0.07, 0.009, 6, 36), material(index % 2 ? 0x9e78ff : 0x54efff, 0.24))
    scan.rotation.x = Math.PI / 2
    scan.position.y = -0.75 + index * 0.36
    scan.userData.scan = true
    scan.userData.pad = true
    group.add(scan)
  }
  return group
}

/** The pad alone, posed as it sits under every world. */
export function buildPadHologram(): THREE.Group {
  const pad = projectionBase()
  pad.position.set(0, OPEN_Y, 0)
  pad.scale.setScalar(OPEN_SCALE)
  return pad
}

function buildLab() {
  const group = projectionBase()
  const cyan = material(0x58f4ff, 0.76)
  const violet = material(0xa684ff, 0.42)
  const platform = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 1.45), material(0x428dff, 0.32))
  platform.position.y = 0.05
  group.add(platform)
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.08), material(0x527bff, 0.23))
  back.position.set(0, 0.5, -0.68)
  group.add(back)
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.1, 0.34), cyan)
  bench.position.set(0, 0.42, 0.1)
  group.add(bench)
  for (let index = -2; index <= 2; index++) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 10), index % 2 ? violet : cyan)
    tube.position.set(index * 0.2, 0.66 + Math.abs(index) * 0.025, 0.08)
    group.add(tube)
  }
  const atom = new THREE.Group()
  atom.position.set(0.48, 1.08, -0.05)
  for (let index = 0; index < 3; index++) {
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 6, 28), cyan)
    orbit.rotation.set(index * Math.PI / 3, index * Math.PI / 2.6, 0)
    atom.add(orbit)
  }
  atom.userData.spin = 0.7
  group.add(atom)
  return { group, glowMaterials: [cyan, violet] }
}

function buildAdventurePark() {
  const group = projectionBase()
  const green = material(0x64ff91, 0.62)
  const amber = material(0xffd45f, 0.58)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 1.45), material(0x335262, 0.32))
  floor.position.y = 0.02
  group.add(floor)
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.1), material(0x62dba0, 0.28))
  wall.position.set(0, 0.62, -0.65)
  group.add(wall)
  for (let index = 0; index < 14; index += 1) {
    const hold = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07), index % 3 ? green : amber)
    hold.position.set(-0.72 + (index % 7) * 0.24, 0.3 + (index % 4) * 0.24, -0.72)
    group.add(hold)
  }
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 0.48), amber)
  ramp.position.set(-0.55, 0.2, 0.35)
  ramp.rotation.z = -0.22
  group.add(ramp)
  return { group, glowMaterials: [green, amber] }
}

function buildSportsArena() {
  const group = projectionBase()
  const cyan = material(0x64efff, 0.68)
  const red = material(0xff5d62, 0.58)
  const court = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 1.5), material(0x2b7290, 0.3))
  court.position.y = 0.02
  group.add(court)
  const centre = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 8, 32), cyan)
  centre.rotation.x = Math.PI / 2
  centre.position.y = 0.1
  group.add(centre)
  for (const x of [-0.78, 0.78]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.75, 0.04), red)
    post.position.set(x, 0.45, 0)
    group.add(post)
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), red)
    hoop.position.set(x > 0 ? x - 0.12 : x + 0.12, 0.72, 0)
    hoop.rotation.y = Math.PI / 2
    group.add(hoop)
  }
  return { group, glowMaterials: [cyan, red] }
}

function buildCreatorLoft() {
  const group = projectionBase()
  const pink = material(0xff58ac, 0.64)
  const cyan = material(0x58eaff, 0.6)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 1.45), material(0x62486d, 0.28))
  floor.position.y = 0.02
  group.add(floor)
  const stage = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.18, 0.48), pink)
  stage.position.set(0, 0.18, -0.42)
  group.add(stage)
  for (let index = 0; index < 9; index += 1) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3 + (index % 4) * 0.13, 0.08), index % 2 ? cyan : pink)
    bar.position.set(-0.55 + index * 0.14, 0.48, -0.68)
    bar.userData.float = true
    group.add(bar)
  }
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.48, 0.08), cyan)
  screen.position.set(0.55, 0.65, 0.3)
  group.add(screen)
  return { group, glowMaterials: [pink, cyan] }
}

const BUILDERS: Record<RoomLayoutId, () => { group: THREE.Group; glowMaterials: THREE.Material[] }> = {
  lab: buildLab,
  adventurePark: buildAdventurePark,
  sportsArena: buildSportsArena,
  creatorLoft: buildCreatorLoft,
}

/** One world's projection with its particle cloud, as the live picker built it. */
export function buildWorldHologram(id: RoomLayoutId): WorldHologram {
  const built = BUILDERS[id]()
  const particles = particleCloud(58, 1.45, id === 'sportsArena' ? 0xac78ff : 0x69f4ff, seeded(WORLD_HOLOGRAM_IDS.indexOf(id) + 1))
  built.group.add(particles)
  return { id, ...built, particles }
}

/** The padlock that hangs over a world the learner has not unlocked yet. It
 *  was a child of the spinning projection; baked once, it faces the camera. */
export function buildLockHologram(): THREE.Group {
  const lock = new THREE.Group()
  const lockMaterial = material(0xffd76a, 0.88)
  const lockBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.1), lockMaterial)
  const lockShackle = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 8, 20, Math.PI), lockMaterial)
  lockShackle.position.y = 0.14
  lockShackle.rotation.z = Math.PI
  lock.add(lockBody, lockShackle)
  lock.position.set(0, 1.65, 0)
  return lock
}

/** The camera the live picker looked through, in its compact layout. */
export function worldHologramCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(34, aspect, 0.1, 40)
  camera.position.set(0, 0.72, 5.8)
  return camera
}

const GLOW_PULSE = 0.72   // the live pulse's midpoint: 0.72 + sin(...) * 0.2

/** Put every moving part of a world where frame `frame` of `frames` shows it,
 *  with the pad hidden (it ships separately, see `projectionBase`).
 *  Every motion completes whole turns over the strip — the projection one,
 *  the particles one the other way, the lab atom three, the loft bars one
 *  bob — so frame `frames` equals frame 0 and the CSS loop has no seam. */
export function poseWorldFrame(world: WorldHologram, frame: number, frames: number) {
  const turn = (frame / frames) * Math.PI * 2
  world.group.position.set(0, OPEN_Y, 0)
  world.group.scale.setScalar(OPEN_SCALE)
  world.group.rotation.set(0, turn, 0)
  world.particles.rotation.y = -turn
  ;(world.particles.material as THREE.PointsMaterial).opacity = 0.58
  world.glowMaterials.forEach((entry) => { entry.opacity = Math.min(1, GLOW_PULSE) })
  world.group.children.forEach((child) => {
    child.visible = !child.userData.pad
    if (child.userData.spin) child.rotation.y = turn * 3
    if (child.userData.float) child.position.y = 0.62 + Math.sin(turn) * 0.08
  })
}

export function disposeWorldHologram(root: THREE.Object3D) {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh
    renderable.geometry?.dispose()
    const entry = renderable.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(entry)) entry.forEach((item) => item.dispose())
    else entry?.dispose()
  })
}

export { WORLD_HOLOGRAM_IDS }
