// @ts-nocheck
/* eslint-disable */
/**
 * "מפת הפעלנות שלי" — the activeness world.
 *
 * A crafted 3D diorama: one floating island per 720 activeness domain, each
 * carrying a metaphor object, all tied by glowing light-paths to a glass podium
 * where the learner's companion stands. Every visual state comes from the real
 * competency values in the learning brain — nothing here is invented, and no
 * numeric score is ever shown to the learner.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { DashboardDTO } from '../../services/brain'
import { createActivenessGoal } from '../../services/brain'
import { useBrain } from '../../providers/BrainProvider'
import { updateLearnerState } from '../../services/api'
import { getWallet } from '../../services/rewards'
import {
  buildAmbientDust,
  buildBackdropIslands,
  buildIsland,
  buildLightPath,
  buildMascot,
  buildMetaphor,
  buildPodium,
  type IslandVariant,
} from './world/props'
import { disposeTextureCache, skyTexture } from './world/textures'
import './world/activeness-world.css'

type Competency = DashboardDTO['competencies'][number]
type Tone = 'strong' | 'steady' | 'support'
type RailKey = 'focus' | 'goals' | 'progress' | 'insights'

interface ActivenessWorld3DProps {
  competencies: Competency[]
  studentName: string
  /** Persisted arrangement + focus + goal (from learner state). */
  initial?: { positions?: Record<string, number>; focus?: string | null; goal?: any } | null
  onClose: () => void
}

/** The seven 720 activeness domains and how each is read from real competencies. */
const DOMAINS: { key: string; metaphor: string; color: string; icon: string; source: string }[] = [
  { key: 'persistence', metaphor: 'tree', color: '#8a6cff', icon: 'leaf', source: 'growth_mindset' },
  { key: 'autonomy', metaphor: 'telescope', color: '#38a1f0', icon: 'search', source: 'initiative_responsibility' },
  { key: 'initiative', metaphor: 'sprout', color: '#25b483', icon: 'spark', source: 'motivation_relevance' },
  { key: 'collaboration', metaphor: 'orbit', color: '#e59a3c', icon: 'orbit', source: 'support_emotional' },
  { key: 'learning_management', metaphor: 'book', color: '#5566e0', icon: 'book', source: 'self_regulation' },
  { key: 'reflection', metaphor: 'gem', color: '#c56ad6', icon: 'reflect', source: 'self_awareness' },
  { key: 'decision_making', metaphor: 'compass', color: '#7f8bff', icon: 'compass', source: 'avg:self_regulation,self_awareness' },
]

/**
 * Island slots, ordered back → front. The strongest domain lands at the back
 * centre (visually the top of the frame, largest and highest), so the learner
 * reads their own headline strength first.
 */
const SLOTS: { angle: number; y: number; scale: number }[] = [
  { angle: -Math.PI / 2, y: 1.15, scale: 1.24 },
  { angle: -Math.PI / 2 - 0.78, y: 0.62, scale: 1.02 },
  { angle: -Math.PI / 2 + 0.78, y: 0.62, scale: 1.02 },
  { angle: Math.PI, y: 0.06, scale: 0.98 },
  { angle: 0, y: 0.06, scale: 0.98 },
  { angle: Math.PI / 2 + 0.62, y: -0.5, scale: 0.9 },
  { angle: Math.PI / 2 - 0.62, y: -0.5, scale: 0.9 },
]
const RX = 6.05
const RZ = 4.05

function toneFor(value: number): Tone {
  if (value >= 70) return 'strong'
  if (value >= 45) return 'steady'
  return 'support'
}

function valueFor(source: string, byKey: Record<string, number>): number {
  if (source.startsWith('avg:')) {
    const keys = source.slice(4).split(',')
    const vals = keys.map((k) => byKey[k]).filter((v) => typeof v === 'number')
    if (!vals.length) return 55
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
  }
  return typeof byKey[source] === 'number' ? byKey[source] : 55
}

const VARIANT: Record<Tone, IslandVariant> = { strong: 'lush', steady: 'growing', support: 'dormant' }

/** How a domain is described to the learner — words only, never a score. */
type Status = 'core' | 'expressed' | 'onway' | 'notyet'
const STATUS_KEY: Record<Status, string> = {
  core: 'actmap.status.strong',
  expressed: 'actmap.state.expressed',
  onway: 'actmap.state.onway',
  notyet: 'actmap.state.notyet',
}
const STATUS_ICON: Record<Status, string> = { core: 'spark', expressed: 'check', onway: 'clock', notyet: 'lock' }

export function ActivenessWorld3D({ competencies, studentName, initial, onClose }: ActivenessWorld3DProps) {
  const { t, direction } = useI18n()
  const { learnerId } = useBrain()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const mountRef = useRef<HTMLDivElement | null>(null)
  const tagRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const captionRef = useRef<HTMLDivElement | null>(null)
  const sceneApi = useRef<any>(null)

  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  /* ── real data → domain model ───────────────────────────────────────── */

  const domains = useMemo(() => {
    const byKey: Record<string, number> = {}
    for (const c of competencies) byKey[c.key] = c.value
    return DOMAINS.map((d) => {
      const value = valueFor(d.source, byKey)
      return { ...d, value, tone: toneFor(value), level: Math.max(0, Math.min(1, value / 100)) }
    })
  }, [competencies])

  const heroKey = useMemo(
    () => domains.reduce((a, b) => (b.level > a.level ? b : a), domains[0])?.key ?? null,
    [domains],
  )

  /** Slot per domain: honour a saved arrangement, otherwise strongest → back. */
  const slotByKey = useMemo(() => {
    const saved = initial?.positions
    const valid = saved && DOMAINS.every((d) => typeof saved[d.key] === 'number')
    if (valid) return saved as Record<string, number>
    const ranked = [...domains].sort((a, b) => b.level - a.level)
    const map: Record<string, number> = {}
    ranked.forEach((d, i) => { map[d.key] = i })
    return map
  }, [domains, initial])

  const statusByKey = useMemo(() => {
    const map: Record<string, Status> = {}
    for (const d of domains) {
      map[d.key] = d.key === heroKey ? 'core' : d.tone === 'strong' ? 'expressed' : d.tone === 'steady' ? 'onway' : 'notyet'
    }
    return map
  }, [domains, heroKey])

  const expressedShare = useMemo(() => {
    const done = domains.filter((d) => d.tone !== 'support').length
    return domains.length ? done / domains.length : 0
  }, [domains])

  const signature = useMemo(
    () => domains.map((d) => `${d.key}:${d.value}:${slotByKey[d.key]}`).join('|'),
    [domains, slotByKey],
  )

  /* ── UI state ───────────────────────────────────────────────────────── */

  const [selected, setSelected] = useState<string | null>(null)
  const [myFocus, setMyFocus] = useState<string | null>(initial?.focus ?? null)
  const [activeGoal, setActiveGoal] = useState<any>(initial?.goal ?? null)
  const [flow, setFlow] = useState<{ domain: string; step: 1 | 2 | 3; behavior: string | null; context: string | null } | null>(null)
  const [rail, setRail] = useState<RailKey>('focus')
  const [view, setView] = useState<'world' | 'list'>('world')
  const [howOpen, setHowOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)
  const [sparks, setSparks] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => { if (!selected && heroKey) setSelected(heroKey) }, [heroKey, selected])

  const active = domains.find((d) => d.key === selected) ?? domains.find((d) => d.key === heroKey) ?? domains[0]
  const hero = domains.find((d) => d.key === heroKey) ?? domains[0]

  // Real spark balance for the HUD — hidden entirely if the service is unavailable.
  useEffect(() => {
    let alive = true
    getWallet()
      .then((w) => { if (alive && typeof w?.balance === 'number') setSparks(w.balance) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  /* ── persistence ────────────────────────────────────────────────────── */

  const persist = (next: { focus?: string | null; goal?: any }) => {
    // Keep whatever the map already stored (the competency snapshots and their
    // rolling history power the 7-day comparison) — we only own focus + goal.
    void updateLearnerState({
      activeness_map: {
        ...(initial ?? {}),
        focus: next.focus !== undefined ? next.focus : myFocus,
        goal: next.goal !== undefined ? next.goal : activeGoal,
      },
    }).catch(() => undefined)
  }

  const chooseFocus = (key: string) => {
    const next = myFocus === key ? null : key
    setMyFocus(next)
    persist({ focus: next })
    sceneApi.current?.setMyFocus(next)
    setToast(next ? t('actmap.msg.focus', { domain: t(`actmap.domain.${key}`) }) : null)
    if (next) window.setTimeout(() => setToast(null), 3600)
  }

  const goalText = (state: { domain: string; behavior: string | null; context: string | null }) => {
    if (!state.behavior || !state.context) return ''
    return t('actmap.goal.template', {
      behavior: t(`actmap.domain.${state.domain}.${state.behavior}`),
      context: t(`actmap.context.${state.context}`),
    })
  }

  const confirmGoal = async () => {
    if (!flow || !flow.behavior || !flow.context || saving) return
    const text = goalText(flow)
    const goal = { domain: flow.domain, behavior: flow.behavior, context: flow.context, text }
    setSaving(true)
    try {
      if (!learnerId) throw new Error('learner unknown')
      const created = await createActivenessGoal(learnerId, { domain: flow.domain, text })
      const withId = { ...goal, id: created.id }
      setActiveGoal(withId)
      persist({ goal: withId })
      window.dispatchEvent(new Event('yuvilab:brain-updated'))
      setToast(t('actmap.goal.created'))
      window.setTimeout(() => setToast(null), 4000)
    } catch {
      setActiveGoal(goal)
      persist({ goal })
    } finally {
      setSaving(false)
      setFlow(null)
      setSelected(goal.domain)
      setRail('goals')
    }
  }

  /* ── keep the render loop in sync without rebuilding WebGL ──────────── */

  const selectedRef = useRef<string | null>(selected)
  useEffect(() => { selectedRef.current = selected; sceneApi.current?.setSelected(selected) }, [selected])
  useEffect(() => { sceneApi.current?.setMyFocus(myFocus) }, [myFocus])
  const setSelectedRef = useRef(setSelected)
  useEffect(() => { setSelectedRef.current = setSelected })
  const tagRefsRef = useRef(tagRefs)

  /* ── the world ──────────────────────────────────────────────────────── */

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || view !== 'world') return

    const byKey: Record<string, number> = {}
    for (const c of competencies) byKey[c.key] = c.value
    const model = DOMAINS.map((d) => {
      const value = valueFor(d.source, byKey)
      const tone = toneFor(value)
      return { ...d, value, tone, level: Math.max(0, Math.min(1, value / 100)) }
    })
    const heroLocal = model.reduce((a, b) => (b.level > a.level ? b : a), model[0])?.key ?? null
    const slots = slotByKey

    const width = Math.max(1, mount.clientWidth)
    const height = Math.max(1, mount.clientHeight)

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, reduced ? 1.25 : 2))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02
    renderer.shadowMap.enabled = !reduced
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = skyTexture(['#f7f4ff', '#efeaff', '#e2dbfb'], 'rgba(255,238,214,ALPHA)')
    scene.fog = new THREE.Fog(new THREE.Color('#e9e3fb'), 22, 44)

    const pmrem = new THREE.PMREMGenerator(renderer)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = env.texture

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 200)
    camera.position.set(0, 6.1, 14.8)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0.55, -0.2)
    controls.enableDamping = true
    controls.dampingFactor = 0.075
    controls.enablePan = false
    controls.minDistance = 9.5
    controls.maxDistance = 20
    controls.minPolarAngle = 0.95
    controls.maxPolarAngle = 1.44
    controls.minAzimuthAngle = -0.6
    controls.maxAzimuthAngle = 0.6
    controls.rotateSpeed = 0.6
    controls.zoomSpeed = 0.6

    /* lighting — a bright, airy afternoon */
    scene.add(new THREE.HemisphereLight(new THREE.Color('#f3efff'), new THREE.Color('#a99ad8'), 1.25))
    const sun = new THREE.DirectionalLight(new THREE.Color('#fff6e6'), 2.5)
    sun.position.set(-6.5, 11, 7.5)
    if (!reduced) {
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
      sun.shadow.camera.near = 1
      sun.shadow.camera.far = 40
      sun.shadow.camera.left = -11
      sun.shadow.camera.right = 11
      sun.shadow.camera.top = 11
      sun.shadow.camera.bottom = -11
      sun.shadow.bias = -0.0004
      sun.shadow.normalBias = 0.03
      sun.shadow.radius = 2.5
    }
    scene.add(sun)
    const fill = new THREE.DirectionalLight(new THREE.Color('#cfd8ff'), 0.75)
    fill.position.set(7, 4, 6)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(new THREE.Color('#ffd9f2'), 0.7)
    rim.position.set(2, 5, -12)
    scene.add(rim)

    /* backdrop + atmosphere */
    const backdrop = buildBackdropIslands()
    scene.add(backdrop)
    const dust = buildAmbientDust(reduced ? 60 : 170)
    scene.add(dust)

    /* the podium and the companion */
    const podium = buildPodium('#8a6cff')
    podium.position.set(0, -0.1, 0.4)
    scene.add(podium)
    const mascot = buildMascot()
    mascot.position.set(0, 0.35, 0.4)
    mascot.scale.setScalar(0.92)
    scene.add(mascot)
    const mascotLight = new THREE.PointLight(new THREE.Color('#a98cff'), 3.2, 7, 2)
    mascotLight.position.set(0, 1.4, 1.4)
    scene.add(mascotLight)

    /* islands */
    interface Node {
      key: string
      group: THREE.Group
      island: THREE.Group
      prop: THREE.Group
      color: THREE.Color
      anchor: THREE.Vector3
      home: THREE.Vector3
      radius: number
      path: ReturnType<typeof buildLightPath>
      phase: number
      hover: number
      pick: THREE.Mesh
    }
    const nodes: Node[] = []
    const pickables: THREE.Object3D[] = []

    model.forEach((d, i) => {
      const slot = SLOTS[slots[d.key] ?? i] ?? SLOTS[i]
      const color = new THREE.Color(d.color)
      const variant = VARIANT[d.tone]
      const radius = (0.94 + d.level * 0.3) * slot.scale
      const group = new THREE.Group()
      group.position.set(Math.cos(slot.angle) * RX, slot.y, Math.sin(slot.angle) * RZ)

      const island = buildIsland(variant, color, i * 5 + 1, radius)
      group.add(island)

      const prop = buildMetaphor(d.metaphor, color, variant)
      const propScale = radius * (d.key === heroLocal ? 1.02 : 0.86)
      prop.scale.setScalar(propScale)
      prop.position.y = radius * 0.3
      group.add(prop)

      // Invisible, generous hit target so tapping an island always works.
      const pick = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 1.15, radius * 1.15, radius * 2.6, 12),
        new THREE.MeshBasicMaterial({ visible: false }),
      )
      pick.position.y = radius * 0.7
      pick.userData.domainKey = d.key
      group.add(pick)
      pickables.push(pick)

      scene.add(group)

      const path = buildLightPath(color)
      path.setStrength(d.level)
      scene.add(path.group)

      nodes.push({
        key: d.key,
        group,
        island,
        prop,
        color,
        anchor: new THREE.Vector3(),
        home: group.position.clone(),
        radius,
        path,
        phase: i * 1.31,
        hover: 0,
        pick,
      })
    })

    // Draw the light-paths from the podium rim to each island.
    const podiumEdge = new THREE.Vector3()
    for (const n of nodes) {
      const dir = n.home.clone().setY(0).normalize()
      podiumEdge.copy(dir).multiplyScalar(1.45).setY(0.05).add(new THREE.Vector3(0, 0, 0.4))
      const to = n.home.clone().add(new THREE.Vector3(0, -n.radius * 0.55, 0))
      n.path.rebuild(podiumEdge.clone(), to)
    }

    /* spotlight ring for the learner's chosen focus */
    const focusRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.045, 16, 120),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#ffffff'),
        emissive: new THREE.Color('#ffd36e'),
        emissiveIntensity: 1.6,
        roughness: 0.25,
        transparent: true,
        opacity: 0,
      }),
    )
    focusRing.rotation.x = -Math.PI / 2
    focusRing.visible = false
    scene.add(focusRing)

    /* post-processing — a whisper of bloom so gems glint without washing out */
    const composer = new EffectComposer(renderer)
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(width, height)
    composer.addPass(new RenderPass(scene, camera))
    let bloom: UnrealBloomPass | null = null
    if (!reduced) {
      bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.34, 0.72, 0.94)
      composer.addPass(bloom)
    }
    composer.addPass(new OutputPass())

    /* interaction */
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let hoverKey: string | null = null
    let downAt = { x: 0, y: 0, time: 0 }

    const toPointer = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1
    }
    const pick = () => {
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(pickables, false)[0]
      return hit ? (hit.object.userData.domainKey as string) : null
    }
    const onMove = (e: PointerEvent) => {
      toPointer(e)
      const key = pick()
      if (key !== hoverKey) {
        hoverKey = key
        renderer.domElement.style.cursor = key ? 'pointer' : 'grab'
      }
    }
    const onDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY, time: performance.now() }
    }
    const onUp = (e: PointerEvent) => {
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
      if (moved > 8 || performance.now() - downAt.time > 600) return
      toPointer(e)
      const key = pick()
      if (key) setSelectedRef.current?.(key)
    }
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.style.cursor = 'grab'

    /* camera focus tween */
    let tween: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t: number } | null = null
    const focusDomain = (key: string | null) => {
      const n = nodes.find((x) => x.key === key)
      const target = n ? new THREE.Vector3(n.home.x * 0.42, n.home.y * 0.4 + 0.6, n.home.z * 0.42) : new THREE.Vector3(0, 0.55, -0.2)
      const dist = n ? 12.4 : 14.8
      const dir = camera.position.clone().sub(controls.target).normalize()
      tween = {
        from: controls.target.clone(),
        to: target,
        camFrom: camera.position.clone(),
        camTo: target.clone().add(dir.multiplyScalar(dist)),
        t: 0,
      }
    }

    /* per-frame state pushed from React */
    let selectedNow: string | null = selectedRef.current
    let focusNow: string | null = initial?.focus ?? null

    sceneApi.current = {
      getPositions: () => slots,
      reset: () => { focusDomain(null) },
      focusDomain,
      setSelected: (key: string | null) => {
        if (key === selectedNow) return
        selectedNow = key
        focusDomain(key)
      },
      setMyFocus: (key: string | null) => { focusNow = key },
    }

    /* animation */
    const clock = new THREE.Clock()
    const projected = new THREE.Vector3()
    const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
    let intro = 0
    let raf = 0
    let disposed = false

    const placeTag = (el: HTMLElement | null, world: THREE.Vector3, hidden: boolean) => {
      if (!el) return
      projected.copy(world).project(camera)
      const behind = projected.z > 1
      if (hidden || behind) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; return }
      const x = (projected.x * 0.5 + 0.5) * width
      const y = (-projected.y * 0.5 + 0.5) * height
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      el.style.opacity = '1'
      el.style.pointerEvents = 'auto'
    }

    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const dt = Math.min(clock.getDelta(), 0.05)
      const time = clock.elapsedTime
      intro = Math.min(1, intro + dt / 1.25)
      const ease = easeOut(intro)

      // camera tween
      if (tween) {
        tween.t = Math.min(1, tween.t + dt / 0.8)
        const k = easeOut(tween.t)
        controls.target.lerpVectors(tween.from, tween.to, k)
        camera.position.lerpVectors(tween.camFrom, tween.camTo, k)
        if (tween.t >= 1) tween = null
      }

      // companion
      const head = mascot.userData.head
      mascot.position.y = 0.35 + Math.sin(time * 1.1) * 0.075
      mascot.rotation.y = Math.sin(time * 0.42) * 0.16
      if (head) head.rotation.z = Math.sin(time * 0.9) * 0.045
      mascot.userData.hands?.forEach((h: THREE.Mesh, i: number) => {
        h.position.y = 0.34 + Math.sin(time * 1.4 + i * 2.1) * 0.05
      })
      if (mascot.userData.bulb) {
        mascot.userData.bulb.material.emissiveIntensity = 1.2 + Math.sin(time * 2.4) * 0.5
      }
      if (podium.userData.rim) {
        podium.userData.rim.material.emissiveIntensity = 0.85 + Math.sin(time * 1.6) * 0.25
      }

      // islands
      for (const n of nodes) {
        const isSelected = n.key === selectedNow
        const isHover = n.key === hoverKey
        const target = isHover || isSelected ? 1 : 0
        n.hover += (target - n.hover) * Math.min(1, dt * 7)

        const bob = Math.sin(time * 0.62 + n.phase) * 0.12
        const lift = n.hover * 0.3
        n.group.position.y = n.home.y + bob + lift - (1 - ease) * 3.4
        n.group.rotation.y = Math.sin(time * 0.22 + n.phase) * 0.05
        const s = (0.92 + 0.08 * ease) * (1 + n.hover * 0.06)
        n.group.scale.setScalar(s)

        // prop life
        const spin = n.prop.userData.spin
        if (spin) spin.rotation.y = time * 0.35
        const sway = n.prop.userData.sway
        if (sway) sway.rotation.z = (sway.userData?.base ?? sway.rotation.z) + 0
        const needle = n.prop.userData.needle
        if (needle) needle.rotation.z = Math.sin(time * 0.5) * 0.22 + Math.sin(time * 1.7) * 0.04
        n.prop.traverse((o: any) => {
          if (!o.userData?.sparkle || !o.userData.sparkleSeed) return
          const arr = o.geometry.attributes.position.array as Float32Array
          const seed = o.userData.sparkleSeed as Float32Array
          for (let i = 0; i < arr.length / 3; i += 1) {
            arr[i * 3 + 1] = seed[i * 4 + 1] + Math.sin(time * 0.9 + seed[i * 4 + 3]) * 0.09
          }
          o.geometry.attributes.position.needsUpdate = true
          o.rotation.y = time * 0.12
        })

        // paths brighten toward the selected island
        n.path.setStrength(isSelected ? 1 : isHover ? 0.8 : 0.34)
        n.path.update(dt)
        n.path.group.visible = intro > 0.45

        n.anchor.copy(n.group.position)
        n.anchor.y += n.radius * (n.key === heroLocal ? 2.35 : 2.05) * s
      }

      // focus ring under the learner's chosen domain
      const focusNode = nodes.find((n) => n.key === focusNow)
      if (focusNode) {
        focusRing.visible = true
        focusRing.position.copy(focusNode.group.position)
        focusRing.position.y += 0.16
        focusRing.scale.setScalar(focusNode.radius * 1.14)
        const mat = focusRing.material as THREE.MeshStandardMaterial
        mat.opacity = 0.55 + Math.sin(time * 2.2) * 0.2
        mat.emissiveIntensity = 1.3 + Math.sin(time * 2.2) * 0.4
      } else {
        focusRing.visible = false
      }

      // ambient dust drift
      const dustSeed = dust.userData.dustSeed as Float32Array
      const dustArr = dust.geometry.attributes.position.array as Float32Array
      for (let i = 0; i < dustArr.length / 3; i += 1) {
        dustArr[i * 3 + 1] = dustSeed[i * 4 + 1] + Math.sin(time * 0.28 + dustSeed[i * 4 + 3]) * 0.5
        dustArr[i * 3] = dustSeed[i * 4] + Math.cos(time * 0.16 + dustSeed[i * 4 + 3]) * 0.4
      }
      dust.geometry.attributes.position.needsUpdate = true
      backdrop.rotation.y = Math.sin(time * 0.03) * 0.04
      backdrop.position.y = Math.sin(time * 0.18) * 0.25

      controls.update()

      // HTML labels ride along with the islands
      for (const n of nodes) placeTag(tagRefsRef.current.current[n.key], n.anchor, intro < 0.7)
      placeTag(captionRef.current, new THREE.Vector3(0, -0.7, 0.4), intro < 0.8)

      composer.render()
    }

    // fade the canvas in only once the first frame is on screen
    requestAnimationFrame(() => {
      tick()
      requestAnimationFrame(() => setReady(true))
    })

    const onResize = () => {
      const w = Math.max(1, mount.clientWidth)
      const h = Math.max(1, mount.clientHeight)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      composer.setSize(w, h)
      bloom?.setSize(w, h)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      sceneApi.current = null
      for (const n of nodes) n.path.dispose()
      scene.traverse((o: any) => {
        if (o.isMesh || o.isPoints) {
          o.geometry?.dispose?.()
          const m = o.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m?.dispose?.()
        }
      })
      composer.dispose?.()
      env.texture.dispose()
      pmrem.dispose()
      renderer.dispose()
      disposeTextureCache()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, reduced, view])

  /* ── overlay helpers ────────────────────────────────────────────────── */

  const toggleFullscreen = () => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void el.requestFullscreen?.().catch(() => undefined)
  }

  const statusOf = (key: string) => statusByKey[key] ?? 'onway'
  const domainName = (key: string) => t(`actmap.domain.${key}`)

  const railTitle: Record<RailKey, string> = {
    focus: t('actmap.rail.focus'),
    goals: t('actmap.rail.goals'),
    progress: t('actmap.rail.progress'),
    insights: t('actmap.rail.insights'),
  }

  return (
    <div className="aworld" ref={rootRef} dir={direction} data-ready={ready ? 'true' : 'false'}>
      {view === 'world' ? <div className="aworld__stage" ref={mountRef} /> : <div className="aworld__stage aworld__stage--flat" />}

      {/* floating island labels */}
      {view === 'world' && (
        <div className="aworld__tags" aria-hidden="true">
          {domains.map((d) => {
            const status = statusOf(d.key)
            return (
              <button
                key={d.key}
                type="button"
                ref={(el) => { tagRefs.current[d.key] = el }}
                className="aworld__tag"
                data-status={status}
                data-active={selected === d.key ? 'true' : 'false'}
                style={{ ['--tag-tint' as any]: d.color }}
                onClick={() => setSelected(d.key)}
              >
                <span className="aworld__tag-name">{domainName(d.key)}</span>
                <span className="aworld__tag-status">
                  <i className="aworld__tag-badge"><Icon name={STATUS_ICON[status]} size={12} /></i>
                  {t(STATUS_KEY[status])}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* companion caption on the podium */}
      {view === 'world' && (
        <div className="aworld__caption" ref={captionRef} aria-hidden="true">
          <strong>{studentName}</strong>
          <span>{t('actmap.center.caption')}</span>
        </div>
      )}

      {/* header */}
      <header className="aworld__head">
        <button type="button" className="aworld__round" onClick={onClose} aria-label={t('actmap.back')}>
          <Icon name="arrow" size={18} />
        </button>
        <div className="aworld__titles">
          <h1>{t('actmap.title')}</h1>
          <p>{t('actmap.subtitle')}</p>
        </div>
      </header>

      <div className="aworld__headtools">
        <button type="button" className="aworld__pill" onClick={() => setHowOpen(true)}>
          <Icon name="help" size={15} />
          {t('actmap.how')}
        </button>
        <button
          type="button"
          className="aworld__pill"
          onClick={() => setView((v) => (v === 'world' ? 'list' : 'world'))}
        >
          <Icon name={view === 'world' ? 'inbox' : 'map'} size={15} />
          {view === 'world' ? t('actmap.view.list') : t('actmap.view.world')}
        </button>
        <button type="button" className="aworld__round" onClick={onClose} aria-label={t('actmap.home')}>
          <Icon name="chart" size={17} />
        </button>
      </div>

      {/* left rail */}
      <nav className="aworld__rail" aria-label={t('actmap.title')}>
        {(['focus', 'goals', 'progress', 'insights'] as RailKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className="aworld__railbtn"
            data-active={rail === key ? 'true' : 'false'}
            onClick={() => setRail(key)}
          >
            <i><Icon name={key === 'focus' ? 'target' : key === 'goals' ? 'spark' : key === 'progress' ? 'chart' : 'lightbulb'} size={19} /></i>
            <span>{railTitle[key]}</span>
          </button>
        ))}
      </nav>

      {/* detail panel */}
      <aside className="aworld__panel" style={{ ['--panel-tint' as any]: active?.color }}>
        {rail === 'focus' && active && (
          <>
            <div className="aworld__panel-hero">
              <div className="aworld__gem" style={{ ['--gem' as any]: active.color }}>
                <Icon name={active.icon} size={26} />
              </div>
              <div>
                <h2>{domainName(active.key)}</h2>
                <span className="aworld__chip" data-status={statusOf(active.key)}>
                  <Icon name={STATUS_ICON[statusOf(active.key)]} size={12} />
                  {t(STATUS_KEY[statusOf(active.key)])}
                </span>
              </div>
            </div>

            <ul className="aworld__qa">
              <li>
                <i><Icon name="message" size={15} /></i>
                <div>
                  <h3>{t('actmap.panel.says')}</h3>
                  <p>{t(`actmap.domain.${active.key}.says`)}</p>
                </div>
              </li>
              <li>
                <i><Icon name="check" size={15} /></i>
                <div>
                  <h3>{t('actmap.panel.evidence')}</h3>
                  <p>{t(`actmap.domain.${active.key}.working`)}</p>
                </div>
              </li>
              <li>
                <i><Icon name="click" size={15} /></i>
                <div>
                  <h3>{t('actmap.panel.use')}</h3>
                  <p>{t(`actmap.domain.${active.key}.nextstep`)}</p>
                </div>
              </li>
            </ul>

            <div className="aworld__actions">
              <button
                type="button"
                className="aworld__cta"
                data-on={myFocus === active.key ? 'true' : 'false'}
                onClick={() => chooseFocus(active.key)}
              >
                <Icon name={myFocus === active.key ? 'check' : 'target'} size={16} />
                {myFocus === active.key ? t('actmap.isFocus') : t('actmap.setFocus')}
              </button>
              <button type="button" className="aworld__ghost" onClick={() => setFlow({ domain: active.key, step: 1, behavior: null, context: null })}>
                <Icon name="spark" size={15} />
                {t('actmap.panel.linkGoal')}
              </button>
            </div>

            <button type="button" className="aworld__expander" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {t('actmap.panel.more')}
              <Icon name="arrow" size={14} />
            </button>
            {expanded && <p className="aworld__more">{t(`actmap.domain.${active.key}.promote`)}</p>}
          </>
        )}

        {rail === 'goals' && (
          <>
            <h2 className="aworld__panel-title">{t('actmap.rail.goals')}</h2>
            {activeGoal ? (
              <div className="aworld__goal">
                <span className="aworld__chip" data-status="core">
                  <Icon name="spark" size={12} />
                  {domainName(activeGoal.domain)}
                </span>
                <p>{activeGoal.text}</p>
              </div>
            ) : (
              <p className="aworld__empty">{t('actmap.msg.noGoal')}</p>
            )}
            <button
              type="button"
              className="aworld__cta"
              onClick={() => setFlow({ domain: myFocus ?? active?.key ?? domains[0].key, step: 1, behavior: null, context: null })}
            >
              <Icon name="plus" size={16} />
              {t('actmap.card.makeGoal')}
            </button>
          </>
        )}

        {rail === 'progress' && (
          <>
            <h2 className="aworld__panel-title">{t('actmap.rail.progress')}</h2>
            <ul className="aworld__list">
              {[...domains]
                .sort((a, b) => b.level - a.level)
                .map((d) => (
                  <li key={d.key}>
                    <button type="button" onClick={() => { setSelected(d.key); setRail('focus') }} data-active={selected === d.key ? 'true' : 'false'}>
                      <i style={{ ['--gem' as any]: d.color }}><Icon name={d.icon} size={15} /></i>
                      <span className="aworld__list-name">{domainName(d.key)}</span>
                      <span className="aworld__chip" data-status={statusOf(d.key)}>
                        <Icon name={STATUS_ICON[statusOf(d.key)]} size={11} />
                        {t(STATUS_KEY[statusOf(d.key)])}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}

        {rail === 'insights' && (
          <>
            <h2 className="aworld__panel-title">{t('actmap.rail.insights')}</h2>
            <div className="aworld__insights">
              <p>{t('actmap.yubi.intro', { name: studentName })}</p>
              <p><strong>{t('actmap.yubi.strengths')}</strong> {t(`actmap.yubi.strong.${hero.key}`)}</p>
              {(() => {
                const grow = [...domains].sort((a, b) => a.level - b.level)[0]
                return <p><strong>{t('actmap.yubi.growth')}</strong> {t(`actmap.yubi.grow.${grow.key}`)}</p>
              })()}
              <p>{t('actmap.yubi.outro')}</p>
            </div>
          </>
        )}
      </aside>

      {/* bottom message */}
      <div className="aworld__banner">
        <span className="aworld__banner-gem" style={{ ['--gem' as any]: hero.color }}>
          <Icon name={hero.icon} size={16} />
        </span>
        <div>
          <strong>{t('actmap.bottom.headline', { domain: domainName(hero.key) })}</strong>
          <span>{t('actmap.bottom.sub')}</span>
        </div>
        <button type="button" className="aworld__banner-cta" onClick={onClose}>
          {t('actmap.bottom.cta')}
          <Icon name="arrow" size={14} />
        </button>
      </div>

      {/* bottom-left tools */}
      <div className="aworld__tools">
        <button type="button" className="aworld__round" onClick={() => sceneApi.current?.reset()} aria-label={t('actmap.reset')} title={t('actmap.reset')}>
          <Icon name="compass" size={17} />
        </button>
        <button type="button" className="aworld__round" onClick={toggleFullscreen} aria-label={fullscreen ? t('actmap.exitFullscreen') : t('actmap.fullscreen')} title={fullscreen ? t('actmap.exitFullscreen') : t('actmap.fullscreen')}>
          <Icon name="expand" size={17} />
        </button>
        <button type="button" className="aworld__round" onClick={() => setHowOpen(true)} aria-label={t('actmap.how')} title={t('actmap.how')}>
          <Icon name="help" size={17} />
        </button>
      </div>

      {/* bottom-right hud */}
      <div className="aworld__hud">
        <div className="aworld__hud-progress">
          <span>{t('actmap.hud.progress')}</span>
          <i><b style={{ width: `${Math.round(expressedShare * 100)}%` }} /></i>
        </div>
        {sparks !== null && (
          <div className="aworld__hud-sparks" title={t('actmap.hud.sparks')}>
            <Icon name="spark" size={15} />
            {sparks.toLocaleString()}
          </div>
        )}
      </div>

      {/* accessible list view */}
      {view === 'list' && (
        <section className="aworld__flat">
          <ul>
            {[...domains].sort((a, b) => b.level - a.level).map((d) => (
              <li key={d.key}>
                <button type="button" onClick={() => { setSelected(d.key); setRail('focus'); setView('world') }}>
                  <i style={{ ['--gem' as any]: d.color }}><Icon name={d.icon} size={18} /></i>
                  <div>
                    <strong>{domainName(d.key)}</strong>
                    <p>{t(`actmap.domain.${d.key}.says`)}</p>
                  </div>
                  <span className="aworld__chip" data-status={statusOf(d.key)}>
                    <Icon name={STATUS_ICON[statusOf(d.key)]} size={11} />
                    {t(STATUS_KEY[statusOf(d.key)])}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* "how does this work?" */}
      {howOpen && (
        <div className="aworld__modal" role="dialog" aria-modal="true" onClick={() => setHowOpen(false)}>
          <div className="aworld__sheet" onClick={(e) => e.stopPropagation()}>
            <h2>{t('actmap.how.title')}</h2>
            <ul className="aworld__how">
              <li><i><Icon name="click" size={15} /></i>{t('actmap.how.step1')}</li>
              <li><i><Icon name="target" size={15} /></i>{t('actmap.how.step2')}</li>
              <li><i><Icon name="spark" size={15} /></i>{t('actmap.how.step3')}</li>
            </ul>
            <button type="button" className="aworld__cta" onClick={() => setHowOpen(false)}>{t('actmap.card.close')}</button>
          </div>
        </div>
      )}

      {/* goal flow */}
      {flow && (
        <div className="aworld__modal" role="dialog" aria-modal="true">
          <div className="aworld__sheet">
            <h2>{t('actmap.goal.title', { domain: domainName(flow.domain) })}</h2>
            {flow.step === 1 && (
              <>
                <p className="aworld__step">{t('actmap.goal.step1')}</p>
                <div className="aworld__choices">
                  {(['b1', 'b2', 'b3'] as const).map((b) => (
                    <button key={b} type="button" data-on={flow.behavior === b ? 'true' : 'false'} onClick={() => setFlow({ ...flow, behavior: b })}>
                      {t(`actmap.domain.${flow.domain}.${b}`)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {flow.step === 2 && (
              <>
                <p className="aworld__step">{t('actmap.goal.step2')}</p>
                <div className="aworld__choices">
                  {(['math', 'group', 'exam', 'any'] as const).map((c) => (
                    <button key={c} type="button" data-on={flow.context === c ? 'true' : 'false'} onClick={() => setFlow({ ...flow, context: c })}>
                      {t(`actmap.context.${c}`)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {flow.step === 3 && (
              <>
                <p className="aworld__step">{t('actmap.goal.step3')}</p>
                <p className="aworld__goaltext">{goalText(flow)}</p>
              </>
            )}
            <div className="aworld__modal-actions">
              <button type="button" className="aworld__ghost" onClick={() => (flow.step === 1 ? setFlow(null) : setFlow({ ...flow, step: (flow.step - 1) as 1 | 2 }))}>
                {flow.step === 1 ? t('actmap.goal.cancel') : t('actmap.goal.back')}
              </button>
              {flow.step < 3 ? (
                <button
                  type="button"
                  className="aworld__cta"
                  disabled={(flow.step === 1 && !flow.behavior) || (flow.step === 2 && !flow.context)}
                  onClick={() => setFlow({ ...flow, step: (flow.step + 1) as 2 | 3 })}
                >
                  {t('actmap.goal.next')}
                </button>
              ) : (
                <button type="button" className="aworld__cta" disabled={saving} onClick={confirmGoal}>
                  {t('actmap.goal.confirm')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="aworld__toast" role="status">{toast}</div>}
    </div>
  )
}

export default ActivenessWorld3D
