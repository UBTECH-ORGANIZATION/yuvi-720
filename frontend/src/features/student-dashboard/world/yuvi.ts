// @ts-nocheck
/* eslint-disable */
/**
 * יובי — the real companion, standing inside the activeness world.
 *
 * The map used to host a stand-in mascot that merely resembled Yuvi. The
 * learner already knows Yuvi from the mapping questionnaire and the coach
 * dock, so a lookalike broke the illusion that this is *his* world. This is the
 * same character, built from the same DNA as `learner-mapping/YuviRobot3D`:
 *
 *   ceramic shell #f1f2fb · indigo core #2b2560 · black glass visor #07061a
 *   cyan light #4eeef0 · big helmet head, halo antenna, ear pods, chest "Y"
 *
 * It is a plain builder (no React, no design provider) so the WebGL scene can
 * own it: normalised to a height of 1 with the feet at y = 0, so the caller
 * scales it in world units and never has to know the model's proportions.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import yuviFaviconUrl from '../../../assets/yuvi-favicon.png'
import { shadowsOn } from './props'

const CORE = '#2b2560'
const SHELL = '#f1f2fb'
const DEEP = '#342c6d'
const SCREEN = '#07061a'
const CYAN = '#4eeef0'

/** The chest mark is decoded once and shared by every Yuvi in the app. */
let sharedFavicon: THREE.Texture | null = null
function faviconTexture(): THREE.Texture {
  if (!sharedFavicon) {
    sharedFavicon = new THREE.TextureLoader().load(yuviFaviconUrl)
    sharedFavicon.colorSpace = THREE.SRGBColorSpace
  }
  return sharedFavicon
}

/**
 * Yuvi's face is light, not paint: cyan closed-happy eyes and a smile drawn on
 * a canvas and added over the black glass. Redrawing is cheap but not free, so
 * the caller only redraws when the blink actually moves.
 */
function faceLightTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 480
  const ctx = canvas.getContext('2d')!
  const SW = 0.82
  const SH = 0.62
  const toPx = (x: number, y: number): [number, number] => [
    (x / SW + 0.5) * canvas.width,
    (0.5 - y / SH) * canvas.height,
  ]

  const eyeArc = (cx: number, cy: number, r: number, lw: number, stroke: string, blur: number, open: number) => {
    const [x, y] = toPx(cx, cy)
    const pxR = (r * canvas.width) / SW
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(1, Math.max(0.16, open))
    ctx.lineCap = 'round'
    ctx.lineWidth = lw
    ctx.strokeStyle = stroke
    ctx.shadowColor = CYAN
    ctx.shadowBlur = blur
    ctx.beginPath()
    ctx.arc(0, 0, pxR, Math.PI * 1.08, Math.PI * 1.92)
    ctx.stroke()
    ctx.restore()
  }

  const SMILE: Array<[number, number]> = [
    [-0.205, -0.09], [-0.1, -0.158], [0, -0.175], [0.1, -0.158], [0.205, -0.09],
  ]
  const smile = (lw: number, stroke: string, blur: number) => {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = lw
    ctx.strokeStyle = stroke
    ctx.shadowColor = CYAN
    ctx.shadowBlur = blur
    ctx.beginPath()
    SMILE.forEach(([x, y], i) => {
      const [px, py] = toPx(x, y)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.stroke()
    ctx.restore()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  // Four passes per feature — a wide halo down to a white core — so the light
  // reads as neon rather than a flat line.
  const draw = (open = 1) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const cx of [-0.165, 0.165]) {
      eyeArc(cx, 0.06, 0.066, 30, 'rgba(78,238,240,0.22)', 28, open)
      eyeArc(cx, 0.06, 0.066, 18, 'rgba(78,238,240,0.55)', 18, open)
      eyeArc(cx, 0.06, 0.066, 9, 'rgba(174,250,255,0.98)', 9, open)
      eyeArc(cx, 0.06, 0.066, 4, 'rgba(238,255,255,1)', 4, open)
    }
    smile(22, 'rgba(124,92,255,0.22)', 26)
    smile(10, 'rgba(78,238,240,0.94)', 12)
    smile(4, 'rgba(226,255,255,1)', 4)
    texture.needsUpdate = true
  }

  draw(1)
  return { texture, draw }
}

/** A flat rounded rectangle — the visor bezel and glass are drawn shapes. */
function roundedPlane(w: number, h: number, r: number, material: THREE.Material) {
  const x = -w / 2
  const y = -h / 2
  const shape = new THREE.Shape()
  shape.moveTo(x + r, y)
  shape.lineTo(x + w - r, y)
  shape.quadraticCurveTo(x + w, y, x + w, y + r)
  shape.lineTo(x + w, y + h - r)
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  shape.lineTo(x + r, y + h)
  shape.quadraticCurveTo(x, y + h, x, y + h - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  return new THREE.Mesh(new THREE.ShapeGeometry(shape, 16), material)
}

function capsule(radius: number, length: number, material: THREE.Material) {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24), material))
  const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), material)
  cap.position.y = length / 2
  g.add(cap)
  const under = cap.clone()
  under.position.y = -length / 2
  g.add(under)
  return g
}

/**
 * Build Yuvi. The returned group is normalised: 1 unit tall, feet on y = 0,
 * facing +Z. `userData.tick(time, dt)` idles him and `userData.setFly(k)`
 * blends between standing (0) and a flying pose (1).
 */
export function buildYuvi(): THREE.Group {
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(SHELL),
    roughness: 0.24,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.13,
    sheen: 0.55,
    sheenColor: new THREE.Color('#b9a8ff'),
    sheenRoughness: 0.55,
    iridescence: 0.22,
    iridescenceIOR: 1.35,
    envMapIntensity: 1.2,
  })
  const jointMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(CORE), roughness: 0.34, metalness: 0.75, envMapIntensity: 1.15, clearcoat: 0.5, clearcoatRoughness: 0.28 })
  const deepMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(DEEP), roughness: 0.4, metalness: 0.3, envMapIntensity: 1.05, clearcoat: 0.7, clearcoatRoughness: 0.24, sheen: 0.4, sheenColor: new THREE.Color('#7c6bff') })
  const faceMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(SCREEN), roughness: 0.07, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.5 })
  const ringMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(CYAN), emissive: new THREE.Color(CYAN), emissiveIntensity: 1.1, roughness: 0.3, toneMapped: false })
  const earCapMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(CYAN), emissive: new THREE.Color(CYAN), emissiveIntensity: 0.5, roughness: 0.3, toneMapped: false })

  const root = new THREE.Group()
  const robot = new THREE.Group()
  root.add(robot)

  /* ── legs: chunky toy parts with oversized soft boots ── */
  const makeLeg = (side: number) => {
    const leg = new THREE.Group()
    const hip = new THREE.Mesh(new THREE.SphereGeometry(0.104, 24, 18), shellMat)
    hip.scale.set(1.08, 0.92, 1)
    hip.position.set(0.014 * side, 0.39, 0.015)
    leg.add(hip)
    const thigh = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.165, 0.145, 6, 0.06), shellMat)
    thigh.position.set(0.01 * side, 0.29, 0.018)
    leg.add(thigh)
    const knee = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.052, 22), jointMat)
    knee.position.set(0.003 * side, 0.18, 0.025)
    knee.scale.set(1.05, 0.78, 1)
    leg.add(knee)
    const shin = new THREE.Mesh(new RoundedBoxGeometry(0.162, 0.19, 0.145, 6, 0.06), shellMat)
    shin.position.set(-0.003 * side, 0.075, 0.04)
    leg.add(shin)
    const flash = new THREE.Mesh(new RoundedBoxGeometry(0.108, 0.13, 0.026, 5, 0.026), deepMat)
    flash.position.set(-0.003 * side, 0.078, 0.126)
    leg.add(flash)
    const ankle = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.052, 22), shellMat)
    ankle.position.set(-0.003 * side, -0.045, 0.04)
    ankle.scale.set(1.12, 0.66, 1)
    leg.add(ankle)
    const foot = new THREE.Mesh(new RoundedBoxGeometry(0.255, 0.125, 0.36, 6, 0.068), shellMat)
    foot.position.set(0.006 * side, -0.1, 0.105)
    foot.rotation.x = -0.09
    leg.add(foot)
    const toe = new THREE.Mesh(new RoundedBoxGeometry(0.205, 0.07, 0.17, 5, 0.04), deepMat)
    toe.position.set(0.006 * side, -0.078, 0.208)
    toe.rotation.x = -0.1
    leg.add(toe)
    leg.position.set(0.145 * side, 0.12, 0)
    return leg
  }
  const legL = makeLeg(-1)
  const legR = makeLeg(1)
  robot.add(legL, legR)

  const hips = new THREE.Mesh(new RoundedBoxGeometry(0.33, 0.11, 0.25, 5, 0.06), shellMat)
  hips.position.y = 0.54
  robot.add(hips)

  /* ── torso: a small glossy egg so the head dominates ── */
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.27, 34, 30), deepMat)
  torso.scale.set(0.9, 1.02, 0.76)
  torso.position.y = 0.82
  robot.add(torso)
  const yoke = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.12, 0.27, 5, 0.06), shellMat)
  yoke.position.set(0, 1.08, 0)
  robot.add(yoke)

  // The chest mark is the real Yuvi favicon, so the character is recognisable
  // even at map scale where the face is only a few pixels wide.
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ map: faviconTexture(), transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false }),
  )
  badge.position.set(0, 0.845, 0.23)
  badge.renderOrder = 6
  robot.add(badge)

  /* ── arms: blue upper, pale gauntlet, mitten hand ── */
  const makeArm = (side: number) => {
    const arm = new THREE.Group()
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.118, 24, 18), shellMat)
    shoulder.scale.set(1.05, 0.92, 1.03)
    arm.add(shoulder)
    const upper = new THREE.Mesh(new RoundedBoxGeometry(0.128, 0.2, 0.125, 5, 0.052), shellMat)
    upper.position.set(0.028 * side, -0.13, 0.008)
    arm.add(upper)
    const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.064, 22), jointMat)
    elbow.position.set(0.045 * side, -0.232, 0.008)
    elbow.scale.set(1.05, 0.74, 1)
    arm.add(elbow)
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.078, 0.235, 24), deepMat)
    fore.position.set(0.052 * side, -0.34, 0.026)
    fore.scale.set(1.06, 1, 0.82)
    arm.add(fore)
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.086, 0.062, 22), shellMat)
    wrist.position.set(0.056 * side, -0.47, 0.035)
    wrist.scale.set(1.08, 0.64, 0.94)
    arm.add(wrist)
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.096, 22, 16), shellMat)
    hand.scale.set(0.98, 1.1, 0.82)
    hand.position.set(0.058 * side, -0.545, 0.068)
    arm.add(hand)
    const thumb = capsule(0.03, 0.082, shellMat)
    thumb.position.set(0.012 * side, -0.555, 0.085)
    thumb.rotation.z = 0.45 * side
    thumb.rotation.x = 0.28
    arm.add(thumb)
    const finger = capsule(0.028, 0.095, shellMat)
    finger.position.set(0.092 * side, -0.585, 0.088)
    finger.rotation.z = -0.12 * side
    finger.rotation.x = 0.24
    arm.add(finger)
    arm.position.set(0.318 * side, 1.015, -0.005)
    arm.rotation.z = 0.095 * side
    arm.userData.restZ = 0.095 * side
    return arm
  }
  const armL = makeArm(-1)
  const armR = makeArm(1)
  robot.add(armL, armR)

  /* ── head: the big helmet wrapping a black screen ── */
  const head = new THREE.Group()
  head.position.y = 1.59
  head.scale.setScalar(0.9)
  robot.add(head)
  const helmet = new THREE.Mesh(new RoundedBoxGeometry(1.12, 1.02, 0.94, 6, 0.42), shellMat)
  helmet.scale.set(1, 1, 0.95)
  head.add(helmet)

  // A floating halo instead of an antenna rod.
  const halo = new THREE.Group()
  halo.position.set(0, 0.6, 0.02)
  head.add(halo)
  const haloRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 12, 36), ringMat)
  haloRing.rotation.x = Math.PI / 2
  halo.add(haloRing)
  const haloGlow = new THREE.Mesh(
    new THREE.TorusGeometry(0.17, 0.055, 8, 28),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN), transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
  )
  haloGlow.rotation.x = Math.PI / 2
  halo.add(haloGlow)

  const bezel = roundedPlane(1.0, 0.72, 0.3, jointMat)
  bezel.position.set(0, -0.03, 0.451)
  head.add(bezel)
  const screen = roundedPlane(0.94, 0.66, 0.27, faceMat)
  screen.position.set(0, -0.03, 0.457)
  head.add(screen)

  const face = faceLightTexture()
  const faceLights = new THREE.Mesh(
    new THREE.PlaneGeometry(0.82, 0.62),
    new THREE.MeshBasicMaterial({ map: face.texture, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
  )
  faceLights.position.set(0, -0.03, 0.468)
  faceLights.renderOrder = 7
  head.add(faceLights)

  const sheen = roundedPlane(0.78, 0.11, 0.055, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }))
  sheen.position.set(-0.05, 0.14, 0.472)
  sheen.rotation.z = -0.2
  sheen.renderOrder = 9
  head.add(sheen)

  // Ear pods with glowing accent rings.
  const earGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.12, 24)
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, shellMat)
    ear.rotation.z = Math.PI / 2
    ear.position.set(side * 0.56, -0.02, 0.02)
    head.add(ear)
    const cap = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.017, 10, 24), earCapMat)
    cap.rotation.y = Math.PI / 2
    cap.position.set(side * 0.625, -0.02, 0.02)
    head.add(cap)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), faceMat)
    disc.rotation.y = (side * Math.PI) / 2
    disc.position.set(side * 0.622, -0.02, 0.02)
    head.add(disc)
  }

  shadowsOn(robot)

  /* ── normalise: 1 unit tall, feet on the ground ── */
  const bounds = new THREE.Box3().setFromObject(robot)
  const norm = 1 / Math.max(0.001, bounds.max.y - bounds.min.y)
  robot.scale.setScalar(norm)
  const baseY = -bounds.min.y * norm
  robot.position.y = baseY

  /* ── life ── */
  let blinkAt = 1.4 + Math.random() * 2.5
  let openNow = 1
  let fly = 0
  let flyTarget = 0

  root.userData.head = head
  root.userData.setFly = (k: number) => { flyTarget = Math.max(0, Math.min(1, k)) }
  root.userData.tick = (time: number, dt: number) => {
    fly += (flyTarget - fly) * Math.min(1, dt * 5)

    // Standing idle: a slow breath and a calm look around. In flight he leans
    // into the direction of travel, arms swept back, legs trailing.
    robot.position.y = baseY + Math.sin(time * 1.1) * 0.012 + fly * 0.045
    robot.rotation.x = fly * 0.3
    head.rotation.y = Math.sin(time * 0.42) * 0.14 * (1 - fly)
    head.rotation.z = Math.sin(time * 0.9) * 0.035 * (1 - fly)
    head.rotation.x = -fly * 0.22

    for (const [arm, side] of [[armR, 1], [armL, -1]] as const) {
      arm.rotation.z = arm.userData.restZ + Math.sin(time * 0.8 + side) * 0.05 * (1 - fly) - fly * 0.22 * side
      arm.rotation.x = -fly * 1.15
    }
    legL.rotation.x = -fly * 0.42
    legR.rotation.x = -fly * 0.3

    halo.rotation.y = time * 0.5
    ringMat.emissiveIntensity = 1.05 + Math.sin(time * 2.1) * 0.25

    // Blink — the canvas is only redrawn on the frames the eyelid moves.
    blinkAt -= dt
    const want = blinkAt < 0 ? Math.max(0.05, Math.abs(blinkAt) * 9) : 1
    if (blinkAt < -0.16) blinkAt = 2.4 + Math.random() * 3.2
    const next = Math.min(1, want)
    if (Math.abs(next - openNow) > 0.03) {
      openNow = next
      face.draw(openNow)
    }
  }
  // The face canvas is per-instance, so it has to go with the instance.
  root.userData.dispose = () => face.texture.dispose()

  return root
}
