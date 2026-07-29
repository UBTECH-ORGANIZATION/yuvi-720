// @ts-nocheck
/* eslint-disable */
/**
 * Hand-built props for the activeness world.
 *
 * Every object is procedural three.js geometry dressed with the procedural
 * surfaces from `./textures` — floating rock islands with grass caps, the Yuvi
 * mascot on a glass podium, and the glowing light-paths that tie the world
 * together. The characters that live on the islands are in `./buddies`.
 *
 * Nothing here reads product state: callers pass a `variant` (how the domain is
 * expressed in the learner's real activeness) and a tint, and get back a group.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  fbm,
  grassMaps,
  mascotFace,
  radialSprite,
  rockMaps,
  sparkleSprite,
} from './textures'

export type IslandVariant = 'lush' | 'growing' | 'dormant'

const TAU = Math.PI * 2

/* ── small helpers ─────────────────────────────────────────────────────── */

/** Displace every vertex of a geometry by tileable noise, then re-shade it. */
function craggify(geo: THREE.BufferGeometry, amount: number, freq: number, seed: number) {
  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i)
    const a = (Math.atan2(v.z, v.x) + Math.PI) / TAU
    const n = fbm(a * 2, v.y * 0.5 + 2, 4, freq, seed) - 0.5
    const radial = Math.hypot(v.x, v.z)
    if (radial > 0.001) {
      const k = 1 + n * amount
      v.x *= k
      v.z *= k
    }
    v.y += n * amount * 0.5
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

export function surface(maps: any, extra: any = {}) {
  return new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    normalScale: new THREE.Vector2(1, 1),
    envMapIntensity: 0.55,
    ...extra,
  })
}

/** Glossy painted accent — the domain colour on props. */
export function paint(hex: string | THREE.Color, extra: any = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    roughness: 0.34,
    metalness: 0.12,
    envMapIntensity: 0.9,
    ...extra,
  })
}

/** Faceted gem material — crisp highlights, inner glow, no costly transmission. */
export function crystal(hex: string | THREE.Color, glow = 0.35) {
  const c = new THREE.Color(hex)
  return new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: 0.06,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    ior: 1.7,
    reflectivity: 0.7,
    emissive: c.clone().multiplyScalar(0.8),
    emissiveIntensity: glow,
    transparent: true,
    opacity: 0.94,
    envMapIntensity: 1.5,
    flatShading: true,
  })
}

export function shadowsOn(root: THREE.Object3D, cast = true, receive = true) {
  root.traverse((o: any) => {
    if (!o.isMesh) return
    o.castShadow = cast
    o.receiveShadow = receive
  })
}

/** Points cloud of drifting sparkles around a prop. */
export function sparkleCloud(count: number, radius: number, color: string, size = 0.075) {
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count; i += 1) {
    const r = radius * (0.55 + Math.random() * 0.5)
    const a = Math.random() * TAU
    const p = Math.acos(2 * Math.random() - 1)
    const x = Math.sin(p) * Math.cos(a) * r
    const y = Math.cos(p) * r * 0.8
    const z = Math.sin(p) * Math.sin(a) * r
    pos.set([x, y, z], i * 3)
    seed.set([x, y, z, Math.random() * TAU], i * 4)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: sparkleSprite(),
      color: new THREE.Color(color),
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  points.userData.sparkleSeed = seed
  points.userData.sparkle = true
  return points
}

/* ── floating island ───────────────────────────────────────────────────── */

const ISLAND_PALETTE: Record<IslandVariant, { grass: [string, string]; rock: [string, string]; tuft: string }> = {
  lush: { grass: ['#7fd36c', '#337a41'], rock: ['#948aa3', '#5d5473'], tuft: '#93e07c' },
  growing: { grass: ['#a6d773', '#4c7d3d'], rock: ['#8f8599', '#5a516d'], tuft: '#b6e089' },
  dormant: { grass: ['#a9a5c0', '#5f5c79'], rock: ['#8c8a9d', '#57546c'], tuft: '#b2afc6' },
}

/**
 * A floating chunk of land: craggy rock underside, soil band, grass mound,
 * scattered pebbles and grass tufts, plus a soft coloured glow beneath.
 */
export function buildIsland(variant: IslandVariant, tint: THREE.Color, seed: number, radius = 1.2): THREE.Group {
  const g = new THREE.Group()
  const pal = ISLAND_PALETTE[variant]
  const rock = rockMaps(pal.rock[0], pal.rock[1], seed)
  const grass = grassMaps(pal.grass[0], pal.grass[1], seed)

  // Underside — a tapering, craggy stone keel.
  const keelGeo = craggify(new THREE.ConeGeometry(radius * 0.98, radius * 1.24, 40, 8), 0.24, 7, seed)
  const keel = new THREE.Mesh(keelGeo, surface(rock, { roughness: 1 }))
  keel.rotation.x = Math.PI
  keel.position.y = -radius * 0.62
  g.add(keel)

  // Soil band right under the grass — hides the cone/dome seam.
  const soil = new THREE.Mesh(
    craggify(new THREE.CylinderGeometry(radius * 1.005, radius * 0.9, radius * 0.34, 40, 2), 0.05, 9, seed + 3),
    surface(rock, { roughness: 0.98 }),
  )
  soil.position.y = -radius * 0.14
  g.add(soil)

  // Grass mound — a low dome so the horizon of each island reads as soft land.
  const domeGeo = new THREE.SphereGeometry(radius, 56, 22, 0, TAU, 0, Math.PI * 0.5)
  domeGeo.scale(1, 0.34, 1)
  craggify(domeGeo, 0.045, 10, seed + 11)
  const dome = new THREE.Mesh(domeGeo, surface(grass, { roughness: 0.92 }))
  dome.position.y = 0.01
  g.add(dome)

  // Rim rocks poking out of the grass — merged into one draw call.
  const pebbleParts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * TAU + seed
    const r = radius * (0.55 + ((i * 37) % 10) / 26)
    const s = radius * (0.07 + ((i * 13) % 7) / 90)
    const geo = new THREE.IcosahedronGeometry(s, 0)
    const m = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(a, a * 1.7, a * 0.6))
      .setPosition(Math.cos(a) * r, radius * 0.1 + s * 0.3, Math.sin(a) * r)
    geo.applyMatrix4(m)
    pebbleParts.push(geo)
  }
  const pebbles = new THREE.Mesh(mergeGeometries(pebbleParts, false)!, surface(rock, { roughness: 1 }))
  pebbleParts.forEach((p) => p.dispose())
  g.add(pebbles)

  // Grass tufts around the rim (skipped when the domain is dormant).
  if (variant !== 'dormant') {
    const tuftParts: THREE.BufferGeometry[] = []
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * TAU + seed * 0.7
      const r = radius * (0.62 + ((i * 29) % 9) / 40)
      const h = radius * (0.13 + ((i * 17) % 6) / 60)
      const geo = new THREE.ConeGeometry(radius * 0.045, h, 5, 1)
      const m = new THREE.Matrix4()
        .makeRotationFromEuler(new THREE.Euler(Math.sin(a) * 0.24, 0, Math.cos(a) * 0.24))
        .setPosition(Math.cos(a) * r, radius * 0.12 + h * 0.4, Math.sin(a) * r)
      geo.applyMatrix4(m)
      tuftParts.push(geo)
    }
    const tufts = new THREE.Mesh(
      mergeGeometries(tuftParts, false)!,
      new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.tuft), roughness: 0.85, side: THREE.DoubleSide }),
    )
    tuftParts.forEach((p) => p.dispose())
    g.add(tufts)
  }

  shadowsOn(g)

  // Coloured light pooling beneath the island (never casts, purely optical).
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 3.4, radius * 3.4),
    new THREE.MeshBasicMaterial({
      map: radialSprite(`rgba(${Math.round(tint.r * 255)},${Math.round(tint.g * 255)},${Math.round(tint.b * 255)},0.75)`),
      transparent: true,
      opacity: variant === 'dormant' ? 0.07 : 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  glow.rotation.x = -Math.PI / 2
  glow.position.y = -radius * 1.5
  glow.userData.islandGlow = true
  g.add(glow)

  // Dormant islands sit under low cloud — "not expressed yet", not "broken".
  if (variant === 'dormant') {
    const cloud = buildCloud(radius * 0.95)
    cloud.position.y = radius * 0.42
    cloud.userData.cloud = true
    g.add(cloud)
  }

  return g
}

/** Fluffy cloud made of merged soft spheres. */
export function buildCloud(scale = 1): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f4f2ff'),
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.94,
    envMapIntensity: 0.5,
  })
  const puffs: [number, number, number, number][] = [
    [0, 0, 0, 0.46],
    [0.42, -0.07, 0.06, 0.33],
    [-0.4, -0.05, -0.05, 0.3],
    [0.14, 0.2, -0.16, 0.28],
    [-0.16, 0.16, 0.16, 0.26],
  ]
  for (const [x, y, z, r] of puffs) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r * scale, 28, 20), mat)
    puff.position.set(x * scale, y * scale, z * scale)
    puff.castShadow = true
    g.add(puff)
  }
  return g
}

/* ── the learner: mascot on a glass podium ─────────────────────────────── */

/** The Yuvi mascot — a friendly floating robot, built from the brand mark. */
export function buildMascot(): THREE.Group {
  const g = new THREE.Group()
  const shell = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#9fc6e6'),
    roughness: 0.34,
    metalness: 0.08,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.5,
  })
  const trim = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6ea6cf'), roughness: 0.4, metalness: 0.2, envMapIntensity: 0.5 })

  const head = new THREE.Group()
  head.position.y = 0.96
  const skullGeo = new THREE.SphereGeometry(0.5, 64, 48)
  skullGeo.scale(1, 1.02, 0.9)
  const skull = new THREE.Mesh(skullGeo, shell)
  head.add(skull)

  // Dark visor patch mapped with the face texture.
  const visorGeo = new THREE.SphereGeometry(0.505, 64, 48, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.24, Math.PI * 0.5)
  visorGeo.scale(1, 1.02, 0.92)
  const visor = new THREE.Mesh(
    visorGeo,
    new THREE.MeshPhysicalMaterial({
      map: mascotFace(),
      emissiveMap: mascotFace(),
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.3,
      roughness: 0.12,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    }),
  )
  head.add(visor)

  for (const s of [1, -1]) {
    const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.16, 8, 20), trim)
    ear.position.set(s * 0.5, -0.02, 0)
    head.add(ear)
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.038, 18, 14),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#7ee6ff'), emissive: new THREE.Color('#4cc9f0'), emissiveIntensity: 0.6, roughness: 0.2 }),
    )
    dot.position.set(s * 0.545, -0.02, 0.05)
    head.add(dot)
  }

  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.22, 12), trim)
  stalk.position.y = 0.58
  head.add(stalk)
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 24, 18),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#9defff'), emissive: new THREE.Color('#4cc9f0'), emissiveIntensity: 0.85, roughness: 0.16 }),
  )
  bulb.position.y = 0.72
  head.add(bulb)
  g.add(head)

  // Small floating body + hands.
  const torsoGeo = new THREE.CapsuleGeometry(0.26, 0.2, 10, 32)
  const torso = new THREE.Mesh(torsoGeo, shell)
  torso.position.y = 0.4
  torso.scale.set(1, 0.94, 0.86)
  g.add(torso)
  const chest = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 32),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#a98cff'), emissive: new THREE.Color('#7c6cff'), emissiveIntensity: 0.5, roughness: 0.2 }),
  )
  chest.position.set(0, 0.44, 0.245)
  g.add(chest)

  const hands: THREE.Mesh[] = []
  for (const s of [1, -1]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 26, 18), trim)
    hand.position.set(s * 0.42, 0.34, 0.06)
    hands.push(hand)
    g.add(hand)
  }

  shadowsOn(g)
  g.userData.head = head
  g.userData.hands = hands
  g.userData.bulb = bulb
  return g
}

/** Translucent podium the mascot floats above. */
export function buildPodium(accent: string): THREE.Group {
  const g = new THREE.Group()
  const glass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#e7e2ff'),
    roughness: 0.06,
    metalness: 0,
    transmission: 0.92,
    thickness: 0.6,
    ior: 1.42,
    transparent: true,
    opacity: 0.78,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 0.9,
  })
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.42, 0.3, 96), glass)
  disc.position.y = -0.15
  disc.receiveShadow = true
  g.add(disc)

  const under = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 0.9, 0.34, 72),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#cfc6f5'), roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.55, envMapIntensity: 1 }),
  )
  under.position.y = -0.44
  g.add(under)

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.035, 16, 160),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(accent).lerp(new THREE.Color('#ffffff'), 0.35), emissive: new THREE.Color(accent), emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.3 }),
  )
  rim.rotation.x = -Math.PI / 2
  rim.position.y = 0
  g.add(rim)

  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 5.2),
    new THREE.MeshBasicMaterial({ map: radialSprite('rgba(150,120,255,0.6)'), transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  halo.rotation.x = -Math.PI / 2
  halo.position.y = -0.78
  g.add(halo)

  g.userData.rim = rim
  return g
}

/* ── light paths between the podium and each island ────────────────────── */

export interface LightPath {
  group: THREE.Group
  setColor: (c: THREE.Color) => void
  setStrength: (v: number) => void
  update: (dt: number) => void
  rebuild: (from: THREE.Vector3, to: THREE.Vector3) => void
  dispose: () => void
}

/**
 * A glowing dotted path — a soft ribbon plus travelling motes, so the world
 * reads as one connected system rather than seven separate objects.
 */
export function buildLightPath(color: THREE.Color, dotted = 42): LightPath {
  const group = new THREE.Group()
  const ribbonMat = new THREE.MeshBasicMaterial({
    color: color.clone(),
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  let ribbon: THREE.Mesh | null = null
  let curve: THREE.QuadraticBezierCurve3 | null = null

  const motePos = new Float32Array(dotted * 3)
  const moteGeo = new THREE.BufferGeometry()
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3))
  const moteMat = new THREE.PointsMaterial({
    map: sparkleSprite(),
    color: color.clone(),
    size: 0.11,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const motes = new THREE.Points(moteGeo, moteMat)
  group.add(motes)

  let offset = 0
  let strength = 1

  const rebuild = (from: THREE.Vector3, to: THREE.Vector3) => {
    const mid = from.clone().lerp(to, 0.5)
    mid.y += from.distanceTo(to) * 0.16 + 0.4
    curve = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone())
    ribbon?.geometry.dispose()
    const geo = new THREE.TubeGeometry(curve, 48, 0.018, 8, false)
    if (ribbon) ribbon.geometry = geo
    else {
      ribbon = new THREE.Mesh(geo, ribbonMat)
      ribbon.renderOrder = 6
      group.add(ribbon)
    }
  }

  const update = (dt: number) => {
    if (!curve) return
    offset = (offset + dt * 0.09) % 1
    const arr = motes.geometry.attributes.position.array as Float32Array
    for (let i = 0; i < dotted; i += 1) {
      const t = (i / dotted + offset) % 1
      const p = curve.getPoint(t)
      arr[i * 3] = p.x
      arr[i * 3 + 1] = p.y
      arr[i * 3 + 2] = p.z
    }
    motes.geometry.attributes.position.needsUpdate = true
    moteMat.opacity = (0.34 + 0.5 * strength) * (0.86 + Math.sin(offset * TAU * 3) * 0.14)
    moteMat.size = 0.075 + strength * 0.06
    ribbonMat.opacity = 0.08 + strength * 0.22
  }

  return {
    group,
    setColor: (c: THREE.Color) => { ribbonMat.color.copy(c); moteMat.color.copy(c) },
    setStrength: (v: number) => { strength = v },
    update,
    rebuild,
    dispose: () => {
      ribbon?.geometry.dispose()
      ribbonMat.dispose()
      moteGeo.dispose()
      moteMat.dispose()
    },
  }
}

/** Faint distant islands that give the sky depth behind the real ones. */
export function buildBackdropIslands(): THREE.Group {
  const g = new THREE.Group()
  const spots: [number, number, number, number][] = [
    [-15, 1.2, -20, 0.7],
    [14.5, 2.4, -22, 0.58],
    [-10, 4.2, -27, 0.48],
    [18, -1.4, -17, 0.44],
    [3, 5.4, -30, 0.4],
  ]
  for (let i = 0; i < spots.length; i += 1) {
    const [x, y, z, s] = spots[i]
    const mini = buildIsland('lush', new THREE.Color('#9c8cff'), i + 21, 1)
    mini.position.set(x, y, z)
    mini.scale.setScalar(s)
    mini.traverse((o: any) => {
      if (!o.isMesh) return
      o.castShadow = false
      o.receiveShadow = false
      const m = o.material
      if (m && !Array.isArray(m) && m.color && !o.userData.islandGlow) {
        o.material = m.clone()
        o.material.color.lerp(new THREE.Color('#cfc7ee'), 0.6)
        o.material.transparent = true
        o.material.opacity = 0.55
      }
      if (o.userData.islandGlow) o.visible = false
    })
    g.add(mini)
  }
  return g
}

/** Slow-drifting dust across the whole scene. */
export function buildAmbientDust(count = 160): THREE.Points {
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count; i += 1) {
    const x = (Math.random() - 0.5) * 26
    const y = Math.random() * 12 - 3
    const z = (Math.random() - 0.5) * 22 - 3
    pos.set([x, y, z], i * 3)
    seed.set([x, y, z, Math.random() * TAU], i * 4)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: sparkleSprite(),
      color: new THREE.Color('#ffffff'),
      size: 0.09,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  points.userData.dustSeed = seed
  return points
}
