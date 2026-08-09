// @ts-nocheck
/* eslint-disable */
/**
 * "החברים של יובי" — the seven companions.
 *
 * One companion per 720 activeness domain. They are Yuvi's family, so they
 * share his DNA: a ceramic white shell, indigo joints, a near-black face
 * screen and one cyan digital light. Nothing here is a toy — these are
 * guardians a 13-year-old would want standing on their island.
 *
 * What separates them is BUILD, not colour: the shape of the head, how wide
 * the shoulders sit, how heavy the legs are, how they stand, and the one tool
 * each of them carries. Seen as a black silhouette you should still know who
 * is who.
 *
 * Idle life is deliberately small: a breath, a slow look, a blink on the
 * visor, and one micro-gesture that belongs to that companion. No bouncing,
 * no cartoon squash.
 *
 * Nothing here reads product state. Callers pass a tint and a variant (how the
 * domain is expressed in the learner's real activeness) and get back a group
 * with `userData.tick(time, dt)`.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { crystal, shadowsOn, sparkleCloud } from './props'
import type { IslandVariant } from './props'

const TAU = Math.PI * 2

/** Every companion is normalised to this height, so no island out-sizes another. */
const STANDING_HEIGHT = 1.06

/* ── the family DNA ────────────────────────────────────────────────────── */

const SHELL = '#eef0f8' // ceramic plating
const CORE = '#2f2a5c' // joints and inner frame
const SCREEN = '#0a0820' // the face
const DIGITAL = '#5ceef2' // the light behind the face

/**
 * An emissive line. Deliberately dim: on these companions light is a drawn
 * detail, not a light source. Anything brighter blooms and eats the edges we
 * spent the whole file building.
 */
function glowMat(hex: string | THREE.Color, intensity = 0.5) {
  const c = new THREE.Color(hex)
  const m = new THREE.MeshStandardMaterial({
    color: c,
    emissive: c.clone(),
    emissiveIntensity: intensity,
    roughness: 0.3,
    metalness: 0,
  })
  // a sleeping companion keeps a dim pilot light — it is resting, not broken
  m.userData.keepGlow = true
  return m
}

/**
 * The materials every companion is built from. Fresh per instance.
 *
 * The look is deliberately product-like: injection-moulded white plastic with
 * a clearcoat, machined metal for the parts that take load, and a glossy black
 * screen for the face. Nothing is flat-shaded plastic-coloured geometry.
 */
function makeKit(accent: THREE.Color) {
  const deep = accent.clone().lerp(new THREE.Color(CORE), 0.72)
  return {
    accent,
    // glossy soft plastic — the clearcoat is what makes it read as a product
    shell: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(SHELL),
      roughness: 0.36,
      metalness: 0.02,
      clearcoat: 1,
      clearcoatRoughness: 0.09,
      envMapIntensity: 1.05,
    }),
    // the accent, in anodised metal
    plate: new THREE.MeshPhysicalMaterial({ color: accent.clone(), roughness: 0.26, metalness: 0.8, clearcoat: 0.5, clearcoatRoughness: 0.22, envMapIntensity: 1.2 }),
    deep: new THREE.MeshPhysicalMaterial({ color: deep, roughness: 0.3, metalness: 0.82, envMapIntensity: 1.1 }),
    joint: new THREE.MeshPhysicalMaterial({ color: new THREE.Color(CORE), roughness: 0.26, metalness: 0.9, envMapIntensity: 1.15 }),
    // bare machined metal, for bezels and hardware
    steel: new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#b7bed4'), roughness: 0.22, metalness: 0.94, envMapIntensity: 1.25 }),
    // the face: black glass, not black paint
    screen: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(SCREEN),
      roughness: 0.05,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.6,
    }),
    light: glowMat(DIGITAL, 0.52),
    accentLight: glowMat(accent, 0.3),
  }
}

function box(w: number, h: number, d: number, r: number, mat: THREE.Material) {
  const rr = Math.max(0.004, Math.min(r, Math.min(w, h, d) / 2 - 0.002))
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, rr), mat)
}

function capsule(r: number, len: number, mat: THREE.Material) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 5, 16), mat)
}

function ball(r: number, mat: THREE.Material) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 22, 16), mat)
}

/* ── the face ──────────────────────────────────────────────────────────── */

/**
 * A dark screen with two calm digital eyes. Minimal on purpose: this is a
 * companion for a 7th-9th grader, not a nursery toy — no huge pupils, no
 * exaggerated expression, just a steady look and a small light smile.
 */
function buildVisor(kit: any, o: any = {}) {
  const { w = 0.2, h = 0.145, z = 0.13, gap = 0.05, eye = 0.044, mouth = 'smile' } = o
  const g = new THREE.Group()

  // a machined bezel, so the face reads as a fitted component
  const bezel = box(w + 0.026, h + 0.026, 0.05, Math.min(w, h) * 0.3, kit.steel)
  bezel.position.z = z - 0.032
  g.add(bezel)

  const panel = box(w, h, 0.05, Math.min(w, h) * 0.28, kit.screen)
  panel.position.z = z - 0.023
  g.add(panel)

  const eyeGeo = new RoundedBoxGeometry(eye, eye * 0.6, 0.014, 3, eye * 0.25)
  const eyes: THREE.Mesh[] = []
  for (const s of [1, -1]) {
    const e = new THREE.Mesh(eyeGeo, kit.light)
    e.position.set(s * gap, h * 0.14, z + 0.006)
    g.add(e)
    eyes.push(e)
  }

  if (mouth === 'smile') {
    const m = new THREE.Mesh(new THREE.TorusGeometry(eye * 0.6, 0.0055, 6, 20, Math.PI), kit.light)
    m.position.set(0, -h * 0.2, z + 0.005)
    m.rotation.z = Math.PI
    g.add(m)
  } else if (mouth === 'scan') {
    // composed rather than smiling — this one is reading, not greeting
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.4, 0.008), kit.light)
    bar.position.set(0, -h * 0.22, z + 0.006)
    g.add(bar)
    g.userData.scan = bar
  }

  g.userData.eyes = eyes
  return g
}

/** Open nearly always, one quick close every few seconds. */
function blinkAt(time: number, phase = 0) {
  const p = (((time * 0.21 + phase) % 1) + 1) % 1
  if (p < 0.96) return 1
  return 0.08 + 0.92 * Math.abs(Math.cos(((p - 0.96) / 0.04) * Math.PI))
}

function faceTick(visor: THREE.Group | undefined, time: number, phase = 0) {
  if (!visor) return
  const k = blinkAt(time, phase)
  for (const eye of visor.userData.eyes as THREE.Mesh[]) eye.scale.y = k
}

/* ── the chassis ───────────────────────────────────────────────────────── */

/**
 * The shared body: planted legs, a built torso, articulated arms with real
 * elbows, and a mount for whichever head this companion wears. Roughly one
 * unit tall with the head at about a quarter of it — teenager proportions,
 * not baby proportions.
 */
function buildRig(kit: any, o: any = {}) {
  const {
    chestW = 0.29,
    chestH = 0.215,
    chestD = 0.2,
    shoulderX = 0.185,
    shoulderY = 0.745,
    stance = 0.105,
    legR = 0.052,
    bootW = 0.115,
    headY = 0.92,
    armR = 0.042,
    foreR = 0.037,
    upperLen = 0.13,
    foreLen = 0.12,
    elbowY = -0.185,
    wristY = -0.185,
  } = o

  const g = new THREE.Group()
  const body = new THREE.Group() // everything above the hips — this is what breathes
  g.add(body)

  const legs: any = {}
  for (const s of [1, -1]) {
    const leg = new THREE.Group()
    leg.position.x = s * stance
    const sole = box(bootW * 0.96, 0.03, 0.175, 0.012, kit.joint)
    sole.position.set(0, 0.017, 0.014)
    leg.add(sole)
    const boot = box(bootW, 0.085, 0.16, 0.032, kit.shell)
    boot.position.set(0, 0.055, 0.012)
    leg.add(boot)
    const shin = capsule(legR * 0.86, 0.11, kit.shell)
    shin.position.y = 0.18
    leg.add(shin)
    const knee = ball(legR * 0.9, kit.joint)
    knee.position.y = 0.285
    leg.add(knee)
    const thigh = capsule(legR, 0.12, kit.deep)
    thigh.position.y = 0.385
    leg.add(thigh)
    const hip = ball(legR * 1.05, kit.joint)
    hip.position.y = 0.47
    leg.add(hip)
    g.add(leg)
    legs[s === 1 ? 'r' : 'l'] = leg
  }

  const pelvis = box(0.215, 0.1, 0.165, 0.038, kit.deep)
  pelvis.position.y = 0.505
  body.add(pelvis)

  const waist = capsule(0.062, 0.045, kit.joint)
  waist.position.y = 0.575
  body.add(waist)

  const chest = box(chestW, chestH, chestD, 0.068, kit.shell)
  chest.position.y = 0.675
  body.add(chest)

  const bib = box(chestW * 0.56, chestH * 0.62, 0.05, 0.026, kit.plate)
  bib.position.set(0, 0.685, chestD / 2 - 0.008)
  body.add(bib)

  const emblem = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.012, 20), kit.accentLight)
  emblem.rotation.x = Math.PI / 2
  emblem.position.set(0, 0.7, chestD / 2 + 0.022)
  body.add(emblem)

  const collar = box(0.155, 0.05, 0.13, 0.02, kit.joint)
  collar.position.y = 0.788
  body.add(collar)

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.07, 16), kit.joint)
  neck.position.y = 0.815
  body.add(neck)

  const headMount = new THREE.Group()
  headMount.position.y = headY
  body.add(headMount)

  const arms: any = {}
  for (const s of [1, -1]) {
    const shoulder = new THREE.Group()
    shoulder.position.set(s * shoulderX, shoulderY, 0)
    const pauldron = box(0.115, 0.1, 0.14, 0.042, kit.plate)
    pauldron.position.y = 0.008
    shoulder.add(pauldron)
    const upper = capsule(armR, upperLen, kit.shell)
    upper.position.y = elbowY * 0.57
    shoulder.add(upper)

    const elbow = new THREE.Group()
    elbow.position.y = elbowY
    shoulder.add(elbow)
    elbow.add(ball(armR * 1.02, kit.joint))
    const fore = capsule(foreR, foreLen, kit.shell)
    fore.position.y = wristY * 0.51
    elbow.add(fore)
    const hand = box(0.072, 0.085, 0.058, 0.024, kit.joint)
    hand.position.y = wristY
    elbow.add(hand)

    shoulder.rotation.z = s * 0.1
    elbow.rotation.x = -0.2
    body.add(shoulder)
    arms[s === 1 ? 'r' : 'l'] = { shoulder, elbow, hand, side: s }
  }

  const rig: any = {
    group: g,
    body,
    chest,
    headMount,
    arms,
    legs,
    kit,
    phase: Math.random() * TAU,
    baseHeadY: headY,
  }

  rig.wear = (head: THREE.Group) => {
    headMount.add(head)
    rig.head = head
    rig.visor = head.userData.visor
    return head
  }

  /** The shared breath: a few millimetres, a slow look, a blink. */
  rig.idle = (time: number, k = 1) => {
    const b = Math.sin(time * 1.05 + rig.phase)
    body.position.y = b * 0.009 * k
    chest.scale.y = 1 + b * 0.014 * k
    if (rig.head) {
      rig.head.rotation.y = Math.sin(time * 0.27 + rig.phase) * 0.13 * k
      rig.head.rotation.x = Math.sin(time * 0.39 + rig.phase) * 0.03 * k
    }
    faceTick(rig.visor, time, rig.phase * 0.16)
  }

  return rig
}

/** The shared head: shell, brow band and the two side modules. */
function headShell(kit: any, w: number, h: number, d: number, r: number, ears = true) {
  const g = new THREE.Group()
  g.add(box(w, h, d, r, kit.shell))

  const band = box(w * 0.99, 0.028, d * 0.99, 0.011, kit.plate)
  band.position.y = h * 0.34
  g.add(band)

  if (ears) {
    for (const s of [1, -1]) {
      const ear = box(0.032, 0.07, 0.075, 0.014, kit.joint)
      ear.position.set(s * (w / 2 + 0.004), -h * 0.04, 0)
      g.add(ear)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.016, 14), kit.accentLight)
      cap.rotation.z = Math.PI / 2
      cap.position.set(s * (w / 2 + 0.026), -h * 0.04, 0)
      g.add(cap)
    }
  }
  return g
}

function faceOn(head: THREE.Group, kit: any, o: any = {}) {
  const visor = buildVisor(kit, o)
  head.add(visor)
  head.userData.visor = visor
  return visor
}

/* ── poses ─────────────────────────────────────────────────────────────── */

/** Hand resting on the hip — the "I've got this" stance. */
function poseHandOnHip(arm: any) {
  arm.shoulder.rotation.set(0, 0, arm.side * 0.42)
  arm.elbow.rotation.set(-0.12, 0, -arm.side * 1.32)
}

/** Relaxed at the side, elbow just soft enough to look alive. */
function poseRelaxed(arm: any, spread = 0.11) {
  arm.shoulder.rotation.set(0.06, 0, arm.side * spread)
  arm.elbow.rotation.set(-0.22, 0, -arm.side * 0.05)
}

/**
 * Forearm up and forward, so whatever this companion carries is presented
 * rather than dangled. The device rides on the hand at `holdTilt(lift)`.
 */
function poseHolding(arm: any, lift = 0) {
  arm.shoulder.rotation.set(-0.34 - lift, 0, arm.side * 0.46)
  arm.elbow.rotation.set(-1.5, 0, -arm.side * 0.2)
}

/** The tilt that turns a held screen toward whoever is looking at the island. */
function holdTilt(lift = 0) {
  return 1.28 + lift
}

/* ── the seven companions ──────────────────────────────────────────────── */

/**
 * ניהול למידה — the one who runs the plan. Widest shoulders in the family,
 * a squared-off head, a quiet ring above it and a board in one hand. Stands
 * like a captain: weight even, one hand on the hip.
 */
function planner(kit: any) {
  const rig = buildRig(kit, {
    chestW: 0.345,
    chestH: 0.225,
    chestD: 0.225,
    shoulderX: 0.222,
    shoulderY: 0.75,
    stance: 0.115,
    legR: 0.055,
    bootW: 0.122,
    headY: 0.925,
    armR: 0.045,
    foreR: 0.039,
  })
  const head = headShell(kit, 0.31, 0.255, 0.265, 0.085)
  faceOn(head, kit, { w: 0.225, h: 0.155, z: 0.142, gap: 0.056, eye: 0.046 })

  // the ring — authority, not a halo you would put on a toy
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.009, 10, 48), kit.accentLight)
  halo.rotation.x = Math.PI / 2 - 0.22
  halo.position.set(0, 0.21, -0.01)
  head.add(halo)
  rig.wear(head)

  // shoulder yokes: the silhouette has to read "broad" from far away
  for (const s of [1, -1]) {
    const yoke = box(0.12, 0.055, 0.185, 0.022, kit.deep)
    yoke.position.set(s * 0.222, 0.8, 0)
    yoke.rotation.z = -s * 0.22
    rig.body.add(yoke)
  }

  // rank chevron — one clean lit line, the only thing it wears
  for (const s of [1, -1]) {
    const bar = box(0.075, 0.014, 0.018, 0.005, kit.light)
    bar.position.set(s * 0.04, 0.755, 0.135)
    bar.rotation.z = -s * 0.44
    rig.body.add(bar)
  }

  poseHandOnHip(rig.arms.l)
  poseHolding(rig.arms.r, 0.12)

  // the board it plans on — carried up where it can actually be read
  const board = new THREE.Group()
  board.position.set(0.01, -0.26, 0.03)
  board.rotation.set(holdTilt(0.12), 0, 0.1)
  const slab = box(0.215, 0.155, 0.018, 0.016, kit.deep)
  board.add(slab)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.184, 0.124), glowMat(kit.accent.clone().lerp(new THREE.Color('#ffffff'), 0.4), 0.34))
  glass.position.z = 0.011
  board.add(glass)
  for (let i = 0; i < 3; i += 1) {
    const row = new THREE.Mesh(new THREE.PlaneGeometry(0.095, 0.007), kit.light)
    row.position.set(0.01, 0.028 - i * 0.028, 0.013)
    board.add(row)
  }
  rig.arms.r.elbow.add(board)

  shadowsOn(rig.group)

  rig.group.userData.tick = (time: number) => {
    rig.idle(time, 0.85)
    // glances down at the board, then back up to the room
    const check = Math.max(0, Math.sin(time * 0.33))
    rig.head.rotation.x += check * 0.16
    rig.head.rotation.y -= check * 0.1
    halo.rotation.z = time * 0.35
    halo.position.y = 0.2 + Math.sin(time * 0.9) * 0.006
    for (let i = 0; i < 3; i += 1) {
      const row = board.children[2 + i] as THREE.Mesh
      row.scale.x = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(time * 0.9 - i * 1.1))
    }
  }
  return rig.group
}

/**
 * שיתוף פעולה — two of them, and the point is what happens between them.
 * Not twins: one is rounder and shorter, one is squarer and taller. They are
 * mid fist-bump, and the contact is where the light is.
 */
function ally(kit: any) {
  const g = new THREE.Group()
  const made: any[] = []

  for (const s of [1, -1]) {
    const round = s === 1
    const rig = buildRig(kit, {
      chestW: round ? 0.305 : 0.25,
      chestH: round ? 0.195 : 0.24,
      chestD: round ? 0.215 : 0.18,
      shoulderX: round ? 0.195 : 0.163,
      shoulderY: round ? 0.73 : 0.765,
      stance: round ? 0.115 : 0.088,
      legR: round ? 0.056 : 0.045,
      bootW: round ? 0.125 : 0.096,
      headY: round ? 0.89 : 0.96,
      armR: round ? 0.044 : 0.037,
      foreR: round ? 0.039 : 0.033,
    })

    let head: THREE.Group
    if (round) {
      head = new THREE.Group()
      const dome = ball(0.135, kit.shell)
      dome.scale.set(1.06, 0.94, 1)
      head.add(dome)
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.014, 10, 36), kit.plate)
      band.rotation.x = Math.PI / 2
      band.position.y = 0.045
      head.add(band)
      faceOn(head, kit, { w: 0.185, h: 0.135, z: 0.108, gap: 0.047, eye: 0.042 })
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.09, 10), kit.joint)
      stalk.position.y = 0.16
      head.add(stalk)
      const tip = ball(0.026, kit.accentLight)
      tip.position.y = 0.215
      head.add(tip)
      head.userData.tip = tip
    } else {
      head = headShell(kit, 0.235, 0.26, 0.235, 0.075, false)
      faceOn(head, kit, { w: 0.175, h: 0.15, z: 0.122, gap: 0.045, eye: 0.04 })
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.07, 10), kit.joint)
      stalk.position.set(0.055, 0.155, 0)
      stalk.rotation.z = -0.22
      head.add(stalk)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 8, 24), kit.accentLight)
      ring.position.set(0.073, 0.215, 0)
      ring.rotation.y = Math.PI / 2
      head.add(ring)
      head.userData.tip = ring
    }
    rig.wear(head)

    // one carries kit on its back, the other wears a sash: even from behind
    // you can tell which of the two you are looking at
    if (round) {
      const pack = box(0.19, 0.15, 0.07, 0.028, kit.deep)
      pack.position.set(0, 0.7, -0.135)
      rig.body.add(pack)
    } else {
      const sash = box(0.045, 0.28, 0.03, 0.012, kit.plate)
      sash.position.set(0.01, 0.68, 0.095)
      sash.rotation.z = 0.5
      rig.body.add(sash)
    }

    // inner arm reaches across for the bump, outer arm carries the personality
    const inner = round ? rig.arms.l : rig.arms.r
    const outer = round ? rig.arms.r : rig.arms.l
    inner.shoulder.rotation.set(-1.24, 0, inner.side * 0.2)
    inner.elbow.rotation.set(-0.42, 0, -inner.side * 0.16)
    if (round) poseHandOnHip(outer)
    else {
      outer.shoulder.rotation.set(-0.34, 0, outer.side * 0.42)
      outer.elbow.rotation.set(-0.62, 0, -outer.side * 0.3)
    }

    const fist = box(0.085, 0.09, 0.085, 0.03, kit.plate)
    fist.position.y = -0.19
    inner.elbow.add(fist)

    rig.group.scale.setScalar(round ? 0.83 : 0.93)
    rig.group.position.set(s * 0.3, 0, s === 1 ? 0.02 : -0.02)
    rig.group.rotation.y = -s * 0.86
    g.add(rig.group)
    made.push({ rig, fist, s })
  }

  // slide them together until the fists actually meet — measured, not guessed
  g.updateMatrixWorld(true)
  const pa = new THREE.Vector3()
  const pb = new THREE.Vector3()
  made[0].fist.getWorldPosition(pa)
  made[1].fist.getWorldPosition(pb)
  const gap = pa.clone().sub(pb)
  const want = gap.clone().normalize().multiplyScalar(0.055)
  const fix = gap.sub(want).multiplyScalar(0.5)
  fix.y = 0
  made[0].rig.group.position.sub(fix)
  made[1].rig.group.position.add(fix)
  made.forEach((m) => { m.baseZ = m.rig.group.position.z })
  g.updateMatrixWorld(true)
  made[0].fist.getWorldPosition(pa)
  made[1].fist.getWorldPosition(pb)

  const contact = new THREE.Mesh(new THREE.SphereGeometry(0.05, 18, 14), glowMat(kit.accent.clone().lerp(new THREE.Color('#ffffff'), 0.45), 0.6))
  contact.position.copy(pa.clone().add(pb).multiplyScalar(0.5))
  g.add(contact)

  shadowsOn(g)

  g.userData.tick = (time: number) => {
    const beat = Math.max(0, Math.sin(time * 0.7))
    made.forEach(({ rig, baseZ }, i) => {
      rig.idle(time + i * 1.7, 0.8)
      // the micro interaction: they lean into the bump together
      rig.group.position.z = baseZ + beat * 0.012
      if (rig.head.userData.tip) rig.head.userData.tip.scale.setScalar(1 + beat * 0.14)
    })
    contact.scale.setScalar(0.85 + beat * 0.35)
    ;(contact.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.45 + beat * 0.45
  }
  return g
}

/**
 * עצמאות — the leanest of them. Nothing extra: a compact head, a single
 * light on top, and a stance that says it does not need anyone to hold it up.
 */
function scout(kit: any) {
  const rig = buildRig(kit, {
    chestW: 0.245,
    chestH: 0.225,
    chestD: 0.175,
    shoulderX: 0.158,
    shoulderY: 0.755,
    stance: 0.09,
    legR: 0.046,
    bootW: 0.1,
    headY: 0.945,
    armR: 0.037,
    foreR: 0.033,
  })

  const head = headShell(kit, 0.205, 0.225, 0.215, 0.078, false)
  faceOn(head, kit, { w: 0.155, h: 0.125, z: 0.112, gap: 0.04, eye: 0.036 })
  for (const s of [1, -1]) {
    const fin = box(0.018, 0.085, 0.105, 0.007, kit.plate)
    fin.position.set(s * 0.108, -0.012, -0.022)
    fin.rotation.x = 0.18
    head.add(fin)
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.095, 10), kit.steel)
  mast.position.y = 0.152
  head.add(mast)
  const beacon = ball(0.021, kit.accentLight)
  beacon.position.y = 0.208
  head.add(beacon)
  rig.wear(head)

  poseHandOnHip(rig.arms.r)
  poseRelaxed(rig.arms.l, 0.06)
  rig.legs.l.rotation.z = 0.04

  shadowsOn(rig.group)

  rig.group.userData.tick = (time: number) => {
    // the stillest of the seven — confidence reads as not needing to move
    rig.idle(time, 0.6)
    rig.head.rotation.y += Math.sin(time * 0.18) * 0.16
    const pulse = 0.4 + 0.25 * (0.5 + 0.5 * Math.sin(time * 1.6))
    ;(beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse
    beacon.scale.setScalar(0.94 + Math.sin(time * 1.6) * 0.06)
  }
  return rig.group
}

/**
 * קבלת החלטות — the analyst. A closed tactical visor with a scan line instead
 * of a smile, a utility belt, and a slate it keeps reading before it commits.
 */
function navigator(kit: any) {
  const rig = buildRig(kit, { chestW: 0.3, chestH: 0.225, chestD: 0.215, shoulderX: 0.196, stance: 0.108, headY: 0.915 })

  const head = headShell(kit, 0.295, 0.225, 0.25, 0.07)
  faceOn(head, kit, { w: 0.235, h: 0.128, z: 0.13, gap: 0.058, eye: 0.05, mouth: 'scan' })
  // brow blade — the "reading the situation" line
  const brow = box(0.28, 0.028, 0.245, 0.01, kit.deep)
  brow.position.set(0, 0.086, 0.012)
  brow.rotation.x = 0.12
  head.add(brow)
  // side optic: the one piece of hardware that says "this one measures things"
  const optic = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.03, 18), kit.steel)
  optic.rotation.z = Math.PI / 2
  optic.position.set(0.155, 0.012, 0.045)
  head.add(optic)
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.012, 18), glowMat(DIGITAL, 0.42))
  lens.rotation.z = Math.PI / 2
  lens.position.set(0.176, 0.012, 0.045)
  head.add(lens)
  rig.wear(head)

  // a tactical shoulder module — asymmetry is what makes the outline readable
  const module = box(0.09, 0.075, 0.13, 0.022, kit.deep)
  module.position.set(-0.215, 0.79, -0.01)
  rig.body.add(module)
  const moduleLine = box(0.02, 0.05, 0.09, 0.006, kit.light)
  moduleLine.position.set(-0.262, 0.79, -0.01)
  rig.body.add(moduleLine)

  // utility belt + thigh module: it carries what it needs to weigh options
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.018, 8, 30), kit.deep)
  belt.rotation.x = Math.PI / 2
  belt.position.y = 0.525
  belt.scale.z = 0.82
  rig.body.add(belt)
  const buckle = box(0.05, 0.045, 0.03, 0.012, kit.accentLight)
  buckle.position.set(0, 0.525, 0.1)
  rig.body.add(buckle)
  const pouch = box(0.07, 0.09, 0.05, 0.018, kit.deep)
  pouch.position.set(-0.13, 0.44, 0.03)
  pouch.rotation.z = 0.12
  rig.body.add(pouch)

  poseHolding(rig.arms.r, 0.06)
  rig.arms.l.shoulder.rotation.set(-0.34, 0, rig.arms.l.side * 0.26)
  rig.arms.l.elbow.rotation.set(-1.05, 0, -rig.arms.l.side * 0.62)
  // weight shifted back: it is considering, not walking anywhere yet
  rig.legs.l.position.z = -0.06
  rig.legs.l.rotation.x = 0.07
  rig.legs.r.position.z = 0.03
  rig.body.rotation.y = -0.1

  const slate = new THREE.Group()
  slate.position.set(0.01, -0.28, 0.03)
  slate.rotation.set(holdTilt(0.06), 0, 0.08)
  slate.add(box(0.225, 0.16, 0.016, 0.014, kit.steel))
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.128), glowMat(kit.accent.clone().lerp(new THREE.Color('#ffffff'), 0.45), 0.24))
  face.position.z = 0.01
  slate.add(face)
  const cursor = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.06), kit.light)
  cursor.position.set(-0.045, 0, 0.012)
  slate.add(cursor)
  rig.arms.r.elbow.add(slate)

  shadowsOn(rig.group)

  const scan = rig.visor.userData.scan

  rig.group.userData.tick = (time: number) => {
    rig.idle(time, 0.75)
    // weighs the options: reads the slate, looks up, reads again
    const read = Math.max(0, Math.sin(time * 0.29))
    rig.head.rotation.x += read * 0.2
    rig.head.rotation.y = rig.head.rotation.y * (1 - read) - read * 0.12
    if (scan) {
      scan.position.x = Math.sin(time * 1.4) * 0.035
      scan.scale.x = 0.6 + 0.4 * Math.abs(Math.cos(time * 1.4))
    }
    // the option under consideration steps along the slate
    cursor.position.x = -0.045 + Math.round(((Math.sin(time * 0.5) + 1) / 2) * 2) * 0.045
    ;(face.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + read * 0.12
    ;(lens.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + read * 0.3
  }
  return rig.group
}

/**
 * רפלקציה — the quiet one. Longest silhouette, crystal fins at the sides of
 * the head, a gem where its thoughts collect, and a hand near its chin.
 */
function mirror(kit: any) {
  const rig = buildRig(kit, {
    chestW: 0.255,
    chestH: 0.23,
    chestD: 0.18,
    shoulderX: 0.165,
    shoulderY: 0.755,
    stance: 0.088,
    legR: 0.047,
    bootW: 0.1,
    headY: 0.95,
    armR: 0.037,
    foreR: 0.032,
  })

  const head = new THREE.Group()
  const dome = ball(0.14, kit.shell)
  dome.scale.set(0.98, 1.06, 1)
  head.add(dome)
  const crown = box(0.21, 0.03, 0.21, 0.012, kit.steel)
  crown.position.y = 0.108
  head.add(crown)
  faceOn(head, kit, { w: 0.15, h: 0.12, z: 0.158, gap: 0.039, eye: 0.035 })

  // blades: crystal, swept off the back of the skull — a crest, never ears
  const finMat = crystal(kit.accent.clone().lerp(new THREE.Color('#ffffff'), 0.25), 0.28)
  for (const s of [1, -1]) {
    const pivot = new THREE.Group()
    pivot.position.set(s * 0.072, 0.05, -0.072)
    pivot.rotation.set(-0.98, -s * 0.3, -s * 0.3)
    const blade = new THREE.Mesh(new THREE.OctahedronGeometry(0.115, 0), finMat)
    blade.scale.set(0.3, 1.9, 0.42)
    blade.position.y = 0.11
    pivot.add(blade)
    const edge = new THREE.Mesh(new THREE.OctahedronGeometry(0.115, 0), kit.steel)
    edge.scale.set(0.13, 1.92, 0.17)
    edge.position.y = 0.11
    pivot.add(edge)
    head.add(pivot)
  }
  rig.wear(head)

  // a shard floating at its shoulder — the thought it has not put down yet
  const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), finMat)
  shard.scale.set(0.55, 1.2, 0.55)
  shard.position.set(-0.24, 0.88, -0.02)
  rig.body.add(shard)

  // the gem it keeps its thoughts in
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), crystal(kit.accent, 0.45))
  gem.position.set(0, 0.705, 0.115)
  gem.scale.set(0.8, 1.1, 0.55)
  rig.body.add(gem)

  // a light shawl, not a superhero cape
  const cape = new THREE.Mesh(
    new THREE.CylinderGeometry(0.155, 0.3, 0.52, 26, 1, true, Math.PI * 0.56, Math.PI * 0.88),
    new THREE.MeshStandardMaterial({
      color: kit.accent.clone().lerp(new THREE.Color('#ffffff'), 0.35),
      roughness: 0.5,
      metalness: 0.05,
      transparent: true,
      opacity: 0.46,
      side: THREE.DoubleSide,
      envMapIntensity: 1.1,
    }),
  )
  cape.position.set(0, 0.53, -0.015)
  rig.body.add(cape)

  // hand near the chin, weight on one leg: the pose of someone reviewing
  rig.arms.r.shoulder.rotation.set(-1.15, 0, rig.arms.r.side * 0.24)
  rig.arms.r.elbow.rotation.set(-1.25, 0, -rig.arms.r.side * 0.5)
  rig.arms.l.shoulder.rotation.set(-0.15, 0, rig.arms.l.side * 0.34)
  rig.arms.l.elbow.rotation.set(-0.35, 0, -rig.arms.l.side * 1.05)
  rig.legs.l.position.z = -0.03
  rig.body.rotation.y = 0.12

  shadowsOn(rig.group)

  rig.group.userData.tick = (time: number) => {
    rig.idle(time, 0.7)
    // a gentle thinking motion — the head tilts, it does not nod
    const think = Math.sin(time * 0.33)
    rig.head.rotation.z = 0.06 + think * 0.09
    rig.head.rotation.x += Math.max(0, think) * 0.07
    rig.arms.r.elbow.rotation.x = -1.25 + Math.sin(time * 0.66) * 0.05
    gem.rotation.y = time * 0.5
    shard.rotation.y = -time * 0.4
    shard.position.y = 0.88 + Math.sin(time * 0.7) * 0.018
    ;(gem.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.3 + (0.5 + 0.5 * Math.sin(time * 0.9)) * 0.2
    cape.rotation.z = Math.sin(time * 0.55) * 0.035
  }
  return rig.group
}

/**
 * מוטיבציה — the engine of the row. Athletic build, one foot forward, a bolt
 * crest, and a fist already up. Everything about it points forward.
 */
function spark(kit: any) {
  const rig = buildRig(kit, { chestW: 0.3, chestH: 0.225, chestD: 0.205, shoulderX: 0.192, stance: 0.1, headY: 0.915 })

  const head = headShell(kit, 0.26, 0.245, 0.25, 0.082)
  faceOn(head, kit, { w: 0.19, h: 0.145, z: 0.13, gap: 0.048 })

  // the bolt — an actual silhouette, not a decal
  const shape = new THREE.Shape()
  shape.moveTo(0.0, 0.0)
  shape.lineTo(0.072, 0.122)
  shape.lineTo(0.026, 0.13)
  shape.lineTo(0.09, 0.25)
  shape.lineTo(-0.014, 0.116)
  shape.lineTo(0.035, 0.107)
  shape.closePath()
  const bolt = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelSize: 0.007, bevelThickness: 0.006, bevelSegments: 2 }),
    glowMat(kit.accent.clone().lerp(new THREE.Color('#fff2c2'), 0.35), 0.4),
  )
  bolt.position.set(-0.036, 0.075, -0.015)
  bolt.rotation.y = 0.12
  head.add(bolt)
  rig.wear(head)

  // intake slots on the chest — where the drive comes out
  for (const s of [1, -1]) {
    const vent = box(0.018, 0.075, 0.022, 0.006, kit.light)
    vent.position.set(s * 0.072, 0.655, 0.128)
    vent.rotation.z = -s * 0.18
    rig.body.add(vent)
  }

  // fist up and forward, other hand loose and ready, shoulders turned into it
  rig.arms.r.shoulder.rotation.set(-1.42, 0, rig.arms.r.side * 0.34)
  rig.arms.r.elbow.rotation.set(-1.15, 0, -rig.arms.r.side * 0.34)
  const fist = box(0.092, 0.096, 0.092, 0.03, kit.plate)
  fist.position.y = -0.198
  rig.arms.r.elbow.add(fist)
  rig.arms.l.shoulder.rotation.set(0.42, 0, rig.arms.l.side * 0.22)
  rig.arms.l.elbow.rotation.set(-0.72, 0, -rig.arms.l.side * 0.18)
  rig.body.rotation.y = -0.16

  // weight on the front foot
  rig.legs.r.position.z = 0.075
  rig.legs.r.rotation.x = -0.1
  rig.legs.l.position.z = -0.06
  rig.legs.l.rotation.x = 0.09

  shadowsOn(rig.group)
  const sparks = sparkleCloud(10, 0.34, '#ffe6a8', 0.045)
  sparks.position.y = 0.95
  rig.group.add(sparks)

  rig.group.userData.tick = (time: number) => {
    rig.idle(time, 1.25)
    // a small, contained pump — energy, not a jump
    const drive = 0.5 + 0.5 * Math.sin(time * 1.9)
    rig.arms.r.elbow.rotation.x = -1.15 - drive * 0.18
    rig.arms.r.shoulder.rotation.x = -1.42 - drive * 0.08
    rig.body.position.y += drive * 0.006
    rig.body.rotation.y = -0.16 - drive * 0.04
    ;(bolt.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.34 + drive * 0.26
    bolt.rotation.z = Math.sin(time * 2.4) * 0.02
  }
  return rig.group
}

/**
 * התמדה — the one that does not move. Heaviest build, widest stance, a collar
 * across the shoulders and two horns. Arms folded: it is not blocking anyone,
 * it is simply still here.
 */
function anchor(kit: any) {
  const rig = buildRig(kit, {
    chestW: 0.36,
    chestH: 0.235,
    chestD: 0.24,
    shoulderX: 0.228,
    shoulderY: 0.735,
    stance: 0.138,
    legR: 0.066,
    bootW: 0.145,
    headY: 0.9,
    armR: 0.048,
    foreR: 0.043,
    upperLen: 0.14,
    foreLen: 0.2,
    elbowY: -0.195,
    wristY: -0.3,
  })

  // a head that is wider than it is tall — the only one in the family
  const head = headShell(kit, 0.325, 0.215, 0.26, 0.062)
  faceOn(head, kit, { w: 0.225, h: 0.13, z: 0.14, gap: 0.055, eye: 0.048 })
  const jaw = box(0.28, 0.055, 0.225, 0.02, kit.deep)
  jaw.position.set(0, -0.105, 0.012)
  head.add(jaw)
  const crest = box(0.16, 0.032, 0.2, 0.012, kit.steel)
  crest.position.set(0, 0.115, -0.012)
  head.add(crest)

  // horns: the whole point is that you know this one from its outline
  for (const s of [1, -1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.046, 0.21, 16), kit.plate)
    horn.position.set(s * 0.155, 0.075, -0.012)
    horn.rotation.set(-0.2, 0, -s * 0.66)
    head.add(horn)
  }
  rig.wear(head)

  // shoulder armour — mass where mass reads: across the top of the outline
  for (const s of [1, -1]) {
    const pad = box(0.155, 0.085, 0.2, 0.035, kit.deep)
    pad.position.set(s * 0.235, 0.795, 0)
    pad.rotation.z = -s * 0.24
    rig.body.add(pad)
    const trim = box(0.16, 0.022, 0.205, 0.008, kit.plate)
    trim.position.set(s * 0.238, 0.838, 0)
    trim.rotation.z = -s * 0.24
    rig.body.add(trim)
  }

  // arms crossed: forearms overlap across the belly, hands tucked away
  const fold = (arm: any, front: boolean) => {
    arm.shoulder.position.z = front ? 0.035 : -0.03
    arm.shoulder.rotation.set(front ? -0.66 : -0.58, 0, -arm.side * 0.1)
    arm.elbow.rotation.set(front ? -0.06 : 0.04, 0, -arm.side * 1.62)
    arm.hand.visible = false
    const cuff = box(0.105, 0.09, 0.105, 0.03, kit.plate)
    cuff.position.y = -0.255
    arm.elbow.add(cuff)
  }
  fold(rig.arms.r, true)
  fold(rig.arms.l, false)

  shadowsOn(rig.group)

  rig.group.userData.tick = (time: number) => {
    // almost nothing: the slowest breath in the family, and it holds its ground
    rig.idle(time, 0.4)
    rig.head.rotation.y *= 0.6
    rig.body.rotation.z = Math.sin(time * 0.24) * 0.008
  }
  return rig.group
}

/* ── assembly ──────────────────────────────────────────────────────────── */

export type CompanionKind = 'anchor' | 'scout' | 'spark' | 'ally' | 'planner' | 'mirror' | 'navigator'

const MAKERS: Record<CompanionKind, (kit: any) => THREE.Group> = {
  anchor,
  scout,
  spark,
  ally,
  planner,
  mirror,
  navigator,
}

/**
 * Each companion keeps its own accent so the row does not become seven copies
 * in seven colours — the domain tint is only whispered into it, so the island
 * and its companion still feel like one place.
 */
const ACCENT: Record<CompanionKind, string> = {
  anchor: '#4fd3ab',
  scout: '#7fd2ff',
  spark: '#ffd257',
  ally: '#f2c14e',
  planner: '#b3a2ff',
  mirror: '#e3a3ef',
  navigator: '#96a4ff',
}

/**
 * Build the companion that lives on a domain's island.
 *
 * A domain the system has no picture of yet gets a companion in standby: the
 * same figure, colour drained, one dim light still on. "Not yet" is never
 * shown as "missing", and never as something the learner did wrong.
 */
export function buildCompanion(kind: CompanionKind | string, tint: THREE.Color, variant: IslandVariant): THREE.Group {
  const key = (MAKERS[kind as CompanionKind] ? kind : 'scout') as CompanionKind
  const accent = new THREE.Color(ACCENT[key]).lerp(tint, 0.16)
  const g = MAKERS[key](makeKit(accent))

  if (variant === 'dormant') {
    const standby = new THREE.Color('#8f8ba8')
    g.traverse((o: any) => {
      if (o.userData?.sparkle) o.visible = false
      if (!o.isMesh) return
      const m = o.material
      if (Array.isArray(m) || !m) return
      if (m.color) m.color.lerp(standby, 0.68)
      if (m.emissive) m.emissiveIntensity = m.userData?.keepGlow ? m.emissiveIntensity * 0.3 : 0
      if (m.metalness !== undefined) m.metalness *= 0.45
      if (m.roughness !== undefined) m.roughness = Math.min(1, m.roughness + 0.24)
    })
  }

  // One height for all seven. The heavy one is heavier because it is WIDER,
  // never because it is taller — otherwise the row looks like an accident and
  // one island quietly outranks the others.
  const wrap = new THREE.Group()
  wrap.add(g)
  const hidden: any[] = []
  g.traverse((o: any) => {
    if (o.userData?.sparkle && o.visible) {
      o.visible = false
      hidden.push(o)
    }
  })
  const bounds = new THREE.Box3().setFromObject(g)
  for (const o of hidden) o.visible = true
  const height = Math.max(0.001, bounds.max.y - bounds.min.y)
  const norm = STANDING_HEIGHT / height
  g.scale.setScalar(norm)
  g.position.y = -bounds.min.y * norm
  wrap.userData.tick = g.userData.tick
  return wrap
}
