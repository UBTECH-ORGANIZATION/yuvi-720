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

// ── head accessories (authored in head-local space; helmet spans y ±0.5) ──
function buildCap() {
  const g = new THREE.Group()
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 20, 0, Math.PI * 2, 0, Math.PI / 2), mat('#ff5d73'))
  crown.scale.set(1, 0.62, 1); crown.position.y = 0.46; g.add(crown)
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 28, 1, false, 0, Math.PI), mat('#e8455c'))
  brim.position.set(0, 0.44, 0.42); brim.rotation.x = -0.08; g.add(brim)
  const btn = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), mat('#ffd166'))
  btn.position.y = 0.78; g.add(btn)
  return g
}
function buildWizardHat() {
  const g = new THREE.Group()
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.06, 30), mat('#5a3fd6'))
  brim.position.y = 0.48; g.add(brim)
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.0, 26), mat('#6a4cf0'))
  cone.position.y = 1.0; g.add(cone)
  const star = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), emissive('#ffd166', 1.4))
  star.position.set(0.14, 1.05, 0.36); g.add(star)
  return g
}
function buildCrown() {
  const g = new THREE.Group()
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.18, 26, 1, true), mat('#ffd166', { metalness: 0.5, roughness: 0.25 }))
  band.position.y = 0.55; g.add(band)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 12), mat('#ffcf4d', { metalness: 0.5, roughness: 0.25 }))
    spike.position.set(Math.cos(a) * 0.44, 0.72, Math.sin(a) * 0.44); g.add(spike)
    const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), emissive('#ff5d73', 1.2))
    gem.position.set(Math.cos(a) * 0.44, 0.55, Math.sin(a) * 0.44 + 0.02); g.add(gem)
  }
  return g
}
function buildHeadphones() {
  const g = new THREE.Group()
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 12, 30, Math.PI), mat('#2a2350'))
  band.position.y = 0.12; g.add(band)
  for (const side of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 20), mat('#3a3266'))
    cup.rotation.z = Math.PI / 2; cup.position.set(0.56 * side, 0.0, 0); g.add(cup)
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), emissive('#3fd9e0', 0.8))
    pad.rotation.y = (-Math.PI / 2) * side; pad.position.set(0.62 * side, 0.0, 0); g.add(pad)
  }
  return g
}
function buildPropeller() {
  const g = new THREE.Group()
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat('#3fd9e0'))
  cap.scale.set(1, 0.5, 1); cap.position.y = 0.46; g.add(cap)
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10), mat('#2a2350'))
  stalk.position.y = 0.72; g.add(stalk)
  const prop = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.02, 0.09, 3, 0.01), mat(['#ff5d73', '#ffd166', '#6a4cf0'][i]))
    blade.position.x = 0.17
    const holder = new THREE.Group(); holder.rotation.y = (i / 3) * Math.PI * 2; holder.add(blade); prop.add(holder)
  }
  prop.position.y = 0.82; g.add(prop)
  g.userData.spin = prop
  return g
}
// ── face ──
function buildSunglasses() {
  const g = new THREE.Group()
  const frameMat = mat('#1a1730', { metalness: 0.3, roughness: 0.3 })
  for (const side of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), new THREE.MeshStandardMaterial({ color: '#0a0a14', roughness: 0.1, metalness: 0.6 }))
    lens.position.set(0.17 * side, 0.05, 0.5); g.add(lens)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 10, 24), frameMat)
    rim.position.set(0.17 * side, 0.05, 0.5); g.add(rim)
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), frameMat)
  bridge.position.set(0, 0.05, 0.51); g.add(bridge)
  return g
}
function buildEyebrows() {
  const g = new THREE.Group()
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.03, 0.03, 3, 0.014), mat('#4a3a2a'))
    brow.position.set(0.17 * side, 0.22, 0.505); brow.rotation.z = -0.12 * side; g.add(brow)
  }
  return g
}
/** Eyebrows reused inside the girl-variant bundle. */
export function buildEyebrowsBundle() {
  return buildEyebrows()
}
// ── girl variant bundle (hair + eyebrows), applied separately from slots ──
export function buildBlondeHair() {
  const g = new THREE.Group()
  const hairMat = mat('#f3d27a', { roughness: 0.55 })
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat)
  top.scale.set(1.02, 0.8, 1.02); top.position.y = 0.12; g.add(top)
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.32, 6, 14), hairMat)
    tail.position.set(0.62 * side, -0.2, -0.05); tail.rotation.z = 0.2 * side; g.add(tail)
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.03, 8, 16), emissive('#ff5d73', 0.6))
    tie.position.set(0.62 * side, 0.0, -0.05); tie.rotation.y = Math.PI / 2; g.add(tie)
  }
  g.position.y = 0.28
  return g
}
// ── hand ──
function buildSkateboard() {
  const g = new THREE.Group()
  const deck = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.05, 0.22, 5, 0.06), mat('#ff5d73')); g.add(deck)
  const grip = new THREE.Mesh(new RoundedBoxGeometry(0.68, 0.01, 0.2, 4, 0.04), mat('#2a2350', { roughness: 0.9 }))
  grip.position.y = 0.031; g.add(grip)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 18), mat('#ffd166'))
    wheel.rotation.x = Math.PI / 2; wheel.position.set(0.26 * sx, -0.08, 0.08 * sz); g.add(wheel)
  }
  g.rotation.z = Math.PI / 2; g.rotation.y = 0.2
  g.position.set(0, -0.1, 0.1); g.scale.setScalar(0.9)
  return g
}
// ── back ──
function buildCape() {
  const g = new THREE.Group()
  const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.95, 8, 8), new THREE.MeshStandardMaterial({ color: '#6a4cf0', side: THREE.DoubleSide, roughness: 0.6 }))
  cape.position.set(0, -0.3, -0.02)
  const pos = cape.geometry.attributes.position
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, -Math.cos(x * 3) * 0.06 - 0.05) }
  pos.needsUpdate = true; cape.geometry.computeVertexNormals()
  g.add(cape)
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 10, 22, Math.PI), mat('#5a3fd6'))
  collar.position.set(0, 0.16, 0.02); collar.rotation.x = Math.PI / 2; g.add(collar)
  g.userData.wave = cape
  return g
}
function buildJetpack() {
  const g = new THREE.Group()
  for (const side of [-1, 1]) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.34, 8, 16), mat('#c9d4e6', { metalness: 0.5, roughness: 0.3 }))
    tank.position.set(0.16 * side, -0.1, -0.16); g.add(tank)
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.1, 16), mat('#4a4a5a'))
    nozzle.position.set(0.16 * side, -0.36, -0.16); g.add(nozzle)
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 14), emissive('#ff9d3f', 1.8))
    flame.position.set(0.16 * side, -0.52, -0.16); flame.rotation.x = Math.PI; flame.userData.flame = true; g.add(flame)
  }
  g.userData.flames = g.children.filter((c) => (c as THREE.Mesh).userData.flame)
  return g
}
// ── body ──
function buildIronmanSuit() {
  const g = new THREE.Group()
  const plate = new THREE.Mesh(new THREE.SphereGeometry(0.31, 32, 24), new THREE.MeshStandardMaterial({ color: '#c0392b', metalness: 0.7, roughness: 0.25 }))
  plate.scale.set(0.92, 1.04, 0.8); g.add(plate)
  const goldMat = new THREE.MeshStandardMaterial({ color: '#f1c40f', metalness: 0.8, roughness: 0.2 })
  for (const side of [-1, 1]) {
    const collar = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.12, 0.2, 5, 0.04), goldMat)
    collar.position.set(0.14 * side, 0.16, 0.13); collar.rotation.z = -0.2 * side; g.add(collar)
    const rib = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.28, 0.16, 5, 0.035), goldMat)
    rib.position.set(0.21 * side, -0.02, 0.12); rib.rotation.z = -0.12 * side; g.add(rib)
  }
  return g
}

// ═══════════════ additional accessories ═══════════════
// head-local: helmet spans y ±0.5, x ±0.56, z ±0.47; hats sit ~y0.45 and grow up.
function buildCowboyHat() {
  const g = new THREE.Group()
  const tan = mat('#c8863f', { roughness: 0.7 })
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.05, 32), tan)
  brim.scale.set(1, 1, 0.82); brim.position.y = 0.5; g.add(brim)
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.4, 24), tan); crown.position.y = 0.72; g.add(crown)
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), tan)
  top.scale.set(1, 0.4, 1); top.position.y = 0.9; g.add(top)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.09, 24), mat('#5a3c1e')); band.position.y = 0.58; g.add(band)
  return g
}
function buildPartyHat() {
  const g = new THREE.Group()
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 24), mat('#ff5d9e')); cone.position.y = 0.94; g.add(cone)
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22 - i * 0.06, 0.02, 8, 24), emissive(['#ffd166', '#4cc9f0', '#7c5cff'][i], 0.6))
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.6 + i * 0.22; g.add(ring)
  }
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), mat('#fff')); pom.position.y = 1.4; g.add(pom)
  return g
}
function buildHalo() {
  const g = new THREE.Group()
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 14, 32), emissive('#ffe37a', 1.8))
  halo.rotation.x = Math.PI / 2; halo.position.y = 0.8; g.add(halo)
  return g
}
function buildBeanie() {
  const g = new THREE.Group()
  const knit = mat('#5a6cff', { roughness: 0.85 })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.54, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.48), knit)
  dome.scale.set(1, 0.7, 1); dome.position.y = 0.43; g.add(dome)
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.13, 30), mat('#4351d6', { roughness: 0.9 }))
  rim.position.y = 0.47; g.add(rim)
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.018, 8, 30), mat('#7785ff', { roughness: 0.9 }))
  seam.rotation.x = Math.PI / 2; seam.position.y = 0.54; g.add(seam)
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 12), mat('#fff', { roughness: 0.9 }))
  pom.position.y = 0.82; g.add(pom)
  return g
}
function buildTopHat() {
  const g = new THREE.Group()
  const blk = mat('#22203a', { roughness: 0.4, metalness: 0.2 })
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 32), blk); brim.position.y = 0.5; g.add(brim)
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.68, 28), blk); tube.position.y = 0.85; g.add(tube)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.1, 28), mat('#ff5d73')); band.position.y = 0.58; g.add(band)
  return g
}
function buildCatEars() {
  const g = new THREE.Group()
  const fur = mat('#9cc1e8')
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), fur); ear.position.set(0.28 * side, 0.56, 0); ear.rotation.y = Math.PI / 4; g.add(ear)
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 4), mat('#ff9ec4')); inner.position.set(0.28 * side, 0.57, 0.03); inner.rotation.y = Math.PI / 4; g.add(inner)
  }
  return g
}
function buildChefHat() {
  const g = new THREE.Group()
  const w = mat('#fdfdff', { roughness: 0.8 })
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.22, 26), w); band.position.y = 0.56; g.add(band)
  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), w); puff.scale.set(1.1, 0.9, 1.1); puff.position.y = 0.82; g.add(puff)
  return g
}
function buildIronHelmet() {
  const g = new THREE.Group()
  const red = mat('#c0392b', { metalness: 0.55, roughness: 0.3 })
  const gold = mat('#f1c40f', { metalness: 0.8, roughness: 0.25 })
  const dome = new THREE.Mesh(new RoundedBoxGeometry(1.16, 0.5, 1.04, 8, 0.26), red); dome.position.y = 0.42; g.add(dome)
  const brow = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.1, 0.14, 4, 0.04), gold); brow.position.set(0, 0.24, 0.5); g.add(brow)
  const crest = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.42, 0.72, 4, 0.03), gold); crest.position.set(0, 0.52, 0); g.add(crest)
  const gem = new THREE.Mesh(new THREE.CircleGeometry(0.05, 18), emissive('#aef7ff', 2)); gem.position.set(0, 0.44, 0.53); g.add(gem)
  return g
}
function buildAstroHelmet() {
  const g = new THREE.Group()
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.66, 28, 20), new THREE.MeshStandardMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.26, roughness: 0.05, metalness: 0.1 }))
  dome.position.y = 0.06; g.add(dome)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.09, 16, 32), mat('#fdfdff', { metalness: 0.3, roughness: 0.4 })); ring.rotation.x = Math.PI / 2; ring.position.y = -0.3; g.add(ring)
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.16, 6, 12), mat('#e6ecf5', { metalness: 0.4 })); tank.position.set(0, 0.62, 0); g.add(tank)
  return g
}
// ── face (anchor at head centre; eyes ~y0.05, z0.5) ──
function buildRoundGlasses() {
  const g = new THREE.Group()
  const frame = mat('#2a2350', { metalness: 0.3, roughness: 0.3 })
  for (const side of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 10, 24), frame); rim.position.set(0.17 * side, 0.05, 0.5); g.add(rim)
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.11, 22), new THREE.MeshStandardMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.3, roughness: 0.1 })); lens.position.set(0.17 * side, 0.05, 0.49); g.add(lens)
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), frame); bridge.position.set(0, 0.05, 0.5); g.add(bridge)
  return g
}
function buildEyepatch() {
  const g = new THREE.Group()
  const blk = mat('#1a1730', { roughness: 0.6 })
  const patch = new THREE.Mesh(new THREE.CircleGeometry(0.13, 22), blk); patch.position.set(0.17, 0.05, 0.5); g.add(patch)
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.015, 8, 30), blk); strap.position.set(0, 0.05, 0); strap.rotation.y = Math.PI / 2; strap.scale.set(1, 0.55, 1); g.add(strap)
  return g
}
function buildHeroMask() {
  const g = new THREE.Group()
  const m = mat('#7c5cff', { roughness: 0.35 })
  for (const side of [-1, 1]) {
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 10, 22), m); frame.position.set(0.17 * side, 0.05, 0.5); g.add(frame)
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 10), m); point.position.set(0.31 * side, 0.11, 0.49); point.rotation.z = -1.15 * side; g.add(point)
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.03), m); bridge.position.set(0, 0.05, 0.5); g.add(bridge)
  return g
}
// ── body (anchor at torso; z ~0.24 forward) ──
function buildBowtie() {
  const g = new THREE.Group()
  const m = mat('#ff5d73')
  for (const side of [-1, 1]) { const w = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.16, 4), m); w.rotation.z = (Math.PI / 2) * side; w.rotation.x = Math.PI / 2; w.position.set(0.09 * side, 0, 0.24); g.add(w) }
  const knot = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.08, 0.06, 3, 0.02), mat('#d63d52')); knot.position.set(0, 0, 0.26); g.add(knot)
  g.position.y = 0.21
  return g
}
function buildMedal() {
  const g = new THREE.Group()
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.02), mat('#4361d6')); ribbon.position.set(0, 0.14, 0.22); g.add(ribbon)
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 24), mat('#ffd166', { metalness: 0.7, roughness: 0.25 })); disc.rotation.x = Math.PI / 2; disc.position.set(0, 0.02, 0.24); g.add(disc)
  const star = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 5), emissive('#fff6c0', 0.7)); star.rotation.x = Math.PI / 2; star.position.set(0, 0.02, 0.26); g.add(star)
  g.position.set(-0.15, 0.08, 0)
  g.scale.setScalar(0.78)
  return g
}
function buildHeroArmor() {
  const g = new THREE.Group()
  const steel = mat('#8fa3bf', { metalness: 0.7, roughness: 0.3 })
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 18), steel); chest.scale.set(0.95, 1.05, 0.72); g.add(chest)
  for (const side of [-1, 1]) { const pad = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), steel); pad.scale.set(1, 0.7, 1); pad.position.set(0.34 * side, 0.24, 0); g.add(pad) }
  return g
}
function buildSpiderEmblem() {
  const g = new THREE.Group()
  const red = mat('#d92d4f', { metalness: 0.15, roughness: 0.5 })
  const web = emissive('#eaf7ff', 0.55)
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.31, 28, 20), red)
  shell.scale.set(0.92, 1.04, 0.78); g.add(shell)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.2 + i * 0.025, 6), web)
      strand.position.set((0.16 + i * 0.035) * side, 0.06 - i * 0.11, 0.225)
      strand.rotation.z = (0.18 + i * 0.16) * side; g.add(strand)
    }
  }
  return g
}
// ── handR (anchor at right hand) ──
function buildSword() {
  const g = new THREE.Group()
  const blade = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.55, 0.02, 3, 0.01), mat('#dfe7f0', { metalness: 0.75, roughness: 0.18 })); blade.position.y = 0.32; g.add(blade)
  const guard = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.05, 0.06, 3, 0.02), mat('#ffd166', { metalness: 0.6 })); guard.position.y = 0.06; g.add(guard)
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12), mat('#7a4a2a')); handle.position.y = -0.04; g.add(handle)
  g.position.set(0, -0.05, 0.08)
  return g
}
function buildWand() {
  const g = new THREE.Group()
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.4, 12), mat('#3a2a4a')); stick.position.y = 0.16; g.add(stick)
  const star = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), emissive('#ffd166', 1.8)); star.position.y = 0.4; g.add(star)
  g.position.set(0, -0.05, 0.08)
  return g
}
function buildLightsaber() {
  const g = new THREE.Group()
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 16), mat('#9aa5b5', { metalness: 0.8, roughness: 0.2 })); hilt.position.y = -0.02; g.add(hilt)
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.6, 16), emissive('#4cff8a', 1.8)); blade.position.y = 0.4; g.add(blade)
  g.position.set(0, -0.05, 0.08)
  return g
}
function buildShield() {
  const g = new THREE.Group()
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 32), mat('#4361d6', { metalness: 0.4, roughness: 0.4 })); disc.rotation.x = Math.PI / 2; g.add(disc)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 10, 32), mat('#fff')); ring.position.z = 0.03; g.add(ring)
  const star = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 5), mat('#fdfdff')); star.rotation.x = Math.PI / 2; star.position.z = 0.03; g.add(star)
  g.position.set(0.04, -0.06, 0.14); g.rotation.y = 0.35
  return g
}
// ── back (anchor behind torso) ──
function buildAngelWings() {
  const g = new THREE.Group()
  const w = mat('#fdfdff', { roughness: 0.7 })
  for (const side of [-1, 1]) {
    const wing = new THREE.Group()
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.2 - i * 0.02, 12, 8), w)
      f.scale.set(0.5, 1.2, 0.3); f.position.set(0.16 + i * 0.15, 0.2 - i * 0.14, 0)
      wing.add(f)
    }
    wing.scale.x = side; wing.position.set(0.1 * side, 0.12, 0)
    g.add(wing)
  }
  return g
}
function buildDragonWings() {
  const g = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: '#7c5cff', side: THREE.DoubleSide, roughness: 0.5 })
  const bone = mat('#4a3a6a')
  for (const side of [-1, 1]) {
    const wing = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const panel = new THREE.Mesh(new THREE.CircleGeometry(0.32 - i * 0.05, 3), skin)
      panel.position.set(0.1 + i * 0.14, 0.2 - i * 0.14, -0.03); panel.rotation.z = (0.5 + i * 0.4)
      wing.add(panel)
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 8), bone)
      rib.position.set(0.14 + i * 0.14, 0.14 - i * 0.12, -0.02); rib.rotation.z = -0.7 - i * 0.3; wing.add(rib)
    }
    wing.scale.x = side; wing.position.set(0.06 * side, 0.16, 0); g.add(wing)
  }
  return g
}
function buildRocketPack() {
  const g = new THREE.Group()
  for (const side of [-1, 1]) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.4, 8, 16), mat('#ff5d73', { metalness: 0.3, roughness: 0.4 })); body.position.set(0.17 * side, -0.05, -0.14); g.add(body)
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.16, 16), mat('#fdfdff')); cone.position.set(0.17 * side, 0.24, -0.14); g.add(cone)
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 14), emissive('#ff9d3f', 1.8)); flame.position.set(0.17 * side, -0.4, -0.14); flame.rotation.x = Math.PI; flame.userData.flame = true; g.add(flame)
  }
  g.userData.flames = g.children.filter((c) => (c as THREE.Mesh).userData.flame)
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
}

export const Yuvi_CATALOG: YuviAsset[] = [
  // ── head ──
  { id: 'cap', slot: 'headTop', labelKey: 'YuviStudio.item.cap', build: buildCap },
  { id: 'wizard', slot: 'headTop', labelKey: 'YuviStudio.item.wizard', build: buildWizardHat },
  { id: 'headphones', slot: 'headTop', labelKey: 'YuviStudio.item.headphones', build: buildHeadphones },
  { id: 'cowboy', slot: 'headTop', labelKey: 'YuviStudio.item.cowboy', build: buildCowboyHat },
  { id: 'party', slot: 'headTop', labelKey: 'YuviStudio.item.party', build: buildPartyHat },
  { id: 'beanie', slot: 'headTop', labelKey: 'YuviStudio.item.beanie', build: buildBeanie },
  { id: 'tophat', slot: 'headTop', labelKey: 'YuviStudio.item.tophat', build: buildTopHat },
  { id: 'chef', slot: 'headTop', labelKey: 'YuviStudio.item.chef', build: buildChefHat },
  { id: 'catears', slot: 'headTop', labelKey: 'YuviStudio.item.catears', build: buildCatEars },
  { id: 'halo', slot: 'headTop', labelKey: 'YuviStudio.item.halo', build: buildHalo },
  { id: 'astro', slot: 'headTop', labelKey: 'YuviStudio.item.astro', build: buildAstroHelmet, requirementKey: 'YuviStudio.unlock.achievement' },
  { id: 'ironhelmet', slot: 'headTop', labelKey: 'YuviStudio.item.ironhelmet', build: buildIronHelmet, requirementKey: 'YuviStudio.unlock.achievement' },
  { id: 'crown', slot: 'headTop', labelKey: 'YuviStudio.item.crown', build: buildCrown, requirementKey: 'YuviStudio.unlock.section4' },
  { id: 'propeller', slot: 'headTop', labelKey: 'YuviStudio.item.propeller', build: buildPropeller, requirementKey: 'YuviStudio.unlock.challenges3' },
  // ── face ──
  { id: 'sunglasses', slot: 'face', labelKey: 'YuviStudio.item.sunglasses', build: buildSunglasses },
  { id: 'eyebrows', slot: 'face', labelKey: 'YuviStudio.item.eyebrows', build: buildEyebrows },
  { id: 'roundglasses', slot: 'face', labelKey: 'YuviStudio.item.roundglasses', build: buildRoundGlasses },
  { id: 'eyepatch', slot: 'face', labelKey: 'YuviStudio.item.eyepatch', build: buildEyepatch },
  { id: 'heromask', slot: 'face', labelKey: 'YuviStudio.item.heromask', build: buildHeroMask, requirementKey: 'YuviStudio.unlock.achievement' },
  // ── body ──
  { id: 'bowtie', slot: 'body', labelKey: 'YuviStudio.item.bowtie', build: buildBowtie },
  { id: 'medal', slot: 'body', labelKey: 'YuviStudio.item.medal', build: buildMedal },
  { id: 'spideremblem', slot: 'body', labelKey: 'YuviStudio.item.spideremblem', build: buildSpiderEmblem },
  { id: 'heroarmor', slot: 'body', labelKey: 'YuviStudio.item.heroarmor', build: buildHeroArmor, requirementKey: 'YuviStudio.unlock.achievement' },
  { id: 'ironman', slot: 'body', labelKey: 'YuviStudio.item.ironman', build: buildIronmanSuit, requirementKey: 'YuviStudio.unlock.section6' },
  // ── hand ──
  { id: 'skateboard', slot: 'handR', labelKey: 'YuviStudio.item.skateboard', build: buildSkateboard },
  { id: 'sword', slot: 'handR', labelKey: 'YuviStudio.item.sword', build: buildSword },
  { id: 'wand', slot: 'handR', labelKey: 'YuviStudio.item.wand', build: buildWand },
  { id: 'shield', slot: 'handR', labelKey: 'YuviStudio.item.shield', build: buildShield },
  { id: 'lightsaber', slot: 'handR', labelKey: 'YuviStudio.item.lightsaber', build: buildLightsaber, requirementKey: 'YuviStudio.unlock.achievement' },
  // ── back ──
  { id: 'cape', slot: 'back', labelKey: 'YuviStudio.item.cape', build: buildCape },
  { id: 'angelwings', slot: 'back', labelKey: 'YuviStudio.item.angelwings', build: buildAngelWings },
  { id: 'rocketpack', slot: 'back', labelKey: 'YuviStudio.item.rocketpack', build: buildRocketPack },
  { id: 'dragonwings', slot: 'back', labelKey: 'YuviStudio.item.dragonwings', build: buildDragonWings, requirementKey: 'YuviStudio.unlock.achievement' },
  { id: 'jetpack', slot: 'back', labelKey: 'YuviStudio.item.jetpack', build: buildJetpack, requirementKey: 'YuviStudio.unlock.section5' },
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
