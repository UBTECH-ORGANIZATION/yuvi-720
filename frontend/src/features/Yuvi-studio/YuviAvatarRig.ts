import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import yuviFaviconUrl from '../../assets/yuvi-badge.webp'
import { shellMaterial } from './tierMaterials'
import { tierSettings, type RenderTier } from './renderTier'
import type { YuviDesign } from './YuviDesign'

// The chest-badge favicon is shared across every avatar instance.
let sharedFaviconTexture: THREE.Texture | null = null
function getFaviconTexture(): THREE.Texture {
  if (!sharedFaviconTexture) {
    sharedFaviconTexture = new THREE.TextureLoader().load(yuviFaviconUrl)
    sharedFaviconTexture.colorSpace = THREE.SRGBColorSpace
  }
  return sharedFaviconTexture
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function mixWhite([r, g, b]: number[], t: number): [number, number, number] {
  const L = (c: number) => Math.round(c + (255 - c) * t)
  return [L(r), L(g), L(b)]
}
const rgba = ([r, g, b]: number[], a: number) => `rgba(${r}, ${g}, ${b}, ${a})`

export function createYuviAvatarRig(design: YuviDesign, settings: ReturnType<typeof tierSettings>, tier: RenderTier) {
  // ── Materials (identical palette to the start-scene YuviRobot3D) ──
  // Yuvi 2.0: soft-ceramic shell with a real clearcoat and a whisper of
  // iridescence over a deep indigo inner core — no flat grey plastic.
  const CORE_COLOR = new THREE.Color(0x2b2560)
  // Physical on medium/high (today's shells, untouched); Standard on low,
  // where the clearcoat + sheen lobes are the fragment cost that matters.
  const shell = (params: THREE.MeshPhysicalMaterialParameters) => shellMaterial(settings.physicalMaterials, params)
  const blueMat = shell({
    color: 0xf1f2fb, roughness: 0.24, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.13,
    sheen: 0.55, sheenColor: new THREE.Color(0xb9a8ff), sheenRoughness: 0.55,
    iridescence: 0.22, iridescenceIOR: 1.35,
    envMapIntensity: 1.2,
  })
  const jointMat = shell({ color: 0x2b2560, roughness: 0.34, metalness: 0.75, envMapIntensity: 1.15, clearcoat: 0.5, clearcoatRoughness: 0.28 })
  // Formerly plain white — now the dark inner suit the shell plates sit on.
  const whiteMat = shell({ color: 0x342c6d, roughness: 0.4, metalness: 0.3, envMapIntensity: 1.05, clearcoat: 0.7, clearcoatRoughness: 0.24, sheen: 0.4, sheenColor: new THREE.Color(0x7c6bff) })
  const faceMat = shell({ color: 0x07061a, roughness: 0.07, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.5 })
  const visorSheenMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.085, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x3fd9e0, emissive: 0x3fd9e0, emissiveIntensity: 1.8, roughness: 0.3, toneMapped: false })
  const earCapMat = new THREE.MeshStandardMaterial({ color: 0x3fd9e0, emissive: 0x3fd9e0, emissiveIntensity: 0.6, roughness: 0.3, toneMapped: false })
  const antennaTipMat = new THREE.MeshStandardMaterial({ color: 0x4eeef0, emissive: 0x4eeef0, emissiveIntensity: 2.2, toneMapped: false, roughness: 0.25 })

  const robot = new THREE.Group()
  const makeCapsule = (radius: number, length: number, material: THREE.Material) => {
    const capsule = new THREE.Group()
    capsule.add(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 28), material))
    const top = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), material)
    top.position.y = length / 2; capsule.add(top)
    const bottom = top.clone(); bottom.position.y = -length / 2; capsule.add(bottom)
    return capsule
  }
  const makeFlatRoundedRect = (width: number, height: number, radius: number, material: THREE.Material) => {
    const x = -width / 2, y = -height / 2
    const shape = new THREE.Shape()
    shape.moveTo(x + radius, y)
    shape.lineTo(x + width - radius, y)
    shape.quadraticCurveTo(x + width, y, x + width, y + radius)
    shape.lineTo(x + width, y + height - radius)
    shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
    shape.lineTo(x + radius, y + height)
    shape.quadraticCurveTo(x, y + height, x, y + height - radius)
    shape.lineTo(x, y + radius)
    shape.quadraticCurveTo(x, y, x + radius, y)
    return new THREE.Mesh(new THREE.ShapeGeometry(shape, 16), material)
  }

  // ── Neon face-light canvas (ported from the start-scene robot) ──
  const makeFaceLightTexture = () => {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 576
    const ctx = canvas.getContext('2d')!
    const screenWidth = 0.82, screenHeight = 0.62
    const toCanvasPoint = ([x, y]: [number, number]) => [
      (x / screenWidth + 0.5) * canvas.width,
      (0.5 - y / screenHeight) * canvas.height,
    ]
    const eyeShadow = () => rgba(mixWhite(hexToRgb(design.colors.eyes), 0.2), 1)
    const smileShadow = () => rgba(mixWhite(hexToRgb(design.colors.smile), 0.25), 1)
    const drawGlowArc = (center: [number, number], radius: number, lineWidth: number, color: string, blur: number, eyeOpen = 1) => {
      const [x, y] = toCanvasPoint(center)
      const pxRadius = (radius * canvas.width) / screenWidth
      ctx.save(); ctx.translate(x, y); ctx.scale(1, Math.max(0.16, eyeOpen))
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = lineWidth
      ctx.strokeStyle = color; ctx.shadowColor = eyeShadow(); ctx.shadowBlur = blur
      ctx.beginPath(); ctx.arc(0, 0, pxRadius, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke(); ctx.restore()
    }
    const drawGlowPath = (points: Array<[number, number]>, lineWidth: number, color: string, blur: number) => {
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = lineWidth
      ctx.strokeStyle = color; ctx.shadowColor = smileShadow(); ctx.shadowBlur = blur
      ctx.beginPath()
      points.forEach((point, i) => { const [x, y] = toCanvasPoint(point); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y) })
      ctx.stroke(); ctx.restore()
    }
    const smilePath: Array<[number, number]> = [[-0.205, -0.09], [-0.1, -0.158], [0, -0.175], [0.1, -0.158], [0.205, -0.09]]
    const fillGlowRect = (cx: number, cy: number, w: number, h: number, color: string, blur: number) => {
      const [x, y] = toCanvasPoint([cx, cy])
      const pxW = (w * canvas.width) / screenWidth, pxH = (h * canvas.height) / screenHeight
      ctx.save(); ctx.shadowColor = eyeShadow(); ctx.shadowBlur = blur; ctx.fillStyle = color
      ctx.fillRect(x - pxW / 2, y - pxH / 2, pxW, pxH); ctx.restore()
    }
    const drawMouthSquares = (center: [number, number], halfW: number, halfH: number) => {
      const cell = Math.min(halfH * 0.95, 0.026); if (cell < 0.006) return
      const safeHalfW = Math.max(cell, halfW - cell * 0.75), safeHalfH = Math.max(cell, halfH - cell * 0.75)
      const step = cell * 1.28
      const cols = Math.max(1, Math.floor((safeHalfW * 2) / step)), rows = Math.max(1, Math.floor((safeHalfH * 2) / step))
      const startX = center[0] - ((cols - 1) * step) / 2, startY = center[1] + ((rows - 1) * step) / 2
      const [clipX, clipY] = toCanvasPoint(center)
      const clipHalfW = (safeHalfW * canvas.width) / screenWidth, clipHalfH = (safeHalfH * canvas.height) / screenHeight
      ctx.save(); ctx.beginPath(); ctx.ellipse(clipX, clipY, clipHalfW, clipHalfH, 0, 0, Math.PI * 2); ctx.clip()
      const teeth = rgba(mixWhite(hexToRgb(design.colors.eyes), 0.1), 0.95)
      for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
        const x = startX + c * step, y = startY - r * step
        const nx = (Math.abs(x - center[0]) + cell * 0.58) / safeHalfW
        const ny = (Math.abs(y - center[1]) + cell * 0.58) / safeHalfH
        if (nx * nx + ny * ny > 1) continue
        fillGlowRect(x, y, cell, cell, teeth, 5)
      }
      ctx.restore()
    }
    const drawMouth = (mouthOpen: number) => {
      const s = hexToRgb(design.colors.smile)
      // Match the onboarding Yuvi: a fixed soft purple halo behind a bright
      // smile-coloured stroke (cyan by default) with a near-white core.
      const halo = 'rgba(124, 92, 255, 0.2)'
      const mid = rgba(s, 0.94), core = rgba(mixWhite(s, 0.55), 1)
      const corner = 0.205, lift = Math.max(0, mouthOpen) * 0.13
      const bottom = smilePath
      const top: Array<[number, number]> = smilePath.map(([x, y]) => [x, y + lift * (1 - (x / corner) * (x / corner))])
      if (lift < 0.012) {
        drawGlowPath(bottom, 26, halo, 28); drawGlowPath(bottom, 12, mid, 12); drawGlowPath(bottom, 5, core, 4); return
      }
      const midY = -0.175 + lift * 0.5
      drawMouthSquares([0, midY], corner * 0.8, lift * 0.5)
      const outline: Array<[number, number]> = [...bottom, ...[...top].reverse()]
      drawGlowPath(outline, 20, halo, 24); drawGlowPath(outline, 10, mid, 12); drawGlowPath(outline, 4, core, 4)
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
    const draw = (eyeOpen = 1, mouthOpen = 0, lookX = 0, lookY = 0) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const e = hexToRgb(design.colors.eyes)
      const layers = [
        [36, rgba(e, 0.2), 32], [21, rgba(e, 0.5), 20],
        [11, rgba(mixWhite(e, 0.4), 0.96), 11], [5, rgba(mixWhite(e, 0.85), 1), 4],
      ] as const
      const eyeOffsetX = lookX * 0.025
      const eyeOffsetY = -lookY * 0.018
      const eyes: Array<[number, number]> = [
        [-0.165 + eyeOffsetX, 0.06 + eyeOffsetY],
        [0.165 + eyeOffsetX, 0.06 + eyeOffsetY],
      ]
      layers.forEach(([lw, col, blur]) => eyes.forEach((c) => drawGlowArc(c, 0.066, lw, col, blur, eyeOpen)))
      drawMouth(mouthOpen)
      texture.needsUpdate = true
    }
    return { texture, draw }
  }

  // ── Legs (chunky articulated parts with soft boots) ──
  // The group's origin sits at the hip joint, so `rotation.x` swings the leg
  // from the pelvis the way a stride does. With the pivot down near the ankle
  // the hips swung out of the torso on every step and the walk fell apart.
  const HIP_Y = 0.51
  const makeLeg = (side: number) => {
    const grp = new THREE.Group()
    const hip = new THREE.Mesh(new THREE.SphereGeometry(0.104, 32, 24), blueMat); hip.scale.set(1.08, 0.92, 1); hip.position.set(0.014 * side, 0, 0.015); grp.add(hip)
    const thigh = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.165, 0.145, 10, 0.06), blueMat); thigh.position.set(0.01 * side, -0.1, 0.018); thigh.rotation.z = 0.025 * side; grp.add(thigh)
    const knee = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.052, 32), jointMat); knee.position.set(0.003 * side, -0.21, 0.025); knee.scale.set(1.05, 0.78, 1); grp.add(knee)
    const shin = new THREE.Mesh(new RoundedBoxGeometry(0.162, 0.19, 0.145, 10, 0.06), blueMat); shin.position.set(-0.003 * side, -0.315, 0.04); shin.rotation.z = -0.015 * side; grp.add(shin)
    const shinHighlight = new THREE.Mesh(new RoundedBoxGeometry(0.108, 0.13, 0.026, 8, 0.026), whiteMat); shinHighlight.position.set(-0.003 * side, -0.312, 0.126); shinHighlight.rotation.z = -0.015 * side; grp.add(shinHighlight)
    const ankle = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.052, 32), blueMat); ankle.position.set(-0.003 * side, -0.435, 0.04); ankle.scale.set(1.12, 0.66, 1); grp.add(ankle)
    const foot = new THREE.Mesh(new RoundedBoxGeometry(0.255, 0.125, 0.36, 10, 0.068), blueMat); foot.position.set(0.006 * side, -0.49, 0.105); foot.rotation.x = -0.09; grp.add(foot)
    const toe = new THREE.Mesh(new RoundedBoxGeometry(0.205, 0.07, 0.17, 8, 0.04), whiteMat); toe.position.set(0.006 * side, -0.468, 0.208); toe.rotation.x = -0.1; grp.add(toe)
    grp.position.set(0.145 * side, HIP_Y, 0)
    return grp
  }
  const legL = makeLeg(-1), legR = makeLeg(1)
  legL.name = 'ambient-leg-left'; legR.name = 'ambient-leg-right'
  robot.add(legL, legR)
  const hips = new THREE.Mesh(new RoundedBoxGeometry(0.33, 0.11, 0.25, 8, 0.06), blueMat); hips.position.y = 0.54; robot.add(hips)

  // ── Torso + yoke + chest Y badge ──
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.27, 44, 44), whiteMat); torso.scale.set(0.9, 1.02, 0.76); torso.position.y = 0.82; robot.add(torso)
  const yoke = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.12, 0.27, 8, 0.06), blueMat); yoke.position.set(0, 1.08, 0); robot.add(yoke)
  const sparkBadgeTexture = getFaviconTexture()
  const sparkBadgeMat = new THREE.MeshBasicMaterial({ map: sparkBadgeTexture, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false })
  const sparkBadge = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), sparkBadgeMat)
  sparkBadge.position.set(0, 0.845, 0.23); sparkBadge.renderOrder = 8; robot.add(sparkBadge)
  // Hit target sized to the visible "Y" (the studio/launcher robots have no
  // competing controls, so a comfortable target is fine).
  const badgeHit = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44), new THREE.MeshBasicMaterial({ visible: false }))
  badgeHit.position.set(0, 0.845, 0.231); robot.add(badgeHit)

  // ── Arms ──
  const makeArm = (side: number) => {
    const arm = new THREE.Group()
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.118, 32, 24), blueMat); shoulder.scale.set(1.05, 0.92, 1.03); arm.add(shoulder)
    const upper = new THREE.Mesh(new RoundedBoxGeometry(0.128, 0.2, 0.125, 8, 0.052), blueMat); upper.position.set(0.028 * side, -0.13, 0.008); upper.rotation.z = 0.025 * side; arm.add(upper)
    const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.064, 32), jointMat); elbow.position.set(0.045 * side, -0.232, 0.008); elbow.scale.set(1.05, 0.74, 1); arm.add(elbow)
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.078, 0.235, 34), whiteMat); fore.position.set(0.052 * side, -0.34, 0.026); fore.rotation.z = 0.015 * side; fore.scale.set(1.06, 1, 0.82); arm.add(fore)
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.086, 0.062, 32), blueMat); wrist.position.set(0.056 * side, -0.47, 0.035); wrist.scale.set(1.08, 0.64, 0.94); arm.add(wrist)
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.096, 30, 22), blueMat); hand.scale.set(0.98, 1.1, 0.82); hand.position.set(0.058 * side, -0.545, 0.068); hand.rotation.z = 0.015 * side; arm.add(hand)
    const thumb = makeCapsule(0.03, 0.082, blueMat); thumb.position.set(0.012 * side, -0.555, 0.085); thumb.rotation.z = 0.45 * side; thumb.rotation.x = 0.28; arm.add(thumb)
    const finger = makeCapsule(0.028, 0.095, blueMat); finger.position.set(0.092 * side, -0.585, 0.088); finger.rotation.z = -0.12 * side; finger.rotation.x = 0.24; arm.add(finger)
    arm.position.set(0.318 * side, 1.015, -0.005); arm.rotation.z = 0.095 * side
    return arm
  }
  const armL = makeArm(-1), armR = makeArm(1)
  armL.name = 'ambient-arm-left'; armR.name = 'ambient-arm-right'
  robot.add(armL, armR)

  // ── Head ──
  const head = new THREE.Group(); head.position.y = 1.59; head.scale.setScalar(0.9); robot.add(head)
  head.name = 'ambient-head'
  const helmet = new THREE.Mesh(new RoundedBoxGeometry(1.12, 1.02, 0.94, 10, 0.42), blueMat); helmet.scale.set(1, 1.0, 0.95); head.add(helmet)
  // A floating halo replaces the old rod-and-bulb antenna: it reads as a
  // modern AI companion instead of a toy robot aerial.
  const antenna = new THREE.Group(); antenna.position.set(0, 0.6, 0.02); head.add(antenna)
  const antennaTip = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 14, 48), antennaTipMat); antennaTip.rotation.x = Math.PI / 2; antenna.add(antennaTip)
  const haloGlowMat = new THREE.MeshBasicMaterial({ color: 0x4eeef0, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })
  const antennaHalo = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.055, 10, 40), haloGlowMat); antennaHalo.rotation.x = Math.PI / 2; antenna.add(antennaHalo)
  const antennaLight = new THREE.PointLight(0x4eeef0, 0.35, 1.3); antenna.add(antennaLight)
  // Wide wrap-around glass visor with an inset bezel and a glass sheen streak.
  const bezel = makeFlatRoundedRect(1.0, 0.72, 0.3, jointMat); bezel.position.set(0, -0.03, 0.451); head.add(bezel)
  const screen = makeFlatRoundedRect(0.94, 0.66, 0.27, faceMat); screen.position.set(0, -0.03, 0.457); head.add(screen)
  const faceLight = makeFaceLightTexture()
  const faceLightMat = new THREE.MeshBasicMaterial({ map: faceLight.texture, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })
  const faceLights = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.62), faceLightMat); faceLights.position.set(0, -0.03, 0.468); faceLights.renderOrder = 7; head.add(faceLights)
  const visorSheen = makeFlatRoundedRect(0.78, 0.11, 0.055, visorSheenMat); visorSheen.position.set(-0.05, 0.14, 0.472); visorSheen.rotation.z = -0.2; visorSheen.renderOrder = 9; head.add(visorSheen)
  const faceGlow = new THREE.PointLight(0x4eeef0, 0.28, 1.1); faceGlow.position.set(0, -0.02, 0.62); head.add(faceGlow)
  // Two more point lights every fragment has to evaluate, for a glow a
  // 1-metre radius wide. High keeps them; the emissive parts carry the look
  // on the cheaper tiers.
  const applyGlowBudget = (q: RenderTier) => { antennaLight.visible = faceGlow.visible = q === 'high' }
  applyGlowBudget(tier)
  const earGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.12, 30)
  const earL = new THREE.Mesh(earGeo, blueMat); earL.rotation.z = Math.PI / 2; earL.position.set(-0.56, -0.02, 0.02); head.add(earL)
  const earR = earL.clone(); earR.position.x = 0.56; head.add(earR)
  const earCapL = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.017, 12, 30), earCapMat); earCapL.rotation.y = Math.PI / 2; earCapL.position.set(-0.625, -0.02, 0.02); head.add(earCapL)
  const earCapR = earCapL.clone(); earCapR.position.x = 0.625; head.add(earCapR)
  const earDiscL = new THREE.Mesh(new THREE.CircleGeometry(0.07, 26), faceMat); earDiscL.rotation.y = -Math.PI / 2; earDiscL.position.set(-0.622, -0.02, 0.02); head.add(earDiscL)
  const earDiscR = earDiscL.clone(); earDiscR.rotation.y = Math.PI / 2; earDiscR.position.x = 0.622; head.add(earDiscR)
  const nativeEarParts = [earL, earR, earCapL, earCapR, earDiscL, earDiscR]

  robot.position.y = -1.35

  return { CORE_COLOR, shell, blueMat, jointMat, whiteMat, ringMat, earCapMat, antennaTipMat, robot, legL, torso, sparkBadgeTexture, sparkBadgeMat, sparkBadge, badgeHit, armL, head, antenna, haloGlowMat, antennaLight, screen, faceLight, faceLightMat, faceGlow, applyGlowBudget, nativeEarParts, legR, armR }
}
