// @ts-nocheck
/* eslint-disable */
// Yuvi accessory catalog + procedural builders (ported from the validated
// docs/Yuvi-studio-demo.html). Each asset returns a self-contained THREE.Group
// authored in ANCHOR-LOCAL space so it snaps onto the robot's attachment points.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { YuviColors, YuviSlot } from './YuviDesign'
import { DEFAULT_DESIGN } from './YuviDesign'

export interface YuviMaterials {
  body: THREE.MeshStandardMaterial
  joint: THREE.MeshStandardMaterial
  white: THREE.MeshStandardMaterial
  glow: THREE.MeshStandardMaterial
  face: THREE.MeshBasicMaterial
}

export function createMaterials(colors: YuviColors): YuviMaterials {
  const body = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.3, metalness: 0.14, envMapIntensity: 0.7 })
  const joint = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.34, metalness: 0.1, envMapIntensity: 0.65 })
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26, metalness: 0.08, envMapIntensity: 0.85 })
  const glow = new THREE.MeshStandardMaterial({ color: colors.glow, emissive: colors.glow, emissiveIntensity: 1.8, roughness: 0.3, toneMapped: false })
  const face = new THREE.MeshBasicMaterial({ color: 0x050711 })
  const mats: YuviMaterials = { body, joint, white, glow, face }
  refreshMaterials(mats, colors)
  return mats
}

/** Live recolour: body drives a darker joint shade; glow is emissive. */
export function refreshMaterials(mats: YuviMaterials, colors: YuviColors) {
  const b = new THREE.Color(colors.body)
  mats.body.color.copy(b)
  mats.joint.color.copy(b.clone().multiplyScalar(0.82))
  mats.glow.color.set(colors.glow)
  mats.glow.emissive.set(colors.glow)
}

const mat = (color: number | string, opts: Record<string, unknown> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1, ...opts })
const emissive = (color: number | string, intensity = 1.6) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.3, toneMapped: false })

/* ── material vocabulary ───────────────────────────────────────────────────
   Every item is built from the same five looks — moulded shell, brushed
   metal, technical fabric, glass and additive "energy" — so the gear reads as
   one product family instead of a bag of toys. */
const shell = (color: number | string, opts: Record<string, unknown> = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.06, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.15, ...opts })
const metal = (color: number | string, opts: Record<string, unknown> = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.24, metalness: 0.92, envMapIntensity: 1.35, ...opts })
const fabric = (color: number | string, opts: Record<string, unknown> = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.88, metalness: 0, sheen: 0.32, sheenColor: new THREE.Color('#8fa0d8'), sheenRoughness: 0.85, envMapIntensity: 0.35, ...opts })
const glass = (color: number | string, opacity = 0.42, opts: Record<string, unknown> = {}) =>
  new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity, roughness: 0.05, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.7, ...opts })
/** Additive surface — reads as emitted light, never as painted plastic. */
const holo = (color: number | string, opacity = 0.36, opts: Record<string, unknown> = {}) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, ...opts })

const CARBON = '#232152'
const GRAPHITE = '#3a3878'
const STEEL = '#9fb0d6'
const NEON = '#4eeef0'
const VIOLET = '#7c5cff'
/** Face decals sit in front of the visor's own additive face lights. */
const decal = (material: THREE.Material) => { material.depthTest = false; return material }

// ── head gear (head-local: the helmet spans y ±0.51, x ±0.56, z ±0.45) ──
function buildSnapback() {
  const g = new THREE.Group()
  // The crown has to reach down past the head's widest point (y ~0.1) or it
  // reads as a floating disc instead of a cap.
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.62, 34, 22, 0, Math.PI * 2, 0, Math.PI / 2), fabric('#312f7d'))
  crown.scale.set(1, 0.8, 1); crown.position.y = 0.09; g.add(crown)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.628, 0.628, 0.16, 36, 1, true), fabric('#1d1b48'))
  band.position.y = 0.14; g.add(band)
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.628, 0.012, 8, 40), emissive(VIOLET, 1.5))
  seam.rotation.x = Math.PI / 2; seam.position.y = 0.22; g.add(seam)
  // Worn backwards: the brim points behind and the closure strap sits up front.
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.055, 44, 1, false, Math.PI - 0.95, 1.9), shell('#1b1940'))
  brim.scale.set(0.8, 1, 1)
  brim.position.set(0, 0.13, 0.04); brim.rotation.x = 0.1; g.add(brim)
  const brimGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.83, 0.83, 0.014, 44, 1, false, Math.PI - 0.95, 1.9), holo(NEON, 0.55))
  brimGlow.scale.set(0.8, 1, 1)
  brimGlow.position.set(0, 0.098, 0.04); brimGlow.rotation.x = 0.1; g.add(brimGlow)
  const strap = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.11, 0.05, 4, 0.02), shell(CARBON))
  strap.position.set(0, 0.16, 0.56); g.add(strap)
  const buckle = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.012, 8, 22), emissive(NEON, 1.6))
  buckle.position.set(0, 0.16, 0.6); g.add(buckle)
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.055), holo(VIOLET, 0.55))
  tag.position.set(0.44, 0.24, 0.32); tag.rotation.y = -0.8; g.add(tag)
  return g
}
function buildBeanie() {
  const g = new THREE.Group()
  const knit = fabric('#2a2a72', { roughness: 0.95 })
  // Pulled down over the head, not perched on top of it.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.63, 34, 22, 0, Math.PI * 2, 0, Math.PI * 0.54), knit)
  dome.scale.set(1, 0.92, 1); dome.position.y = 0.05; g.add(dome)
  // Chunky folded rim — the detail that makes knitwear read as knitwear.
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.655, 0.645, 0.22, 36), fabric('#3d3d99', { roughness: 0.95 }))
  rim.position.y = 0.02; g.add(rim)
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    const rib = new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.21, 0.035, 3, 0.014), fabric('#33338c', { roughness: 0.98 }))
    rib.position.set(Math.sin(a) * 0.665, 0.02, Math.cos(a) * 0.665); rib.rotation.y = -a; g.add(rib)
  }
  // Cable-knit ridges running over the crown.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const cable = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.022, 8, 26, Math.PI * 0.52), fabric('#35358f', { roughness: 0.98 }))
    cable.position.y = 0.05; cable.rotation.set(Math.PI / 2, 0, 0); cable.rotation.y = a
    cable.scale.set(1, 0.94, 1); g.add(cable)
  }
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 16), fabric('#cfd6ff', { roughness: 1 }))
  pom.position.y = 0.66; g.add(pom)
  const label = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.08, 0.02, 3, 0.014), shell(CARBON))
  label.position.set(0.26, 0.02, 0.6); label.rotation.y = -0.42; g.add(label)
  const spark = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.024), holo(NEON, 0.8))
  spark.position.set(0.267, 0.02, 0.615); spark.rotation.y = -0.42; g.add(spark)
  g.userData.animate = (t: number) => {
    pom.position.y = 0.66 + Math.sin(t * 2.2) * 0.012
    pom.rotation.z = Math.sin(t * 1.6) * 0.12
  }
  return g
}
function buildHood() {
  const g = new THREE.Group()
  const cloth = fabric('#1d1c44', { side: THREE.DoubleSide })
  // Sphere slice open toward +Z: the face stays clear, the fabric wraps behind.
  const cowl = new THREE.Mesh(new THREE.SphereGeometry(0.8, 40, 28, Math.PI / 2 + 1.18, Math.PI * 2 - 2.36, 0, Math.PI * 0.74), cloth)
  cowl.scale.set(1.02, 1, 1.08); cowl.position.set(0, 0.02, -0.12); g.add(cowl)
  const peak = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), cloth)
  peak.scale.set(1, 0.7, 1.3); peak.position.set(0, 0.42, -0.44); g.add(peak)
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.06, 12, 40, Math.PI * 1.15), fabric('#2b2a63'))
  brim.position.set(0, 0.02, -0.02); brim.rotation.set(0, 0, Math.PI * 0.42); g.add(brim)
  // Neck opening: without it the cowl floats like a halo instead of sitting on
  // the shoulders.
  const neck = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.085, 12, 34), fabric('#232253'))
  neck.rotation.x = Math.PI / 2; neck.position.set(0, -0.5, -0.06); neck.scale.set(1, 1.06, 1); g.add(neck)
  const trimMat = holo(NEON, 0.45)
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.016, 10, 34), trimMat)
  trim.rotation.x = Math.PI / 2; trim.position.set(0, -0.42, -0.06); trim.scale.set(1, 1.06, 1); g.add(trim)
  for (const side of [-1, 1]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.26, 8), fabric('#c9d2ff'))
    cord.position.set(0.24 * side, -0.62, 0.3); cord.rotation.z = 0.16 * side; g.add(cord)
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.05, 12), metal(STEEL))
    tip.position.set(0.26 * side, -0.75, 0.3); g.add(tip)
  }
  g.userData.animate = (t: number) => { trimMat.opacity = 0.32 + Math.sin(t * 2) * 0.14 }
  return g
}
function buildHeadset() {
  const g = new THREE.Group()
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.63, 0.045, 14, 40, Math.PI), shell(CARBON))
  band.position.y = 0.04; g.add(band)
  const padding = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.035, 12, 32, Math.PI * 0.8), fabric('#33326d'))
  padding.position.y = 0.04; padding.rotation.z = Math.PI * 0.1; g.add(padding)
  const rings: THREE.MeshStandardMaterial[] = []
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.2, 0.09, 4, 0.03), metal('#5b5f8e'))
    arm.position.set(0.63 * side, -0.02, 0); g.add(arm)
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.19, 0.14, 28), shell(CARBON))
    cup.rotation.z = Math.PI / 2; cup.position.set(0.68 * side, -0.06, 0); g.add(cup)
    const cushion = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.045, 12, 28), fabric('#2a2a5e'))
    cushion.rotation.y = Math.PI / 2; cushion.position.set(0.62 * side, -0.06, 0); g.add(cushion)
    const ledMat = emissive(NEON, 2.4)
    const led = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.022, 12, 32), ledMat)
    led.rotation.y = Math.PI / 2; led.position.set(0.755 * side, -0.06, 0); g.add(led)
    rings.push(ledMat)
    const plate = new THREE.Mesh(new THREE.CircleGeometry(0.14, 26), shell(GRAPHITE))
    plate.rotation.y = (Math.PI / 2) * side; plate.position.set(0.757 * side, -0.06, 0); g.add(plate)
  }
  // Mic boom sweeping forward from the left cup.
  const boom = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.7, -0.14, 0.04), new THREE.Vector3(-0.62, -0.3, 0.3),
    new THREE.Vector3(-0.42, -0.34, 0.5), new THREE.Vector3(-0.2, -0.3, 0.56),
  ])
  const boomMesh = new THREE.Mesh(new THREE.TubeGeometry(boom, 24, 0.019, 8, false), shell(CARBON)); g.add(boomMesh)
  const mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.05, 6, 14), shell(GRAPHITE))
  mic.position.set(-0.19, -0.3, 0.57); mic.rotation.z = Math.PI / 2; g.add(mic)
  const micLed = emissive(VIOLET, 2)
  const micDot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), micLed)
  micDot.position.set(-0.15, -0.3, 0.6); g.add(micDot)
  g.userData.animate = (t: number) => {
    const pulse = 1.7 + Math.sin(t * 2.4) * 0.7
    rings.forEach((m, i) => { m.emissiveIntensity = pulse + i * 0.15 })
    micLed.emissiveIntensity = 1.6 + Math.sin(t * 5) * 0.5
  }
  return g
}
function buildNeonCrest() {
  const g = new THREE.Group()
  const blades: THREE.Mesh[] = []
  const glowMats: THREE.MeshBasicMaterial[] = []
  const rail = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.06, 0.92, 4, 0.028), shell(CARBON))
  rail.position.y = 0.5; g.add(rail)
  for (let i = 0; i < 7; i++) {
    const k = i / 6
    const height = 0.16 + Math.sin(k * Math.PI) * 0.34
    const z = -0.38 + k * 0.76
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.05, height, 3), emissive(i % 2 ? NEON : VIOLET, 2.6))
    core.scale.z = 0.3; core.position.set(0, 0.52 + height / 2, z); core.rotation.y = Math.PI / 2
    g.add(core); blades.push(core)
    const aura = new THREE.Mesh(new THREE.ConeGeometry(0.09, height * 1.24, 3), holo(i % 2 ? NEON : VIOLET, 0.3))
    aura.scale.z = 0.3; aura.position.copy(core.position); aura.rotation.y = Math.PI / 2
    g.add(aura); glowMats.push(aura.material as THREE.MeshBasicMaterial)
  }
  g.userData.animate = (t: number) => {
    blades.forEach((b, i) => { b.scale.y = 1 + Math.sin(t * 3.4 + i * 0.7) * 0.11 })
    glowMats.forEach((m, i) => { m.opacity = 0.24 + Math.sin(t * 3.4 + i * 0.7) * 0.12 })
  }
  return g
}
function buildLightCrown() {
  const g = new THREE.Group()
  const ring = new THREE.Group(); ring.position.y = 0.78; g.add(ring)
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 10, 56), emissive('#ffd98a', 2.2))
  hoop.rotation.x = Math.PI / 2; ring.add(hoop)
  const haze = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 40), holo('#ffd98a', 0.22))
  haze.rotation.x = Math.PI / 2; ring.add(haze)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const tall = i % 2 === 0
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.045, tall ? 0.3 : 0.18, 4), emissive('#fff0c2', 2))
    shard.position.set(Math.cos(a) * 0.42, (tall ? 0.15 : 0.09), Math.sin(a) * 0.42)
    shard.rotation.y = -a; ring.add(shard)
    const aura = new THREE.Mesh(new THREE.ConeGeometry(0.08, tall ? 0.38 : 0.24, 4), holo('#ffe6a8', 0.2))
    aura.position.copy(shard.position); aura.rotation.y = -a; ring.add(aura)
  }
  g.userData.animate = (t: number, dt: number) => {
    ring.rotation.y += dt * 0.5
    ring.position.y = 0.78 + Math.sin(t * 1.5) * 0.02
    ;(haze.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(t * 2.2) * 0.06
  }
  return g
}
function buildCompanionDrone() {
  const g = new THREE.Group()
  const craft = new THREE.Group(); craft.position.y = 1.02; g.add(craft)
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.11, 0.34, 6, 0.05), shell(CARBON))
  craft.add(body)
  const spine = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.05, 0.2, 4, 0.02), metal(STEEL))
  spine.position.y = 0.07; craft.add(spine)
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.06, 18, 14), glass('#08122a', 0.85))
  lens.position.set(0, -0.03, 0.18); craft.add(lens)
  const eyeMat = emissive(NEON, 2.6)
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 12), eyeMat)
  eye.position.set(0, -0.03, 0.21); craft.add(eye)
  const rotors: THREE.Group[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const armMesh = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.035, 0.05, 3, 0.016), shell(GRAPHITE))
    armMesh.position.set(0.13 * sx, 0, 0.14 * sz); armMesh.rotation.y = (Math.PI / 4) * -sx * sz; craft.add(armMesh)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 14), metal('#6a6fa4'))
    hub.position.set(0.24 * sx, 0.03, 0.24 * sz); craft.add(hub)
    const rotor = new THREE.Group(); rotor.position.set(0.24 * sx, 0.07, 0.24 * sz); craft.add(rotor); rotors.push(rotor)
    for (let b = 0; b < 2; b++) {
      const blade = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.008, 0.05, 3, 0.004), holo('#cfe6ff', 0.5))
      blade.position.x = 0.12; const holder = new THREE.Group(); holder.rotation.y = b * Math.PI; holder.add(blade); rotor.add(holder)
    }
  }
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 18, 1, true), holo(NEON, 0.11))
  beam.position.set(0, -0.24, 0.06); beam.rotation.x = Math.PI; craft.add(beam)
  g.userData.animate = (t: number, dt: number) => {
    rotors.forEach((r) => { r.rotation.y += dt * 26 })
    craft.position.y = 1.02 + Math.sin(t * 1.9) * 0.035
    craft.rotation.z = Math.sin(t * 1.3) * 0.06
    eyeMat.emissiveIntensity = 2.2 + Math.sin(t * 4) * 0.7
  }
  return g
}
function buildAstroHelmet() {
  const g = new THREE.Group()
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.72, 36, 26), shell('#f2f4ff'))
  back.scale.set(1, 1, 1.02); back.position.y = 0.02; g.add(back)
  // Dark iridescent visor wrapping the front, cut from the same sphere.
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.735, 40, 28, Math.PI / 2 - 0.95, 1.9, 0.55, 1.15), glass('#0a0b22', 0.94, { iridescence: 0.75, iridescenceIOR: 1.6, side: THREE.DoubleSide }))
  visor.scale.set(1, 1, 1.02); visor.position.y = 0.02; g.add(visor)
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.63, 0.035, 12, 44), metal(STEEL))
  trim.rotation.x = Math.PI / 2; trim.position.y = -0.36; g.add(trim)
  for (const side of [-1, 1]) {
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 20), metal('#7b86b4'))
    vent.rotation.z = Math.PI / 2; vent.position.set(0.69 * side, -0.06, -0.14); g.add(vent)
    const led = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 10, 22), emissive(NEON, 2))
    led.rotation.y = Math.PI / 2; led.position.set(0.74 * side, -0.06, -0.14); g.add(led)
  }
  const fin = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.16, 0.5, 4, 0.025), shell('#e3e7fb'))
  fin.position.set(0, 0.66, -0.16); g.add(fin)
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.09), holo('#ffffff', 0.12))
  sheen.position.set(-0.1, 0.24, 0.68); sheen.rotation.z = -0.24; g.add(sheen)
  return g
}
function buildBattleHelmet() {
  const g = new THREE.Group()
  const dome = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.62, 1.06, 10, 0.3), shell(CARBON))
  dome.position.y = 0.32; g.add(dome)
  const jaw = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.42, 0.98, 8, 0.26), shell(GRAPHITE))
  jaw.position.y = -0.24; g.add(jaw)
  const brow = new THREE.Mesh(new RoundedBoxGeometry(1.06, 0.11, 0.14, 4, 0.045), metal('#8d7cff'))
  brow.position.set(0, 0.26, 0.5); g.add(brow)
  const slitMat = emissive(NEON, 2.8)
  const slit = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.09, 0.05, 4, 0.03), slitMat)
  slit.position.set(0, 0.06, 0.53); g.add(slit)
  const slitGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.22), holo(NEON, 0.28))
  slitGlow.position.set(0, 0.06, 0.56); g.add(slitGlow)
  const crest = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.2, 0.86, 4, 0.035), metal('#8d7cff'))
  crest.position.set(0, 0.6, -0.02); g.add(crest)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const vent = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.05, 0.26, 3, 0.02), metal('#5f6698'))
      vent.position.set(0.6 * side, -0.02 - i * 0.11, -0.1); g.add(vent)
    }
    const cheek = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.3, 0.24, 4, 0.05), shell('#2c2a58'))
    cheek.position.set(0.52 * side, -0.16, 0.34); cheek.rotation.y = -0.2 * side; g.add(cheek)
  }
  g.userData.animate = (t: number) => {
    slitMat.emissiveIntensity = 2.4 + Math.sin(t * 2.6) * 0.7
    ;(slitGlow.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(t * 2.6) * 0.08
  }
  return g
}
// ── face (anchor sits at the visor centre; the eyes read around y 0.05, z 0.47) ──
function buildShades() {
  const g = new THREE.Group()
  // One-piece wrap lens cut from a cylinder wall so it hugs the visor curve.
  // Everything here is a decal: the robot's own face lights always draw on top.
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 0.3, 48, 1, true, -0.92, 1.84),
    decal(shell('#07091c', { metalness: 0.75, roughness: 0.06, side: THREE.DoubleSide, iridescence: 0.6, iridescenceIOR: 1.5 })),
  )
  lens.position.set(0, 0.07, 0); lens.renderOrder = 11; g.add(lens)
  const browLine = new THREE.Mesh(new THREE.CylinderGeometry(0.607, 0.607, 0.045, 48, 1, true, -0.94, 1.88), decal(emissive(VIOLET, 2.2)))
  browLine.position.set(0, 0.235, 0); browLine.renderOrder = 12; g.add(browLine)
  const bridge = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.05, 0.05, 3, 0.02), decal(shell(CARBON)))
  bridge.position.set(0, 0.06, 0.6); bridge.renderOrder = 12; g.add(bridge)
  const shine = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.05), decal(holo('#ffffff', 0.22)))
  shine.position.set(-0.16, 0.13, 0.6); shine.rotation.set(0, 0.32, -0.16); shine.renderOrder = 13; g.add(shine)
  for (const side of [-1, 1]) {
    const temple = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.06, 0.3, 3, 0.02), decal(shell(CARBON)))
    temple.position.set(0.52 * side, 0.07, 0.3); temple.rotation.y = 0.62 * side; temple.renderOrder = 11; g.add(temple)
  }
  return g
}
function buildHudVisor() {
  const g = new THREE.Group()
  const arm = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.035, 0.05, 3, 0.016), shell(CARBON))
  arm.position.set(0.4, 0.16, 0.34); arm.rotation.set(0, 0.62, -0.12); g.add(arm)
  const mount = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.1, 0.06, 3, 0.02), metal('#6f78ad'))
  mount.position.set(0.31, 0.11, 0.46); g.add(mount)
  const frame = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.21, 0.012, 4, 0.02), shell(GRAPHITE))
  frame.position.set(0.16, 0.06, 0.5); frame.rotation.y = -0.2; g.add(frame)
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.17), decal(holo(NEON, 0.3)))
  panel.position.set(0.16, 0.06, 0.512); panel.rotation.y = -0.2; panel.renderOrder = 12; g.add(panel)
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.012), decal(holo('#d8fbff', 0.85)))
  scan.position.set(0.16, 0.06, 0.517); scan.rotation.y = -0.2; scan.renderOrder = 13; g.add(scan)
  const ticks: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.05 + i * 0.03, 0.012), decal(holo(NEON, 0.75)))
    tick.position.set(0.07 + i * 0.005, 0.11 - i * 0.045, 0.516); tick.rotation.y = -0.2; tick.renderOrder = 13
    g.add(tick); ticks.push(tick)
  }
  g.userData.animate = (t: number) => {
    scan.position.y = 0.06 + Math.sin(t * 1.6) * 0.07
    ticks.forEach((tick, i) => { (tick.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.abs(Math.sin(t * 2 + i)) * 0.5 })
  }
  return g
}
function buildWarPaint() {
  const g = new THREE.Group()
  const strips: THREE.MeshBasicMaterial[] = []
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const material = decal(holo(i === 1 ? VIOLET : NEON, 0.8))
      const streak = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.1 + i * 0.03), material)
      streak.position.set((0.13 + i * 0.045) * side, -0.07 - i * 0.012, 0.478)
      streak.rotation.z = 0.22 * side; streak.renderOrder = 11
      g.add(streak); strips.push(material)
    }
    const chevron = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.016), decal(holo(NEON, 0.7)))
    chevron.position.set(0.06 * side, 0.19, 0.478); chevron.rotation.z = -0.4 * side; chevron.renderOrder = 11
    g.add(chevron); strips.push(chevron.material as THREE.MeshBasicMaterial)
  }
  g.userData.animate = (t: number) => {
    strips.forEach((m, i) => { m.opacity = 0.5 + Math.sin(t * 2.2 + i * 0.5) * 0.28 })
  }
  return g
}
function buildCyberMask() {
  const g = new THREE.Group()
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.4, 0.36, 40, 1, true, -0.8, 1.6),
    shell('#191734', { side: THREE.DoubleSide }),
  )
  plate.position.set(0, -0.19, 0); g.add(plate)
  const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.505, 0.505, 0.02, 40, 1, true, -0.8, 1.6), metal('#727ab0'))
  edge.position.set(0, -0.02, 0); g.add(edge)
  const grillMats: THREE.MeshStandardMaterial[] = []
  for (let i = 0; i < 3; i++) {
    const material = emissive(NEON, 2)
    const slat = new THREE.Mesh(new RoundedBoxGeometry(0.22 - i * 0.04, 0.022, 0.03, 3, 0.01), material)
    slat.position.set(0, -0.16 - i * 0.055, 0.47); g.add(slat); grillMats.push(material)
  }
  for (const side of [-1, 1]) {
    const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.09, 22), metal('#5d64a0'))
    filter.rotation.z = Math.PI / 2; filter.position.set(0.42 * side, -0.2, 0.28); filter.rotation.y = -0.5 * side; g.add(filter)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 10, 22), emissive(VIOLET, 1.8))
    ring.position.set(0.47 * side, -0.2, 0.28); ring.rotation.y = (Math.PI / 2) - 0.5 * side; g.add(ring)
  }
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.018, 8, 34), shell(CARBON))
  strap.position.set(0, -0.14, 0); strap.rotation.set(0.1, Math.PI / 2, 0); strap.scale.set(1, 0.9, 1); g.add(strap)
  g.userData.animate = (t: number) => {
    grillMats.forEach((m, i) => { m.emissiveIntensity = 1.4 + Math.abs(Math.sin(t * 1.7 + i * 0.6)) * 1.2 })
  }
  return g
}
// ── hand (anchor sits in the right palm) ──
function buildSkate() {
  const g = new THREE.Group()
  const deck = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.045, 0.24, 6, 0.055), shell('#1b1a3e'))
  g.add(deck)
  const grip = new THREE.Mesh(new RoundedBoxGeometry(0.76, 0.012, 0.21, 4, 0.02), fabric('#0d0c22', { roughness: 0.99 }))
  grip.position.y = 0.03; g.add(grip)
  // Graphic + underglow are what make it read as a 2020s board, not a toy.
  const artA = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16), holo(VIOLET, 0.6))
  artA.rotation.x = Math.PI / 2; artA.position.set(-0.14, -0.026, 0); g.add(artA)
  const artB = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.16), holo(NEON, 0.6))
  artB.rotation.x = Math.PI / 2; artB.position.set(0.2, -0.026, 0); g.add(artB)
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.2), holo(NEON, 0.25))
  glow.rotation.x = Math.PI / 2; glow.position.y = -0.07; g.add(glow)
  const wheelMats: THREE.MeshStandardMaterial[] = []
  for (const sx of [-1, 1]) {
    const truck = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.06, 0.2, 4, 0.02), metal('#8e97c9'))
    truck.position.set(0.26 * sx, -0.05, 0); g.add(truck)
    for (const sz of [-1, 1]) {
      const material = emissive(sx > 0 ? NEON : VIOLET, 1.4)
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.055, 20), material)
      wheel.rotation.x = Math.PI / 2; wheel.position.set(0.28 * sx, -0.08, 0.09 * sz); g.add(wheel)
      wheelMats.push(material)
    }
  }
  // Held upright at the side, deck turned toward the viewer.
  g.rotation.set(0, Math.PI / 2 - 0.38, Math.PI / 2)
  g.position.set(0.06, -0.02, 0.16); g.scale.setScalar(0.8)
  g.userData.animate = (t: number) => {
    wheelMats.forEach((m, i) => { m.emissiveIntensity = 1.1 + Math.sin(t * 2.6 + i) * 0.5 })
  }
  return g
}
function buildHandDrone() {
  const g = new THREE.Group()
  const craft = new THREE.Group(); craft.position.set(0.04, 0.26, 0.16); g.add(craft)
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.08, 0.26, 5, 0.04), shell(CARBON)); craft.add(body)
  const cap = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.045, 0.16, 4, 0.02), metal(STEEL))
  cap.position.y = 0.055; craft.add(cap)
  const eyeMat = emissive(NEON, 2.6)
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 12), eyeMat)
  eye.position.set(0, -0.02, 0.14); craft.add(eye)
  const rotors: THREE.Group[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const armMesh = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.028, 0.04, 3, 0.012), shell(GRAPHITE))
    armMesh.position.set(0.1 * sx, 0, 0.11 * sz); armMesh.rotation.y = (Math.PI / 4) * -sx * sz; craft.add(armMesh)
    const rotor = new THREE.Group(); rotor.position.set(0.18 * sx, 0.05, 0.18 * sz); craft.add(rotor); rotors.push(rotor)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.04, 12), metal('#6a6fa4')); rotor.add(hub)
    for (let b = 0; b < 2; b++) {
      const blade = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.006, 0.04, 3, 0.003), holo('#cfe6ff', 0.5))
      blade.position.x = 0.09
      const holder = new THREE.Group(); holder.rotation.y = b * Math.PI; holder.add(blade); rotor.add(holder)
    }
  }
  const link = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.24), holo(NEON, 0.2))
  link.position.set(0.04, 0.12, 0.16); g.add(link)
  g.userData.animate = (t: number, dt: number) => {
    rotors.forEach((r) => { r.rotation.y += dt * 28 })
    craft.position.y = 0.26 + Math.sin(t * 2.1) * 0.03
    craft.rotation.z = Math.sin(t * 1.5) * 0.08
    eyeMat.emissiveIntensity = 2.2 + Math.sin(t * 4.2) * 0.7
  }
  return g
}
function buildGuitar() {
  const g = new THREE.Group()
  const bodyMat = shell('#c4133f', { clearcoatRoughness: 0.04 })
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.4, 0.07, 8, 0.11), bodyMat)
  body.position.y = -0.12; g.add(body)
  const horn = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), bodyMat)
  horn.scale.set(1, 1.1, 0.35); horn.position.set(-0.13, 0.03, 0); g.add(horn)
  const pickguard = new THREE.Mesh(new RoundedBoxGeometry(0.19, 0.24, 0.02, 4, 0.05), shell('#0f0e26'))
  pickguard.position.set(0.03, -0.14, 0.045); pickguard.rotation.z = 0.22; g.add(pickguard)
  for (let i = 0; i < 2; i++) {
    const pickup = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.035, 0.03, 3, 0.012), metal('#c9ced8'))
    pickup.position.set(0, -0.05 - i * 0.13, 0.055); g.add(pickup)
  }
  const neck = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.62, 0.045, 4, 0.018), shell('#4b2f1d'))
  neck.position.y = 0.36; g.add(neck)
  const board = new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.6, 0.012, 3, 0.006), shell('#241428'))
  board.position.set(0, 0.36, 0.028); g.add(board)
  for (let i = 0; i < 7; i++) {
    const fret = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.006, 0.004), metal('#d8dce8'))
    fret.position.set(0, 0.12 + i * 0.085, 0.035); g.add(fret)
  }
  const head = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.17, 0.035, 4, 0.02), shell('#3b2416'))
  head.position.set(0.01, 0.74, 0); head.rotation.z = -0.12; g.add(head)
  const stringMat = emissive('#e9f1ff', 0.9)
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.95, 6), stringMat)
    s.position.set(-0.024 + i * 0.016, 0.28, 0.042); g.add(s)
  }
  const strap = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.5, 0.014, 3, 0.006), fabric('#2b2a63'))
  strap.position.set(-0.12, 0.2, -0.05); strap.rotation.z = 0.24; g.add(strap)
  g.rotation.set(0.12, 0.3, -0.55)
  g.position.set(0.04, -0.14, 0.16); g.scale.setScalar(0.86)
  return g
}
function buildHoloPad() {
  const g = new THREE.Group()
  const pad = new THREE.Group(); pad.position.set(0.02, 0.06, 0.2); g.add(pad)
  const frame = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.28, 0.018, 5, 0.022), shell(CARBON)); pad.add(frame)
  const rim = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.3, 0.006, 4, 0.02), emissive(VIOLET, 1.2))
  rim.position.z = -0.012; pad.add(rim)
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.23), holo(NEON, 0.34))
  screen.position.z = 0.014; pad.add(screen)
  const bars: THREE.Mesh[] = []
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.02), holo('#d8fbff', 0.75))
    bar.position.set(-0.12 + i * 0.08, -0.06, 0.02); pad.add(bar); bars.push(bar)
  }
  const panels: THREE.Mesh[] = []
  for (let i = 0; i < 2; i++) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), holo(VIOLET, 0.3))
    panel.position.set(0.3, 0.16 - i * 0.24, 0.16); panel.rotation.y = -0.5
    g.add(panel); panels.push(panel)
  }
  g.rotation.set(-0.25, -0.3, 0)
  g.userData.animate = (t: number) => {
    bars.forEach((bar, i) => { bar.scale.y = 0.5 + Math.abs(Math.sin(t * 2.4 + i * 0.8)) * 1.6 })
    panels.forEach((panel, i) => {
      panel.position.y = (0.16 - i * 0.24) + Math.sin(t * 1.5 + i) * 0.02
      ;(panel.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(t * 2 + i) * 0.1
    })
    ;(screen.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(t * 1.8) * 0.06
  }
  return g
}
function buildPlasmaBlade() {
  const g = new THREE.Group()
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.034, 0.24, 18), metal('#5f6796'))
  grip.position.y = -0.06; g.add(grip)
  for (let i = 0; i < 4; i++) {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.008, 8, 20), shell(CARBON))
    wrap.rotation.x = Math.PI / 2; wrap.position.y = -0.14 + i * 0.05; g.add(wrap)
  }
  const guard = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.03, 0.06, 3, 0.012), metal('#8e97c9'))
  guard.position.y = 0.08; g.add(guard)
  const coreMat = emissive('#dff9ff', 2.8)
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.72, 4), coreMat)
  blade.scale.z = 0.26; blade.position.y = 0.46; blade.rotation.y = Math.PI / 4; g.add(blade)
  const auraMat = holo(NEON, 0.35)
  const aura = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.78, 4), auraMat)
  aura.scale.z = 0.26; aura.position.y = 0.47; aura.rotation.y = Math.PI / 4; g.add(aura)
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.7), holo(VIOLET, 0.4))
  edge.position.y = 0.46; g.add(edge)
  g.rotation.z = -0.18
  g.position.set(0.02, -0.06, 0.12)
  g.userData.animate = (t: number) => {
    coreMat.emissiveIntensity = 2.4 + Math.sin(t * 6) * 0.5
    auraMat.opacity = 0.28 + Math.sin(t * 4) * 0.1
  }
  return g
}
// ── back (anchor sits just behind the torso; shoulders are ~y 0.12) ──
function buildBackpack() {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.54, 0.28, 8, 0.09), fabric('#20204c'))
  body.position.set(0, -0.14, -0.17); g.add(body)
  const flap = new THREE.Mesh(new RoundedBoxGeometry(0.47, 0.24, 0.29, 6, 0.08), fabric('#2c2c66'))
  flap.position.set(0, 0.06, -0.17); g.add(flap)
  const patch = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.16, 0.02, 4, 0.03), shell(CARBON))
  patch.position.set(0, -0.1, -0.032); g.add(patch)
  const patchGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), holo(NEON, 0.55))
  patchGlow.position.set(0, -0.1, -0.019); g.add(patchGlow)
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 20, Math.PI), fabric('#3a3a86'))
  handle.position.set(0, 0.18, -0.17); handle.rotation.x = Math.PI / 2; g.add(handle)
  for (const side of [-1, 1]) {
    const strap = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.44, 0.05, 4, 0.022), fabric('#2c2c66'))
    strap.position.set(0.19 * side, 0.02, 0.01); strap.rotation.x = -0.1; g.add(strap)
    const buckle = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.05, 0.05, 3, 0.016), metal('#8e97c9'))
    buckle.position.set(0.19 * side, -0.1, 0.03); g.add(buckle)
    const pocket = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.22, 0.16, 5, 0.04), fabric('#2c2c66'))
    pocket.position.set(0.25 * side, -0.16, -0.18); g.add(pocket)
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.3, 0.012), emissive(VIOLET, 1.2))
    zip.position.set(0.15 * side, -0.16, -0.032); g.add(zip)
  }
  g.userData.animate = (t: number) => {
    ;(patchGlow.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(t * 2) * 0.15
  }
  return g
}
function buildHoverboard() {
  const g = new THREE.Group()
  const board = new THREE.Group()
  board.position.set(0, -0.08, -0.2); board.rotation.z = 0.62; g.add(board)
  const deck = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.06, 0.28, 8, 0.05), shell('#1b1a3e')); board.add(deck)
  const top = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.014, 0.24, 4, 0.02), fabric('#0d0c22', { roughness: 0.99 }))
  top.position.y = 0.036; board.add(top)
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.05), holo(VIOLET, 0.6))
  stripe.rotation.x = -Math.PI / 2; stripe.position.y = 0.046; board.add(stripe)
  const underMat = holo(NEON, 0.3)
  const under = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.24), underMat)
  under.rotation.x = Math.PI / 2; under.position.y = -0.06; board.add(under)
  const padMats: THREE.MeshStandardMaterial[] = []
  for (const sx of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.07, 24), metal('#7d86bd'))
    pod.position.set(0.3 * sx, -0.04, 0); board.add(pod)
    const material = emissive(NEON, 1.8)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.016, 10, 26), material)
    ring.rotation.x = Math.PI / 2; ring.position.set(0.3 * sx, -0.08, 0); board.add(ring)
    padMats.push(material)
  }
  for (const side of [-1, 1]) {
    const clamp = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.16, 0.12, 4, 0.03), fabric('#2c2c66'))
    clamp.position.set(0.2 * side, 0.02 - 0.16 * side, -0.12); g.add(clamp)
  }
  g.userData.animate = (t: number) => {
    underMat.opacity = 0.24 + Math.sin(t * 2.2) * 0.1
    padMats.forEach((m, i) => { m.emissiveIntensity = 1.5 + Math.sin(t * 2.6 + i) * 0.6 })
  }
  return g
}
function buildEnergyWings() {
  const g = new THREE.Group()
  const shape = new THREE.Shape()
  shape.moveTo(0, 0.14)
  shape.quadraticCurveTo(0.52, 0.5, 0.98, 0.16)
  shape.quadraticCurveTo(0.6, 0.06, 0.46, -0.42)
  shape.quadraticCurveTo(0.22, -0.1, 0, 0.14)
  const wings: THREE.Group[] = []
  const panelMats: THREE.MeshBasicMaterial[] = []
  for (const side of [-1, 1]) {
    const wing = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const material = holo(i === 1 ? VIOLET : NEON, 0.38 - i * 0.07)
      const panel = new THREE.Mesh(new THREE.ShapeGeometry(shape), material)
      panel.scale.setScalar(1 - i * 0.16); panel.position.set(0.04 * i, -0.06 * i, -0.05 * i)
      panel.rotation.z = -0.12 * i
      wing.add(panel); panelMats.push(material)
    }
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new RoundedBoxGeometry(0.62 - i * 0.09, 0.016, 0.016, 3, 0.006), emissive(i % 2 ? NEON : VIOLET, 2.2))
      rib.position.set(0.32 - i * 0.02, 0.16 - i * 0.13, 0.01); rib.rotation.z = -0.16 - i * 0.16
      wing.add(rib)
    }
    wing.scale.set(1.34 * side, 1.34, 1.34); wing.position.set(0.14 * side, 0.1, -0.06)
    wing.rotation.y = -0.34 * side
    g.add(wing); wings.push(wing)
  }
  const spine = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.4, 0.1, 5, 0.04), shell(CARBON))
  spine.position.set(0, -0.02, -0.1); g.add(spine)
  const spineGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.3), holo(NEON, 0.7))
  spineGlow.position.set(0, -0.02, -0.04); g.add(spineGlow)
  g.userData.animate = (t: number) => {
    wings.forEach((wing, i) => {
      const side = i === 0 ? -1 : 1
      wing.rotation.y = (-0.34 + Math.sin(t * 1.5) * 0.12) * side
      wing.position.y = 0.1 + Math.sin(t * 1.5 + 0.4) * 0.025
    })
    panelMats.forEach((m, i) => { m.opacity = 0.26 + Math.abs(Math.sin(t * 1.7 + i * 0.5)) * 0.18 })
  }
  return g
}
function buildThrusters() {
  const g = new THREE.Group()
  const spine = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.46, 0.16, 6, 0.055), shell(CARBON))
  spine.position.set(0, -0.06, -0.12); g.add(spine)
  const spineTrim = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.34, 0.02, 3, 0.012), emissive(VIOLET, 1.6))
  spineTrim.position.set(0, -0.06, -0.03); g.add(spineTrim)
  const flames: THREE.Mesh[] = []
  const haloMats: THREE.MeshStandardMaterial[] = []
  for (const side of [-1, 1]) {
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.135, 0.44, 26), shell('#e9ecfb'))
    nacelle.position.set(0.24 * side, -0.06, -0.16); g.add(nacelle)
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.026, 12, 26), metal('#7d86bd'))
    collar.rotation.x = Math.PI / 2; collar.position.set(0.24 * side, 0.16, -0.16); g.add(collar)
    const intakeMat = emissive(NEON, 2)
    const intake = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.016, 10, 24), intakeMat)
    intake.rotation.x = Math.PI / 2; intake.position.set(0.24 * side, 0.19, -0.16); g.add(intake)
    haloMats.push(intakeMat)
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.11, 24), metal('#5f6796'))
    nozzle.position.set(0.24 * side, -0.33, -0.16); g.add(nozzle)
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.3, 18), holo('#9ff0ff', 0.55))
    flame.position.set(0.24 * side, -0.53, -0.16); flame.rotation.x = Math.PI; g.add(flame); flames.push(flame)
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 14), emissive('#ffffff', 2.4))
    core.position.set(0.24 * side, -0.47, -0.16); core.rotation.x = Math.PI; g.add(core); flames.push(core)
    const strut = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.06, 0.08, 3, 0.02), shell(GRAPHITE))
    strut.position.set(0.14 * side, 0.02, -0.14); g.add(strut)
  }
  g.userData.animate = (t: number) => {
    flames.forEach((f, i) => {
      f.scale.y = 1 + Math.sin(t * 18 + i) * 0.22
      f.scale.x = f.scale.z = 1 + Math.sin(t * 23 + i) * 0.08
    })
    haloMats.forEach((m, i) => { m.emissiveIntensity = 1.7 + Math.sin(t * 3 + i) * 0.6 })
  }
  return g
}
/* ── body (anchor at the torso centre) ─────────────────────────────────────
   The chest badge sits at local (0, 0.025, 0.19) and always draws on top, so
   torso gear is designed to *frame* the logo rather than hide it. Shells are
   sphere slices scaled to the torso ellipsoid (half-extents ~0.24/0.28/0.21). */
const TORSO_SCALE: [number, number, number] = [0.94, 1.06, 0.84]
function torsoShell(radius: number, phiStart: number, phiLength: number, material: THREE.Material, thetaStart = 0.38, thetaLength = 1.72) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 44, 30, phiStart, phiLength, thetaStart, thetaLength), material)
  mesh.scale.set(...TORSO_SCALE); mesh.position.set(0, 0, -0.04)
  return mesh
}
const FRONT = Math.PI / 2

function buildJacket() {
  const g = new THREE.Group()
  // Classic bomber: deep blue body, cream ribbed collar/hem, contrast sleeves
  // and a neon zip running past the chest badge.
  const cloth = fabric('#2a39a0', { side: THREE.DoubleSide })
  const trimCloth = fabric('#b9c4f2', { roughness: 0.95 })
  const lining = fabric('#101534', { side: THREE.DoubleSide })
  for (const side of [-1, 1]) {
    const start = side > 0 ? FRONT + 0.3 : FRONT - 1.86
    g.add(torsoShell(0.302, start, 1.56, cloth))
    g.add(torsoShell(0.292, start, 1.56, lining))
    // Sleeve caps shaped like a shoulder, not a ball stuck to the torso.
    const sleeve = new THREE.Mesh(new THREE.SphereGeometry(0.175, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.68), fabric('#151b46'))
    sleeve.scale.set(0.92, 1.05, 0.92); sleeve.position.set(0.3 * side, 0.13, -0.04); sleeve.rotation.z = 0.26 * side; g.add(sleeve)
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.014, 10, 28), emissive(side > 0 ? NEON : VIOLET, 1.7))
    stripe.rotation.set(Math.PI / 2, 0, 0.26 * side); stripe.position.set(0.315 * side, 0.055, -0.04); g.add(stripe)
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.032, 10, 26), trimCloth)
    cuff.rotation.set(Math.PI / 2, 0, 0.26 * side); cuff.position.set(0.322 * side, 0.005, -0.04); g.add(cuff)
  }
  // Open zip line — two teeth rails with a glowing gap between them.
  for (const side of [-1, 1]) {
    const rail = torsoShell(0.309, FRONT + 0.055 * side - 0.022, 0.045, shell('#0e1230'))
    g.add(rail)
  }
  const zipGlow = torsoShell(0.307, FRONT - 0.02, 0.04, holo(NEON, 0.55))
  g.add(zipGlow)
  const pull = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.07, 0.03, 3, 0.014), metal(STEEL))
  pull.position.set(0, -0.17, 0.2); g.add(pull)
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.176, 0.042, 12, 30, Math.PI * 1.4), trimCloth)
  collar.position.set(0, 0.235, -0.04); collar.rotation.set(Math.PI / 2, 0, Math.PI * 0.8); g.add(collar)
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.216, 0.034, 10, 34), trimCloth)
  hem.rotation.x = Math.PI / 2; hem.position.set(0, -0.238, -0.04); hem.scale.set(1, 0.88, 1); g.add(hem)
  // Sleeve patch high on the right side, like an embroidered badge.
  const patch = new THREE.Mesh(new THREE.CircleGeometry(0.055, 22), fabric('#e5b64a'))
  patch.position.set(0.2, 0.1, 0.19); patch.rotation.y = 0.75; g.add(patch)
  const patchGlow = new THREE.Mesh(new THREE.CircleGeometry(0.03, 18), holo('#ffd98a', 0.7))
  patchGlow.position.set(0.207, 0.1, 0.196); patchGlow.rotation.y = 0.75; g.add(patchGlow)
  return g
}
function buildJersey() {
  const g = new THREE.Group()
  g.add(torsoShell(0.298, FRONT - 1.78, 3.56, fabric('#1c2568', { side: THREE.DoubleSide }), 0.34, 1.78))
  for (const side of [-1, 1]) {
    const stripe = torsoShell(0.303, side > 0 ? FRONT + 1.02 : FRONT - 1.09, 0.07, emissive(side > 0 ? NEON : VIOLET, 1.5), 0.4, 1.6)
    g.add(stripe)
    const shoulder = torsoShell(0.302, side > 0 ? FRONT + 0.42 : FRONT - 0.5, 0.08, fabric('#3949b5'), 0.34, 0.5)
    g.add(shoulder)
  }
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.03, 10, 30), fabric('#0f1436'))
  collar.rotation.x = Math.PI / 2; collar.position.set(0, 0.24, -0.04); collar.scale.set(1, 0.9, 1); g.add(collar)
  const vee = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.03, 0.03, 3, 0.012), fabric('#0f1436'))
  vee.position.set(0, 0.18, 0.19); g.add(vee)
  // Sponsor-style light bars under the badge stand in for a squad number.
  const bars: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.13 - i * 0.03, 0.02), holo(i === 1 ? VIOLET : NEON, 0.7))
    bar.position.set(0, -0.08 - i * 0.045, 0.2); g.add(bar); bars.push(bar)
  }
  g.userData.animate = (t: number) => {
    bars.forEach((bar, i) => { (bar.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(t * 2 + i * 0.7) * 0.25 })
  }
  return g
}
function buildUtilityRig() {
  const g = new THREE.Group()
  const webbing = fabric('#1b1e46')
  const strapMat = fabric('#2b2f6b')
  for (const side of [-1, 1]) {
    // Straight shoulder strap over the collarbone — readable at thumbnail size.
    const strap = torsoShell(0.303, FRONT + 0.42 * side - 0.055, 0.11, strapMat, 0.34, 1.5)
    g.add(strap)
    const edge = torsoShell(0.306, FRONT + 0.42 * side - 0.07, 0.02, emissive(side > 0 ? NEON : VIOLET, 1.6), 0.36, 1.44)
    g.add(edge)
    const pouch = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.15, 0.08, 5, 0.028), webbing)
    pouch.position.set(0.215 * side, -0.13, 0.1); pouch.rotation.y = -0.5 * side; g.add(pouch)
    const flap = new THREE.Mesh(new RoundedBoxGeometry(0.125, 0.05, 0.085, 4, 0.02), fabric('#3b4088'))
    flap.position.set(0.215 * side, -0.06, 0.1); flap.rotation.y = -0.5 * side; g.add(flap)
    const clip = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.035, 0.035, 3, 0.012), metal('#95a0d6'))
    clip.position.set(0.222 * side, -0.09, 0.135); clip.rotation.y = -0.5 * side; g.add(clip)
    const light = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.014), holo(side > 0 ? NEON : VIOLET, 0.85))
    light.position.set(0.222 * side, -0.185, 0.135); light.rotation.y = -0.5 * side; g.add(light)
  }
  // Horizontal chest strap tying the two shoulder straps together.
  const chest = torsoShell(0.305, FRONT - 0.62, 1.24, strapMat, 0.92, 0.11)
  g.add(chest)
  // Buckle ring frames the chest badge instead of covering it.
  const ringMat = emissive(NEON, 2.2)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.018, 12, 36), ringMat)
  ring.position.set(0, 0.025, 0.19); g.add(ring)
  const ringBase = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.032, 12, 36), shell('#1a1940'))
  ringBase.position.set(0, 0.025, 0.175); g.add(ringBase)
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.03, 10, 34), fabric('#1a1940'))
  belt.rotation.x = Math.PI / 2; belt.position.set(0, -0.24, -0.04); belt.scale.set(1, 0.88, 1); g.add(belt)
  g.userData.animate = (t: number) => { ringMat.emissiveIntensity = 1.8 + Math.sin(t * 2.4) * 0.6 }
  return g
}
function buildExoArmor() {
  const g = new THREE.Group()
  const plateMat = shell('#e7ebfa')
  const underMat = shell('#20214a')
  g.add(torsoShell(0.302, FRONT - 1.6, 3.2, plateMat, 0.34, 1.1))
  g.add(torsoShell(0.298, FRONT - 1.35, 2.7, underMat, 1.4, 0.7))
  for (const side of [-1, 1]) {
    const seam = torsoShell(0.306, side > 0 ? FRONT + 0.68 : FRONT - 0.75, 0.055, emissive(NEON, 1.8), 0.36, 1.05)
    g.add(seam)
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.19, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), plateMat)
    pauldron.scale.set(1, 0.85, 1); pauldron.position.set(0.3 * side, 0.16, -0.04); pauldron.rotation.z = 0.3 * side; g.add(pauldron)
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.016, 10, 28), metal('#7d86bd'))
    trim.rotation.set(Math.PI / 2, 0, 0.3 * side); trim.position.set(0.3 * side, 0.13, -0.04); g.add(trim)
    for (let i = 0; i < 3; i++) {
      const vent = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.02, 0.03, 3, 0.008), metal('#6e77ab'))
      vent.position.set(0.11 * side, -0.1 - i * 0.05, 0.19); g.add(vent)
    }
  }
  const collarRing = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.028, 12, 32), metal('#7d86bd'))
  collarRing.rotation.x = Math.PI / 2; collarRing.position.set(0, 0.25, -0.04); collarRing.scale.set(1, 0.9, 1); g.add(collarRing)
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.014, 12, 36), emissive(VIOLET, 2))
  halo.position.set(0, 0.025, 0.195); g.add(halo)
  return g
}
function buildReactorCore() {
  const g = new THREE.Group()
  const armor = shell('#171636')
  const trimMat = metal('#8d7cff')
  g.add(torsoShell(0.304, FRONT - 1.65, 3.3, armor, 0.32, 1.8))
  for (const side of [-1, 1]) {
    const clavicle = torsoShell(0.31, side > 0 ? FRONT + 0.2 : FRONT - 0.72, 0.52, trimMat, 0.34, 0.22)
    g.add(clavicle)
    const block = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.16, 0.22, 6, 0.05), armor)
    block.position.set(0.29 * side, 0.18, -0.04); block.rotation.z = 0.2 * side; g.add(block)
    const blockLight = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.018), holo(NEON, 0.8))
    blockLight.position.set(0.29 * side, 0.13, 0.08); g.add(blockLight)
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.24, 14), metal('#6e77ab'))
    piston.position.set(0.23 * side, -0.06, 0.06); piston.rotation.z = 0.18 * side; g.add(piston)
  }
  // Power core: a static housing with a slowly counter-rotating inner ring.
  const housing = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.045, 16, 44), metal('#6e77ab'))
  housing.position.set(0, 0.025, 0.16); g.add(housing)
  const coreMat = emissive('#b9a8ff', 2.4)
  const core = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.02, 14, 40), coreMat)
  core.position.set(0, 0.025, 0.185); g.add(core)
  const spinner = new THREE.Group(); spinner.position.set(0, 0.025, 0.19); g.add(spinner)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const blade = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.014, 0.012, 3, 0.005), emissive(NEON, 2))
    blade.position.set(Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0); blade.rotation.z = a; spinner.add(blade)
  }
  const auraMat = holo('#b9a8ff', 0.3)
  const aura = new THREE.Mesh(new THREE.CircleGeometry(0.16, 32), auraMat)
  aura.position.set(0, 0.025, 0.155); g.add(aura)
  const vents: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const vent = new THREE.Mesh(new THREE.PlaneGeometry(0.16 - i * 0.03, 0.016), holo(VIOLET, 0.6))
    vent.position.set(0, -0.14 - i * 0.045, 0.2); g.add(vent); vents.push(vent)
  }
  g.userData.animate = (t: number, dt: number) => {
    spinner.rotation.z -= dt * 1.1
    coreMat.emissiveIntensity = 2.1 + Math.sin(t * 2.2) * 0.6
    auraMat.opacity = 0.24 + Math.sin(t * 2.2) * 0.08
    vents.forEach((v, i) => { (v.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(t * 1.9 + i * 0.6) * 0.22 })
  }
  return g
}


/* ── earned gear ───────────────────────────────────────────────────────────
   Not for sale. Each is granted server-side off a real badge or a live day
   streak (`backend/app/services/unlocks.py`), so wearing one is a claim the
   brain can back up. */
function buildLaurelWreath() {
  const g = new THREE.Group()
  const ring = new THREE.Group(); ring.position.y = 0.62; g.add(ring)
  const leafMats: THREE.MeshStandardMaterial[] = []
  // Two arcs of leaves that stop short at the front, so it frames the face
  // instead of closing into another crown.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const k = i / 6
      const a = side * (0.42 + k * 1.9)
      const leafMat = mat('#6fe39a', { roughness: 0.5, metalness: 0.12 })
      leafMats.push(leafMat)
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), leafMat)
      leaf.scale.set(0.34, 1, 0.5)
      leaf.position.set(Math.sin(a) * 0.47, k * 0.16, Math.cos(a) * 0.44)
      leaf.rotation.set(0.4 - k * 0.5, a, side * (0.5 - k * 0.3))
      ring.add(leaf)
    }
  }
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.014, 8, 44, Math.PI * 1.55), metal('#e8c86a'))
  band.rotation.set(Math.PI / 2, 0, -Math.PI * 0.78); ring.add(band)
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.075), emissive('#ffe6a8', 2.4))
  gem.position.set(0, 0.19, 0.42); ring.add(gem)
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 20), holo('#ffe6a8', 0.3))
  halo.position.copy(gem.position); halo.rotation.x = Math.PI / 2; ring.add(halo)
  g.userData.animate = (t: number) => {
    gem.rotation.y = t * 1.2
    ;(halo.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(t * 2.4) * 0.1
    leafMats.forEach((m, i) => { m.emissiveIntensity = 0 ; m.color.setHSL(0.36, 0.55, 0.55 + Math.sin(t * 1.4 + i * 0.4) * 0.04) })
  }
  return g
}
function buildExplorerGoggles() {
  const g = new THREE.Group()
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 10, 40), fabric('#3a3878'))
  strap.rotation.x = Math.PI / 2; strap.position.set(0, 0.06, 0); g.add(strap)
  const lensMats: THREE.MeshBasicMaterial[] = []
  for (const side of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.14, 20), metal('#c9a227'))
    cup.rotation.x = Math.PI / 2
    cup.position.set(side * 0.19, 0.06, 0.44); g.add(cup)
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.13, 22), glass('#8fe8ff', 0.55))
    lens.position.set(side * 0.19, 0.06, 0.515); g.add(lens)
    const sheenMat = holo('#bff3ff', 0.34)
    const sheen = new THREE.Mesh(new THREE.CircleGeometry(0.115, 22), sheenMat)
    sheen.position.set(side * 0.19, 0.06, 0.52); sheen.renderOrder = 12; g.add(sheen)
    lensMats.push(sheenMat)
  }
  // The bridge sits proud of the visor so the pair reads as one object.
  const bridge = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.06, 0.09, 3, 0.02), metal('#e8c86a'))
  bridge.position.set(0, 0.06, 0.47); g.add(bridge)
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.07, 14), metal('#c9a227'))
  lamp.rotation.x = Math.PI / 2; lamp.position.set(0, 0.27, 0.44); g.add(lamp)
  const beamMat = holo('#fff0c2', 0.24)
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 14, 1, true), beamMat)
  beam.rotation.x = -Math.PI / 2; beam.position.set(0, 0.27, 0.74); g.add(beam)
  g.userData.animate = (t: number) => {
    beamMat.opacity = 0.16 + Math.abs(Math.sin(t * 1.1)) * 0.16
    lensMats.forEach((m, i) => { m.opacity = 0.24 + Math.sin(t * 1.8 + i * 1.2) * 0.12 })
  }
  return g
}
function buildStreakScarf() {
  const g = new THREE.Group()
  // Two loops at slightly different tilts, so the neck wrap has thickness from
  // every angle instead of collapsing to a bar when seen head-on.
  for (const [r, y, tilt, color] of [[0.37, 0.07, 0.1, '#ff7a3d'], [0.34, -0.04, -0.14, '#ffb374']] as const) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(r, 0.11, 12, 30), fabric(color))
    loop.rotation.set(Math.PI / 2 + 0.18, 0, tilt)
    loop.position.y = y
    g.add(loop)
  }
  const knot = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.19, 0.16, 4, 0.06), fabric('#ff5d73'))
  knot.position.set(0.2, 0.02, 0.26); knot.rotation.z = -0.3; g.add(knot)
  // The tail falls across the chest rather than straight down, which is what
  // stops the silhouette reading as a stem.
  const tail: THREE.Mesh[] = []
  for (let i = 0; i < 5; i++) {
    const k = i / 4
    const seg = new THREE.Mesh(
      new RoundedBoxGeometry(0.2 - k * 0.05, 0.16, 0.07, 3, 0.03),
      fabric(i % 2 ? '#ff7a3d' : '#ffb374'),
    )
    seg.position.set(0.26 + k * 0.17, -0.12 - i * 0.13, 0.24 - k * 0.05)
    seg.rotation.z = -0.35 - k * 0.25
    g.add(seg); tail.push(seg)
  }
  // Flame tips at the loose end: the streak itself, not decoration on a collar.
  const flames: THREE.MeshBasicMaterial[] = []
  for (let i = 0; i < 3; i++) {
    const flameMat = holo(i === 1 ? '#ffd166' : '#ff8a4c', 0.45)
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07 - i * 0.012, 0.24 - i * 0.04, 6), flameMat)
    flame.position.set(0.72 + i * 0.05, -0.66 - i * 0.06, 0.19)
    flame.rotation.z = -0.9 - i * 0.15
    g.add(flame); flames.push(flameMat)
  }
  g.userData.animate = (t: number) => {
    tail.forEach((seg, i) => {
      seg.rotation.z = -0.35 - (i / 4) * 0.25 + Math.sin(t * 1.7 - i * 0.55) * 0.13
      seg.rotation.x = Math.sin(t * 1.3 - i * 0.4) * 0.09
    })
    flames.forEach((m, i) => { m.opacity = 0.28 + Math.abs(Math.sin(t * 3.2 + i * 0.9)) * 0.3 })
  }
  return g
}
function buildCometTrail() {
  const g = new THREE.Group()
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), emissive('#bff3ff', 2.6))
  core.position.set(0, 0.1, -0.3); g.add(core)
  const shellGlow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), holo('#7fd8ff', 0.28))
  shellGlow.position.copy(core.position); g.add(shellGlow)
  // Three tapering streamers, each a chain of shrinking shards, so the trail
  // reads as motion rather than as a pair of wings.
  const shards: THREE.Mesh[] = []
  const shardMats: THREE.MeshBasicMaterial[] = []
  for (let s = 0; s < 3; s++) {
    const spread = (s - 1) * 0.36
    for (let i = 0; i < 6; i++) {
      const k = i / 5
      const shardMat = holo(i % 2 ? '#7fd8ff' : '#a896ff', 0.42 - k * 0.3)
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.09 - k * 0.06, 0.34 - k * 0.18, 5), shardMat)
      shard.position.set(spread * (0.4 + k), 0.1 + Math.sin(k * 2) * 0.12 - k * 0.1, -0.42 - k * 0.62)
      shard.rotation.x = Math.PI / 2 + 0.12
      shard.rotation.z = spread * 0.5
      g.add(shard); shards.push(shard); shardMats.push(shardMat)
    }
  }
  g.userData.animate = (t: number) => {
    ;(shellGlow.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(t * 2.6) * 0.1
    shards.forEach((shard, i) => {
      const phase = t * 3.4 - i * 0.35
      shard.scale.setScalar(1 + Math.sin(phase) * 0.14)
      shardMats[i].opacity = Math.max(0.05, (0.4 - (i % 6) * 0.055) + Math.sin(phase) * 0.1)
    })
  }
  return g
}


export interface YuviAsset {
  id: string
  slot: YuviSlot
  /** i18n key for the display label. */
  labelKey: string
  build: () => THREE.Group
  /** When set, the item is locked until the requirement is met (progress-derived). */
  requirementKey?: string
  /** Hide the robot's native ear pods (helmets / headsets cover them). */
  hideEars?: boolean
  /** Curated "new drop" flag powering the studio's חדשים filter. */
  isNew?: boolean
}

/* Purchasable ids (astro, heromask, ironhelmet, lightsaber, heroarmor,
   dragonwings) and milestone ids (crown, jetpack, ironman, propeller) are kept
   stable so backend pricing and already-unlocked items stay valid — only the
   builders and labels were redesigned. */
export const Yuvi_CATALOG: YuviAsset[] = [
  // ── head ──
  { id: 'snapback', slot: 'headTop', labelKey: 'YuviStudio.item.snapback', build: buildSnapback },
  { id: 'beanie', slot: 'headTop', labelKey: 'YuviStudio.item.beanie', build: buildBeanie, hideEars: true, isNew: true },
  { id: 'hood', slot: 'headTop', labelKey: 'YuviStudio.item.hood', build: buildHood, hideEars: true },
  { id: 'headset', slot: 'headTop', labelKey: 'YuviStudio.item.headset', build: buildHeadset, hideEars: true },
  { id: 'neoncrest', slot: 'headTop', labelKey: 'YuviStudio.item.neoncrest', build: buildNeonCrest, isNew: true },
  { id: 'astro', slot: 'headTop', labelKey: 'YuviStudio.item.astro', build: buildAstroHelmet, requirementKey: 'YuviStudio.unlock.achievement', hideEars: true },
  { id: 'ironhelmet', slot: 'headTop', labelKey: 'YuviStudio.item.ironhelmet', build: buildBattleHelmet, requirementKey: 'YuviStudio.unlock.achievement', hideEars: true },
  { id: 'crown', slot: 'headTop', labelKey: 'YuviStudio.item.crown', build: buildLightCrown, requirementKey: 'YuviStudio.unlock.section4' },
  { id: 'propeller', slot: 'headTop', labelKey: 'YuviStudio.item.propeller', build: buildCompanionDrone, requirementKey: 'YuviStudio.unlock.challenges3' },
  { id: 'laurel', slot: 'headTop', labelKey: 'YuviStudio.item.laurel', build: buildLaurelWreath, requirementKey: 'YuviStudio.unlock.badge.on_fire', isNew: true },
  // ── face ──
  { id: 'shades', slot: 'face', labelKey: 'YuviStudio.item.shades', build: buildShades },
  { id: 'hud', slot: 'face', labelKey: 'YuviStudio.item.hud', build: buildHudVisor, isNew: true },
  { id: 'warpaint', slot: 'face', labelKey: 'YuviStudio.item.warpaint', build: buildWarPaint },
  { id: 'heromask', slot: 'face', labelKey: 'YuviStudio.item.heromask', build: buildCyberMask, requirementKey: 'YuviStudio.unlock.achievement' },
  { id: 'explorerGoggles', slot: 'face', labelKey: 'YuviStudio.item.explorerGoggles', build: buildExplorerGoggles, requirementKey: 'YuviStudio.unlock.badge.comeback', isNew: true },
  // ── body ──
  { id: 'jacket', slot: 'body', labelKey: 'YuviStudio.item.jacket', build: buildJacket, isNew: true },
  { id: 'jersey', slot: 'body', labelKey: 'YuviStudio.item.jersey', build: buildJersey },
  { id: 'rig', slot: 'body', labelKey: 'YuviStudio.item.rig', build: buildUtilityRig },
  { id: 'heroarmor', slot: 'body', labelKey: 'YuviStudio.item.heroarmor', build: buildExoArmor, requirementKey: 'YuviStudio.unlock.achievement' },
  { id: 'ironman', slot: 'body', labelKey: 'YuviStudio.item.ironman', build: buildReactorCore, requirementKey: 'YuviStudio.unlock.section6' },
  { id: 'streakScarf', slot: 'body', labelKey: 'YuviStudio.item.streakScarf', build: buildStreakScarf, requirementKey: 'YuviStudio.unlock.streak.3', isNew: true },
  // ── hand ──
  { id: 'skate', slot: 'handR', labelKey: 'YuviStudio.item.skate', build: buildSkate },
  { id: 'drone', slot: 'handR', labelKey: 'YuviStudio.item.drone', build: buildHandDrone },
  { id: 'guitar', slot: 'handR', labelKey: 'YuviStudio.item.guitar', build: buildGuitar },
  { id: 'holopad', slot: 'handR', labelKey: 'YuviStudio.item.holopad', build: buildHoloPad, isNew: true },
  { id: 'lightsaber', slot: 'handR', labelKey: 'YuviStudio.item.lightsaber', build: buildPlasmaBlade, requirementKey: 'YuviStudio.unlock.achievement' },
  // ── back ──
  { id: 'backpack', slot: 'back', labelKey: 'YuviStudio.item.backpack', build: buildBackpack },
  { id: 'hoverboard', slot: 'back', labelKey: 'YuviStudio.item.hoverboard', build: buildHoverboard, isNew: true },
  { id: 'dragonwings', slot: 'back', labelKey: 'YuviStudio.item.dragonwings', build: buildEnergyWings, requirementKey: 'YuviStudio.unlock.achievement' },
  { id: 'jetpack', slot: 'back', labelKey: 'YuviStudio.item.jetpack', build: buildThrusters, requirementKey: 'YuviStudio.unlock.section5' },
  { id: 'cometTrail', slot: 'back', labelKey: 'YuviStudio.item.cometTrail', build: buildCometTrail, requirementKey: 'YuviStudio.unlock.streak.7', isNew: true },
]

export function getAsset(id: string | null): YuviAsset | null {
  if (!id) return null
  return Yuvi_CATALOG.find((a) => a.id === id) ?? null
}

export function assetsForSlot(slot: YuviSlot): YuviAsset[] {
  return Yuvi_CATALOG.filter((a) => a.slot === slot)
}

// Phase rewards: completing a mapping section (0-based part index) unlocks an
// item. Keys align with the requirement copy (part index 3 == "section 4").
export const PHASE_REWARDS: Record<number, string> = {
  3: 'crown',
  4: 'jetpack',
  5: 'ironman',
}

// ── one-time 3D thumbnails cached at module scope (no per-card canvases) ──
let thumbCache: Record<string, string> | null = null
export function getThumbnails(): Record<string, string> {
  if (thumbCache) return thumbCache
  const out: Record<string, string> = {}
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(2); renderer.setSize(140, 140)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0
    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture
    pmrem.dispose()
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6e0f5, 1.0))
    const kl = new THREE.DirectionalLight(0xffffff, 1.5); kl.position.set(3, 6, 6); scene.add(kl)
    const fl = new THREE.DirectionalLight(0xbcd7ef, 0.5); fl.position.set(-4, 2, 3); scene.add(fl)
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
    for (const asset of Yuvi_CATALOG) {
      const obj = asset.build()
      obj.rotation.set(0, 0, 0)
      const box = new THREE.Box3().setFromObject(obj)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      obj.position.sub(center)
      scene.add(obj)
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      const dist = maxDim * 2.3
      cam.position.set(dist * 0.38, dist * 0.3, dist); cam.lookAt(0, 0, 0)
      renderer.render(scene, cam)
      out[asset.id] = renderer.domElement.toDataURL('image/png')
      scene.remove(obj)
      obj.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose() })
    }
    renderer.dispose()
  } catch {
    // WebGL unavailable — cards fall back to a neutral placeholder.
  }
  thumbCache = out
  return out
}

// Keep DEFAULT_DESIGN referenced so tree-shakers keep the palette import stable.
export const THUMBNAIL_PALETTE = DEFAULT_DESIGN.colors
