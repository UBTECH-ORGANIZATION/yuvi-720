// @ts-nocheck
/* eslint-disable */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import yuviFaviconUrl from '../../assets/yuvi-favicon.png'
import type { YuviColors, YuviDesign, YuviSlot, YuviVariant } from './YuviDesign'
import { getAsset, buildBlondeHair, buildEyebrowsBundle } from './YuviAssets'
import { roomItemSpec } from './RoomCatalog'
import { createYuviLabRoom, detectLabQuality, roomStandingSpot, PROP_SCALE, STATION_RADIUS, type LabRoom, type LabRoomQuality, type LabRoomZoneId } from './YuviLabRoom'
import type { MoodId, RoomItem, RoomStations, RoomStyleId, StationId, WallStyleId } from './RoomDesign'

/** Camera framings the studio can request when the learner switches category. */
export type YuviFocus = 'full' | 'head' | 'face' | 'body' | 'hand' | 'back' | 'roam' | 'room'

/** What the learner is about to drop into the room, if anything. */
export interface YuviPlacing {
  kind: string
  tint?: string
  rot?: number
  /** Set when an already-placed prop is being carried rather than a new one. */
  uid?: string
  /** Set when a whole walk-in station is being carried. */
  station?: StationId
  /** The rotation it was picked up at, so a cancelled move changes nothing. */
  rot0?: number
}

export interface YuviAvatarHandle {
  equip: (slot: YuviSlot, id: string | null, animate?: boolean) => void
  setColors: (colors: YuviColors, animate?: boolean) => void
  setVariant: (variant: YuviVariant, animate?: boolean) => void
  applyDesign: (design: YuviDesign, animate?: boolean) => void
  /** Glide the studio camera to the part of Yuvi the learner is editing. */
  focus: (view: YuviFocus) => void
  /** Send Yuvi walking to a spot on the room floor. */
  walkTo: (x: number, z: number) => void
  /** Walk Yuvi back onto the upgrade platform. */
  recenter: () => void
}

interface Props {
  initialDesign: YuviDesign
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
  /** Yuvi Lab: build the LED podium, floor glow and ambient motes around him. */
  stage?: boolean
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
  /** Studio roaming: the learner walks Yuvi around the room (click or WASD). */
  roam?: boolean
  /** Drop the camera behind Yuvi's eyes. Arrow keys alone drive the walk. */
  firstPerson?: boolean
  /** Fires when Yuvi steps onto or off one of the room's stations. */
  onZoneChange?: (zone: LabRoomZoneId | null) => void
  /** The learner's placed props. A new array identity re-syncs the room. */
  roomItems?: RoomItem[]
  /** Where the two walk-in stations stand. A new identity re-syncs them. */
  stations?: RoomStations | null
  /** Floor, wall and lighting mood chosen by the learner. */
  roomStyle?: { floor: RoomStyleId; wall: WallStyleId; mood: MoodId } | null
  /** Prop currently being positioned — shown as a hologram under the pointer. */
  placing?: YuviPlacing | null
  /** Walkthrough target: lights a patch of floor and makes it the only legal drop. */
  placeTarget?: { x: number; z: number; radius: number; aim?: number } | null
  /** While a station panel is open, the floor is a build surface only — a stray
   *  tap must not walk Yuvi off the station and close the panel under the learner. */
  lockRoam?: boolean
  /** Fires when the learner clicks the floor while placing. */
  onPlaceAt?: (x: number, z: number, valid: boolean) => void
  /** Right-click on a placed prop. Passing it enables in-world prop menus;
   *  `null` means the menu should close. */
  onItemMenu?: (menu: { uid: string; x: number; y: number } | null) => void
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

export const YuviAvatar3D = forwardRef<YuviAvatarHandle, Props>(function YuviAvatar3D(
  { initialDesign, label, muted = false, interactiveY = false, onYClick, onAvatarClick, yTooltip = '', orbit = false, stage = false, thinking = false, speaking = false, pulling = false, pullingSide = 'left', pushing = false, pushingSide = 'right', presenting = false, presentingSide = 'right', frontFacing = false, followPointer = false, grounded = false, flying = false, walking = false, heading = 'down', headingAngle, performanceMode = 'standard', roam = false, firstPerson = false, onZoneChange, roomItems, stations = null, roomStyle = null, placing = null, placeTarget = null, onPlaceAt, lockRoam = false, onItemMenu },
  ref,
) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<YuviAvatarHandle | null>(null)
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
  const roamRef = useRef(roam)
  const firstPersonRef = useRef(firstPerson)
  const onZoneChangeRef = useRef(onZoneChange)
  const roomItemsRef = useRef(roomItems)
  const stationsRef = useRef(stations)
  const roomStyleRef = useRef(roomStyle)
  const placingRef = useRef(placing)
  const placeTargetRef = useRef(placeTarget)
  const lockRoamRef = useRef(lockRoam)
  const onPlaceAtRef = useRef(onPlaceAt)
  const onItemMenuRef = useRef(onItemMenu)
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
  useEffect(() => { roamRef.current = roam }, [roam])
  useEffect(() => { firstPersonRef.current = firstPerson }, [firstPerson])
  useEffect(() => { onZoneChangeRef.current = onZoneChange }, [onZoneChange])
  useEffect(() => { roomItemsRef.current = roomItems }, [roomItems])
  useEffect(() => { stationsRef.current = stations }, [stations])
  useEffect(() => { roomStyleRef.current = roomStyle }, [roomStyle])
  useEffect(() => { placingRef.current = placing }, [placing])
  useEffect(() => { placeTargetRef.current = placeTarget }, [placeTarget])
  useEffect(() => { lockRoamRef.current = lockRoam }, [lockRoam])
  useEffect(() => { onPlaceAtRef.current = onPlaceAt }, [onPlaceAt])
  useEffect(() => { onItemMenuRef.current = onItemMenu }, [onItemMenu])

  useImperativeHandle(ref, () => ({
    equip: (slot, id, animate = true) => controllerRef.current?.equip(slot, id, animate),
    setColors: (colors, animate = false) => controllerRef.current?.setColors(colors, animate),
    setVariant: (variant, animate = true) => controllerRef.current?.setVariant(variant, animate),
    applyDesign: (design, animate = false) => controllerRef.current?.applyDesign(design, animate),
    focus: (view) => controllerRef.current?.focus(view),
    walkTo: (x, z) => controllerRef.current?.walkTo(x, z),
    recenter: () => controllerRef.current?.recenter(),
  }), [])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return
    const avatarRoot = container.closest('.Yuvi-avatar-canvas') as HTMLElement | null
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
    renderer.toneMappingExposure = 1.06
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.028).texture
    pmrem.dispose()

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
    const BASE_FOV = 30
    camera.position.set(0, 0, orbit ? 6.3 : 5.4)

    // Studio-style rig: one soft key, a cool fill, and two coloured rims
    // (violet + cyan) that trace the silhouette. The coloured edge light is
    // what separates a modern character render from flat toy plastic.
    const hemi = new THREE.HemisphereLight(0xf4f6ff, 0xa192e6, 0.62); scene.add(hemi)
    const key = new THREE.DirectionalLight(0xffffff, 1.55); key.position.set(2.6, 6.4, 5.6); scene.add(key)
    const fill = new THREE.DirectionalLight(0xc7d8ff, 0.42); fill.position.set(-5, 1.8, 3.4); scene.add(fill)
    const rim = new THREE.DirectionalLight(0x8f6cff, 1.45); rim.position.set(-3.6, 2.8, -5.2); scene.add(rim)
    const rimCool = new THREE.DirectionalLight(0x4eeef0, 1.05); rimCool.position.set(3.8, 1.4, -4.8); scene.add(rimCool)
    const bounce = new THREE.PointLight(0xa78bfa, 0.45, 9); bounce.position.set(0, -2.4, 2.6); scene.add(bounce)

    // ── Yuvi Lab room ──
    // A real 3D room instead of a flat backdrop: floor, walls, ceiling, a lit
    // upgrade platform, a workbench, shelves of parts and hologram readouts.
    // The room lives in its own module so the shop and the reward reveal can
    // later step into exactly the same space.
    const roomQuality: LabRoomQuality =
      performanceMode === 'low' || reduceMotion ? 'low' : detectLabQuality()
    let room: LabRoom | null = null
    if (stage) {
      renderer.shadowMap.enabled = roomQuality === 'high'
      renderer.shadowMap.type = THREE.PCFShadowMap
      room = createYuviLabRoom(scene, {
        quality: roomQuality,
        reduceMotion,
        deckY: -0.92,
        accent: initialDesign.colors.glow,
      })
      // The room brings its own key light from the ceiling, so the free-floating
      // studio rig steps back to rims and fill — otherwise the bay reads flat.
      // The ambient hemisphere in particular has to come most of the way down:
      // uniform fill light is exactly what made every surface look like the
      // same moulded plastic.
      hemi.intensity = 0.2
      key.intensity = 0.5
      fill.intensity = 0.28
      rim.intensity = 1.2
      rimCool.intensity = 0.85
      bounce.intensity = 0.22
      // Aerial haze: the far wall sits back, the platform stays forward, and
      // the view through the window reads as genuinely distant. Density is tied
      // to the room's depth — the same value in the enlarged hall would bury
      // the window in grey.
      scene.fog = new THREE.FogExp2(0x05071a, 0.023)
    }
    const roomBounds = room?.bounds ?? null

    // Only solid shell parts cast into the room's single shadow map — glowing
    // visor sheens and additive light planes would smear it.
    const castShadows = (obj: THREE.Object3D) => {
      if (!room || roomQuality !== 'high') return
      obj.traverse((child: any) => {
        if (!child.isMesh) return
        const material = child.material
        if (Array.isArray(material) || !material) return
        if ((material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) && !material.transparent) {
          child.castShadow = true
        }
      })
    }

    // ── Camera framing ──
    // Switching category glides the camera to the part being edited, which is
    // what makes the studio read as a lab rather than a settings screen.
    const FRAMES: Record<string, { pos: [number, number, number]; look: [number, number, number]; yaw: number | null; anchored?: boolean; fov?: number; dolly?: number }> = {
      full: { pos: [0, 0.18, 6.9], look: [0, -0.34, 0], yaw: 0 },
      head: { pos: [0, 0.72, 4.1], look: [0, 0.74, 0], yaw: 0 },
      face: { pos: [0, 0.7, 3.5], look: [0, 0.74, 0], yaw: 0 },
      body: { pos: [0, 0.02, 4.7], look: [0, 0.02, 0], yaw: 0 },
      hand: { pos: [0.75, -0.18, 4.5], look: [0.3, -0.2, 0], yaw: 0.35 },
      back: { pos: [0, 0.34, 5.7], look: [0, 0.1, 0], yaw: Math.PI },
      // Walking shot: a wide establishing lens lifted off the floor, so the
      // room is the subject and Yuvi is just the character in it. He is also
      // free to turn wherever he is heading instead of being locked facing the
      // lens. `dolly` lets these two shots sit just outside the room's open
      // front — far enough back to see the whole floor, still too narrow to see
      // past a wall.
      roam: { pos: [0, 2.9, 11.5], look: [0, 0.1, -1.6], yaw: null, fov: 46, dolly: 4 },
      // Decorating is the one shot that must not follow Yuvi: the learner is
      // looking at the floor plan, not at the robot standing on the station.
      room: { pos: [-0.7, 5.2, 21], look: [-0.7, -1.05, -2], yaw: null, anchored: false, fov: 62, dolly: 6 },
    }
    // Yuvi spawns in the open floor in front of the two stations, never on one
    // of them — otherwise the studio would open straight into a panel and the
    // learner would never see that the room is walkable.
    const SPAWN: [number, number] = roam ? [0, 4.5] : [0, 0]
    // Roaming opens on the establishing shot. Starting on the portrait frame
    // and easing out meant every entrance began as a close-up of Yuvi's face.
    const openingShot = roam ? FRAMES.roam : FRAMES.full
    const camPos = new THREE.Vector3(openingShot.pos[0] + SPAWN[0], openingShot.pos[1], openingShot.pos[2] + SPAWN[1])
    const camLook = new THREE.Vector3(openingShot.look[0] + SPAWN[0], openingShot.look[1], openingShot.look[2] + SPAWN[1])
    const camPosTarget = camPos.clone()
    const camLookTarget = camLook.clone()
    camera.fov = openingShot.fov ?? BASE_FOV
    camera.updateProjectionMatrix()
    let yawTarget: number | null = 0
    // The active shot, kept as data so it can be re-anchored to Yuvi every
    // frame while he walks instead of being baked once into the target.
    let frameShot = openingShot
    let appliedRoomItems: RoomItem[] | undefined
    let appliedPlacing: YuviPlacing | null | undefined
    let appliedPlaceTarget: { x: number; z: number; radius: number; aim?: number } | null | undefined
    let appliedStations: RoomStations | null | undefined
    let appliedRoomStyle: { floor: RoomStyleId; wall: WallStyleId; mood: MoodId } | null | undefined

    // ── Free camera ──
    // The category frame is only a starting point: the learner's own orbit,
    // dolly and pan ride on top of it as signed offsets, so walking around the
    // bay never fights the automatic framing and picking a tab re-centres.
    let userYaw = 0, userPitch = 0, userZoom = 1
    let userPanX = 0, userPanY = 0, velYaw = 0
    const YAW_LIMIT = 1.15
    const resetUserView = () => {
      userYaw = 0; userPitch = 0; userZoom = 1
      userPanX = 0; userPanY = 0; velYaw = 0
    }
    const camOffset = new THREE.Vector3()
    const camRight = new THREE.Vector3()
    const camSpherical = new THREE.Spherical()

    // ── Roaming ──
    // The studio stops being a settings screen the moment the learner can walk
    // Yuvi anywhere in the room. Position lives in room-floor world XZ; the
    // camera frame rides along so the framing stays exactly as it was authored.
    const ROAM_SPEED = 3.4          // metres per second, a relaxed walk
    const BODY_RADIUS = 0.44        // how close Yuvi may get to a prop
    const DECK_RADIUS = 1.1         // inside this he is standing on the platform
    const DECK_LIFT = 0.13          // the platform is this much above the floor
    const roamPos = new THREE.Vector2(SPAWN[0], SPAWN[1])
    const roamTarget = new THREE.Vector2(SPAWN[0], SPAWN[1])
    const roamStep = new THREE.Vector2()
    const roamDir = new THREE.Vector3()
    const roamForward = new THREE.Vector3()
    const roamSide = new THREE.Vector3()
    let roamSpeed = 0               // eased 0..1, drives the gait
    let roamZone: LabRoomZoneId | null = null
    // Set when he has just stepped onto a station and still has to turn around.
    let faceLearnerPending = false
    let deckBlend = roam ? 0 : 1    // 1 = on the platform, 0 = on the floor
    const heldKeys = new Set<string>()

    // ── First person ──
    // Standing behind Yuvi's eyes is what turns the hall from a diorama into a
    // place. It is a blend rather than a switch, so the learner is never cut
    // between two cameras, and the body stays in the scene until the eyes have
    // arrived — which is also what keeps the shadow and the gait honest.
    const FP_EYE_HEIGHT = 1.7       // above his feet, level with the head frame
    const FP_TURN_SPEED = 2.3       // radians per second on the arrow keys
    const FP_FOV = 66               // a wide, standing-in-it lens
    let fpBlend = 0                 // 0 = the authored shot, 1 = his eyes
    let fpWasActive = false
    let fpYaw = 0
    let fpPitch = 0
    const fpEye = new THREE.Vector3()
    const fpLook = new THREE.Vector3()
    const camEye = new THREE.Vector3()
    const camAim = new THREE.Vector3()
    const walkLimits = roomBounds
      ? {
          minX: -roomBounds.halfX + 0.7, maxX: roomBounds.halfX - 0.7,
          minZ: roomBounds.backZ + 1.1, maxZ: roomBounds.frontZ - 3.2,
        }
      : { minX: -4, maxX: 4, minZ: -5.5, maxZ: 5.2 }

    /** Slide a candidate position out of every blocking footprint. */
    const resolveCollisions = (point: THREE.Vector2) => {
      const circles = room?.blockers() ?? []
      for (const circle of circles) {
        const dx = point.x - circle.x
        const dz = point.y - circle.z
        const minimum = circle.radius + BODY_RADIUS
        const distance = Math.hypot(dx, dz)
        if (distance >= minimum) continue
        if (distance < 1e-4) { point.x += minimum; continue }
        point.x = circle.x + (dx / distance) * minimum
        point.y = circle.z + (dz / distance) * minimum
      }
      point.x = THREE.MathUtils.clamp(point.x, walkLimits.minX, walkLimits.maxX)
      point.y = THREE.MathUtils.clamp(point.y, walkLimits.minZ, walkLimits.maxZ)
    }

    const walkTo = (x: number, z: number) => {
      roamTarget.set(x, z)
      resolveCollisions(roamTarget)
    }
    const recenter = () => walkTo(0, 0)

    // ── Floor picking ──
    // Both "walk here" and "drop the sofa here" are the same question: where
    // does the pointer meet the floor?
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(roomBounds?.floorY ?? -1.05))
    const floorHit = new THREE.Vector3()
    const pickFloor = (event: { clientX: number; clientY: number }): { x: number; z: number } | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      if (!raycaster.ray.intersectPlane(floorPlane, floorHit)) return null
      return { x: floorHit.x, z: floorHit.z }
    }

    /** Footprint of a prop as it is actually built, not as it is catalogued. */
    const propRadius = (kind: string) => (roomItemSpec(kind)?.radius ?? 0.5) * PROP_SCALE
    /** What a carried thing needs clear around it — a prop, or a whole station. */
    const carriedRadius = (placingNow: YuviPlacing) =>
      placingNow.station ? STATION_RADIUS[placingNow.station] : propRadius(placingNow.kind)

    /**
     * A spot is free when it is on the floor and no footprint reaches it. The
     * circles are hard: nothing in the room may ever intersect anything else.
     */
    const canBuildAt = (x: number, z: number, radius: number, station?: StationId, rot = 0) => {
      if (x < walkLimits.minX || x > walkLimits.maxX) return false
      if (z < walkLimits.minZ || z > walkLimits.maxZ) return false
      // While the walkthrough is pointing at a patch of floor, that patch is the
      // only legal answer — the ghost turns red everywhere else.
      const target = placeTargetRef.current
      if (target && Math.hypot(x - target.x, z - target.z) > target.radius) return false
      // The bench is only a valid spot if the floor in front of it — where the
      // learner has to stand to use it — is inside the room too.
      if (station === 'room') {
        const stand = roomStandingSpot({ x, z, rot })
        if (stand.x < walkLimits.minX || stand.x > walkLimits.maxX) return false
        if (stand.z < walkLimits.minZ || stand.z > walkLimits.maxZ) return false
      }
      for (const circle of room?.noBuildZones(station) ?? []) {
        if (Math.hypot(x - circle.x, z - circle.z) < circle.radius + radius) return false
      }
      for (const item of roomItemsRef.current ?? []) {
        if (Math.hypot(x - item.x, z - item.z) < propRadius(item.kind) + radius) return false
      }
      return true
    }

    if (orbit) {
      camera.position.copy(camPos)
      camera.lookAt(camLook)
    }

    const design: YuviDesign = {
      version: initialDesign.version,
      variant: initialDesign.variant,
      colors: { ...initialDesign.colors },
      equipped: { ...initialDesign.equipped },
    }

    // ── Materials (identical palette to the start-scene YuviRobot3D) ──
    // Yuvi 2.0: soft-ceramic shell with a real clearcoat and a whisper of
    // iridescence over a deep indigo inner core — no flat grey plastic.
    const CORE_COLOR = new THREE.Color(0x2b2560)
    const blueMat = new THREE.MeshPhysicalMaterial({
      color: 0xf1f2fb, roughness: 0.24, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.13,
      sheen: 0.55, sheenColor: new THREE.Color(0xb9a8ff), sheenRoughness: 0.55,
      iridescence: 0.22, iridescenceIOR: 1.35,
      envMapIntensity: 1.2,
    })
    const jointMat = new THREE.MeshPhysicalMaterial({ color: 0x2b2560, roughness: 0.34, metalness: 0.75, envMapIntensity: 1.15, clearcoat: 0.5, clearcoatRoughness: 0.28 })
    // Formerly plain white — now the dark inner suit the shell plates sit on.
    const whiteMat = new THREE.MeshPhysicalMaterial({ color: 0x342c6d, roughness: 0.4, metalness: 0.3, envMapIntensity: 1.05, clearcoat: 0.7, clearcoatRoughness: 0.24, sheen: 0.4, sheenColor: new THREE.Color(0x7c6bff) })
    const faceMat = new THREE.MeshPhysicalMaterial({ color: 0x07061a, roughness: 0.07, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.5 })
    const visorSheenMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.085, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })
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
    robot.add(armL, armR)

    // ── Head ──
    const head = new THREE.Group(); head.position.y = 1.59; head.scale.setScalar(0.9); robot.add(head)
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
    const earGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.12, 30)
    const earL = new THREE.Mesh(earGeo, blueMat); earL.rotation.z = Math.PI / 2; earL.position.set(-0.56, -0.02, 0.02); head.add(earL)
    const earR = earL.clone(); earR.position.x = 0.56; head.add(earR)
    const earCapL = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.017, 12, 30), earCapMat); earCapL.rotation.y = Math.PI / 2; earCapL.position.set(-0.625, -0.02, 0.02); head.add(earCapL)
    const earCapR = earCapL.clone(); earCapR.position.x = 0.625; head.add(earCapR)
    const earDiscL = new THREE.Mesh(new THREE.CircleGeometry(0.07, 26), faceMat); earDiscL.rotation.y = -Math.PI / 2; earDiscL.position.set(-0.622, -0.02, 0.02); head.add(earDiscL)
    const earDiscR = earDiscL.clone(); earDiscR.rotation.y = Math.PI / 2; earDiscR.position.x = 0.622; head.add(earDiscR)
    const nativeEarParts = [earL, earR, earCapL, earCapR, earDiscL, earDiscR]

    robot.position.y = -1.35

    // ── Anchors ──
    const anchors: Record<YuviSlot, THREE.Group> = {
      headTop: new THREE.Group(), face: new THREE.Group(), back: new THREE.Group(), handR: new THREE.Group(), body: new THREE.Group(),
    }
    anchors.headTop.position.set(0, 0, 0); head.add(anchors.headTop)
    anchors.face.position.set(0, -0.03, 0); head.add(anchors.face)
    anchors.back.position.set(0, 0.9, -0.22); robot.add(anchors.back)
    anchors.handR.position.set(0.058, -0.56, 0.12); armR.add(anchors.handR)
    anchors.body.position.set(0, 0.82, 0.04); robot.add(anchors.body)
    const variantGroup = new THREE.Group(); head.add(variantGroup)

    // ── equip / variant / colours ──
    const equippedObjects: Partial<Record<YuviSlot, THREE.Group>> = {}
    const popTargets: Array<{ obj: THREE.Group; t: number }> = []
    let transforming = false, transformT = 0
    const disposeGroup = (obj: THREE.Object3D) => obj.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose() })
    function playTransform(newObj?: THREE.Group) {
      transformSound()
      if (reduceMotion) return
      transforming = true; transformT = 0
      if (newObj) { newObj.scale.setScalar(0.001); popTargets.push({ obj: newObj, t: 0 }) }
    }
    function equip(slot: YuviSlot, id: string | null, animate = true) {
      const anchor = anchors[slot]
      if (equippedObjects[slot]) { anchor.remove(equippedObjects[slot]!); disposeGroup(equippedObjects[slot]!); delete equippedObjects[slot] }
      design.equipped[slot] = id
      const asset = id ? getAsset(id) : null
      if (slot === 'headTop') {
        antenna.visible = !id
        const showNativeEars = !asset?.hideEars
        nativeEarParts.forEach((part) => { part.visible = showNativeEars })
      }
      if (!asset) return
      const g = asset.build(); anchor.add(g); equippedObjects[slot] = g
      castShadows(g)
      if (animate) {
        playTransform(g)
        // Assembly beat: a ring of light and a puff of energy at the slot, so
        // an upgrade lands as an event instead of a silent swap.
        if (room) {
          anchor.updateWorldMatrix(true, false)
          room.burst(anchor.getWorldPosition(new THREE.Vector3()))
        }
      }
    }
    function setVariant(variant: YuviVariant, animate = true) {
      design.variant = variant
      while (variantGroup.children.length) { const c = variantGroup.children[0]; variantGroup.remove(c); disposeGroup(c) }
      if (variant === 'girl') { variantGroup.add(buildBlondeHair()); variantGroup.add(buildEyebrowsBundle()); if (animate) playTransform(variantGroup) }
    }
    function setColors(colors: YuviColors, animate = false) {
      design.colors = { ...colors }
      const b = new THREE.Color(colors.body)
      blueMat.color.copy(b)
      // Joints and the inner suit stay a deep indigo so the shell always reads
      // as a bright plate over a dark core, whatever colour the learner picks.
      jointMat.color.copy(b.clone().lerp(CORE_COLOR, 0.84))
      whiteMat.color.copy(CORE_COLOR.clone().lerp(b, 0.14))
      const g = new THREE.Color(colors.glow)
      blueMat.sheenColor.copy(g.clone().lerp(new THREE.Color(0xffffff), 0.45))
      ringMat.color.copy(g); ringMat.emissive.copy(g)
      earCapMat.color.copy(g); earCapMat.emissive.copy(g)
      antennaTipMat.color.copy(g); antennaTipMat.emissive.copy(g)
      haloGlowMat.color.copy(g)
      antennaLight.color.copy(g); faceGlow.color.copy(g)
      // The bay's LEDs, floor pool and reflection follow the learner's glow.
      room?.setAccent(colors.glow)
      faceLight.draw()
      if (animate) playTransform()
    }
    function applyDesign(next: YuviDesign, animate = false) {
      setColors(next.colors, false)
      setVariant(next.variant, animate)
      for (const slot of Object.keys(anchors) as YuviSlot[]) equip(slot, next.equipped[slot] ?? null, animate)
    }
    const focus = (view: YuviFocus) => {
      const frame = FRAMES[view] ?? FRAMES.full
      frameShot = frame
      const ax = frame.anchored === false ? 0 : roamPos.x
      const az = frame.anchored === false ? 0 : roamPos.y
      camPosTarget.set(frame.pos[0] + ax, frame.pos[1], frame.pos[2] + az)
      camLookTarget.set(frame.look[0] + ax, frame.look[1], frame.look[2] + az)
      yawTarget = frame.yaw
      // Choosing a category is a request for that exact shot.
      resetUserView()
    }
    controllerRef.current = { equip, setColors, setVariant, applyDesign, focus, walkTo, recenter }
    applyDesign(design, false)
    castShadows(robot)

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
    const badgeWorld = new THREE.Vector3()
    const badgeNormal = new THREE.Vector3()
    const camForward = new THREE.Vector3()
    /**
     * The badge mesh is ~0.3 world units, which in the companion dock is barely
     * a dozen pixels — learners had to hit the logo dead on. So the geometry
     * raycast is only the first try: if it misses, accept anything inside a
     * generous disc around the badge's projected centre, floored at a
     * finger-sized radius. The facing test keeps the chest button from being
     * clickable through Yuvi's back.
     */
    const hitsBadge = (event: { clientX: number; clientY: number }) => {
      const rect = renderer.domElement.getBoundingClientRect()
      if (!rect.width || !rect.height) return false
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      if (raycaster.intersectObject(badgeHit, false).length > 0) return true
      badgeHit.getWorldDirection(badgeNormal)
      camera.getWorldDirection(camForward)
      if (badgeNormal.dot(camForward) > -0.15) return false
      badgeHit.getWorldPosition(badgeWorld).project(camera)
      if (badgeWorld.z > 1) return false
      const bx = rect.left + ((badgeWorld.x + 1) / 2) * rect.width
      const by = rect.top + ((1 - badgeWorld.y) / 2) * rect.height
      const radius = Math.max(28, Math.min(rect.width, rect.height) * 0.16)
      return Math.hypot(event.clientX - bx, event.clientY - by) <= radius
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!interactiveY) return
      hoveredY = hitsBadge(event)
      renderer.domElement.style.cursor = hoveredY || Boolean(onAvatarClickRef.current) ? 'pointer' : 'default'
    }
    const onPointerLeave = () => {
      hoveredY = false
      renderer.domElement.style.cursor = onAvatarClickRef.current ? 'pointer' : 'default'
    }
    // Re-test on the click itself: a touch tap never sends the hover move that
    // would have set `hoveredY`, so relying on it dropped every tap on mobile.
    const onClick = (event: MouseEvent) => {
      if (interactiveY && hitsBadge(event)) onYClickRef.current?.(container)
      else onAvatarClickRef.current?.()
    }
    if (interactiveY || onAvatarClickRef.current) {
      renderer.domElement.style.cursor = 'pointer'
      renderer.domElement.addEventListener('pointermove', onPointerMove)
      renderer.domElement.addEventListener('pointerleave', onPointerLeave)
      renderer.domElement.addEventListener('click', onClick)
    }

    // ── Free camera input (studio) ──
    // Drag to walk around the bay, wheel to move in and out, right/middle drag
    // (or shift-drag) to slide the framing, double click to go back to the shot.
    let dragging: 'orbit' | 'pan' | null = null
    let lastX = 0, lastY = 0
    let robotYaw = 0
    // A tap is an orbit drag that never went anywhere — that is what tells
    // "look around" apart from "walk over there". A finger is shakier than a
    // mouse, so the same intent has to survive a wider wobble.
    let pressX = 0, pressY = 0, pressAt = 0
    const TAP_SLOP_MOUSE = 6
    const TAP_SLOP_TOUCH = 12
    let tapSlop = TAP_SLOP_MOUSE

    // ── Touch ──
    // The room is furniture you pick up, turn and put down, and until now every
    // one of those verbs was a mouse verb: the prop menu was right-click only,
    // zoom was the wheel, panning was a right-drag. On the tablets classrooms
    // actually own, half the studio simply did not exist.
    const livePointers = new Map<number, { x: number; y: number }>()
    let pinchDistance = 0
    let pinchX = 0, pinchY = 0
    // Set once a gesture has become something other than a tap, so the release
    // does not also walk Yuvi across the room or drop a sofa.
    let gestureConsumed = false
    let holdTimer = 0
    const HOLD_MS = 500
    const cancelHold = () => {
      if (holdTimer) { window.clearTimeout(holdTimer); holdTimer = 0 }
    }
    const pinchCentre = () => {
      const [a, b] = [...livePointers.values()]
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }
    }

    /** The prop (or station) under a screen point, opened as its own menu. */
    const openMenuAt = (clientX: number, clientY: number) => {
      const report = onItemMenuRef.current
      if (!report || !room) return false
      const rect = renderer.domElement.getBoundingClientRect()
      if (!rect.width || !rect.height) return false
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const uid = room.pickItem(raycaster)
      const station = uid ? null : room.pickStation(raycaster)
      if (!uid && !station) { report(null); return false }
      const anchor = uid ? room.itemAnchor(uid) : room.stationAnchor(station!)
      if (!anchor) { report(null); return false }
      anchor.project(camera)
      report({
        uid: uid ?? `station:${station}`,
        x: rect.left + ((anchor.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - anchor.y) / 2) * rect.height,
      })
      return true
    }

    const onOrbitDown = (event: PointerEvent) => {
      const touch = event.pointerType === 'touch'
      tapSlop = touch ? TAP_SLOP_TOUCH : TAP_SLOP_MOUSE
      if (touch) {
        livePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (livePointers.size === 2) {
          // A second finger turns the gesture into pinch/pan, so whatever the
          // first one had started is abandoned rather than finished.
          cancelHold()
          dragging = null
          gestureConsumed = true
          const centre = pinchCentre()
          pinchDistance = centre.d; pinchX = centre.x; pinchY = centre.y
          return
        }
        if (livePointers.size > 2) return
      }
      dragging = event.button === 0 && !event.shiftKey ? 'orbit' : 'pan'
      lastX = event.clientX; lastY = event.clientY; velYaw = 0
      pressX = event.clientX; pressY = event.clientY; pressAt = performance.now()
      gestureConsumed = false
      renderer.domElement.style.cursor = dragging === 'pan' ? 'move' : 'grabbing'
      // Any camera move pulls the ground out from under an anchored prop menu.
      if (event.button === 0) onItemMenuRef.current?.(null)
      // Press and hold is the finger's right-click.
      if (touch) {
        cancelHold()
        holdTimer = window.setTimeout(() => {
          holdTimer = 0
          if (openMenuAt(pressX, pressY)) { dragging = null; gestureConsumed = true }
        }, HOLD_MS)
      }
    }
    const onOrbitMove = (event: PointerEvent) => {
      if (livePointers.has(event.pointerId)) {
        livePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (livePointers.size === 2) {
          const centre = pinchCentre()
          if (pinchDistance > 0) {
            userZoom = THREE.MathUtils.clamp(userZoom * (pinchDistance / centre.d), 0.42, 1.85)
            // Two fingers sliding together is the only pan a tablet has.
            userPanX = THREE.MathUtils.clamp(userPanX - (centre.x - pinchX) * 0.006, -1.6, 1.6)
            userPanY = THREE.MathUtils.clamp(userPanY + (centre.y - pinchY) * 0.006, -1.1, 1.1)
          }
          pinchDistance = centre.d; pinchX = centre.x; pinchY = centre.y
          return
        }
      }
      if (holdTimer && Math.hypot(event.clientX - pressX, event.clientY - pressY) > tapSlop) cancelHold()
      if (!dragging) return
      const dx = event.clientX - lastX, dy = event.clientY - lastY
      lastX = event.clientX; lastY = event.clientY
      if (firstPersonRef.current && dragging === 'orbit') {
        // Inside his head the drag is the neck, not an orbit around him.
        fpYaw += dx * 0.005
        fpPitch = THREE.MathUtils.clamp(fpPitch - dy * 0.004, -0.55, 0.55)
        return
      }
      if (dragging === 'pan') {
        userPanX = THREE.MathUtils.clamp(userPanX - dx * 0.006, -1.6, 1.6)
        userPanY = THREE.MathUtils.clamp(userPanY + dy * 0.006, -1.1, 1.1)
      } else {
        userYaw = THREE.MathUtils.clamp(userYaw - dx * 0.007, -YAW_LIMIT, YAW_LIMIT)
        userPitch = THREE.MathUtils.clamp(userPitch + dy * 0.004, -0.5, 0.62)
        velYaw = -dx * 0.007
      }
    }
    const onOrbitUp = (event: PointerEvent) => {
      cancelHold()
      livePointers.delete(event.pointerId)
      if (livePointers.size < 2) pinchDistance = 0
      const wasOrbit = dragging === 'orbit'
      const consumed = gestureConsumed
      dragging = null
      gestureConsumed = false
      renderer.domElement.style.cursor = 'grab'
      if (consumed || !wasOrbit || !roamRef.current) return
      // In first person the arrows are the whole vocabulary: a tap on the floor
      // would teleport the eyes the learner is looking through.
      if (firstPersonRef.current) return
      const travelled = Math.hypot(event.clientX - pressX, event.clientY - pressY)
      if (travelled > tapSlop || performance.now() - pressAt > 500) return
      const spot = pickFloor(event)
      if (!spot) return
      const placingNow = placingRef.current
      if (placingNow) {
        const valid = canBuildAt(spot.x, spot.z, carriedRadius(placingNow), placingNow.station, placingNow.rot ?? 0)
        onPlaceAtRef.current?.(spot.x, spot.z, valid)
      } else if (!lockRoamRef.current) {
        walkTo(spot.x, spot.z)
      }
    }
    // A browser that decides the gesture was really a scroll takes the pointer
    // with it and never sends the release, stranding `dragging` mid-drag.
    const onPointerCancel = (event: PointerEvent) => {
      cancelHold()
      livePointers.delete(event.pointerId)
      if (livePointers.size < 2) pinchDistance = 0
      dragging = null
      gestureConsumed = false
      renderer.domElement.style.cursor = 'grab'
    }
    // Right-click a placed prop for its own menu, Sims-style. The browser menu
    // is always suppressed over the bay — right-drag is how you pan.
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > TAP_SLOP_MOUSE) return
      openMenuAt(event.clientX, event.clientY)
    }
    // While a prop is on the cursor, the room shows exactly where it will land.
    let lastPointerAt: { clientX: number; clientY: number } | null = null
    const updateGhost = (event: { clientX: number; clientY: number }) => {
      const placingNow = placingRef.current
      if (!room) return
      if (!placingNow) { room.setGhost(null); return }
      const spot = pickFloor(event)
      if (!spot) return
      const valid = canBuildAt(spot.x, spot.z, carriedRadius(placingNow), placingNow.station, placingNow.rot ?? 0)
      room.setGhost(placingNow.kind, spot.x, spot.z, placingNow.rot ?? 0, valid, placingNow.tint)
    }
    const onGhostMove = (event: PointerEvent) => {
      lastPointerAt = { clientX: event.clientX, clientY: event.clientY }
      updateGhost(event)
    }
    // Layout-independent codes, so the keys work on a Hebrew keyboard too.
    const KEY_MAP: Record<string, string> = {
      KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    }
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el?.tagName) return false
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
    }
    const onRoamKeyDown = (event: KeyboardEvent) => {
      if (!roamRef.current || lockRoamRef.current || isTypingTarget(event.target)) return
      const key = KEY_MAP[event.code]
      if (!key) return
      event.preventDefault()   // the stage fills the screen; the page must not scroll
      heldKeys.add(key)
    }
    const onRoamKeyUp = (event: KeyboardEvent) => {
      const key = KEY_MAP[event.code]
      if (key) heldKeys.delete(key)
    }
    const onRoamBlur = () => heldKeys.clear()
    const onOrbitWheel = (event: WheelEvent) => {
      // The canvas fills the stage, so the page must not scroll underneath it.
      event.preventDefault()
      userZoom = THREE.MathUtils.clamp(userZoom * Math.exp(event.deltaY * 0.0011), 0.42, 1.85)
      onItemMenuRef.current?.(null)
    }
    const onOrbitReset = () => resetUserView()
    if (orbit) {
      renderer.domElement.style.cursor = 'grab'
      // Only the studio claims the browser's gestures. Every other Yuvi is a
      // small canvas sitting in a page the learner still has to be able to
      // scroll past.
      renderer.domElement.style.touchAction = 'none'
      renderer.domElement.addEventListener('pointerdown', onOrbitDown)
      renderer.domElement.addEventListener('wheel', onOrbitWheel, { passive: false })
      renderer.domElement.addEventListener('dblclick', onOrbitReset)
      renderer.domElement.addEventListener('contextmenu', onContextMenu)
      renderer.domElement.addEventListener('pointermove', onGhostMove, { passive: true })
      window.addEventListener('pointermove', onOrbitMove)
      window.addEventListener('pointerup', onOrbitUp)
      window.addEventListener('pointercancel', onPointerCancel)
      window.addEventListener('keydown', onRoamKeyDown)
      window.addEventListener('keyup', onRoamKeyUp)
      window.addEventListener('blur', onRoamBlur)
    }

    // ── Camera parallax ──
    // The room leans a little with the pointer and keeps a slow drift of its
    // own, so the space feels inhabited even when nothing is being edited.
    let parallaxTargetX = 0, parallaxTargetY = 0
    let parallaxX = 0, parallaxY = 0
    const onParallaxMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      parallaxTargetX = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1)
      parallaxTargetY = THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1)
    }
    if (orbit && !reduceMotion) window.addEventListener('pointermove', onParallaxMove, { passive: true })

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
        // The learner's room is data: re-sync only when the layout identity
        // changes, so dragging a sofa costs a transform and nothing else.
        if (room) {
          if (roomItemsRef.current !== appliedRoomItems) {
            appliedRoomItems = roomItemsRef.current
            room.setUserItems(appliedRoomItems ?? [])
          }
          // A station takes whoever is standing at it along for the ride, so
          // moving the one you are using never closes the panel under you.
          if (stationsRef.current && stationsRef.current !== appliedStations) {
            const previous = appliedStations
            const next = stationsRef.current
            let shiftX = 0, shiftZ = 0
            if (previous && roamZone) {
              const from = roamZone === 'avatar' ? previous.avatar : roomStandingSpot(previous.room)
              const to = roamZone === 'avatar' ? next.avatar : roomStandingSpot(next.room)
              shiftX = to.x - from.x
              shiftZ = to.z - from.z
            }
            appliedStations = next
            room.setStations(next)
            if (shiftX || shiftZ) {
              roamPos.set(roamPos.x + shiftX, roamPos.y + shiftZ)
              resolveCollisions(roamPos)
              roamTarget.copy(roamPos)
            }
          }
          if (roomStyleRef.current !== appliedRoomStyle) {
            appliedRoomStyle = roomStyleRef.current
            if (appliedRoomStyle) room.setRoomStyle(appliedRoomStyle)
          }
          // The ghost belongs to what is being carried, not to pointer movement:
          // dropping a prop has to take the hologram with it even if the mouse
          // never moves again.
          if (placingRef.current !== appliedPlacing) {
            appliedPlacing = placingRef.current
            if (!appliedPlacing) room.setGhost(null)
            else if (lastPointerAt) updateGhost(lastPointerAt)
          }
          if (placeTargetRef.current !== appliedPlaceTarget) {
            appliedPlaceTarget = placeTargetRef.current
            room.setTarget(appliedPlaceTarget ?? null)
            // The lit patch changes what counts as a legal drop, so the ghost
            // has to re-answer even though the pointer has not moved.
            if (placingRef.current && lastPointerAt) updateGhost(lastPointerAt)
          }
        }
        // ── Roaming ──
        // Keyboard drives Yuvi directly and cancels any click target; a click
        // sends him walking there on his own.
        const roaming = roamRef.current
        let walkAmp = 0
        // First person only survives while the learner is actually free to
        // walk: opening a station panel hands the camera back to the shot.
        const fpActive = Boolean(roaming && firstPersonRef.current && !lockRoamRef.current)
        if (fpActive && !fpWasActive) {
          // Take over the aim the learner already had, not the body's facing:
          // Yuvi stands turned toward the lens, so his yaw would drop them into
          // the room looking back out of it.
          roamDir.copy(camAim).sub(camEye)
          fpYaw = roamDir.lengthSq() > 1e-6 ? Math.atan2(roamDir.x, roamDir.z) : robotYaw
          fpPitch = 0
        }
        fpWasActive = fpActive
        fpBlend += ((fpActive ? 1 : 0) - fpBlend) * 0.12
        if (roaming) {
          if (lockRoamRef.current) heldKeys.clear()
          roamDir.set(0, 0, 0)
          if (fpActive) {
            // Arrows alone: up/down walk along the gaze, left/right turn it.
            const turn = (heldKeys.has('left') ? 1 : 0) - (heldKeys.has('right') ? 1 : 0)
            if (turn) fpYaw += turn * FP_TURN_SPEED * dt
            roamForward.set(Math.sin(fpYaw), 0, Math.cos(fpYaw))
            if (heldKeys.has('up')) roamDir.add(roamForward)
            if (heldKeys.has('down')) roamDir.sub(roamForward)
          } else {
            roamForward.copy(camOffset).setY(0)
            if (roamForward.lengthSq() < 1e-6) roamForward.set(0, 0, 1)
            roamForward.normalize().negate()               // from the eye toward the room
            roamSide.set(-roamForward.z, 0, roamForward.x) // screen-right on the floor
            if (heldKeys.has('up')) roamDir.add(roamForward)
            if (heldKeys.has('down')) roamDir.sub(roamForward)
            if (heldKeys.has('right')) roamDir.add(roamSide)
            if (heldKeys.has('left')) roamDir.sub(roamSide)
          }
          if (roamDir.lengthSq() > 1e-6) {
            roamDir.normalize()
            roamTarget.copy(roamPos)                     // keys win over the last click
            roamStep.set(roamDir.x, roamDir.z).multiplyScalar(ROAM_SPEED * dt)
          } else {
            roamStep.set(roamTarget.x - roamPos.x, roamTarget.y - roamPos.y)
            const remaining = roamStep.length()
            if (remaining > 0.05) roamStep.multiplyScalar(Math.min(ROAM_SPEED * dt, remaining) / remaining)
            else roamStep.set(0, 0)
          }
          const moving = roamStep.lengthSq() > 1e-8
          if (moving) {
            roamPos.add(roamStep)
            resolveCollisions(roamPos)
            // Face where he is actually going, not where he was asked to go.
            yawTarget = Math.atan2(roamStep.x, roamStep.y)
          }
          // In first person the body follows the gaze, so walking backwards
          // does not spin the camera the learner is looking through.
          if (fpActive) yawTarget = fpYaw
          roamSpeed += ((moving ? 1 : 0) - roamSpeed) * 0.18
          walkAmp = reduceMotion ? roamSpeed * 0.18 : roamSpeed * 0.5

          // Standing on a station is what opens its panel — no menu needed.
          let nextZone: LabRoomZoneId | null = null
          for (const zone of room?.zones ?? []) {
            if (Math.hypot(roamPos.x - zone.x, roamPos.y - zone.z) <= zone.radius) { nextZone = zone.id; break }
          }
          if (nextZone !== roamZone) {
            roamZone = nextZone
            room?.setZoneHighlight(nextZone)
            onZoneChangeRef.current?.(nextZone)
            if (nextZone) {
              // Arriving at a station means standing *on* it: he walks the rest
              // of the way to the middle instead of stopping wherever he
              // happened to cross the ring.
              const zone = room?.zones.find((entry) => entry.id === nextZone)
              if (zone) { heldKeys.clear(); walkTo(zone.x, zone.z) }
            }
            faceLearnerPending = Boolean(nextZone)
          }
          // Once he is parked, he turns to the learner — the walk itself keeps
          // overwriting the yaw with whatever direction he was heading in.
          if (faceLearnerPending && !moving) {
            yawTarget = frameShot.yaw ?? 0
            faceLearnerPending = false
          }
          // Off the platform he stands 13cm lower, and the shadow light follows.
          const deckAt = appliedStations?.avatar
          const onDeck = Math.hypot(roamPos.x - (deckAt?.x ?? 0), roamPos.y - (deckAt?.z ?? 0)) < DECK_RADIUS ? 1 : 0
          deckBlend += (onDeck - deckBlend) * 0.12
          if (room && roomBounds) {
            room.keyLight.position.set(roamPos.x + 0.5, roomBounds.ceilY - 0.35, roamPos.y + 2.3)
            room.keyLight.target.position.set(roamPos.x, room.deckY + 0.7, roamPos.y)
            room.keyLight.target.updateMatrixWorld()
          }
        }

        // Yuvi still turns on his own axis for the category framing — that is
        // how "back" shows his back without sending the camera through a wall.
        if (yawTarget !== null) {
          // Shortest path so "back" never spins the long way around.
          let delta = (yawTarget - robotYaw) % (Math.PI * 2)
          if (delta > Math.PI) delta -= Math.PI * 2
          if (delta < -Math.PI) delta += Math.PI * 2
          robotYaw += delta * (roamSpeed > 0.1 ? 0.16 : 0.09)
          if (Math.abs(delta) < 0.002) { robotYaw = yawTarget; yawTarget = null }
        }
        // Flick inertia on the free look.
        if (!dragging && Math.abs(velYaw) > 0.00004) {
          velYaw *= 0.9
          userYaw = THREE.MathUtils.clamp(userYaw + velYaw, -YAW_LIMIT, YAW_LIMIT)
        }
        // The authored frame is relative to wherever Yuvi is standing, unless
        // the shot is a fixed overview of the room itself.
        const anchorX = frameShot.anchored === false ? 0 : roamPos.x
        const anchorZ = frameShot.anchored === false ? 0 : roamPos.y
        camPosTarget.set(frameShot.pos[0] + anchorX, frameShot.pos[1], frameShot.pos[2] + anchorZ)
        camLookTarget.set(frameShot.look[0] + anchorX, frameShot.look[1], frameShot.look[2] + anchorZ)
        camPos.lerp(camPosTarget, 0.075)
        camLook.lerp(camLookTarget, 0.075)
        // Each shot carries its own lens: the close-ups stay portrait-length,
        // the room overview opens up so the whole floor fits on screen, and
        // first person opens up further still so the hall reads as walkable.
        const wantFov = THREE.MathUtils.lerp(frameShot.fov ?? BASE_FOV, FP_FOV, fpBlend)
        if (Math.abs(camera.fov - wantFov) > 0.01) {
          camera.fov += (wantFov - camera.fov) * 0.09
          camera.updateProjectionMatrix()
        }

        // The framed shot becomes an orbit around the framed target, and the
        // learner's yaw / pitch / dolly ride on top of it.
        camOffset.copy(camPos).sub(camLook)
        camSpherical.setFromVector3(camOffset)
        camSpherical.theta += userYaw
        camSpherical.phi = THREE.MathUtils.clamp(camSpherical.phi - userPitch, 0.45, 1.98)
        camSpherical.radius = Math.max(0.95, camSpherical.radius * userZoom)
        camOffset.setFromSpherical(camSpherical)
        // Pan slides eye and target together along the camera's own right axis.
        camRight.set(camOffset.z, 0, -camOffset.x).normalize().multiplyScalar(userPanX)
        // Pointer lean plus a slow idle sway; both are tiny on purpose, they
        // should register as "the room is alive", never as camera shake. While
        // the learner is driving, the sway gets out of the way.
        const idleX = reduceMotion ? 0 : Math.sin(t * 0.21) * 0.13
        const idleY = reduceMotion ? 0 : Math.sin(t * 0.17 + 1.1) * 0.06
        const leanScale = dragging ? 0 : 1
        parallaxX += ((parallaxTargetX * 0.22 + idleX) * leanScale - parallaxX) * 0.045
        parallaxY += ((parallaxTargetY * 0.12 + idleY) * leanScale - parallaxY) * 0.045
        const lookX = camLook.x + camRight.x
        const lookY = camLook.y + userPanY
        const lookZ = camLook.z + camRight.z
        camEye.set(lookX + camOffset.x + parallaxX, lookY + camOffset.y - parallaxY, lookZ + camOffset.z)
        camAim.set(lookX + parallaxX * 0.22, lookY - parallaxY * 0.12, lookZ)

        // On the platform he hovers; on the floor he walks, bobbing on each step.
        const walkPhase = t * 9
        const walkStride = Math.sin(walkPhase)
        const groundY = -0.82 - (1 - deckBlend) * DECK_LIFT
        const bodyY = groundY
          + Math.sin(t * 1.4) * 0.02 * (1 - roamSpeed)
          + Math.abs(walkStride) * 0.03 * roamSpeed

        // Blend into first person. The eye target is pushed out to the same
        // distance as the orbit target so the hand-over reads as a turn of the
        // head rather than a lens snapping between two subjects.
        if (fpBlend > 0.001) {
          fpEye.set(roamPos.x, bodyY + FP_EYE_HEIGHT, roamPos.y)
          const reach = Math.max(1, camEye.distanceTo(camAim))
          const cosPitch = Math.cos(fpPitch)
          fpLook.set(
            fpEye.x + Math.sin(fpYaw) * cosPitch * reach,
            fpEye.y + Math.sin(fpPitch) * reach,
            fpEye.z + Math.cos(fpYaw) * cosPitch * reach,
          )
          camEye.lerp(fpEye, fpBlend)
          camAim.lerp(fpLook, fpBlend)
        }
        camera.position.copy(camEye)
        if (roomBounds) {
          // Never let a free camera poke through the room it is standing in.
          camera.position.x = THREE.MathUtils.clamp(camera.position.x, -roomBounds.halfX + 0.55, roomBounds.halfX - 0.55)
          camera.position.y = THREE.MathUtils.clamp(camera.position.y, roomBounds.floorY + 0.4, roomBounds.ceilY - 0.4)
          camera.position.z = THREE.MathUtils.clamp(camera.position.z, roomBounds.backZ + 0.8, roomBounds.frontZ + (frameShot.dolly ?? -0.5))
        }
        camera.lookAt(camAim)
        // Once the eyes have arrived, the body he is looking out of would only
        // fill the lens with the inside of his own head.
        robot.visible = fpBlend < 0.72
        robot.rotation.y = robotYaw
        robot.position.x = roamPos.x
        robot.position.z = roamPos.y
        robot.position.y = bodyY
        robot.rotation.x = 0.06 * roamSpeed
        head.rotation.y = 0
        head.rotation.x = 0
        // Arms and legs swing in anti-phase — the difference between "walking"
        // and "sliding across the floor".
        const gaitEase = 0.24
        const armSwing = walkAmp * 0.7
        armR.rotation.x += (-walkStride * armSwing - armR.rotation.x) * gaitEase
        armL.rotation.x += (walkStride * armSwing - armL.rotation.x) * gaitEase
        legR.rotation.x += (-walkStride * walkAmp - legR.rotation.x) * gaitEase
        legL.rotation.x += (walkStride * walkAmp - legL.rotation.x) * gaitEase
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
      // The halo precesses slowly and breathes with the glow pulse.
      if (!reduceMotion) {
        antenna.rotation.y += dt * 0.5
        antenna.rotation.z = Math.sin(t * 0.9) * 0.12
        antenna.position.y = 0.6 + Math.sin(t * 1.6) * 0.014
      }
      haloGlowMat.opacity = 0.16 + Math.sin(t * 2.2) * 0.05
      earCapMat.emissiveIntensity = 0.4 + Math.sin(t * 2.0) * 0.16
      ringMat.emissiveIntensity = 1.6 + Math.sin(t * 2.4) * 0.4
      faceGlow.intensity = 0.24 + Math.sin(t * 1.8) * 0.05

      // Accessory motion: every asset exposes its own `userData.animate(t, dt)`.
      if (!reduceMotion) {
        for (const key of Object.keys(equippedObjects)) {
          const anim = (equippedObjects as any)[key]?.userData?.animate
          if (anim) anim(t, dt)
        }
      }
      room?.update(t, dt)
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
      void audioCtx?.close()
      cancelAnimationFrame(frame)
      cancelHold()
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
      renderer.domElement.removeEventListener('wheel', onOrbitWheel)
      renderer.domElement.removeEventListener('dblclick', onOrbitReset)
      renderer.domElement.removeEventListener('contextmenu', onContextMenu)
      renderer.domElement.removeEventListener('pointermove', onGhostMove)
      window.removeEventListener('pointermove', onOrbitMove)
      window.removeEventListener('pointerup', onOrbitUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onRoamKeyDown)
      window.removeEventListener('keyup', onRoamKeyUp)
      window.removeEventListener('blur', onRoamBlur)
      window.removeEventListener('pointermove', onParallaxMove)
      window.removeEventListener('pointermove', onGlobalPointerMove)
      window.removeEventListener('blur', resetPointerLook)
      document.documentElement.removeEventListener('mouseleave', resetPointerLook)
      controllerRef.current = null
      faceLight.texture.dispose()
      room?.dispose()
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
      // `dispose()` frees three's own caches but leaves the live WebGL context
      // attached to the (now detached) canvas until GC gets around to it. Every
      // studio open/close would therefore strand another context, and browsers
      // cap them at ~16 — past that the *oldest* context is killed, which is the
      // companion dock's Yuvi on the dashboard. Hand the context back by hand.
      renderer.forceContextLoss()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="Yuvi-avatar-canvas" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <img className="Yuvi-avatar-canvas__fallback" src="/shared/yubi-robot.png" alt="" aria-hidden="true" />
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
        <div ref={tooltipRef} className="Yuvi-y-tooltip" style={{ display: 'none' }}>{yTooltip}</div>
      )}
    </div>
  )
})
