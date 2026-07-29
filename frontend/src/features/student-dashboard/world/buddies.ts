// @ts-nocheck
/* eslint-disable */
/**
 * "החברים של יובי" — Yuvi's friends.
 *
 * One little character per 720 activeness domain, instead of an object. A child
 * meets a *someone*, not a symbol: each friend has its own silhouette, its own
 * colours and its own visible ability — the way it moves is what the domain
 * feels like (the persistence friend keeps growing back, the initiative friend
 * takes off, the collaboration friends hold hands, and so on).
 *
 * They are deliberately one family: the same soft rounded bodies, the same
 * glossy blinking eyes, the same material language as the Yuvi mascot — so the
 * row reads as a group of friends and not as seven unrelated toys.
 *
 * Nothing here reads product state. Callers pass a tint and a variant (how the
 * domain is expressed in the learner's real activeness) and get back a group
 * with `userData.tick(time, dt)` for its idle life.
 */
import * as THREE from 'three'
import { crystal, paint, shadowsOn, sparkleCloud, surface } from './props'
import { compassFace, metalMaps } from './textures'
import type { IslandVariant } from './props'

const TAU = Math.PI * 2

/* ── the shared body language ──────────────────────────────────────────── */

/** Soft toy-like skin — the surface every friend is made of. */
function skin(hex: string | THREE.Color, extra: any = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    roughness: 0.46,
    metalness: 0.03,
    envMapIntensity: 0.75,
    ...extra,
  })
}

/** A lit accent — visors, lenses, flames. Kept below the bloom threshold. */
function lit(hex: string | THREE.Color, intensity = 0.7) {
  const c = new THREE.Color(hex)
  return new THREE.MeshStandardMaterial({
    color: c,
    emissive: c.clone(),
    emissiveIntensity: intensity,
    roughness: 0.22,
    metalness: 0.05,
  })
}

/**
 * The family face: two glossy eyes and a small smile. The eyes are what make a
 * shape read as a friend rather than a prop, and they are what blinks.
 */
function buildFace(opts: { r?: number; gap?: number; z?: number; smile?: boolean } = {}): THREE.Group {
  const { r = 0.085, gap = 0.115, z = 0.26, smile = true } = opts
  const g = new THREE.Group()
  const white = new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffffff'), roughness: 0.18, metalness: 0 })
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#241f45'), roughness: 0.16, metalness: 0 })
  const eyes: THREE.Group[] = []
  for (const s of [1, -1]) {
    const eye = new THREE.Group()
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), white)
    ball.scale.z = 0.62
    eye.add(ball)
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.58, 20, 14), dark)
    pupil.position.z = r * 0.46
    pupil.scale.z = 0.5
    eye.add(pupil)
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.2, 12, 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff') }),
    )
    spark.position.set(r * 0.24, r * 0.26, r * 0.72)
    eye.add(spark)
    eye.position.set(s * gap, 0, z)
    g.add(eye)
    eyes.push(eye)
  }
  if (smile) {
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(r * 0.62, r * 0.1, 8, 22, Math.PI), dark)
    mouth.position.set(0, -r * 1.7, z * 0.96)
    mouth.rotation.z = Math.PI
    g.add(mouth)
  }
  g.userData.eyes = eyes
  return g
}

/** Open (1) nearly always, one quick close every few seconds. */
function blinkAt(time: number, phase = 0) {
  const p = ((time * 0.24 + phase) % 1 + 1) % 1
  if (p < 0.955) return 1
  return 0.1 + 0.9 * Math.abs(Math.cos(((p - 0.955) / 0.045) * Math.PI))
}

function faceTick(face: THREE.Group | undefined, time: number, phase = 0) {
  if (!face) return
  for (const eye of face.userData.eyes as THREE.Group[]) eye.scale.y = blinkAt(time, phase)
}

/** Two stubby arms on a body — returned so a character can wave them. */
function addArms(g: THREE.Group, mat: THREE.Material, y: number, x: number, len = 0.15, r = 0.058) {
  const arms: THREE.Mesh[] = []
  for (const s of [1, -1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat)
    arm.position.set(s * x, y, 0.02)
    arm.rotation.z = s * 0.75
    arm.userData.side = s
    arm.userData.baseY = y
    g.add(arm)
    arms.push(arm)
  }
  return arms
}

/* ── the seven friends ─────────────────────────────────────────────────── */

/**
 * התמדה — a little tree-cub. Its leaves keep unfurling, one after the other,
 * and never stop coming back: growth that happens by staying with it.
 */
function sprig(tint: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  // Warm, light wood rather than real bark: against the dusk sky a dark trunk
  // turns the character into a silhouette, and a friend has to have a face.
  const bark = skin('#c69a6d')
  const moss = skin('#6bb473')

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.3, 10, 32), bark)
  body.position.y = 0.46
  body.scale.z = 0.94
  g.add(body)

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 28, 20), moss)
  belly.position.set(0, 0.4, 0.19)
  belly.scale.set(1, 1.15, 0.4)
  g.add(belly)

  for (const s of [1, -1]) {
    const root = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.09, 6, 16), bark)
    root.position.set(s * 0.15, 0.08, 0.05)
    root.rotation.z = s * 0.42
    g.add(root)
  }
  const arms = addArms(g, bark, 0.5, 0.3, 0.13, 0.055)

  const face = buildFace({ r: 0.082, gap: 0.11, z: 0.25 })
  face.position.y = 0.55
  g.add(face)

  // The crest — five leaves that unfurl in sequence, forever.
  const crest = new THREE.Group()
  crest.position.y = 0.76
  const leafMat = paint(tint.clone().lerp(new THREE.Color('#8fe58d'), 0.5), { roughness: 0.48, side: THREE.DoubleSide })
  const leafGeo = new THREE.SphereGeometry(0.16, 20, 14)
  leafGeo.scale(0.36, 0.12, 1)
  const leaves: THREE.Group[] = []
  for (let i = 0; i < 5; i += 1) {
    const pivot = new THREE.Group()
    pivot.rotation.y = (i / 5) * TAU + 0.4
    const leaf = new THREE.Mesh(leafGeo, leafMat)
    leaf.position.set(0, 0.03, 0.17)
    leaf.rotation.x = -0.5
    pivot.add(leaf)
    pivot.userData.phase = i * 0.4
    crest.add(pivot)
    leaves.push(pivot)
  }
  const seedling = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), crystal(tint, 0.4))
  seedling.position.y = 0.07
  crest.add(seedling)
  g.add(crest)

  shadowsOn(g)
  g.add(sparkleCloud(12, 0.5, '#bff0c4', 0.05))

  g.userData.tick = (time: number) => {
    faceTick(face, time, 0.1)
    crest.rotation.y = Math.sin(time * 0.4) * 0.2
    leaves.forEach((p, i) => {
      // each leaf swells in turn — the friend is always mid-growth
      const k = 0.82 + 0.22 * Math.max(0, Math.sin(time * 0.9 - p.userData.phase))
      p.scale.setScalar(k)
      p.children[0].rotation.x = -0.5 + Math.sin(time * 1.2 + i) * 0.08
    })
    arms.forEach((a, i) => { a.rotation.z = a.userData.side * (0.75 + Math.sin(time * 1.3 + i) * 0.12) })
  }
  return g
}

/**
 * עצמאות — a scout with a periscope for a head. It keeps scanning the horizon
 * and choosing where to look next, all on its own.
 */
function scout(tint: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const metal = surface(metalMaps(), { metalness: 0.82, roughness: 0.3, envMapIntensity: 1.2 })
  const suit = skin(tint, { roughness: 0.4, metalness: 0.1 })

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.34, 10, 32), suit)
  body.position.y = 0.44
  g.add(body)
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 12, 32), metal)
  collar.rotation.x = Math.PI / 2
  collar.position.y = 0.66
  g.add(collar)
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.14), skin('#4c4870', { roughness: 0.6 }))
  pack.position.set(0, 0.46, -0.24)
  g.add(pack)
  for (const s of [1, -1]) {
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.08, 6, 14), metal)
    boot.position.set(s * 0.12, 0.07, 0.03)
    g.add(boot)
  }
  const arms = addArms(g, suit, 0.46, 0.26, 0.14, 0.05)

  // The periscope: a telescoping neck with a single big lens-eye.
  const scope = new THREE.Group()
  scope.position.y = 0.7
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.3, 18), metal)
  neck.position.y = 0.15
  scope.add(neck)
  const headTube = new THREE.Group()
  headTube.position.y = 0.34
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.34, 26), suit)
  barrel.rotation.x = Math.PI / 2
  headTube.add(barrel)
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.07, 26), metal)
  hood.rotation.x = Math.PI / 2
  hood.position.z = 0.19
  headTube.add(hood)
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.115, 30), lit('#8fd8ff', 0.85))
  lens.position.z = 0.225
  headTube.add(lens)
  const iris = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.108, 30),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff'), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  )
  iris.position.z = 0.228
  headTube.add(iris)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.145, 24, 16, 0, TAU, 0, Math.PI / 2), suit)
  cap.position.y = 0.02
  headTube.add(cap)
  scope.add(headTube)
  g.add(scope)

  shadowsOn(g)
  const stars = sparkleCloud(14, 0.45, '#bfe4ff', 0.05)
  stars.position.y = 1.05
  g.add(stars)

  g.userData.tick = (time: number) => {
    // scans the horizon, then rises for a longer look
    scope.rotation.y = Math.sin(time * 0.45) * 0.75
    const reach = 0.5 + Math.max(0, Math.sin(time * 0.32)) * 0.5
    neck.scale.y = 0.8 + reach * 0.45
    neck.position.y = 0.15 * neck.scale.y
    headTube.position.y = 0.24 + reach * 0.2
    headTube.rotation.x = Math.sin(time * 0.6) * 0.12
    ;(lens.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + Math.sin(time * 2.1) * 0.2
    arms.forEach((a, i) => { a.rotation.z = a.userData.side * (0.75 + Math.sin(time * 1.1 + i * 1.7) * 0.1) })
  }
  return g
}

/**
 * יוזמה — a spark that never waits to be told. It hovers, gathers itself and
 * takes off, again and again.
 */
function ember(tint: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const core = new THREE.Group()
  core.position.y = 0.52
  const bodyMat = skin(tint.clone().lerp(new THREE.Color('#ffd27a'), 0.35), { roughness: 0.34 })

  const bodyGeo = new THREE.SphereGeometry(0.3, 34, 26)
  bodyGeo.scale(1, 1.12, 1)
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  core.add(body)

  const face = buildFace({ r: 0.088, gap: 0.115, z: 0.25 })
  face.position.y = 0.05
  core.add(face)
  const arms = addArms(core, bodyMat, 0.02, 0.29, 0.12, 0.05)

  // Flame crest — the visible "I'm off".
  const flame = new THREE.Group()
  flame.position.y = 0.32
  const flameMat = lit('#ffb44d', 0.9)
  const tongues: THREE.Mesh[] = []
  for (let i = 0; i < 3; i += 1) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.075 - i * 0.014, 0.26 - i * 0.05, 14), flameMat)
    t.position.set((i - 1) * 0.09, 0.12 - i * 0.02, 0)
    t.rotation.z = (i - 1) * -0.25
    flame.add(t)
    tongues.push(t)
  }
  core.add(flame)

  // Thruster ring under it — it is always about to move.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.19, 0.03, 12, 36),
    lit(tint.clone().lerp(new THREE.Color('#ffffff'), 0.3), 0.6),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = -0.3
  core.add(ring)
  g.add(core)

  shadowsOn(g)
  const sparks = sparkleCloud(22, 0.5, '#ffd9a0', 0.06)
  sparks.position.y = 0.36
  g.add(sparks)

  g.userData.tick = (time: number) => {
    faceTick(face, time, 0.55)
    // gather … and go
    const cycle = (time * 0.55) % 1
    const launch = cycle < 0.62 ? 0 : Math.sin(((cycle - 0.62) / 0.38) * Math.PI)
    core.position.y = 0.52 + Math.sin(time * 1.6) * 0.05 + launch * 0.26
    core.rotation.y = Math.sin(time * 0.5) * 0.35
    body.scale.y = 1 - launch * 0.12
    tongues.forEach((t, i) => {
      const f = 1 + Math.sin(time * 7 + i * 1.9) * 0.16 + launch * 0.5
      t.scale.set(1, f, 1)
    })
    ;(ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.45 + launch * 0.7
    ring.scale.setScalar(1 + launch * 0.4)
    arms.forEach((a) => { a.rotation.z = a.userData.side * (0.75 - launch * 0.9) })
  }
  return g
}

/**
 * שיתוף פעולה — two friends holding hands, with a small circle of others
 * orbiting around them. Nobody here is learning alone.
 */
function pair(tint: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const tones = [tint.clone(), tint.clone().offsetHSL(0.08, 0.03, 0.08)]
  const bodies: THREE.Group[] = []
  const faces: THREE.Group[] = []
  for (let i = 0; i < 2; i += 1) {
    const s = i === 0 ? 1 : -1
    const one = new THREE.Group()
    const mat = skin(tones[i], { roughness: 0.42 })
    const h = i === 0 ? 0.48 : 0.42
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, h * 0.5, 10, 28), mat)
    body.position.y = 0.3
    one.add(body)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 30, 22), mat)
    head.position.y = 0.62
    one.add(head)
    const face = buildFace({ r: 0.062, gap: 0.083, z: 0.185 })
    face.position.y = 0.63
    one.add(face)
    faces.push(face)
    // the inner arms meet in the middle
    const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 6, 12), mat)
    inner.position.set(-s * 0.17, 0.34, 0.04)
    inner.rotation.z = s * 0.95
    one.add(inner)
    const outer = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.14, 6, 12), mat)
    outer.position.set(s * 0.2, 0.32, 0.02)
    outer.rotation.z = -s * 0.6
    one.add(outer)
    one.position.set(s * 0.26, 0, i === 0 ? 0.02 : -0.02)
    one.rotation.y = -s * 0.3
    g.add(one)
    bodies.push(one)
  }
  // the held hands
  const hands = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), skin('#ffe6c9', { roughness: 0.5 }))
  hands.position.set(0, 0.44, 0.05)
  g.add(hands)

  // a ring of friends orbiting the two
  const orbit = new THREE.Group()
  orbit.position.y = 0.62
  orbit.rotation.x = 0.42
  const orbMat = lit(tint.clone().lerp(new THREE.Color('#ffffff'), 0.35), 0.55)
  const orbs: THREE.Mesh[] = []
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * TAU
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), orbMat)
    orb.position.set(Math.cos(a) * 0.52, 0, Math.sin(a) * 0.52)
    orb.userData.a = a
    orbit.add(orb)
    orbs.push(orb)
  }
  const track = new THREE.Mesh(
    new THREE.TorusGeometry(0.52, 0.008, 8, 60),
    new THREE.MeshBasicMaterial({ color: tint.clone().lerp(new THREE.Color('#ffffff'), 0.5), transparent: true, opacity: 0.35 }),
  )
  track.rotation.x = -Math.PI / 2
  orbit.add(track)
  g.add(orbit)

  shadowsOn(g)
  g.add(sparkleCloud(14, 0.5, '#ffe0b8', 0.05))

  g.userData.tick = (time: number) => {
    faces.forEach((f, i) => faceTick(f, time, i * 0.5))
    // they rock together, in step
    bodies.forEach((b, i) => {
      const s = i === 0 ? 1 : -1
      b.position.y = Math.sin(time * 1.5 + i * 0.5) * 0.035
      b.rotation.z = Math.sin(time * 1.5 + i * 0.5) * 0.05 * s
    })
    hands.position.y = 0.44 + Math.sin(time * 1.5) * 0.03
    orbit.rotation.y = time * 0.5
    orbs.forEach((o, i) => { o.position.y = Math.sin(time * 1.7 + i * 2.1) * 0.07 })
  }
  return g
}

/**
 * ניהול למידה — a planner friend wearing its book like a shell, with its own
 * checklist floating in front of it. It knows what comes next.
 */
function planner(tint: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const coat = skin(tint, { roughness: 0.44 })
  const cover = paint(tint.clone().offsetHSL(0, 0.05, -0.14), { roughness: 0.4 })

  const bodyGeo = new THREE.SphereGeometry(0.3, 32, 24)
  bodyGeo.scale(1, 1.06, 0.9)
  const body = new THREE.Mesh(bodyGeo, coat)
  body.position.y = 0.44
  g.add(body)
  const bib = new THREE.Mesh(new THREE.SphereGeometry(0.2, 26, 18), skin('#f2eeff', { roughness: 0.6 }))
  bib.position.set(0, 0.4, 0.19)
  bib.scale.set(1, 1.1, 0.36)
  g.add(bib)
  for (const s of [1, -1]) {
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.06, 6, 14), skin('#e8a24e', { roughness: 0.5 }))
    foot.position.set(s * 0.12, 0.06, 0.06)
    foot.rotation.x = -0.4
    g.add(foot)
  }
  const arms = addArms(g, coat, 0.46, 0.29, 0.12, 0.05)

  const face = buildFace({ r: 0.095, gap: 0.125, z: 0.26 })
  face.position.y = 0.52
  g.add(face)
  // brows: this one is a planner, it is concentrating
  for (const s of [1, -1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.022, 0.02), new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3164'), roughness: 0.5 }))
    brow.position.set(s * 0.125, 0.66, 0.25)
    brow.rotation.z = -s * 0.2
    g.add(brow)
  }

  // The book shell on its back — open, like a plan you can see.
  const shell = new THREE.Group()
  shell.position.set(0, 0.5, -0.24)
  for (const s of [1, -1]) {
    const half = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.045), cover)
    half.position.set(s * 0.17, 0, -0.02)
    half.rotation.y = s * 0.5
    shell.add(half)
    const page = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.32),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#f6f3ff'), roughness: 0.9, side: THREE.DoubleSide }),
    )
    page.position.set(s * 0.16, 0, 0.01)
    page.rotation.y = s * 0.5
    shell.add(page)
  }
  g.add(shell)

  // Its checklist: three cards, one of which gets ticked off on every pass.
  const cards = new THREE.Group()
  cards.position.set(0, 0.62, 0.3)
  const cardMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#fbfaff'), roughness: 0.7, side: THREE.DoubleSide })
  const tickMat = lit('#43c98a', 0.5)
  const list: { card: THREE.Group; tick: THREE.Mesh }[] = []
  for (let i = 0; i < 3; i += 1) {
    const card = new THREE.Group()
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.13), cardMat)
    card.add(plate)
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.012),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#c7c2e0') }),
    )
    line.position.set(0.02, -0.02, 0.002)
    card.add(line)
    const tick = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 8, 20), tickMat)
    tick.position.set(-0.06, 0.01, 0.004)
    card.add(tick)
    card.position.set((i - 1) * 0.24, i === 1 ? 0.08 : 0, i === 1 ? 0.04 : 0)
    card.rotation.y = (i - 1) * -0.4
    card.userData.phase = i * 0.9
    cards.add(card)
    list.push({ card, tick })
  }
  g.add(cards)

  shadowsOn(g)
  g.add(sparkleCloud(12, 0.5, '#cfd6ff', 0.05))

  g.userData.tick = (time: number) => {
    faceTick(face, time, 0.3)
    cards.rotation.y = Math.sin(time * 0.35) * 0.18
    list.forEach(({ card, tick }) => {
      card.position.y += (Math.sin(time * 1.3 + card.userData.phase) * 0.02 - card.position.y * 0.02) * 0.4
      // each item gets ticked in its turn — the plan is always moving
      const done = Math.max(0, Math.sin(time * 0.8 - card.userData.phase))
      tick.scale.setScalar(0.6 + done * 0.9)
      ;(tick.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25 + done * 0.5
    })
    arms.forEach((a, i) => { a.rotation.z = a.userData.side * (0.75 + Math.sin(time * 1.2 + i * 2) * 0.14) })
  }
  return g
}

/**
 * רפלקציה — a quiet crystal friend. It keeps its own thoughts turning around
 * it in the light, and opens its eyes when it has looked long enough.
 */
function mirror(tint: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const robe = skin(tint.clone().offsetHSL(0, -0.1, -0.06), { roughness: 0.5 })

  const bodyGeo = new THREE.ConeGeometry(0.3, 0.55, 30)
  const body = new THREE.Mesh(bodyGeo, robe)
  body.position.y = 0.28
  g.add(body)
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.22, 28, 20), robe)
  shoulders.position.y = 0.5
  shoulders.scale.y = 0.6
  g.add(shoulders)
  const arms = addArms(g, robe, 0.44, 0.24, 0.11, 0.048)

  // A faceted head that catches the light from every side.
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), crystal(tint, 0.45))
  head.position.y = 0.76
  g.add(head)
  const face = buildFace({ r: 0.062, gap: 0.085, z: 0.21, smile: true })
  face.position.y = 0.78
  g.add(face)

  // Its thoughts, turning slowly around its head.
  const halo = new THREE.Group()
  halo.position.y = 0.8
  const shardMat = crystal(tint.clone().lerp(new THREE.Color('#ffffff'), 0.3), 0.55)
  const shards: THREE.Mesh[] = []
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * TAU
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), shardMat)
    shard.position.set(Math.cos(a) * 0.4, Math.sin(a * 2) * 0.07, Math.sin(a) * 0.4)
    shard.scale.set(0.7, 1.5, 0.7)
    shard.userData.a = a
    halo.add(shard)
    shards.push(shard)
  }
  g.add(halo)

  shadowsOn(g)
  g.add(sparkleCloud(18, 0.55, '#f0dcff', 0.055))

  g.userData.tick = (time: number) => {
    faceTick(face, time, 0.8)
    halo.rotation.y = time * 0.32
    halo.rotation.z = Math.sin(time * 0.4) * 0.12
    shards.forEach((s, i) => {
      s.rotation.y = time * 0.6 + i
      s.position.y = Math.sin(time * 1.1 + s.userData.a * 2) * 0.09
    })
    head.rotation.y = Math.sin(time * 0.3) * 0.3
    // it looks down in thought, then lifts its head again
    const think = Math.sin(time * 0.45)
    head.rotation.x = think * 0.12
    face.rotation.x = think * 0.12
    face.position.y = 0.78 - Math.max(0, think) * 0.01
    arms.forEach((a) => { a.rotation.z = a.userData.side * 0.85 })
  }
  return g
}

/**
 * קבלת החלטות — a navigator wearing a compass. Its needle spins while it
 * weighs the options, then settles on one and holds it.
 */
function navigator(tint: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const metal = surface(metalMaps(), { metalness: 0.85, roughness: 0.28, envMapIntensity: 1.3 })
  const coat = skin(tint, { roughness: 0.42 })

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.3, 10, 30), coat)
  body.position.y = 0.44
  g.add(body)
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 10, 34), paint('#f2d68a', { metalness: 0.6, roughness: 0.3 }))
  sash.rotation.set(Math.PI / 2, 0, 0.5)
  sash.position.y = 0.44
  g.add(sash)
  for (const s of [1, -1]) {
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.07, 6, 14), skin('#4c4870', { roughness: 0.55 }))
    boot.position.set(s * 0.13, 0.07, 0.04)
    g.add(boot)
  }
  const arms = addArms(g, coat, 0.46, 0.28, 0.13, 0.05)

  const face = buildFace({ r: 0.085, gap: 0.112, z: 0.245 })
  face.position.y = 0.55
  g.add(face)

  // Arrow fins — it is built to point somewhere.
  const fins: THREE.Mesh[] = []
  for (const s of [1, -1]) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 4), paint(tint.clone().lerp(new THREE.Color('#ffffff'), 0.25), { roughness: 0.38 }))
    fin.position.set(s * 0.3, 0.46, -0.08)
    fin.rotation.set(Math.PI / 2, 0, s * -0.5)
    fin.scale.z = 0.35
    fin.userData.side = s
    g.add(fin)
    fins.push(fin)
  }

  // The compass hat, with a needle that actually decides.
  const hat = new THREE.Group()
  hat.position.y = 0.76
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.07, 40), metal)
  hat.add(dial)
  const faceDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.21, 40),
    new THREE.MeshStandardMaterial({ map: compassFace(`#${tint.getHexString()}`), roughness: 0.55, metalness: 0.05 }),
  )
  faceDisc.rotation.x = -Math.PI / 2
  faceDisc.position.y = 0.037
  hat.add(faceDisc)
  const needle = new THREE.Group()
  needle.position.y = 0.055
  const north = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.19, 4), paint('#ff6b6b', { roughness: 0.3, metalness: 0.3 }))
  north.position.z = 0.09
  north.rotation.x = Math.PI / 2
  needle.add(north)
  const south = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 4), paint('#e8e6f6', { roughness: 0.3, metalness: 0.3 }))
  south.position.z = -0.07
  south.rotation.x = -Math.PI / 2
  needle.add(south)
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.035, 18, 12), metal)
  needle.add(pin)
  hat.add(needle)
  g.add(hat)

  shadowsOn(g)
  g.add(sparkleCloud(12, 0.5, '#cdd4ff', 0.05))

  g.userData.tick = (time: number) => {
    faceTick(face, time, 0.65)
    // weigh the options … then commit, and hold it
    const cycle = (time * 0.22) % 1
    if (cycle < 0.45) needle.rotation.y = -time * 3.2
    else {
      const settle = Math.min(1, (cycle - 0.45) / 0.12)
      const target = Math.round(needle.rotation.y / (TAU / 8)) * (TAU / 8)
      needle.rotation.y += (target - needle.rotation.y) * settle * 0.25
      needle.rotation.y += Math.sin(time * 6) * 0.01 * (1 - settle)
    }
    hat.rotation.z = Math.sin(time * 0.7) * 0.05
    fins.forEach((f) => { f.rotation.z = f.userData.side * (-0.5 + Math.sin(time * 1.4) * 0.12) })
    arms.forEach((a, i) => { a.rotation.z = a.userData.side * (0.75 + Math.sin(time * 1.15 + i * 1.4) * 0.12) })
  }
  return g
}

export type BuddyKind = 'sprig' | 'scout' | 'ember' | 'pair' | 'planner' | 'mirror' | 'navigator'

const BUDDIES: Record<BuddyKind, (tint: THREE.Color) => THREE.Group> = {
  sprig,
  scout,
  ember,
  pair,
  planner,
  mirror,
  navigator,
}

/**
 * Build the friend that lives on a domain's island.
 *
 * A domain the system has no picture of yet gets a friend cast in cool stone —
 * still there, still recognisable, just waiting to wake up. "Not yet" is never
 * shown as "missing", and never as something the learner did wrong.
 */
export function buildBuddy(kind: BuddyKind | string, tint: THREE.Color, variant: IslandVariant): THREE.Group {
  const make = BUDDIES[kind as BuddyKind] ?? sprig
  const g = make(tint)
  if (variant === 'dormant') {
    const stone = new THREE.Color('#8f8ba8')
    g.traverse((o: any) => {
      if (o.userData?.sparkle) o.visible = false
      if (!o.isMesh) return
      const m = o.material
      if (Array.isArray(m) || !m) return
      if (m.color) m.color.lerp(stone, 0.72)
      if (m.emissive) m.emissiveIntensity = 0
      if (m.metalness !== undefined) m.metalness *= 0.4
      if (m.roughness !== undefined) m.roughness = Math.min(1, m.roughness + 0.28)
    })
  }
  return g
}
