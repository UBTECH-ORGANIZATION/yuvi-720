// @ts-nocheck
/* eslint-disable */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import yuviFaviconUrl from '../../assets/yuvi-favicon.png'

const INTRO_PEEK_DURATION = 2.55
const INTRO_SETTLE_DURATION = 1.0
const INTRO_RETREAT_DURATION = 0.7
const INTRO_ENTRANCE_DURATION = 5.7
const INTRO_TURN_DELAY = 0.5
const INTRO_TURN_DURATION = 0.9
const INTRO_READY_BUFFER = 0.12

export const YUBI_INTRO_READY_DELAY_MS = Math.ceil(
  (INTRO_ENTRANCE_DURATION + INTRO_TURN_DELAY + INTRO_TURN_DURATION + INTRO_READY_BUFFER) * 1000
)

// The chest-badge favicon is shared across every Yubi instance. Loading it once
// at module scope means later robots (the intro→question overlay and the ring
// robot) reuse the already-decoded texture, so the "Y" mark is present on their
// very first rendered frame instead of popping in after an async decode.
let sharedFaviconTexture: THREE.Texture | null = null
function getFaviconTexture(): THREE.Texture {
  if (!sharedFaviconTexture) {
    sharedFaviconTexture = new THREE.TextureLoader().load(yuviFaviconUrl)
    sharedFaviconTexture.colorSpace = THREE.SRGBColorSpace
  }
  return sharedFaviconTexture
}

/**
 * Yubi — a procedural Three.js chibi robot modeled on the reference companion:
 * a big light-blue glossy helmet wrapping an inset clean black screen (cyan
 * closed-happy eyes + smile), cyan ear pods, a tiny glossy white egg torso
 * with a blue shoulder yoke and a glowing cyan chest ring, and two-tone
 * (blue + white) short chunky arms and legs. A studio environment map gives it the plastic-toy
 * sheen. It idles calmly and blinks. Pointer-follow is opt-in per scene.
 */
export function YubiRobot3D({
  label,
  speaking = false,
  pointAt = null,
  followPointer = false,
  presenting = false,
}: {
  label: string
  speaking?: boolean
  pointAt?: { x: number; y: number } | null
  followPointer?: boolean
  presenting?: boolean
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  // Live speaking flag read inside the (mount-once) animation loop via a ref,
  // so prop changes drive the mouth/gesture without re-creating the scene.
  const speakingRef = useRef(false)
  useEffect(() => {
    speakingRef.current = speaking
  }, [speaking])
  // Direction (screen space, +y down) the robot should look toward — used on the
  // question screen so Yubi points at the option the slider is currently on.
  const pointRef = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    pointRef.current = pointAt
  }, [pointAt])
  const followPointerRef = useRef(false)
  useEffect(() => {
    followPointerRef.current = followPointer
  }, [followPointer])
  const presentingRef = useRef(false)
  useEffect(() => {
    presentingRef.current = presenting
  }, [presenting])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const pointer = { x: 0, y: 0 }
    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.98
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture
    pmrem.dispose()

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
    camera.position.set(0, 0, 5.4)

    // ── Lighting: soft studio key + cool fill for glossy plastic ──
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6e0f5, 0.85))
    const key = new THREE.DirectionalLight(0xffffff, 1.3)
    key.position.set(3, 7, 6)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xbcd7ef, 0.5)
    fill.position.set(-5, 2, 3)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0xdcecff, 0.5)
    rim.position.set(0, 3, -6)
    scene.add(rim)

    // ── Materials: glossy two-tone plastic (powder blue + white) ──
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x9cc1e8, roughness: 0.3, metalness: 0.14, envMapIntensity: 0.7 })
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x77a8d8, roughness: 0.34, metalness: 0.1, envMapIntensity: 0.65 })
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26, metalness: 0.08, envMapIntensity: 0.85 })
    const faceMat = new THREE.MeshBasicMaterial({ color: 0x050711 })
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x4eeef0 })
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x3fd9e0, emissive: 0x3fd9e0, emissiveIntensity: 1.8, roughness: 0.3, toneMapped: false })
    const earCapMat = new THREE.MeshStandardMaterial({ color: 0x3fd9e0, emissive: 0x3fd9e0, emissiveIntensity: 0.6, roughness: 0.3, toneMapped: false })

    const robot = new THREE.Group()
    scene.add(robot)

    const makeCapsule = (radius: number, length: number, material: THREE.Material) => {
      const capsule = new THREE.Group()
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 28), material)
      capsule.add(shaft)
      const top = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), material)
      top.position.y = length / 2
      capsule.add(top)
      const bottom = top.clone()
      bottom.position.y = -length / 2
      capsule.add(bottom)
      return capsule
    }

    const makeStroke = (points: Array<[number, number, number]>, radius = 0.018) => {
      const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
      return new THREE.Mesh(new THREE.TubeGeometry(curve, 28, radius, 10, false), glowMat)
    }

    const makeFlatRoundedRect = (width: number, height: number, radius: number, material: THREE.Material) => {
      const x = -width / 2
      const y = -height / 2
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

    const makeFaceLightTexture = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 768
      canvas.height = 576
      const ctx = canvas.getContext('2d')!
      const screenWidth = 0.82
      const screenHeight = 0.62
      const toCanvasPoint = ([x, y]: [number, number]) => [
        (x / screenWidth + 0.5) * canvas.width,
        (0.5 - y / screenHeight) * canvas.height,
      ]
      const drawGlowArc = (center: [number, number], radius: number, lineWidth: number, color: string, blur: number, eyeOpen = 1) => {
        const [x, y] = toCanvasPoint(center)
        const pxRadius = radius * canvas.width / screenWidth
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(1, Math.max(0.16, eyeOpen))
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.lineWidth = lineWidth
        ctx.strokeStyle = color
        ctx.shadowColor = '#54f7ff'
        ctx.shadowBlur = blur
        ctx.beginPath()
        ctx.arc(0, 0, pxRadius, Math.PI * 1.08, Math.PI * 1.92)
        ctx.stroke()
        ctx.restore()
      }

      const drawGlowPath = (points: Array<[number, number]>, lineWidth: number, color: string, blur: number) => {
        ctx.save()
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.lineWidth = lineWidth
        ctx.strokeStyle = color
        ctx.shadowColor = '#54f7ff'
        ctx.shadowBlur = blur
        ctx.beginPath()
        points.forEach((point, index) => {
          const [x, y] = toCanvasPoint(point)
          if (index === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
        ctx.restore()
      }

      const smilePath: Array<[number, number]> = [[-0.205, -0.09], [-0.1, -0.158], [0, -0.175], [0.1, -0.158], [0.205, -0.09]]
      const drawGlowEllipse = (center: [number, number], radiusX: number, radiusY: number, lineWidth: number, color: string, blur: number) => {
        const [x, y] = toCanvasPoint(center)
        const pxRx = radiusX * canvas.width / screenWidth
        const pxRy = radiusY * canvas.height / screenHeight
        ctx.save()
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.lineWidth = lineWidth
        ctx.strokeStyle = color
        ctx.shadowColor = '#54f7ff'
        ctx.shadowBlur = blur
        ctx.beginPath()
        ctx.ellipse(x, y, pxRx, pxRy, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
      const fillGlowRect = (cx: number, cy: number, w: number, h: number, color: string, blur: number) => {
        const [x, y] = toCanvasPoint([cx, cy])
        const pxW = (w * canvas.width) / screenWidth
        const pxH = (h * canvas.height) / screenHeight
        ctx.save()
        ctx.shadowColor = '#3fd9e0'
        ctx.shadowBlur = blur
        ctx.fillStyle = color
        ctx.fillRect(x - pxW / 2, y - pxH / 2, pxW, pxH)
        ctx.restore()
      }
      // Teeth: blue squares sized to the opening, filling it as the jaw drops.
      const drawMouthSquares = (center: [number, number], halfW: number, halfH: number) => {
        const cell = Math.min(halfH * 0.95, 0.026)
        if (cell < 0.006) return
        const safeHalfW = Math.max(cell, halfW - cell * 0.75)
        const safeHalfH = Math.max(cell, halfH - cell * 0.75)
        const step = cell * 1.28
        const cols = Math.max(1, Math.floor((safeHalfW * 2) / step))
        const rows = Math.max(1, Math.floor((safeHalfH * 2) / step))
        const startX = center[0] - ((cols - 1) * step) / 2
        const startY = center[1] + ((rows - 1) * step) / 2
        const [clipX, clipY] = toCanvasPoint(center)
        const clipHalfW = (safeHalfW * canvas.width) / screenWidth
        const clipHalfH = (safeHalfH * canvas.height) / screenHeight
        ctx.save()
        ctx.beginPath()
        ctx.ellipse(clipX, clipY, clipHalfW, clipHalfH, 0, 0, Math.PI * 2)
        ctx.clip()
        for (let r = 0; r < rows; r += 1) {
          for (let c = 0; c < cols; c += 1) {
            const x = startX + c * step
            const y = startY - r * step
            const nx = (Math.abs(x - center[0]) + cell * 0.58) / safeHalfW
            const ny = (Math.abs(y - center[1]) + cell * 0.58) / safeHalfH
            if (nx * nx + ny * ny > 1) continue
            fillGlowRect(x, y, cell, cell, 'rgba(78, 214, 240, 0.95)', 5)
          }
        }
        ctx.restore()
      }
      const drawMouth = (mouthOpen: number) => {
        // The mouth is always built from Yubi's closed smile: the smile is the
        // lower lip; opening lifts a mirrored upper lip in the middle (corners
        // stay pinched) so it reads as the smile opening — never a stray circle.
        const corner = 0.205
        const lift = Math.max(0, mouthOpen) * 0.13
        const bottom = smilePath
        const top: Array<[number, number]> = smilePath.map(
          ([x, y]) => [x, y + lift * (1 - (x / corner) * (x / corner))]
        )
        if (lift < 0.012) {
          // Idle: the closed happy smile.
          drawGlowPath(bottom, 26, 'rgba(124, 92, 255, 0.2)', 28)
          drawGlowPath(bottom, 12, 'rgba(116, 247, 255, 0.94)', 12)
          drawGlowPath(bottom, 5, 'rgba(245, 255, 255, 1)', 4)
          return
        }
        // Blue-square teeth fill the opening between the two lips.
        const midY = -0.175 + lift * 0.5
        drawMouthSquares([0, midY], corner * 0.8, lift * 0.5)
        // Lips: one closed loop = lower smile + mirrored upper arc (shared corners).
        const outline: Array<[number, number]> = [...bottom, ...[...top].reverse()]
        drawGlowPath(outline, 20, 'rgba(124, 92, 255, 0.18)', 24)
        drawGlowPath(outline, 10, 'rgba(116, 247, 255, 0.9)', 12)
        drawGlowPath(outline, 4, 'rgba(245, 255, 255, 1)', 4)
      }

      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const draw = (eyeOpen = 1, mouthOpen = 0) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const eyes: Array<[number, number]> = [[-0.165, 0.06], [0.165, 0.06]]
        eyes.forEach((center) => drawGlowArc(center, 0.066, 36, 'rgba(42, 245, 255, 0.2)', 32, eyeOpen))
        eyes.forEach((center) => drawGlowArc(center, 0.066, 21, 'rgba(64, 241, 255, 0.5)', 20, eyeOpen))
        eyes.forEach((center) => drawGlowArc(center, 0.066, 11, 'rgba(100, 250, 255, 0.96)', 11, eyeOpen))
        eyes.forEach((center) => drawGlowArc(center, 0.066, 5, 'rgba(238, 255, 255, 1)', 4, eyeOpen))
        drawMouth(mouthOpen)
        texture.needsUpdate = true
      }

      draw(1, 0)
      return { texture, draw }
    }

    // ── Legs (chunky articulated toy parts with oversized soft boots) ──
    const makeLeg = (side: number) => {
      const grp = new THREE.Group()
      const hip = new THREE.Mesh(new THREE.SphereGeometry(0.104, 32, 24), blueMat)
      hip.scale.set(1.08, 0.92, 1)
      hip.position.set(0.014 * side, 0.39, 0.015)
      grp.add(hip)

      const thigh = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.165, 0.145, 10, 0.06), blueMat)
      thigh.position.set(0.01 * side, 0.29, 0.018)
      thigh.rotation.z = 0.025 * side
      grp.add(thigh)

      const knee = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.052, 32), jointMat)
      knee.position.set(0.003 * side, 0.18, 0.025)
      knee.scale.set(1.05, 0.78, 1)
      grp.add(knee)

      const shin = new THREE.Mesh(new RoundedBoxGeometry(0.162, 0.19, 0.145, 10, 0.06), blueMat)
      shin.position.set(-0.003 * side, 0.075, 0.04)
      shin.rotation.z = -0.015 * side
      grp.add(shin)

      const shinHighlight = new THREE.Mesh(new RoundedBoxGeometry(0.108, 0.13, 0.026, 8, 0.026), whiteMat)
      shinHighlight.position.set(-0.003 * side, 0.078, 0.126)
      shinHighlight.rotation.z = -0.015 * side
      grp.add(shinHighlight)

      const ankle = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.052, 32), blueMat)
      ankle.position.set(-0.003 * side, -0.045, 0.04)
      ankle.scale.set(1.12, 0.66, 1)
      grp.add(ankle)

      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.255, 0.125, 0.36, 10, 0.068), blueMat)
      foot.position.set(0.006 * side, -0.1, 0.105)
      foot.rotation.x = -0.09
      grp.add(foot)

      const toe = new THREE.Mesh(new RoundedBoxGeometry(0.205, 0.07, 0.17, 8, 0.04), whiteMat)
      toe.position.set(0.006 * side, -0.078, 0.208)
      toe.rotation.x = -0.1
      grp.add(toe)

      grp.userData = { shin, shinHighlight, ankle, foot, toe }
      grp.position.set(0.145 * side, 0.12, 0)
      return grp
    }
    const legL = makeLeg(-1)
    const legR = makeLeg(1)
    const legPartsL = legL.userData
    const legPartsR = legR.userData
    robot.add(legL, legR)

    // ── Hips yoke ──
    const hips = new THREE.Mesh(new RoundedBoxGeometry(0.33, 0.11, 0.25, 8, 0.06), blueMat)
    hips.position.y = 0.54
    robot.add(hips)

    // ── Torso: tiny glossy white egg so the head dominates ──
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.27, 44, 44), whiteMat)
    torso.scale.set(0.9, 1.02, 0.76)
    torso.position.y = 0.82
    robot.add(torso)

    // Blue collar across the top of the torso
    const yoke = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.12, 0.27, 8, 0.06), blueMat)
    yoke.position.set(0, 1.08, 0)
    robot.add(yoke)

    // Chest badge uses the real Yuvi favicon mark from vibe-coding-kids — a
    // module-cached texture so it is instantly available on every instance.
    const sparkBadgeTexture = getFaviconTexture()
    const sparkBadgeMat = new THREE.MeshBasicMaterial({
      map: sparkBadgeTexture,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const sparkBadge = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), sparkBadgeMat)
    sparkBadge.position.set(0, 0.845, 0.23)
    sparkBadge.renderOrder = 6
    robot.add(sparkBadge)

    // ── Arms (rounded shoulders, blue upper arms, flared white gauntlets, mitten hands) ──
    const makeArm = (side: number) => {
      const arm = new THREE.Group()
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.118, 32, 24), blueMat)
      shoulder.scale.set(1.05, 0.92, 1.03)
      arm.add(shoulder)

      const upper = new THREE.Mesh(new RoundedBoxGeometry(0.128, 0.2, 0.125, 8, 0.052), blueMat)
      upper.position.set(0.028 * side, -0.13, 0.008)
      upper.rotation.z = 0.025 * side
      arm.add(upper)

      const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.064, 32), jointMat)
      elbow.position.set(0.045 * side, -0.232, 0.008)
      elbow.scale.set(1.05, 0.74, 1)
      arm.add(elbow)

      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.078, 0.235, 34), whiteMat)
      fore.position.set(0.052 * side, -0.34, 0.026)
      fore.rotation.z = 0.015 * side
      fore.scale.set(1.06, 1, 0.82)
      arm.add(fore)

      const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.086, 0.062, 32), blueMat)
      wrist.position.set(0.056 * side, -0.47, 0.035)
      wrist.scale.set(1.08, 0.64, 0.94)
      arm.add(wrist)

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.096, 30, 22), blueMat)
      hand.scale.set(0.98, 1.1, 0.82)
      hand.position.set(0.058 * side, -0.545, 0.068)
      hand.rotation.z = 0.015 * side
      arm.add(hand)

      const thumb = makeCapsule(0.03, 0.082, blueMat)
      thumb.position.set(0.012 * side, -0.555, 0.085)
      thumb.rotation.z = 0.45 * side
      thumb.rotation.x = 0.28
      arm.add(thumb)

      const finger = makeCapsule(0.028, 0.095, blueMat)
      finger.position.set(0.092 * side, -0.585, 0.088)
      finger.rotation.z = -0.12 * side
      finger.rotation.x = 0.24
      arm.add(finger)

      arm.position.set(0.318 * side, 1.015, -0.005)
      arm.rotation.z = 0.095 * side
      return arm
    }
    const armL = makeArm(-1)
    const armR = makeArm(1)
    robot.add(armL, armR)

    // ── Head: big light-blue helmet wrapping a black screen ──
    const head = new THREE.Group()
    head.position.y = 1.59
    head.scale.setScalar(0.9)
    robot.add(head)
    const helmet = new THREE.Mesh(new RoundedBoxGeometry(1.12, 1.02, 0.94, 10, 0.42), blueMat)
    helmet.scale.set(1, 1.0, 0.95)
    head.add(helmet)

    const antenna = new THREE.Group()
    antenna.position.set(0, 0.52, 0.02)
    head.add(antenna)
    const antennaRod = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.018, 0.22, 14), jointMat)
    antennaRod.position.y = 0.11
    antenna.add(antennaRod)
    const antennaTipMat = new THREE.MeshStandardMaterial({ color: 0x4eeef0, emissive: 0x4eeef0, emissiveIntensity: 2.2, toneMapped: false, roughness: 0.25 })
    const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.052, 20, 18), antennaTipMat)
    antennaTip.position.y = 0.24
    antenna.add(antennaTip)
    const antennaLight = new THREE.PointLight(0x4eeef0, 0.35, 1.3)
    antennaLight.position.y = 0.24
    antenna.add(antennaLight)

    // Clean flat black screen recessed into the front; no reflections or 3D stroke overlap.
    const screen = makeFlatRoundedRect(0.82, 0.62, 0.13, faceMat)
    screen.position.set(0, -0.03, 0.455)
    head.add(screen)

    // Neon face lights: a transparent glow texture composited over the black screen.
    const faceLight = makeFaceLightTexture()
    const faceLightTexture = faceLight.texture
    const faceLightMat = new THREE.MeshBasicMaterial({
      map: faceLightTexture,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    })
    const faceLights = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.62), faceLightMat)
    faceLights.position.set(0, -0.03, 0.468)
    faceLights.renderOrder = 7
    head.add(faceLights)

    const faceGlow = new THREE.PointLight(0x4eeef0, 0.28, 1.1)
    faceGlow.position.set(0, -0.02, 0.62)
    head.add(faceGlow)

    // Side ear pods (blue) with glowing cyan centers
    const earGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.12, 30)
    const earL = new THREE.Mesh(earGeo, blueMat)
    earL.rotation.z = Math.PI / 2
    earL.position.set(-0.56, -0.02, 0.02)
    head.add(earL)
    const earR = earL.clone()
    earR.position.x = 0.56
    head.add(earR)
    const earCapL = new THREE.Mesh(new THREE.CircleGeometry(0.07, 26), earCapMat)
    earCapL.rotation.y = -Math.PI / 2
    earCapL.position.set(-0.623, -0.02, 0.02)
    head.add(earCapL)
    const earCapR = earCapL.clone()
    earCapR.rotation.y = Math.PI / 2
    earCapR.position.x = 0.623
    head.add(earCapR)

    // Center the full body vertically in the frame.
    robot.position.y = -1.45

    const lookTarget = new THREE.Vector3(0, 0, 0)
    camera.lookAt(lookTarget)

    // ── Resize ──
    const resize = () => {
      const w = container.clientWidth || 1
      const h = container.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    resizeObserver?.observe(container)
    window.addEventListener('resize', resize)

    // ── Animation loop ──
    const clock = new THREE.Clock()
    let lookX = 0
    let lookY = 0
    let speakAmt = 0   // smoothed 0→1 "is talking" amount
    // Eased arm rotations so pose changes (raise → lower before retreat) glide.
    let armLX = 0.08
    let armLZ = 0
    let armRX = 0.08
    let armRZ = 0.095
    let frame = 0
    const loop = () => {
      frame = requestAnimationFrame(loop)
      if (container.offsetParent === null) return
      const t = clock.getElapsedTime()

      // Ease the speaking amount so gestures start and stop smoothly.
      const speakTarget = speakingRef.current ? 1 : 0
      speakAmt += (speakTarget - speakAmt) * 0.12
      // Speech envelope: a clear jaw flap that fully opens and closes while talking.
      const flap = 0.5 + 0.5 * Math.sin(t * 12) + 0.1 * Math.sin(t * 26)
      const mouth = speakAmt * Math.min(1, Math.max(0, flap))
      const isPresentingScene = presentingRef.current
      const retreatT0 = INTRO_PEEK_DURATION + INTRO_SETTLE_DURATION
      const walkStart = retreatT0 + INTRO_RETREAT_DURATION
      const turnStart = INTRO_ENTRANCE_DURATION + INTRO_TURN_DELAY
      const turnEnd = turnStart + INTRO_TURN_DURATION
      const startX = -2.25
      const peekX = -1.24
      const endX = 0
      const retreatProgress = isPresentingScene ? Math.max(0, Math.min(1, (t - retreatT0) / INTRO_RETREAT_DURATION)) : 1
      const walkProgress = isPresentingScene ? Math.max(0, Math.min(1, (t - walkStart) / (INTRO_ENTRANCE_DURATION - walkStart))) : 1
      const walkEase = walkProgress < 0.5
        ? 2 * walkProgress * walkProgress
        : 1 - Math.pow(-2 * walkProgress + 2, 2) / 2
      const retreatEase = retreatProgress < 0.5
        ? 2 * retreatProgress * retreatProgress
        : 1 - Math.pow(-2 * retreatProgress + 2, 2) / 2
      const turnProgress = isPresentingScene ? Math.max(0, Math.min(1, (t - turnStart) / INTRO_TURN_DURATION)) : 1
      const turnEase = turnProgress * turnProgress * (3 - 2 * turnProgress)
      const walkingIn = isPresentingScene ? Math.max(0, 1 - walkProgress) : 0
      const isWaving = isPresentingScene && t < INTRO_PEEK_DURATION
      const isSettling = isPresentingScene && t >= INTRO_PEEK_DURATION && t < retreatT0
      const isRetreating = isPresentingScene && t >= retreatT0 && t < walkStart
      const isWalking = isPresentingScene && t >= walkStart && t < INTRO_ENTRANCE_DURATION
      const isPostWalkHold = isPresentingScene && t >= INTRO_ENTRANCE_DURATION && t < turnStart
      const isTurningToFront = isPresentingScene && t >= turnStart && t < turnEnd
      const isSpeaking = speakingRef.current
      const atEdge = isWaving || isSettling
      const leanActive = isWaving || isSettling || isRetreating
      const gait = Math.sin(t * 8.2)

      // Intro stage: Yubi peeks + waves from the left corner, slides back out of
      // frame, then walks in on his legs. Locomotion is body translation + gait,
      // like the academy action runner — no container slide, no teleport.
      robot.position.x = isPresentingScene
        ? (atEdge ? peekX
          : isRetreating ? peekX + (startX - peekX) * retreatEase
          : startX + (endX - startX) * walkEase)
        : 0
      robot.position.y = -1.2 + (atEdge ? Math.sin(t * 3.2) * 0.012 : 0)
      robot.position.z = 0
      robot.scale.set(1, 1, 1)

      // Smooth look: gaze toward the selected option when the slider points at
      // one; otherwise follow the pointer only when the parent scene enables it.
      const point = pointRef.current
      const shouldFollowPointer = followPointerRef.current && !point
      let targetY: number
      let targetX: number
      if (point) {
        targetY = point.x * 0.6
        targetX = point.y * 0.42
      } else if (shouldFollowPointer) {
        targetY = pointer.x * 0.46 + Math.sin(t * 0.4) * 0.025
        targetX = pointer.y * 0.24 + Math.sin(t * 0.7) * 0.012
      } else if (isSpeaking) {
        targetY = 0
        targetX = 0
      } else {
        targetY = Math.sin(t * 0.4) * 0.08
        targetX = Math.sin(t * 0.7) * 0.03
      }
      const ease = point ? 0.08 : shouldFollowPointer ? 0.065 : 0.035
      lookX += (targetY - lookX) * ease
      lookY += (targetX - lookY) * ease
      const walkTurn = (isWalking || isPostWalkHold) ? 1.18 : isTurningToFront ? 1.18 * (1 - turnEase) : 0
      const effectiveLookX = (isWalking || isPostWalkHold || isTurningToFront) ? 0 : lookX
      const bodyLookX = point ? effectiveLookX * 0.4 : 0
      // Peek/settle/retreat: body holds the diagonal (↗) lean; head stays level
      // toward the camera so his face reads. Lean persists through the retreat.
      const peekYaw = leanActive ? 0.12 : 0
      const peekLean = leanActive ? -0.42 : 0
      head.rotation.y = effectiveLookX - (atEdge ? 0.12 : 0)
      head.rotation.x = lookY - (atEdge ? 0.02 : 0)
      head.rotation.z = -(leanActive ? peekLean * 0.6 + (atEdge ? Math.sin(t * 3.2) * 0.01 : 0) : 0)
      robot.rotation.y = bodyLookX + walkTurn + peekYaw
      robot.rotation.z = peekLean

      // Peek: screen-right arm raised and ABDUCTED out (↗) so the wave clears
      // his big head; screen-left (edge) arm hangs holding the frame. All arm
      // poses are eased, so the hand lowers to rest before he slides back.
      legL.rotation.x = 0
      legR.rotation.x = 0
      legL.rotation.z = -0.02
      legR.rotation.z = 0.02
      const applyLowerStep = (parts, phase: number) => {
        const lift = isWalking ? Math.max(0, phase) : 0
        const push = isWalking ? phase : 0
        parts.shin.rotation.x = -0.04 * lift
        parts.shinHighlight.rotation.x = -0.04 * lift
        parts.ankle.position.y = -0.045 + lift * 0.026
        parts.foot.position.y = -0.1 + lift * 0.034
        parts.toe.position.y = -0.078 + lift * 0.034
        parts.foot.position.z = 0.105 + push * 0.03
        parts.toe.position.z = 0.208 + push * 0.035
        parts.foot.rotation.x = -0.09 - lift * 0.16 + push * 0.08
        parts.toe.rotation.x = -0.1 - lift * 0.2 + push * 0.1
      }
      applyLowerStep(legPartsL, gait)
      applyLowerStep(legPartsR, -gait)
      const armLTX = isWaving ? 0.12 : 0.08 - (isWalking ? gait * 0.18 : 0)
      const armLTZ = isWaving ? -0.16 : (isWalking ? 0.03 : 0)
      const armRTX = isWaving ? -0.1 : 0.08 + (isWalking ? gait * 0.18 : 0)
      const armRTZ = isWaving ? 2.3 : 0.095 - (isWalking ? 0.02 : 0)
      const armLerp = 0.14
      armLX += (armLTX - armLX) * armLerp
      armLZ += (armLTZ - armLZ) * armLerp
      armRX += (armRTX - armRX) * armLerp
      armRZ += (armRTZ - armRZ) * armLerp
      armL.rotation.x = armLX
      armL.rotation.z = armLZ
      armR.rotation.x = armRX
      armR.rotation.z = armRZ + (isWaving ? Math.sin(t * 7.2) * 0.22 : 0)

      earCapMat.emissiveIntensity = 0.4 + Math.sin(t * 2.0) * 0.16
      sparkBadge.rotation.z = 0
      sparkBadgeMat.opacity = 0.95
      const blinkPhase = (t + 0.35) % 4.8
      const eyeOpen = blinkPhase > 4.62 ? 0.06 : blinkPhase > 4.54 ? 0.32 : blinkPhase > 4.46 ? 0.68 : 1
      faceLight.draw(eyeOpen, mouth)
      faceLightMat.opacity = 0.9 + Math.sin(t * 1.8) * 0.05
      faceGlow.intensity = 0.24 + Math.sin(t * 1.8) * 0.05 + speakAmt * 0.08
      antenna.rotation.z = Math.sin(t * 1.4) * 0.06
      antennaTipMat.emissiveIntensity = 1.8 + Math.sin(t * 2.2) * 0.4
      antennaLight.intensity = 0.28 + Math.sin(t * 2.2) * 0.06

      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('resize', resize)
      resizeObserver?.disconnect()
      renderer.dispose()
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material?.dispose()
      })
      faceLightTexture.dispose()
      // sparkBadgeTexture is the shared module-cached favicon — do not dispose it
      // here or other live Yubi instances would lose their chest mark.
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement)
    }
  }, [])

  return <div className="robot-3d-canvas" role="img" aria-label={label} ref={mountRef} />
}
