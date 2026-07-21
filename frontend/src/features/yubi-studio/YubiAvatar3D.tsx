// @ts-nocheck
/* eslint-disable */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import yuviFaviconUrl from '../../assets/yuvi-favicon.png'
import type { YubiColors, YubiDesign, YubiSlot, YubiVariant } from './yubiDesign'
import { getAsset, buildBlondeHair, buildEyebrowsBundle } from './yubiAssets'

export interface YubiAvatarHandle {
  equip: (slot: YubiSlot, id: string | null, animate?: boolean) => void
  setColors: (colors: YubiColors, animate?: boolean) => void
  setVariant: (variant: YubiVariant, animate?: boolean) => void
  applyDesign: (design: YubiDesign, animate?: boolean) => void
}

interface Props {
  initialDesign: YubiDesign
  label: string
  muted?: boolean
  /** When true, the chest "Y" badge is a hover-pop button that fires onYClick. */
  interactiveY?: boolean
  onYClick?: (sourceEl: HTMLElement) => void
  /** Optional body click used by the global Yuvi learning-companion dock. */
  onAvatarClick?: () => void
  yTooltip?: string
  /** Studio mode: drag to orbit Yuvi, and frame him a little higher. */
  orbit?: boolean
  /** Expressive activity states update through refs without remounting WebGL. */
  thinking?: boolean
  speaking?: boolean
  /** Companion transition: Yuvi reaches with both hands and pulls the panel. */
  pulling?: boolean
  /** Physical side Yuvi turns and reaches toward during the pulling transition. */
  pullingSide?: 'left' | 'right'
  /** Companion transition: Yuvi turns side-on and shoves the panel with both hands. */
  pushing?: boolean
  /** Physical side Yuvi braces against and pushes toward during the closing transition. */
  pushingSide?: 'left' | 'right'
  /** Sustained presenting pose: Yuvi turns toward a panel and extends his near hand toward it. */
  presenting?: boolean
  /** Physical side the presented panel sits on relative to Yuvi. */
  presentingSide?: 'left' | 'right'
  /** Hold a neutral front-facing pose while two avatar canvases hand off. */
  frontFacing?: boolean
  /** Track the pointer across the viewport with Yuvi's eyes, head, and body. */
  followPointer?: boolean
  /** Keep Yuvi's feet planted instead of applying the ambient hover motion. */
  grounded?: boolean
  /** Airborne locomotion (Space): upright vertical lift-off, V-hands, thrusters. */
  flying?: boolean
  /** Ground locomotion (arrows): a walking gait — legs and arms swing. */
  walking?: boolean
  /** Direction Yuvi faces while moving through a top-down world. */
  heading?: 'down' | 'left' | 'right' | 'up'
  /** Continuous facing yaw (radians) derived from real movement — overrides `heading` when set.
   *  Convention matches `heading`: 0 = toward camera (down), +π/2 = right, π = away (up), −π/2 = left. */
  headingAngle?: number
  /** Reduce pixel density and antialiasing for small, repeated roadmap avatars. */
  performanceMode?: 'standard' | 'low'
}

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

export const YubiAvatar3D = forwardRef<YubiAvatarHandle, Props>(function YubiAvatar3D(
  { initialDesign, label, muted = false, interactiveY = false, onYClick, onAvatarClick, yTooltip = '', orbit = false, thinking = false, speaking = false, pulling = false, pullingSide = 'left', pushing = false, pushingSide = 'right', presenting = false, presentingSide = 'right', frontFacing = false, followPointer = false, grounded = false, flying = false, walking = false, heading = 'down', headingAngle, performanceMode = 'standard' },
  ref,
) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<YubiAvatarHandle | null>(null)
  const mutedRef = useRef(muted)
  const onYClickRef = useRef(onYClick)
  const onAvatarClickRef = useRef(onAvatarClick)
  const thinkingRef = useRef(thinking)
  const speakingRef = useRef(speaking)
  const pullingRef = useRef(pulling)
  const pullingSideRef = useRef(pullingSide)
  const pushingRef = useRef(pushing)
  const pushingSideRef = useRef(pushingSide)
  const pushingStartedAtRef = useRef(pushing ? Date.now() : 0)
  const presentingRef = useRef(presenting)
  const presentingSideRef = useRef(presentingSide)
  const frontFacingRef = useRef(frontFacing)
  const followPointerRef = useRef(followPointer)
  const groundedRef = useRef(grounded)
  const flyingRef = useRef(flying)
  const walkingRef = useRef(walking)
  const headingRef = useRef(heading)
  const headingAngleRef = useRef(headingAngle)
  const pullingStartedAtRef = useRef(pulling ? Date.now() : 0)
  useEffect(() => { mutedRef.current = muted }, [muted])
  useEffect(() => { onYClickRef.current = onYClick }, [onYClick])
  useEffect(() => { onAvatarClickRef.current = onAvatarClick }, [onAvatarClick])
  useEffect(() => { thinkingRef.current = thinking }, [thinking])
  useEffect(() => { speakingRef.current = speaking }, [speaking])
  useEffect(() => {
    if (pulling && !pullingRef.current) pullingStartedAtRef.current = Date.now()
    pullingRef.current = pulling
  }, [pulling])
  useEffect(() => { pullingSideRef.current = pullingSide }, [pullingSide])
  useEffect(() => {
    if (pushing && !pushingRef.current) pushingStartedAtRef.current = Date.now()
    pushingRef.current = pushing
  }, [pushing])
  useEffect(() => { pushingSideRef.current = pushingSide }, [pushingSide])
  useEffect(() => { presentingRef.current = presenting }, [presenting])
  useEffect(() => { presentingSideRef.current = presentingSide }, [presentingSide])
  useEffect(() => { frontFacingRef.current = frontFacing }, [frontFacing])
  useEffect(() => { followPointerRef.current = followPointer }, [followPointer])
  useEffect(() => { groundedRef.current = grounded }, [grounded])
  useEffect(() => { flyingRef.current = flying }, [flying])
  useEffect(() => { walkingRef.current = walking }, [walking])
  useEffect(() => { headingRef.current = heading }, [heading])
  useEffect(() => { headingAngleRef.current = headingAngle }, [headingAngle])

  useImperativeHandle(ref, () => ({
    equip: (slot, id, animate = true) => controllerRef.current?.equip(slot, id, animate),
    setColors: (colors, animate = false) => controllerRef.current?.setColors(colors, animate),
    setVariant: (variant, animate = true) => controllerRef.current?.setVariant(variant, animate),
    applyDesign: (design, animate = false) => controllerRef.current?.applyDesign(design, animate),
  }), [])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return
    const avatarRoot = container.closest('.yubi-avatar-canvas') as HTMLElement | null
    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: performanceMode !== 'low',
        alpha: true,
        powerPreference: performanceMode === 'low' ? 'low-power' : 'default',
      })
    } catch {
      if (avatarRoot) avatarRoot.dataset.webglState = 'unavailable'
      return
    }
    if (avatarRoot) avatarRoot.dataset.webglState = 'ready'
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, performanceMode === 'low' ? 1.25 : 2))
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
    camera.position.set(0, 0, orbit ? 6.3 : 5.4)

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6e0f5, 0.85))
    const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(3, 7, 6); scene.add(key)
    const fill = new THREE.DirectionalLight(0xbcd7ef, 0.5); fill.position.set(-5, 2, 3); scene.add(fill)
    const rim = new THREE.DirectionalLight(0xdcecff, 0.5); rim.position.set(0, 3, -6); scene.add(rim)

    const design: YubiDesign = {
      version: initialDesign.version,
      variant: initialDesign.variant,
      colors: { ...initialDesign.colors },
      equipped: { ...initialDesign.equipped },
    }

    // ── Materials (identical palette to the start-scene YubiRobot3D) ──
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x717378, roughness: 0.3, metalness: 0.14, envMapIntensity: 0.7 })
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x5c5e62, roughness: 0.34, metalness: 0.1, envMapIntensity: 0.65 })
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26, metalness: 0.08, envMapIntensity: 0.85 })
    const faceMat = new THREE.MeshBasicMaterial({ color: 0x050711 })
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x3fd9e0, emissive: 0x3fd9e0, emissiveIntensity: 1.8, roughness: 0.3, toneMapped: false })
    const earCapMat = new THREE.MeshStandardMaterial({ color: 0x3fd9e0, emissive: 0x3fd9e0, emissiveIntensity: 0.6, roughness: 0.3, toneMapped: false })
    const antennaTipMat = new THREE.MeshStandardMaterial({ color: 0x4eeef0, emissive: 0x4eeef0, emissiveIntensity: 2.2, toneMapped: false, roughness: 0.25 })

    const robot = new THREE.Group()
    scene.add(robot)

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
    const makeLeg = (side: number) => {
      const grp = new THREE.Group()
      const hip = new THREE.Mesh(new THREE.SphereGeometry(0.104, 32, 24), blueMat); hip.scale.set(1.08, 0.92, 1); hip.position.set(0.014 * side, 0.39, 0.015); grp.add(hip)
      const thigh = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.165, 0.145, 10, 0.06), blueMat); thigh.position.set(0.01 * side, 0.29, 0.018); thigh.rotation.z = 0.025 * side; grp.add(thigh)
      const knee = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.052, 32), jointMat); knee.position.set(0.003 * side, 0.18, 0.025); knee.scale.set(1.05, 0.78, 1); grp.add(knee)
      const shin = new THREE.Mesh(new RoundedBoxGeometry(0.162, 0.19, 0.145, 10, 0.06), blueMat); shin.position.set(-0.003 * side, 0.075, 0.04); shin.rotation.z = -0.015 * side; grp.add(shin)
      const shinHighlight = new THREE.Mesh(new RoundedBoxGeometry(0.108, 0.13, 0.026, 8, 0.026), whiteMat); shinHighlight.position.set(-0.003 * side, 0.078, 0.126); shinHighlight.rotation.z = -0.015 * side; grp.add(shinHighlight)
      const ankle = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.052, 32), blueMat); ankle.position.set(-0.003 * side, -0.045, 0.04); ankle.scale.set(1.12, 0.66, 1); grp.add(ankle)
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.255, 0.125, 0.36, 10, 0.068), blueMat); foot.position.set(0.006 * side, -0.1, 0.105); foot.rotation.x = -0.09; grp.add(foot)
      const toe = new THREE.Mesh(new RoundedBoxGeometry(0.205, 0.07, 0.17, 8, 0.04), whiteMat); toe.position.set(0.006 * side, -0.078, 0.208); toe.rotation.x = -0.1; grp.add(toe)
      grp.position.set(0.145 * side, 0.12, 0)
      return grp
    }
    const legL = makeLeg(-1), legR = makeLeg(1)
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
    const badgeHit = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ visible: false }))
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
    robot.add(armL, armR)

    // ── Head ──
    const head = new THREE.Group(); head.position.y = 1.59; head.scale.setScalar(0.9); robot.add(head)
    const helmet = new THREE.Mesh(new RoundedBoxGeometry(1.12, 1.02, 0.94, 10, 0.42), blueMat); helmet.scale.set(1, 1.0, 0.95); head.add(helmet)
    const antenna = new THREE.Group(); antenna.position.set(0, 0.52, 0.02); head.add(antenna)
    const antennaRod = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.018, 0.22, 14), jointMat); antennaRod.position.y = 0.11; antenna.add(antennaRod)
    const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.052, 20, 18), antennaTipMat); antennaTip.position.y = 0.24; antenna.add(antennaTip)
    const antennaLight = new THREE.PointLight(0x4eeef0, 0.35, 1.3); antennaLight.position.y = 0.24; antenna.add(antennaLight)
    const screen = makeFlatRoundedRect(0.82, 0.62, 0.13, faceMat); screen.position.set(0, -0.03, 0.455); head.add(screen)
    const faceLight = makeFaceLightTexture()
    const faceLightMat = new THREE.MeshBasicMaterial({ map: faceLight.texture, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })
    const faceLights = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.62), faceLightMat); faceLights.position.set(0, -0.03, 0.468); faceLights.renderOrder = 7; head.add(faceLights)
    const faceGlow = new THREE.PointLight(0x4eeef0, 0.28, 1.1); faceGlow.position.set(0, -0.02, 0.62); head.add(faceGlow)
    const earGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.12, 30)
    const earL = new THREE.Mesh(earGeo, blueMat); earL.rotation.z = Math.PI / 2; earL.position.set(-0.56, -0.02, 0.02); head.add(earL)
    const earR = earL.clone(); earR.position.x = 0.56; head.add(earR)
    const earCapL = new THREE.Mesh(new THREE.CircleGeometry(0.07, 26), earCapMat); earCapL.rotation.y = -Math.PI / 2; earCapL.position.set(-0.623, -0.02, 0.02); head.add(earCapL)
    const earCapR = earCapL.clone(); earCapR.rotation.y = Math.PI / 2; earCapR.position.x = 0.623; head.add(earCapR)
    const nativeEarParts = [earL, earR, earCapL, earCapR]

    robot.position.y = -1.35

    // ── Anchors ──
    const anchors: Record<YubiSlot, THREE.Group> = {
      headTop: new THREE.Group(), face: new THREE.Group(), back: new THREE.Group(), handR: new THREE.Group(), body: new THREE.Group(),
    }
    anchors.headTop.position.set(0, 0, 0); head.add(anchors.headTop)
    anchors.face.position.set(0, -0.03, 0); head.add(anchors.face)
    anchors.back.position.set(0, 0.9, -0.22); robot.add(anchors.back)
    anchors.handR.position.set(0.058, -0.56, 0.12); armR.add(anchors.handR)
    anchors.body.position.set(0, 0.82, 0.04); robot.add(anchors.body)
    const variantGroup = new THREE.Group(); head.add(variantGroup)

    // ── equip / variant / colours ──
    const equippedObjects: Partial<Record<YubiSlot, THREE.Group>> = {}
    const popTargets: Array<{ obj: THREE.Group; t: number }> = []
    let transforming = false, transformT = 0
    const disposeGroup = (obj: THREE.Object3D) => obj.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose() })
    function playTransform(newObj?: THREE.Group) {
      transformSound()
      if (reduceMotion) return
      transforming = true; transformT = 0
      if (newObj) { newObj.scale.setScalar(0.001); popTargets.push({ obj: newObj, t: 0 }) }
    }
    function equip(slot: YubiSlot, id: string | null, animate = true) {
      const anchor = anchors[slot]
      if (equippedObjects[slot]) { anchor.remove(equippedObjects[slot]!); disposeGroup(equippedObjects[slot]!); delete equippedObjects[slot] }
      design.equipped[slot] = id
      if (slot === 'headTop') {
        antenna.visible = !id
        const showNativeEars = id !== 'headphones'
        nativeEarParts.forEach((part) => { part.visible = showNativeEars })
      }
      if (!id) return
      const asset = getAsset(id); if (!asset) return
      const g = asset.build(); anchor.add(g); equippedObjects[slot] = g
      if (animate) playTransform(g)
    }
    function setVariant(variant: YubiVariant, animate = true) {
      design.variant = variant
      while (variantGroup.children.length) { const c = variantGroup.children[0]; variantGroup.remove(c); disposeGroup(c) }
      if (variant === 'girl') { variantGroup.add(buildBlondeHair()); variantGroup.add(buildEyebrowsBundle()); if (animate) playTransform(variantGroup) }
    }
    function setColors(colors: YubiColors, animate = false) {
      design.colors = { ...colors }
      const b = new THREE.Color(colors.body)
      blueMat.color.copy(b)
      jointMat.color.copy(b.clone().multiplyScalar(0.82))
      const g = new THREE.Color(colors.glow)
      ringMat.color.copy(g); ringMat.emissive.copy(g)
      earCapMat.color.copy(g); earCapMat.emissive.copy(g)
      antennaTipMat.color.copy(g); antennaTipMat.emissive.copy(g)
      antennaLight.color.copy(g); faceGlow.color.copy(g)
      faceLight.draw()
      if (animate) playTransform()
    }
    function applyDesign(next: YubiDesign, animate = false) {
      setColors(next.colors, false)
      setVariant(next.variant, animate)
      for (const slot of Object.keys(anchors) as YubiSlot[]) equip(slot, next.equipped[slot] ?? null, animate)
    }
    controllerRef.current = { equip, setColors, setVariant, applyDesign }
    applyDesign(design, false)

    // ── transform sound (WebAudio) ──
    let audioCtx: AudioContext | null = null
    function transformSound() {
      if (mutedRef.current) return
      try {
        audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)()
        const now = audioCtx.currentTime
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain()
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(220, now)
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.18)
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.32)
        gain.gain.setValueAtTime(0.0001, now)
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.04)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42)
        const filter = audioCtx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 900; filter.Q.value = 4
        osc.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination)
        osc.start(now); osc.stop(now + 0.44)
        const osc2 = audioCtx.createOscillator(); const g2 = audioCtx.createGain()
        osc2.type = 'triangle'; osc2.frequency.setValueAtTime(1320, now + 0.1)
        osc2.frequency.exponentialRampToValueAtTime(2640, now + 0.3)
        g2.gain.setValueAtTime(0.0001, now + 0.1); g2.gain.exponentialRampToValueAtTime(0.05, now + 0.16); g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.4)
        osc2.connect(g2); g2.connect(audioCtx.destination); osc2.start(now + 0.1); osc2.stop(now + 0.42)
      } catch { /* no audio */ }
    }

    // ── interactive chest "Y" ──
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let hoveredY = false
    let badgeScale = 1
    const onPointerMove = (event: PointerEvent) => {
      if (!interactiveY) return
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      hoveredY = raycaster.intersectObject(badgeHit, false).length > 0
      renderer.domElement.style.cursor = hoveredY || Boolean(onAvatarClickRef.current) ? 'pointer' : 'default'
    }
    const onPointerLeave = () => {
      hoveredY = false
      renderer.domElement.style.cursor = onAvatarClickRef.current ? 'pointer' : 'default'
    }
    const onClick = () => {
      if (interactiveY && hoveredY) onYClickRef.current?.(container)
      else onAvatarClickRef.current?.()
    }
    if (interactiveY || onAvatarClickRef.current) {
      renderer.domElement.style.cursor = 'pointer'
      renderer.domElement.addEventListener('pointermove', onPointerMove)
      renderer.domElement.addEventListener('pointerleave', onPointerLeave)
      renderer.domElement.addEventListener('click', onClick)
    }

    // ── orbit drag (studio): grab to spin Yuvi and see him from any angle ──
    let dragging = false, lastX = 0, lastY = 0
    let orbitYaw = 0, orbitPitch = 0, velYaw = 0
    const onOrbitDown = (event: PointerEvent) => {
      dragging = true; lastX = event.clientX; lastY = event.clientY; velYaw = 0
      renderer.domElement.style.cursor = 'grabbing'
    }
    const onOrbitMove = (event: PointerEvent) => {
      if (!dragging) return
      const dx = event.clientX - lastX, dy = event.clientY - lastY
      lastX = event.clientX; lastY = event.clientY
      orbitYaw += dx * 0.01
      orbitPitch = Math.max(-0.45, Math.min(0.45, orbitPitch + dy * 0.006))
      velYaw = dx * 0.01
    }
    const onOrbitUp = () => {
      dragging = false
      renderer.domElement.style.cursor = 'grab'
    }
    if (orbit) {
      renderer.domElement.style.cursor = 'grab'
      renderer.domElement.addEventListener('pointerdown', onOrbitDown)
      window.addEventListener('pointermove', onOrbitMove)
      window.addEventListener('pointerup', onOrbitUp)
    }

    // ── viewport pointer tracking ──
    // The companion can be much smaller than the page, so tracking listens at
    // window level rather than only while the pointer is over the WebGL canvas.
    let pointerTargetX = 0, pointerTargetY = 0
    let pointerLookX = 0, pointerLookY = 0
    const onGlobalPointerMove = (event: PointerEvent) => {
      if (!followPointerRef.current || (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return
      const rect = container.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height * 0.42
      const horizontalRange = Math.max(240, window.innerWidth * 0.38)
      const verticalRange = Math.max(180, window.innerHeight * 0.4)
      pointerTargetX = THREE.MathUtils.clamp((event.clientX - centerX) / horizontalRange, -1, 1)
      pointerTargetY = THREE.MathUtils.clamp((event.clientY - centerY) / verticalRange, -1, 1)
    }
    const resetPointerLook = () => {
      pointerTargetX = 0
      pointerTargetY = 0
    }
    window.addEventListener('pointermove', onGlobalPointerMove, { passive: true })
    window.addEventListener('blur', resetPointerLook)
    document.documentElement.addEventListener('mouseleave', resetPointerLook)

    // ── loop ──
    let blink = 2 + Math.random() * 3, nextBlink = 2 + Math.random() * 3
    const animationStartedAt = performance.now()
    let previousFrameAt = animationStartedAt
    const badgeWorld = new THREE.Vector3()
    const resize = () => {
      const w = container.clientWidth || 1, h = container.clientHeight || 1
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix()
    }
    resize()
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    resizeObserver?.observe(container)
    window.addEventListener('resize', resize)

    let frame = 0
    let viewportVisible = true
    let contextAvailable = true
    let loop: () => void
    const requestFrame = () => {
      if (frame === 0 && viewportVisible && contextAvailable && !document.hidden) {
        frame = requestAnimationFrame(loop)
      }
    }
    loop = () => {
      frame = 0
      if (!viewportVisible || !contextAvailable || document.hidden) return
      if (container.offsetParent === null) {
        requestFrame()
        return
      }
      const frameAt = performance.now()
      const dt = Math.min((frameAt - previousFrameAt) / 1000, 0.1)
      const t = (frameAt - animationStartedAt) / 1000
      previousFrameAt = frameAt
      if (orbit) {
        // Studio: drag-controlled turntable (with gentle inertia) + framed higher.
        if (!dragging) { velYaw *= 0.94; orbitYaw += velYaw }
        robot.rotation.y = orbitYaw
        robot.rotation.x = orbitPitch
        robot.position.y = -0.82 + Math.sin(t * 1.4) * 0.02
        head.rotation.y = 0
        head.rotation.x = 0
      } else {
        const isThinking = thinkingRef.current
        const isSpeaking = speakingRef.current
        const isPulling = pullingRef.current
        const pullPhase = isPulling ? Math.min(1, (Date.now() - pullingStartedAtRef.current) / 1450) : 0
        const reachStrength = Math.max(0, Math.min(1, (pullPhase - 0.22) / 0.14))
        const releaseStrength = Math.max(0, Math.min(1, (1 - pullPhase) / 0.22))
        const gripStrength = reachStrength * releaseStrength
        // Closing: Yuvi turns side-on and heaves the panel away with both hands.
        const isPushing = pushingRef.current
        const pushElapsed = isPushing ? Date.now() - pushingStartedAtRef.current : 0
        const pushPhase = isPushing ? Math.min(1, pushElapsed / 1450) : 0
        const pushRampIn = Math.max(0, Math.min(1, (pushPhase - 0.1) / 0.1))
        const pushRelease = Math.max(0, Math.min(1, (1 - pushPhase) / 0.16))
        const pushStrength = pushRampIn * pushRelease
        // Straining pulse: hands press harder, then ease, over and over.
        const pushStrain = isPushing && !reduceMotion ? (Math.sin(pushElapsed / 1000 * 20) * 0.5 + 0.5) : 0
        const dockingStrength = frontFacingRef.current
          ? 1
          : Math.max(0, Math.min(1, (pullPhase - 0.74) / 0.18))
        const pullRight = pullingSideRef.current === 'right'
        const pullDirection = pullRight ? 1 : -1
        const pushRight = pushingSideRef.current === 'right'
        const pushDirection = pushRight ? 1 : -1
        const tracksPointer = followPointerRef.current && !reduceMotion && !isPulling && !isPushing && !frontFacingRef.current
        pointerLookX += ((tracksPointer ? pointerTargetX : 0) - pointerLookX) * 0.11
        pointerLookY += ((tracksPointer ? pointerTargetY : 0) - pointerLookY) * 0.11
        // Thinking: a curious head tilt with one hand toward the chin.
        // Speaking: warm alternating gestures and a live speech envelope.
        const isFlying = flyingRef.current
        const isGrounded = groundedRef.current
        const isWalking = walkingRef.current && !isFlying
        const isMoving = isFlying || isWalking
        const headingYaw = headingAngleRef.current != null
          ? headingAngleRef.current
          : headingRef.current === 'up'
            ? Math.PI
            : headingRef.current === 'left'
              ? -Math.PI / 2
              : headingRef.current === 'right'
                ? Math.PI / 2
                : 0
        // Walk gait: legs/arms swing in anti-phase; the body bobs a touch each step.
        const walkPhase = t * 9
        const walkStride = Math.sin(walkPhase)
        const walkAmp = isWalking ? (reduceMotion ? 0.18 : 0.5) : 0
        const sway = isFlying ? headingYaw : isGrounded ? 0 : isSpeaking ? Math.sin(t * 1.9) * 0.16 : Math.sin(t * 0.5) * 0.32
        const idleStrength = (1 - gripStrength) * (1 - dockingStrength) * (1 - pushStrength)
        const postureEase = dockingStrength > 0 ? 0.3 : (pushStrength > 0 ? 0.22 : 0.14)
        // Sustained "presenting" pose: Yuvi holds a gentle turn toward a panel and
        // keeps his near hand extended toward it (unlike `pulling`, which is a
        // one-shot grab that settles back to front).
        const isPresenting = presentingRef.current && !isMoving && !isPulling
        const presentSign = presentingSideRef.current === 'left' ? -1 : 1
        const presentStrength = isPresenting ? 1 : 0
        const robotYawTarget = isMoving
          ? headingYaw
          : isPresenting
            ? 0.46 * presentSign
            : sway * idleStrength + pointerLookX * 0.12 * idleStrength + 0.34 * pullDirection * gripStrength + 1.28 * pushDirection * pushStrength
        // Shortest-path turn so crossing the ±π (facing-away) seam doesn't spin Yuvi the long way round.
        const yawDelta = Math.atan2(Math.sin(robotYawTarget - robot.rotation.y), Math.cos(robotYawTarget - robot.rotation.y))
        robot.rotation.y += yawDelta * postureEase
        // Flying: upright vertical lift-off (no forward pitch). Walking: a slight
        // forward lean. Pushing: lean into the panel, deeper on each strain heave.
        const robotPitchTarget = isFlying ? 0 : isWalking ? 0.06 : pointerLookY * 0.035 * idleStrength + (0.22 + pushStrain * 0.06) * pushStrength
        robot.rotation.x += (robotPitchTarget - robot.rotation.x) * postureEase
        robot.rotation.z += ((((isThinking ? -0.035 : 0) + (isSpeaking ? Math.sin(t * 2.2) * 0.018 : 0)) * (1 - dockingStrength) + 0.13 * gripStrength + 0.12 * pushDirection * pushStrength) - robot.rotation.z) * postureEase
        robot.position.y = -1.35 + (isFlying
          ? 0.16 + Math.sin(t * 5.2) * 0.05
          : isWalking ? Math.abs(walkStride) * 0.03
          : isGrounded ? 0 : Math.sin(t * (isSpeaking ? 2.5 : 1.4)) * (isSpeaking ? 0.045 : 0.03))
        head.rotation.y = ((isThinking ? -0.16 + Math.sin(t * 0.8) * 0.05 : Math.sin(t * 0.4) * 0.08) + pointerLookX * 0.3) * idleStrength + 0.24 * pullDirection * gripStrength + 0.2 * pushDirection * pushStrength + 0.26 * presentSign * presentStrength
        head.rotation.x = ((isThinking ? -0.07 + Math.sin(t * 1.1) * 0.025 : Math.sin(t * 0.7) * 0.03) + pointerLookY * 0.16) * (1 - dockingStrength) - 0.16 * presentStrength
        head.rotation.z += (((isThinking ? 0.13 : isSpeaking ? Math.sin(t * 1.6) * 0.055 : 0) * (1 - dockingStrength) - head.rotation.z) * postureEase)
        const flyFlutter = isFlying && !reduceMotion ? Math.sin(t * 9.5) * 0.06 : 0
        // Flying → overhead V (hands up and out); walking → relaxed at sides (they swing via rotation.x below).
        const naturalRightArm = isFlying ? 2.15 + flyFlutter : isWalking ? 0.12 : isThinking ? -1.12 : isSpeaking ? -0.18 + Math.sin(t * 2.7) * 0.24 : 0.095
        const naturalLeftArm = isFlying ? -2.15 - flyFlutter : isWalking ? -0.12 : isSpeaking ? -0.095 - Math.sin(t * 2.7) * 0.18 : -0.095
        const restingRightArm = naturalRightArm * (1 - dockingStrength) + 0.095 * dockingStrength
        const restingLeftArm = naturalLeftArm * (1 - dockingStrength) - 0.095 * dockingStrength
        // Both hands reach toward the selected physical panel edge. The farther
        // arm crosses the chest while the nearer arm extends, then both release.
        const rightPullRotation = pullRight ? 1.18 : -1.55
        const leftPullRotation = pullRight ? 1.55 : -1.18
        // Pushing: both arms extend forward, shoulder-width, palms flat on the
        // panel; a strain pulse presses them a little deeper on each heave.
        const pushArmX = (-1.42 - pushStrain * 0.14) * pushStrength
        const restWeight = 1 - gripStrength - pushStrength
        const rightArmTarget = restingRightArm * restWeight + rightPullRotation * gripStrength + 0.16 * pushStrength
        const leftArmTarget = restingLeftArm * restWeight + leftPullRotation * gripStrength - 0.16 * pushStrength
        const armSwing = walkAmp * 0.7   // arms counter-swing the legs
        // Presenting turns only Yuvi's face and head toward the panel — both arms
        // stay in their natural resting pose (no pointing/reaching gesture).
        armR.rotation.z += (rightArmTarget - armR.rotation.z) * postureEase
        armR.rotation.x += ((((isThinking ? -0.36 : 0) * (1 - dockingStrength) - 0.5 * gripStrength - walkStride * armSwing) + pushArmX - armR.rotation.x) * postureEase)
        armL.rotation.z += (leftArmTarget - armL.rotation.z) * postureEase
        armL.rotation.x += (((-0.28 * gripStrength + walkStride * armSwing) + pushArmX - armL.rotation.x) * postureEase)
        // Legs stride when walking, tuck slightly when flying, and straighten otherwise.
        const legTuck = isFlying ? 0.12 : 0
        legR.rotation.x += ((legTuck - walkStride * walkAmp) - legR.rotation.x) * postureEase
        legL.rotation.x += ((legTuck + walkStride * walkAmp) - legL.rotation.x) * postureEase
      }
      blink -= dt
      let eyeOpen = 1
      if (blink < 0) { if (blink > -0.12) eyeOpen = 0; else { blink = nextBlink; nextBlink = 2 + Math.random() * 3 } }
      const speechEnvelope = speakingRef.current && !reduceMotion
        ? 0.28 + Math.abs(Math.sin(t * 7.4) * Math.cos(t * 4.1)) * 0.72
        : 0
      faceLight.draw(eyeOpen, speechEnvelope, pointerLookX, pointerLookY)
      faceLightMat.opacity = 0.9 + Math.sin(t * 1.8) * 0.05
      antennaTipMat.emissiveIntensity = 1.8 + Math.sin(t * 2.2) * 0.4
      antennaLight.intensity = 0.28 + Math.sin(t * 2.2) * 0.06
      earCapMat.emissiveIntensity = 0.4 + Math.sin(t * 2.0) * 0.16
      ringMat.emissiveIntensity = 1.6 + Math.sin(t * 2.4) * 0.4
      faceGlow.intensity = 0.24 + Math.sin(t * 1.8) * 0.05

      // accessory motion
      const prop = (equippedObjects.headTop as any)?.userData?.spin
      if (prop) prop.rotation.y += dt * 8
      const flames = (equippedObjects.back as any)?.userData?.flames as THREE.Object3D[] | undefined
      if (flames) flames.forEach((f, i) => { f.scale.y = 1 + Math.sin(t * 20 + i) * 0.25 })
      const cape = (equippedObjects.back as any)?.userData?.wave as THREE.Mesh | undefined
      if (cape) { const p = cape.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -Math.cos(x * 3 + t * 3) * 0.06 - 0.05 + Math.sin(y * 4 + t * 2) * 0.02) } p.needsUpdate = true }
      // interactive Y pop
      if (interactiveY) {
        badgeScale += ((hoveredY ? 1.32 : 1) - badgeScale) * 0.2
        sparkBadge.scale.setScalar(badgeScale)
        sparkBadgeMat.opacity = hoveredY ? 1 : 0.95
        const tip = tooltipRef.current
        if (tip) {
          if (hoveredY && yTooltip) {
            sparkBadge.updateWorldMatrix(true, false)
            sparkBadge.getWorldPosition(badgeWorld); badgeWorld.project(camera)
            const rect = renderer.domElement.getBoundingClientRect()
            const x = (badgeWorld.x * 0.5 + 0.5) * rect.width
            const y = (-badgeWorld.y * 0.5 + 0.5) * rect.height
            tip.style.display = 'block'
            tip.style.left = `${x}px`
            tip.style.top = `${y}px`
          } else {
            tip.style.display = 'none'
          }
        }
      }

      if (transforming) {
        transformT += dt
        const p = Math.min(1, transformT / 0.5)
        const squash = Math.sin(p * Math.PI)
        robot.scale.set(1 + squash * 0.05, 1 - squash * 0.04, 1 + squash * 0.05)
        if (p >= 1) { transforming = false; robot.scale.setScalar(1) }
      }
      for (let i = popTargets.length - 1; i >= 0; i--) {
        const pt = popTargets[i]; pt.t += dt
        const p = Math.min(1, pt.t / 0.4)
        const s = p < 0.7 ? (p / 0.7) * 1.15 : 1.15 - ((p - 0.7) / 0.3) * 0.15
        pt.obj.scale.setScalar(s)
        if (p >= 1) { pt.obj.scale.setScalar(1); popTargets.splice(i, 1) }
      }

      renderer.render(scene, camera)
      requestFrame()
    }
    const renderObserver = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => {
          viewportVisible = Boolean(entry?.isIntersecting)
          if (viewportVisible) {
            resize()
            requestFrame()
          } else if (frame !== 0) {
            cancelAnimationFrame(frame)
            frame = 0
          }
        }, { rootMargin: '160px', threshold: 0 })
      : null
    renderObserver?.observe(container)
    const onVisibilityChange = () => {
      if (document.hidden && frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      } else {
        requestFrame()
      }
    }
    const onContextLost = (event: Event) => {
      event.preventDefault()
      contextAvailable = false
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
      if (avatarRoot) avatarRoot.dataset.webglState = 'lost'
    }
    const onContextRestored = () => {
      contextAvailable = true
      if (avatarRoot) avatarRoot.dataset.webglState = 'ready'
      resize()
      requestFrame()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    renderer.domElement.addEventListener('webglcontextlost', onContextLost, false)
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false)
    requestFrame()

    return () => {
      cancelAnimationFrame(frame)
      renderObserver?.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored)
      window.removeEventListener('resize', resize)
      resizeObserver?.disconnect()
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('pointerdown', onOrbitDown)
      window.removeEventListener('pointermove', onOrbitMove)
      window.removeEventListener('pointerup', onOrbitUp)
      window.removeEventListener('pointermove', onGlobalPointerMove)
      window.removeEventListener('blur', resetPointerLook)
      document.documentElement.removeEventListener('mouseleave', resetPointerLook)
      controllerRef.current = null
      faceLight.texture.dispose()
      renderer.dispose()
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material?.dispose()
      })
      // sparkBadgeTexture is the shared module favicon — do not dispose it.
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="yubi-avatar-canvas" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <img className="yubi-avatar-canvas__fallback" src="/shared/yubi-robot.png" alt="" aria-hidden="true" />
      <div
        role={onAvatarClick ? 'button' : 'img'}
        aria-label={label}
        tabIndex={onAvatarClick ? 0 : undefined}
        onKeyDown={onAvatarClick ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onAvatarClick()
          }
        } : undefined}
        ref={mountRef}
        style={{ width: '100%', height: '100%' }}
      />
      {interactiveY && (
        <div ref={tooltipRef} className="yubi-y-tooltip" style={{ display: 'none' }}>{yTooltip}</div>
      )}
    </div>
  )
})
