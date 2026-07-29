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
 * ONE STRAIGHT ROW. A ring hid domains behind each other and made the order
 * unreadable; laid out on a single line every domain is visible at once and the
 * row itself carries the message — it runs from the learner's strongest domain
 * (first in reading order) to the one they are growing into.
 */
const LINE_GAP = 2.5
const LINE_Y = 1.15
/** Slot index → world position on the row. RTL starts the row on the right. */
function slotPosition(index: number, count: number, rtl: boolean) {
  const x = (index - (count - 1) / 2) * LINE_GAP * (rtl ? -1 : 1)
  return new THREE.Vector3(x, LINE_Y, 0)
}
/** What the camera has to keep in frame: the whole row, plus the companion. */
const LINE_SPAN = LINE_GAP * 6 + 3.4
const LINE_RISE = 6.8

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

/**
 * Exactly three readable states — a learner must be able to finish the sentence
 * "I'm good at ___ and the next thing I want to strengthen is ___" without
 * clicking anything. Words only, never a score.
 */
type Status = 'strength' | 'process' | 'next'
const STATUS_KEY: Record<Status, string> = {
  strength: 'actmap.state.strength',
  process: 'actmap.state.process',
  next: 'actmap.state.next',
}
const STATUS_ICON: Record<Status, string> = { strength: 'spark', process: 'clock', next: 'target' }

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

  /**
   * The single domain marked as "my next goal". The learner's own choice wins;
   * otherwise it is the domain that is least expressed today. There is never
   * more than one — a wall of "needs improvement" is not readable.
   */
  const suggestedNext = useMemo(() => {
    const ranked = [...domains].sort((a, b) => a.level - b.level)
    const first = ranked.find((d) => d.key !== heroKey) ?? ranked[0]
    return first?.key ?? null
  }, [domains, heroKey])

  /** Slot per domain: honour a saved arrangement, otherwise strongest first. */
  const slotByKey = useMemo(() => {
    const saved = initial?.positions
    const valid = saved && DOMAINS.every((d) => typeof saved[d.key] === 'number')
    if (valid) return saved as Record<string, number>
    const ranked = [...domains].sort((a, b) => b.level - a.level)
    const map: Record<string, number> = {}
    ranked.forEach((d, i) => { map[d.key] = i })
    return map
  }, [domains, initial])

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
  const [fullscreen, setFullscreen] = useState(false)

  /* ── the three states every learner reads in 3 seconds ──────────────── */

  /** Exactly one "next goal" domain: learner's goal → learner's focus → suggestion. */
  const nextKey = useMemo(
    () => (activeGoal?.domain as string | undefined) ?? myFocus ?? suggestedNext,
    [activeGoal, myFocus, suggestedNext],
  )

  const statusByKey = useMemo(() => {
    const map: Record<string, Status> = {}
    for (const d of domains) {
      map[d.key] = d.key === nextKey ? 'next' : d.key === heroKey || d.tone === 'strong' ? 'strength' : 'process'
    }
    return map
  }, [domains, heroKey, nextKey])

  // Nothing is selected on entry: the learner meets a clean map. Details and
  // actions only appear once an island is picked.
  const active = selected ? domains.find((d) => d.key === selected) ?? null : null
  const hero = domains.find((d) => d.key === heroKey) ?? domains[0]
  const nextDomain = domains.find((d) => d.key === nextKey) ?? null

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
  // The spotlight in the world always marks the one "next goal" island.
  useEffect(() => { sceneApi.current?.setMyFocus(nextKey) }, [nextKey])
  const setSelectedRef = useRef<(key: string | null) => void>(() => undefined)
  useEffect(() => {
    // Picking an island in the world always opens its own detail view.
    setSelectedRef.current = (key) => { setSelected(key); setRail('focus') }
  })
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
    // The one island the learner should read as "my next goal".
    const nextLocal =
      (initial?.goal?.domain as string | undefined) ??
      initial?.focus ??
      [...model].sort((a, b) => a.level - b.level).find((d) => d.key !== heroLocal)?.key ??
      null
    const slots = slotByKey

    const width = Math.max(1, mount.clientWidth)
    const height = Math.max(1, mount.clientHeight)
    // Live viewport size — kept in sync by the resize observer so the HTML
    // labels stay glued to their islands.
    const vp = { w: width, h: height }

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, reduced ? 1.25 : 2))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.92
    renderer.shadowMap.enabled = !reduced
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = skyTexture(['#f7f4ff', '#efeaff', '#e2dbfb'], 'rgba(255,238,214,ALPHA)')
    scene.fog = new THREE.Fog(new THREE.Color('#e9e3fb'), 34, 72)

    const pmrem = new THREE.PMREMGenerator(renderer)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = env.texture

    // The row is read as a whole, so the camera stays square to it and simply
    // pulls back far enough to hold every island on screen.
    const homeTarget = new THREE.Vector3(0, 0.55, 0)
    // Which way to nudge the camera so a picked island never sits behind the
    // side detail panel (the panel is on the inline-start edge).
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 240)
    const fitDistance = () => {
      const vFov = (camera.fov * Math.PI) / 180
      const half = Math.tan(vFov / 2)
      return Math.max(LINE_RISE / 2 / half, LINE_SPAN / 2 / (half * Math.max(0.4, camera.aspect)))
    }
    let baseDist = fitDistance()
    camera.position.set(0, homeTarget.y + baseDist * 0.2, baseDist)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(homeTarget)
    controls.enableDamping = true
    controls.dampingFactor = 0.075
    controls.enablePan = false
    controls.minDistance = baseDist * 0.42
    controls.maxDistance = baseDist * 1.95
    controls.minPolarAngle = 1.02
    controls.maxPolarAngle = 1.5
    controls.minAzimuthAngle = -0.34
    controls.maxAzimuthAngle = 0.34
    controls.rotateSpeed = 0.5
    controls.zoomSpeed = 0.6

    /* lighting — a bright, airy afternoon */
    scene.add(new THREE.HemisphereLight(new THREE.Color('#f3efff'), new THREE.Color('#a99ad8'), 0.95))
    const sun = new THREE.DirectionalLight(new THREE.Color('#fff6e6'), 2.1)
    sun.position.set(-6.5, 11, 7.5)
    if (!reduced) {
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
      sun.shadow.camera.near = 1
      sun.shadow.camera.far = 40
      sun.shadow.camera.left = -16
      sun.shadow.camera.right = 16
      sun.shadow.camera.top = 12
      sun.shadow.camera.bottom = -12
      sun.shadow.bias = -0.0004
      sun.shadow.normalBias = 0.03
      sun.shadow.radius = 2.5
    }
    scene.add(sun)
    const fill = new THREE.DirectionalLight(new THREE.Color('#cfd8ff'), 0.55)
    fill.position.set(7, 4, 6)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(new THREE.Color('#ffd9f2'), 0.5)
    rim.position.set(2, 5, -12)
    scene.add(rim)

    /* backdrop + atmosphere */
    const backdrop = buildBackdropIslands()
    scene.add(backdrop)
    const dust = buildAmbientDust(reduced ? 60 : 170)
    scene.add(dust)

    /* the podium and the companion — in the near foreground, below the row, so
       the light paths rise from the learner up to every domain */
    const podium = buildPodium('#8a6cff')
    podium.position.set(0, -1.85, 3.8)
    scene.add(podium)
    const mascot = buildMascot()
    mascot.position.set(0, -1.65, 3.8)
    mascot.scale.setScalar(0.66)
    scene.add(mascot)
    const mascotLight = new THREE.PointLight(new THREE.Color('#a98cff'), 1.6, 6, 2)
    mascotLight.position.set(0, -0.6, 4.8)
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
      const color = new THREE.Color(d.color)
      const variant = VARIANT[d.tone]
      // Hierarchy first: the headline strength is unmistakably the biggest
      // island, the next-goal island is second, everything else stays calm.
      const emphasis = d.key === heroLocal ? 1.3 : d.key === nextLocal ? 1.06 : 0.84
      const radius = (0.66 + d.level * 0.22) * emphasis
      const group = new THREE.Group()
      group.position.copy(slotPosition(slots[d.key] ?? i, model.length, direction === 'rtl'))

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

    // Draw the light-paths from the companion in the foreground up to each island.
    const podiumTop = new THREE.Vector3(0, -1.25, 3.8)
    for (const n of nodes) {
      const lateral = n.home.clone().sub(podiumTop).setY(0)
      if (lateral.lengthSq() > 0.0001) lateral.normalize().multiplyScalar(0.8)
      const from = podiumTop.clone().add(lateral)
      const to = n.home.clone().add(new THREE.Vector3(0, -n.radius * 0.6, 0))
      n.path.rebuild(from, to)
    }

    /* spotlight ring + light beam marking the one "next goal" island */
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

    // A soft shaft of light so the goal island is found without reading a word.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 1.05, 5.6, 28, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#ffd77a'),
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    )
    beam.visible = false
    scene.add(beam)

    /* post-processing — a whisper of bloom so gems glint without washing out */
    const composer = new EffectComposer(renderer)
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(width, height)
    composer.addPass(new RenderPass(scene, camera))
    let bloom: UnrealBloomPass | null = null
    if (!reduced) {
      bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.12, 0.45, 0.99)
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

    /* camera move on selection — the row must stay whole, so picking a domain
       only slides and pulls the world clear of the detail panel; it never zooms
       into one island and hides the rest */
    let tween: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t: number } | null = null
    /** How far to pull back and slide so the whole row fits beside the panel. */
    const panelFraming = () => {
      const panelPx = Math.min(400, Math.max(230, vp.w * 0.42))
      const free = Math.max(0.45, (vp.w - panelPx) / vp.w)
      const dist = Math.min(baseDist / free, baseDist * 1.85)
      const worldW = 2 * dist * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect
      const shift = ((panelPx / vp.w) * worldW) / 2
      return { dist, shift: direction === 'rtl' ? shift : -shift }
    }
    const focusDomain = (key: string | null) => {
      const picked = !!key && nodes.some((x) => x.key === key)
      const frame = picked ? panelFraming() : { dist: baseDist, shift: 0 }
      const target = new THREE.Vector3(homeTarget.x + frame.shift, homeTarget.y, homeTarget.z)
      const dir = camera.position.clone().sub(controls.target).normalize()
      tween = {
        from: controls.target.clone(),
        to: target,
        camFrom: camera.position.clone(),
        camTo: target.clone().add(dir.multiplyScalar(frame.dist)),
        t: 0,
      }
    }

    /* per-frame state pushed from React */
    let selectedNow: string | null = selectedRef.current
    let focusNow: string | null = nextLocal

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
      const x = (projected.x * 0.5 + 0.5) * vp.w
      const y = (-projected.y * 0.5 + 0.5) * vp.h
      // Keep labels clear of the side detail panel while it is open.
      const panelGap = selectedNow ? 330 : 24
      const minX = direction === 'rtl' ? 24 : panelGap
      const maxX = direction === 'rtl' ? vp.w - panelGap : vp.w - 24
      const cx = Math.min(Math.max(x, Math.min(minX, maxX)), Math.max(minX, maxX))
      const cy = Math.min(Math.max(y, 84), vp.h - 118)
      el.style.transform = `translate(-50%, -100%) translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`
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
      mascot.position.y = -1.65 + Math.sin(time * 1.1) * 0.075
      mascot.rotation.y = Math.sin(time * 0.42) * 0.16
      if (head) head.rotation.z = Math.sin(time * 0.9) * 0.045
      mascot.userData.hands?.forEach((h: THREE.Mesh, i: number) => {
        h.position.y = 0.34 + Math.sin(time * 1.4 + i * 2.1) * 0.05
      })
      if (mascot.userData.bulb) {
        mascot.userData.bulb.material.emissiveIntensity = 0.7 + Math.sin(time * 2.4) * 0.25
      }
      if (podium.userData.rim) {
        podium.userData.rim.material.emissiveIntensity = 0.5 + Math.sin(time * 1.6) * 0.15
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

        // paths brighten toward the selected island; the headline strength and
        // the goal island stay lit, the rest read as quiet background.
        const lead = n.key === heroLocal || n.key === focusNow
        n.path.setStrength(isSelected ? 1 : isHover ? 0.8 : lead ? 0.5 : 0.16)
        n.path.update(dt)
        n.path.group.visible = intro > 0.45

        n.anchor.copy(n.group.position)
        n.anchor.y += n.radius * (n.key === heroLocal ? 2.35 : 2.05) * s
      }

      // focus ring + light shaft over the one "next goal" island
      const focusNode = nodes.find((n) => n.key === focusNow)
      if (focusNode) {
        focusRing.visible = true
        focusRing.position.copy(focusNode.group.position)
        focusRing.position.y += 0.16
        focusRing.scale.setScalar(focusNode.radius * 1.14)
        const mat = focusRing.material as THREE.MeshStandardMaterial
        mat.opacity = 0.55 + Math.sin(time * 2.2) * 0.2
        mat.emissiveIntensity = 1.3 + Math.sin(time * 2.2) * 0.4

        beam.visible = intro > 0.6
        beam.position.copy(focusNode.group.position)
        beam.position.y += 2.9
        beam.scale.set(focusNode.radius * 1.05, 1, focusNode.radius * 1.05)
        ;(beam.material as THREE.MeshBasicMaterial).opacity = 0.13 + Math.sin(time * 1.8) * 0.05
      } else {
        focusRing.visible = false
        beam.visible = false
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
      placeTag(captionRef.current, new THREE.Vector3(0, -3.4, 3.8), intro < 0.8)

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
      vp.w = w
      vp.h = h
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      composer.setSize(w, h)
      bloom?.setSize(w, h)
      // Re-fit so the whole row stays on screen at any dock size.
      baseDist = fitDistance()
      controls.minDistance = baseDist * 0.42
      controls.maxDistance = baseDist * 1.95
      if (!tween && !selectedNow) {
        const dir = camera.position.clone().sub(controls.target)
        if (dir.lengthSq() > 0.0001) {
          camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(baseDist))
        }
      }
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
  }, [signature, reduced, view, direction])

  /* ── overlay helpers ────────────────────────────────────────────────── */

  const toggleFullscreen = () => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void el.requestFullscreen?.().catch(() => undefined)
  }

  const statusOf = (key: string) => statusByKey[key] ?? 'process'
  const domainName = (key: string) => t(`actmap.domain.${key}`)

  return (
    <div className={`aworld${selected ? ' aworld--picked' : ''}`} ref={rootRef} dir={direction} data-ready={ready ? 'true' : 'false'}>
      {view === 'world' ? <div className="aworld__stage" ref={mountRef} /> : <div className="aworld__stage aworld__stage--flat" />}

      {/* floating island labels */}
      {view === 'world' && (
        <div className="aworld__tags" aria-hidden="true">
          {domains.map((d) => {
            const status = statusOf(d.key)
            const isActive = selected === d.key
            // Only the headline strength and the one goal carry a status line —
            // everything else stays a quiet name so the hierarchy is readable.
            const showStatus = status !== 'process' || isActive
            return (
              <button
                key={d.key}
                type="button"
                ref={(el) => { tagRefs.current[d.key] = el }}
                className="aworld__tag"
                data-status={status}
                data-active={isActive ? 'true' : 'false'}
                data-lead={d.key === heroKey ? 'true' : 'false'}
                style={{ ['--tag-tint' as any]: d.color }}
                onClick={() => { setSelected(d.key); setRail('focus') }}
              >
                <span className="aworld__tag-name">{domainName(d.key)}</span>
                {showStatus && (
                  <span className="aworld__tag-status">
                    <i className="aworld__tag-badge"><Icon name={STATUS_ICON[status]} size={12} /></i>
                    {t(STATUS_KEY[status])}
                  </span>
                )}
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
        <button
          type="button"
          className="aworld__pill"
          onClick={() => setView((v) => (v === 'world' ? 'list' : 'world'))}
        >
          <Icon name={view === 'world' ? 'inbox' : 'map'} size={15} />
          {view === 'world' ? t('actmap.view.list') : t('actmap.view.world')}
        </button>
      </div>

      {/* detail panel */}
      {selected && (
      <aside className="aworld__panel" style={{ ['--panel-tint' as any]: active?.color }}>
        <button type="button" className="aworld__panel-close" onClick={() => setSelected(null)} aria-label={t('actmap.card.close')}>
          <Icon name="close" size={15} />
        </button>
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
              {nextDomain && <p><strong>{t('actmap.yubi.growth')}</strong> {t(`actmap.yubi.grow.${nextDomain.key}`)}</p>}
              <p>{t('actmap.yubi.outro')}</p>
            </div>
          </>
        )}
      </aside>
      )}

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
